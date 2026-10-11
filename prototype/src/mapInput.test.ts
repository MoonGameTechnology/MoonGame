/**
 * Ввод на карте (REFM-236) — прямой тест владельца на живом мире прототипа.
 *
 * Чей тап, решают чистые правила (`tapPriority.ts`, `tapCycle.ts`, `pressIntent.ts`,
 * `dragIntent.ts`, `aimGesture.ts`, `holdPress.ts`), и у каждого свой тест. Здесь — то, что
 * собирается только вместе: тап доходит до своего прицела, выбора или конвейера приказа,
 * палец на холсте становится тапом, протяжкой, рамкой, удержанием или щипком, а колесо,
 * двойной клик и наведение двигают камеру и курсор. Холст поддельный, мир, камера, туман,
 * выбор и конвейер — настоящие; тест лишь подслушивает, какие приказы ушли в ядро.
 * Каждый тест — свежая загрузка модулей.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Action, Fleet, GameState, Planet } from '../../packages/shared-core/src/index';
import { orbitSeats } from '../../decisions/orbitSeats';
import { isEmplacementFleet } from '../../decisions/emplacement';
import { retreatBattle } from '../../decisions/actions';
import { battleBadgePoint } from '../../decisions/battleTap';
import { t } from '../../localization/runtime';
import { data } from './gameData';
import type { MapNode } from './game';

/** Приказы, ушедшие в конвейер за тест, по порядку. */
const sent: Action[] = [];
/** Приказ без сквозного `id`, который раздаёт его создатель. */
const bare = ({ id: _id, ...rest }: Action) => rest;
/** Ушедшие приказы без `id`. */
const orders = () => sent.map(bare);

beforeAll(async () => {
  await import('./mapInput');
}, 60_000);
beforeEach(() => {
  vi.resetModules();
  vi.stubGlobal('__PLAYER_BUILD__', false); // конвейер читает профиль сборки
  sent.length = 0;
  vi.doMock('./orderPipeline', async (importOriginal) => {
    const real = await importOriginal<typeof import('./orderPipeline')>();
    return {
      ...real,
      playerOrder: (action: Action) => {
        sent.push(action);
        return real.playerOrder(action);
      },
    };
  });
});
afterEach(() => {
  vi.doUnmock('./orderPipeline');
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

type Listener = (ev: unknown) => void;

/** Холст `#map` с его слушателями и классами, `#cmdbar` и бокс меню точки. */
function fakePage(pc: boolean) {
  const listeners: Array<{ type: string; fn: Listener; options: unknown }> = [];
  const classes = new Set<string>();
  const canvas = {
    addEventListener: (type: string, fn: Listener, options?: unknown) =>
      listeners.push({ type, fn, options }),
    setPointerCapture: () => {},
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 1600, height: 900 }),
    classList: {
      toggle: (name: string, on: boolean) => (on ? classes.add(name) : classes.delete(name)),
      remove: (name: string) => classes.delete(name),
    },
  };
  const bar = {
    innerHTML: '',
    classList: { add: () => {}, remove: () => {} },
    querySelector: () => null,
    addEventListener: () => {},
  };
  const menu = {
    innerHTML: '',
    style: { left: '', top: '' },
    classList: { add: () => {}, remove: () => {}, contains: () => false },
    addEventListener: () => {},
    getBoundingClientRect: () => ({ width: 200, top: 100 }),
  };
  const byId: Record<string, unknown> = { map: canvas, cmdbar: bar, tgted: menu };
  vi.stubGlobal('document', {
    getElementById: (id: string) => byId[id] ?? null,
    body: { classList: { add: () => {}, remove: () => {} } },
  });
  vi.stubGlobal('window', {
    innerWidth: 1600,
    setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms),
  });
  const vibrations: number[] = [];
  vi.stubGlobal('navigator', { vibrate: (ms: number) => vibrations.push(ms) });
  // ПК-раскладку прототип узнаёт медиа-запросом при загрузке `graphicsPrefs.ts`.
  if (pc) vi.stubGlobal('matchMedia', () => ({ matches: true }));
  /** Разослать событие слушателям холста этого типа, в порядке их постановки. */
  const fire = (type: string, ev: unknown) => {
    for (const l of listeners) if (l.type === type) l.fn(ev);
  };
  return { listeners, classes, fire, vibrations };
}

