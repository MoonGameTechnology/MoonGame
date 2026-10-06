/**
 * Экран настройки схватки (REFM-212) — прямой тест владельца состояния сетапа.
 *
 * Состояние меняют только двери модуля и обработчики его экрана, поэтому здесь проверено то,
 * что текстом не проверить: что каждый заход начинается свежей одиночной схваткой, что из
 * выбора на экране уезжает в матч, как гид и сетевой вход готовят свою партию и как опрос
 * мест сбрасывает протухший выбор. Каждый тест — свежая загрузка модулей над своей
 * «страницей» из заглушек элементов. В конце — стык с `main.ts`: двери зовут там, где раньше
 * присваивали.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';

import { t, tData } from '../../localization/runtime';
import { entryOffer, type MatchSeat } from '../../decisions/entrySetup';
import { joinHref } from '../../decisions/seatJoin';
import type { SetupConfig } from './game';
import { mapPreset } from './mapCatalog';
import { metaGrant, parseMetaState } from './meta';
import { SOLO_SAVE_KEY } from './soloSaveLocal';

interface El {
  style: { display: string };
  innerHTML: string;
  textContent: string;
  value: string;
  disabled: boolean;
  checked: boolean;
  dataset: Record<string, string>;
  classes: Set<string>;
  classList: {
    add(c: string): void;
    remove(c: string): void;
    toggle(c: string, on?: boolean): void;
    contains(c: string): boolean;
  };
  kids: El[];
  setAttribute(k: string, v: string): void;
  querySelectorAll(sel: string): El[];
  addEventListener(type: string, fn: (ev: unknown) => void): void;
  fire(type: string, ev?: unknown): void;
  click(): void;
  focus(): void;
}

let page: Map<string, El>;
let cell: Map<string, string>;

function stub(): El {
  const on = new Map<string, Array<(ev: unknown) => void>>();
  const el: El = {
    style: { display: '' },
    innerHTML: '',
    textContent: '',
    value: '',
    disabled: false,
    checked: false,
    dataset: {},
    classes: new Set(),
    classList: {
      add: (c) => void el.classes.add(c),
      remove: (c) => void el.classes.delete(c),
      toggle: (c, want) => {
        if (want ?? !el.classes.has(c)) el.classes.add(c);
        else el.classes.delete(c);
      },
      contains: (c) => el.classes.has(c),
    },
    kids: [],
    setAttribute: () => {},
    querySelectorAll: () => el.kids,
    addEventListener: (type, fn) => void on.set(type, [...(on.get(type) ?? []), fn]),
    fire: (type, ev = {}) => {
      for (const fn of on.get(type) ?? []) fn(ev);
    },
    click: () => el.fire('click'),
    focus: () => {},
  };
  return el;
}
const el = (id: string): El => {
  if (!page.has(id)) page.set(id, stub());
  return page.get(id)!;
};
/** Цель нажатия: элемент с атрибутами `data-*`, до которого дойдёт `closest`. */
const hit = (attrs: Record<string, string>) => ({
  closest: (sel: string) => {
    const key = /^\[([\w-]+)\]$/.exec(sel)?.[1];
    return key !== undefined && key in attrs
      ? { getAttribute: (k: string) => attrs[k] ?? null }
      : null;
  },
});
const tap = (id: string, attrs: Record<string, string>): void =>
  el(id).fire('click', { target: hit(attrs) });
const pick = (id: string, value: string): void => el(id).fire('change', { target: { id, value } });

const SEATS = Array.from({ length: 100 }, (_, i) => ({
  id: `p${i + 1}`,
  name: `House ${i + 1}`,
  faction: 'azure',
  color: '#35d6e6',
}));
const NEXUS = mapPreset('nexus').starts;
const SPEEDS = [1, 2, 5, 10, 50, 100];

function stubPage(): void {
  page = new Map();
  cell = new Map();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => cell.get(k) ?? null,
    setItem: (k: string, v: string) => void cell.set(k, v),
    removeItem: (k: string) => void cell.delete(k),
  });
  vi.stubGlobal('document', { getElementById: el });
  vi.stubGlobal('location', { pathname: '/', href: '' });
  vi.stubGlobal('__PLAYER_BUILD__', false);
  el('setupspeed').kids = SPEEDS.map((spd) =>
    Object.assign(stub(), { dataset: { spd: `${spd}` } }),
  );
}

