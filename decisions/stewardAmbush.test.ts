import { describe, expect, it } from 'vitest';
import { stewardAmbushes } from './stewardAmbush';
import {
  createInitialState,
  forkTAtEnd,
  forkTAtStart,
  parseGameData,
  setStance,
  type Context,
  type Fleet,
  type GameData,
  type GameState,
  type Planet,
} from '../packages/shared-core/src/index';

/**
 * Засада «Хранителя» (ROADS-6). Карта — та же, что в тестах ядра ROADS-3: у B соседи A и
 * C на одной тропе с развилкой F(60,0), D — на своей. B и C — наши (p1), A — враг (p2).
 * Враг идёт A→B→C: нога A→B кончается на развилке B (обход её планеты), 210 единиц.
 */
const data: GameData = parseGameData({
  version: '0.1.0',
  resources: ['metal'],
  units: {
    scout: { faction: 'x', stats: { attack: 2, defense: 2, speed: 10, hp: 10 } },
  },
  factions: {},
  buildings: {},
  events: {},
});
const HOUR = 3_600_000;
const NOW = 100 * HOUR;
const ctx: Context = { now: NOW, data };

function planet(id: string, owner: string | null, x: number, y: number, links: string[]): Planet {
  return {
    id,
    owner,
    position: { x, y },
    links,
    resources: {},
    buildings: [],
    garrison: [],
    traits: [],
  };
}
function world(): GameState {
  const s = createInitialState({ seed: 'amb', version: { data: '0.1.0', manifest: '1' } });
  const A = planet('A', 'p2', 200, -150, ['B']);
  const B = planet('B', 'p1', 0, 0, ['A', 'C', 'D']);
  const C = planet('C', 'p1', 200, 150, ['B']);
  const D = planet('D', null, -300, 0, ['B']);
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
  const state: GameState = { ...s, time: NOW, planets: { A, B, C, D }, fleets: {} };
  setStance(state, 'p1', 'p2', 'war');
  return state;
}
const fleet = (id: string, owner: string, count: number, patch: Partial<Fleet> = {}): Fleet => ({
  id,
  owner,
  location: null,
  movement: null,
  units: [{ unit: 'scout', count }],
  traits: [],
  ...patch,
});
/** Враг на ноге A→B, которая кончается на развилке B; дальше — `to`. */
function bypassing(s: GameState, id: string, count: number, arriveInH: number, to = 'C'): Fleet {
  return fleet(id, 'p2', count, {
    movement: {
      from: 'A',
      to: 'B',
      departedAt: NOW - HOUR,
      arrivesAt: NOW + arriveInH * HOUR,
      path: [to],
      destination: to,
      endT: forkTAtEnd(s, 'A', 'B'),
    },
  });
}
const everything = new Set(['A', 'B', 'C', 'D']);
const opts = (patch: Partial<Parameters<typeof stewardAmbushes>[3]> = {}) => ({
  identified: everything,
  busy: () => false,
  guarded: () => false,
  margin: 2 * HOUR,
  ...patch,
});

