/**
 * Реакция на события мира и лента (REFM-230) — прямой тест владельца.
 *
 * Журнал, счёт войны и память боёв меняют только функции модуля, поэтому здесь проверено то,
 * что текстом не проверить: строка ленты несёт игровую метку и глушит повтор по реальному
 * времени, тост живёт, вытесняется и переносит камеру, бой пишет начало, ведомость потерь и
 * итог по тем же правилам видимости, что сеть, захват мигает и пишет память разведки только
 * по видимости, а смена матча забывает старый. Двери игры (залпы, вспышки, пульс союзника,
 * выбор после деления, окна, рассказы о вахте, герое и стройке) получают ровно то, что просило
 * событие. Каждый тест — свежая загрузка модулей над своим миром: у ленты и тумана своё
 * состояние. В конце — стык с `main.ts`.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';

import { t, tData } from '../../localization/runtime';
import {
  createInitialState,
  type DomainEvent,
  type Fleet,
  type GameState,
  type Planet,
  type Player,
} from '../../packages/shared-core/src/index';
import type { FleetGeometryHost } from './fleetGeometry';
import type { FlakShot } from './eventFeed';

// Первая загрузка ленты тянет ядро, данные и окна — секунды под нагрузкой полного гейта. Граф
// греется один раз; тесты после `vi.resetModules()` берут его из кеша трансформаций.
beforeAll(async () => {
  vi.stubGlobal('__PLAYER_BUILD__', false);
  await import('./eventFeed');
  vi.unstubAllGlobals();
}, 60_000);
beforeEach(() => {
  vi.stubGlobal('__PLAYER_BUILD__', false);
  // Страница без стопки тостов: тост молчит, лента пишет. Стопку ставит {@link stubToasts}.
  vi.stubGlobal('document', { getElementById: () => null });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

type XY = { x: number; y: number };

const planet = (id: string, x: number, owner: string | null): Planet => ({
  id,
  owner,
  kind: 'planet',
  position: { x, y: 0 },
  resources: {},
  buildings: [],
  garrison: [],
  traits: [],
  links: [],
});

const player = (id: string): Player =>
  ({ id, name: id, faction: 'azure', status: 'active', resources: {} }) as Player;

const fleet = (id: string, owner: string, location: string): Fleet =>
  ({
    id,
    owner,
    location,
    movement: null,
    units: [{ unit: 'frigate', count: 1 }],
    traits: [],
    battleId: null,
  }) as unknown as Fleet;

/** Я — p1 на A. N рядом с A (опознан, чужой), M и E — за туманом. */
function world(): GameState {
  const st = createInitialState({ seed: 'feed', version: { data: '0.1.0', manifest: '1' } });
  return {
    ...st,
    time: 3 * 3_600_000,
    planets: {
      A: planet('A', 0, 'p1'),
      N: planet('N', 60, 'p2'),
      M: planet('M', 150, null),
      E: planet('E', 10_000, 'p3'),
    },
    players: { p1: player('p1'), p2: player('p2'), p3: player('p3') },
    fleets: { F1: fleet('F1', 'p1', 'A') },
  };
}

const ev = (type: string, payload: Record<string, unknown>): DomainEvent =>
  ({ type, payload }) as unknown as DomainEvent;

