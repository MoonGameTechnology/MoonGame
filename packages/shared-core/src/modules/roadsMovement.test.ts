import { describe, it, expect } from 'vitest';
import { createKernel } from '../kernel/kernel';
import { movementModule } from './movement';
import { combatModule } from './combat';
import { captureOnArrivalModule } from './captureOnArrival';
import { createInitialState, type Fleet, type GameState, type Planet } from '../state/gameState';
import { parseGameData, type GameData } from '../data/schemas';
import { setStance } from '../state/diplomacy';
import type { Action, AdvanceResult, ApplyResult, Context, DomainEvent } from '../action/types';
import { fleetNodeAt, fleetPositionAt } from '../state/fleetPosition';
import { estimateTravelHours, journeyEtaMs, planRoute, routeDistance } from '../state/route';
import { roadAhead } from '../state/roads';

/**
 * ROADS-2 — флот летит по ДОРОГАМ (`docs/roads-roadmap.md` §0.3).
 *
 * Карта собрана руками, чтобы каждое число считалось в уме. Провинция B в начале
 * координат; соседи A и C — с востока, на ОДНОЙ тропе с развилкой F; D — с запада, на
 * своей тропе:
 *
 *            A (200,−150)
 *           /
 *   D —— B(0,0) — F(60,0)
 *           \
 *            C (200,150)
 *
 * Переходы — середины прямых: A|B (100,−75), C|B (100,75), D|B (−150,0).
 * Путь A→C по дорогам: A→(100,−75) 125, →F 85, →(100,75) 85, →C 125 = 420. Через планету
 * B было бы 540, по прямым до дорог — 500.
 */

const data: GameData = parseGameData({
  version: '0.1.0',
  resources: ['metal'],
  units: { scout: { faction: 'x', stats: { attack: 1, defense: 1, speed: 10, hp: 6 } } },
  factions: {},
  buildings: {},
  events: {},
});
const HOUR = 3_600_000;
const ctx = (now: number): Context => ({ now, data });
const kernel = createKernel([movementModule, combatModule, captureOnArrivalModule]);

function planet(id: string, owner: string | null, x: number, y: number, links: string[]): Planet {
  return {
    id,
    owner,
    position: { x, y },
    links,
    resources: { metal: 0 },
    buildings: [],
    garrison: [],
    traits: [],
  };
}
function fleet(id: string, owner: string, location: string): Fleet {
  return { id, owner, location, movement: null, units: [{ unit: 'scout', count: 1 }], traits: [] };
}

function world(
  opts: { roads?: boolean; hostileAtB?: boolean; ownerB?: string | null } = {},
): GameState {
  const roads = opts.roads ?? true;
  const s = createInitialState({ seed: 'roads', version: { data: '0.1.0', manifest: '1' } });
  const A = planet('A', 'p1', 200, -150, ['B']);
  const B = planet('B', opts.ownerB ?? null, 0, 0, ['A', 'C', 'D']);
  const C = planet('C', null, 200, 150, ['B']);
  const D = planet('D', null, -300, 0, ['B']);
  if (roads) {
    const xab = { x: 100, y: -75 };
    const xcb = { x: 100, y: 75 };
    const xdb = { x: -150, y: 0 };
    A.roads = { crossings: { B: xab }, trails: [{ exits: ['B'], fork: null }] };
    C.roads = { crossings: { B: xcb }, trails: [{ exits: ['B'], fork: null }] };
    D.roads = { crossings: { B: xdb }, trails: [{ exits: ['B'], fork: null }] };
    B.roads = {
      crossings: { A: xab, C: xcb, D: xdb },
      trails: [
        { exits: ['A', 'C'], fork: { x: 60, y: 0 } },
        { exits: ['D'], fork: null },
      ],
    };
  }
  const fleets: Record<string, Fleet> = { f1: fleet('f1', 'p1', 'A') };
  if (opts.hostileAtB) fleets.g1 = fleet('g1', 'p2', 'B');
  const state: GameState = { ...s, planets: { A, B, C, D }, fleets };
  if (opts.hostileAtB) setStance(state, 'p1', 'p2', 'war');
  return state;
}

function move(to: string): Action {
  return {
    id: 's:p1:1',
    type: 'fleet.move',
    playerId: 'p1',
    payload: { fleetId: 'f1', to },
    issuedAt: 0,
  };
}
function ok(r: ApplyResult | AdvanceResult) {
  if (!r.ok) throw new Error(`failed: ${r.code}`);
  return r;
}
/** Order the move at t=0 and run the clock to `hours`, collecting every event. */
function run(
  state: GameState,
  to: string,
  hours: number,
): { state: GameState; events: DomainEvent[] } {
  const a = ok(kernel.applyAction(state, move(to), ctx(0)));
  const b = ok(kernel.advanceTo(a.state, ctx(hours * HOUR)));
  return { state: b.state, events: [...a.events, ...b.events] };
}

