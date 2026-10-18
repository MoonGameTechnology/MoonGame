import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import Fastify from 'fastify';
import { Pool } from 'pg';
import { defaultAppearance, medalGrade, REGISTRATION_REWARD } from '@void/protocol';
import {
  MemoryUserStore,
  MemoryCommanderStore,
  PostgresUserStore,
  PostgresCommanderStore,
  migrate,
  type UserStore,
  type CommanderStore,
} from './store';
import { MemoryProfileStore, PostgresProfileStore, type ProfileStore } from './profileStore';
import {
  MemoryRegistrationRewardStore,
  PostgresRegistrationRewardStore,
  type RegistrationRewardStore,
} from './registrationRewardStore';
import { registerProfileApi } from './profileApi';
import { registerAuthApi } from './authApi';
import economy from '../../../data/metaEconomy.json';

interface Fixture {
  users: UserStore;
  profiles: ProfileStore;
  commanders: CommanderStore;
  rewards: RegistrationRewardStore;
  reopen(): RegistrationRewardStore;
}
const unique = (): string => `medal-${crypto.randomUUID()}`;
async function account(f: Fixture): Promise<string> {
  const result = await f.users.createUser(unique(), 'unused-test-hash');
  if (!result.ok) throw new Error('fixture');
  return result.userId;
}
function memory(): Fixture {
  const users = new MemoryUserStore();
  const profiles = new MemoryProfileStore();
  const commanders = new MemoryCommanderStore();
  const rewards = new MemoryRegistrationRewardStore(users, profiles, commanders);
  return { users, profiles, commanders, rewards, reopen: () => rewards };
}
function contract(name: string, fixture: () => Fixture): void {
  describe(name, () => {
    it('grants class III and real account XP once across concurrent retries, without changing other progress', async () => {
      const f = fixture();
      const id = await account(f);
      await f.profiles.credit(unique(), [{ accountId: id, progress: { wins: 1 } }]);
      await f.commanders.creditMatch(unique(), [{ accountId: id, xp: 7 }]);
      const receipts = await Promise.all(Array.from({ length: 8 }, () => f.rewards.ensure(id)));
      expect(receipts).toEqual(Array(8).fill({ ...REGISTRATION_REWARD, accepted: false }));
      expect(await f.commanders.xpOf(id)).toBe(7 + REGISTRATION_REWARD.xp);
      expect(await f.profiles.progress(id)).toEqual({ registered: 1, wins: 1 });
      expect(medalGrade('contribution', await f.profiles.progress(id))).toBe(3);
      expect(await f.rewards.ensure('no-such-account')).toBeNull();
      expect((await f.profiles.appearance(id)).slots.every((slot) => slot === null)).toBe(true);
    });
    it('Accept keeps the medal in the collection; a later Equip retry does not reinterpret that choice', async () => {
      const f = fixture();
      const id = await account(f);
      expect((await f.rewards.accept(id, false)).ok).toBe(true);
      expect((await f.reopen().ensure(id))?.accepted).toBe(true);
      await f.rewards.accept(id, true);
      expect((await f.profiles.appearance(id)).slots.every((slot) => slot === null)).toBe(true);
      expect(await f.commanders.xpOf(id)).toBe(REGISTRATION_REWARD.xp);
    });
    it('Equip uses a free slot, preserves the portrait and existing medals, and survives retries/reopening', async () => {
      const f = fixture();
      const id = await account(f);
      const appearance = defaultAppearance();
      appearance.portrait = 17;
      appearance.slots[0] = 'first';
      await f.profiles.credit(unique(), [{ accountId: id, progress: { wins: 1 } }]);
      await f.profiles.save(id, appearance);
      await Promise.all(Array.from({ length: 5 }, () => f.rewards.accept(id, true)));
      const saved = await f.profiles.appearance(id);
      expect(saved.portrait).toBe(17);
      expect(saved.slots.slice(0, 2)).toEqual(['first', 'contribution']);
      expect(saved.slots.filter((id) => id === 'contribution')).toHaveLength(1);
      expect((await f.reopen().ensure(id))?.accepted).toBe(true);
      expect(await f.commanders.xpOf(id)).toBe(REGISTRATION_REWARD.xp);
    });
  });
}
contract('memory', memory);
describe.skipIf(!process.env.DATABASE_URL)('PostgreSQL registration rewards', () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  beforeAll(() => migrate(pool));
  afterAll(() => pool.end());
  const fixture = (): Fixture => ({
    users: new PostgresUserStore(pool),
    profiles: new PostgresProfileStore(pool),
    commanders: new PostgresCommanderStore(pool),
    rewards: new PostgresRegistrationRewardStore(pool),
    reopen: () => new PostgresRegistrationRewardStore(pool),
  });
  contract('durable', fixture);
  it('does not retroactively reward accounts created before the feature', async () => {
    const id = unique();
    await pool.query('INSERT INTO users (id, login, pass_hash) VALUES ($1, $2, $3)', [
      id,
      id,
      'old-hash',
    ]);
    const f = fixture();
    expect(await f.rewards.ensure(id)).toBeNull();
    expect(await f.rewards.accept(id, true)).toEqual({ ok: false, code: 'E_NO_REWARD' });
    expect(await f.profiles.progress(id)).toEqual({});
    expect(await f.commanders.xpOf(id)).toBe(0);
  });
  it('rolls back both XP and the medal if receipt persistence fails, then repairs on retry', async () => {
    const f = fixture();
    const id = await account(f);
    const failedPool = {
      connect: async () => {
        const client = await pool.connect();
        return {
          query: (sql: string, values?: unknown[]) => {
            if (sql.startsWith('INSERT INTO registration_rewards'))
              throw new Error('injected receipt failure');
            return client.query(sql, values);
          },
          release: () => client.release(),
        };
      },
    } as unknown as Pool;
    await expect(new PostgresRegistrationRewardStore(failedPool).ensure(id)).rejects.toThrow(
      'injected receipt failure',
    );
    expect(await f.commanders.xpOf(id)).toBe(0);
    expect(await f.profiles.progress(id)).toEqual({});
    expect((await f.rewards.ensure(id))?.xp).toBe(REGISTRATION_REWARD.xp);
    expect(await f.commanders.xpOf(id)).toBe(REGISTRATION_REWARD.xp);
  });
});

