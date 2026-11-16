import { describe, expect, it } from 'vitest';
import { aiOrders, newGame, START_CANDIDATES } from './game';
import { canOrder } from './protoKernel';
import { data } from './gameData';
import type { GameState } from '../../packages/shared-core/src/index';

function scenario(): GameState {
  const state = newGame({
    seats: [
      { id: 'p1', name: 'A', faction: 'azure', start: START_CANDIDATES[0]!, ai: true },
      { id: 'p2', name: 'B', faction: 'crimson', start: START_CANDIDATES[1]!, ai: true },
    ],
  });
  state.diplomacy = { ...state.diplomacy, 'p1|p2': 'war' };
  state.players.p2!.resources = {
    credits: 9000,
    metal: 9000,
    food: 900,
    energy: 900,
    microelectronics: 900,
  };
  return state;
}
const homeOf = (s: GameState) =>
  Object.values(s.planets).find(
    (p) =>
      p.owner === 'p2' && p.buildings.some((b) => data.buildings[b.type]?.enablesShipConstruction),
  )!;

describe('AI legal planning regressions from FFA-20', () => {
  it('chooses another target instead of repeatedly moving to its current foreign province', () => {
    const state = scenario();
    const province = Object.values(state.planets).find((p) => p.owner !== 'p2')!;
    province.kind = 'dead_world';
    province.owner = 'p1';
    province.garrison = [{ unit: 'militia', count: 100 }];
    state.fleets = {
      F: {
        id: 'F',
        owner: 'p2',
        location: province.id,
        movement: null,
        units: [{ unit: 'cruiser', count: 3 }],
        traits: [],
        orbit: 'near',
      },
    };
    const move = aiOrders(state, 'p2', 'expand', 'strong').find((a) => a.type === 'fleet.move');
    expect(move).toBeDefined();
    expect(move!.payload).not.toMatchObject({ to: province.id });
    expect(canOrder(state, move!)).toBeNull();
  });

  it('does not lift troops into a hold already occupied by shuttles', () => {
    const state = scenario();
    const home = homeOf(state);
    home.garrison = [{ unit: 'militia', count: 30 }];
    const capacity = 2 * data.units.cruiser!.stats.cargoCapacity;
    const size = data.units.landing_shuttle!.stats.cargoSize;
    state.fleets = {
      F: {
        id: 'F',
        owner: 'p2',
        location: home.id,
        movement: null,
        units: [{ unit: 'cruiser', count: 2 }],
        traits: [],
        orbit: 'near',
        hangar: [{ id: 'sq', units: [{ unit: 'landing_shuttle', count: capacity / size }] }],
      },
    };
    const loads = aiOrders(state, 'p2', 'expand', 'strong').filter((a) => a.type === 'army.load');
    expect(loads).toEqual([]);
  });

  it('does not order production on a world suppressed by orbital bombardment', () => {
    const state = scenario();
    const home = homeOf(state);
    state.fleets = {
      foe: {
        id: 'foe',
        owner: 'p1',
        location: home.id,
        movement: null,
        units: [{ unit: 'cruiser', count: 3 }],
        traits: [],
        orbit: 'near',
        bombarding: true,
      },
    };
    const production = aiOrders(state, 'p2', 'expand', 'strong').filter((a) =>
      ['unit.build', 'building.construct', 'building.upgrade'].includes(a.type),
    );
    expect(production.filter((a) => canOrder(state, a) === 'E_BOMBARDED')).toEqual([]);
  });

  it('does not launch a fleet from a base whose garrison holds only infantry', () => {
    // The core forms a fleet from units whose `domain` is not ground (`fleet.launch`).
    // Fortress garrison and drop infantry carry no `ground` trait, and the bot used to
    // count them as ships: `fleet.launch` → `E_NO_SHIPS` every tick.
    const state = scenario();
    const home = homeOf(state);
    for (const f of Object.values(state.fleets)) if (f.owner === 'p2') delete state.fleets[f.id];
    home.garrison = [
      { unit: 'garrison', count: 2 },
      { unit: 'drop_infantry', count: 2 },
    ];
    const launches = () =>
      aiOrders(state, 'p2', 'expand', 'strong').filter((a) => a.type === 'fleet.launch');
    expect(launches()).toEqual([]);
    home.garrison.push({ unit: 'cruiser', count: 1 });
    expect(launches()).toHaveLength(1);
    expect(canOrder(state, launches()[0]!)).toBeNull();
  });
});
