/**
 * Флоты карты и их бои (REFM-235, часть 2) — прямой тест владельца на живом мире прототипа.
 *
 * Что показать, решают чистые модели (`battleMark.ts`, `orbitRing.ts`, `unitGlyphs.ts`,
 * `fleetTally.ts`, `decisions/fleetHolds.ts`, `decisions/heroIdentity.ts`), и у них свои
 * тесты. Здесь — то, что собирается только вместе: мир, туман, камера и геометрия флотов дают
 * холсту ровно тот корпус, то кольцо орбиты, тот значок боя и ту трассу огня, что обещают
 * модели, своим цветом и в той точке экрана, где стоит флот. Холст поддельный и записывает
 * вызовы вместе с цветом, шириной линии, прозрачностью, шрифтом и пунктиром в момент вызова;
 * мир, туман, камера, геометрия флотов, палитра и выбор — настоящие. Каждый тест — свежая
 * загрузка модулей.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';

import type { Battle, Fleet, GameState } from '../../packages/shared-core/src/index';
import { rgba } from '../../packages/client/src/holoDraw';
import type { MapLod } from '../../packages/client/src/mapLod';
import { battleBadgePoint } from '../../decisions/battleTap';
import { fleetAloftPlaces, fleetHolds } from '../../decisions/fleetHolds';
import { isEmplacementFleet } from '../../decisions/emplacement';
import { orbitSeats } from '../../decisions/orbitSeats';
import { bracketStrokes } from './mapShapes';
import { phaseOfId } from './pulseFx';

interface Call {
  name: string;
  args: unknown[];
  stroke: unknown;
  fill: unknown;
  width: unknown;
  alpha: unknown;
  font: unknown;
  dash: unknown;
  offset: unknown;
}

/** Градиент поддельного холста — один на всех: кадр и эталон сравниваются по значению. */
const GRADIENT = { addColorStop() {} };

/** Холст, чей контекст записывает каждый вызов с цветом, шириной, прозрачностью и шрифтом.
 *  `save`/`restore` держат стек состояния, как настоящий холст. */
