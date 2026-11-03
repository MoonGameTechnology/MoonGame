import { describe, expect, it, vi } from 'vitest';
import { createInitialState } from '@void/shared-core';
import { MemoryArsenalStore, MemoryDropStore, MemoryMatchStore, type MatchSnapshot } from './store';
import { MemoryMetaEconomyStore } from './metaEconomyStore';
import { MemoryMetaMarket } from './metaMarket';
import { createMetaRewardDelivery } from './metaEconomyDelivery';
import { MetaEconomy, type MatchRewardFacts } from './metaEconomy';
import { loadMetaEconomyCatalog } from './metaEconomyCatalog';
import { loadDropTables, loadShippedData } from './scenario';
import { rewardPlayerKey } from './matchRewardProgress';

const data = loadShippedData();
function fixture() {
  const catalog = loadMetaEconomyCatalog(data);
  const state = createInitialState({
    seed: 'delivery-final',
    version: { data: data.version, manifest: 'test' },
  });
  state.players.p1 = {
    id: 'p1',
    name: 'A',
    faction: 'vanguard',
    resources: {},
    claimedAt: 0,
    seated: true,
    status: 'active',
  };
  const hour = 3_600_000;
  const snapshot: MatchSnapshot = {
    matchId: 'match',
    seq: 1,
    status: 'ongoing',
    state,
    dataVersion: data.version,
    matchRewardProgress: {
      policy: structuredClone(catalog.finalMatch!),
      players: {
        [rewardPlayerKey('p1', 0)]: {
          accountId: 'alice',
          claimedAt: 0,
          startedAt: 0,
          orders: 2,
          lastOrderAt: 9 * hour,
          peakScore: 601,
          kills: 37,
          veteranPoints: 0,
          battles: ['defense'],
        },
      },
    },
  };
  const arsenal = new MemoryArsenalStore();
  const market = new MemoryMetaMarket(arsenal);
  const store = new MemoryMetaEconomyStore(arsenal, new MemoryDropStore(), market);
  const matches = new MemoryMatchStore();
  const service = new MetaEconomy({ store, catalog, dropTables: loadDropTables(data) });
  const settle = vi.fn((facts: MatchRewardFacts) => service.settle(facts));
  const delivery = () =>
    createMetaRewardDelivery({
      store,
      matches,
      seats: () => async () => ({ p1: 'alice' }),
      settle,
      stageCount: 2,
      participation: catalog.rewards.participation,
      onError: (error) => {
        throw error;
      },
    });
  const finish = (): void => {
    snapshot.status = 'ended';
    snapshot.endedAt = catalog.seasons[0]!.startsAt + 1000;
    state.time = 100 * hour;
    state.match.status = 'ended';
    state.match.endedAt = state.time;
    state.match.rewards = { p1: { place: 4, xp: 40 } };
  };
  return { snapshot, finish, store, market, matches, service, settle, delivery, hour, catalog };
}

describe('deferred rewards for active eliminated players', () => {
  it('pays nothing at intermediate stages or personal defeat, then automatically pays after the full match', async () => {
    const f = fixture();
    const delivery = f.delivery();
    await delivery.deliver(f.snapshot);
    f.snapshot.state.players.p1!.status = 'defeated';
    const row = f.snapshot.matchRewardProgress!.players[rewardPlayerKey('p1', 0)]!;
    row.eliminated = true;
    row.endedAt = 10 * f.hour;
    await delivery.deliver(f.snapshot);
    expect(f.settle).not.toHaveBeenCalled();
    f.finish();
    await delivery.deliver(f.snapshot);
    expect(f.settle).toHaveBeenCalledOnce();
    expect(f.settle.mock.calls[0]![0]).toMatchObject({
      kind: 'final',
      participation: true,
      finalReward: { reason: 'eliminated', score: 601, kills: 37 },
    });
    expect(await f.market.balance('alice')).toBe(12);
  });

  it('reuses the committed seed/facts across a failed settlement, restart, delayed sweep and repeated read', async () => {
    const f = fixture();
    f.finish();
    f.snapshot.matchRewardProgress!.players[rewardPlayerKey('p1', 0)]!.lastOrderAt = 99 * f.hour;
    await f.matches.save(f.snapshot);
    f.settle.mockRejectedValueOnce(new Error('temporary failure'));
    await expect(f.delivery().deliver(f.snapshot)).rejects.toThrow('temporary failure');
    const before = structuredClone(f.settle.mock.calls[0]![0]);
    await f.delivery().sweep();
    expect(f.settle.mock.calls[1]![0]).toEqual(before);
    const view = await f.service.matchRewards('alice', 'match');
    expect(view.finalReady).toBe(true);
    await f.delivery().sweep();
    expect(await f.service.matchRewards('alice', 'match')).toEqual(view);
    expect(await f.market.balance('alice')).toBe(12);
  });

  it('stores a reason for an abandoned player and never pays for a previous account tenure', async () => {
    const f = fixture();
    f.finish();
    await f.delivery().deliver(f.snapshot);
    expect((await f.service.matchRewards('alice', 'match')).receipts[0]?.matchReward?.reason).toBe(
      'inactive',
    );
    expect(await f.market.balance('alice')).toBe(0);
    const other = fixture();
    other.finish();
    const row = other.snapshot.matchRewardProgress!.players[rewardPlayerKey('p1', 0)]!;
    row.accountId = 'previous-account';
    row.lastOrderAt = 100 * other.hour;
    await other.delivery().deliver(other.snapshot);
    expect(other.settle.mock.calls[0]![0].finalReward?.reason).toBe('no-contribution');
    expect(await other.market.balance('alice')).toBe(0);
  });

  it('keeps the match-pinned policy after a deployment changes future match rates', async () => {
    const f = fixture();
    f.finish();
    const ledger = f.snapshot.matchRewardProgress!;
    f.catalog.finalMatch!.baseWarrants = 200;
    ledger.players[rewardPlayerKey('p1', 0)]!.lastOrderAt = 99 * f.hour;
    await f.delivery().deliver(f.snapshot);
    expect(await f.market.balance('alice')).toBe(12);
  });
});
