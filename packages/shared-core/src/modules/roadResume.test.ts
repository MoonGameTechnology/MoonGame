import { describe, it, expect } from 'vitest';
import { createKernel } from '../kernel/kernel';
import { movementModule } from './movement';
import { combatModule } from './combat';
import { interceptModule } from './intercept';
import { captureOnArrivalModule } from './captureOnArrival';
import {
  createInitialState,
  type Fleet,
  type FleetEdge,
  type GameState,
  type Planet,
} from '../state/gameState';
import { parseGameData, type GameData } from '../data/schemas';
import { setStance } from '../state/diplomacy';
import type { Action, AdvanceResult, ApplyResult, Context, DomainEvent } from '../action/types';
import { fleetPositionAt } from '../state/fleetPosition';
import { forkTAtStart } from '../state/roads';
import { MAX_COMBAT_ROUNDS } from '../util/combat';

/**
 * ROADS-8 — флот, которого бой на дороге снял с марша, после боя идёт дальше.
 *
 * Находка плейтеста Sector Zero (PVR-2.4): победитель встречи на дороге оставался стоять
 * посреди неё — бой обнулял движение, и цель терялась. Владелец: «делай всё актуальное».
 * Правило касается только ДОРОГИ: бой у мира по-прежнему кончает марш на орбите — там
 * есть что делать (держать, бомбить, высаживать), а посреди дороги нет ничего.
 *
 * Ручная карта ROADS-3: D — прямая дорога в B длиной 300 (переход в (−150, 0)); A и C — на
 * одной тропе B с развилкой F в (60, 0).
 *
 *            A (200,−150)
 *           /
 *   D —— B(0,0) — F(60,0)
 *           \
 *            C (200,150)
 *
 * Все корабли летят 10 единиц в час.
 */

const data: GameData = parseGameData({
  version: '0.1.0',
  resources: ['metal'],
  units: {
    scout: { faction: 'x', stats: { attack: 1, defense: 1, speed: 10, hp: 6 } },
    // Кончает разведчика первым же залпом.
    brute: { faction: 'x', stats: { attack: 50, defense: 50, speed: 10, hp: 200 } },
    // Живучий: бой с ним идёт долго — хватает, чтобы успеть отступить или помириться.
    hulk: { faction: 'x', stats: { attack: 1, defense: 1, speed: 10, hp: 100 } },
    // Не наносит урона вовсе: двое таких упираются в предохранитель раундов.
    dove: { faction: 'x', stats: { attack: 0, defense: 0, speed: 10, hp: 10 } },
  },
  factions: {},
  buildings: {},
  events: {},
});
const HOUR = 3_600_000;
const ctx = (now: number): Context => ({ now, data });
const kernel = createKernel([movementModule, combatModule, interceptModule, captureOnArrivalModule]);

function planet(id: string, x: number, y: number, links: string[]): Planet {
  return {
    id,
    owner: null,
    position: { x, y },
    links,
    resources: { metal: 0 },
    buildings: [],
    garrison: [],
    traits: [],
  };
}

function world(): GameState {
  const s = createInitialState({ seed: 'resume', version: { data: '0.1.0', manifest: '1' } });
  const A = planet('A', 200, -150, ['B']);
  const B = planet('B', 0, 0, ['A', 'C', 'D']);
  const C = planet('C', 200, 150, ['B']);
  const D = planet('D', -300, 0, ['B']);
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
  const state: GameState = { ...s, planets: { A, B, C, D }, fleets: {} };
  setStance(state, 'p1', 'p2', 'war');
  return state;
}

function put(state: GameState, id: string, owner: string, at: string | FleetEdge, unit: string): void {
  state.fleets[id] = {
    id,
    owner,
    location: typeof at === 'string' ? at : null,
    ...(typeof at === 'string' ? {} : { edge: at }),
    movement: null,
    units: [{ unit, count: 1 }],
    traits: [],
  } as Fleet;
}

function ok(r: ApplyResult | AdvanceResult) {
  if (!r.ok) throw new Error(`failed: ${r.code}`);
  return r;
}
let seq = 0;
function act(state: GameState, owner: string, type: string, payload: unknown, at: number) {
  const action: Action = { id: `s:${owner}:${++seq}`, type, playerId: owner, payload, issuedAt: at };
  const r = ok(kernel.applyAction(state, action, ctx(at)));
  return { state: r.state, events: r.events };
}
const move = (s: GameState, fleetId: string, owner: string, target: string | FleetEdge, at: number) =>
  act(s, owner, 'fleet.move', typeof target === 'string' ? { fleetId, to: target } : { fleetId, toEdge: target }, at);
