import { describe, expect, it } from 'vitest';
import { createInitialState, createKernel, armyModule, veteranXp, parseGameData, type Fleet } from '../packages/shared-core/src/index';
import { armyTransferRows, hasPlannedArmyLoad, splitArmyTransferSources } from './armyTransferRows';
import { damageUnits } from '../packages/shared-core/src/util/combat';

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


describe('compatible formation display without changing combat wounds', () => {
  it('shows one row with total HP and preserves casualties after opening the real menu', () => {
    const { state, fleet } = fixture();
    state.players.p = { id: 'p', name: 'P', faction: 'x', status: 'active', resources: {} };
    delete state.fleets.other;
    fleet.loading = []; fleet.unloading = []; fleet.landing = [];
    state.planets.a!.garrison = [
      { unit: 'infantry', count: 1, hp: 4 }, { unit: 'infantry', count: 1, hp: 4 },
    ];
    const baseline = structuredClone(state.planets.a!.garrison);
    const prepared = createKernel([armyModule]).applyAction(state,
      { id: 'prepare', type: 'army.prepare', playerId: 'p', issuedAt: 0, payload: { fleetId: 'f' } }, { now: 0, data });
    if (!prepared.ok) throw new Error(prepared.code);
    const rows = armyTransferRows(prepared.state, prepared.state.fleets.f!, true, data);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ garrisonAll: 2, hp: 8, maxHp: 40, health: 20 });
    expect(rows[0]!.transferSources).toHaveLength(2);
    const actual = damageUnits(prepared.state.planets.a!.garrison, 1, data);
    const expected = damageUnits(baseline, 1, data);
    expect(actual.deaths).toEqual(expected.deaths);
    expect(actual.deaths).toEqual([]);
    expect(actual.survivors.map(({ count, hp }) => ({ count, hp })))
      .toEqual(expected.survivors.map(({ count, hp }) => ({ count, hp })));
    expect(state.planets.a!.garrison).toEqual([{ unit: 'infantry', count: 1, hp: 4 }, { unit: 'infantry', count: 1, hp: 4 }]);
  });
  it('combines health for display but retains the precise reservations and loadouts', () => {
    const { state, fleet } = fixture();
    fleet.landing = [];
    state.planets.a!.garrison = [
      { unit: 'infantry', count: 4, armyGroup: 'healthy', battles: 3 },
      { unit: 'infantry', count: 2, armyGroup: 'veteran', battles: 3, hp: 24.8 },
      { unit: 'infantry', count: 1, armyGroup: 'equipped', battles: 3, modules: ['plate'] },
    ];
    // The other fleet owns two units of the wounded source; this fleet owns one.
    const before = structuredClone(state);
    const rows = armyTransferRows(state, fleet, true, data);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ hp: 104.8, maxHp: 120, health: 87.3, garrisonAll: 6, reserved: 2 });
    expect(rows[0]!.transferSources).toEqual([{ group: 'healthy', count: 4 }, { group: 'veteran', count: 0 }]);
    expect(state).toEqual(before);
  });
  it('apportions whole units without consuming reservations or duplicating a source', () => {
    const sources = [{ group: 'reserved', count: 0 }, { group: 'one', count: 1 }, { group: 'nine', count: 9 }];
    for (let requested = 0; requested <= 12; requested++) {
      const result = splitArmyTransferSources(sources, requested);
      expect(result.reduce((sum, s) => sum + s.count, 0)).toBe(Math.min(requested, 10));
      for (const source of result) expect(source.count).toBeLessThanOrEqual(sources.find(s => s.group === source.group)!.count);
      expect(new Set(result.map(s => s.group)).size).toBe(result.length);
    }
    expect(splitArmyTransferSources(sources, NaN)).toEqual([]);
    expect(splitArmyTransferSources(sources, -1)).toEqual([]);
    expect(splitArmyTransferSources([{ group: 'wounded', count: 4 }, { group: 'healthy', count: 4 }], 2))
      .toEqual([{ group: 'wounded', count: 1 }, { group: 'healthy', count: 1 }]);
  });
});


it('opening and regrouping the menu never mints veteran XP or averages valour ledgers', () => {
  const { state, fleet } = fixture();
  const rewardData = { ...data, rewards: { ...data.rewards, medalXp: [10, 20, 40, 100] } };
  state.players.p = { id: 'p', name: 'P', faction: 'x', status: 'active', resources: {} };
  delete state.fleets.other;
  fleet.loading = []; fleet.unloading = []; fleet.landing = [];
  state.planets.a!.garrison = [
    { unit: 'infantry', count: 100, damageDealt: 59 },
    { unit: 'infantry', count: 1, damageDealt: 250 },
  ];
  expect(veteranXp(state, 'p', rewardData)).toBe(1100);
  const kernel = createKernel([armyModule]);
  let current = state;
  for (let i = 0; i < 100; i++) {
    const prepared = kernel.applyAction(current,
      { id: 'prepare:' + i, type: 'army.prepare', playerId: 'p', issuedAt: 0, payload: { fleetId: 'f' } }, { now: 0, data: rewardData });
    if (!prepared.ok) throw new Error(prepared.code);
    current = prepared.state;
    expect(armyTransferRows(current, current.fleets.f!, true, rewardData)).toHaveLength(1);
  }
  expect(veteranXp(JSON.parse(JSON.stringify(current)), 'p', rewardData)).toBe(1100);
  expect(current.planets.a!.garrison.map(({ count, damageDealt }) => ({ count, damageDealt })))
    .toEqual(state.planets.a!.garrison.map(({ count, damageDealt }) => ({ count, damageDealt })));
});
