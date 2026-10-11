/**
 * Нажатия ряда команд и мобильный черновик приказа (REFM-227) — прямой тест владельца на
 * живом мире прототипа.
 *
 * Что гаснет от соседней команды, держит `armDisarm.ts`; кому какой приказ боя —
 * `engageOrders.ts`; меню десанта — `troopsMenu.ts`; черновик против выбора —
 * `mobileOrders.ts`. Здесь — то, что собирается только вместе: нажатие доходит до своего
 * флага или до конвейера приказа, после него ряд и панель собраны заново, серая кнопка
 * объясняет себя, а телефонный черновик уходит приказом, только пока он годен. Конвейер
 * настоящий; тест лишь подслушивает, какие приказы в него ушли. Каждый тест — свежая
 * загрузка модулей.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';

import type { Action, Fleet, GameState } from '../../packages/shared-core/src/index';
import { pairKey } from '../../packages/shared-core/src/index';
import { orbitSeats } from '../../decisions/orbitSeats';
import { isEmplacementFleet } from '../../decisions/emplacement';
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
  await import('./cmdActions');
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
});

/** `#cmdbar` с его слушателями, бокс меню точки и `body`. */
function fakePage() {
  const listeners: Array<[string, unknown]> = [];
  const bar = {
    innerHTML: '',
    classList: { add: () => {}, remove: () => {} },
    querySelector: () => null,
    addEventListener: (type: string, fn: unknown) => listeners.push([type, fn]),
  };
  const menu = {
    innerHTML: '',
    style: { left: '', top: '' },
    classList: { add: () => {}, remove: () => {}, contains: () => false },
    addEventListener: () => {},
    getBoundingClientRect: () => ({ width: 200, top: 100 }),
  };
  vi.stubGlobal('document', {
    getElementById: (id: string) => (id === 'cmdbar' ? bar : id === 'tgted' ? menu : null),
    body: { classList: { add: () => {}, remove: () => {} } },
  });
  vi.stubGlobal('window', { innerWidth: 1600 });
  return { bar, listeners };
}

async function boot() {
  const page = fakePage();
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
    capturable: true,
    notes: [] as string[],
    panelRenders: 0,
    panelInvalidations: 0,
    splitRenders: 0,
    mines: [] as string[],
    sounds: 0,
  };
  const camera = await import('./mapCamera');
  camera.initMapCamera({
    vw: () => 1600,
    vh: () => 900,
    mobile: () => false,
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
    nodes: () => [] as MapNode[],
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
    capturable: () => env.capturable,
    placeName: (id) => `«${id}»`,
    mobileOrderKind: ca.mobileOrderKind,
    mobileTargetAvailable: ca.mobileTargetAvailable,
    mobileTargetLabel: ca.mobileTargetLabel,
  });
  ca.initCmdActions({
    world: () => env.world,
    me: () => 'p1',
    mobile: () => env.mobile,
    note,
    placeName: (id) => `«${id}»`,
    fleetTitleOf: (id) => `флот ${id}`,
    capturable: () => env.capturable,
    renderPanel: () => env.panelRenders++,
    invalidatePanel: () => env.panelInvalidations++,
    renderSplitDialog: () => env.splitRenders++,
    openMineFleet: (id) => env.mines.push(id),
    sentSound: () => env.sounds++,
  });
  const inter = await import('./interaction');
  const home = Object.values(world.planets).find((p) => p.owner === 'p1')!;
  const foe = Object.values(world.planets).find((p) => p.owner === 'p2')!;
  const fleet = Object.values(world.fleets).find((f) => f.owner === 'p1')!;
  /** Выбрать свои флоты, как рамка или тап. */
  const select = (...ids: string[]) =>
    inter.pickFleets(ids, (id) => env.world.fleets[id]?.owner === 'p1');
  /** Поправить флот в мире (или добавить новый). */
  const put = (f: Fleet) => {
    env.world = { ...env.world, fleets: { ...env.world.fleets, [f.id]: f } };
  };
  /** Нажать кнопку ряда: `data-cmd`, прочие `data-*` и её состояние. */
  const press = (
    cmd: string | undefined,
    dataset: Record<string, string> = {},
    state: { disabled?: boolean; why?: boolean } = {},
  ) => {
    const button = {
      disabled: !!state.disabled,
      dataset: { ...(cmd === undefined ? {} : { cmd }), ...dataset },
      getAttribute: (name: string) => (name === 'aria-disabled' && state.why ? 'true' : null),
    };
    ca.onCommandClick({ target: { closest: () => button } } as unknown as MouseEvent);
  };
  /** Отправить флот в путь по первой дороге из его мира. */
  const fly = (id: string) => {
    const f = env.world.fleets[id]!;
    const to = env.world.planets[f.location!]!.links![0]!;
    env.world = game.order(env.world, game.moveFleet('p1', id, to), env.world.time).state;
  };
  return { ca, cb, ch, go, inter, game, page, env, home, foe, fleet, select, put, press, fly };
}

