import { describe, expect, it } from 'vitest';
import { ambushOf } from './forkAmbush';
import {
  createInitialState,
  type GameState,
  type Planet,
} from '../packages/shared-core/src/state/gameState';
import { forkTAtEnd, forkTAtStart } from '../packages/shared-core/src/state/roads';

/**
 * Засада на рисунке (ROADS-4): кто стоит на развилке. Карта — та же, что в тестах ядра
 * ROADS-3: у B соседи A и C на одной тропе с развилкой F(60,0), D — на своей.
 */
function planet(id: string, x: number, y: number, links: string[]): Planet {
  return {
    id,
    owner: null,
    position: { x, y },
    links,
    resources: {},
    buildings: [],
    garrison: [],
    traits: [],
  };
}
function world(): GameState {
  const s = createInitialState({ seed: 'ambush', version: { data: 't', manifest: 't' } });
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
  return { ...s, planets: { A, B, C, D } };
}
const parked = (from: string, to: string, t: number) => ({
  location: null,
  movement: null,
  edge: { from, to, t },
});

describe('ROADS-4 — флот на развилке виден как засада', () => {
  it('стоящий на развилке — в засаде; ответ тот же с любого конца дороги', () => {
    const s = world();
    const want = { province: 'B', exits: ['A', 'C'] };
    expect(ambushOf(s, parked('B', 'A', forkTAtStart(s, 'B', 'A')))).toEqual(want);
    expect(ambushOf(s, parked('A', 'B', forkTAtEnd(s, 'A', 'B')))).toEqual(want);
    expect(ambushOf(s, parked('C', 'B', forkTAtEnd(s, 'C', 'B')))).toEqual(want);
  });

  it('стоящий на дороге мимо развилки — не в засаде: он сторожит одну дорогу', () => {
    const s = world();
    expect(ambushOf(s, parked('B', 'A', 0.1))).toBeNull(); // на стволе
    expect(ambushOf(s, parked('B', 'A', 0.5))).toBeNull(); // на ветке
    expect(ambushOf(s, parked('B', 'D', 0.3))).toBeNull(); // тропа без развилки
  });

  it('у планеты, в пути и в бою — не засада', () => {
    const s = world();
    const t = forkTAtStart(s, 'B', 'A');
    expect(ambushOf(s, { location: 'B', movement: null, edge: null })).toBeNull();
    expect(
      ambushOf(s, {
        location: null,
        movement: { from: 'B', to: 'A', departedAt: 0, arrivesAt: 1 },
        edge: null,
      }),
    ).toBeNull();
    expect(ambushOf(s, { ...parked('B', 'A', t), battleId: 'battle:1' })).toBeNull();
  });
});
