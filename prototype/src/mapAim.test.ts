/**
 * Прицелы и цели карты (REFM-233, часть 2) — прямой тест владельца на живом мире прототипа.
 *
 * КОГО и КУДА можно, решают чистые правила (`engageAim.ts`, `assaultRings.ts`,
 * `relocateTargets.ts`, `aimPreview.ts`), и у них свои тесты. Здесь — то, что собирается
 * только вместе: взведённый режим, выбор, мир и камера дают холсту ровно те уголки, круги,
 * пути и подписи, что обещает прицел, своим цветом и в той точке экрана, где стоит цель.
 * Холст поддельный и записывает вызовы вместе с цветом и шириной линии в момент вызова; мир,
 * камера, туман, выбор и взведённые режимы — настоящие. Указатель и точку черновика телефона
 * подставляет тест: их пишет ввод на холсте и ряд команд, у которых свои тесты. Каждый тест
 * — свежая загрузка модулей.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';

import type { Fleet, GameState, Squadron } from '../../packages/shared-core/src/index';
import { rgba } from '../../packages/client/src/holoDraw';
import { isEmplacementFleet } from '../../decisions/emplacement';
import { orbitSeats } from '../../decisions/orbitSeats';
import type { AimedSquadron } from './mapOverlays';

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

type XY = { x: number; y: number };

async function boot() {
  vi.stubGlobal('__PLAYER_BUILD__', false); // туман читает профиль сборки
  vi.stubGlobal('Path2D', class {}); // корпуса кораблей — пути холста
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
    capturable: (_id: string) => true,
    aim: null as AimedSquadron | null,
    pointer: null as XY | null,
    touch: false,
    draft: null as XY | null,
  };
  // Указатель пишет ввод на холсте, точку черновика — ряд команд: здесь их ставит тест.
  vi.doMock('./mapInput', () => ({
    get aimPointer() {
      return env.pointer;
    },
    get tapByTouch() {
      return env.touch;
    },
  }));
  vi.doMock('./cmdActions', () => ({ mobileDraftPoint: () => env.draft }));
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
  const { sightCircles } = await import('../../packages/shared-core/src/index');
  fog.initMapFog({
    world: () => env.world,
    me: () => 'p1',
    net: () => false,
    contacts: () => [],
    sight: () => sightCircles(env.world, 'p1', game.data),
  });
  fog.refreshVision();
  const geo = await import('./fleetGeometry');
  geo.initFleetGeometry({
    world: () => env.world,
    me: () => 'p1',
    now: () => env.world.time,
    lod: () => ({ scale: 1, art: 1, detail: 1, provinceDetail: 1, markerRadius: 3 }),
    forkMarks: () => [],
    orbits: () => orbitSeats(Object.values(env.world.fleets), (g) => isEmplacementFleet(g, game.data)),
  });
  const palette = await import('./mapPalette');
  palette.initMapPalette({ world: () => env.world, me: () => 'p1', ctx: () => frame.ctx, dpr: () => 1 } as never);
  const ov = await import('./mapOverlays');
  ov.initMapOverlays({
    world: () => env.world,
    me: () => 'p1',
    ctx: () => frame.ctx,
    now: () => env.world.time,
    aa: () => [],
    aimSquadron: () => env.aim,
  });
  const aim = await import('./mapAim');
  aim.initMapAim({
    world: () => env.world,
    me: () => 'p1',
    ctx: () => frame.ctx,
    nodes: () => nodes,
    mobile: () => env.mobile,
    capturable: (id) => env.capturable(id),
    aimSquadron: () => env.aim,
  });
  const pick = await import('./interaction');
  const home = Object.values(world.planets).find((p) => p.owner === 'p1')!;
  const next = world.planets[home.links![0]!]!;
  const own = Object.values(world.fleets).find((f) => f.owner === 'p1' && f.location === home.id)!;
  /** Экранная точка мира. */
  const at = (p: XY) => camera.world(p);
  /** Поставить флот в мир и обновить обзор. */
  const put = (f: Fleet) => {
    env.world = { ...env.world, fleets: { ...env.world.fleets, [f.id]: f } };
    fog.refreshVision();
    return env.world.fleets[f.id]!;
  };
  return { game, aim, ov, camera, fog, geo, palette, pick, env, frame, home, next, own, at, put };
}

