import { describe, expect, it } from 'vitest';
import { createInitialState, type DomainEvent, type GameState } from '@void/shared-core';
import { loadShippedData } from './scenario';
import { loadMetaEconomyCatalog } from './metaEconomyCatalog';
import {
  foldMatchRewardProgress,
  rewardPlayerKey,
  survivingVeteranPoints,
  type MatchRewardProgress,
} from './matchRewardProgress';
import { finalRewardFacts } from './matchRewardFacts';

const data = loadShippedData();
const policy = loadMetaEconomyCatalog(data).finalMatch!;
const owners = { p1: { accountId: 'alice', claimedAt: 0 }, p2: { accountId: 'bob', claimedAt: 0 } };
const key = rewardPlayerKey('p1', 0);
const hour = 3_600_000;
function world(): GameState {
  const state = createInitialState({
    seed: 'rewards',
    version: { data: data.version, manifest: 'test' },
  });
  for (const id of ['p1', 'p2', 'p3']) {
    state.players[id] = {
      id,
      name: id,
      faction: 'vanguard',
      resources: {},
      seated: true,
      claimedAt: 0,
      status: 'active',
    };
    state.match.scores[id] = { controlledPlanets: 1, fleets: 1, units: 5, total: 601 };
  }
  state.fleets.f1 = {
    id: 'f1',
    owner: 'p1',
    location: 'home',
    movement: null,
    traits: [],
    units: [{ unit: 'cruiser', count: 10, battles: 4 }],
  };
  return state;
}
const fresh = (): MatchRewardProgress => ({ policy: structuredClone(policy), players: {} });
const event = (type: string, payload: unknown): DomainEvent => ({ type, payload });
function participating(at = 9 * hour): { state: GameState; progress: MatchRewardProgress } {
  const state = world();
  state.time = at;
  let progress = foldMatchRewardProgress(fresh(), state, state, [], owners, data, {
    playerId: 'p1',
    type: 'unit.build',
    at: at - 1000,
    wall: at,
  })!;
  progress = foldMatchRewardProgress(progress, state, state, [], owners, data, {
    playerId: 'p1',
    type: 'fleet.move',
    at,
    wall: at,
  })!;
  return { state, progress };
}