/** Второй свой флот рядом с первым, без героя. */
function twin(from: Fleet, id: string, at = from.location): Fleet {
  return { ...from, id, location: at, units: [{ unit: 'cruiser', count: 1 }] };
}

describe('REFM-227 — нажатия ряда', () => {
  it('серая кнопка называет причину в ленте и больше ничего не делает', async () => {
    const { inter, env, fleet, select, press } = await boot();
    select(fleet.id);
    press('split', { why: 'cmd.split.why.single' }, { why: true });
    expect(env.notes).toEqual([t('cmd.split.why.single')]);
    expect(inter.splitState).toBeNull();
    expect([env.panelRenders, env.splitRenders]).toEqual([0, 0]);
  });

  it('погашенная кнопка и клик мимо кнопок ничего не трогают', async () => {
    const { ca, env, fleet, select, press } = await boot();
    select(fleet.id);
    press('move', {}, { disabled: true });
    ca.onCommandClick({ target: { closest: () => null } } as unknown as MouseEvent);
    expect([env.notes.length, env.panelRenders, env.panelInvalidations]).toEqual([0, 0, 0]);
  });

  it('«Курс» взводит прицел с подсказкой жеста и снимает его вторым нажатием; ряд и панель собраны заново', async () => {
    const { inter, env, fleet, select, press } = await boot();
    select(fleet.id);
    press('move');
    expect(inter.aiming).toBe(true);
    expect(env.notes).toEqual([t('hint.aim-armed')]);
    expect([env.panelRenders, env.panelInvalidations]).toEqual([1, 1]);
    press('move');
    expect(inter.aiming).toBe(false);
  });

  it('соседняя команда закрывает чужой поповер, а своя подкоманда — нет', async () => {
    const { inter, fleet, select, press } = await boot();
    select(fleet.id);
    press('qretr');
    expect(inter.retreatMenu).toBe(true);
    press('stop');
    expect(inter.retreatMenu).toBe(false);
  });

  it('«Бой» взводит свой прицел, а соседний «Курс» его гасит', async () => {
    const { inter, env, fleet, select, press } = await boot();
    select(fleet.id);
    press('engage');
    expect(inter.engageAim).toBe(true);
    expect(env.notes).toEqual([t('hint.pick-engage')]);
    press('move');
    expect([inter.engageAim, inter.aiming]).toEqual([false, true]);
  });

  it('«Слить»: группа сливается сразу, одиночка взводит выбор якоря', async () => {
    const { inter, game, env, fleet, select, put, press } = await boot();
    put(twin(fleet, 'x'));
    select(fleet.id, 'x');
    press('merge');
    expect(orders()).toContainEqual(bare(game.mergeFleet('p1', 'x', fleet.id)));
    expect(inter.merging).toBe(false);
    select(fleet.id);
    press('merge');
    expect(inter.merging).toBe(true);
    expect(env.notes).toContain(t('hint.pick-merge'));
  });

  it('«Стоп» уходит только тем, кому его разрешает ядро — стоящему в группе ничего', async () => {
    const { game, fleet, select, put, press, fly } = await boot();
    put(twin(fleet, 'x'));
    put(twin(fleet, 'y'));
    fly(fleet.id);
    fly('x');
    select(fleet.id, 'x', 'y');
    press('stop');
    expect(orders()).toEqual([game.stopFleet('p1', fleet.id), game.stopFleet('p1', 'x')].map(bare));
  });

  it('«Штурм» без мыши уходит с ближней орбиты сразу, на телефоне — взводит прицел', async () => {
    const { inter, game, env, fleet, select, put, press } = await boot();
    put(twin(fleet, 'x'));
    put({ ...env.world.fleets[fleet.id]!, orbit: 'near' });
    select(fleet.id, 'x');
    press('attack');
    expect(orders()).toEqual([game.assaultFleet('p1', fleet.id)].map(bare));
    expect(inter.assaultAim).toBe(false);
    env.mobile = true;
    press('attack');
    expect(inter.assaultAim).toBe(true);
    expect(sent).toHaveLength(1);
  });

  it('«Деление» открывает и закрывает окно; мины заградителя открываются для флота', async () => {
    const { inter, env, fleet, select, press } = await boot();
    select(fleet.id);
    press('split');
    expect(inter.splitState).toEqual({ fleetId: fleet.id, take: {} });
    press('split');
    expect(inter.splitState).toBeNull();
    expect(env.splitRenders).toBe(2);
    press('rocket-mine');
    expect(env.mines).toEqual([fleet.id]);
  });

  it('⇅: меню десанта, «макс» набирает план, «Готово» грузит его и закрывает меню', async () => {
    const { inter, go, game, fleet, select, press } = await boot();
    select(fleet.id);
    press('troops');
    expect(inter.troopsPlan).toEqual({ fleetId: fleet.id, plan: {} });
    const unit = go.troopsInputFor(fleet.id)!.units.find((u) => u.unit === 'militia')!.unit;
    press('tmax', { unit, dir: '1' });
    const n = inter.troopsPlan!.plan[unit]!;
    expect(n).toBeGreaterThan(0);
    press('tstep', { unit, n: '-1' });
    expect(inter.troopsPlan!.plan[unit]).toBe(n - 1);
    press('tok');
    expect(orders()).toEqual([game.loadArmy('p1', fleet.id, unit, n - 1)].map(bare));
    expect(inter.troopsPlan).toBeNull();
    press('troops');
    press('troops');
    expect(inter.troopsPlan).toBeNull();
  });

  it('⇅ «Готово» у осаждённого мира выгружает, но не грузит', async () => {
    const { inter, go, env, home, fleet, select, press } = await boot();
    select(fleet.id);
    press('troops');
    const unit = go.troopsInputFor(fleet.id)!.units.find((u) => u.unit === 'militia')!.unit;
    press('tmax', { unit, dir: '1' });
    const battle = { sides: [{ ref: { kind: 'garrison', planetId: home.id } }] };
    env.world = { ...env.world, battles: { b1: battle } } as unknown as GameState;
    press('tok');
    expect(sent).toEqual([]);
    expect(inter.troopsPlan).toBeNull();
  });

  it('«Приказ»: вход, ⟲ и ⌂ правят черновик, «Отправить» шлёт план каждому флоту и выходит', async () => {
    const { ch, game, env, home, fleet, select, press } = await boot();
    select(fleet.id);
    press('target');
    expect(ch.chainMode?.fleetIds).toEqual([fleet.id]);
    const to = home.links![0]!;
    ch.setChainDraft({ steps: [{ kind: 'move', to }], gestures: [1] });
    press('chhome');
    expect(ch.chainMode!.steps).toEqual([
      { kind: 'move', to },
      { kind: 'move', to: home.id },
    ]);
    press('chundo');
    expect(ch.chainMode!.steps).toEqual([{ kind: 'move', to }]);
    // Полный черновик ⌂ не удлиняет.
    const full = Array.from({ length: game.MAX_CHAIN_STEPS }, () => ({
      kind: 'move' as const,
      to,
    }));
    ch.setChainDraft({ steps: full, gestures: full.map(() => 1) });
    press('chhome');
    expect(ch.chainMode!.steps).toHaveLength(game.MAX_CHAIN_STEPS);
    ch.setChainDraft({ steps: [{ kind: 'move', to }], gestures: [1] });
    press('chsend');
    expect(orders()).toEqual([game.orderChain('p1', fleet.id, [{ kind: 'move', to }])].map(bare));
    expect(env.sounds).toBe(1);
    expect(env.notes).toContain(t('tgt.placed'));
    expect(ch.chainMode).toBeNull();
  });

  it('«Выйти» из режима «Приказ» ничего не отправляет', async () => {
    const { ch, env, fleet, select, press } = await boot();
    select(fleet.id);
    press('target');
    press('chexit');
    expect(ch.chainMode).toBeNull();
    expect([sent.length, env.sounds]).toEqual([0, 0]);
  });

  it('☰ и ✨ переключают свои меню; дальний навык взводит прицел героя, ближний уходит сразу', async () => {
    const { inter, game, env, fleet, select, press } = await boot();
    select(fleet.id);
    press('more');
    expect(inter.cmdMore).toBe(true);
    press('cast');
    expect(inter.castMenu).toBe(true);
    press('castdo', { hero: 'h1', ab: 'corridor' });
    expect(inter.castMenu).toBe(false);
    expect(inter.heroAim).toEqual({ heroId: 'h1', abilityId: 'corridor' });
    expect(env.notes).toContain(t('yard.pick.target'));
    expect(sent).toEqual([]);
    press('castdo', { hero: 'h1', ab: 'rally' });
    expect(orders()).toEqual([game.castHeroAbility('p1', 'h1', 'rally')].map(bare));
  });

  it('форс-марш включается всей группе, пока хоть один идёт без него, и снимается со всех', async () => {
    const { game, env, fleet, select, put, press } = await boot();
    put(twin(fleet, 'x'));
    select(fleet.id, 'x');
    press('boost');
    expect(orders()).toEqual(
      [game.forceMarchFleet('p1', fleet.id, true), game.forceMarchFleet('p1', 'x', true)].map(bare),
    );
    expect(env.notes).toContain(t('hint.forced-march'));
    // Ядро в соло уже включило форс-марш обоим — второе нажатие снимает его со всех.
    sent.length = 0;
    press('boost');
    expect(orders()).toEqual(
      [game.forceMarchFleet('p1', fleet.id, false), game.forceMarchFleet('p1', 'x', false)].map(
        bare,
      ),
    );
    // Смешанная группа: включается тем, кто идёт без форса; идущих форсом не трогают.
    env.world = { ...env.world, forcedMarch: { x: true } } as GameState;
    sent.length = 0;
    press('boost');
    expect(orders()).toEqual([game.forceMarchFleet('p1', fleet.id, true)].map(bare));
  });

  it('авто-штурм ставится всей группе с подсказкой и снимается вторым нажатием', async () => {
    const { go, env, fleet, select, put, press } = await boot();
    put(twin(fleet, 'x'));
    select(fleet.id, 'x');
    press('qauto');
    expect([go.isAutoAssault(fleet.id), go.isAutoAssault('x')]).toEqual([true, true]);
    expect(env.notes).toContain(t('hint.auto-assault'));
    press('qauto');
    expect([go.isAutoAssault(fleet.id), go.isAutoAssault('x')]).toEqual([false, false]);
  });

  it('⮐: порог ставит отход в выбранный свой мир, иначе в столицу; «выкл» снимает; некуда — сказано', async () => {
    const { inter, game, env, home, foe, fleet, select, press } = await boot();
    const at = game.RETREAT_THRESHOLDS[0]!;
    select(fleet.id);
    press('qretr');
    expect(inter.retreatMenu).toBe(true);
    press('retrset', { at: String(at) });
    const capital = game.capitalOf(env.world, 'p1')!;
    expect(orders()).toEqual([game.orderRetreat('p1', fleet.id, true, at, capital)].map(bare));
    expect(env.notes).toContain(
      t('hint.auto-retreat', { n: Math.round(at * 100), at: `«${capital}»` }),
    );
    expect(inter.retreatMenu).toBe(false);
    sent.length = 0;
    press('retrset', { at: 'off' });
    expect(orders()).toEqual([game.orderRetreat('p1', fleet.id, false)].map(bare));
    expect(env.notes).toContain(t('hint.auto-retreat.off'));
    // Выбранный СВОЙ мир важнее столицы, чужой выбор не в счёт. Выбор мира гасит выбор
    // флотов, так что приказов здесь нет — точку отхода называет подсказка.
    const other = home.links![0]!;
    env.world = { ...env.world, capital: { p1: other } } as GameState;
    const named = (to: string) =>
      t('hint.auto-retreat', { n: Math.round(at * 100), at: `«${to}»` });
    inter.pickWorld(home.id);
    press('retrset', { at: String(at) });
    expect(env.notes.at(-1)).toBe(named(home.id));
    inter.pickWorld(foe.id);
    press('retrset', { at: String(at) });
    expect(env.notes.at(-1)).toBe(named(other));
    select(fleet.id);
    env.world = { ...env.world, capital: {} } as GameState;
    sent.length = 0;
    press('retrset', { at: String(at) });
    expect(sent).toEqual([]);
    expect(env.notes).toContain(t('hint.auto-retreat.nowhere'));
  });

  it('«Выбрать+» взводит набор группы с подсказкой', async () => {
    const { inter, env, fleet, select, press } = await boot();
    select(fleet.id);
    press('pick');
    expect(inter.pickMode).toBe(true);
    expect(env.notes).toEqual([t('hint.multiselect')]);
  });
});