/** Война сторон: прогноз боя считается только между врагами. */
const atWar = (world: GameState): GameState => ({ ...world, diplomacy: { ...(world.diplomacy ?? {}), 'p1|p2': 'war' } });

/** Чужой флот у соседнего с домом мира — в обзоре. */
function foeAt(world: GameState, location: string): Fleet {
  const foe = Object.values(world.fleets).find((f) => f.owner === 'p2')!;
  return { ...foe, location };
}

/** Есть ли дуга радиуса `r` с центром в `c` (с точностью до 1e-6). */
const arcAt = (calls: Call[], c: XY, r: number) =>
  calls.some(
    (k) =>
      k.name === 'arc' &&
      Math.abs((k.args[0] as number) - c.x) < 1e-6 &&
      Math.abs((k.args[1] as number) - c.y) < 1e-6 &&
      Math.abs((k.args[2] as number) - r) < 1e-6,
  );

/** Центры уголков цели (каждый набор уголков начинается со сдвига в центр). */
const bracketCentres = (calls: Call[]) => calls.filter((c) => c.name === 'translate').map((c) => c.args);

const SQ = { id: 'sq:p1:1', units: [{ unit: 'interceptor', count: 2 }] } as Squadron;

describe('REFM-233 — прицелы и цели на карте', () => {
  it('цели «Атаки»: видимый чужой флот с кораблями; пустой, ракета и флот в тумане — нет', async () => {
    const { aim, geo, fog, env, home, next, put } = await boot();
    const foe = put(foeAt(env.world, next.id));
    const list = aim.engageCandidates();
    expect(list.map((c) => c.id)).toEqual([foe.id]);
    const anchor = geo.fleetAnchor(foe)!;
    expect(list[0]).toMatchObject({ location: next.id, x: anchor.x, y: anchor.y, fleet: foe });
    expect(list[0]!.ships).toBe(foe.units.reduce((a, u) => a + u.count, 0));
    // Пустой флот бить некем.
    put({ ...foe, units: foe.units.map((u) => ({ ...u, count: 0 })) });
    expect(aim.engageCandidates()).toEqual([]);
    // Ракету корабли не бьют — даже над своим миром, где её видно.
    const missile = put({ ...foe, location: home.id, units: [{ unit: 'missile', count: 1 }] });
    expect(fog.fleetSeen(missile)).toBe(true);
    expect(aim.engageCandidates()).toEqual([]);
    // Флот у своего дома, в тумане, — не цель.
    const far = Object.values(env.world.planets).find((p) => p.owner === 'p2')!;
    put({ ...foe, location: far.id });
    expect(aim.engageCandidates()).toEqual([]);
  });

  it('уголки целей «Атаки» — красные у каждой цели и только пока «Атака» взведена', async () => {
    const { aim, geo, palette, pick, env, frame, next, put } = await boot();
    const foe = put(foeAt(env.world, next.id));
    aim.drawEngageTargets(0);
    expect(frame.calls).toHaveLength(0);
    pick.arm('engageAim', true);
    aim.drawEngageTargets(0);
    const anchor = geo.fleetAnchor(foe)!;
    expect(bracketCentres(frame.calls)).toEqual([[anchor.x, anchor.y]]);
    const strokes = frame.named('stroke');
    expect(strokes).toHaveLength(4);
    expect(strokes.every((c) => c.stroke === palette.HOSTILE)).toBe(true);
  });

  it('миры под «Штурм» — пунктирный круг у чужих штурмуемых миров, только пока взведён', async () => {
    const { aim, pick, env, frame, at } = await boot();
    aim.drawAssaultTargets();
    expect(frame.calls).toHaveLength(0);
    pick.arm('assaultAim', true);
    aim.drawAssaultTargets();
    const foreign = Object.values(env.world.planets).filter((p) => p.owner === 'p2');
    expect(foreign.length).toBeGreaterThan(0);
    expect(frame.named('arc')).toHaveLength(foreign.length);
    for (const p of foreign) expect(arcAt(frame.calls, at(p.position), 16)).toBe(true);
    expect(frame.named('stroke')[0]!.stroke).toBe('rgba(255,90,77,.85)');
    expect(frame.named('setLineDash')[0]!.args).toEqual([[4, 4]]);
    // Сектор, который штурмом не берут, не обводится.
    frame.calls.length = 0;
    env.capturable = () => false;
    aim.drawAssaultTargets();
    expect(frame.named('arc')).toHaveLength(0);
  });

  it('прицел каста: круг дальности от флота героя и область под указателем; за дальностью — цвет отказа', async () => {
    const { aim, geo, camera, palette, pick, env, frame, own, game } = await boot();
    env.world = { ...env.world, heroes: { h1: { id: 'h1', owner: 'p1', alive: true, fleetId: own.id } as never } };
    const scan = game.data.heroAbilities.scan!;
    const reach = camera.worldDist(scan.range);
    const aoe = camera.worldDist(Number(scan.params!.radius));
    pick.arm('heroAim', { heroId: 'h1', abilityId: 'scan' });
    const origin = geo.fleetOriginPx(own)!;
    // Без указателя прицела нет.
    aim.drawCastAim();
    expect(frame.calls).toHaveLength(0);
    env.pointer = { x: origin.x + 10, y: origin.y };
    aim.drawCastAim();
    expect(arcAt(frame.calls, origin, reach)).toBe(true);
    expect(frame.named('stroke')[0]!.stroke).toBe(rgba(palette.CAST_REACH, 0.5));
    expect(frame.named('setLineDash')[0]!.args).toEqual([[6, 6]]);
    // Область — тем же кругом способности, с лёгкой заливкой.
    expect(arcAt(frame.calls, env.pointer, aoe)).toBe(true);
    expect(frame.named('fill')[0]!.fill).toBe(rgba(palette.ABILITY_RING, 0.14));
    // Указатель за дальностью красит круг дальности отказом.
    frame.calls.length = 0;
    env.pointer = { x: origin.x + reach + 5, y: origin.y };
    aim.drawCastAim();
    expect(frame.named('stroke')[0]!.stroke).toBe(rgba(palette.CAST_FAR, 0.5));
    // Способность без дальности — только область.
    frame.calls.length = 0;
    pick.arm('heroAim', { heroId: 'h1', abilityId: 'rally' });
    aim.drawCastAim();
    expect(frame.named('arc')).toHaveLength(1);
    expect(arcAt(frame.calls, env.pointer, camera.worldDist(Number(game.data.heroAbilities.rally!.params!.radius)))).toBe(true);
    // Герой без флота не целится.
    frame.calls.length = 0;
    env.world = { ...env.world, heroes: { h1: { id: 'h1', owner: 'p1', alive: true } as never } };
    aim.drawCastAim();
    expect(frame.calls).toHaveLength(0);
  });

  it('прицел патруля: круг под указателем — цвет крыла в дальности, отказа за ней; перенесённый — круг вылета', async () => {
    const { aim, camera, palette, pick, env, frame, home, at, game } = await boot();
    const { squadronPatrol, squadronReach } = await import('../../packages/shared-core/src/index');
    env.aim = { sq: SQ, base: { planetId: home.id }, aloft: null };
    const radius = camera.worldDist(squadronPatrol(SQ, game.data).radius);
    expect(radius).toBeGreaterThan(0);
    const base = at(home.position);
    env.pointer = { x: base.x + 20, y: base.y };
    // Удар, а не патруль, — круга нет.
    pick.arm('strikeAim', { from: { planetId: home.id }, squadronId: SQ.id });
    aim.drawPatrolAim();
    expect(frame.calls).toHaveLength(0);
    pick.arm('strikeAim', { from: { planetId: home.id }, squadronId: SQ.id, patrol: true });
    aim.drawPatrolAim();
    expect(arcAt(frame.calls, env.pointer, radius)).toBe(true);
    expect(frame.named('stroke')[0]!.stroke).toBe(rgba(palette.R_WING, 0.85));
    // Точка за дальностью эскадры — цвет отказа.
    frame.calls.length = 0;
    env.pointer = { x: base.x + camera.worldDist(squadronReach(SQ, game.data)) + 5, y: base.y };
    aim.drawPatrolAim();
    expect(frame.named('stroke')[0]!.stroke).toBe(rgba(palette.CAST_FAR, 0.85));
    // Перенесённый патруль держит круг, снятый на вылете.
    frame.calls.length = 0;
    env.aim = { ...env.aim, aloft: { patrol: { radius: 77 } } as never };
    aim.drawPatrolAim();
    expect(arcAt(frame.calls, env.pointer, camera.worldDist(77))).toBe(true);
    // Нет эскадры у прицела — нет круга.
    frame.calls.length = 0;
    env.aim = null;
    aim.drawPatrolAim();
    expect(frame.calls).toHaveLength(0);
  });

  it('базы перелёта: уголки цвета крыла у каждой базы, куда долетит эскадра; не взведён — пусто', async () => {
    const { aim, geo, palette, pick, env, frame, home, next, own, at } = await boot();
    env.world = {
      ...env.world,
      planets: { ...env.world.planets, [next.id]: { ...next, owner: 'p1', buildings: [{ type: 'spaceport', level: 1, hp: 100 }] } },
    };
    env.aim = { sq: SQ, base: { planetId: home.id }, aloft: null };
    expect(aim.relocateSpots()).toEqual([]);
    aim.drawRelocateTargets(0);
    expect(frame.calls).toHaveLength(0);
    pick.arm('strikeAim', { from: { planetId: home.id }, squadronId: SQ.id, relocate: true });
    // Свой носитель у дома и порт соседа — в дальности перелёта; свой порт — не цель.
    expect(aim.relocateSpots().map((t) => t.base)).toEqual([
      { kind: 'fleet', id: own.id },
      { kind: 'planet', id: next.id },
    ]);
    aim.drawRelocateTargets(0);
    const spot = at(next.position);
    const ship = geo.fleetAnchor(own)!;
    expect(bracketCentres(frame.calls)).toEqual([
      [ship.x, ship.y],
      [spot.x, spot.y],
    ]);
    expect(frame.named('stroke').every((c) => c.stroke === palette.R_WING)).toBe(true);
    // Корабль-база стоит на экране у своего шеврона, мир — в своей точке.
    expect(aim.relocateSpotPx({ kind: 'planet', id: next.id })).toEqual(spot);
    expect(aim.relocateSpotPx({ kind: 'fleet', id: own.id })).toEqual(geo.fleetAnchor(own));
    expect(aim.relocateSpotPx({ kind: 'fleet', id: 'нет такого' })).toBeNull();
    // Эскадра в воздухе без значка на трассе никуда не перелетит.
    expect(aim.squadronRelocateSpots(SQ, { planetId: home.id }, { id: 'st:нет' } as never)).toEqual([]);
  });

  it('превью курса и «Штурма» (ПК): пунктир от флота по дороге к миру под указателем, кружок цели и часы хода', async () => {
    const { aim, geo, palette, pick, env, frame, home, next, own, at, game } = await boot();
    const { estimateTravelHours } = await import('../../packages/shared-core/src/index');
    const { etaText, targetPipRadius } = await import('../../decisions/aimPreview');
    env.pointer = at(next.position);
    // Не взведён — ничего; взведён без выбора — тоже.
    aim.drawAimPreview(0);
    pick.arm('aiming', true);
    aim.drawAimPreview(0);
    expect(frame.calls).toHaveLength(0);
    pick.pickFleets([own.id], () => true);
    pick.arm('aiming', true);
    aim.drawAimPreview(0);
    const path = frame.named('stroke')[0]!;
    expect(path.stroke).toBe(rgba(palette.LOCK, 0.6));
    expect(path.width).toBe(1.4);
    expect(frame.named('setLineDash')[0]!.args).toEqual([[3, 5]]);
    const from = geo.fleetOriginPx(own)!;
    expect(frame.named('moveTo')[0]!.args).toEqual([from.x, from.y]);
    const end = frame.named('lineTo').at(-1)!.args as number[];
    expect(Math.hypot(end[0]! - env.pointer.x, end[1]! - env.pointer.y)).toBeLessThan(1);
    expect(arcAt(frame.calls, env.pointer, targetPipRadius(false))).toBe(true);
    const hrs = estimateTravelHours(env.world, game.ctx(env.world.time), home.id, next.id, own);
    expect(frame.named('fillText').map((c) => c.args)).toEqual([[etaText(hrs!), env.pointer.x, env.pointer.y - 22]]);
    // «Штурм» ведёт тем же путём.
    frame.calls.length = 0;
    pick.arm('assaultAim', true);
    aim.drawAimPreview(0);
    expect(frame.named('stroke')[0]!.stroke).toBe(rgba(palette.LOCK, 0.6));
    expect(arcAt(frame.calls, env.pointer, targetPipRadius(false))).toBe(true);
  });

  it('превью курса на дорогу: указатель между мирами — путь к точке на дороге и кружок поменьше', async () => {
    const { aim, geo, pick, env, frame, home, next, own, at, camera } = await boot();
    const { laneRoad, pointAlong } = await import('../../packages/shared-core/src/index');
    const { targetPipRadius } = await import('../../decisions/aimPreview');
    // Крупнее: середина дороги дальше от миров, чем радиус захвата мира.
    camera.setView({ scale: 4, x: 0, y: 0 });
    const road = laneRoad(env.world, home.id, next.id)!;
    env.pointer = at(pointAlong(road, 0.5));
    const lane = geo.nearestLanePoint(env.pointer.x, env.pointer.y)!;
    expect(lane).not.toBeNull();
    pick.pickFleets([own.id], () => true);
    pick.arm('aiming', true);
    aim.drawAimPreview(0);
    expect(arcAt(frame.calls, lane, targetPipRadius(true))).toBe(true);
    const end = frame.named('lineTo').at(-1)!.args as number[];
    expect(Math.hypot(end[0]! - lane.x, end[1]! - lane.y)).toBeLessThan(1);
  });

  it('превью «Атаки» (ПК): красный путь к флоту под указателем и прогноз боя; без цели — ничего', async () => {
    const { aim, geo, palette, pick, env, frame, next, own, game, put, at } = await boot();
    const { t } = await import('../../localization/runtime');
    const { battleForecast, battleHostility } = await import('../../decisions/battleForecast');
    const { engageRoster } = await import('../../decisions/engageRoster');
    env.world = atWar(env.world);
    const foe = put(foeAt(env.world, next.id));
    pick.pickFleets([own.id], () => true);
    pick.arm('engageAim', true);
    // Указатель в пустоте — пути нет: куда вести, показывают уголки на целях.
    env.pointer = { x: -500, y: -500 };
    aim.drawAimPreview(0);
    expect(frame.calls).toHaveLength(0);
    const target = geo.fleetAnchor(foe)!;
    env.pointer = { x: target.x + 2, y: target.y };
    aim.drawAimPreview(0);
    const path = frame.named('stroke')[0]!;
    expect(path.stroke).toBe(rgba(palette.HOSTILE, 0.85));
    expect(path.width).toBe(1.8);
    expect(frame.named('setLineDash')[0]!.args).toEqual([[6, 5]]);
    // Путь идёт до мира цели, кружок — на самой цели.
    const end = frame.named('lineTo').at(-1)!.args as number[];
    const port = at(next.position);
    expect(Math.hypot(end[0]! - port.x, end[1]! - port.y)).toBeLessThan(1);
    expect(arcAt(frame.calls, target, 16)).toBe(true);
    // Прогноз — под целью, словом и строкой чисел.
    const hostile = battleHostility(env.world);
    const card = battleForecast(engageRoster(env.world, 'p1', [own], foe, game.data, hostile), game.data, hostile)!;
    expect(card).not.toBeNull();
    const texts = frame.named('fillText').map((c) => c.args);
    expect(texts).toContainEqual([t(card.verdictKey), target.x, target.y + 28]);
    const { fmtHrs } = await import('./format');
    const line = t('engage.forecast.line', { h: fmtHrs(card.hours), own: card.ownLossPct, foe: card.foeLossPct });
    expect(texts).toContainEqual([line, target.x, target.y + 42]);
  });

  it('превью на телефоне: черновик «Атаки» — уголки и прогноз у цели, слияния — уголки без прогноза, курса — путь к миру черновика', async () => {
    const { aim, palette, pick, env, frame, next, own, at, put } = await boot();
    const { targetPipRadius } = await import('../../decisions/aimPreview');
    env.mobile = true;
    env.world = atWar(env.world);
    const foe = put(foeAt(env.world, next.id));
    env.draft = { x: 400, y: 300 };
    pick.pickFleets([own.id], () => true);
    pick.arm('engageAim', true);
    // Без черновика — ничего.
    aim.drawAimPreview(0);
    expect(frame.calls).toHaveLength(0);
    pick.stageDraft({ order: 'engage', fleetIds: [own.id], target: { kind: 'fleet', id: foe.id } });
    aim.drawAimPreview(0);
    expect(bracketCentres(frame.calls)).toEqual([[400, 300]]);
    expect(frame.named('stroke').slice(0, 4).every((c) => c.stroke === palette.HOSTILE)).toBe(true);
    expect(frame.named('fillText').length).toBe(2);
    // Слияние: уголки цвета захвата, прогноза нет.
    frame.calls.length = 0;
    pick.arm('merging', true);
    pick.stageDraft({ order: 'merge', fleetIds: [own.id], target: { kind: 'fleet', id: foe.id } });
    aim.drawAimPreview(0);
    expect(bracketCentres(frame.calls)).toEqual([[400, 300]]);
    expect(frame.named('stroke').every((c) => c.stroke === palette.LOCK)).toBe(true);
    expect(frame.named('fillText')).toHaveLength(0);
    // Курс: путь к миру черновика, а не к миру под пальцем.
    frame.calls.length = 0;
    pick.arm('aiming', true);
    pick.stageDraft({ order: 'move', fleetIds: [own.id], target: { kind: 'planet', id: next.id } });
    env.draft = at(next.position);
    aim.drawAimPreview(0);
    expect(arcAt(frame.calls, env.draft, targetPipRadius(false))).toBe(true);
    expect(frame.named('stroke')[0]!.stroke).toBe(rgba(palette.LOCK, 0.6));
  });
});