describe('committed match reward evidence', () => {
  it('records every real side of a joint battle, including a wiped non-leading attacker', () => {
    const state = world();
    const next = foldMatchRewardProgress(
      fresh(),
      state,
      state,
      [
        event('combat.round', {
          battleId: 'joint',
          round: 1,
          attacker: 'p3',
          defender: 'npc',
          dmgToAttacker: 0,
          dmgToDefender: 0,
          sides: [
            { owner: 'p1', damage: 10 },
            { owner: 'p2', damage: 10 },
          ],
        }),
      ],
      owners,
      data,
    )!;
    expect(next.players[key]!.battles).toEqual(['joint']);
    expect(next.players[rewardPlayerKey('p2', 0)]!.battles).toEqual(['joint']);
  });
  it('retains the personal score and entitlement after elimination, long before the match ends', () => {
    const { state, progress } = participating();
    const lost = structuredClone(state);
    lost.time = 10 * hour;
    lost.players.p1!.status = 'defeated';
    lost.match.scores.p1!.total = 0;
    lost.fleets = {};
    const next = foldMatchRewardProgress(
      progress,
      state,
      lost,
      [event('player.eliminated', { playerId: 'p1' })],
      owners,
      data,
    )!;
    expect(next.players[key]).toMatchObject({ peakScore: 601, eliminated: true, veteranPoints: 0 });
    const result = finalRewardFacts(next, next.players[key], 1, 1, 100 * hour);
    expect(result).toMatchObject({ reason: 'eliminated', score: 601, veteranPoints: 0 });
    // The frozen tenure cannot gain presence, kills, score or veterans after its end.
    const end = structuredClone(lost);
    end.time = 100 * hour;
    end.match.status = 'ended';
    const later = foldMatchRewardProgress(next, lost, end, [], owners, data, {
      playerId: 'p1',
      type: 'unit.build',
      at: end.time,
      wall: end.time,
    });
    expect(later?.players[key]).toEqual(next.players[key]);
  });

  it('does not turn a symbolic final command or abandoned empire into eligibility', () => {
    const { state, progress } = participating(1 * hour);
    const row = progress.players[key]!;
    row.endedAt = 100 * hour;
    expect(finalRewardFacts(progress, row, 5, 1, row.endedAt).reason).toBe('inactive');
    row.lastOrderAt = row.endedAt;
    row.orders = 1;
    expect(finalRewardFacts(progress, row, 5, 1, row.endedAt).reason).toBe('no-contribution');
    row.orders = 2;
    expect(finalRewardFacts(progress, row, 0, 1, row.endedAt).reason).toBe('no-contribution');
    expect(state.players.p1!.status).toBe('active');
  });

  it('allows normal offline pauses at x1 and x24 and rejects commands after the personal deadline', () => {
    const { progress } = participating();
    const row = progress.players[key]!;
    for (const scale of [1, 24]) {
      row.startedAt = 0;
      row.endedAt = 20 * hour * scale;
      row.lastOrderAt = 17 * hour * scale;
      expect(finalRewardFacts(progress, row, 1, scale, row.endedAt).reason).toBe('active');
      row.lastOrderAt = row.endedAt + 1;
      expect(finalRewardFacts(progress, row, 1, scale, row.endedAt).reason).toBe('inactive');
    }
  });

  it('counts enemy bodies once across shared damage, not stacks or one full kill per ally', () => {
    const state = world();
    const next = foldMatchRewardProgress(
      fresh(),
      state,
      state,
      [
        event('unit.died', {
          owner: 'p3',
          unit: 'cruiser',
          count: 37,
          lossCost: { metal: 3700 },
          damageShares: { p1: 2, p2: 1 },
        }),
      ],
      owners,
      data,
    )!;
    expect(next.players[key]!.kills).toBe(25);
    expect(next.players[rewardPlayerKey('p2', 0)]!.kills).toBe(12);
  });

  it('excludes neutral militia, allied/self losses, mines and missiles but includes hostile bot armies', () => {
    const state = world();
    state.players.npc = { ...state.players.p3!, id: 'npc', npc: 'pirate' };
    state.players.p3!.ai = true;
    state.diplomacy = { 'p1|p2': 'alliance' };
    const death = (owner: string, unit: string): DomainEvent =>
      event('unit.died', {
        owner,
        unit,
        count: 5,
        killedBy: 'p1',
        lossCost: {},
      });
    const next = foldMatchRewardProgress(
      fresh(),
      state,
      state,
      [
        death('npc', 'cruiser'),
        death('p1', 'cruiser'),
        death('p2', 'cruiser'),
        death('p3', 'mine'),
        death('p3', 'missile'),
        death('p3', 'cruiser'),
      ],
      owners,
      data,
    )!;
    expect(next.players[key]!.kills).toBe(5);
  });

  it('uses the highest degree per surviving individual and ignores fleet splitting', () => {
    const state = world();
    expect(survivingVeteranPoints(state, 'p1', data)).toBe(40);
    state.fleets.f1!.units[0]!.damageDealt = 225; // second medal never doubles one body
    expect(survivingVeteranPoints(state, 'p1', data)).toBe(40);
    state.fleets.f2 = { ...structuredClone(state.fleets.f1!), id: 'f2' };
    state.fleets.f1!.units[0]!.count = 4;
    state.fleets.f2.units[0]!.count = 6;
    expect(survivingVeteranPoints(state, 'p1', data)).toBe(40);
    state.fleets.f2.units[0]!.count = 1;
    expect(survivingVeteranPoints(state, 'p1', data)).toBe(20);
  });

  it('does not mutate the committed projection on a failed prospective save or count driver/no-op orders', () => {
    const state = world();
    const previous = fresh();
    const next = foldMatchRewardProgress(previous, state, state, [], owners, data, {
      playerId: 'p1',
      type: 'fleet.orbit',
      at: 1,
      wall: 1,
    })!;
    expect(previous.players).toEqual({});
    expect(next.players[key]!.orders).toBe(0);
    expect(
      foldMatchRewardProgress(next, state, state, [], owners, data)?.players[key]!.orders,
    ).toBe(0);
  });

  it('never inherits another tenure or bot accomplishments and rejects post-elimination presence in catch-up', () => {
    const { state, progress } = participating();
    const reclaimed = structuredClone(state);
    reclaimed.players.p1!.claimedAt = hour;
    expect(
      foldMatchRewardProgress(progress, reclaimed, reclaimed, [], owners, data)?.players[key],
    ).toEqual(progress.players[key]);
    const lost = structuredClone(state);
    lost.players.p1!.status = 'defeated';
    const next = foldMatchRewardProgress(
      progress,
      state,
      lost,
      [event('player.eliminated', { playerId: 'p1' })],
      owners,
      data,
      { playerId: 'p1', type: 'unit.build', at: 100 * hour, wall: 100 * hour },
    )!;
    expect(next.players[key]!.orders).toBe(2);
    expect(next.players[key]!.lastOrderAt).toBe(9 * hour);
  });
});