describe('REFM-227 — мобильный черновик приказа', () => {
  it('взведённый прицел даёт телефону свой приказ; на ПК черновика нет', async () => {
    const { ca, inter, env } = await boot();
    inter.arm('aiming', true);
    expect(ca.mobileOrderKind()).toBeNull();
    env.mobile = true;
    expect(ca.mobileOrderKind()).toBe('move');
    inter.arm('engageAim', true);
    expect(ca.mobileOrderKind()).toBe('engage');
    inter.arm('assaultAim', true);
    expect(ca.mobileOrderKind()).toBe('assault');
    inter.arm('merging', true);
    expect(ca.mobileOrderKind()).toBe('merge');
    inter.drop('merging');
    expect(ca.mobileOrderKind()).toBeNull();
  });

  it('любая команда, кроме ☰, выбрасывает черновик', async () => {
    const { ca, inter, env, home, fleet, select, press } = await boot();
    env.mobile = true;
    select(fleet.id);
    const target = { kind: 'planet' as const, id: home.links![0]! };
    ca.stageMobileTarget('move', target);
    expect(inter.mobileDraft).toEqual({ order: 'move', fleetIds: [fleet.id], target });
    press('more');
    expect(inter.mobileDraft).not.toBeNull();
    press('split');
    expect(inter.mobileDraft).toBeNull();
  });

  it('«Отправить» с годной целью — приказ курса, черновик и прицел сняты', async () => {
    const { ca, inter, env, home, fleet, select, press } = await boot();
    env.mobile = true;
    select(fleet.id);
    inter.arm('aiming', true);
    const to = home.links![0]!;
    ca.stageMobileTarget('move', { kind: 'planet', id: to });
    press('mobile-send');
    expect(env.world.fleets[fleet.id]?.movement?.to).toBe(to);
    expect([inter.mobileDraft, inter.aiming]).toEqual([null, false]);
    expect(env.panelRenders).toBe(1);
  });

  it('«Отправить» после смены выбора или пропажи цели — «цель устарела», приказа нет', async () => {
    const { ca, inter, env, fleet, select, put, press } = await boot();
    env.mobile = true;
    put(twin(fleet, 'x'));
    select(fleet.id);
    inter.arm('merging', true);
    ca.stageMobileTarget('merge', { kind: 'fleet', id: 'x' });
    select(fleet.id, 'x');
    press('mobile-send');
    expect(env.notes).toEqual([t('hud.mobile.target-stale')]);
    expect(inter.mobileDraft).toBeNull();
    select(fleet.id);
    inter.arm('merging', true);
    ca.stageMobileTarget('merge', { kind: 'fleet', id: 'gone' });
    press('mobile-send');
    expect(env.notes).toHaveLength(2);
    expect(inter.mobileDraft).toBeNull();
    expect(sent).toEqual([]);
  });

  it('«Отмена» снимает черновик и прицел без приказа', async () => {
    const { ca, inter, env, home, fleet, select, press } = await boot();
    env.mobile = true;
    select(fleet.id);
    inter.arm('aiming', true);
    ca.stageMobileTarget('move', { kind: 'planet', id: home.links![0]! });
    press('mobile-cancel');
    expect([inter.mobileDraft, inter.aiming]).toEqual([null, false]);
    expect(sent).toEqual([]);
  });

  it('годность цели: дорога — только курсу и по настоящей связи; мир — курсу, штурму по правилу; флот — слиянию свой, бою видимый чужой', async () => {
    const { ca, env, home, foe, fleet, select, put } = await boot();
    const to = home.links![0]!;
    const far = Object.keys(env.world.planets).find(
      (id) => id !== home.id && !home.links!.includes(id),
    )!;
    expect(ca.mobileTargetAvailable({ kind: 'lane', from: home.id, to, t: 0.5 }, 'move')).toBe(
      true,
    );
    expect(ca.mobileTargetAvailable({ kind: 'lane', from: home.id, to, t: 0.5 }, 'assault')).toBe(
      false,
    );
    expect(ca.mobileTargetAvailable({ kind: 'lane', from: home.id, to: far, t: 0.5 }, 'move')).toBe(
      false,
    );
    expect(ca.mobileTargetAvailable({ kind: 'planet', id: foe.id }, 'move')).toBe(true);
    expect(ca.mobileTargetAvailable({ kind: 'planet', id: foe.id }, 'assault')).toBe(true);
    expect(ca.mobileTargetAvailable({ kind: 'planet', id: home.id }, 'assault')).toBe(false);
    env.capturable = false;
    expect(ca.mobileTargetAvailable({ kind: 'planet', id: foe.id }, 'assault')).toBe(false);
    expect(ca.mobileTargetAvailable({ kind: 'planet', id: 'gone' }, 'move')).toBe(false);
    put(twin(fleet, 'x'));
    select(fleet.id);
    expect(ca.mobileTargetAvailable({ kind: 'fleet', id: 'x' }, 'merge')).toBe(true);
    expect(ca.mobileTargetAvailable({ kind: 'fleet', id: fleet.id }, 'merge')).toBe(false);
    expect(ca.mobileTargetAvailable({ kind: 'fleet', id: 'x' }, 'engage')).toBe(false);
    const enemy = Object.values(env.world.fleets).find((f) => f.owner === 'p2')!;
    put({ ...enemy, location: home.id });
    expect(ca.mobileTargetAvailable({ kind: 'fleet', id: enemy.id }, 'engage')).toBe(true);
    expect(ca.mobileTargetAvailable({ kind: 'fleet', id: enemy.id }, 'merge')).toBe(false);
    put({ ...enemy, location: home.id, units: [] });
    expect(ca.mobileTargetAvailable({ kind: 'fleet', id: enemy.id }, 'engage')).toBe(false);
    // У чужой столицы — за туманом: невидимого не атакуют.
    put({ ...enemy, location: foe.id });
    (await import('./mapFog')).refreshVision();
    expect(ca.mobileTargetAvailable({ kind: 'fleet', id: enemy.id }, 'engage')).toBe(false);
  });

  it('подпись и точка цели на экране', async () => {
    const { ca, env, home, fleet, select } = await boot();
    const { world } = await import('./mapCamera');
    const { fleetAnchor } = await import('./fleetGeometry');
    const to = home.links![0]!;
    expect(ca.mobileTargetLabel({ kind: 'planet', id: to })).toBe(`«${to}»`);
    expect(ca.mobileTargetLabel({ kind: 'fleet', id: fleet.id })).toBe(`флот ${fleet.id}`);
    expect(ca.mobileTargetLabel({ kind: 'lane', from: home.id, to, t: 0.5 })).toBe(
      t('hud.mobile.lane', { from: `«${home.id}»`, to: `«${to}»` }),
    );
    expect(ca.mobileDraftPoint()).toBeNull();
    select(fleet.id);
    ca.stageMobileTarget('move', { kind: 'planet', id: to });
    expect(ca.mobileDraftPoint()).toEqual(world(env.world.planets[to]!.position));
    ca.stageMobileTarget('engage', { kind: 'fleet', id: fleet.id });
    expect(ca.mobileDraftPoint()).toEqual(fleetAnchor(fleet));
  });
});

