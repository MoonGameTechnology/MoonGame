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
  querySelector(sel: string): El | null;
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
    querySelector: () => null,
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
/** Выбор карты — сегментом в ряду `#setupmaps`. */
const pickMap = (id: string): void => tap('setupmaps', { 'data-map': id });
const YOU = '#3ad17a';
const RIVAL = '#ff5a4d';

const SEATS = Array.from({ length: 100 }, (_, i) => ({
  id: `p${i + 1}`,
  name: `House ${i + 1}`,
  faction: 'azure',
  color: '#35d6e6',
}));
const NEXUS = mapPreset('nexus').starts;
const DUEL = mapPreset('duel-1').starts;
const FFA = mapPreset('ffa-4').starts;
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
    mapLabel: (id) => `map:${id}`,
    sideColors: () => ({ you: YOU, rival: RIVAL }),
  });
  return { screen, env };
}

describe('REFM-212 — заход на экран', () => {
  it('каждый заход — свежая одиночная схватка: места, команды и мир заново, часы стоят', async () => {
    const { screen, env } = await boot();
    screen.openSetup('hub');
    expect([env.halts, env.polls, env.connect]).toEqual([1, 1, [false]]);
    expect(screen.setupEl.style.display).toBe('flex');
    // Окно совета не всплывает первым (UIX-16.1): рекомендованная пара видна строкой, и
    // окно открывается с неё.
    expect(screen.sciWin.classList.contains('show')).toBe(false);
    expect(el('setupcouncil').innerHTML).toContain('data-council');
    el('setupcouncil').click();
    expect(screen.sciWin.classList.contains('show')).toBe(true);
    expect(screen.netSetup).toBeNull();
    expect(screen.setupSlots).toEqual(['human', 'ai']);
    expect(screen.setupSpeed).toBe(10);

    // Игрок всё поменял…
    tap('setupslots', { 'data-slot': '2' });
    tap('setupslots', { 'data-teamtog': '1' });
    tap('setupmap', { 'data-cand': NEXUS[3]! });
    expect(screen.setupSlots).toEqual(['human', 'ai']);
    // …и вернулся на экран: всё сначала.
    screen.openSetup('hub');
    expect(screen.setupSlots).toEqual(['human', 'ai']);
    el('setupgo').click();
    const seats = env.started[0]!.seats;
    expect(seats.map((s) => [s.id, s.start])).toEqual([
      ['p1', DUEL[0]],
      ['p2', DUEL[1]],
    ]);
    expect(seats.map((s) => s.team)).toEqual(['A', 'B']);
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
    pickMap('ffa-4');
    tap('setupfactions', { 'data-fpick': 'crimson' });
    tap('setupmap', { 'data-cand': FFA[2]! });
    tap('setupslots', { 'data-slot': '2' }); // выкл → слабый
    tap('setupslots', { 'data-slot': '1' }); // слабый → сильный
    el('setupgo').click();
    const setup = env.started[0]!;
    expect(setup.mapId).toBe('ffa-4');
    expect(setup.seats.map((s) => [s.id, s.start, s.ai])).toEqual([
      ['p1', FFA[2], false],
      ['p2', FFA[0], true],
      ['p3', FFA[1], true],
      ['p4', FFA[3], true],
    ]);
    expect(setup.seats[0]!.faction).toBe('crimson');
    expect(setup.seats[1]!.faction).not.toBe('crimson');
    expect(screen.setupSlots.slice(0, 3)).toEqual(['human', 'ai-strong', 'ai-strong']);
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

  it('смена карты даёт ровно четыре места FFA; скрытые карты и команды недоступны', async () => {
    const { screen } = await boot();
    screen.openSetup();
    pickMap('ffa-4');
    expect(screen.setupMapId).toBe('ffa-4');
    expect(screen.setupSlots).toEqual(['human', 'ai', 'ai', 'ai']);
    expect(el('setupslots').innerHTML).not.toContain('data-teamtog');
    tap('setupslots', { 'data-teamtog': '1' });
    tap('setupslots', { 'data-teamseat': '1' });
    for (const hidden of ['frontier-100', 'frontier-50', 'nexus', 'missing']) {
      pickMap(hidden);
      expect(screen.setupMapId).toBe('ffa-4');
    }
    tap('setupmap', { 'data-cand': FFA[3]! });
    tap('setupmap', { 'data-cand': 'nowhere' }); // не старт этой карты — выбор не меняется
    const seats = screen.buildSetupConfig().seats;
    expect(seats.map((s) => s.start)).toEqual([FFA[3], ...FFA.slice(0, 3)]);
    expect(seats.every((s) => s.team === undefined)).toBe(true);
    tap('setupslots', { 'data-slot': '1' });
    tap('setupslots', { 'data-slot': '1' });
    expect(screen.setupSlots[1]).toBe('ai'); // Difficulty cycles without removing a player.
    pickMap('duel-1');
    expect(screen.buildSetupConfig().seats).toHaveLength(2);
  });

  it('2v2 shows fixed sides and follows the chosen starting world', async () => {
    const { screen } = await boot();
    screen.openSetup();
    pickMap('team-2v2');
    expect(screen.buildSetupConfig().seats.map((s) => s.team)).toEqual(['A', 'A', 'B', 'B']);
    expect(el('setupslots').innerHTML).toContain('data-teamseat');
    tap('setupmap', { 'data-cand': 'home_3' });
    expect(screen.buildSetupConfig().seats.map((s) => [s.start, s.team])).toEqual([
      ['home_3', 'B'], ['home_1', 'A'], ['home_2', 'A'], ['home_4', 'B'],
    ]);
    tap('setupslots', { 'data-teamseat': '1' });
    expect(screen.buildSetupConfig().seats[1]!.team).toBe('A');
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

  it('«Назад» с сетевого экрана гасит опрос мест', async () => {
    const { screen, env } = await boot();
    screen.openSetup('hub');
    screen.enterNetSetup('m1', 'nexus', entryOffer([]));
    const before = env.polls;
    el('setupcancel').click();
    expect(env.polls).toBe(before + 1);
  });
});

describe('REFM-212 — двери гида и сети', () => {
  const seat = (playerId: string, start: string, taken: boolean): MatchSeat => ({
    playerId,
    faction: 'azure',
    start,
    taken,
  });

  it('гид получает дуэльную карту без соперников на предсказуемом мире', async () => {
    const { screen } = await boot();
    screen.openSetup();
    pickMap('frontier-50');
    tap('setupfactions', { 'data-fpick': 'amber' });
    screen.prepareGuidedSetup();
    expect(screen.setupMapId).toBe('duel-1');
    const setup = screen.buildSetupConfig();
    expect(setup.seats.map((s) => [s.id, s.start, s.faction])).toEqual([['p1', DUEL[0], 'amber']]);
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
    expect(el('setupgo').disabled).toBe(true);
    // Класс `net` прячет выбор карты, ботов и темп и показывает шапку партии.
    expect(screen.setupEl.classList.contains('net')).toBe(true);
    expect(el('setup-sub').innerHTML).toContain('map:nexus');
    expect(el('setup-sub').innerHTML).toContain('m1');
    expect(el('setup-sub').innerHTML).toContain(t('setup.net.free', { n: 1, m: 2 }));
    expect(el('setuphint').textContent).toBe(t('setup.map-hint'));
    // Карту сетевой партии выбрал сервер — сегменты её не меняют.
    pickMap('frontier-50');
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

describe('UIX-16.1 — карта стартов', () => {
  const seat = (playerId: string, start: string, taken: boolean): MatchSeat => ({
    playerId,
    faction: 'azure',
    start,
    taken,
  });
  /** Кружок старта `id` на мини-карте: класс и цвет. */
  const circle = (id: string): string =>
    new RegExp(`<g class="cand [^"]*" data-cand="${id}"[^>]*>`).exec(
      el('setupmap').innerHTML,
    )?.[0] ?? '';

  it('твой старт — твоим цветом, остальные светятся; занятых в одиночной нет', async () => {
    const { screen } = await boot();
    screen.openSetup();
    expect(circle(DUEL[0]!)).toContain('class="cand you"');
    expect(circle(DUEL[0]!)).toContain(`--c:${YOU}`);
    expect(circle(DUEL[1]!)).toContain('class="cand free"');
    expect(el('setuplegend').innerHTML).toContain(t('setup.legend.you'));
    expect(el('setuplegend').innerHTML).not.toContain(t('setup.legend.taken'));
    expect(screen.setupEl.classList.contains('net')).toBe(false);
    // Карты — сегментами, выбранная отмечена.
    expect(el('setupmaps').innerHTML).toContain('data-map="duel-1" aria-pressed="true"');
    expect(el('setupmaps').innerHTML).toContain('data-map="ffa-4" aria-pressed="false"');
  });

  it('сетевая партия: занятый мир — цветом соперника и с пометкой, в легенде «Занято»', async () => {
    const { screen } = await boot();
    screen.openSetup('hub');
    screen.enterNetSetup(
      'm1',
      'duel-1',
      entryOffer([seat('p1', DUEL[0]!, true), seat('p2', DUEL[1]!, false)]),
    );
    expect(circle(DUEL[0]!)).toContain('class="cand taken"');
    expect(circle(DUEL[0]!)).toContain(`--c:${RIVAL}`);
    expect(circle(DUEL[0]!)).toContain('aria-disabled="true"');
    expect(circle(DUEL[1]!)).toContain('class="cand free"');
    expect(el('setuplegend').innerHTML).toContain(t('setup.legend.taken'));
    // Своего старта ещё нет — легенда о нём не говорит.
    expect(el('setuplegend').innerHTML).not.toContain(t('setup.legend.you'));
    tap('setupmap', { 'data-cand': DUEL[1]! });
    expect(circle(DUEL[1]!)).toContain('class="cand you"');
    expect(el('setuplegend').innerHTML).toContain(t('setup.legend.you'));
    expect(el('setupgo').textContent).toBe(t('seatpick.go'));
  });

  it('клавиатура: Enter и пробел на кружке выбирают старт, другие клавиши — нет', async () => {
    vi.stubGlobal('CSS', { escape: (v: string) => v });
    const { screen } = await boot();
    screen.openSetup();
    pickMap('ffa-4');
    let prevented = 0;
    const press = (key: string, id: string): void =>
      el('setupmap').fire('keydown', {
        key,
        target: hit({ 'data-cand': id }),
        preventDefault: () => void prevented++,
      });
    press('Tab', FFA[2]!);
    expect(screen.buildSetupConfig().seats[0]!.start).toBe(FFA[0]);
    press('Enter', FFA[2]!);
    expect(screen.buildSetupConfig().seats[0]!.start).toBe(FFA[2]);
    press(' ', FFA[3]!);
    expect(screen.buildSetupConfig().seats[0]!.start).toBe(FFA[3]);
    expect(prevented).toBe(2);
  });

  it('«Закрыть» в окне совета возвращает на экран, а не уводит из него', async () => {
    const { screen, env } = await boot();
    screen.openSetup('hub');
    el('setupcouncil').click();
    expect(screen.sciWin.classList.contains('show')).toBe(true);
    el('scipick').fire('click', {
      target: { closest: (sel: string) => (sel === '.sp-cancel' ? {} : null) },
    });
    expect(screen.sciWin.classList.contains('show')).toBe(false);
    expect([screen.setupEl.style.display, env.hubs]).toEqual(['flex', 0]);
  });
});

describe('REFM-212 — стык с main.ts: двери вместо присвоений', () => {
  const MAIN = readFileSync(new URL('./main.ts', import.meta.url), 'utf8');
  // Сетевой вход и опрос мест живут у входа в партию (`matchJoin.ts`, REFM-217).
  const JOIN = readFileSync(new URL('./matchJoin.ts', import.meta.url), 'utf8');
  const body = (name: string, src = MAIN): string =>
    new RegExp(`function ${name}\\([^)]*\\)[^{]*\\{([\\s\\S]*?)\\n\\}`).exec(src)?.[1] ?? '';

  it('гид готовит партию дверью экрана до старта', () => {
    const guided = body('startGuidedMatch');
    const door = guided.indexOf('prepareGuidedSetup();');
    expect(door).toBeGreaterThan(-1);
    expect(guided.indexOf('startMatch(buildSetupConfig(), false);')).toBeGreaterThan(door);
  });

  it('сетевой вход открывает экран, затем ставит сетевой режим; опрос отдаёт места владельцу', () => {
    expect(body('openSeatPicker', JOIN)).toMatch(
      /openSetup\('hub'\);[^\n]*\n\s+enterNetSetup\(matchId, body\.mapId, offer\);/,
    );
    expect(body('startNetSetupPoll', JOIN)).toContain(
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