/** Свежая загрузка ленты над игрой-заглушкой, которая записывает, что от неё просили. */
async function boot(opts: { fog?: boolean } = {}) {
  vi.resetModules();
  const env = {
    s: world(),
    clock: 1_000_000,
    names: { p1: 'Орион', p2: 'Багровые', p3: 'Вега' } as Record<string, string>,
    splitAwait: null as string | null,
    selections: [] as string[][],
    techOpen: false,
    techRepaints: 0,
    tells: [] as unknown[],
    ended: [] as Array<[string, string]>,
    shots: [] as FlakShot[],
    captures: [] as Array<[string, string]>,
    mines: [] as Array<[string, XY | undefined]>,
    notices: [] as Array<XY | null | undefined>,
    pulses: 0,
    jumps: [] as string[],
  };
  vi.spyOn(Date, 'now').mockImplementation(() => env.clock);
  vi.doMock('./mapCamera', async (orig) => ({
    ...(await orig<typeof import('./mapCamera')>()),
    jumpToPing: (id: string) => void env.jumps.push(id),
  }));
  const fog = await import('./mapFog');
  fog.initMapFog({
    world: () => env.s,
    me: () => 'p1',
    net: () => false,
    contacts: () => [],
    sight: () => [],
  });
  if (opts.fog !== false) fog.refreshVision();
  const geometry = await import('./fleetGeometry');
  geometry.initFleetGeometry({
    world: () => env.s,
    me: () => 'p1',
    now: () => env.s.time,
  } as unknown as FleetGeometryHost);
  const feed = await import('./eventFeed');
  feed.initEventFeed({
    world: () => env.s,
    me: () => 'p1',
    names: () => env.names,
    placeName: (id) => `«${id}»`,
    fleetTitleOf: (id) => `Флот ${id}`,
    setFleetSelection: (ids) => void env.selections.push(ids),
    splitAwait: () => env.splitAwait,
    endSplitAwait: () => {
      env.splitAwait = null;
    },
    techTree: () => ({ isOpen: () => env.techOpen, repaint: () => void env.techRepaints++ }),
    tellSteward: (kind, p) => void env.tells.push(['steward', kind, p.playerId]),
    tellHero: (news) => void env.tells.push(['hero', news]),
    tellBuild: (kind, p) => void env.tells.push(['build', kind, p.planetId]),
    battleWindow: () => ({ ended: (id, text) => void env.ended.push([id, text]) }),
    shot: (shot) => void env.shots.push(shot),
    captureFlash: (node, owner) => void env.captures.push([node, owner]),
    mineFlash: (node, position) => void env.mines.push([node, position]),
    noticeFlash: (at) => void env.notices.push(at),
    pulseAlly: () => void env.pulses++,
  });
  const format = await import('./format');
  /** Тексты ленты без метки времени. */
  const lines = () => feed.logLines.map((l) => l.split(' · ').slice(1).join(' · '));
  return { feed, fog, env, format, lines };
}

interface FakeNode {
  className: string;
  textContent: string;
  classes: Set<string>;
  classList: { add(c: string): void };
  addEventListener(type: string, fn: () => void): void;
  click(): void;
  remove(): void;
}

/** Стопка тостов на странице: дети по порядку, первым — предупреждение о сохранении. */
function stubToasts() {
  const kids: FakeNode[] = [];
  const node = (className = ''): FakeNode => {
    const on: Array<() => void> = [];
    const n: FakeNode = {
      className,
      textContent: '',
      classes: new Set(),
      classList: { add: (c) => void n.classes.add(c) },
      addEventListener: (_type, fn) => void on.push(fn),
      click: () => on.forEach((fn) => fn()),
      remove: () => {
        const i = kids.indexOf(n);
        if (i >= 0) kids.splice(i, 1);
      },
    };
    return n;
  };
  const isToast = (n: FakeNode) => n.className.split(' ').includes('toast');
  const host = {
    appendChild: (n: FakeNode) => void kids.push(n),
    querySelectorAll: () => kids.filter(isToast),
    querySelector: () => kids.find(isToast) ?? null,
  };
  const warning = node('save-warning');
  kids.push(warning);
  vi.stubGlobal('document', {
    getElementById: (id: string) => (id === 'toasts' ? host : null),
    createElement: () => node(),
  });
  vi.useFakeTimers({ toFake: ['setTimeout'] });
  vi.stubGlobal('window', { setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms) });
  return { kids, warning, toasts: () => kids.filter(isToast) };
}

describe('REFM-230 — строка ленты', () => {
  it('пишет игровую метку в журнал и событие — в сводку возвращения', async () => {
    const { feed, env, format } = await boot();
    feed.note('взрыв', 'A');
    expect(feed.logLines).toEqual([`${format.gameStamp(env.s.time)} · взрыв`]);
    expect(feed.eventLog).toEqual([{ at: env.s.time, text: 'взрыв', anchor: 'A' }]);
  });

  it('повтор глушится две секунды РЕАЛЬНОГО времени, другая строка — нет', async () => {
    const { feed, env, lines } = await boot();
    feed.note('a');
    env.clock += 1999;
    feed.note('a');
    feed.note('b');
    env.clock += 1;
    feed.note('b');
    env.clock += 2000;
    feed.note('b');
    expect(lines()).toEqual(['a', 'b', 'b']);
  });

  it('журнал держит последние строки, сводка — свой предел', async () => {
    const { feed } = await boot();
    const log = await import('./noteLog');
    const total = log.EVENT_LOG_MAX + 5;
    for (let i = 0; i < total; i++) feed.note(`n${i}`);
    expect(feed.logLines).toHaveLength(log.LOG_LINES);
    expect(feed.logLines.at(-1)).toMatch(/ · n84$/);
    expect(feed.eventLog).toHaveLength(log.EVENT_LOG_MAX);
    expect(feed.eventLog[0]!.text).toBe('n5');
  });
});

