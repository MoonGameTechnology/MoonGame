import { afterEach, describe, expect, it } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { MetaEconomy } from './metaEconomy';
import { loadMetaEconomyCatalog } from './metaEconomyCatalog';
import { MemoryMetaEconomyStore, PostgresMetaEconomyStore } from './metaEconomyStore';
import { MemoryMetaMarket } from './metaMarket';
import {
  MemoryArsenalStore,
  MemoryDropStore,
  MemoryAvaFeedStore,
  MemoryAnnouncementStore,
  migrate,
} from './store';
import { loadDropTables, loadShippedData } from './scenario';
import { registerNewsApi } from './newsApi';

const data = loadShippedData();
const apps: FastifyInstance[] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map((a) => a.close()));
});
function setup() {
  const arsenal = new MemoryArsenalStore();
  const store = new MemoryMetaEconomyStore(
    arsenal,
    new MemoryDropStore(),
    new MemoryMetaMarket(arsenal),
  );
  const economy = new MetaEconomy({
    store,
    catalog: loadMetaEconomyCatalog(data),
    dropTables: loadDropTables(data),
    now: () => 1000,
  });
  return { store, economy };
}
describe('player medal news', () => {
  it('does not advance the shared cursor when either source is unavailable', async () => {
    for (const failed of ['corps', 'medals']) {
      let down = true;
      const app = Fastify(); apps.push(app);
      registerNewsApi(app, {
        announcements: new MemoryAnnouncementStore(),
        feed: { recent: async () => {
          if (down && failed === 'corps') throw Error('outage');
          return [{ id: 'c300', at: 300, kind: 'founded', corpId: 'c', corpName: 'Corp' }, { id: 'c200', at: 200, kind: 'founded', corpId: 'c', corpName: 'Corp' }];
        } },
        playerMedals: { recentPlayerMedals: async () => {
          if (down && failed === 'medals') throw Error('outage');
          return [{ id: 'm250', at: 250, kind: 'player_medal', medalId: 'first', grade: 1, login: 'Pilot', corp: null }];
        } },
      });
      const refused = await app.inject('/news?limit=2');
      expect(refused.statusCode).toBe(503);
      expect(refused.json()).toEqual({ error: 'E_NEWS_UNAVAILABLE' });
      down = false;
      const recovered = await app.inject('/news?limit=2');
      expect(recovered.statusCode).toBe(200);
      expect(recovered.json().events.map((e: { id: string }) => e.id)).toEqual(['c300', 'm250']);
    }
  });
  it.skipIf(!process.env.DATABASE_URL)(
    'persists scoped news across adapters and cannot resurrect an erased login',
    async () => {
      const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
      const account = randomUUID(),
        corp = randomUUID(),
        eventId = randomUUID();
      try {
        await migrate(pool);
        await pool.query("INSERT INTO users(id,login,pass_hash) VALUES($1,$2,'test')", [
          account,
          `pilot-${account}`,
        ]);
        const store = new PostgresMetaEconomyStore(pool);
        const event = {
          id: eventId,
          at: 1000,
          kind: 'player_medal' as const,
          medalId: 'first' as const,
          grade: 2 as const,
          login: 'stale-login',
          corp: { id: corp, name: 'Alpha' },
        };
        await store.transaction([account], async (tx) => {
          await tx.announcePlayerMedal(event, account);
        });
        await store.transaction([account], async (tx) => {
          await tx.announcePlayerMedal({ ...event, id: randomUUID() }, account);
        });
        const restarted = new PostgresMetaEconomyStore(pool);
        expect(
          (await restarted.recentPlayerMedals(50, undefined, corp)).filter((e) => e.id === eventId),
        ).toEqual([{ ...event, login: `pilot-${account}` }]);
        expect((await restarted.recentPlayerMedals(50)).some((e) => e.id === eventId)).toBe(false);
        await pool.query('UPDATE users SET deletion_requested_at=now() WHERE id=$1', [account]);
        await pool.query(
          'UPDATE player_medal_news SET account_id=NULL,login=NULL WHERE account_id=$1',
          [account],
        );
        await store.transaction([account], async (tx) => {
          await tx.announcePlayerMedal({ ...event, id: randomUUID() }, account);
        });
        expect(
          (await restarted.recentPlayerMedals(50, undefined, corp)).filter(
            (e) => e.corp?.id === corp,
          ),
        ).toEqual([{ ...event, login: null }]);
      } finally {
        await pool.query("DELETE FROM player_medal_news WHERE corp->>'id'=$1", [corp]);
        await pool.query('DELETE FROM users WHERE id=$1', [account]);
        await pool.query('DELETE FROM meta_economy_accounts WHERE account_id=$1', [account]);
        await pool.end();
      }
    },
  );
  it('commits one announcement per paid degree and rolls it back with the reward', async () => {
    const { store, economy } = setup();
    const context = { login: '<Alice>', corp: { id: 'a', name: 'Alpha' } };
    await economy.claimMedals(
      'account-private',
      [
        { medalId: 'first', grade: 1 },
        { medalId: 'first', grade: 2 },
      ],
      context,
    );
    await economy.claimMedals('account-private', [{ medalId: 'first', grade: 2 }], context);
    const own = await store.recentPlayerMedals(50, undefined, 'a');
    expect(own).toHaveLength(2);
    expect(JSON.stringify(own)).not.toContain('account-private');
    expect(await store.recentPlayerMedals(50)).toHaveLength(1);
    await expect(
      store.transaction(['other'], async (tx) => {
        await tx.announcePlayerMedal(
          {
            id: randomUUID(),
            at: 1001,
            kind: 'player_medal',
            medalId: 'first',
            grade: 1,
            login: 'Other',
            corp: null,
          },
          'other',
        );
        throw Error('rollback');
      }),
    ).rejects.toThrow('rollback');
    expect(await store.recentPlayerMedals(50, undefined, 'a')).toEqual(own);
  });
  it('checks current membership before paging, never trusting a corp query parameter', async () => {
    const { store, economy } = setup();
    await economy.claimMedals(
      'alice',
      [
        { medalId: 'first', grade: 1 },
        { medalId: 'first', grade: 2 },
        { medalId: 'first', grade: 3 },
      ],
      { login: 'Alice', corp: { id: 'a', name: 'Alpha' } },
    );
    let role = 'member';
    let membershipCorp: string | null = 'a';
    let membershipFails = false;
    const app = Fastify();
    apps.push(app);
    registerNewsApi(app, {
      feed: new MemoryAvaFeedStore(),
      announcements: new MemoryAnnouncementStore(),
      playerMedals: store,
      identify: async (req) =>
        req.headers.authorization === 'Bearer valid' ? { accountId: 'reader' } : null,
      membershipOf: async () => {
        if (membershipFails) throw Error('unavailable');
        return membershipCorp ? { corpId: membershipCorp, role } : null;
      },
    });
    const read = async (token?: string) =>
      (
        await app.inject({
          url: '/news?corpId=a&limit=1',
          headers: token ? { authorization: token } : {},
        })
      ).json();
    expect((await read()).events).toHaveLength(1);
    expect((await read('Bearer forged')).events).toHaveLength(1);
    expect((await read('Bearer valid')).events).toHaveLength(3);
    role = 'recruit';
    expect((await read('Bearer valid')).events).toHaveLength(1);
    role = 'member';
    membershipCorp = 'b';
    expect((await read('Bearer valid')).events).toHaveLength(1);
    membershipCorp = null;
    expect((await read('Bearer valid')).events).toHaveLength(1);
    membershipCorp = 'a';
    membershipFails = true;
    expect((await read('Bearer valid')).events).toHaveLength(1);
  });
});