function until(state: GameState, hours: number, k = kernel): { state: GameState; events: DomainEvent[] } {
  const r = ok(k.advanceTo(state, ctx(hours * HOUR)));
  return { state: r.state, events: r.events };
}
const count = (events: DomainEvent[], type: string) => events.filter((e) => e.type === type).length;

/** Навстречу по прямой дороге D–B: встреча посередине, на 15-м часу. */
function headOn(mine: string, theirs: string, target: string | FleetEdge = 'B'): GameState {
  let s = world();
  put(s, 'f1', 'p1', 'D', mine);
  put(s, 'g1', 'p2', 'B', theirs);
  s = move(s, 'f1', 'p1', target, 0).state;
  return move(s, 'g1', 'p2', 'D', 0).state;
}

describe('ROADS-8 — победитель боя на дороге продолжает марш', () => {
  it('встреча на полосе: победитель доходит до своей цели', () => {
    // Разведчик гибнет первым залпом — бой начинается и кончается в миг встречи.
    const fought = until(headOn('brute', 'scout'), 15);
    expect(count(fought.events, 'battle.started')).toBe(1);
    expect(count(fought.events, 'battle.resolved')).toBe(1);
    expect(fought.state.fleets.g1).toBeUndefined();
    const winner = fought.state.fleets.f1!;
    expect(winner.battleId ?? null).toBeNull();
    expect(winner.resume).toBeUndefined(); // запомненный марш израсходован
    expect(winner.movement?.to).toBe('B');
    expect(winner.movement?.departedAt).toBe(15 * HOUR); // с места встречи, без простоя
    // Остаток пути — 150 единиц: мир B на 30-м часу, как и был бы без встречи.
    const home = until(fought.state, 30);
    expect(home.state.fleets.f1!.location).toBe('B');
  });

  it('приказ «встать на дороге» после боя доводится до той же точки', () => {
    // Встать на 80% дороги D→B — в 240 единицах от D, за 90 после места встречи.
    const target: FleetEdge = { from: 'D', to: 'B', t: 0.8 };
    const done = until(until(headOn('brute', 'scout', target), 15).state, 25);
    const f1 = done.state.fleets.f1!;
    expect(f1.movement).toBeNull();
    expect(f1.location).toBeNull();
    const p = fleetPositionAt(done.state, f1, 25 * HOUR)!;
    expect(p.x).toBeCloseTo(-60, 6); // (−300) + 240
    expect(p.y).toBeCloseTo(0, 6);
  });

  it('встреча на общем стволе (с другой дороги): победитель тоже идёт дальше', () => {
    // f1 идёт A→B: развилку проходит на 21-м часу, к миру пришёл бы на 27-м. g1 выходит из
    // B на C на 24-м часу. Их сводит детектор СТВОЛА (`fleet.meet`), а не полосы: на 25.5-м
    // часу, в 15 единицах от мира.
    let s = world();
    put(s, 'f1', 'p1', 'A', 'brute');
    put(s, 'g1', 'p2', 'B', 'scout');
    s = move(s, 'f1', 'p1', 'B', 0).state;
    s = until(s, 24).state;
    s = move(s, 'g1', 'p2', 'C', 24 * HOUR).state;
    const fought = until(s, 25.5);
    expect(fought.events.some((e) => e.type === 'fleet.meet')).toBe(true);
    expect(count(fought.events, 'battle.resolved')).toBe(1);
    expect(fought.state.fleets.f1!.movement?.to).toBe('B');
    // Остаток — те же 15 единиц: у мира на 27-м часу, как и без встречи.
    expect(until(fought.state, 27).state.fleets.f1!.location).toBe('B');
  });

  it('засада на развилке после победы остаётся сторожить развилку', () => {
    // Стоящий марша не имеет — ему нечего продолжать.
    let s = world();
    put(s, 'g1', 'p2', { from: 'B', to: 'A', t: forkTAtStart(s, 'B', 'A') }, 'brute');
    put(s, 'f1', 'p1', 'A', 'scout');
    s = move(s, 'f1', 'p1', 'C', 0).state;
    const fought = until(s, 21);
    expect(count(fought.events, 'battle.started')).toBe(1);
    expect(fought.state.fleets.g1!.resume).toBeUndefined();
    const after = until(fought.state, 23);
    expect(after.state.fleets.f1).toBeUndefined();
    const g1 = after.state.fleets.g1!;
    expect(g1.movement).toBeNull();
    const p = fleetPositionAt(after.state, g1, 23 * HOUR)!;
    expect(p.x).toBeCloseTo(60, 6);
    expect(p.y).toBeCloseTo(0, 6);
  });

  it('бой У МИРА марш по-прежнему кончает: победитель встаёт на орбиту', () => {
    // D→A идёт СКВОЗЬ мир B (тропы разные), а у B стоит враг: бой на узле, не на дороге.
    let s = world();
    put(s, 'g1', 'p2', 'B', 'scout');
    put(s, 'f1', 'p1', 'D', 'brute');
    s = move(s, 'f1', 'p1', 'A', 0).state;
    const after = until(s, 40);
    expect(count(after.events, 'battle.started')).toBe(1);
    const f1 = after.state.fleets.f1!;
    expect(f1.location).toBe('B');
    expect(f1.movement).toBeNull();
    expect(f1.resume).toBeUndefined();
  });
});

