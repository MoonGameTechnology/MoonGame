import { describe, expect, it } from 'vitest';
import {
  autoMergeModule,
  combatModule,
  createInitialState,
  createKernel,
  fleetOpsModule,
  movementModule,
  orbitalModule,
  parseGameData,
  standingOrdersModule,
  type Action,
  type Fleet,
  type GameState,
} from '@void/shared-core';
import { autoAssaultActions } from './standingOrderDriver';

const HOUR = 3_600_000;
const data = parseGameData({
  version: '0.1.0',
  resources: ['metal'],
  factions: {},
  events: {},
  units: {
    ship: {
      faction: 'x',
      domain: 'space',
      stats: { attack: 10, defense: 10, hp: 1000, speed: 10 },
    },
    infantry: {
      faction: 'x',
      domain: 'ground',
      stats: { attack: 1, defense: 1, hp: 10000, speed: 1 },
    },
  },
  buildings: { fort: { name: 'Fort', hp: 10000 } },
});
const kernel = createKernel([
  movementModule,
  orbitalModule,
  combatModule,
  fleetOpsModule,
  standingOrdersModule,
  autoMergeModule,
]);
function fleet(id: string, extra: Partial<Fleet> = {}): Fleet {
  return {
    id,
    owner: 'p1',
    location: 'P',
    movement: null,
    orbit: 'near',
    units: [{ unit: 'ship', count: 3 }],
    landing: [{ unit: 'infantry', count: 2 }],
    traits: [],
    ...extra,
  };
}
function world(): GameState {
  return {
    ...createInitialState({ seed: 'merge-orders', version: { data: '0.1.0', manifest: '1' } }),
    players: Object.fromEntries(
      ['p1', 'p2'].map((id) => [
        id,
        { id, name: id, faction: 'x', status: 'active' as const, resources: {} },
      ]),
    ),
    planets: {
      P: {
        id: 'P',
        owner: 'p2',
        position: { x: 0, y: 0 },
        links: ['Q'],
        resources: {},
        traits: [],
        buildings: [{ type: 'fort', level: 1, hp: 10000 }],
        garrison: [{ unit: 'infantry', count: 10 }],
      },
      Q: {
        id: 'Q',
        owner: 'p1',
        position: { x: 10, y: 0 },
        links: ['P'],
        resources: {},
        traits: [],
        buildings: [],
        garrison: [],
      },
    },
    fleets: { A: fleet('A'), S: fleet('S') },
    battles: {},
  };
}
function apply(state: GameState, type: string, payload: unknown, playerId = 'p1') {
  return kernel.applyAction(
    state,
    { id: `test:${type}`, type, playerId, payload, issuedAt: state.time } as Action,
    { now: state.time, data },
  );
}
function act(state: GameState, type: string, payload: unknown): GameState {
  const r = apply(state, type, payload);
  expect(r.ok, !r.ok ? r.code : '').toBe(true);
  if (!r.ok) throw new Error(r.code);
  return r.state;
}
function advance(state: GameState, now: number) {
  const r = kernel.advanceTo(state, { now, data });
  expect(r.ok, !r.ok ? r.code : '').toBe(true);
  if (!r.ok) throw new Error(r.code);
  return r;
}
const count = (stacks: Fleet['units'] | undefined) =>
  (stacks ?? []).reduce((sum, stack) => sum + stack.count, 0);

