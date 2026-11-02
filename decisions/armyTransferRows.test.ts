import { describe, expect, it } from 'vitest';
import { createInitialState, parseGameData, type Fleet } from '../packages/shared-core/src/index';
import { armyTransferRows } from './armyTransferRows';

const stats = { attack: 1, defense: 1, speed: 0, hp: 20, cargoSize: 1 };
const data = parseGameData({
  version: 'test',
  resources: ['metal'],
  factions: {},
  buildings: {},
  events: {},
  units: {
    infantry: { faction: 'x', domain: 'ground', stats },
    fort: { faction: 'x', domain: 'ground', traits: ['immobile'], stats },
  },
  medals: { service: { grades: [1, 2, 3, 4] }, valour: { grades: [25, 60, 115, 225] } },
});
function fixture() {
  const state = createInitialState({ seed: 'rows', version: { data: 'test', manifest: '1' } });
  state.planets.a = {
    id: 'a',
    owner: 'p',
    position: { x: 0, y: 0 },
    buildings: [],
    resources: {},
    traits: [],
    garrison: [
      { unit: 'infantry', count: 4, armyGroup: 'new' },
      { unit: 'infantry', count: 4, armyGroup: 'veteran', hp: 40, battles: 3 },
      { unit: 'fort', count: 1, armyGroup: 'fixed' },
    ],
  };
  const fleet: Fleet = {
    id: 'f',
    owner: 'p',
    location: 'a',
    movement: null,
    units: [],
    traits: [],
    landing: [{ unit: 'infantry', count: 3, armyGroup: 'aboard', hp: 30, battles: 1 }],
    loading: [
      {
        unit: 'infantry',
        count: 1,
        from: 'a',
        startAt: 0,
        doneAt: 1,
        sources: [{ group: 'veteran', count: 1 }],
      },
    ],
    unloading: [
      {
        unit: 'infantry',
        count: 2,
        to: 'a',
        startAt: 0,
        doneAt: 1,
        sources: [{ group: 'aboard', count: 2 }],
      },
    ],
  };
  state.fleets.f = fleet;
  state.fleets.other = {
    ...fleet,
    id: 'other',
    landing: [],
    unloading: [],
    loading: [
      {
        unit: 'infantry',
        count: 2,
        from: 'a',
        startAt: 0,
        doneAt: 1,
        sources: [{ group: 'veteran', count: 2 }],
      },
    ],
  };
  return { state, fleet };
}
describe('army transfer source rows', () => {
  it('distinguishes same-type groups by health and service and subtracts all source reservations', () => {
    const { state, fleet } = fixture();
    const before = structuredClone(state);
    const rows = armyTransferRows(state, fleet, true, data);
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({ key: 'garrison:new', grade: 0, health: 100, reserved: 0 });
    expect(rows[1]).toMatchObject({
      key: 'garrison:veteran',
      group: 'veteran',
      grade: 3,
      battles: 3,
      health: 50,
      garrison: 4,
      reserved: 3,
      queued: 1,
    });
    expect(rows[2]).toMatchObject({
      key: 'hold:aboard',
      group: 'aboard',
      grade: 1,
      health: 50,
      hold: 1,
      holdAll: 3,
      queued: 2,
    });
    expect(state).toEqual(before);
  });
  it('never offers allied garrison units or invents authoritative identities', () => {
    const { state, fleet } = fixture();
    delete fleet.landing![0]!.armyGroup;
    const rows = armyTransferRows(state, fleet, false, data);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ side: 'hold', prepared: false, group: undefined });
    expect(fleet.landing![0]!.armyGroup).toBeUndefined();
  });
  it('has no dockside groups while the fleet has no location', () => {
    const { state, fleet } = fixture();
    fleet.location = null;
    expect(armyTransferRows(state, fleet, true, data)).toEqual([]);
  });
});