async function boot(opts: { pc?: boolean } = {}) {
  const page = fakePage(!!opts.pc);
  const game = await import('./game');
  const world: GameState = game.newGame({
    seats: [
      { id: 'p1', name: 'A', faction: 'azure', start: game.START_CANDIDATES[0]!, ai: false },
      { id: 'p2', name: 'B', faction: 'crimson', start: game.START_CANDIDATES[1]!, ai: false },
    ],
  });
  const env = {
    world,
    mobile: false,
    notes: [] as string[],
    selected: [] as string[][],
    cleared: 0,
    toggled: [] as string[],
    panel: 0,
    marks: 0,
    pingsClosed: 0,
    pingsOpened: [] as string[],
    battles: [] as string[],
    battleRetreat: null as string | null,
    retreatCleared: 0,
    chain: [] as Array<{ fleetIds: string[]; x: number; y: number }>,
    pings: [] as Array<{ loc: string; x: number; y: number }>,
  };
  const nodes = Object.values(world.planets).map((p) => ({ id: p.id, ...p.position }));
  const camera = await import('./mapCamera');
  camera.initMapCamera({
    vw: () => 1600,
    vh: () => 900,
    mobile: () => env.mobile,
    console: () => false,
    world: () => env.world,
    me: () => 'p1',
  } as never);
  camera.frameMap(Object.values(world.planets).map((p) => p.position));
  const fog = await import('./mapFog');
  fog.initMapFog({
    world: () => env.world,
    me: () => 'p1',
    net: () => false,
    contacts: () => [],
    sight: () => [],
  });
  fog.refreshVision(); // без зрения туман выключен, и чужое видно отовсюду
  const geo = await import('./fleetGeometry');
  geo.initFleetGeometry({
    world: () => env.world,
    me: () => 'p1',
    now: () => 0,
    lod: () => ({ scale: 2, art: 1, detail: 1, provinceDetail: 1, markerRadius: 3 }),
    forkMarks: () => [],
    orbits: () => orbitSeats(Object.values(env.world.fleets), (g) => isEmplacementFleet(g, data)),
  });
  const note = (text: string) => env.notes.push(text);
  const pipe = await import('./orderPipeline');
  pipe.initOrderPipeline({
    world: () => env.world,
    setWorld: (state) => {
      env.world = state;
    },
    me: () => 'p1',
    handleEvents: () => {},
    note,
    placeName: (id) => id,
    refusalSound: () => {},
    tour: () => null,
    intro: () => {},
    steward: () => null,
  });
  const inter = await import('./interaction');
  /** Выбрать свои флоты, как рамка или тап. */
  const select = (...ids: string[]) =>
    inter.pickFleets(ids, (id) => env.world.fleets[id]?.owner === 'p1');
  const go = await import('./groupOrders');
  go.initGroupOrders({
    world: () => env.world,
    me: () => 'p1',
    note,
    seatName: () => undefined,
    selectFleets: () => {},
  });
  const ch = await import('./chainComposer');
  ch.initChainComposer({
    world: () => env.world,
    me: () => 'p1',
    note,
    nodes: () => nodes as unknown as MapNode[],
    capturable: () => true,
    touchTap: () => false,
    screenPoint: (p) => p,
    invalidateCmdBar: () => {},
    invalidatePanel: () => {},
  });
  const ca = await import('./cmdActions');
  const cb = await import('./cmdBar');
  cb.initCmdBar({
    world: () => env.world,
    me: () => 'p1',
    mobile: () => env.mobile,
    holo: () => false,
    consoleFleet: () => null,
    fleetLandShown: () => false,
    capturable: () => true,
    placeName: (id) => id,
    mobileOrderKind: ca.mobileOrderKind,
    mobileTargetAvailable: ca.mobileTargetAvailable,
    mobileTargetLabel: ca.mobileTargetLabel,
  });
  ca.initCmdActions({
    world: () => env.world,
    me: () => 'p1',
    mobile: () => env.mobile,
    note,
    placeName: (id) => id,
    fleetTitleOf: (id) => id,
    capturable: () => true,
    renderPanel: () => {},
    invalidatePanel: () => {},
    renderSplitDialog: () => {},
    openMineFleet: () => {},
    sentSound: () => {},
  });
  const mi = await import('./mapInput');
  mi.initMapInput({
    world: () => env.world,
    me: () => 'p1',
    mobile: () => env.mobile,
    vw: () => 1600,
    vh: () => 900,
    nodes: () => nodes as unknown as MapNode[],
    note,
    invalidatePanel: () => env.panel++,
    capturable: () => true,
    chainHits: () => env.chain,
    pingHits: () => env.pings,
    closePingPop: () => env.pingsClosed++,
    openPingPop: (loc) => env.pingsOpened.push(loc),
    openBattle: (id) => env.battles.push(id),
    battleRetreatAim: () => env.battleRetreat,
    clearBattleRetreatAim: () => {
      env.battleRetreat = null;
      env.retreatCleared++;
    },
    markSelection: () => env.marks++,
    clearSelection: () => env.cleared++,
    setFleetSelection: (ids) => {
      env.selected.push(ids);
      select(...ids);
    },
    toggleFleetInSelection: (id) => env.toggled.push(id),
    engageCandidates: () => [],
    mapLayer: () => ({ k: 1, tx: 0, ty: 0 }),
    provinceAt: () => undefined,
    ownStrike: () => null,
    squadronAt: () => null,
    squadronRelocateSpots: () => [],
    strikeSquadron: () => ({}) as never,
    strikeFrom: () => ({ planetId: 'x' }),
    strikesUnderTap: () => [],
    relocateSpotPx: () => null,
  });
  const home = Object.values(world.planets).find((p) => p.owner === 'p1')!;
  const fleet = Object.values(world.fleets).find((f) => f.owner === 'p1')!;
  /** Сосед дома по первой дороге. */
  const next = env.world.planets[home.links![0]!]!;
  /** Мир без флотов на орбите — тап по нему не задевает ни одной точки флота. */
  const bare_ = Object.values(world.planets).find(
    (p) => !Object.values(world.fleets).some((f) => f.location === p.id),
  )!;
  /** Точка мира на экране. */
  const at = (p: Planet) => camera.world(p.position);
  /** Точка флота на экране. */
  const anchor = (id: string) => geo.fleetAnchor(env.world.fleets[id]!)!;
  /** Пустота у края карты: ни мира, ни флота в радиусе тапа. */
  const voidPt = { x: 4, y: 4 };
  /** Поправить флот в мире (или добавить новый). */
  const put = (f: Fleet) => {
    env.world = { ...env.world, fleets: { ...env.world.fleets, [f.id]: f } };
  };
  /** Событие указателя в точке холста. */
  const ptr = (
    id: number,
    p: { x: number; y: number },
    kind: 'mouse' | 'touch' = 'mouse',
    keys: { shift?: boolean; ctrl?: boolean } = {},
  ) => ({
    pointerId: id,
    pointerType: kind,
    clientX: p.x,
    clientY: p.y,
    shiftKey: !!keys.shift,
    ctrlKey: !!keys.ctrl,
    metaKey: false,
  });
  return {
    ...page,
    mi,
    inter,
    ch,
    camera,
    game,
    env,
    home,
    fleet,
    next,
    empty: bare_,
    at,
    anchor,
    voidPt,
    put,
    select,
    ptr,
  };
}