// Первая загрузка экрана тянет игру, дерево технологий и песочницу — секунды. Граф греется
// один раз; тесты после `vi.resetModules()` загружают его заново из кеша трансформаций.
beforeAll(async () => {
  stubPage();
  await import('./setupScreen');
  vi.unstubAllGlobals();
}, 60_000);
beforeEach(stubPage);
afterEach(() => {
  vi.unstubAllGlobals();
});

/** Свежая загрузка экрана и игры-заглушки, которая записывает, что от неё просили. */
async function boot(net = false) {
  vi.resetModules();
  const screen = await import('./setupScreen');
  const env = {
    net,
    nick: 'Орион',
    halts: 0,
    polls: 0,
    hubs: 0,
    connect: [] as boolean[],
    started: [] as SetupConfig[],
  };
  screen.initSetupScreen({
    seats: SEATS,
    nick: () => env.nick,
    meta: () => parseMetaState(null),
    net: () => env.net,
    halt: () => void env.halts++,
    stopNetPoll: () => void env.polls++,
    showConnect: (show) => void env.connect.push(show),
    openHub: () => void env.hubs++,
    startMatch: (setup) => void env.started.push(setup),
  });
  return { screen, env };
}

describe('REFM-212 — заход на экран', () => {
  it('каждый заход — свежая одиночная схватка: места, команды и мир заново, часы стоят', async () => {
    const { screen, env } = await boot();
    screen.openSetup('hub');
    expect([env.halts, env.polls, env.connect]).toEqual([1, 1, [false]]);
    expect(screen.setupEl.style.display).toBe('flex');
    // Совет учёных посвящают первым: окно открыто, строка совета нарисована.
    expect(screen.sciWin.classList.contains('show')).toBe(true);
    expect(el('setupcouncil').innerHTML).not.toBe('');
    expect(screen.netSetup).toBeNull();
    expect(screen.setupSlots).toEqual(['human', 'ai', ...Array(8).fill('off')]);
    expect(screen.setupSpeed).toBe(10);

    // Игрок всё поменял…
    tap('setupslots', { 'data-slot': '2' });
    tap('setupslots', { 'data-teamtog': '1' });
    tap('setupmap', { 'data-cand': NEXUS[3]! });
    expect(screen.setupSlots[2]).toBe('ai');
    // …и вернулся на экран: всё сначала.
    screen.openSetup('hub');
    expect(screen.setupSlots).toEqual(['human', 'ai', ...Array(8).fill('off')]);
    el('setupgo').click();
    const seats = env.started[0]!.seats;
    expect(seats.map((s) => [s.id, s.start])).toEqual([
      ['p1', NEXUS[0]],
      ['p2', NEXUS[1]],
    ]);
    expect(seats.some((s) => 'team' in s)).toBe(false);
  });

  it('темп открывается последним выбранным, а чужое число — дефолтом ×10', async () => {
    const { screen } = await boot();
    screen.openSetup();
    tap('setupspeed', { 'data-spd': '50' });
    expect(cell.get('void.setupSpeed')).toBe('50');
    screen.openSetup();
    expect(screen.setupSpeed).toBe(50);
    cell.set('void.setupSpeed', '7');
    screen.openSetup();
    expect(screen.setupSpeed).toBe(10);
  });

  it('в сетевой партии заход часы не трогает: их ведёт сервер', async () => {
    const { screen, env } = await boot(true);
    screen.openSetup('hub');
    expect(env.halts).toBe(0);
  });
});