it('registration XP alone stays below the current market participation gate', () => {
  expect(REGISTRATION_REWARD.xp).toBeLessThan(economy.market.minimumAccountXp);
});
it('a legacy in-memory identity also has no registration entitlement', async () => {
  const f = memory();
  const id = await account(f);
  const users = {
    findById: async (accountId: string) => {
      const user = await f.users.findById(accountId);
      return user && { ...user, registrationReward: false };
    },
  };
  const rewards = new MemoryRegistrationRewardStore(users, f.profiles, f.commanders);
  expect(await rewards.ensure(id)).toBeNull();
});
it('recovers after an interrupted registration hook; session-only API refuses forged XP, degree and targets', async () => {
  const f = memory();
  const app = Fastify();
  registerAuthApi(app, {
    users: f.users,
    signSession: async (id) => id,
    scryptParams: { N: 1024, r: 8, p: 1 },
    onRegistered: async () => {
      throw new Error('interrupted');
    },
  });
  registerProfileApi(app, {
    ...f,
    registrationRewards: f.rewards,
    identify: async (request) => {
      const user = await f.users.findById(request.headers.authorization ?? '');
      return user ? { accountId: user.userId, login: user.login } : null;
    },
  });
  try {
    const created = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { login: 'MedalNewcomer', password: 'Saffron planets arrive 2049!' },
    });
    expect(created.statusCode).toBe(201);
    const id = created.json<{ accountId: string }>().accountId;
    const headers = { authorization: id };
    const route = '/profiles/rewards/registration';
    expect((await app.inject({ url: route })).statusCode).toBe(401);
    expect(
      (await app.inject({ method: 'POST', url: route + '/accept', payload: { equip: true } }))
        .statusCode,
    ).toBe(401);
    expect((await app.inject({ url: route, headers })).json()).toEqual({
      reward: { ...REGISTRATION_REWARD, accepted: false },
    });
    for (const payload of [
      { equip: true, xp: 999 },
      { equip: true, grade: 1 },
      { equip: true, accountId: 'other' },
      { equip: 'true' },
      {},
    ]) {
      expect(
        (await app.inject({ method: 'POST', url: route + '/accept', headers, payload })).statusCode,
      ).toBe(400);
    }
    expect(
      (
        await app.inject({
          method: 'POST',
          url: route + '/accept',
          headers,
          payload: { equip: true },
        })
      ).statusCode,
    ).toBe(200);
    const profile = (await app.inject({ url: '/profiles', headers })).json();
    expect(profile).toMatchObject({ xp: REGISTRATION_REWARD.xp, progress: { registered: 1 } });
    expect(profile.slots[0]).toBe('contribution');
    expect((await app.inject({ url: route, headers })).json().reward.accepted).toBe(true);
    expect(await f.commanders.xpOf(id)).toBe(REGISTRATION_REWARD.xp);
  } finally {
    await app.close();
  }
});
