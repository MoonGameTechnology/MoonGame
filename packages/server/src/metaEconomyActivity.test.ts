import { createInitialState, type DomainEvent, type GameState } from '@void/shared-core';
import { describe, expect, it } from 'vitest';
import {
  captureMetaEconomyActivity,
  MAX_META_ACTIVITY_FACTS_PER_ROLE,
} from './metaEconomyActivity';

function state(): GameState {
  const result = createInitialState({
    seed: 'combat-facts',
    version: { data: 'test', manifest: 'test' },
  });
  result.players.defender = {
    id: 'defender',
    name: 'Defender',
    faction: 'f',
    status: 'active',
    resources: {},
    seated: true,
    claimedAt: 10,
  };
  result.players.attacker = { ...result.players.defender, id: 'attacker' };
  return result;
}
function battle(overrides: Record<string, unknown> = {}): DomainEvent {
  return {
    type: 'combat.round',
    payload: {
      battleId: 'battle-one',
      round: 1,
      attacker: 'attacker',
      defender: 'defender',
      dmgToAttacker: 0,
      dmgToDefender: 12,
      sides: [],
      ...overrides,
    },
  };
}
const scope = JSON.stringify(['defender', 10, 'defense']);

describe('durable defense participation', () => {
  it('records a wiped seated defender without requiring survivors or counting the attacker', () => {
    const current = state();
    current.players.defender!.status = 'defeated';
    expect(Object.values(current.planets)).toHaveLength(0);
    expect(Object.values(current.fleets)).toHaveLength(0);
    const facts = captureMetaEconomyActivity(undefined, [battle()], current);
    expect(facts).toEqual({ [scope]: ['battle-one'] });
    expect(facts[JSON.stringify(['attacker', 10, 'defense'])]).toBeUndefined();
  });
  it('counts distinct battles once across rounds and replayed batches without mutating inputs', () => {
    const existing = { [scope]: ['earlier'] };
    const current = state(),
      before = structuredClone(current);
    const events = [battle(), battle({ round: 2 }), battle({ battleId: 'battle-two' })];
    const facts = captureMetaEconomyActivity(existing, events, current);
    expect(facts).toEqual({ [scope]: ['earlier', 'battle-one', 'battle-two'] });
    expect(captureMetaEconomyActivity(facts, events, current)).toEqual(facts);
    expect(existing).toEqual({ [scope]: ['earlier'] });
    expect(facts[scope]).not.toBe(existing[scope]);
    expect(current).toEqual(before);
  });
  it('accepts actual damage to either side while ignoring combat starts and unit kills', () => {
    expect(
      captureMetaEconomyActivity(
        undefined,
        [battle({ dmgToAttacker: 2, dmgToDefender: 0 })],
        state(),
      ),
    ).toEqual({ [scope]: ['battle-one'] });
    expect(
      captureMetaEconomyActivity(
        undefined,
        [
          { ...battle(), type: 'combat.started' },
          { ...battle(), type: 'unit.killed' },
        ],
        state(),
      ),
    ).toEqual({});
  });
  it('rejects bots, NPCs, unclaimed seats, unknown defenders and zero or malformed damage', () => {
    for (const player of [{ ai: true }, { npc: 'neutral' as const }, { seated: false }]) {
      const current = state();
      Object.assign(current.players.defender!, player);
      expect(captureMetaEconomyActivity(undefined, [battle()], current)).toEqual({});
    }
    for (const invalid of [
      { defender: 'missing' },
      { dmgToAttacker: 0, dmgToDefender: 0 },
      { dmgToDefender: -1 },
      { dmgToDefender: Infinity },
      { dmgToAttacker: NaN },
      { dmgToDefender: '12' },
      { round: 0 },
      { round: -1 },
      { round: 1.5 },
      { round: Infinity },
      { round: '1' },
      { battleId: '' },
      { battleId: 'x'.repeat(257) },
      { battleId: 42 },
    ])
      expect(captureMetaEconomyActivity(undefined, [battle(invalid)], state())).toEqual({});
    for (const payload of [null, [], 'combat'])
      expect(
        captureMetaEconomyActivity(undefined, [{ type: 'combat.round', payload }], state()),
      ).toEqual({});
  });
  it('isolates claim epochs and excludes pre-join bot combats using the pre-batch state', () => {
    const beforeJoin = state();
    beforeJoin.players.defender!.ai = true;
    const existing = { [JSON.stringify(['defender', 0, 'defense'])]: ['bot-era'] };
    expect(captureMetaEconomyActivity(existing, [battle()], beforeJoin)).toEqual(existing);
    const afterJoin = state();
    afterJoin.players.defender!.claimedAt = 20;
    expect(captureMetaEconomyActivity(existing, [battle()], afterJoin)).toEqual({
      ...existing,
      [JSON.stringify(['defender', 20, 'defense'])]: ['battle-one'],
    });
    delete afterJoin.players.defender!.claimedAt;
    expect(captureMetaEconomyActivity(undefined, [battle()], afterJoin)).toEqual({
      [JSON.stringify(['defender', 0, 'defense'])]: ['battle-one'],
    });
  });
  it('caps distinct battles per claim and normalizes oversized pre-existing records', () => {
    const battles = Array.from(
      { length: MAX_META_ACTIVITY_FACTS_PER_ROLE + 5 },
      (_, i) => `battle-${i}`,
    );
    const events = battles.map((battleId) => battle({ battleId }));
    const expected = battles.slice(0, MAX_META_ACTIVITY_FACTS_PER_ROLE);
    expect(captureMetaEconomyActivity(undefined, events, state())[scope]).toEqual(expected);
    const existing = { [scope]: [battles[0]!, ...battles] };
    expect(
      captureMetaEconomyActivity(existing, [battle({ battleId: 'extra' })], state())[scope],
    ).toEqual(expected);
    expect(existing[scope]).toHaveLength(MAX_META_ACTIVITY_FACTS_PER_ROLE + 6);
  });
});