describe('ROADS-2 — проход мимо планеты по развилке', () => {
  it('путь A→C идёт через развилку: 420 по дорогам, 42 часа на скорости 10', () => {
    expect(routeDistance(world(), 'A', ['B', 'C'])).toBeCloseTo(420, 9);
    expect(estimateTravelHours(world(), { data }, 'A', 'C', world().fleets.f1!)).toBeCloseTo(42, 9);
    const done = run(world(), 'C', 42);
    expect(done.state.fleets.f1!.location).toBe('C');
    // На 41-м часу флот ещё в пути: время — длина ДОРОГИ, а не прямой (50 ч) и не пути
    // через планету (54 ч).
    const early = run(world(), 'C', 41.9);
    expect(early.state.fleets.f1!.location).toBeNull();
  });

  it('на развилке — своё событие, прохода через планету НЕ случается', () => {
    const { events } = run(world(), 'C', 42);
    const types = events.map((e) => e.type);
    expect(types).toContain('fleet.fork');
    expect(events.find((e) => e.type === 'fleet.fork')!.payload).toMatchObject({
      at: 'B',
      from: 'A',
      to: 'C',
    });
    expect(events.some((e) => e.type === 'fleet.transit')).toBe(false);
  });

  it('стоящие у планеты НЕ ловят проходящего боковой дорогой (решение владельца)', () => {
    const { state, events } = run(world({ hostileAtB: true }), 'C', 42);
    expect(state.fleets.f1!.location).toBe('C');
    expect(events.some((e) => e.type === 'battle.started')).toBe(false);
  });

  it('проход мимо планеты пустую провинцию НЕ берёт (решение владельца)', () => {
    const { state } = run(world(), 'C', 42);
    expect(state.planets.B!.owner).toBeNull();
    expect(state.planets.C!.owner).toBe('p1'); // а куда прилетел — берёт, как раньше
  });

  it('путь на другую тропу идёт ЧЕРЕЗ планету — и там всё как прежде: встреча и захват', () => {
    // A и D на разных тропах B: только через мир. 125 + 85 + 60 + 150 + 150 = 570.
    expect(routeDistance(world(), 'A', ['B', 'D'])).toBeCloseTo(570, 9);
    const passing = run(world(), 'D', 57);
    expect(passing.events.some((e) => e.type === 'fleet.transit')).toBe(true);
    expect(passing.state.planets.B!.owner).toBe('p1');
    // Бой двух разведчиков кончается раньше, чем часы дойдут до конца — ищем его НАЧАЛО.
    const guarded = run(world({ hostileAtB: true }), 'D', 57);
    expect(guarded.events.some((e) => e.type === 'battle.started')).toBe(true);
  });

  it('корабль в пути стоит НА дороге, а не на прямой между центрами', () => {
    const { state } = run(world(), 'C', 10);
    // 100 единиц от A к переходу A|B: направление (−0.8, 0.6) → (120, −90).
    const p = fleetPositionAt(state, state.fleets.f1!, 10 * HOUR)!;
    expect(p.x).toBeCloseTo(120, 9);
    expect(p.y).toBeCloseTo(-90, 9);
    // Провинция — по переходу через границу, а не по середине доли пути.
    expect(fleetNodeAt(state, state.fleets.f1!, 10 * HOUR)).toBe('A');
    expect(fleetNodeAt(state, state.fleets.f1!, 14 * HOUR)).toBe('B');
  });

  it('оценка прибытия в пути знает, что нога кончается на развилке', () => {
    const { state } = run(world(), 'C', 5);
    const f = state.fleets.f1!;
    expect(journeyEtaMs(state, f, f.movement!, ctx(5 * HOUR))).toBeCloseTo(42 * HOUR, 3);
  });

  it('маршрутизатор выбирает проход через развилку, когда он короче', () => {
    expect(planRoute(world(), 'A', 'C')).toEqual(['B', 'C']);
  });
});

describe('ROADS-2 — линия маршрута показывает ту же дорогу, что пролетит флот', () => {
  it('путь A→C рисуется через развилку, а не через планету B', () => {
    const a = ok(kernel.applyAction(world(), move('C'), ctx(0)));
    const mv = a.state.fleets.f1!.movement!;
    expect(roadAhead(a.state, mv, 0)).toEqual([
      { x: 200, y: -150 },
      { x: 100, y: -75 },
      { x: 60, y: 0 },
      { x: 100, y: 75 },
      { x: 200, y: 150 },
    ]);
  });

  it('с середины первой ноги линия начинается с места флота и идёт дальше той же дорогой', () => {
    const a = ok(kernel.applyAction(world(), move('C'), ctx(0)));
    const mv = a.state.fleets.f1!.movement!;
    // Четверть дороги A→B (270): 67.5 от A — ещё до перехода.
    const ahead = roadAhead(a.state, mv, 0.25);
    expect(ahead[0]!.x).toBeCloseTo(200 - 0.8 * 67.5, 9);
    expect(ahead[0]!.y).toBeCloseTo(-150 + 0.6 * 67.5, 9);
    expect(ahead.slice(1)).toEqual([
      { x: 100, y: -75 },
      { x: 60, y: 0 },
      { x: 100, y: 75 },
      { x: 200, y: 150 },
    ]);
  });

  it('путь на другую тропу рисуется через планету', () => {
    const a = ok(kernel.applyAction(world(), move('D'), ctx(0)));
    const pts = roadAhead(a.state, a.state.fleets.f1!.movement!, 0);
    expect(pts).toContainEqual({ x: 0, y: 0 });
  });
});

describe('ROADS-2 — партия без сети дорог играет по прямым', () => {
  it('те же 500 единиц и 50 часов, и проход идёт через планету', () => {
    const plain = world({ roads: false });
    expect(routeDistance(plain, 'A', ['B', 'C'])).toBeCloseTo(500, 9);
    const { state, events } = run(plain, 'C', 50);
    expect(state.fleets.f1!.location).toBe('C');
    expect(events.some((e) => e.type === 'fleet.transit')).toBe(true);
    expect(events.some((e) => e.type === 'fleet.fork')).toBe(false);
    expect(run(plain, 'C', 49.9).state.fleets.f1!.location).toBeNull();
  });
});
