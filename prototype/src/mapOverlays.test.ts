/**
 * Наложения карты (REFM-233, часть 1) — прямой тест владельца на живом мире прототипа.
 *
 * Что рисовать, решают чистые модели (`combatRanges.ts`, `patrolMarks.ts`, `corridorView.ts`,
 * `abilityRings.ts`, `strikeTrail.ts`), и у них свои тесты. Здесь — то, что собирается только
 * вместе: модель, камера, туман и выбор дают холсту ровно те круги, линии и подписи, что
 * обещают, в своём цвете и пунктире, и в той точке экрана, где стоит их мир. Холст
 * поддельный и записывает вызовы вместе с цветом и шириной линии в момент вызова; мир,
 * камера, туман и выбор — настоящие. Каждый тест — свежая загрузка модулей.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';

import type { GameState, ShuttleStrike, Squadron } from '../../packages/shared-core/src/index';
import { rgba } from '../../packages/client/src/holoDraw';
import { routeStroke } from '../../decisions/fleetRoute';
import type { AimedSquadron } from './mapOverlays';
import type { RangeRing } from './combatRanges';

interface Call {
  name: string;
  args: unknown[];
  stroke: unknown;
  fill: unknown;
  width: unknown;
}

/** Холст, чей контекст записывает каждый вызов с цветом и шириной линии в момент вызова. */
function fakeCanvas() {
  const calls: Call[] = [];
  const props: Record<string, unknown> = { globalAlpha: 1, lineWidth: 1, strokeStyle: '#000', fillStyle: '#000' };
  const ctx = new Proxy(props, {
    get(target, name) {
      if (typeof name !== 'string') return undefined;
      if (name in target) return target[name];
      return (...args: unknown[]) => {
        calls.push({ name, args, stroke: target.strokeStyle, fill: target.fillStyle, width: target.lineWidth });
        if (name.startsWith('create')) return { addColorStop() {} };
        if (name === 'measureText') return { width: 40 };
        return undefined;
      };
    },
    set(target, name, value) {
      target[name as string] = value;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
  const named = (name: string) => calls.filter((c) => c.name === name);
  return { ctx, calls, named };
}

beforeAll(async () => {
  vi.stubGlobal('__PLAYER_BUILD__', false);
  await import('./mapOverlays');
  await import('./game');
  vi.unstubAllGlobals();
}, 60_000);
beforeEach(() => {
  vi.resetModules();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

async function boot(opts: { net?: boolean } = {}) {
  vi.stubGlobal('__PLAYER_BUILD__', false); // туман читает профиль сборки
  vi.stubGlobal('Path2D', class {}); // корпуса кораблей — пути холста
  const game = await import('./game');
  const world: GameState = game.newGame({
    seats: [
      { id: 'p1', name: 'A', faction: 'azure', start: game.START_CANDIDATES[0]!, ai: false },
      { id: 'p2', name: 'B', faction: 'crimson', start: game.START_CANDIDATES[1]!, ai: false },
    ],
  });
  const env = { world, now: world.time, aa: [] as RangeRing[], aim: null as AimedSquadron | null };
  const frame = fakeCanvas();
  const nodes = (await import('./mapCatalog')).mapNodesFromState(world);
  const camera = await import('./mapCamera');
  camera.initMapCamera({
    vw: () => 1600,
    vh: () => 900,
    mobile: () => false,
    console: () => false,
    world: () => env.world,
    me: () => 'p1',
  } as never);
  camera.frameMap(nodes);
  camera.setView({ scale: 1, x: 0, y: 0 });
  const fog = await import('./mapFog');
  fog.initMapFog({ world: () => env.world, me: () => 'p1', net: () => opts.net ?? false, contacts: () => [], sight: () => [] });
  fog.refreshVision();
  const geo = await import('./fleetGeometry');
  geo.initFleetGeometry({
    world: () => env.world,
    me: () => 'p1',
    now: () => env.now,
    lod: () => ({ scale: 1, art: 1, detail: 1, provinceDetail: 1, markerRadius: 3 }),
    forkMarks: () => [],
    orbits: () => new Map() as never,
  });
  (await import('./mapPalette')).initMapPalette({ world: () => env.world, me: () => 'p1', ctx: () => frame.ctx, dpr: () => 1 } as never);
  const ov = await import('./mapOverlays');
  ov.initMapOverlays({
    world: () => env.world,
    me: () => 'p1',
    ctx: () => frame.ctx,
    now: () => env.now,
    aa: () => env.aa,
    aimSquadron: () => env.aim,
  });
  const palette = await import('./mapPalette');
  const pick = await import('./interaction');
  const home = Object.values(world.planets).find((p) => p.owner === 'p1')!;
  const next = world.planets[home.links![0]!]!;
  /** Экранная точка мира. */
  const at = (p: { x: number; y: number }) => camera.world(p);
  return { game, ov, camera, fog, geo, palette, pick, env, frame, home, next, at };
}

/** Есть ли дуга радиуса `r` с центром в `c` (с точностью до 1e-6). */
const arcAt = (calls: Call[], c: { x: number; y: number }, r: number) =>
  calls.some((k) => k.name === 'arc' && Math.abs((k.args[0] as number) - c.x) < 1e-6 && Math.abs((k.args[1] as number) - c.y) < 1e-6 && Math.abs((k.args[2] as number) - r) < 1e-6);

const strike = (over: Partial<ShuttleStrike>): ShuttleStrike =>
  ({
    id: 'st:1',
    owner: 'p1',
    squadronId: 'sq:p1:1',
    units: [{ unit: 'interceptor', count: 2 }],
    target: { kind: 'point' },
    leg: 'out',
    ...over,
  }) as ShuttleStrike;

describe('REFM-233 — наложения на карте', () => {
  it('уголки цели: четыре уголка вокруг точки, своим цветом или цветом захвата', async () => {
    const { ov, palette, frame } = await boot();
    ov.targetBrackets(100, 200, 14, 0);
    expect(frame.named('translate')[0]!.args).toEqual([100, 200]);
    const strokes = frame.named('stroke');
    expect(strokes).toHaveLength(4);
    expect(strokes.every((c) => c.stroke === palette.LOCK)).toBe(true);
    frame.calls.length = 0;
    ov.targetBrackets(100, 200, 14, 0, palette.HOSTILE);
    expect(frame.named('stroke').every((c) => c.stroke === palette.HOSTILE)).toBe(true);
  });

  it('волна боя: орбитальная — сплошные кольца, наземная — пунктир и линия фронта под миром', async () => {
    const { ov, frame } = await boot();
    const { BATTLE_RINGS } = await import('./battleMark');
    ov.drawBattlePulse(300, 300, 0.5);
    expect(frame.named('arc').filter((c) => c.args[0] === 300 && c.args[1] === 300)).toHaveLength(BATTLE_RINGS);
    expect(frame.named('setLineDash')).toHaveLength(0);
    expect(frame.named('moveTo')).toHaveLength(0);
    frame.calls.length = 0;
    ov.drawBattlePulse(300, 300, 0.5, 'ground');
    expect(frame.named('arc')).toHaveLength(BATTLE_RINGS);
    const dash = (await import('./battleMark')).phaseLook('ground').dash!;
    expect(frame.named('setLineDash').filter((c) => JSON.stringify(c.args) === JSON.stringify([[...dash]]))).toHaveLength(BATTLE_RINGS);
    expect(frame.named('moveTo').map((c) => c.args)).toEqual([[290, 316]]);
    expect(frame.named('lineTo').map((c) => c.args)).toEqual([[310, 316]]);
  });

  it('маршрут своего флота — пунктиром по дороге до цели, выбранный ярче; чужой не виден', async () => {
    const { ov, pick, env, frame, home, next, at, game } = await boot();
    const own = Object.values(env.world.fleets).find((f) => f.owner === 'p1' && f.location === home.id)!;
    const moved = game.order(env.world, { id: 'm1', type: 'fleet.move', playerId: 'p1', payload: { fleetId: own.id, to: next.id }, issuedAt: env.world.time } as never, env.world.time);
    expect(moved.error).toBeUndefined();
    env.world = moved.state;
    ov.drawFleetRoutes();
    const plain = routeStroke(false);
    const lines = frame.named('stroke');
    expect(lines.length).toBe(2); // путь и кружок цели
    expect(lines[0]!.width).toBe(plain.width);
    expect(frame.named('setLineDash')[0]!.args).toEqual([[4, 6]]);
    // Путь кончается в мире цели, там же кружок цели.
    const end = at(next.position);
    const last = frame.named('lineTo').at(-1)!.args as number[];
    expect(Math.hypot(last[0]! - end.x, last[1]! - end.y)).toBeLessThan(1);
    expect(arcAt(frame.calls, { x: last[0]!, y: last[1]! }, 4)).toBe(true);
    frame.calls.length = 0;
    pick.pickFleets([own.id], () => true);
    ov.drawFleetRoutes();
    expect(frame.named('stroke')[0]!.width).toBe(routeStroke(true).width);
    // Флот в выбранной группе — так же ярче.
    frame.calls.length = 0;
    pick.pickFleets([own.id, 'другой'], () => true);
    ov.drawFleetRoutes();
    expect(frame.named('stroke')[0]!.width).toBe(routeStroke(true).width);
    // Чужой флот в пути — его план не показывается.
    frame.calls.length = 0;
    env.world = { ...env.world, fleets: { [own.id]: { ...env.world.fleets[own.id]!, owner: 'p2' } } };
    ov.drawFleetRoutes();
    expect(frame.named('stroke')).toHaveLength(0);
  });

  it('трасса вылета: линия от базы к цели, корпус и позывной с числом бортов; выбранный — в уголках', async () => {
    const { ov, pick, palette, env, frame, home, next, at, camera } = await boot();
    const { squadronCallsignOf } = await import('./squadronPanel');
    env.world = {
      ...env.world,
      strikes: [strike({ base: { kind: 'planet', id: home.id }, to: { ...next.position }, departedAt: env.now - 1000, arrivesAt: env.now + 3000 })],
    };
    ov.drawStrikeTrails(0);
    const a = at(home.position);
    const b = at(next.position);
    expect(frame.named('moveTo')[0]!.args).toEqual([a.x, a.y]);
    expect(frame.named('lineTo')[0]!.args).toEqual([b.x, b.y]);
    expect(frame.named('stroke')[0]!.stroke).toBe(rgba(palette.R_WING, 0.55));
    expect(frame.named('fillText').map((c) => c.args[0])).toEqual([`${squadronCallsignOf('sq:p1:1')} ·2`]);
    const brackets = () => frame.named('translate').length;
    const before = brackets();
    frame.calls.length = 0;
    pick.pickStrike('st:1');
    ov.drawStrikeTrails(0);
    expect(frame.named('stroke')[0]!.stroke).toBe(rgba(palette.R_WING, 0.85));
    expect(brackets()).toBe(before + 1); // уголки выбранной эскадры
    // Мельче зума 0.9 позывного нет: подписи слиплись бы.
    frame.calls.length = 0;
    camera.setView({ scale: 0.8, x: 0, y: 0 });
    ov.drawStrikeTrails(0);
    expect(frame.named('fillText')).toHaveLength(0);
    camera.setView({ scale: 1, x: 0, y: 0 });
    // Обратная нога бледнее летящей в бой.
    frame.calls.length = 0;
    env.world = { ...env.world, strikes: [{ ...env.world.strikes![0]!, leg: 'back' }] };
    pick.pickWorld(home.id);
    ov.drawStrikeTrails(0);
    expect(frame.named('stroke')[0]!.stroke).toBe(rgba(palette.R_WING, 0.3));
  });

  it('круги патрулей: висящий — сплошной с заливкой и отсчётом, летящий к точке — пунктир без отсчёта', async () => {
    const { ov, palette, env, frame, home, next, at, camera } = await boot();
    const { countdownHMS } = await import('./format');
    const patrol = strike({
      base: { kind: 'planet', id: home.id },
      to: { ...next.position },
      departedAt: env.now - 1000,
      arrivesAt: env.now + 3000,
      leg: 'patrol',
      patrol: { hours: 4, radius: 60 },
    });
    env.world = { ...env.world, strikes: [patrol] };
    ov.drawPatrolRings();
    const c = at(next.position);
    expect(arcAt(frame.calls, c, camera.worldDist(60))).toBe(true);
    expect(frame.named('fill')).toHaveLength(1);
    expect(frame.named('setLineDash')[0]!.args).toEqual([[]]);
    expect(frame.named('fillText').map((k) => k.args[0])).toEqual([countdownHMS(3000)]);
    expect(frame.named('stroke')[0]!.stroke).toBe(rgba(palette.R_WING, 0.6));
    frame.calls.length = 0;
    env.world = { ...env.world, strikes: [{ ...patrol, leg: 'out' }] };
    ov.drawPatrolRings();
    expect(frame.named('setLineDash')[0]!.args).toEqual([[6, 6]]);
    expect(frame.named('fill')).toHaveLength(0);
    expect(frame.named('fillText')).toHaveLength(0);
    // Круг без радиуса — не круг: у прицела патруля (`drawPatrolAim`) он бывает нулевым.
    frame.calls.length = 0;
    ov.drawPatrolCircle(c, 0, 'aim');
    expect(frame.calls).toHaveLength(0);
  });

  it('чужой патруль в обзоре — круг цветом хозяина и число бортов, без отсчёта', async () => {
    const { ov, palette, fog, env, frame, next, at, camera } = await boot({ net: true });
    env.world = { ...env.world, seenPatrols: [{ owner: 'p2', at: { ...next.position }, radius: 80, units: [{ unit: 'interceptor', count: 3 }] }] };
    fog.refreshVision();
    ov.drawSeenPatrols();
    expect(arcAt(frame.calls, at(next.position), camera.worldDist(80))).toBe(true);
    expect(frame.named('stroke')[0]!.stroke).toBe(rgba(palette.ownerColor('p2'), 0.6));
    expect(frame.named('fillText').map((k) => k.args[0])).toEqual(['·3']);
    // Мельче зума 0.9 подписи нет.
    frame.calls.length = 0;
    camera.setView({ scale: 0.8, x: 0, y: 0 });
    ov.drawSeenPatrols();
    expect(frame.named('fillText')).toHaveLength(0);
  });

  it('коридоры героев: одноразовый мигает без срока, временный — со сроком; чужой в тумане не виден', async () => {
    const { ov, palette, env, frame, home, next } = await boot();
    const { fmtHrs } = await import('./format');
    const { HOUR } = await import('./game');
    const lane = { id: 'c1', owner: 'p1', from: home.id, to: next.id, speedBonus: 0.5, expiresAt: env.now + 3 * HOUR, addedLink: true };
    env.world = { ...env.world, tempLanes: [{ ...lane, tier: 1 }] };
    ov.drawCorridors(0);
    expect(frame.named('setLineDash')[0]!.args).toEqual([[7, 6]]);
    expect(frame.named('stroke')[0]!.stroke).toBe(rgba(palette.CORR_ONCE, 0.35));
    expect(frame.named('fillText')).toHaveLength(0);
    frame.calls.length = 0;
    env.world = { ...env.world, tempLanes: [{ ...lane, tier: 2 }] };
    ov.drawCorridors(0);
    expect(frame.named('setLineDash')[0]!.args).toEqual([[10, 6]]);
    expect(frame.named('stroke')[0]!.stroke).toBe(rgba(palette.CORR_LIVE, 0.6));
    expect(frame.named('fillText').map((k) => k.args[0])).toEqual([fmtHrs(3)]);
    // Чужой коридор между мирами, которых игрок не видит, — тайна.
    frame.calls.length = 0;
    const far = Object.values(env.world.planets).filter((p) => p.owner === 'p2')[0]!;
    env.world = { ...env.world, tempLanes: [{ ...lane, owner: 'p2', from: far.id, to: far.links![0]!, tier: 2 }] };
    ov.drawCorridors(0);
    expect(frame.named('stroke')).toHaveLength(0);
  });

  it('радиусы оружия: отметка ПКО из кэша кадра и круг взведённого прицела — от базы, у перелёта вдвое шире', async () => {
    const { ov, palette, pick, env, frame, home, at, camera, game } = await boot();
    const { squadronReach } = await import('../../packages/shared-core/src/index');
    env.aa = [{ kind: 'aa', x: home.position.x, y: home.position.y, radius: 0, sourceId: home.id }];
    ov.drawCombatRanges();
    expect(arcAt(frame.calls, at(home.position), 13)).toBe(true);
    expect(frame.named('stroke')[0]!.stroke).toBe(rgba(palette.R_AA, 0.7));
    expect(frame.named('setLineDash')[0]!.args).toEqual([[2, 3]]);
    // Прицел удара: кольцо дальности эскадры вокруг её базы.
    frame.calls.length = 0;
    env.aa = [];
    const sq = { id: 'sq:p1:1', units: [{ unit: 'interceptor', count: 2 }] } as Squadron;
    env.aim = { sq, base: { planetId: home.id }, aloft: null };
    const reach = squadronReach(sq, game.data);
    expect(reach).toBeGreaterThan(0);
    ov.drawCombatRanges();
    expect(arcAt(frame.calls, at(home.position), camera.worldDist(reach))).toBe(true);
    expect(frame.named('stroke')[0]!.stroke).toBe(rgba(palette.R_WING, 0.85));
    frame.calls.length = 0;
    pick.arm('strikeAim', { squadronId: sq.id, relocate: true } as never);
    ov.drawCombatRanges();
    expect(arcAt(frame.calls, at(home.position), camera.worldDist(2 * reach))).toBe(true);
    // Ничего не выбрано и не взведено — колец нет.
    frame.calls.length = 0;
    env.aim = null;
    ov.drawCombatRanges();
    expect(frame.calls).toHaveLength(0);
  });

  it('круг способности — один вид: фиолетовый пунктир, заливка только по просьбе', async () => {
    const { ov, palette, frame } = await boot();
    ov.drawAbilityCircle(50, 60, 30);
    expect(frame.named('setLineDash')[0]!.args).toEqual([[7, 6]]);
    expect(frame.named('stroke')[0]!.stroke).toBe(rgba(palette.ABILITY_RING, 0.85));
    expect(frame.named('fill')).toHaveLength(0);
    frame.calls.length = 0;
    ov.drawAbilityCircle(50, 60, 30, 0.14);
    expect(frame.named('fill')[0]!.fill).toBe(rgba(palette.ABILITY_RING, 0.14));
    frame.calls.length = 0;
    ov.drawAbilityCircle(50, 60, 0);
    expect(frame.calls).toHaveLength(0);
  });

  it('живые способности: аура идёт за флотом героя, скан прибит к узлу, просроченные гаснут', async () => {
    const { ov, env, frame, home, next, at, camera, geo } = await boot();
    const own = Object.values(env.world.fleets).find((f) => f.owner === 'p1' && f.location === home.id)!;
    const hero = {
      id: 'h1',
      owner: 'p1',
      alive: true,
      fleetId: own.id,
      activeAuras: [
        { until: env.now + 1000, radius: 50 },
        { until: env.now - 1, radius: 70 },
      ],
      activeReveals: [{ until: env.now + 1000, radius: 90, center: next.id }],
    };
    env.world = { ...env.world, heroes: { h1: hero as never } };
    ov.drawAbilityRings();
    expect(arcAt(frame.calls, geo.fleetOriginPx(own)!, camera.worldDist(50))).toBe(true);
    expect(arcAt(frame.calls, at(next.position), camera.worldDist(90))).toBe(true);
    expect(frame.named('arc')).toHaveLength(2);
    // Чужой герой — не моя справка.
    frame.calls.length = 0;
    env.world = { ...env.world, heroes: { h1: { ...hero, owner: 'p2' } as never } };
    ov.drawAbilityRings();
    expect(frame.calls).toHaveLength(0);
  });

  it('сеть Роя: разведанный центр данных — круг связи цветом Роя; без Роя в партии — ничего', async () => {
    const { ov, palette, fog, env, frame, next, at, camera, game } = await boot();
    ov.drawSwarmNet();
    expect(frame.calls).toHaveLength(0);
    const relay = game.data.buildings.swarm_datacenter!.relayRange!;
    env.world = {
      ...env.world,
      pve: { waveNumber: 1, totalWaves: 3, npcPlayerId: 'p2' } as never,
      planets: { ...env.world.planets, [next.id]: { ...next, owner: 'p2', buildings: [{ type: 'swarm_datacenter', level: 1, hp: 30 }] } },
    };
    fog.refreshVision();
    ov.drawSwarmNet();
    expect(arcAt(frame.calls, at(next.position), camera.worldDist(relay))).toBe(true);
    expect(frame.named('stroke')[0]!.stroke).toBe(rgba(palette.ownerColor('p2'), 0.5));
    expect(frame.named('setLineDash').map((c) => c.args)).toEqual([[[2, 6]], [[6, 8]]]);
  });
});

describe('REFM-233 — стык наложений с main.ts', () => {
  const MAIN = readFileSync(new URL('./main.ts', import.meta.url), 'utf8');
  const SRC = readFileSync(new URL('./mapOverlays.ts', import.meta.url), 'utf8');
  const init = /initMapOverlays\(\{([\s\S]*?)\n\}\);/.exec(MAIN)?.[1] ?? '';

  it('хуки — мир, место, кадр, часы карты, ПКО из кэша кадра и эскадра прицела', () => {
    for (const hook of [
      'world: () => s,',
      'me: () => ME,',
      'ctx: () => cx,',
      'now: () => mapNow(),',
      "aa: () => perWorld('aa', () => aaRings(s, data, ME, known)),",
      'aimSquadron,',
    ])
      expect(init, hook).toContain(hook);
  });

  it('рисовалки живут только в модуле, кадр зовёт их оттуда', () => {
    expect(MAIN).not.toMatch(
      /\bfunction (targetBrackets|drawBattlePulse|drawSwarmNet|drawFleetRoutes|drawStrikeTrails|drawPatrolRings|drawPatrolCircle|drawSeenPatrols|drawCorridors|drawCombatRanges|drawAbilityCircle|drawAbilityRings)\(/,
    );
    expect(MAIN).not.toContain('const PATROL_LOOK');
    for (const call of ['drawSwarmNet();', 'drawFleetRoutes();', 'drawPatrolRings();', 'drawSeenPatrols();', 'drawCombatRanges();', 'drawAbilityRings();'])
      expect(MAIN, call).toContain(call);
  });

  it('модуль не тянет `main.ts`', () => {
    expect(SRC).not.toMatch(/from '\.\/main'/);
  });
});