function fakeCanvas() {
  const calls: Call[] = [];
  const props: Record<string, unknown> = {
    globalAlpha: 1,
    lineWidth: 1,
    strokeStyle: '#000',
    fillStyle: '#000',
    font: '',
    lineDashOffset: 0,
  };
  let dash: unknown = [];
  const stack: Array<[Record<string, unknown>, unknown]> = [];
  const ctx = new Proxy(props, {
    get(target, name) {
      if (typeof name !== 'string') return undefined;
      if (name in target) return target[name];
      if (name === 'getContextAttributes') return () => ({});
      return (...args: unknown[]) => {
        if (name === 'setLineDash') dash = args[0];
        if (name === 'save') stack.push([{ ...target }, dash]);
        if (name === 'restore') {
          const top = stack.pop();
          if (top) {
            Object.assign(target, top[0]);
            dash = top[1];
          }
        }
        calls.push({
          name,
          args,
          stroke: target.strokeStyle,
          fill: target.fillStyle,
          width: target.lineWidth,
          alpha: target.globalAlpha,
          font: target.font,
          dash,
          offset: target.lineDashOffset,
        });
        if (name.startsWith('create')) return GRADIENT;
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
  return { ctx, calls, props, named };
}

/** Портрет героя — картинка страницы: здесь она поддельная и сразу готова. */
class FakeImage {
  complete = true;
  naturalWidth = 512;
  naturalHeight = 512;
  src = '';
}

beforeAll(async () => {
  vi.stubGlobal('__PLAYER_BUILD__', false);
  vi.stubGlobal('document', { createElement: () => fakeCanvas().ctx, getElementById: () => null });
  await import('./mapFleets');
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
const MONO = 'ui-monospace,Menlo,monospace';
const HOUR = 3_600_000;

/** Детализация карты: по умолчанию — крупная карта во всей красе. */
const LOD = (over: Partial<MapLod> = {}): MapLod =>
  ({ scale: 1, art: 1, detail: 1, provinceDetail: 1, markerRadius: 3, ...over }) as MapLod;

async function boot() {
  vi.stubGlobal('__PLAYER_BUILD__', false); // туман читает профиль сборки
  vi.stubGlobal('Path2D', class {}); // корпуса кораблей — пути холста
  vi.stubGlobal('Image', FakeImage);
  // Композер «Приказ» вешает меню точки на страницу: здесь страницы нет.
  vi.stubGlobal('document', {
    createElement: () => ({ width: 0, height: 0, getContext: () => fakeCanvas().ctx }),
    getElementById: () => null,
    body: { classList: { remove() {}, add() {} } },
  });
  const game = await import('./game');
  const world: GameState = game.newGame({
    seats: [
      { id: 'p1', name: 'A', faction: 'azure', start: game.START_CANDIDATES[0]!, ai: false },
      { id: 'p2', name: 'B', faction: 'crimson', start: game.START_CANDIDATES[1]!, ai: false },
    ],
  });
  const frame = fakeCanvas();
  const nodes = (await import('./mapCatalog')).mapNodesFromState(world);
  const env = {
    world,
    clock: 1234,
    holographic: false,
    sectorType: (id: string) => game.SECTOR_TYPES[nodes.find((n) => n.id === id)?.sector ?? ''],
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
    lod: () => LOD(),
    forkMarks: () => [],
    orbits: () => orbitSeats(Object.values(env.world.fleets), (g) => isEmplacementFleet(g, game.data)),
  });
  const palette = await import('./mapPalette');
  palette.initMapPalette({ world: () => env.world, me: () => 'p1', ctx: () => frame.ctx, dpr: () => 1 } as never);
  const overlays = await import('./mapOverlays');
  overlays.initMapOverlays({ ctx: () => frame.ctx } as never);
  (await import('./chainComposer')).initChainComposer({
    world: () => env.world,
    me: () => 'p1',
    note: () => {},
    nodes: () => nodes,
    capturable: () => true,
    touchTap: () => false,
    screenPoint: (p) => p,
    invalidateCmdBar: () => {},
    invalidatePanel: () => {},
  });
  const queries = await import('./worldQueries');
  queries.initWorldQueries({ world: () => env.world, me: () => 'p1' } as never);
  const fleets = await import('./mapFleets');
  fleets.initMapFleets({
    world: () => env.world,
    me: () => 'p1',
    ctx: () => frame.ctx,
    clock: () => env.clock,
    holographic: () => env.holographic,
    sectorType: (id) => env.sectorType(id),
  });
  const interaction = await import('./interaction');
  const prefs = await import('./graphicsPrefs');
  const glyphs = await import('./unitGlyphs');
  const { emblemTally } = await import('./fleetTally');
  const { isWingUnit } = await import('./planetSummary');
  const holo = await import('./holographicEffects');
  const shapes = await import('../../packages/client/src/shipShapes');
  const { t } = await import('../../localization/runtime');
  const home = Object.values(world.planets).find((p) => p.owner === 'p1')!;
  const next = world.planets[home.links![0]!]!; // опознанный нейтральный сосед
  const far = world.planets[Object.values(world.fleets).find((f) => f.owner === 'p2')!.location!]!; // чужая столица в тумане
  /** Экранная точка мира. */
  const at = (p: XY) => camera.world(p);
  /** Флот по id. */
  const fleet = (id: string) => env.world.fleets[id]!;
  /** Положить флот в мир (новый или поверх прежнего). */
  const putFleet = (f: Fleet) => {
    env.world = { ...env.world, fleets: { ...env.world.fleets, [f.id]: f } };
  };
  /** Изменить флот. */
  const patchFleet = (id: string, extra: Partial<Fleet>) => putFleet({ ...fleet(id), ...extra });
  /** Убрать флоты, кроме перечисленных. */
  const keepFleets = (...ids: string[]) => {
    env.world = { ...env.world, fleets: Object.fromEntries(ids.map((id) => [id, fleet(id)])) };
  };
  /** Положить бой в мир. */
  const putBattle = (b: Battle) => {
    env.world = { ...env.world, battles: { ...env.world.battles, [b.id]: b } };
  };
  /** Корабли в счёте флота: крыло на борту в счёт не входит. */
  const ships = (f: Fleet) => emblemTally(f.units, [], (u) => isWingUnit(u, game.data)).ships;
  /** Масштаб корпуса доминанта. */
  const hullScale = (f: Fleet) => {
    const dom = glyphs.dominantUnit(f.units, game.data)!;
    return glyphs.glyphScale(glyphs.unitSizeClass(dom.def.stats.hp ?? 0));
  };
  /** Дыхание флота — тем же законом, что у карты. */
  const breath = (f: Fleet, now: number, period: number, base: number, amp: number) =>
    prefs.fxBreath(now, { period, base, amp, phase: phaseOfId(f.id) });
  return {
    fleets, camera, fog, geo, palette, overlays, holo, shapes, interaction, prefs, glyphs, queries, game, env, frame,
    home, next, far, at, fleet, putFleet, patchFleet, keepFleets, putBattle, ships, hullScale, breath, t,
  };
}

const near = (a: number, b: number) => Math.abs(a - b) < 1e-6;
/** Вызов `name` с аргументами `args` (числа — с точностью до 1e-6). */
const call = (calls: Call[], fn: string, ...args: unknown[]) =>
  calls.find(
    (k) =>
      k.name === fn &&
      args.every((a, i) => (typeof a === 'number' ? near(k.args[i] as number, a) : k.args[i] === a)),
  );
/** Дуга радиуса `r` с центром в `c`. */
const arcAt = (calls: Call[], c: XY, r: number) => call(calls, 'arc', c.x, c.y, r);
/** Индекс переноса начала координат в точку `c`. */
const translateAt = (calls: Call[], c: XY) =>
  calls.findIndex((k) => k.name === 'translate' && near(k.args[0] as number, c.x) && near(k.args[1] as number, c.y));
/** Уголки цели вокруг `c` радиуса `r` (`mapOverlays.targetBrackets`). */
const bracketsAt = (calls: Call[], c: XY, r: number) => {
  const i = translateAt(calls, c);
  if (i < 0) return false;
  const first = bracketStrokes(r, 6)[0]!.from;
  return calls.slice(i).some((k) => k.name === 'moveTo' && near(k.args[0] as number, first.x) && near(k.args[1] as number, first.y));
};
/** Рамка бейджа счёта флота: `[x, y, ширина, высота]`. */
const badges = (calls: Call[]) =>
  calls.filter((k) => k.name === 'fillRect' && k.fill === 'rgba(3,14,22,.88)').map((k) => k.args as number[]);
/** Заливка корпуса — внешний контур силуэта. */
const hulls = (calls: Call[]) => calls.filter((k) => k.name === 'fill' && k.args[1] === 'evenodd');
/** Портреты героев: прямоугольник кадра на экране. */
const portraits = (calls: Call[]) =>
  calls.filter((k) => k.name === 'drawImage' && k.args.length === 9).map((k) => (k.args as number[]).slice(5));

describe('REFM-235 — флоты на карте', () => {
  it('свой флот на орбите: корпус доминанта носом по курсу, кольцо щита, счёт под флотом, портрет героя над ним', async () => {
    const { fleets, frame, palette, geo, glyphs, shapes, game, env, fleet, ships, hullScale } = await boot();
    const f = fleet('p1-1');
    fleets.drawFleets(0, LOD());
    const A = geo.fleetAnchor(f)!;
    const col = palette.ownerColor('p1');
    const k = hullScale(f);
    // Корпус — в точке флота, нос по курсу.
    const i = translateAt(frame.calls, A);
    expect(i).toBeGreaterThanOrEqual(0);
    expect(frame.calls[i + 1]!.name).toBe('rotate');
    expect(frame.calls[i + 1]!.args[0]).toBeCloseTo(A.ang + Math.PI / 2);
    // Доминант — флагман: щит у него всегда, кольцо идёт за силуэтом.
    const dom = glyphs.dominantUnit(f.units, game.data)!;
    expect(glyphs.glyphHalo(glyphs.unitArchetype(dom.def), false)).toBe(true);
    const halo = call(frame.calls, 'arc', 0, 0, 12.5 * k + 2)!;
    expect([halo.stroke, halo.width, halo.dash]).toEqual([rgba(col, 0.7), 1.1, [2.6, 2.8]]);
    // Полный корпус, без контура схемы.
    expect(call(frame.calls, 'scale', k, k)).toBeTruthy();
    expect(call(frame.calls, 'scale', k * 0.8, k * 0.8)).toBeUndefined();
    const [hull] = hulls(frame.calls);
    expect([hull!.fill, hull!.stroke, hull!.alpha]).toEqual([rgba(col, 0.24), rgba(col, 0.95), 1]);
    expect(frame.named('stroke').filter((c) => c.width === 0.65)).toHaveLength(1); // внутренняя деталировка
    // Силуэт — того корпуса, что у доминанта, а не общий крейсер.
    const shape = glyphs.unitShape(dom.def, dom.unit, env.world.players.p1?.faction)!;
    expect(shape).not.toBe('cruiser');
    const ref = fakeCanvas();
    shapes.drawShipShape(ref.ctx, shape, true);
    expect(hull!.args[0]).toBe(ref.named('fill')[0]!.args[0]);
    // Счёт: у флота с героем бейдж висит прямо под флотом, а не от мира наружу.
    const [badge] = badges(frame.calls);
    const [bx, by, w, h] = badge!;
    expect([bx, by]).toEqual([A.x - w! / 2, A.y + 18]);
    const holds = fleetHolds(f, game.data, env.world.time, fleetAloftPlaces(env.world, f, game.data));
    expect(h).toBe(Math.max(26, holds.length * 12 + 4));
    const count = call(frame.calls, 'fillText', String(ships(f)), bx! + 20, by! + h! / 2)!;
    expect([count.fill, count.font, count.alpha]).toEqual(['#f4f8fc', `700 16px ${MONO}`, 1]);
    // Портрет героя — над флотом, в экранных пикселях.
    expect(portraits(frame.calls)).toEqual([[A.x - 29, A.y - 98, 58, 58]]);
  });

  it('флот без героя: бейдж отходит от мира наружу; цифры трюма — у выбранного и на крупном зуме', async () => {
    const { fleets, frame, geo, game, env, interaction, home, at, fleet, patchFleet } = await boot();
    env.world = { ...env.world, heroes: {} };
    const f = fleet('p1-1');
    const holds = fleetHolds(f, game.data, env.world.time, fleetAloftPlaces(env.world, f, game.data));
    expect(holds.length).toBeGreaterThan(0);
    fleets.drawFleets(0, LOD());
    const A = geo.fleetAnchor(f)!;
    const pc = at(home.position);
    const [bx, by, w, h] = badges(frame.calls)[0]!;
    const len = Math.hypot(A.x - pc.x, A.y - pc.y);
    const [nx, ny] = [(A.x - pc.x) / len, (A.y - pc.y) / len];
    const d = 18 + (Math.abs(nx) * w!) / 2 + (Math.abs(ny) * h!) / 2;
    expect(bx).toBeCloseTo(A.x + nx * d - w! / 2);
    expect(by).toBeCloseTo(A.y + ny * d - h! / 2);
    expect(portraits(frame.calls)).toEqual([]);
    const bars = () => frame.named('fillRect').filter((c) => c.fill === 'rgba(190,219,229,.17)').length;
    expect(bars()).toBe(holds.length);
    const figures = holds.map((m) => `${m.used}/${m.capacity}`);
    const shown = () => frame.named('fillText').some((c) => figures.includes(c.args[0] as string));
    expect(shown()).toBe(false);
    // Крупный зум раскрывает цифры трюма, выбор — тоже, и одиночный, и группой.
    for (const [lod, pick] of [[1.9, []], [1, ['p1-1']], [1, ['p1-1', 'p1-9']]] as const) {
      frame.calls.length = 0;
      interaction.pickFleets(pick, () => true);
      fleets.drawFleets(0, LOD({ scale: lod }));
      expect(shown(), `${lod} ${pick.join()}`).toBe(true);
    }
    // Чужой флот свой трюм не раскрывает: в бейдже только счёт.
    frame.calls.length = 0;
    patchFleet('p1-1', { owner: 'p2' });
    fleets.drawFleets(0, LOD({ scale: 1.9 }));
    expect(badges(frame.calls)[0]![3]).toBe(26);
    expect(bars()).toBe(0);
  });

  it('щит рисует кольцо вокруг силуэта и не у флагмана; крыло на борту в счёт кораблей не входит', async () => {
    const { fleets, frame, game, glyphs, fleet, putFleet, keepFleets, hullScale } = await boot();
    const shielded = { unit: 'cruiser', count: 2, modules: ['shield_booster'] };
    expect(glyphs.unitArchetype(game.data.units.cruiser!)).not.toBe('flagship');
    putFleet({ ...fleet('p1-1'), id: 'p1-sh', units: [shielded] });
    keepFleets('p1-sh');
    fleets.drawFleets(0, LOD());
    const halo = (calls: Call[]) => calls.some((c) => c.name === 'arc' && c.args[0] === 0 && c.args[1] === 0);
    expect(call(frame.calls, 'arc', 0, 0, 12.5 * hullScale(fleet('p1-sh')) + 2)).toBeTruthy();
    // Без щита и не флагман — кольца нет; два крейсера и три перехватчика на борту — «2».
    frame.calls.length = 0;
    putFleet({ ...fleet('p1-sh'), id: 'p1-wing', units: [{ unit: 'cruiser', count: 2 }, { unit: 'interceptor', count: 3 }] });
    keepFleets('p1-wing');
    fleets.drawFleets(0, LOD());
    expect(halo(frame.calls)).toBe(false);
    const [bx, by, , h] = badges(frame.calls)[0]!;
    expect(call(frame.calls, 'fillText', '2', bx! + 20, by! + h! / 2)).toBeTruthy();
  });

  it('чужой флот в тумане не рисуется; опознанный — цветом владельца', async () => {
    const { fleets, frame, palette, geo, fleet, putFleet, next, far } = await boot();
    const enemy = fleet('p2-1');
    fleets.drawFleets(0, LOD());
    expect(translateAt(frame.calls, geo.fleetAnchor(enemy)!)).toBe(-1);
    expect(far.id).toBe(enemy.location);
    // Тот же флот у опознанного соседа.
    frame.calls.length = 0;
    putFleet({ ...enemy, location: next.id });
    fleets.drawFleets(0, LOD());
    const A = geo.fleetAnchor(fleet('p2-1'))!;
    expect(translateAt(frame.calls, A)).toBeGreaterThanOrEqual(0);
    const col = palette.ownerColor('p2');
    expect(hulls(frame.calls).some((c) => c.fill === rgba(col, 0.24))).toBe(true);
  });

  it('выбранный флот — в уголках цели; флот с планом — дышащее пунктирное кольцо', async () => {
    const { fleets, frame, palette, geo, env, interaction, fleet, putFleet, home, next, breath } = await boot();
    const f = fleet('p1-1');
    const A = geo.fleetAnchor(f)!;
    fleets.drawFleets(500, LOD());
    expect(bracketsAt(frame.calls, A, 15)).toBe(false);
    expect(arcAt(frame.calls, A, 12.5)).toBeUndefined();
    frame.calls.length = 0;
    interaction.pickFleets(['p1-1'], () => true);
    env.world = { ...env.world, orders: { 'p1-1': { steps: [{ kind: 'move', to: 'C0R2' }] } } } as GameState;
    fleets.drawFleets(500, LOD());
    expect(bracketsAt(frame.calls, A, 15)).toBe(true);
    const ring = arcAt(frame.calls, A, 12.5)!;
    expect([ring.stroke, ring.width, ring.dash]).toEqual([
      rgba(palette.ownerColor('p1'), 0.3 + 0.4 * breath(f, 500, 300, 0.5, 0.5)),
      1.3,
      [4, 4],
    ]);
    // Выбор набором (рамкой) — те же уголки.
    frame.calls.length = 0;
    interaction.pickFleets(['p1-1', 'p1-9'], () => true);
    fleets.drawFleets(500, LOD());
    expect(bracketsAt(frame.calls, A, 15)).toBe(true);
    // План чужого флота не показывается.
    frame.calls.length = 0;
    putFleet({ ...fleet('p2-1'), location: next.id });
    env.world = { ...env.world, orders: { 'p2-1': { steps: [{ kind: 'move', to: home.id }] } } } as GameState;
    fleets.drawFleets(500, LOD());
    const B = geo.fleetAnchor(fleet('p2-1'))!;
    expect(translateAt(frame.calls, B)).toBeGreaterThanOrEqual(0);
    expect(arcAt(frame.calls, B, 12.5)).toBeUndefined();
  });

  it('в пути: след из четырёх точек позади по курсу; бомбардировка — луч к миру', async () => {
    const { fleets, frame, palette, geo, env, home, next, at, fleet, patchFleet, breath } = await boot();
    env.world = { ...env.world, time: HOUR / 2 };
    patchFleet('p1-1', { location: null, movement: { from: home.id, to: next.id, departedAt: 0, arrivesAt: HOUR } });
    const f = fleet('p1-1');
    fleets.drawFleets(700, LOD());
    const A = geo.fleetAnchor(f)!;
    const col = palette.ownerColor('p1');
    const engine = breath(f, 700, 120, 0.55, 0.45);
    for (let i = 1; i <= 4; i++) {
      const dot = arcAt(
        frame.calls,
        { x: A.x - Math.cos(A.ang) * i * (8 + engine * 2), y: A.y - Math.sin(A.ang) * i * (8 + engine * 2) },
        2.8 - 0.35 * i,
      );
      expect(dot?.fill, `точка ${i}`).toBe(rgba(col, 0.33 - 0.055 * i));
    }
    // Стоит у мира и бомбит его — луч от флота к миру.
    frame.calls.length = 0;
    patchFleet('p1-1', { location: next.id, movement: null, bombarding: true } as Partial<Fleet>);
    fleets.drawFleets(700, LOD());
    const B = geo.fleetAnchor(fleet('p1-1'))!;
    const pc = at(next.position);
    const spark = breath(f, 700, 90, 0.45, 0.55);
    const ray = frame.calls.findIndex((c) => c.name === 'moveTo' && near(c.args[0] as number, B.x) && near(c.args[1] as number, B.y));
    expect(call(frame.calls.slice(ray), 'lineTo', pc.x, pc.y)).toBeTruthy();
    const beam = frame.calls.slice(ray).find((c) => c.name === 'stroke')!;
    expect([beam.stroke, beam.width]).toEqual([rgba('#ffb15f', 0.3 + 0.3 * spark), 1.2 + spark]);
    expect(frame.named('arc').some((c) => near(c.args[3] as number, 0) && (c.args[2] as number) < 2.5)).toBe(false);
  });

  it('LOD: на схеме — контур того же корпуса и голый счёт, рамка выбора меньше; портрет только у выбранного', async () => {
    const { fleets, frame, palette, geo, interaction, fleet, hullScale, ships } = await boot();
    const f = fleet('p1-1');
    const A = geo.fleetAnchor(f)!;
    const k = hullScale(f);
    const col = palette.ownerColor('p1');
    fleets.drawFleets(0, LOD({ detail: 0 }));
    const i = translateAt(frame.calls, A);
    expect(frame.calls[i + 1]!.name).toBe('rotate');
    expect(frame.calls[i + 1]!.args[0]).toBeCloseTo(A.ang + Math.PI / 2);
    expect(call(frame.calls, 'scale', k * 0.8, k * 0.8)?.alpha).toBe(1);
    expect(call(frame.calls, 'scale', k, k)).toBeUndefined();
    expect(hulls(frame.calls).map((c) => c.fill)).toEqual([rgba(col, 0.28)]);
    expect(frame.named('stroke').some((c) => c.width === 0.65)).toBe(false); // контур без деталировки
    const [badge] = badges(frame.calls);
    expect(badge![3]).toBe(26); // без шкал трюма
    expect(call(frame.calls, 'fillText', String(ships(f)), badge![0]! + 20, badge![1]! + 13)).toBeTruthy();
    expect(portraits(frame.calls)).toEqual([]);
    expect(bracketsAt(frame.calls, A, 12)).toBe(false);
    // Выбранный — в уголках поменьше и с портретом; в группе — тоже.
    for (const pick of [['p1-1'], ['p1-1', 'p1-9']]) {
      frame.calls.length = 0;
      interaction.pickFleets(pick, () => true);
      fleets.drawFleets(0, LOD({ detail: 0 }));
      expect(bracketsAt(frame.calls, A, 12), pick.join()).toBe(true);
      expect(portraits(frame.calls)).toHaveLength(1);
    }
    // Наполовину: контур и полный корпус проступают друг через друга, счёт — во всю силу.
    frame.calls.length = 0;
    interaction.pickFleets([], () => true);
    fleets.drawFleets(0, LOD({ detail: 0.5 }));
    expect(call(frame.calls, 'scale', k * 0.8, k * 0.8)?.alpha).toBe(0.5);
    expect(call(frame.calls, 'scale', k, k)?.alpha).toBe(0.5);
    expect(frame.named('fillText').find((c) => c.args[0] === String(ships(f)))?.alpha).toBe(1);
    expect(portraits(frame.calls)).toHaveLength(1);
    // Портрет проступает с детализации 0.45.
    frame.calls.length = 0;
    fleets.drawFleets(0, LOD({ detail: 0.45 }));
    expect(portraits(frame.calls)).toHaveLength(1);
    frame.calls.length = 0;
    fleets.drawFleets(0, LOD({ detail: 0.42 }));
    expect(portraits(frame.calls)).toEqual([]);
  });

  it('два героя у одного мира: второй портрет встаёт над первым, а не на него', async () => {
    const { fleets, frame, env, fleet, putFleet } = await boot();
    putFleet({ ...fleet('p1-1'), id: 'p1-2' });
    const hero2 = env.world.heroes!['hero:p1:2']!;
    env.world = { ...env.world, heroes: { ...env.world.heroes, [hero2.id]: { ...hero2, fleetId: 'p1-2' } } };
    fleets.drawFleets(0, LOD());
    const [a, b] = portraits(frame.calls);
    expect(a && b).toBeTruthy();
    const overlap = a![0]! < b![0]! + 58 + 4 && b![0]! < a![0]! + 58 + 4 && a![1]! < b![1]! + 68 + 4 && b![1]! < a![1]! + 68 + 4;
    expect(overlap).toBe(false);
    // Следующий кадр собирает хитбоксы заново: портреты стоят там же, а не уползают выше.
    frame.calls.length = 0;
    fleets.drawFleets(0, LOD());
    expect(portraits(frame.calls)).toEqual([a, b]);
  });

  it('крепость — одно сооружение, без счёта; мина и ракета — не флоты карты', async () => {
    const { fleets, frame, geo, home, fleet, putFleet, keepFleets } = await boot();
    putFleet({ ...fleet('p1-1'), id: 'p1-fort', units: [{ unit: 'fortress_guns', count: 1 }] });
    keepFleets('p1-fort');
    fleets.drawFleets(0, LOD());
    expect(translateAt(frame.calls, geo.fleetAnchor(fleet('p1-fort'))!)).toBeGreaterThanOrEqual(0);
    expect(badges(frame.calls)).toEqual([]);
    frame.calls.length = 0;
    fleets.drawFleets(0, LOD({ detail: 0 }));
    expect(badges(frame.calls)).toEqual([]);
    frame.calls.length = 0;
    putFleet({ ...fleet('p1-fort'), id: 'p1-mine', location: home.id, units: [{ unit: 'mine', count: 1 }] });
    keepFleets('p1-mine');
    fleets.drawFleets(0, LOD());
    expect(frame.named('translate')).toEqual([]);
  });

  it('засада: флот на развилке — пунктирный ромб цвета владельца под корпусом', async () => {
    const { fleets, frame, palette, geo, env, fleet, patchFleet } = await boot();
    const core = await import('../../packages/shared-core/src/index');
    let edge: { from: string; to: string; t: number } | undefined;
    for (const p of Object.values(env.world.planets))
      for (const to of p.links ?? [])
        if (!edge && core.forkToward(env.world, p.id, to)) edge = { from: p.id, to, t: core.forkTAtStart(env.world, p.id, to) };
    expect(edge).toBeTruthy();
    patchFleet('p1-1', { location: null, movement: null, edge });
    fleets.drawFleets(0, LOD());
    const A = geo.fleetAnchor(fleet('p1-1'))!;
    const col = rgba(palette.ownerColor('p1'), 0.85);
    const mark = frame.calls.findIndex((c) => c.name === 'stroke' && c.stroke === col);
    expect(mark).toBeGreaterThanOrEqual(0);
    expect(mark).toBeLessThan(translateAt(frame.calls, A));
  });
});

describe('REFM-235 — орбиты', () => {
  it('кольцо орбиты у мира со стоящим флотом: пунктир бежит по часам, тает с детализацией', async () => {
    const { fleets, frame, geo, home, next, far, at } = await boot();
    fleets.drawOrbitRings(400, 1);
    const pc = at(home.position);
    const rr = geo.orbitRingRadius(home);
    const ring = arcAt(frame.calls, pc, rr)!;
    expect([ring.dash, ring.offset, ring.stroke, ring.width, ring.alpha]).toEqual([[2, 5], 2, rgba('#7df0d0', 0.4), 1.3, 1]);
    // Пустая орбита соседа и столица врага в тумане — без кольца.
    expect(arcAt(frame.calls, at(next.position), geo.orbitRingRadius(next))).toBeUndefined();
    expect(arcAt(frame.calls, at(far.position), geo.orbitRingRadius(far))).toBeUndefined();
    frame.calls.length = 0;
    fleets.drawOrbitRings(400, 0.5);
    expect(arcAt(frame.calls, pc, rr)?.alpha).toBe(0.5);
    frame.calls.length = 0;
    fleets.drawOrbitRings(400, 0);
    expect(frame.named('arc')).toEqual([]);
  });

  it('флот в пути орбиты не держит; узел без орбиты — только укреплённым', async () => {
    const { fleets, frame, geo, env, home, next, at, patchFleet } = await boot();
    const pc = at(home.position);
    const rr = geo.orbitRingRadius(home);
    const type = env.sectorType(home.id)!;
    expect(type.orbit).toBeTruthy();
    env.sectorType = () => ({ ...type, orbit: false });
    const g = env.world.planets[home.id]!;
    const setHome = (extra: object) => {
      env.world = { ...env.world, planets: { ...env.world.planets, [home.id]: { ...g, ...extra } } };
    };
    setHome({ garrison: [], buildings: [] });
    fleets.drawOrbitRings(0, 1);
    expect(arcAt(frame.calls, pc, rr)).toBeUndefined();
    setHome({ garrison: [{ unit: 'militia', count: 1 }], buildings: [] });
    fleets.drawOrbitRings(0, 1);
    expect(arcAt(frame.calls, pc, rr)).toBeTruthy();
    frame.calls.length = 0;
    setHome({ garrison: [], buildings: [{ type: 'starfort', level: 1, hp: 100 }] });
    fleets.drawOrbitRings(0, 1);
    expect(arcAt(frame.calls, pc, rr)).toBeTruthy();
    // Флот в пути — даже если снимок ещё держит его у мира отправления.
    for (const location of [null, home.id]) {
      frame.calls.length = 0;
      patchFleet('p1-1', { location, movement: { from: home.id, to: next.id, departedAt: 0, arrivesAt: HOUR } });
      fleets.drawOrbitRings(0, 1);
      expect(frame.named('arc'), String(location)).toEqual([]);
    }
  });
});

describe('REFM-235 — бои', () => {
  /** Бой у своей столицы: свой флот против чужого. */
  async function battleAtHome(extra: Partial<Battle> = {}) {
    const b = await boot();
    const { env, home, fleet, putFleet, patchFleet, putBattle } = b;
    putFleet({ ...fleet('p2-1'), id: 'p2-9', location: home.id, battleId: 'b1' });
    patchFleet('p1-1', { battleId: 'b1' });
    const battle = { id: 'b1', location: home.id, phase: 'orbital', sides: [], round: 0, nextRoundAt: env.world.time + 2 * HOUR, ...extra } as Battle;
    putBattle(battle);
    const point = () => battleBadgePoint(b.at(b.geo.battleAnchor(env.world.battles.b1!)!));
    return { ...b, battle, point };
  }

  it('бой: волна над точкой схватки и отсчёт до раунда; высадка — своей волной, цветом и словом', async () => {
    const { fleets, frame, env, queries, overlays, t, point, putBattle, battle } = await battleAtHome();
    const c = point();
    /** Волна боя — ровно как её рисует `drawBattlePulse`. */
    const pulse = (phase: 'orbital' | 'ground') => {
      const at = frame.calls.length;
      overlays.drawBattlePulse(c.x, c.y, (400 / 900) % 1, phase);
      return frame.calls.splice(at);
    };
    const left = queries.timeLeft(env.world.time + 2 * HOUR);
    fleets.drawBattles(400, 1);
    const drawn = frame.calls.splice(0);
    const orbital = pulse('orbital');
    expect(drawn.slice(0, orbital.length)).toEqual(orbital);
    const label = call(drawn, 'fillText', `${t('map.badge.orbit')} · ${left}`, c.x, c.y - 28)!;
    expect([label.fill, label.font, label.alpha]).toEqual(['#ff8a7d', `700 10px ${MONO}`, 1]);
    putBattle({ ...battle, phase: 'ground' });
    fleets.drawBattles(400, 0.5);
    const landing = frame.calls.splice(0);
    const ground = pulse('ground');
    expect(landing.slice(0, ground.length)).toEqual(ground);
    expect(ground).not.toEqual(orbital);
    const g = call(landing, 'fillText', `${t('map.badge.landing')} · ${left}`, c.x, c.y - 28)!;
    expect([g.fill, g.alpha]).toEqual(['#f5cf6b', 0.5]);
    // На схеме и без назначенного раунда — волна без отсчёта.
    for (const [b, detail] of [[battle, 0], [{ ...battle, nextRoundAt: undefined }, 1]] as const) {
      putBattle(b as Battle);
      fleets.drawBattles(400, detail);
      expect(frame.named('arc').length).toBeGreaterThan(0);
      expect(frame.named('fillText')).toEqual([]);
      frame.calls.length = 0;
    }
  });

  it('голографическая карта: голограмма боя на часах карты в своей фазе, отсчёт выше; последняя секунда стягивает кольцо', async () => {
    const { fleets, frame, env, prefs, holo, point, putBattle, battle } = await battleAtHome();
    env.holographic = true;
    const c = point();
    /** Голограмма боя — ровно как её рисует `drawHolographicBattle`. */
    const hologram = (phase: 'orbital' | 'ground', detail: number, flash: number) => {
      const ref = fakeCanvas();
      holo.drawHolographicBattle(ref.ctx, c.x, c.y, 1234, phase, prefs.glowOn(), detail, flash);
      return ref.calls;
    };
    const drawn = (detail = 1) => {
      frame.calls.length = 0;
      fleets.drawBattles(0, detail);
      return frame.calls.slice();
    };
    const orbital = hologram('orbital', 1, 0);
    let calls = drawn();
    expect(calls.slice(0, orbital.length)).toEqual(orbital);
    expect(calls.slice(orbital.length).find((k) => k.name === 'fillText')!.args.slice(1)).toEqual([c.x, c.y - 51]);
    putBattle({ ...battle, phase: 'ground' });
    const ground = hologram('ground', 1, 0);
    expect(drawn().slice(0, ground.length)).toEqual(ground);
    // На схеме — одно кольцо и без отсчёта.
    putBattle(battle);
    expect(drawn(0)).toEqual(hologram('orbital', 0, 0));
    // До раунда 0,3 с из 1,2 — кольцо стянуто на три четверти.
    putBattle({ ...battle, nextRoundAt: env.world.time + 300 });
    const flash = hologram('orbital', 1, 0.75);
    calls = drawn();
    expect(calls.slice(0, flash.length)).toEqual(flash);
    expect(flash).not.toEqual(orbital.slice(0, flash.length));
    // Раунд уже наступил или не назначен — вспышки нет.
    for (const nextRoundAt of [env.world.time, undefined]) {
      putBattle({ ...battle, nextRoundAt });
      calls = drawn();
      expect(calls.slice(0, orbital.length), String(nextRoundAt)).toEqual(orbital);
    }
  });

  it('за экраном ничего: ни флотов с портретами, ни колец орбит, ни боёв, ни трасс', async () => {
    const { fleets, frame, camera } = await battleAtHome();
    camera.setView({ scale: 1, x: 100_000, y: 100_000 });
    fleets.drawFleets(0, LOD());
    fleets.drawOrbitRings(0, 1);
    fleets.drawBattles(0, 1);
    fleets.drawBattleTracers(0);
    expect(frame.calls).toEqual([]);
  });

  it('бой в тумане не виден вовсе', async () => {
    const { fleets, frame, far, patchFleet, putBattle } = await boot();
    patchFleet('p2-1', { battleId: 'b2' });
    putBattle({ id: 'b2', location: far.id, phase: 'orbital', sides: [], round: 0, nextRoundAt: HOUR } as Battle);
    fleets.drawBattles(0, 1);
    expect(frame.calls).toEqual([]);
  });

  it('трассы огня: от каждого флота к ближайшему чужому, пунктир цвета стрелка бежит к цели; без движения стоит', async () => {
    const { fleets, frame, palette, geo, prefs, fleet, putFleet, patchFleet, home, next } = await battleAtHome();
    const A = geo.fleetAnchor(fleet('p1-1'))!;
    const B = geo.fleetAnchor(fleet('p2-9'))!;
    fleets.drawBattleTracers(400);
    const lines = frame.named('moveTo').map((m) => {
      const i = frame.calls.indexOf(m);
      return { from: m.args, to: frame.calls[i + 1]!.args, stroke: frame.calls[i + 2]! };
    });
    expect(lines.map((l) => [l.from, l.to])).toEqual([
      [[A.x, A.y], [B.x, B.y]],
      [[B.x, B.y], [A.x, A.y]],
    ]);
    expect([lines[0]!.stroke.stroke, lines[0]!.stroke.width, lines[0]!.stroke.dash, lines[0]!.stroke.offset]).toEqual([
      rgba(palette.ownerColor('p1'), 0.55), 1.4, [6, 9], -10,
    ]);
    expect(lines[1]!.stroke.stroke).toBe(rgba(palette.ownerColor('p2'), 0.55));
    // Движение выключено — пунктир стоит.
    frame.calls.length = 0;
    prefs.setMotion(false);
    fleets.drawBattleTracers(400);
    expect(frame.named('stroke')[0]!.offset).toBe(0);
    prefs.setMotion(true);
    // Второй чужой флот — у соседнего мира: свой стреляет в ближайшего, чужие друг в друга — нет.
    frame.calls.length = 0;
    putFleet({ ...fleet('p2-9'), id: 'p2-10', location: next.id });
    fleets.drawBattleTracers(400);
    // Третий в строю — строй перестраивается: точки берём заново.
    const [A3, B3, C3] = ['p1-1', 'p2-9', 'p2-10'].map((id) => geo.fleetAnchor(fleet(id))!);
    expect(Math.hypot(B3!.x - A3!.x, B3!.y - A3!.y)).toBeLessThan(Math.hypot(C3!.x - A3!.x, C3!.y - A3!.y));
    const nearest = B3!;
    expect(frame.named('moveTo')).toHaveLength(3);
    const own = frame.calls.findIndex((c) => c.name === 'moveTo' && near(c.args[0] as number, A3!.x) && near(c.args[1] as number, A3!.y));
    expect(frame.calls[own + 1]!.args).toEqual([nearest.x, nearest.y]);
    for (const foe of [B3!, C3!]) {
      const shot = frame.calls.findIndex((c) => c.name === 'moveTo' && near(c.args[0] as number, foe.x) && near(c.args[1] as number, foe.y));
      expect(frame.calls[shot + 1]!.args).toEqual([A3!.x, A3!.y]);
    }
    // Флот в пути из строя выходит.
    frame.calls.length = 0;
    patchFleet('p2-9', { location: null, movement: { from: home.id, to: next.id, departedAt: 0, arrivesAt: HOUR } });
    patchFleet('p2-10', { location: null, movement: { from: home.id, to: next.id, departedAt: 0, arrivesAt: HOUR } });
    fleets.drawBattleTracers(400);
    expect(frame.named('moveTo')).toEqual([]);
  });
});

describe('REFM-235 — стык флотов с main.ts', () => {
  const MAIN = readFileSync(new URL('./main.ts', import.meta.url), 'utf8');
  const FLEETS = readFileSync(new URL('./mapFleets.ts', import.meta.url), 'utf8');

  it('хуки — мир, место, кадр, часы и вид голограммы, тип сектора', () => {
    const init = MAIN.slice(MAIN.indexOf('initMapFleets({'), MAIN.indexOf('});', MAIN.indexOf('initMapFleets({')));
    for (const hook of ['world: () => s', 'me: () => ME', 'ctx: () => cx', 'clock: () => hologramTime', 'holographic: holographicMapOn', 'sectorType: sectorTypeOf'])
      expect(init, hook).toContain(hook);
  });

  it('флоты и бои живут только в модуле; кадр зовёт их над мирами и под контактами радара', () => {
    expect(MAIN).not.toMatch(/heroPortraitHits|ROUND_FLASH_MS|function roundFlash|const stationed/);
    const order = ['drawBattles(now, detail);', 'drawFlak();', 'drawWorlds(now, lod);', 'drawOrbitRings(now, detail);', 'drawBattleTracers(now);', 'drawFleets(now, lod);', 'drawRadarContacts(now);'].map((s) => MAIN.indexOf(s));
    expect(order.every((i) => i > 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it('модуль не тянет `main.ts`', () => {
    expect(FLEETS).not.toMatch(/from '\.\/main'/);
  });
});