describe('REFM-233 — стык прицелов с main.ts', () => {
  const MAIN = readFileSync(new URL('./main.ts', import.meta.url), 'utf8');
  const SRC = readFileSync(new URL('./mapAim.ts', import.meta.url), 'utf8');
  const init = /initMapAim\(\{([\s\S]*?)\n\}\);/.exec(MAIN)?.[1] ?? '';

  it('хуки — мир, место, кадр, узлы карты, раскладка, штурмуемость и эскадра прицела', () => {
    for (const hook of [
      'world: () => s,',
      'me: () => ME,',
      'ctx: () => cx,',
      'nodes: () => MAP,',
      'mobile: () => MOBILE,',
      'capturable: (id) => sectorTypeOf(id)?.capturable ?? false,',
      'aimSquadron,',
    ])
      expect(init, hook).toContain(hook);
  });

  it('прицелы живут только в модуле, кадр и ввод зовут их оттуда', () => {
    expect(MAIN).not.toMatch(
      /\bfunction (engageCandidates|drawEngageTargets|drawEngageForecast|drawAssaultTargets|drawCastAim|drawPatrolAim|drawRelocateTargets|relocateSpots|squadronRelocateSpots|relocateSpotPx|drawAimPreview)\(/,
    );
    for (const call of [
      'drawAssaultTargets();',
      'drawEngageTargets(lastReal);',
      'drawAimPreview(lastReal);',
      'drawCastAim();',
      'drawPatrolAim();',
      'drawRelocateTargets(lastReal);',
    ])
      expect(MAIN, call).toContain(call);
    const input = /initMapInput\(\{([\s\S]*?)\n\}\);/.exec(MAIN)?.[1] ?? '';
    for (const hook of ['engageCandidates,', 'squadronRelocateSpots,', 'relocateSpotPx,']) expect(input, hook).toContain(hook);
  });

  it('модуль не тянет `main.ts`, робот перелёта берёт базы у модуля', () => {
    expect(SRC).not.toMatch(/from '\.\/main'/);
    const robot = readFileSync(new URL('../relocatetest.mjs', import.meta.url), 'utf8');
    expect(robot).toContain("import { relocateSpots as __relocateSpots } from './mapAim';");
  });
});