/** Рамка выделения: координаты проходят через перевод «страница → холст» и теряют последний бит. */
function expectBox(
  box: { x1: number; y1: number; x2: number; y2: number } | null,
  want: { x1: number; y1: number; x2: number; y2: number },
): void {
  expect(box).not.toBeNull();
  for (const k of ['x1', 'y1', 'x2', 'y2'] as const) expect(box![k]).toBeCloseTo(want[k], 6);
}

/** Второй свой флот рядом с первым. */
function twin(from: Fleet, id: string): Fleet {
  return { ...from, id, units: [{ unit: 'cruiser', count: 1 }] };
}

describe('REFM-236 — слушатели холста', () => {
  it('встают на `#map` в прежнем порядке; колесо не пассивное, чтобы гасить прокрутку', async () => {
    const { listeners } = await boot();
    expect(listeners.map((l) => l.type)).toEqual([
      'pointerdown',
      'pointermove',
      'pointerup',
      'pointercancel',
      'lostpointercapture',
      'wheel',
      'dblclick',
      'pointermove',
      'pointerleave',
    ]);
    expect(listeners.find((l) => l.type === 'wheel')!.options).toEqual({ passive: false });
  });
});

describe('REFM-236 — тап по карте (`selectAt`)', () => {
  it('тап по своему флоту выделяет его, по пустоте снимает выбор; любой тап закрывает пинг', async () => {
    const { mi, env, fleet, anchor, voidPt } = await boot();
    const a = anchor(fleet.id);
    mi.selectAt(a.x, a.y);
    expect(env.selected).toEqual([[fleet.id]]);
    mi.selectAt(voidPt.x, voidPt.y);
    expect(env.cleared).toBe(1);
    expect(env.pingsClosed).toBe(2);
  });

  it('тап по миру выбирает мир, отмечает начало выбора и сбрасывает панель', async () => {
    const { mi, inter, env, empty, at } = await boot();
    const p = at(empty);
    mi.selectAt(p.x, p.y);
    expect(inter.selPlanet).toBe(empty.id);
    expect([env.marks, env.panel]).toEqual([1, 1]);
    // Второй тап по выбранному миру снимает выбор (`tapCycle.ts`, правило 6).
    mi.selectAt(p.x, p.y);
    expect(env.cleared).toBe(1);
  });

  it('ПК перебирает стопку под курсором: флот, затем мир под ним', async () => {
    const { mi, inter, env, home, fleet, anchor } = await boot({ pc: true });
    const a = anchor(fleet.id);
    mi.selectAt(a.x, a.y);
    expect(env.selected).toEqual([[fleet.id]]);
    mi.selectAt(a.x, a.y);
    expect(inter.selPlanet).toBe(home.id);
  });

  it('ПК: Ctrl-клик добирает ближайший флот, а не перебирает стопку', async () => {
    const { fire, env, fleet, anchor, ptr } = await boot({ pc: true });
    const a = anchor(fleet.id);
    fire('pointerdown', ptr(1, a, 'mouse', { ctrl: true }));
    fire('pointerup', ptr(1, a));
    expect(env.toggled).toEqual([fleet.id]);
    expect(env.selected).toEqual([]);
  });

  it('метка пинга открывает описание, а при взведённом «Курсе» тап уходит приказом', async () => {
    const { mi, inter, env, game, fleet, next, at, select } = await boot();
    const p = at(next);
    env.pings = [{ loc: next.id, x: p.x, y: p.y }];
    mi.selectAt(p.x, p.y);
    expect(env.pingsOpened).toEqual([next.id]);
    select(fleet.id);
    inter.arm('aiming', true);
    mi.selectAt(p.x, p.y);
    expect(env.pingsOpened).toEqual([next.id]);
    expect(orders()).toEqual([bare(game.moveFleet('p1', fleet.id, next.id))]);
  });

  it('◎-бейдж плана открывает «Приказ», и дальше тапы принадлежат ему', async () => {
    const { mi, ch, env, fleet, voidPt } = await boot();
    env.chain = [{ fleetIds: [fleet.id], x: 300, y: 300 }];
    mi.selectAt(300, 300);
    expect(ch.chainMode).not.toBeNull();
    mi.selectAt(voidPt.x, voidPt.y);
    expect([env.cleared, env.selected.length]).toEqual([0, 0]);
  });

  it('значок боя открывает окно боя раньше выбора', async () => {
    const { mi, camera, env, home } = await boot();
    env.world = {
      ...env.world,
      battles: {
        b1: {
          id: 'b1',
          location: home.id,
          phase: 'orbital',
          round: 1,
          nextRoundAt: env.world.time + 1,
          sides: [],
        } as never,
      },
    };
    const badge = battleBadgePoint(camera.world(home.position));
    mi.selectAt(badge.x, badge.y);
    expect(env.battles).toEqual(['b1']);
    expect([env.selected.length, env.cleared]).toEqual([0, 0]);
  });

  it('«Курс» на ПК-раскладке отправляет флот к миру, снимает прицел и сбрасывает панель', async () => {
    const { mi, inter, env, game, fleet, next, at, select } = await boot();
    select(fleet.id);
    inter.arm('aiming', true);
    const p = at(next);
    mi.selectAt(p.x, p.y);
    expect(orders()).toEqual([bare(game.moveFleet('p1', fleet.id, next.id))]);
    expect(inter.aiming).toBe(false);
    expect(env.panel).toBe(1);
  });

  it('на телефоне «Курс» ставит цель черновика и ничего не отправляет', async () => {
    const { mi, inter, env, fleet, next, at, select } = await boot();
    env.mobile = true;
    select(fleet.id);
    inter.arm('aiming', true);
    const p = at(next);
    mi.selectAt(p.x, p.y);
    expect(inter.mobileDraft).toEqual({
      order: 'move',
      fleetIds: [fleet.id],
      target: { kind: 'planet', id: next.id },
    });
    expect(inter.aiming).toBe(true);
    expect(sent).toEqual([]);
  });

  it('«Слить»: тап по другому своему флоту — якорь; на телефоне — цель черновика', async () => {
    const { mi, inter, env, game, fleet, anchor, put, select } = await boot();
    put(twin(fleet, 'x'));
    select(fleet.id);
    inter.arm('merging', true);
    env.mobile = true;
    const a = anchor('x');
    mi.selectAt(a.x, a.y);
    expect(inter.mobileDraft?.target).toEqual({ kind: 'fleet', id: 'x' });
    expect(sent).toEqual([]);
    env.mobile = false;
    const b = anchor('x'); // раскладка ПК сдвигает проекцию карты
    mi.selectAt(b.x, b.y);
    expect(orders()).toEqual([bare(game.mergeFleet('p1', fleet.id, 'x'))]);
    expect(inter.merging).toBe(false);
  });

  it('«Отступить»: из боя уходит вся сторона, иначе флот; бой отхода забывается всегда', async () => {
    const { mi, inter, env, game, fleet, next, at, voidPt } = await boot();
    const p = at(next);
    inter.arm('retreatAim', fleet.id);
    env.battleRetreat = 'b1';
    mi.selectAt(p.x, p.y);
    inter.arm('retreatAim', fleet.id);
    mi.selectAt(p.x, p.y);
    inter.arm('retreatAim', fleet.id);
    mi.selectAt(voidPt.x, voidPt.y);
    expect(orders()).toEqual(
      [retreatBattle('p1', 'b1', next.id), game.retreatFleet('p1', fleet.id, next.id)].map(bare),
    );
    expect(env.notes.at(-1)).toBe(t('hint.retreat-cancelled')); // прежние — отказы ядра
    expect(env.retreatCleared).toBe(3);
    expect(inter.retreatAim).toBeNull();
  });

  it('удар по убежищу с пленным сперва предупреждает, повторный тап бьёт', async () => {
    const { mi, inter, env, game, next, empty, at } = await boot();
    env.world = { ...env.world, captive: { hideout: next.id } as never };
    const cast = { heroId: 'h', abilityId: 'annihilate' };
    expect(data.heroAbilities.annihilate?.type).toBe('annihilate');
    const p = at(next);
    inter.arm('heroAim', cast);
    mi.selectAt(p.x, p.y);
    expect(env.notes).toEqual([t('captive.warn-destroy')]);
    expect(inter.heroAim).toEqual(cast);
    expect(sent).toEqual([]);
    // Тап мимо убежища сбрасывает предупреждение: следующий тап по нему снова только предупредит.
    const q = at(empty);
    mi.selectAt(q.x, q.y);
    inter.arm('heroAim', cast);
    mi.selectAt(p.x, p.y);
    inter.arm('heroAim', cast);
    mi.selectAt(p.x, p.y);
    expect(orders()).toEqual(
      [
        game.castHeroAbility('p1', 'h', 'annihilate', empty.id),
        game.castHeroAbility('p1', 'h', 'annihilate', next.id),
      ].map(bare),
    );
    // Остальные заметки — отказы ядра: героя `h` в мире нет, приказ лишь проверяется.
    expect(env.notes.filter((n) => n === t('captive.warn-destroy'))).toHaveLength(2);
  });

  it('промахи взведённых прицелов снимают их и объясняют себя', async () => {
    const { mi, inter, env, voidPt } = await boot();
    const tap = () => mi.selectAt(voidPt.x, voidPt.y);
    // Каждый прицел проверяется сразу: следующий взвод гасит соседний и спрятал бы промах.
    inter.arm('heroAim', { heroId: 'h', abilityId: 'annihilate' });
    tap();
    expect(inter.heroAim).toBeNull();
    inter.arm('heroSpawnAim', 'h');
    tap();
    expect(inter.heroSpawnAim).toBeNull();
    inter.arm('allyAim', 'guard');
    tap();
    expect(inter.allyAim).toBeNull();
    inter.arm('engageAim', true);
    tap();
    expect(inter.engageAim).toBe(false);
    expect(env.notes).toEqual([
      t('hint.cast-cancelled'),
      t('hint.deploy-cancelled'),
      t('ally.pick-missed'),
      t('hint.engage-enemy-only'),
    ]);
    expect(sent).toEqual([]);
  });

  it('«Штурм» прощает свой мир: прицел остаётся и объясняет, кого можно брать', async () => {
    const { mi, inter, env, home, at } = await boot();
    inter.arm('assaultAim', true);
    const p = at(home);
    mi.selectAt(p.x, p.y);
    expect(inter.assaultAim).toBe(true);
    expect(env.notes).toEqual([t('hint.assault-enemy-only')]);
  });

  it('прицел эскадры: пропавшее звено и севший вылет называют причину, а не молчат', async () => {
    const { mi, inter, env, home, voidPt } = await boot();
    inter.arm('strikeAim', { from: { planetId: home.id }, squadronId: 'sq' });
    mi.selectAt(voidPt.x, voidPt.y);
    inter.arm('strikeAim', { from: { planetId: home.id }, squadronId: 'sq', patrol: true });
    mi.selectAt(voidPt.x, voidPt.y);
    inter.arm('strikeAim', { from: { planetId: home.id }, squadronId: 'sq', strikeId: 'st' });
    mi.selectAt(voidPt.x, voidPt.y);
    expect(env.notes).toEqual([t('hint.wing-empty'), t('hint.wing-empty'), t('hint.aloft-gone')]);
    expect(inter.strikeAim).toBeNull();
    expect(env.panel).toBe(3);
  });

  it('«Выбрать+»: тап по своему флоту только добавляет его в группу', async () => {
    const { mi, inter, env, fleet, anchor } = await boot();
    inter.arm('pickMode', true);
    const a = anchor(fleet.id);
    mi.selectAt(a.x, a.y);
    expect(env.toggled).toEqual([fleet.id]);
    expect(env.selected).toEqual([]);
  });
});

