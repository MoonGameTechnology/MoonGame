import { describe, expect, it } from 'vitest';
import { parseGameData } from '../data/schemas';
import { createInitialState, type UnitStack } from '../state/gameState';
import { createKernel } from '../kernel/kernel';
import { armyModule } from '../modules/army';
import { fleetOpsModule } from '../modules/fleetOps';
import { consolidateGroundStacks, takeFromStacks } from './stacks';
import { prepareArmyGroups } from './armySelection';

const data = parseGameData({ version: 'test', resources: ['metal'], factions: {}, buildings: {}, events: {},
  units: {
    infantry: { faction: 'x', domain: 'ground', stats: { attack: 1, defense: 1, speed: 1, hp: 100, shield: 20, cargoSize: 1 } },
    ship: { faction: 'x', stats: { attack: 1, defense: 1, speed: 1, hp: 100, cargoCapacity: 20 } },
  },
});
const groups = (): UnitStack[] => [
  { unit: 'infantry', count: 4, battles: 3 },
  { unit: 'infantry', count: 2, battles: 3, hp: 124, shieldHp: 10 },
];

describe('ground formation HP pooling', () => {
  it('sums actual HP and shields, weighted by troop count, without mutating inputs', () => {
    const input = groups();
    const out = consolidateGroundStacks(input, data);
    expect(out).toEqual([{ unit: 'infantry', count: 6, battles: 3, hp: 524, shieldHp: 90 }]);
    expect(input).toEqual(groups());
    expect(consolidateGroundStacks(out, data)).toEqual(out);
    expect(consolidateGroundStacks([...input].reverse(), data)).toEqual(out);
  });
  it.each([
    { battles: 1 }, { modules: ['plate'] }, { stationScale: 2 },
  ])('keeps different formation identities separate: %j', (extra) => {
    expect(consolidateGroundStacks([groups()[0]!, { ...groups()[1]!, ...extra }], data)).toHaveLength(2);
  });
  it('does not combine different module stars or rarities', () => {
    const base = { unit: 'infantry', count: 2, modules: ['plate'] };
    expect(consolidateGroundStacks([base, { ...base, moduleStars: { plate: 1 } }], data)).toHaveLength(2);
    expect(consolidateGroundStacks([base, { ...base, moduleRarity: { plate: 'rare' } }], data)).toHaveLength(2);
  });
  it('does not alter the ship merging rules or convert zero-health troops into healthy troops', () => {
    expect(consolidateGroundStacks([{ unit: 'ship', count: 2 }, { unit: 'ship', count: 1, hp: 20 }], data)).toHaveLength(2);
    expect(consolidateGroundStacks([{ unit: 'infantry', count: 1, hp: 0 }, { unit: 'infantry', count: 1, hp: 10 }], data)[0]).toMatchObject({ count: 2, hp: 10 });
  });
  it('conserves pools over repeated partial splits and merges', () => {
    let pooled = consolidateGroundStacks(groups(), data);
    for (let i = 0; i < 1000; i++) {
      const moved = takeFromStacks(pooled, 'infantry', 1);
      pooled = consolidateGroundStacks([...pooled, ...moved], data);
    }
    expect(pooled).toHaveLength(1);
    expect(pooled[0]!.count).toBe(6);
    expect(pooled[0]!.hp).toBeCloseTo(524, 8);
    expect(pooled[0]!.shieldHp).toBeCloseTo(90, 8);
  });
  it('keeps already reserved groups stable, including a legacy wounded-first order', () => {
    const state = createInitialState({ seed: 'claims', version: { data: 'test', manifest: '1' } });
    const input = groups();
    const claims = [{ unit: 'infantry', count: 1, first: 'wounded' as const }];
    prepareArmyGroups(state, input, claims, data);
    expect(input).toHaveLength(2);
    expect((claims[0] as { sources?: unknown }).sources).toEqual([{ group: input[1]!.armyGroup, count: 1 }]);
    prepareArmyGroups(state, input, [], data);
    expect(input).toHaveLength(1);
    expect(input[0]).toMatchObject({ count: 6, hp: 524, shieldHp: 90 });
  });
  it('pools cargo after the real fleet merge bus event, retaining bombardment and auto-assault', () => {
    const kernel = createKernel([fleetOpsModule, armyModule]);
    const state = createInitialState({ seed: 'fleet-pool', version: { data: 'test', manifest: '1' } });
    state.players.p = { id: 'p', name: 'P', faction: 'x', status: 'active', resources: {} };
    state.planets.a = { id: 'a', owner: 'p', position: { x: 0, y: 0 }, buildings: [], traits: [], resources: {}, garrison: [] };
    for (const [i, id] of ['from', 'into'].entries()) state.fleets[id] = {
      id, owner: 'p', location: 'a', movement: null, units: [{ unit: 'ship', count: 1 }], traits: [],
      landing: [groups()[i]!],
    };
    state.fleets.from!.bombarding = true;
    state.fleets.from!.bombardNextAt = 3600000;
    state.autoAssault = { into: true };
    const result = kernel.applyAction(state, { id: 'merge', type: 'fleet.merge', playerId: 'p', issuedAt: 0,
      payload: { from: 'from', into: 'into' } }, { now: 0, data });
    if (!result.ok) throw new Error(result.code);
    expect(result.state.fleets.from).toBeUndefined();
    expect(result.state.fleets.into!.landing).toEqual([{ unit: 'infantry', count: 6, battles: 3, hp: 524, shieldHp: 90 }]);
    expect(result.state.fleets.into).toMatchObject({ bombarding: true, bombardNextAt: 3600000 });
    expect(result.state.autoAssault).toEqual({ into: true });
    expect(state.fleets.from!.landing).toEqual([groups()[0]]);
  });
  it('uses real delayed load/unload actions, preserves input and does not execute a completed order twice', () => {
    const kernel = createKernel([armyModule]);
    let state = createInitialState({ seed: 'pool', version: { data: 'test', manifest: '1' } });
    state.players.p = { id: 'p', name: 'P', faction: 'x', status: 'active', resources: {} };
    state.planets.a = { id: 'a', owner: 'p', position: { x: 0, y: 0 }, buildings: [], traits: [], resources: {}, garrison: groups() };
    state.fleets.f = { id: 'f', owner: 'p', location: 'a', movement: null, units: [{ unit: 'ship', count: 1 }], traits: [], landing: [{ unit: 'infantry', count: 2, battles: 3, hp: 162 }] };
    const before = structuredClone(state);
    const apply = (type: string, payload: object) => {
      const r = kernel.applyAction(state, { id: type, type, playerId: 'p', issuedAt: state.time, payload }, { now: state.time, data });
      if (!r.ok) throw new Error(r.code); state = r.state;
    };
    const advance = (time: number) => { const r = kernel.advanceTo(state, { now: time, data }); if (!r.ok) throw new Error(r.code); state = r.state; };
    apply('army.prepare', { fleetId: 'f' });
    expect(before.planets.a!.garrison).toEqual(groups());
    expect(state.planets.a!.garrison).toHaveLength(1);
    apply('army.load', { fleetId: 'f', unit: 'infantry', count: 2, group: state.planets.a!.garrison[0]!.armyGroup });
    expect(state.fleets.f!.landing![0]!.count).toBe(2);
    state = JSON.parse(JSON.stringify(state));
    advance(3_600_000);
    expect(state.fleets.f!.landing).toHaveLength(1);
    expect(state.fleets.f!.landing![0]!.hp).toBeCloseTo(162 + 524 / 3, 8);
    const loaded = structuredClone(state.fleets.f!.landing);
    advance(3_600_001); expect(state.fleets.f!.landing).toEqual(loaded);
    apply('army.unload', { fleetId: 'f', unit: 'infantry', count: 4 });
    advance(7_200_001);
    expect(state.planets.a!.garrison).toHaveLength(1);
    expect(state.planets.a!.garrison[0]).toMatchObject({ count: 8 });
    expect(state.planets.a!.garrison[0]!.hp).toBeCloseTo(686, 8);
    expect(state.fleets.f!.landing).toEqual([]);
  });
});