const logistics = JSON.stringify(['defender', 10, 'logistics']);
const objectives = JSON.stringify(['defender', 10, 'objectives']);
function constructed(overrides: Record<string, unknown> = {}): DomainEvent {
  return {
    type: 'building.constructed',
    payload: { planetId: 'home', building: 'factory', owner: 'defender', ...overrides },
  };
}
function upgraded(level: unknown, overrides: Record<string, unknown> = {}): DomainEvent {
  return {
    type: 'building.upgraded',
    payload: { planetId: 'home', building: 'factory', owner: 'defender', level, ...overrides },
  };
}
function captured(overrides: Record<string, unknown> = {}): DomainEvent {
  return {
    type: 'planet.captured',
    payload: { planetId: 'frontier', owner: 'defender', ...overrides },
  };
}

describe('durable logistics and objective participation', () => {
  it('retains completed construction/upgrades after loss and deduplicates rebuilds and repeated levels', () => {
    const current = state(),
      before = structuredClone(current);
    const events = [
      constructed(),
      constructed(),
      upgraded(2),
      upgraded(2),
      upgraded(3),
      constructed({ planetId: 'outpost' }),
      constructed({ building: 'mine' }),
    ];
    const result = captureMetaEconomyActivity(undefined, events, current);
    expect(result).toEqual({
      [logistics]: [
        JSON.stringify(['building', 'home', 'factory', 1]),
        JSON.stringify(['building', 'home', 'factory', 2]),
        JSON.stringify(['building', 'home', 'factory', 3]),
        JSON.stringify(['building', 'outpost', 'factory', 1]),
        JSON.stringify(['building', 'home', 'mine', 1]),
      ],
    });
    expect(captureMetaEconomyActivity(result, events, current)).toEqual(result);
    expect(current).toEqual(before);
    expect(
      captureMetaEconomyActivity(
        undefined,
        [{ ...constructed(), type: 'building.queued' }],
        current,
      ),
    ).toEqual({});
  });
  it('counts distinct captured planets despite subsequent loss, accepting neutral emit variants', () => {
    const events = [
      captured(),
      captured({ from: null }),
      captured({ from: 'attacker', via: 'assault' }),
      captured({ planetId: 'second', from: 'attacker', via: 'occupy' }),
    ];
    expect(captureMetaEconomyActivity(undefined, events, state())).toEqual({
      [objectives]: ['frontier', 'second'],
    });
    expect(
      captureMetaEconomyActivity(undefined, [captured({ from: 'defender' })], state()),
    ).toEqual({});
  });
  it('rejects malformed building/capture identifiers and invalid upgrade levels', () => {
    for (const bad of ['', 42, null, 'x'.repeat(257)]) {
      for (const field of ['planetId', 'building', 'owner'])
        expect(
          captureMetaEconomyActivity(undefined, [constructed({ [field]: bad })], state()),
        ).toEqual({});
      for (const field of ['planetId', 'owner'])
        expect(
          captureMetaEconomyActivity(undefined, [captured({ [field]: bad })], state()),
        ).toEqual({});
    }
    for (const level of [
      undefined,
      null,
      0,
      1,
      -1,
      2.5,
      '2',
      Infinity,
      Number.MAX_SAFE_INTEGER + 1,
    ])
      expect(captureMetaEconomyActivity(undefined, [upgraded(level)], state())).toEqual({});
    for (const from of [42, '', [], 'x'.repeat(257)])
      expect(captureMetaEconomyActivity(undefined, [captured({ from })], state())).toEqual({});
  });
  it('requires pre-batch human ownership for all roles and isolates new claim epochs', () => {
    const events = [constructed(), upgraded(2), captured()];
    for (const change of [{ ai: true }, { npc: 'swarm' as const }, { seated: false }]) {
      const current = state();
      Object.assign(current.players.defender!, change);
      expect(captureMetaEconomyActivity(undefined, events, current)).toEqual({});
    }
    const existing = captureMetaEconomyActivity(undefined, events, state());
    const next = state();
    next.players.defender!.claimedAt = 11;
    const result = captureMetaEconomyActivity(existing, events, next);
    expect(result[logistics]).toEqual(existing[logistics]);
    expect(result[JSON.stringify(['defender', 11, 'logistics'])]).toEqual(existing[logistics]);
    expect(result[JSON.stringify(['defender', 11, 'objectives'])]).toEqual(['frontier']);
  });
  it('caps every role independently and preserves long composed building identities', () => {
    const events = Array.from({ length: MAX_META_ACTIVITY_FACTS_PER_ROLE + 2 }, (_, i) => [
      battle({ battleId: `b-${i}` }),
      constructed({ planetId: `p-${i}` }),
      captured({ planetId: `p-${i}` }),
    ]).flat();
    const result = captureMetaEconomyActivity(undefined, events, state());
    for (const key of [scope, logistics, objectives])
      expect(result[key]).toHaveLength(MAX_META_ACTIVITY_FACTS_PER_ROLE);
    const long = captureMetaEconomyActivity(
      undefined,
      [constructed({ planetId: 'p'.repeat(256), building: 'b'.repeat(256) })],
      state(),
    );
    expect(long[logistics]![0]!.length).toBeGreaterThan(256);
    expect(captureMetaEconomyActivity(long, [], state())).toEqual(long);
  });
});

