import { describe, expect, it } from 'vitest';
import Fastify from 'fastify';
import { settleMedalRewards, type MedalRewardDeps } from './medalRewards';
import { MetaEconomy, medalReward } from './metaEconomy';
import { loadMetaEconomyCatalog } from './metaEconomyCatalog';
import { MemoryMetaEconomyStore } from './metaEconomyStore';
import { MemoryMetaMarket } from './metaMarket';
import { MemoryProfileStore } from './profileStore';
import { registerProfileApi } from './profileApi';
import {
  MemoryArsenalStore,
  MemoryCommanderStore,
  MemoryDropStore,
  MemoryUserStore,
  MemoryCorpStore,
} from './store';
import { loadDropTables, loadShippedData } from './scenario';

const data = loadShippedData();

function setup() {
  const catalog = loadMetaEconomyCatalog(data);
  const arsenal = new MemoryArsenalStore();
  const market = new MemoryMetaMarket(arsenal, () => 1_800_000_000_000);
  const store = new MemoryMetaEconomyStore(arsenal, new MemoryDropStore(), market);
  market.setEconomy(store);
  const economy = new MetaEconomy({
    store,
    catalog,
    dropTables: loadDropTables(data),
    now: () => 1_800_000_000_000,
  });
  const profiles = new MemoryProfileStore();
  const commanders = new MemoryCommanderStore();
  const deps: MedalRewardDeps = { profiles, commanders, economy, table: catalog.medals };
  return { catalog, economy, market, profiles, commanders, deps, store };
}

describe('medal rewards', () => {
  it('announces actual server-earned degrees once with the recipient identity', async () => {
    const f = setup();
    const users = new MemoryUserStore();
    const made = await users.createUser('NewsPilot', 'hash');
    if (!made.ok) throw Error('fixture');
    f.deps.news = { users, corps: new MemoryCorpStore() };
    await f.profiles.credit('medal-news-match', [{ accountId: made.userId, progress: { wins: 50 } }]);
    await settleMedalRewards(f.deps, made.userId);
    await settleMedalRewards(f.deps, made.userId);
    const news = await f.store.recentPlayerMedals(50);
    expect(news).toHaveLength(1);
    expect(news[0]).toMatchObject({ medalId: 'first', grade: 1, login: 'NewsPilot', corp: null });
    expect(JSON.stringify(news)).not.toContain(made.userId);
  });
  it('pays every reached degree, lower classes included, once; medals earned without play pay in full', async () => {
    const f = setup();
    // 10 wins reach «Первый рубеж» II, so class III pays too; registration and the
    // tutorial are the two medals earned without a match.
    await f.profiles.credit('m1', [
      { accountId: 'alice', progress: { wins: 10, registered: 1, tutorial: 1 } },
    ]);
    const warrants = await f.market.balance('alice');
    const granted = await settleMedalRewards(f.deps, 'alice');
    const { grades } = f.catalog.medals;
    expect(granted).toEqual([
      { medalId: 'first', grade: 3, ...grades[3] },
      { medalId: 'first', grade: 2, ...grades[2] },
      { medalId: 'contribution', grade: 3, ...grades[3] },
      { medalId: 'tutorial', grade: 3, ...grades[3] },
    ]);
    expect(await f.commanders.xpOf('alice')).toBe(grades[3].xp * 3 + grades[2].xp);
    expect((await f.economy.readModel('alice')).sovereigns).toBe(
      grades[3].sovereigns * 3 + grades[2].sovereigns,
    );
    expect((await f.market.balance('alice')) - warrants).toBe(
      grades[3].warrants * 3 + grades[2].warrants,
    );
    // Nothing new reached — nothing paid, XP unchanged.
    expect(await settleMedalRewards(f.deps, 'alice')).toEqual([]);
    expect(await f.commanders.xpOf('alice')).toBe(grades[3].xp * 3 + grades[2].xp);
    // The next degree pays alone.
    await f.profiles.credit('m2', [{ accountId: 'alice', progress: { wins: 40 } }]);
    expect(await settleMedalRewards(f.deps, 'alice')).toEqual([
      { medalId: 'first', grade: 1, ...grades[1] },
    ]);
  });

  it('a medal listed in medals.sovereignsOnly pays its Sovereigns only', () => {
    const { grades } = setup().catalog.medals;
    const table = { grades, sovereignsOnly: ['tutorial'] };
    expect(medalReward(table, { medalId: 'tutorial', grade: 3 })).toEqual({
      medalId: 'tutorial',
      grade: 3,
      sovereigns: grades[3].sovereigns,
      warrants: 0,
      xp: 0,
    });
    expect(medalReward(table, { medalId: 'first', grade: 3 })).toEqual({
      medalId: 'first',
      grade: 3,
      ...grades[3],
    });
  });

  it('a failed economy step leaves the degree unpaid, and the retry does not pay XP twice', async () => {
    const f = setup();
    await f.profiles.credit('m1', [{ accountId: 'bob', progress: { wins: 1 } }]);
    const failing: MedalRewardDeps = {
      ...f.deps,
      economy: {
        unpaidMedals: (id, earned) => f.economy.unpaidMedals(id, earned),
        claimMedals: async () => ({ ok: false, code: 'E_META_LIMIT' }),
      },
    };
    await expect(settleMedalRewards(failing, 'bob')).rejects.toThrow('E_META_LIMIT');
    const { grades } = f.catalog.medals;
    expect(await f.commanders.xpOf('bob')).toBe(grades[3].xp);
    expect(await settleMedalRewards(f.deps, 'bob')).toEqual([
      { medalId: 'first', grade: 3, ...grades[3] },
    ]);
    expect(await f.commanders.xpOf('bob')).toBe(grades[3].xp);
  });

  it('POST /profiles/rewards/medals pays the signed-in account and names the grant', async () => {
    const f = setup();
    const app = Fastify();
    const users = new MemoryUserStore();
    const alice = await users.createUser('Alice', 'private-hash');
    if (!alice.ok) throw new Error('fixture');
    registerProfileApi(app, {
      profiles: f.profiles,
      users,
      commanders: f.commanders,
      medalRewards: (accountId) => settleMedalRewards(f.deps, accountId),
      identify: async (request) =>
        request.headers.authorization === 'Alice'
          ? { accountId: alice.userId, login: 'Alice' }
          : null,
    });
    try {
      await f.profiles.credit('m1', [{ accountId: alice.userId, progress: { worlds: 1 } }]);
      const claim = (authorization?: string) =>
        app.inject({
          method: 'POST',
          url: '/profiles/rewards/medals',
          ...(authorization ? { headers: { authorization } } : {}),
        });
      expect((await claim()).statusCode).toBe(401);
      const first = await claim('Alice');
      expect(first.statusCode).toBe(200);
      expect(first.headers['cache-control']).toBe('no-store');
      expect(first.json()).toEqual({
        granted: [{ medalId: 'colony', grade: 3, ...f.catalog.medals.grades[3] }],
      });
      expect((await claim('Alice')).json()).toEqual({ granted: [] });
    } finally {
      await app.close();
    }
  });
});