describe('ROADS-8 — кто марш НЕ продолжает', () => {
  it('ничья по предохранителю: оба стоят, и та же пара не сходится заново', () => {
    // Иначе оба пошли бы дальше из одной точки, тут же встретились бы снова и начали тот
    // же нулевой бой — ровно тот круг, который закрывает `MAX_COMBAT_ROUNDS` (CMB-6).
    const fought = until(headOn('dove', 'dove'), 15);
    const end = 15 + MAX_COMBAT_ROUNDS + 2;
    const after = until(fought.state, end);
    expect(count(after.events, 'battle.resolved')).toBe(1);
    expect(count(after.events, 'battle.started')).toBe(0);
    for (const id of ['f1', 'g1']) {
      const f = after.state.fleets[id]!;
      expect(f.battleId ?? null).toBeNull();
      expect(f.movement).toBeNull();
      expect(f.resume).toBeUndefined(); // запомненный марш не повис
    }
  });

  it('отступивший идёт туда, куда велели отойти, а оставшийся продолжает свой марш', () => {
    const fought = until(headOn('hulk', 'hulk'), 16);
    // Бой идёт: марш обоих снят и запомнен на его время.
    expect(fought.state.fleets.f1!.movement).toBeNull();
    expect(fought.state.fleets.f1!.resume).toEqual({ to: 'B' });
    expect(fought.state.fleets.g1!.resume).toEqual({ to: 'D' });
    // Отступление без точки отхода — просто разрыв: прерванный боем марш отменён.
    const retreat = act(fought.state, 'p1', 'fleet.retreat', { fleetId: 'f1' }, 16 * HOUR);
    const f1 = retreat.state.fleets.f1!;
    expect(f1.movement).toBeNull();
    expect(f1.resume).toBeUndefined();
    // Противник остался на дороге один — бой для него кончен, и он идёт к своему D.
    const g1 = retreat.state.fleets.g1!;
    expect(g1.resume).toBeUndefined();
    expect(g1.movement?.to).toBe('D');
  });

  it('перемирие посреди боя: оба идут дальше, каждый своей дорогой', () => {
    const fought = until(headOn('hulk', 'hulk'), 16);
    setStance(fought.state, 'p1', 'p2', 'peace');
    const after = until(fought.state, 17);
    expect(after.events.some((e) => (e.payload as { end?: string }).end === 'ceasefire')).toBe(true);
    expect(after.state.fleets.f1!.movement?.to).toBe('B');
    expect(after.state.fleets.g1!.movement?.to).toBe('D');
    // Мир — не враг: расходятся без новой встречи.
    expect(count(until(after.state, 40).events, 'battle.started')).toBe(0);
  });

  it('курс отказан (цель теперь за чужим миром) — победитель стоит, где дрался', () => {
    const marching = until(headOn('brute', 'scout'), 10);
    // Пока флоты шли, мир B достался третьему, с которым у p1 мир: проход закрыт.
    marching.state.planets.B!.owner = 'p3';
    setStance(marching.state, 'p1', 'p3', 'peace');
    const after = until(marching.state, 16);
    expect(count(after.events, 'battle.resolved')).toBe(1);
    const f1 = after.state.fleets.f1!;
    expect(f1.movement).toBeNull();
    expect(f1.edge).toBeDefined(); // стоит на дороге, как стоял бы до правила
    expect(f1.resume).toBeUndefined();
  });

  it('без модуля движения курса нет — победитель стоит, и память марша не висит', () => {
    // Встреча уже назначена; бой идёт на ядре, где некому дать курс.
    const marching = until(headOn('brute', 'scout'), 14);
    const bare = createKernel([combatModule, interceptModule]);
    const after = until(marching.state, 16, bare);
    expect(count(after.events, 'battle.resolved')).toBe(1);
    const f1 = after.state.fleets.f1!;
    expect(f1.battleId ?? null).toBeNull();
    expect(f1.movement).toBeNull();
    expect(f1.resume).toBeUndefined();
  });
});
