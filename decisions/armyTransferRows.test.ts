import { describe, expect, it } from 'vitest';
import { createInitialState, parseGameData, type Fleet } from '../packages/shared-core/src/index';
import { armyTransferRows, hasPlannedArmyLoad } from './armyTransferRows';

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
  it('reports pooled HP with a tenth of a percent without changing stored HP', () => {
    const { state, fleet } = fixture();
    state.planets.a!.garrison = [{ unit: 'infantry', count: 6, hp: 104.8, armyGroup: 'pool' }];
    expect(armyTransferRows(state, fleet, true, data)[0]).toMatchObject({ hp: 104.8, maxHp: 120, health: 87.3 });
    expect(state.planets.a!.garrison[0]!.hp).toBe(104.8);
  });
  it('recognizes a selected formation for tutorial readiness and ignores unloads, stale groups and other types', () => {
    const { state, fleet } = fixture();
    state.fleets[fleet.id] = fleet;
    const selected = (plan: Record<string, number>, unit = 'infantry') =>
      hasPlannedArmyLoad(state, { fleetId: fleet.id, plan }, unit, data);
    expect(selected({ 'garrison:new': 2 })).toBe(true);
    expect(selected({ 'garrison:veteran': 1 })).toBe(true);
    expect(selected({ 'hold:aboard': -1 })).toBe(false);
    expect(selected({ 'garrison:missing': 1 })).toBe(false);
    expect(selected({ 'garrison:new': 1 }, 'fort')).toBe(false);
    expect(selected({})).toBe(false);
    state.planets.a!.garrison[0]!.count = 0;
    expect(selected({ 'garrison:new': 1 })).toBe(false);
  });
  it('distinguishes same-type groups by health and service and subtracts all source reservations', () => {
    const { state, fleet } = fixture();
    const before = structuredClone(state);
    const rows = armyTransferRows(state, fleet, true, data);
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({ key: 'garrison:new', grade: 0, health: 100, hp: 80, maxHp: 80, reserved: 0 });
    expect(rows[1]).toMatchObject({
      key: 'garrison:veteran',
      group: 'veteran',
      grade: 3,
      battles: 3,
      health: 50,
      hp: 40,
      maxHp: 80,
      garrison: 4,
      reserved: 3,
      queued: 1,
    });
    expect(rows[2]).toMatchObject({
      key: 'hold:aboard',
      group: 'aboard',
      grade: 1,
      health: 50,
      hp: 30,
      maxHp: 60,
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