describe('REFM-227 — бой по выбранной цели', () => {
  it('у цели бой получает один флот, дальние идут маршем; цель в пути — только подсказка', async () => {
    const { ca, game, env, home, fleet, select, put } = await boot();
    const enemy = Object.values(env.world.fleets).find((f) => f.owner === 'p2')!;
    put({ ...enemy, location: home.id });
    put(twin(fleet, 'x', home.links![0]!));
    put(twin(fleet, 'y'));
    select(fleet.id, 'x', 'y');
    const engageType = game.engageFleet('p1', '', '').type;
    const engaged = () => orders().filter((a) => a.type === engageType);
    // Отказ ядра (мир не в войне) передаёт очередь следующему флоту у цели.
    ca.engageTarget(env.world.fleets[enemy.id]!);
    expect(engaged()).toEqual(
      [game.engageFleet('p1', fleet.id, enemy.id), game.engageFleet('p1', 'y', enemy.id)].map(bare),
    );
    expect(orders()).toContainEqual(bare(game.moveFleet('p1', 'x', home.id)));
    expect(orders()).not.toContainEqual(bare(game.moveFleet('p1', 'y', home.id)));
    // В войне первый принятый приказ — единственный: остальных у цели втянет сам бой.
    // Стойку ставим прямо в мир: объявление войны приказом само завязало бы бой у цели.
    env.world = {
      ...env.world,
      diplomacy: { ...env.world.diplomacy, [pairKey('p1', 'p2')]: 'war' },
    };
    sent.length = 0;
    ca.engageTarget(env.world.fleets[enemy.id]!);
    expect(engaged()).toEqual([bare(game.engageFleet('p1', fleet.id, enemy.id))]);
    // Цель в пути: приказов нет, только подсказка.
    sent.length = 0;
    ca.engageTarget({ ...env.world.fleets[enemy.id]!, location: null });
    expect(sent).toEqual([]);
    expect(env.notes).toContain(t('hint.engage-in-flight'));
  });
});