describe('merged fleet standing orders', () => {
  const combinations = Array.from({ length: 16 }, (_, n) => ({
    fromBombard: !!(n & 1),
    intoBombard: !!(n & 2),
    fromAuto: !!(n & 4),
    intoAuto: !!(n & 8),
  }));
  it.each(combinations)('inherits enabled modes without disabling the other fleet: %j', (modes) => {
    const state = world();
    Object.assign(state.fleets.A!, { bombarding: modes.fromBombard, bombardNextAt: HOUR });
    Object.assign(state.fleets.S!, { bombarding: modes.intoBombard, bombardNextAt: 2 * HOUR });
    state.autoAssault = {
      other: true,
      ...(modes.fromAuto ? { A: true } : {}),
      ...(modes.intoAuto ? { S: true } : {}),
    };
    const before = structuredClone(state);
    const result = apply(state, 'fleet.merge', { from: 'A', into: 'S' });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.code);
    const merged = result.state;
    expect(state).toEqual(before);
    expect(merged.fleets.A).toBeUndefined();
    expect(!!merged.fleets.S!.bombarding).toBe(modes.fromBombard || modes.intoBombard);
    if (modes.fromBombard || modes.intoBombard)
      expect(merged.fleets.S!.bombardNextAt).toBe(modes.fromBombard ? HOUR : 2 * HOUR);
    expect(!!merged.autoAssault?.S).toBe(modes.fromAuto || modes.intoAuto);
    expect(merged.autoAssault?.A).toBeUndefined();
    expect(merged.autoAssault?.other).toBe(true);
    expect(count(merged.fleets.S!.units)).toBe(6);
    expect(count(merged.fleets.S!.landing)).toBe(4);
    expect(result.events.filter((e) => e.type === 'fleet.merged')).toHaveLength(1);
    expect(result.events.filter((e) => e.type === 'planet.bombarded')).toHaveLength(0);
  });

  it.each([false, true])(
    'keeps the only real clock with legacy bombarding saves (source clock: %s)',
    (fromClock) => {
      const state = world();
      state.fleets.A!.bombarding = true;
      state.fleets.S!.bombarding = true;
      state.fleets[fromClock ? 'A' : 'S']!.bombardNextAt = HOUR;
      const merged = act(state, 'fleet.merge', { from: 'A', into: 'S' });
      expect(merged.fleets.S!.bombardNextAt).toBe(HOUR);
    },
  );

  it('does not revive a disabled target clock when the inherited bombardment has no clock', () => {
    const state = world();
    state.fleets.A!.bombarding = true;
    state.fleets.S!.bombarding = false;
    state.fleets.S!.bombardNextAt = 1;
    const merged = act(state, 'fleet.merge', { from: 'A', into: 'S' });
    expect(merged.fleets.S!.bombardNextAt).toBeUndefined();
    expect(advance(merged, HOUR - 1).events.some((e) => e.type === 'planet.bombarded')).toBe(false);
  });

  it('combines two clocks into one without an immediate or duplicate volley', () => {
    const state = world();
    Object.assign(state.fleets.A!, { bombarding: true, bombardNextAt: HOUR });
    Object.assign(state.fleets.S!, { bombarding: true, bombardNextAt: 1.5 * HOUR });
    const merged = act(state, 'fleet.merge', { from: 'A', into: 'S' });
    const before = advance(merged, HOUR - 1);
    expect(before.events.filter((e) => e.type === 'planet.bombarded')).toHaveLength(0);
    const volley = advance(before.state, HOUR);
    expect(volley.events.filter((e) => e.type === 'planet.bombarded')).toHaveLength(1);
    expect(volley.state.fleets.S!.bombardNextAt).toBe(2 * HOUR);
    expect(
      advance(volley.state, 1.5 * HOUR).events.filter((e) => e.type === 'planet.bombarded'),
    ).toHaveLength(0);
  });

  it.each([false, true])(
    'arrival merge then server auto-assault lands all shared infantry (pending merge: %s)',
    (pending) => {
      const state = world();
      Object.assign(state.fleets.S!, { bombarding: true, bombardNextAt: 1.25 * HOUR });
      state.fleets.A!.location = 'Q';
      state.autoAssault = { A: true };
      let moving = act(state, 'fleet.move', { fleetId: 'A', to: 'P' });
      if (pending) moving = act(moving, 'fleet.merge', { from: 'A', into: 'S' });
      let merged = advance(moving, HOUR).state;
      expect(merged.fleets.A).toBeUndefined();
      expect(merged.autoAssault).toEqual({ S: true });
      expect(merged.fleets.S!.bombardNextAt).toBe(1.25 * HOUR);
      const probe = (s: GameState, actions: readonly Action[]) =>
        kernel.canApplyAll(s, actions, { now: s.time, data });
      const orders = autoAssaultActions(merged, probe);
      expect(orders.map((x) => x.action.type)).toEqual(['fleet.assault']);
      for (const { action } of orders) merged = act(merged, action.type, action.payload);
      expect(merged.fleets.S!.assaultLanding?.troops).toEqual({ infantry: 4 });
      expect(autoAssaultActions(merged, probe)).toEqual([]);
      const loading = advance(merged, 1.25 * HOUR);
      expect(loading.events.filter((e) => e.type === 'planet.bombarded')).toHaveLength(1);
      expect(loading.state.fleets.S!.assaultLanding).toBeDefined();
      const ashore = advance(loading.state, 2.5 * HOUR);
      expect(count(ashore.state.fleets.S!.landing)).toBe(0);
      expect(ashore.state.planets.P!.beachheads?.[0]?.units.reduce((n, s) => n + s.count, 0)).toBe(
        4,
      );
      expect(ashore.state.fleets.S!.bombarding).toBe(true);
      expect(ashore.state.fleets.S!.battleId).toBeFalsy();
      expect(Object.values(ashore.state.battles).some((b) => b.phase === 'ground')).toBe(true);
      const fighting = advance(ashore.state, 3.25 * HOUR);
      expect(fighting.events.some((e) => e.type === 'planet.bombarded')).toBe(true);
      expect(autoAssaultActions(fighting.state, probe)).toEqual([]);
    },
  );

  it('three fleets and a repeated merge cannot duplicate ships, troops, flags or clocks', () => {
    const state = world();
    state.fleets.C = fleet('C', { bombarding: true, bombardNextAt: 2 * HOUR });
    state.fleets.A!.bombarding = true;
    state.fleets.A!.bombardNextAt = HOUR;
    state.autoAssault = { A: true, C: true };
    let merged = act(state, 'fleet.merge', { from: 'A', into: 'S' });
    merged = act(merged, 'fleet.merge', { from: 'S', into: 'C' });
    const before = structuredClone(merged);
    const repeated = apply(merged, 'fleet.merge', { from: 'A', into: 'C' });
    expect(repeated.ok).toBe(false);
    if (!repeated.ok) expect(repeated.code).toBe('E_NO_FLEET');
    expect(merged).toEqual(before);
    expect(Object.keys(merged.fleets)).toEqual(['C']);
    expect(count(merged.fleets.C!.units)).toBe(9);
    expect(count(merged.fleets.C!.landing)).toBe(6);
    expect(merged.autoAssault).toEqual({ C: true });
    expect(merged.fleets.C!.bombardNextAt).toBe(HOUR);
    expect(advance(merged, HOUR).events.filter((e) => e.type === 'planet.bombarded')).toHaveLength(
      1,
    );
  });

  it('a long offline span and small steps keep the same merged bombardment clock and damage', () => {
    const state = world();
    Object.assign(state.fleets.A!, { bombarding: true, bombardNextAt: HOUR });
    Object.assign(state.fleets.S!, { bombarding: true, bombardNextAt: 1.5 * HOUR });
    const merged = act(state, 'fleet.merge', { from: 'A', into: 'S' });
    const long = advance(merged, 4 * HOUR);
    let short = merged;
    let volleys = 0;
    for (let now = HOUR / 4; now <= 4 * HOUR; now += HOUR / 4) {
      const step = advance(short, now);
      short = step.state;
      volleys += step.events.filter((e) => e.type === 'planet.bombarded').length;
    }
    expect(short).toEqual(long.state);
    expect(volleys).toBe(4);
    expect(long.events.filter((e) => e.type === 'planet.bombarded')).toHaveLength(4);
  });

  it.each(['foreign', 'battle', 'landing', 'elsewhere', 'self', 'missing'] as const)(
    'rejected merge is atomic and cannot transfer orders or troops: %s',
    (reason) => {
      const state = world();
      state.autoAssault = { A: true };
      Object.assign(state.fleets.A!, { bombarding: true, bombardNextAt: HOUR });
      if (reason === 'foreign') state.fleets.S!.owner = 'p2';
      if (reason === 'battle') state.fleets.S!.battleId = 'busy';
      if (reason === 'landing')
        state.fleets.S!.assaultLanding = {
          planetId: 'P',
          startAt: 0,
          doneAt: HOUR,
          troops: { infantry: 2 },
        };
      if (reason === 'elsewhere') state.fleets.S!.location = 'Q';
      const before = structuredClone(state);
      const result = apply(state, 'fleet.merge', {
        from: reason === 'missing' ? 'missing' : 'A',
        into: reason === 'self' ? 'A' : 'S',
      });
      expect(result.ok).toBe(false);
      expect(state).toEqual(before);
    },
  );
});
