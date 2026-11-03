import { describe, expect, it } from 'vitest';
import { createInitialState, createKernel, type GameModule } from '@void/shared-core';
import { MatchRoom, type RoomPeer } from './matchRoom';
import { loadShippedData } from './scenario';
import { loadMetaEconomyCatalog } from './metaEconomyCatalog';
import { MemoryMatchStore, MemoryReceiptStore, type MatchSnapshot } from './store';
import { commitMatch } from './matchCommit';
import { snapshotOf } from './persistence';
import { rewardPlayerKey } from './matchRewardProgress';

const data = loadShippedData();
const policy = loadMetaEconomyCatalog(data).finalMatch!;
const module: GameModule = {
  id: 'reward-proof',
  version: '1',
  setup(api) {
    api.onAction('unit.build', (_action, h) => {
      h.state.players.p1!.resources.credits = (h.state.players.p1!.resources.credits ?? 0) + 1;
    });
  },
};

describe('reward evidence and the authoritative commit boundary', () => {
  it('publishes evidence only with a successful receipt and restores it after restart', async () => {
    const state = createInitialState({
      seed: 'commit',
      version: { data: data.version, manifest: 'test' },
    });
    state.players.p1 = {
      id: 'p1',
      name: 'One',
      faction: 'vanguard',
      resources: {},
      status: 'active',
      seated: true,
      claimedAt: 0,
    };
    state.match.scores.p1 = { controlledPlanets: 1, fleets: 0, units: 0, total: 600 };
    const matches = new MemoryMatchStore();
    const receipts = new MemoryReceiptStore();
    let fail = true;
    let proposed: MatchSnapshot | undefined;
    const room = new MatchRoom({
      id: 'committed',
      initialState: state,
      kernel: createKernel([module]),
      data,
      now: () => 1,
      careerAccounts: { p1: 'alice' },
      matchRewardPolicy: policy,
      persist: async (snapshot, receipt) => {
        proposed = snapshot;
        if (fail) throw new Error('disk unavailable');
        await commitMatch(matches, receipts, snapshot, receipt);
      },
    });
    const messages: string[] = [];
    const peer: RoomPeer = {
      send: (raw) => {
        messages.push(raw);
      },
    };
    room.addPeer('p1', peer);
    const action = JSON.stringify({
      type: 'action',
      action: { id: 'build-1', playerId: 'p1', type: 'unit.build', payload: {}, issuedAt: 1 },
    });
    await room.receive('p1', peer, action);
    const key = rewardPlayerKey('p1', 0);
    expect(proposed?.matchRewardProgress?.players[key]?.orders).toBe(1);
    expect(room.matchRewardSnapshot?.players[key]?.orders ?? 0).toBe(0);
    expect(await matches.load('committed')).toBeNull();
    fail = false;
    await room.receive('p1', peer, action);
    expect(room.matchRewardSnapshot?.players[key]?.orders).toBe(1);
    const saved = (await matches.load('committed'))!;
    expect(saved.matchRewardProgress).toEqual(snapshotOf(room).matchRewardProgress);
    const restored = new MatchRoom({
      id: 'committed',
      initialState: saved.state,
      initialSeq: saved.seq,
      kernel: createKernel([module]),
      data,
      initialMatchRewardProgress: saved.matchRewardProgress,
      initialEconomyActivity: saved.economyActivity,
      initialCareer: saved.career,
      now: () => 1,
    });
    expect(restored.matchRewardSnapshot).toEqual(saved.matchRewardProgress);
    expect(restored.economyActivitySnapshot).toEqual(saved.economyActivity);
    expect(messages.join('')).not.toContain('peakScore');
    expect(messages.join('')).not.toContain('matchRewardProgress');
  });
});