describe('REFM-230 — тост', () => {
  it('с якорем зовёт перейти и по нажатию переносит камеру; без якоря — только закрывается', async () => {
    const page = stubToasts();
    const { feed, env } = await boot();
    feed.note('бой', 'A');
    feed.note('сделка');
    const [anchored, plain] = page.toasts();
    expect([anchored!.className, anchored!.textContent]).toEqual(['toast jump', 'бой ↪']);
    expect([plain!.className, plain!.textContent]).toEqual(['toast', 'сделка']);
    anchored!.click();
    plain!.click();
    expect(env.jumps).toEqual(['A']);
    expect(page.toasts()).toEqual([]);
  });

  it('стопка держит три тоста: старший уходит, предупреждение о сохранении остаётся', async () => {
    const page = stubToasts();
    const { feed } = await boot();
    for (const m of ['1', '2', '3', '4']) feed.note(m);
    expect(page.toasts().map((n) => n.textContent)).toEqual(['2', '3', '4']);
    expect(page.kids[0]).toBe(page.warning);
  });

  it('тост гаснет по сроку жизни и уходит после затухания', async () => {
    const page = stubToasts();
    const { feed } = await boot();
    const view = await import('./toastView');
    feed.note('миг');
    const [toast] = page.toasts();
    vi.advanceTimersByTime(view.TOAST_LIFE_MS - 1);
    expect(toast!.classes.has('out')).toBe(false);
    vi.advanceTimersByTime(1);
    expect(toast!.classes.has('out')).toBe(true);
    expect(page.toasts()).toHaveLength(1);
    vi.advanceTimersByTime(view.TOAST_FADE_MS);
    expect(page.toasts()).toEqual([]);
  });
});

describe('REFM-230 — бои', () => {
  const start = (id: string, at: string, attacker: string, defender: string) =>
    ev('battle.started', { battleId: id, location: at, attacker, defender, phase: 'orbit' });
  const died = (id: string, at: string, owner: string, count: number) =>
    ev('unit.died', { battleId: id, at, owner, unit: 'frigate', count });
  const resolved = (id: string, at: string, winner?: string) =>
    ev('battle.resolved', { battleId: id, location: at, winner });
  const startText = (at: string) =>
    t('log.battle.start', { at: `«${at}»`, phase: t('log.battle.phase.orbit') });
  const endText = (at: string, who: string, tally: string) =>
    t('log.battle.end', { at: `«${at}»`, res: t('log.battle.win', { who }) }) +
    (tally ? t('log.battle.losses', { tally }) : '');

  it('свой бой: начало, итог с потерями по игроку, счёт войны и окно боя', async () => {
    const { feed, env, lines } = await boot();
    feed.handleEvents([
      start('b1', 'A', 'p2', 'p1'),
      died('b1', 'A', 'p2', 3),
      died('b1', 'A', 'p1', 1),
      resolved('b1', 'A', 'p1'),
    ]);
    const end = endText('A', 'Орион', 'Багровые −3, Орион −1');
    expect(lines()).toEqual([startText('A'), end]);
    expect(feed.eventLog.map((e) => e.anchor)).toEqual(['A', 'A']);
    expect(feed.killStats).toEqual({ destroyed: 3, lost: 1 });
    expect(env.ended).toEqual([['b1', end]]);
    // Ведомость закрыта итогом: следующий бой на том же узле начинает с нуля.
    env.clock += 5000;
    feed.handleEvents([start('b2', 'A', 'p2', 'p1'), resolved('b2', 'A', 'p1')]);
    expect(lines().at(-1)).toBe(endText('A', 'Орион', ''));
  });

  it('свой бой, ушедший в туман, доводит до ленты и итог, и счёт', async () => {
    const { feed, lines } = await boot();
    feed.handleEvents([start('b1', 'E', 'p1', 'p3')]);
    feed.handleEvents([died('b1', 'E', 'p3', 2), resolved('b1', 'E', 'p1')]);
    expect(lines()).toEqual([startText('E'), endText('E', 'Орион', 'Вега −2')]);
    expect(feed.killStats).toEqual({ destroyed: 2, lost: 0 });
  });

  it('чужой бой на опознанном узле виден с ценой исхода, но в счёт войны не идёт', async () => {
    const { feed, lines } = await boot();
    feed.handleEvents([
      start('b1', 'N', 'p3', 'p2'),
      died('b1', 'N', 'p2', 4),
      resolved('b1', 'N', 'p3'),
    ]);
    expect(lines()).toEqual([startText('N'), endText('N', 'Вега', 'Багровые −4')]);
    expect(feed.killStats).toEqual({ destroyed: 0, lost: 0 });
  });

  it('чужой бой за туманом не пишет ничего; окно боя итог всё равно получает', async () => {
    const { feed, env } = await boot();
    feed.handleEvents([
      start('b1', 'E', 'p2', 'p3'),
      died('b1', 'E', 'p2', 4),
      resolved('b1', 'E', 'p3'),
    ]);
    expect(feed.logLines).toEqual([]);
    expect(feed.killStats).toEqual({ destroyed: 0, lost: 0 });
    expect(env.ended.map(([id]) => id)).toEqual(['b1']);
  });
});