describe('REFM-227 — стык с main.ts', () => {
  const MAIN = readFileSync(new URL('./main.ts', import.meta.url), 'utf8');
  const SRC = readFileSync(new URL('./cmdActions.ts', import.meta.url), 'utf8');
  const init = /initCmdActions\(\{([\s\S]*?)\n\}\);/.exec(MAIN)?.[1] ?? '';

  it('делегат ряда вешает сам модуль', async () => {
    const { page } = await boot();
    expect(page.listeners.map(([type]) => type)).toEqual(['click']);
    expect(MAIN).not.toMatch(/addEventListener\('click', onCommandClick\)/);
  });

  it('хуки — мир, место, раскладка, лента, имена, сектор, панель, деление, мины, звук', () => {
    for (const hook of [
      'world: () => s,',
      'me: () => ME,',
      'mobile: () => MOBILE,',
      'note,',
      'placeName,',
      'fleetTitleOf,',
      'capturable: (id) => !!sectorTypeOf(id)?.capturable,',
      'renderPanel,',
      'invalidatePanel,',
      'renderSplitDialog,',
      'openMineFleet: (id) => mineControls.openFleet(id),',
      "sentSound: () => snd.play('send'),",
    ])
      expect(init).toContain(hook);
  });

  it('нажатия и черновик уехали целиком; модуль не тянет main.ts', () => {
    for (const fn of [
      'onCommandClick',
      'mobileOrderKind',
      'stageMobileTarget',
      'mobileTargetAvailable',
      'mobileDraftPoint',
      'mobileTargetLabel',
      'engageTarget',
      'cancelMobileOrder',
      'sendMobileOrder',
    ])
      expect(MAIN).not.toMatch(new RegExp(`function ${fn}\\(`));
    expect(SRC).not.toMatch(/from '\.\/main'/);
  });
});