describe('REFM-236 — пальцы и мышь на холсте', () => {
  it('клик без протяжки — тап, протяжка двигает камеру и тапом не становится', async () => {
    const { fire, camera, env, voidPt, ptr } = await boot();
    fire('pointerdown', ptr(1, voidPt));
    fire('pointerup', ptr(1, voidPt));
    expect(env.cleared).toBe(1);
    camera.zoomAt(800, 450, 3); // вся карта на экране: панораме некуда ехать
    const before = { ...camera.cam };
    fire('pointerdown', ptr(1, { x: 800, y: 450 }));
    fire('pointermove', ptr(1, { x: 760, y: 420 }));
    fire('pointerup', ptr(1, { x: 760, y: 420 }));
    expect({ ...camera.cam }).not.toEqual(before);
    expect(env.cleared).toBe(1);
  });

  it('Ctrl-клик добирает флот в группу, а `forgetAdditive` возвращает обычный выбор', async () => {
    const { fire, mi, env, fleet, anchor, ptr } = await boot();
    const a = anchor(fleet.id);
    fire('pointerdown', ptr(1, a, 'mouse', { ctrl: true }));
    fire('pointerup', ptr(1, a));
    expect(env.toggled).toEqual([fleet.id]);
    mi.forgetAdditive();
    mi.selectAt(a.x, a.y);
    expect(env.selected).toEqual([[fleet.id]]);
  });

  it('Shift-протяжка из пустоты тянет рамку и выбирает свои флоты внутри неё', async () => {
    const { fire, mi, env, fleet, anchor, ptr } = await boot();
    const a = anchor(fleet.id);
    const from = { x: a.x + 60, y: a.y + 60 };
    fire('pointerdown', ptr(1, from, 'mouse', { shift: true }));
    expectBox(mi.selectionBox, { x1: from.x, y1: from.y, x2: from.x, y2: from.y });
    fire('pointermove', ptr(1, { x: a.x - 10, y: a.y - 10 }));
    expectBox(mi.selectionBox, { x1: from.x, y1: from.y, x2: a.x - 10, y2: a.y - 10 });
    fire('pointerup', ptr(1, { x: a.x - 10, y: a.y - 10 }));
    expect(env.selected).toEqual([[fleet.id]]);
    expect(mi.selectionBox).toBeNull();
  });

  it('Shift-рамка добирает к уже выбранной группе, а не заменяет её', async () => {
    const { fire, env, fleet, anchor, put, select, ptr } = await boot();
    const far = Object.values(env.world.planets).find((p) => p.owner === 'p2')!;
    put({ ...fleet, id: 'x', location: far.id });
    select('x');
    const a = anchor(fleet.id);
    const x = anchor('x');
    expect(Math.hypot(x.x - a.x, x.y - a.y)).toBeGreaterThan(100); // «x» вне рамки
    fire('pointerdown', ptr(1, { x: a.x + 60, y: a.y + 60 }, 'mouse', { shift: true }));
    fire('pointermove', ptr(1, { x: a.x - 10, y: a.y - 10 }));
    fire('pointerup', ptr(1, { x: a.x - 10, y: a.y - 10 }));
    expect(env.selected).toEqual([['x', fleet.id]]);
  });

  it('удержание пальца на своём флоте добирает его, и отпускание уже ничего не выбирает', async () => {
    vi.useFakeTimers();
    const { fire, mi, env, vibrations, fleet, anchor, ptr } = await boot();
    const a = anchor(fleet.id);
    fire('pointerdown', ptr(1, a, 'touch'));
    expect(mi.tapByTouch).toBe(true); // радиус пальца у превью — с самого нажатия
    vi.advanceTimersByTime(349);
    expect(env.toggled).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(env.toggled).toEqual([fleet.id]);
    expect(vibrations).toEqual([25]);
    fire('pointerup', ptr(1, a, 'touch'));
    expect([env.selected.length, env.cleared]).toEqual([0, 0]);
  });

  it('удержание в пустоте открывает рамку: палец тянет её, отпускание выбирает', async () => {
    vi.useFakeTimers();
    const { fire, mi, env, fleet, anchor, ptr } = await boot();
    const a = anchor(fleet.id);
    const from = { x: a.x + 60, y: a.y + 60 };
    fire('pointerdown', ptr(1, from, 'touch'));
    vi.advanceTimersByTime(350);
    expectBox(mi.selectionBox, { x1: from.x, y1: from.y, x2: from.x, y2: from.y });
    fire('pointermove', ptr(1, { x: a.x - 10, y: a.y - 10 }, 'touch'));
    fire('pointerup', ptr(1, { x: a.x - 10, y: a.y - 10 }, 'touch'));
    expect(env.selected).toEqual([[fleet.id]]);
    expect(env.toggled).toEqual([]);
  });

  it('палец, уехавший до созревания, удержанием не становится', async () => {
    vi.useFakeTimers();
    const { fire, env, fleet, anchor, ptr } = await boot();
    const a = anchor(fleet.id);
    fire('pointerdown', ptr(1, a, 'touch'));
    fire('pointermove', ptr(1, { x: a.x + 40, y: a.y }, 'touch'));
    vi.advanceTimersByTime(1000);
    expect(env.toggled).toEqual([]);
  });

  it('щипок двумя пальцами масштабирует камеру и не выбирает ничего при отрыве', async () => {
    const { fire, mi, camera, env, ptr } = await boot();
    fire('pointerdown', ptr(1, { x: 700, y: 450 }, 'touch'));
    fire('pointerdown', ptr(2, { x: 900, y: 450 }, 'touch'));
    expect(mi.pointers.size).toBe(2);
    expect(mi.pinchStart).not.toBeNull();
    const scale = camera.cam.scale;
    fire('pointermove', ptr(2, { x: 1000, y: 450 }, 'touch'));
    mi.flushPinch();
    expect(camera.cam.scale).toBeGreaterThan(scale);
    fire('pointerup', ptr(2, { x: 1000, y: 450 }, 'touch'));
    expect(mi.pinchStart).toBeNull();
    fire('pointerup', ptr(1, { x: 700, y: 450 }, 'touch'));
    expect(mi.pointers.size).toBe(0);
    expect([env.selected.length, env.cleared]).toEqual([0, 0]);
  });

  it('второй палец гасит рамку удержания: щипок рамкой не выбирает', async () => {
    vi.useFakeTimers();
    const { fire, mi, env, voidPt, ptr } = await boot();
    fire('pointerdown', ptr(1, voidPt, 'touch'));
    vi.advanceTimersByTime(350);
    expect(mi.selectionBox).not.toBeNull();
    fire('pointerdown', ptr(2, { x: 400, y: 300 }, 'touch'));
    expect(mi.selectionBox).toBeNull();
    fire('pointerup', ptr(2, { x: 400, y: 300 }, 'touch'));
    fire('pointerup', ptr(1, voidPt, 'touch'));
    expect([env.selected.length, env.cleared]).toEqual([0, 0]);
  });

  it('щипок на месте — пальцы легли и поднялись — тапом не становится', async () => {
    const { fire, env, ptr } = await boot();
    fire('pointerdown', ptr(1, { x: 700, y: 450 }, 'touch'));
    fire('pointerdown', ptr(2, { x: 900, y: 450 }, 'touch'));
    fire('pointerup', ptr(2, { x: 900, y: 450 }, 'touch'));
    fire('pointerup', ptr(1, { x: 700, y: 450 }, 'touch'));
    expect([env.selected.length, env.cleared]).toEqual([0, 0]);
  });

  it('отрыв пальца досчитывает щипок до его последней точки', async () => {
    const { fire, camera, ptr } = await boot();
    fire('pointerdown', ptr(1, { x: 700, y: 450 }, 'touch'));
    fire('pointerdown', ptr(2, { x: 900, y: 450 }, 'touch'));
    const scale = camera.cam.scale;
    fire('pointerup', ptr(2, { x: 1000, y: 450 }, 'touch')); // без промежуточного движения
    expect(camera.cam.scale).toBeGreaterThan(scale);
  });

  it('системная отмена жеста забывает палец и рамку', async () => {
    const { fire, mi, env, voidPt, ptr } = await boot();
    fire('pointerdown', ptr(1, voidPt, 'mouse', { shift: true }));
    expect(mi.selectionBox).not.toBeNull();
    fire('pointercancel', ptr(1, voidPt));
    expect([mi.pointers.size, mi.selectionBox]).toEqual([0, null]);
    fire('pointerdown', ptr(2, voidPt));
    fire('lostpointercapture', ptr(2, voidPt));
    fire('pointerup', ptr(2, voidPt));
    expect([mi.pointers.size, env.cleared]).toEqual([0, 0]);
  });

  it('планшет: протяжка взведённого «Курса» целится, а отпускание отдаёт приказ', async () => {
    const { fire, mi, inter, game, camera, fleet, home, next, at, select, ptr } = await boot();
    select(fleet.id);
    inter.arm('aiming', true);
    camera.zoomAt(800, 450, 3); // у панорамы есть куда ехать — и она не едет
    const before = { ...camera.cam };
    fire('pointerdown', ptr(1, at(home), 'touch'));
    fire('pointermove', ptr(1, at(next), 'touch'));
    expect({ ...camera.cam }).toEqual(before);
    fire('pointerup', ptr(1, at(next), 'touch'));
    expect(orders()).toEqual([bare(game.moveFleet('p1', fleet.id, next.id))]);
    expect(mi.tapByTouch).toBe(true);
  });

  it('телефон: та же протяжка везёт карту, а приказ ждёт кнопки', async () => {
    const { fire, inter, env, camera, fleet, home, next, at, select, ptr } = await boot();
    env.mobile = true;
    select(fleet.id);
    inter.arm('aiming', true);
    camera.zoomAt(800, 450, 3); // вся карта на экране: панораме некуда ехать
    const before = { ...camera.cam };
    fire('pointerdown', ptr(1, at(home), 'touch'));
    fire('pointermove', ptr(1, at(next), 'touch'));
    fire('pointerup', ptr(1, at(next), 'touch'));
    expect({ ...camera.cam }).not.toEqual(before);
    expect([sent.length, inter.mobileDraft]).toEqual([0, null]);
  });

  it('колесо масштабирует у курсора и гасит прокрутку страницы; двойной клик — вид по умолчанию', async () => {
    const { fire, camera } = await boot();
    camera.defaultView();
    const home = { ...camera.cam };
    let stopped = 0;
    const wheel = (deltaY: number) => ({
      clientX: 800,
      clientY: 450,
      deltaY,
      preventDefault: () => stopped++,
    });
    fire('wheel', wheel(-1));
    expect(camera.cam.scale).toBeGreaterThan(home.scale);
    const zoomed = camera.cam.scale;
    fire('wheel', wheel(1));
    expect(camera.cam.scale).toBeLessThan(zoomed);
    expect(stopped).toBe(2);
    fire('wheel', wheel(-1));
    fire('dblclick', {});
    expect({ ...camera.cam }).toEqual(home);
  });

  it('наведение мыши ведёт точку прицела и греет курсор над миром; уход с холста остужает', async () => {
    const { fire, mi, classes, empty, at, voidPt, ptr } = await boot();
    fire('pointermove', ptr(1, at(empty)));
    expect(mi.aimPointer).toEqual(at(empty));
    expect(classes.has('cur-hot')).toBe(true);
    fire('pointermove', ptr(1, voidPt));
    expect(classes.has('cur-hot')).toBe(false);
    fire('pointermove', ptr(1, at(empty)));
    fire('pointerleave', {});
    expect(classes.has('cur-hot')).toBe(false);
    mi.forgetAimPointer();
    expect(mi.aimPointer).toBeNull();
  });

  it('на телефоне с взведённым приказом точку прицела держит черновик, а не палец', async () => {
    const { fire, mi, inter, env, empty, at, ptr } = await boot();
    env.mobile = true;
    inter.arm('aiming', true);
    fire('pointermove', ptr(1, at(empty), 'touch'));
    expect(mi.aimPointer).toBeNull();
  });
});