describe('REFM-230 — смена матча', () => {
  it('забывает журнал, сводку, счёт войны и свои бои старого матча', async () => {
    const { feed, env, lines } = await boot();
    feed.handleEvents([
      ev('battle.started', { battleId: 'b1', location: 'E', attacker: 'p1', defender: 'p3' }),
      ev('unit.died', { battleId: 'b1', at: 'E', owner: 'p3', unit: 'frigate', count: 2 }),
      ev('battle.started', { battleId: 'b2', location: 'A', attacker: 'p2', defender: 'p1' }),
      ev('unit.died', { battleId: 'b2', at: 'A', owner: 'p2', unit: 'frigate', count: 1 }),
    ]);
    expect(feed.killStats.destroyed).toBe(3);
    feed.resetEventFeed();
    expect([feed.logLines, feed.eventLog, feed.killStats]).toEqual([
      [],
      [],
      { destroyed: 0, lost: 0 },
    ]);
    // `battle:0`… повторяются от матча к матчу: чужой бой нового матча за туманом — не мой.
    feed.handleEvents([
      ev('unit.died', { battleId: 'b1', at: 'E', owner: 'p3', unit: 'frigate', count: 1 }),
      ev('battle.resolved', { battleId: 'b1', location: 'E', winner: 'p3' }),
    ]);
    expect(feed.logLines).toEqual([]);
    expect(feed.killStats).toEqual({ destroyed: 0, lost: 0 });
    // Ведомость старого матча не приписывается к бою нового на том же узле.
    feed.handleEvents([ev('battle.resolved', { battleId: 'b2', location: 'A' })]);
    expect(lines()).toEqual([t('log.battle.end', { at: '«A»', res: t('log.battle.draw') })]);
    feed.resetEventFeed();
    // Защита от повторов мерит реальное время, а не матч.
    feed.note('x');
    feed.resetEventFeed();
    feed.note('x');
    env.clock += 2000;
    feed.note('x');
    expect(lines()).toEqual(['x']);
  });
});

