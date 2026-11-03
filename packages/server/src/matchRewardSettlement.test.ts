import { describe, expect, it, vi } from 'vitest';
import { MetaEconomy, type MatchRewardFacts } from './metaEconomy';
import { loadMetaEconomyCatalog } from './metaEconomyCatalog';
import { MemoryMetaEconomyStore } from './metaEconomyStore';
import { MemoryMetaMarket } from './metaMarket';
import { MemoryArsenalStore, MemoryDropStore } from './store';
import { loadDropTables, loadShippedData } from './scenario';

const data = loadShippedData();
function fixture() {
  const catalog = loadMetaEconomyCatalog(data);
  const arsenal = new MemoryArsenalStore();
  const drops = new MemoryDropStore();
  const market = new MemoryMetaMarket(arsenal);
  const store = new MemoryMetaEconomyStore(arsenal, drops, market);
  market.setEconomy(store);
  const now = catalog.seasons[0]!.startsAt + 1000;
  const service = new MetaEconomy({
    store,
    catalog,
    dropTables: loadDropTables(data),
    now: () => now,
  });
  const facts = (matchId = 'reward_match'): MatchRewardFacts => ({
    matchId,
    accountId: 'alice',
    kind: 'final',
    place: 4,
    participation: true,
    occurredAt: now,
    finalReward: {
      policy: structuredClone(catalog.finalMatch!),
      reason: 'eliminated',
      score: 601,
      kills: 37,
      veteranPoints: 0,
      seed: '1'.repeat(64),
    },
  });
  return { catalog, arsenal, drops, market, store, service, facts };
}

describe('final match rewards', () => {
  it('pays an eliminated fighter half-score gold, base materials and base plus rounded kill currency', async () => {
    const f = fixture();
    const facts = f.facts();
    facts.finalReward!.policy.moduleChance = 0;
    const result = await f.service.settle(facts);
    expect(result).toMatchObject({
      ok: true,
      receipt: {
        sovereignsGranted: 300,
        warrants: 12,
        matchReward: {
          reason: 'eliminated',
          score: 601,
          kills: 37,
          baseWarrants: 5,
          killWarrants: 7,
          baseMaterials: 3,
          veteranMaterials: 0,
        },
      },
    });
    expect((await f.store.read('alice')).sovereigns).toBe(300);
    expect(await f.market.balance('alice')).toBe(12);
    expect(
      (await f.store.read('alice')).materials
        .filter((m) => m.source === 'match')
        .reduce((sum, m) => sum + m.quantity, 0),
    ).toBe(3);
    expect((await f.service.matchRewards('alice', facts.matchId)).finalReady).toBe(true);
  });

  it.each([
    [0, 5],
    [4, 5],
    [5, 6],
    [37, 12],
    [1000, 205],
  ])('rounds %i destroyed units once, to %i total warrants', async (kills, expected) => {
    const f = fixture();
    const facts = f.facts();
    facts.finalReward!.kills = kills;
    expect(await f.service.settle(facts)).toMatchObject({
      ok: true,
      receipt: { warrants: expected },
    });
  });

  it('caps a small veteran bonus and grants at most one module, using the persisted seed', async () => {
    const f = fixture();
    const facts = f.facts();
    facts.finalReward!.reason = 'active';
    facts.finalReward!.veteranPoints = 1000;
    facts.finalReward!.policy.moduleChance = 1;
    const results = await Promise.all(Array.from({ length: 4 }, () => f.service.settle(facts)));
    for (const result of results) expect(result).toEqual(results[0]);
    expect(results[0]).toMatchObject({
      ok: true,
      receipt: { matchReward: { veteranMaterials: 3 }, drop: { kind: 'module', forced: false } },
    });
    expect(
      (await f.store.read('alice')).materials
        .filter((m) => m.source === 'match')
        .reduce((sum, m) => sum + m.quantity, 0),
    ).toBe(6);
    expect((await f.arsenal.listOf('alice')).filter((item) => item.origin === 'drop')).toHaveLength(
      1,
    );
    expect(await f.market.balance('alice')).toBe(12);
    expect(
      await f.service.settle({ ...facts, finalReward: { ...facts.finalReward!, kills: 100 } }),
    ).toEqual({ ok: false, code: 'E_IDEMPOTENCY_CONFLICT' });
  });

  it.each(['inactive', 'no-contribution'] as const)(
    'stores a final zero receipt for %s rather than waiting forever',
    async (reason) => {
      const f = fixture();
      const facts = f.facts();
      facts.participation = false;
      facts.finalReward!.reason = reason;
      facts.finalReward!.policy.moduleChance = 1;
      const first = await f.service.settle(facts);
      expect(first).toMatchObject({
        ok: true,
        receipt: { sovereignsGranted: 0, warrants: 0, matchReward: { reason } },
      });
      expect(await f.service.settle(facts)).toEqual(first);
      expect(await f.market.balance('alice')).toBe(0);
      expect((await f.store.read('alice')).materials).toEqual([]);
      expect(await f.arsenal.listOf('alice')).toEqual([]);
      expect((await f.service.matchRewards('alice', facts.matchId)).finalReady).toBe(true);
    },
  );

  it('rolls back the entire grant if inventory storage fails and safely retries after recovery', async () => {
    const f = fixture();
    const facts = f.facts();
    facts.finalReward!.policy.moduleChance = 1;
    vi.spyOn(f.arsenal, 'grant').mockRejectedValueOnce(new Error('storage failure'));
    await expect(f.service.settle(facts)).rejects.toThrow('storage failure');
    expect((await f.store.read('alice')).sovereigns ?? 0).toBe(0);
    expect(await f.market.balance('alice')).toBe(0);
    expect((await f.service.matchRewards('alice', facts.matchId)).finalReady).toBe(false);
    expect(await f.service.settle(facts)).toMatchObject({
      ok: true,
      receipt: { sovereignsGranted: 300, warrants: 12 },
    });
    expect(await f.arsenal.listOf('alice')).toHaveLength(1);
  });

  it('has the same module chance for winners and eliminated players and no inherited four-match guarantee', async () => {
    const f = fixture();
    for (const place of [1, 4, 20]) {
      const facts = f.facts(`place_${place}`);
      facts.place = place;
      facts.finalReward!.policy.moduleChance = 0;
      for (let i = 0; i < 5; i++) {
        const result = await f.service.settle({ ...facts, matchId: `place_${place}_${i}` });
        expect(result).toMatchObject({
          ok: true,
          receipt: { drop: null, dropOdds: { chance: 0, forced: false } },
        });
      }
    }
    expect((await f.arsenal.listOf('alice')).filter((item) => item.origin === 'drop')).toEqual([]);
    const odds = (await f.service.readModel('alice')).drops!;
    expect(odds).toMatchObject({ pityAfter: 0, byPlace: [{ maxPlace: 999, chance: 0.05 }] });
  });

  it('rejects invalid or contradictory evidence without reserving the reward identity', async () => {
    const f = fixture();
    const facts = f.facts();
    const invalid = [
      { ...facts, kind: 'stage' as const, stage: 1 },
      { ...facts, participation: false },
      { ...facts, finalReward: { ...facts.finalReward!, kills: -1 } },
      { ...facts, finalReward: { ...facts.finalReward!, seed: 'client' } },
    ];
    for (const candidate of invalid)
      expect(await f.service.settle(candidate)).toEqual({ ok: false, code: 'E_META_FACTS' });
    expect(await f.service.settle(facts)).toMatchObject({ ok: true });
  });
});