describe('REFM-212 — что уезжает в матч', () => {
  it('ты своим домом на своём мире, боты — следом; совет, позывной героя и прокачка', async () => {
    const { screen, env } = await boot();
    screen.openSetup();
    tap('setupfactions', { 'data-fpick': 'crimson' });
    tap('setupmap', { 'data-cand': NEXUS[2]! });
    tap('setupslots', { 'data-slot': '2' }); // выкл → слабый
    tap('setupslots', { 'data-slot': '1' }); // слабый → сильный
    el('setupgo').click();
    const setup = env.started[0]!;
    expect(setup.mapId).toBe('nexus');
    expect(setup.seats.map((s) => [s.id, s.start, s.ai])).toEqual([
      ['p1', NEXUS[2], false],
      ['p2', NEXUS[0], true],
      ['p3', NEXUS[1], true],
    ]);
    expect(setup.seats[0]!.faction).toBe('crimson');
    expect(setup.seats[1]!.faction).not.toBe('crimson');
    expect(screen.setupSlots.slice(0, 3)).toEqual(['human', 'ai-strong', 'ai']);
    expect(setup.scientists).toEqual(['overseer', 'polymath']);
    expect(setup.heroes!.find((h) => h.grade === 'main')!.name).toBe('Орион');
    expect(setup.meta).toEqual(metaGrant(parseMetaState(null)));
  });

  it('пустой позывной — герой со своим именем; дом — только из играбельных', async () => {
    const { screen, env } = await boot();
    screen.openSetup();
    env.nick = '  ';
    tap('setupfactions', { 'data-fpick': 'swarm' }); // Рой не дом — выбор не меняется
    const setup = screen.buildSetupConfig();
    expect(setup.heroes!.find((h) => h.grade === 'main')!.name).toBe(tData('hero.arch.commander'));
    expect(setup.seats[0]!.faction).toBe('azure');
  });

  it('команды уезжают только включёнными, и ты всегда на стороне A', async () => {
    const { screen } = await boot();
    screen.openSetup();
    tap('setupslots', { 'data-teamtog': '1' });
    tap('setupslots', { 'data-teamseat': '0' }); // своё место не переключается
    tap('setupslots', { 'data-teamseat': '1' });
    expect(screen.buildSetupConfig().seats.map((s) => s.team)).toEqual(['A', 'B']);
  });

  it('смена карты — свежие места и мир новой карты; карту не из списка экран не берёт', async () => {
    const { screen } = await boot();
    screen.openSetup();
    tap('setupslots', { 'data-teamtog': '1' });
    pick('setup-map-id', 'frontier-50');
    expect(screen.setupMapId).toBe('frontier-50');
    expect(screen.setupSlots.slice(0, 3)).toEqual(['human', 'ai', 'ai']);
    pick('setup-map-id', 'frontier-100');
    expect(screen.setupMapId).toBe('frontier-50');
    pick('setup-map-id', 'nexus');
    tap('setupmap', { 'data-cand': 'C9R1' });
    pick('setup-home-id', 'nowhere'); // не кандидат — мир остаётся
    const seats = screen.buildSetupConfig().seats;
    expect(seats.map((s) => [s.start, s.team])).toEqual([
      [NEXUS[9], undefined],
      [NEXUS[0], undefined],
    ]);
  });

  it('занятый слот сохранения спрашивает о замене, а не стартует; песочница стартует сразу', async () => {
    cell.set(SOLO_SAVE_KEY, '{"v":1}');
    const { screen, env } = await boot();
    screen.openSetup();
    el('setupgo').click();
    expect(env.started).toHaveLength(0);
    expect(el('solo-replace').style.display).toBe('flex');
    el('setupsandbox').checked = true;
    el('setupgo').click();
    expect(env.started).toHaveLength(1);
  });

  it('«Назад» уводит туда, откуда пришли', async () => {
    const { screen, env } = await boot();
    screen.openSetup('hub');
    el('setupcancel').click();
    expect([screen.setupEl.style.display, env.hubs, env.connect]).toEqual(['none', 1, [false]]);
    screen.openSetup('welcome');
    el('setupcancel').click();
    expect([env.hubs, env.connect.at(-1)]).toEqual([1, true]);
  });
});