describe('REFM-230 — захват', () => {
  const captured = (planetId: string, owner: string, from: string | null) =>
    ev('planet.captured', { planetId, owner, from });

  it('свой захват за туманом: строка с якорем, вспышка и память разведки', async () => {
    const { feed, fog, env, lines } = await boot();
    env.s = {
      ...env.s,
      planets: { ...env.s.planets, E: { ...env.s.planets.E!, owner: 'p1' } },
    };
    expect(fog.memory.has('E')).toBe(false);
    feed.handleEvents([captured('E', 'p1', 'p3')]);
    expect(lines()).toEqual([t('log.capture', { who: 'Орион', at: '«E»' })]);
    expect(feed.eventLog[0]!.anchor).toBe('E');
    expect(env.captures).toEqual([['E', 'p1']]);
    expect(fog.memory.get('E')?.owner).toBe('p1');
  });

  it('чужой захват на видимом мире мигает, но строки нет; за туманом — ничего', async () => {
    const { feed, fog, env } = await boot();
    feed.handleEvents([captured('N', 'p3', 'p2'), captured('M', 'p2', null)]);
    expect(feed.logLines).toEqual([]);
    expect(env.captures).toEqual([['N', 'p3']]);
    expect(fog.memory.has('M')).toBe(false);
  });

  it('потерю своего мира слышит тот, у кого его взяли', async () => {
    const { feed, lines } = await boot();
    feed.handleEvents([captured('A', 'p2', 'p1')]);
    expect(lines()).toEqual([t('log.capture', { who: 'Багровые', at: '«A»' })]);
  });
});

describe('REFM-230 — двери игры', () => {
  it('зенитка стреляет на карту только с опознанного мира', async () => {
    const { feed, env } = await boot();
    feed.handleEvents([
      ev('aa.fired', { planetId: 'N', fleetId: 'gone', tier: 'orbital' }),
      ev('aa.fired', { planetId: 'E', fleetId: 'gone', tier: 'close' }),
    ]);
    expect(env.shots).toHaveLength(1);
    const [shot] = env.shots;
    expect([shot!.from, shot!.tier]).toEqual([{ x: 60, y: 0 }, 'orbital']);
    expect(shot!.to).not.toEqual(shot!.from);
  });

  it('мины: жертве и хозяину поля — своя строка и вспышка, постороннему — ничего', async () => {
    const { feed, env, lines } = await boot();
    const pos = { x: 5, y: 5 };
    feed.handleEvents([
      ev('mines.triggered', { at: 'M', owner: 'p1', by: ['p2'], lost: 2, position: pos }),
      ev('mines.triggered', { at: 'N', owner: 'p2', by: ['p1'], lost: 3 }),
      ev('mines.triggered', { at: 'E', owner: 'p2', by: ['p3'], lost: 9 }),
    ]);
    expect(lines()).toEqual([t('log.mines.hit', { n: 2 }), t('log.mines.triggered', { n: 3 })]);
    expect(feed.eventLog.map((e) => e.anchor)).toEqual(['M', 'N']);
    expect(env.mines).toEqual([
      ['M', pos],
      ['N', undefined],
    ]);
  });

  it('встреча с союзником: строка и пульс чипа только своему', async () => {
    const { feed, env, lines } = await boot();
    feed.handleEvents([ev('ally.contact', { owner: 'p2' }), ev('ally.contact', { owner: 'p1' })]);
    expect(lines()).toEqual([t('ally.contact.note')]);
    expect(env.pulses).toBe(1);
  });

  it('деление, которого ждали, выделяет новый флот и больше не ждёт', async () => {
    const { feed, env, lines } = await boot();
    env.splitAwait = 'F1';
    feed.handleEvents([ev('fleet.split', { owner: 'p1', from: 'F9', to: 'F8', at: 'A' })]);
    expect([env.selections, env.splitAwait]).toEqual([[], 'F1']);
    feed.handleEvents([ev('fleet.split', { owner: 'p1', from: 'F1', to: 'F2' })]);
    expect([env.selections, env.splitAwait]).toEqual([[['F2']], null]);
    expect(lines()).toEqual([t('log.fleet.split', { at: '«A»' }), t('log.fleet.split-transit')]);
  });

  it('открытие слышит исследователь; древо перерисовывается, только если открыто, и для чужого', async () => {
    const { feed, env, lines } = await boot();
    const tech = (playerId: string) =>
      ev('technology.researched', { playerId, technology: 'industrial_automation' });
    feed.handleEvents([tech('p2')]);
    expect([feed.logLines, env.techRepaints]).toEqual([[], 0]);
    env.techOpen = true;
    feed.handleEvents([tech('p2'), tech('p1')]);
    expect(env.techRepaints).toBe(2);
    expect(lines()).toEqual([t('log.tech.done', { tech: tData('Industrial Automation') })]);
  });

  it('стройка: своя — рассказ и малая вспышка, чужая — только разрушение на виду', async () => {
    const { feed, env } = await boot();
    const b = (type: string, owner: string, planetId: string, extra = {}) =>
      ev(type, { owner, planetId, building: 'radar', ...extra });
    feed.handleEvents([
      b('building.constructed', 'p2', 'N'),
      b('building.constructed', 'p1', 'A'),
      b('building.upgraded', 'p1', 'A', { level: 2 }),
      b('building.destroyed', 'p2', 'N', { cleared: true }),
      b('building.destroyed', 'p3', 'E'),
      b('building.destroyed', 'p1', 'A'),
    ]);
    expect(env.tells).toEqual([
      ['build', 'constructed', 'A'],
      ['build', 'upgraded', 'A'],
      ['build', 'cleared', 'N'],
      ['build', 'destroyed', 'A'],
    ]);
    expect(env.notices).toEqual([
      { x: 0, y: 0 },
      { x: 0, y: 0 },
    ]);
  });

  it('свой флот дошёл — малая вспышка там, где он стоит; чужой — нет', async () => {
    const { feed, env } = await boot();
    env.s = { ...env.s, fleets: { ...env.s.fleets, G: fleet('G', 'p2', 'N') } };
    feed.handleEvents([
      ev('fleet.arrived', { fleetId: 'G' }),
      ev('fleet.arrived', { fleetId: 'F1' }),
    ]);
    expect(env.notices).toEqual([{ x: 0, y: 0 }]);
  });

  it('вахта и герой: рассказ просят только о своём', async () => {
    const { feed, env } = await boot();
    const hours = 3_600_000;
    env.s = {
      ...env.s,
      heroes: {
        H1: {
          id: 'H1',
          owner: 'p1',
          location: 'A',
          cooldowns: { respawn: env.s.time + 2 * hours },
        },
      } as unknown as GameState['heroes'],
    };
    feed.handleEvents([
      ev('steward.delegated', { playerId: 'p2' }),
      ev('steward.delegated', { playerId: 'p1', posture: 'active' }),
      ev('steward.recalled', { playerId: 'p1' }),
      ev('steward.expired', { playerId: 'p1' }),
      ev('hero.died', { owner: 'p1', heroId: 'H1' }),
      ev('hero.respawned', { owner: 'p1', heroId: 'H1', at: 'A' }),
      ev('hero.respawned', { owner: 'p2', heroId: 'H2', at: 'N' }),
    ]);
    expect(env.tells).toEqual([
      ['steward', 'delegated', 'p1'],
      ['steward', 'recalled', 'p1'],
      ['steward', 'expired', 'p1'],
      ['hero', { key: 'log.hero.died', heroId: 'H1', at: 'A', leftMs: 2 * hours }],
      ['hero', { key: 'log.hero.respawned', heroId: 'H1', at: 'A' }],
      ['hero', null],
    ]);
  });
});

