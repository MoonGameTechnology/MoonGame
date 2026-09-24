import { describe, expect, it } from 'vitest';
import { stewardGuardOrders, order, advance, HOUR } from './game';
import {
  createInitialState,
  forkTAtStart,
  setStance,
  type Fleet,
  type GameState,
  type Planet,
  type UnitStack,
} from '../../packages/shared-core/src/index';
import { moveFleet } from '../../decisions/actions';

/**
 * ROADS-6 — «Хранитель» ставит засаду на развилке, и она ловит, через НАСТОЯЩЕЕ ядро.
 *
 * Карта — та же, что в тестах ядра ROADS-3: у B соседи A и C на одной тропе с развилкой
 * F(60,0), D — на своей. B и C — наши (p1), A — враг (p2). Враг идёт A→C: мимо планеты B,
 * через её развилку, — стоящие у B его бы не встретили (решение владельца §0.2).
 */
const NOW = 500 * HOUR;
const stacks = (list: Array<[string, number]>): UnitStack[] =>
  list.map(([unit, count]) => ({ unit, count }));
function world(id: string, owner: string | null, x: number, y: number, links: string[]): Planet {
  return {
    id,
    owner,
    kind: 'planet',
    position: { x, y },
    resources: {},
    buildings: [],
    garrison: [],
    traits: [],
    links,
  };
}
function fl(id: string, owner: string, patch: Partial<Fleet>): Fleet {
  return { id, owner, location: null, movement: null, units: [], traits: [], ...patch };
}
function roadsState(posture: 'defend' | 'active_defend'): GameState {
  const s = createInitialState({ seed: 'amb', version: { data: '0.1.0', manifest: '1' } });
  const A = world('A', 'p2', 200, -150, ['B']);
  const B = world('B', 'p1', 0, 0, ['A', 'C', 'D']);
  const C = world('C', 'p1', 200, 150, ['B']);
  const D = world('D', null, -300, 0, ['B']);
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
  const player = (id: string) => ({
    id,
    name: id,
    faction: 'azure',
    status: 'active' as const,
    resources: {},
  });
  const state: GameState = {
    ...s,
    time: NOW,
    // Засада — про дороги, а не про зрение: круг мира B накрывает соседей A и C (по 250),
    // иначе «Хранитель» просто не увидел бы, кого ловить (зрение кругами, 2026-09-24).
    sight: { world: 260, fleet: 40, radarScale: 1 },
    planets: {
      A,
      B,
      C,
      D,
      // Дальний нейтральный остров: разбавляет долю p1, чтобы прогон через ядро не
      // кончился победой по доминированию посреди теста (приём stewardGuard.test.ts).
      N1: world('N1', null, 2000, 0, ['N2']),
      N2: world('N2', null, 2100, 0, ['N1']),
    },
    fleets: {
      e1: fl('e1', 'p2', { location: 'A', units: stacks([['cruiser', 1]]) }),
      w1: fl('w1', 'p1', { location: 'B', units: stacks([['cruiser', 3]]) }),
    },
    players: {
      p1: { ...player('p1'), steward: { posture, until: NOW + 1000 * HOUR } },
      p2: player('p2'),
    },
  };
  setStance(state, 'p1', 'p2', 'war');
  return state;
}
/** Враг выходит A→C (мимо планеты B) через настоящее ядро. */
function enemySetsOff(s: GameState): GameState {
  const r = order(s, moveFleet('p2', 'e1', 'C'), s.time);
  expect(r.error).toBeUndefined();
  return r.state;
}

describe('ROADS-6 — засада «Хранителя» через настоящее ядро', () => {
  it('«Активная оборона»: крыло у B встаёт на развилку, журнал это записывает', () => {
    const s = enemySetsOff(roadsState('active_defend'));
    expect(s.fleets.e1!.movement).toMatchObject({ from: 'A', to: 'B', path: ['C'] });
    const orders = stewardGuardOrders(s, 'p1', 'active_defend');
    expect(orders.map((a) => a.type)).toEqual(['fleet.move', 'steward.report']);
    expect(orders[0]!.payload).toEqual({
      fleetId: 'w1',
      toEdge: { from: 'B', to: 'A', t: forkTAtStart(s, 'B', 'A') },
    });
    expect((orders[1]!.payload as { entries: unknown[] }).entries).toEqual([
      expect.objectContaining({ kind: 'ambush', node: 'B', fleetId: 'w1' }),
    ]);
  });

  it('«Оборона» держит рубеж и засад не ставит', () => {
    const s = enemySetsOff(roadsState('defend'));
    expect(stewardGuardOrders(s, 'p1', 'defend')).toEqual([]);
  });

  it('крыло успевает встать, и проходящий мимо планеты попадается на развилке', () => {
    let s = enemySetsOff(roadsState('active_defend'));
    for (const a of stewardGuardOrders(s, 'p1', 'active_defend')) {
      const r = order(s, a, s.time);
      expect(r.error).toBeUndefined();
      s = r.state;
    }
    expect(s.players.p1!.stewardLog).toMatchObject([{ kind: 'ambush', node: 'B' }]);
    const arrives = s.fleets.e1!.movement!.arrivesAt;
    // Крыло на развилке раньше врага…
    const early = advance(s, arrives - HOUR);
    expect(early.error).toBeUndefined();
    expect(early.state.fleets.w1!.edge).toEqual({
      from: 'B',
      to: 'A',
      t: forkTAtStart(s, 'B', 'A'),
    });
    // …и в миг, когда враг до неё доходит, начинается бой в провинции B.
    const caught = advance(early.state, arrives);
    expect(caught.error).toBeUndefined();
    const started = caught.events.filter((e) => e.type === 'battle.started');
    expect(started).toEqual([
      expect.objectContaining({ payload: expect.objectContaining({ location: 'B' }) }),
    ]);
    expect(caught.state.fleets.e1!.location).toBeNull(); // до C не дошёл
  });
});