describe('REFM-212 — двери гида и сети', () => {
  const seat = (playerId: string, start: string, taken: boolean): MatchSeat => ({
    playerId,
    faction: 'azure',
    start,
    taken,
  });

  it('гид получает «Нексус» без соперников на предсказуемом мире', async () => {
    const { screen } = await boot();
    screen.openSetup();
    pick('setup-map-id', 'frontier-50');
    tap('setupfactions', { 'data-fpick': 'amber' });
    screen.prepareGuidedSetup();
    expect(screen.setupMapId).toBe('nexus');
    const setup = screen.buildSetupConfig();
    expect(setup.seats.map((s) => [s.id, s.start, s.faction])).toEqual([['p1', NEXUS[0], 'amber']]);
  });

  it('сетевой вход: карта и места от сервера, вход заперт до свободного мира', async () => {
    const { screen, env } = await boot();
    screen.openSetup('hub');
    // Мир, который одиночный заход выбрал сам (`NEXUS[0]`), свободен — но выбора за игрока
    // сетевой вход не делает: кнопка заперта, пока он не ткнёт в мир сам.
    screen.enterNetSetup(
      'm1',
      'nexus',
      entryOffer([seat('p1', NEXUS[0]!, false), seat('p2', NEXUS[1]!, true)]),
    );
    expect(screen.netSetup?.matchId).toBe('m1');
    expect([el('setupgo').disabled, el('setup-map-id').disabled]).toEqual([true, true]);
    expect(el('setup-solo-col').style.display).toBe('none');
    expect(el('setuphint').textContent).toBe(t('setup.map-hint'));
    // Карту сетевой партии выбрал сервер — список её не меняет.
    pick('setup-map-id', 'frontier-50');
    expect(screen.setupMapId).toBe('nexus');
    // Занятый мир виден, но не выбирается — и об этом говорят.
    tap('setupmap', { 'data-cand': NEXUS[1]! });
    expect([el('setupgo').disabled, el('setuphint').textContent]).toEqual([
      true,
      t('seatpick.lost'),
    ]);
    tap('setupmap', { 'data-cand': NEXUS[0]! });
    expect([el('setupgo').disabled, el('setupgo').textContent]).toEqual([false, t('seatpick.go')]);
    // Вход — адресом с выбранным креслом, а не локальным стартом.
    el('setupgo').click();
    expect(env.started).toHaveLength(0);
    expect(location.href).toBe(joinHref('/', 'm1', 'p1', 'azure', ['overseer', 'polymath']));
  });

  it('опрос: занятый выбранный мир сбрасывает выбор; опоздавший ответ отбрасывается', async () => {
    const { screen } = await boot();
    screen.openSetup('hub');
    screen.enterNetSetup('m1', 'nexus', entryOffer([seat('p2', NEXUS[1]!, false)]));
    tap('setupmap', { 'data-cand': NEXUS[1]! });
    screen.updateNetOffer(
      'm1',
      entryOffer([seat('p2', NEXUS[1]!, false), seat('p3', NEXUS[2]!, false)]),
    );
    expect(el('setupgo').disabled).toBe(false); // мир на месте — выбор держим
    screen.updateNetOffer('m1', entryOffer([seat('p2', NEXUS[1]!, true)]));
    expect([el('setupgo').disabled, el('setuphint').textContent]).toEqual([
      true,
      t('seatpick.lost'),
    ]);
    // Выбор сброшен, а не отложен: мир освободился — но игрок снова выбирает сам.
    screen.updateNetOffer('m1', entryOffer([seat('p2', NEXUS[1]!, false)]));
    expect(el('setupgo').disabled).toBe(true);
    // Игрок ушёл в одиночную схватку — ответ прежнего опроса её не трогает.
    screen.openSetup('hub');
    screen.updateNetOffer('m1', entryOffer([seat('p2', NEXUS[1]!, false)]));
    expect(screen.netSetup).toBeNull();
  });
});

describe('REFM-212 — стык с main.ts: двери вместо присвоений', () => {
  const MAIN = readFileSync(new URL('./main.ts', import.meta.url), 'utf8');
  const body = (name: string): string =>
    new RegExp(`function ${name}\\([^)]*\\)[^{]*\\{([\\s\\S]*?)\\n\\}`).exec(MAIN)?.[1] ?? '';

  it('гид готовит партию дверью экрана до старта', () => {
    const guided = body('startGuidedMatch');
    const door = guided.indexOf('prepareGuidedSetup();');
    expect(door).toBeGreaterThan(-1);
    expect(guided.indexOf('startMatch(buildSetupConfig(), false);')).toBeGreaterThan(door);
  });

  it('сетевой вход открывает экран, затем ставит сетевой режим; опрос отдаёт места владельцу', () => {
    expect(body('openSeatPicker')).toMatch(
      /openSetup\('hub'\);[^\n]*\n\s+enterNetSetup\(matchId, body\.mapId, offer\);/,
    );
    expect(body('startNetSetupPoll')).toContain(
      'updateNetOffer(matchId, entryOffer(body.seats ?? []));',
    );
  });

  it('хуки экрана — часы, сеть, опрос и старт игры', () => {
    expect(MAIN).toMatch(/halt: \(\) => \{\s+speed = 0;\s+\},/);
    expect(MAIN).toContain('net: () => NET,');
    expect(MAIN).toContain('stopNetPoll: () => stopNetSetupPoll(),');
    expect(MAIN).toContain('startMatch: (setup) => startMatch(setup),');
  });
});