describe('presence evidence', () => {
  const DAY = 86_400_000;
  const key = (role: string) => JSON.stringify(['defender', 10, role]);
  it('records the game day and UTC day of an own order once per day', () => {
    const order = { playerId: 'defender', at: 3 * DAY + 5, wall: 20_741 * DAY + 7 };
    const first = captureMetaEconomyActivity(undefined, [], state(), order);
    expect(first).toEqual({ [key('orders')]: ['3'], [key('ordersUtc')]: ['20741'] });
    const again = captureMetaEconomyActivity(first, [], state(), { ...order, at: 3 * DAY + 9 });
    expect(again).toEqual(first);
    const next = captureMetaEconomyActivity(again, [], state(), { ...order, at: 4 * DAY });
    expect(next[key('orders')]).toEqual(['3', '4']);
  });
  it('ignores orders for bots, NPCs, unconfirmed seats and broken clocks', () => {
    for (const change of [{ ai: true }, { npc: 'swarm' as const }, { seated: false }]) {
      const current = state();
      Object.assign(current.players.defender!, change);
      const order = { playerId: 'defender', at: DAY, wall: DAY };
      expect(captureMetaEconomyActivity(undefined, [], current, order)).toEqual({});
    }
    expect(
      captureMetaEconomyActivity(undefined, [], state(), {
        playerId: 'defender',
        at: NaN,
        wall: 1,
      }),
    ).toEqual({});
  });
  it('records an elimination at the start of the batch that reported it', () => {
    const current = state();
    current.time = 5 * DAY;
    const eliminated = { type: 'player.eliminated', payload: { playerId: 'defender' } };
    expect(captureMetaEconomyActivity(undefined, [eliminated], current)).toEqual({
      [key('eliminated')]: [String(5 * DAY)],
    });
  });
});