describe('REFM-230 — стык с main.ts', () => {
  const MAIN = readFileSync(new URL('./main.ts', import.meta.url), 'utf8');
  const FEED = readFileSync(new URL('./eventFeed.ts', import.meta.url), 'utf8');

  it('main.ts поднимает ленту всеми хуками и не держит её старых определений', () => {
    const init = MAIN.slice(MAIN.indexOf('initEventFeed({'));
    const body = init.slice(0, init.indexOf('\n});'));
    for (const hook of [
      'world',
      'me',
      'names',
      'placeName',
      'fleetTitleOf',
      'setFleetSelection',
      'splitAwait',
      'endSplitAwait',
      'techTree',
      'tellSteward',
      'tellHero',
      'tellBuild',
      'battleWindow',
      'shot',
      'captureFlash',
      'mineFlash',
      'noticeFlash',
      'pulseAlly',
    ])
      expect(body, hook).toMatch(new RegExp(`\\b${hook}\\b`));
    expect(body).toMatch(/aaShots\.push\(shot\);\s*capShots\(aaShots, AA_SHOTS_MAX\);/);
    for (const old of [
      /function handleEvents\(/,
      /function note\(/,
      /function toast\(/,
      /function battleEngaged\(/,
      /const logLines\b/,
      /const eventLog\b/,
      /let killStats\b/,
      /const battleLosses\b/,
    ])
      expect(MAIN).not.toMatch(old);
  });

  it('лента не импортирует main.ts', () => {
    expect(FEED).not.toMatch(/from '\.\/main'/);
  });
});