describe('ROADS-6 — «Хранитель» встаёт в засаду на развилке', () => {
  it('враг обходит нашу планету к нашему миру — сильнейшее крыло у неё встаёт на развилку', () => {
    const s = world();
    s.fleets.e1 = bypassing(s, 'e1', 1, 20);
    s.fleets.w1 = fleet('w1', 'p1', 2, { location: 'B' });
    s.fleets.w2 = fleet('w2', 'p1', 4, { location: 'B' });
    const plans = stewardAmbushes(s, 'p1', ctx, opts());
    expect(plans).toEqual([
      expect.objectContaining({
        fleetId: 'w2',
        node: 'B',
        exit: 'A',
        target: 'e1',
        t: forkTAtStart(s, 'B', 'A'),
      }),
    ]);
    expect(plans[0]!.fraction).toBeLessThan(0.35);
  });

  it('не обороняет чужое: враг идёт к миру, который не наш, — засады нет', () => {
    const s = world();
    s.planets.C!.owner = null;
    s.fleets.e1 = bypassing(s, 'e1', 1, 20);
    s.fleets.w1 = fleet('w1', 'p1', 4, { location: 'B' });
    expect(stewardAmbushes(s, 'p1', ctx, opts())).toEqual([]);
  });

  it('идущего К нашей планете встречают у неё, а не на развилке', () => {
    const s = world();
    s.fleets.e1 = fleet('e1', 'p2', 1, {
      movement: {
        from: 'A',
        to: 'B',
        departedAt: NOW - HOUR,
        arrivesAt: NOW + 20 * HOUR,
        destination: 'B',
      },
    });
    s.fleets.w1 = fleet('w1', 'p1', 4, { location: 'B' });
    expect(stewardAmbushes(s, 'p1', ctx, opts())).toEqual([]);
  });

  it('не успевает — не посылает: ствол 60 ед. это 6 ч, плюс запас 2 ч', () => {
    const s = world();
    s.fleets.e1 = bypassing(s, 'e1', 1, 7.9);
    s.fleets.w1 = fleet('w1', 'p1', 4, { location: 'B' });
    expect(stewardAmbushes(s, 'p1', ctx, opts())).toEqual([]);
    s.fleets.e1 = bypassing(s, 'e1', 1, 8);
    expect(stewardAmbushes(s, 'p1', ctx, opts())).toHaveLength(1);
  });

  it('проигрышную встречу не устраивает', () => {
    const s = world();
    s.fleets.e1 = bypassing(s, 'e1', 6, 20);
    s.fleets.w1 = fleet('w1', 'p1', 2, { location: 'B' });
    expect(stewardAmbushes(s, 'p1', ctx, opts())).toEqual([]);
  });

  it('с угрожаемой провинции и с точки удержания крыло не снимает', () => {
    const s = world();
    s.fleets.e1 = bypassing(s, 'e1', 1, 20);
    s.fleets.w1 = fleet('w1', 'p1', 4, { location: 'B' });
    expect(stewardAmbushes(s, 'p1', ctx, opts({ guarded: (n) => n === 'B' }))).toEqual([]);
  });

  it('без войны и сквозь туман — не видит врага, не ставит засаду', () => {
    const s = world();
    s.fleets.e1 = bypassing(s, 'e1', 1, 20);
    s.fleets.w1 = fleet('w1', 'p1', 4, { location: 'B' });
    expect(stewardAmbushes(s, 'p1', ctx, opts({ identified: new Set() }))).toEqual([]);
    setStance(s, 'p1', 'p2', 'peace');
    expect(stewardAmbushes(s, 'p1', ctx, opts())).toEqual([]);
  });

  it('на одну развилку — одно крыло, даже если враги идут с разных её веток', () => {
    const s = world();
    s.fleets.e1 = bypassing(s, 'e1', 1, 20);
    s.fleets.e2 = fleet('e2', 'p2', 1, {
      movement: {
        from: 'C',
        to: 'B',
        departedAt: NOW - HOUR,
        arrivesAt: NOW + 20 * HOUR,
        path: ['A'],
        destination: 'A',
        endT: forkTAtEnd(s, 'C', 'B'),
      },
    });
    s.planets.A!.owner = 'p1'; // обоим есть что оборонять
    s.fleets.w1 = fleet('w1', 'p1', 4, { location: 'B' });
    s.fleets.w2 = fleet('w2', 'p1', 4, { location: 'B' });
    expect(stewardAmbushes(s, 'p1', ctx, opts())).toHaveLength(1);
  });

  it('занятое в этом такте крыло не берёт', () => {
    const s = world();
    s.fleets.e1 = bypassing(s, 'e1', 1, 20);
    s.fleets.w1 = fleet('w1', 'p1', 4, { location: 'B' });
    expect(stewardAmbushes(s, 'p1', ctx, opts({ busy: () => true }))).toEqual([]);
  });
});
