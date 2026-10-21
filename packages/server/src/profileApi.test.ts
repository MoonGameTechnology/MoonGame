import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import { Pool } from 'pg';
import { defaultAppearance, medalGrade } from '@void/protocol';
import { registerProfileApi, type ProfileApiDeps } from './profileApi';
import { MemoryProfileStore, PostgresProfileStore, type ProfileStore } from './profileStore';
import { MemoryCommanderStore, MemoryUserStore, migrate } from './store';
import { creditProfileMatch } from './profileCredit';
import { createInitialState } from '@void/shared-core';

function contract(name: string, store: () => ProfileStore, unique = name): void {
  it(`${name}: preserves slots while III → II → I replaces the grade, and credits once`, async () => {
    const profiles = store();
    const accountId = `${unique}-a`;
    const look = defaultAppearance();
    look.portrait = 40;
    look.slots[14] = 'first';
    expect(await profiles.appearance(accountId)).toEqual(defaultAppearance());
    await profiles.credit(`${unique}-m1`, [{ accountId, progress: { wins: 1 } }]);
    await profiles.save(accountId, look);
    look.slots[14] = null; // input mutation cannot change persistence
    expect(medalGrade('first', await profiles.progress(accountId))).toBe(3);
    await Promise.all(
      Array.from({ length: 3 }, () =>
        profiles.credit(`${unique}-m2`, [{ accountId, progress: { wins: 9 } }]),
      ),
    );
    expect(medalGrade('first', await profiles.progress(accountId))).toBe(2);
    await profiles.credit(`${unique}-m3`, [{ accountId, progress: { wins: 40 } }]);
    expect(medalGrade('first', await profiles.progress(accountId))).toBe(1);
    expect((await profiles.appearance(accountId)).slots[14]).toBe('first');
    expect((await profiles.progress(accountId)).wins).toBe(50);
    expect(await profiles.progress(`${unique}-other`)).toEqual({});
    // A second account can be resolved later, without duplicating the first one.
    await profiles.credit(`${unique}-m3`, [
      { accountId: `${unique}-other`, progress: { wins: 1 } },
    ]);
    expect((await profiles.progress(`${unique}-other`)).wins).toBe(1);
  });
}
contract('memory', () => new MemoryProfileStore());
describe.skipIf(!process.env.DATABASE_URL)('durable profile store', () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  beforeAll(async () => {
    await migrate(pool);
  });
  afterAll(async () => {
    await pool.end();
  });
  contract(
    'postgres',
    () => new PostgresProfileStore(pool),
    `profile-${process.pid}-${Date.now()}`,
  );
});

async function fixture(option?: ProfileApiDeps['bots'] | ProfileApiDeps['premium']) {
  const premium = typeof option === 'function' ? option : undefined;
  const bots = typeof option === 'object' ? option : undefined;
  const app = Fastify();
  const profiles = new MemoryProfileStore();
  const users = new MemoryUserStore();
  const commanders = new MemoryCommanderStore();
  const alice = await users.createUser('Alice', 'private-hash', 'private@example.test');
  const bob = await users.createUser('Bob', 'private-hash-b');
  if (!alice.ok || !bob.ok) throw new Error('fixture');
  registerProfileApi(app, {
    profiles,
    users,
    commanders,
    ...(premium ? { premium } : {}),
    ...(bots ? { bots } : {}),
    identify: async (request) => {
      const id =
        request.headers.authorization === 'Alice'
          ? alice.userId
          : request.headers.authorization === 'Bob'
            ? bob.userId
            : null;
      return id ? { accountId: id, login: id === alice.userId ? 'Alice' : 'Bob' } : null;
    },
  });
  return { app, profiles, commanders, alice: alice.userId, bob: bob.userId };
}

describe('persistent bot public profiles', () => {
  const bot = { id: 'bot-001', login: '~Orion', portrait: 19, seed: 71, xp: 245 };
  const result = {
    botId: bot.id,
    playerId: 'p3',
    matchId: 'm-finished',
    mapId: 'nexus',
    endedAt: 1_800_000_000_000,
    outcome: 'win' as const,
    xp: 245,
    place: 1,
  };
  function roster() {
    return {
      findByLogin: vi.fn(async (login: string) => (login.toLowerCase() === '~orion' ? bot : null)),
      recentMatches: vi.fn(async () => [result]),
    };
  }
  it('shows real accumulated bot progress and a bounded explicit history without auth identity', async () => {
    const bots = roster();
    const { app, profiles, commanders } = await fixture(bots);
    try {
      await profiles.credit('m-real', [
        {
          accountId: bot.id,
          progress: { matches: 24, wins: 12, explored: 72 },
        },
      ]);
      const view = await app.inject({
        url: '/profiles?login=~orion',
        headers: { authorization: 'Alice' },
      });
      expect(view.statusCode).toBe(200);
      expect(view.json()).toEqual({
        kind: 'bot',
        login: bot.login,
        portrait: bot.portrait,
        xp: bot.xp,
        progress: { matches: 24, wins: 12, explored: 72 },
        slots: ['first', 'map', 'service', ...Array(12).fill(null)],
        recentMatches: [
          {
            matchId: result.matchId,
            mapId: result.mapId,
            endedAt: result.endedAt,
            outcome: 'win',
            xp: 245,
            place: 1,
          },
        ],
      });
      expect(view.body).not.toMatch(/botId|playerId|accountId|seed|passHash|email/);
      expect(bots.recentMatches).toHaveBeenCalledWith(bot.id, 10);
      expect(await commanders.xpOf(bot.id)).toBe(0);
      bots.recentMatches.mockResolvedValue(
        Array.from({ length: 11 }, (_, i) => ({ ...result, matchId: `m-${i}` })),
      );
      const bounded = (
        await app.inject({ url: '/profiles?login=~Orion', headers: { authorization: 'Alice' } })
      ).json();
      expect(bounded.recentMatches).toHaveLength(10);
      expect((await app.inject({ url: '/profiles?login=~Orion' })).statusCode).toBe(401);
      expect(
        (await app.inject({ url: '/profiles?login=~missing', headers: { authorization: 'Alice' } }))
          .statusCode,
      ).toBe(404);
    } finally {
      await app.close();
    }
  });
  it('starts without medals and never redirects user reads or writes to a bot', async () => {
    const bots = roster();
    // Even a resolver that returns the bot for a real login cannot take over that profile.
    bots.findByLogin.mockImplementation(async () => ({ ...bot, xp: 0 }));
    bots.recentMatches.mockResolvedValue([]);
    const { app, profiles, alice } = await fixture(bots);
    try {
      const fresh = (
        await app.inject({ url: '/profiles?login=~Orion', headers: { authorization: 'Alice' } })
      ).json();
      expect(fresh.progress).toEqual({});
      expect(fresh.slots).toEqual(defaultAppearance().slots);
      expect(fresh.recentMatches).toEqual([]);
      bots.findByLogin.mockClear();
      await profiles.credit('human', [{ accountId: alice, progress: { matches: 15, wins: 7 } }]);
      const human = (
        await app.inject({ url: '/profiles?login=Alice', headers: { authorization: 'Bob' } })
      ).json();
      expect(human.progress).toEqual({});
      expect(human).not.toHaveProperty('kind');
      expect(human).not.toHaveProperty('recentMatches');
      expect(bots.findByLogin).not.toHaveBeenCalled();
      const look = { ...defaultAppearance(), portrait: 11 };
      const saved = await app.inject({
        method: 'POST',
        url: '/profiles/me?login=~Orion',
        headers: { authorization: 'Alice' },
        payload: look,
      });
      expect(saved.statusCode).toBe(200);
      expect(saved.json().login).toBe('Alice');
      expect(await profiles.appearance(alice)).toEqual(look);
      expect(await profiles.appearance(bot.id)).toEqual(defaultAppearance());
      for (const payload of [
        { ...look, kind: 'bot' },
        { ...look, botId: bot.id },
        { ...look, recentMatches: [result] },
      ]) {
        expect(
          (
            await app.inject({
              method: 'POST',
              url: '/profiles/me',
              headers: { authorization: 'Alice' },
              payload,
            })
          ).statusCode,
        ).toBe(400);
      }
      expect(
        (
          await app.inject({
            method: 'POST',
            url: '/profiles/me',
            headers: { authorization: '~Orion' },
            payload: look,
          })
        ).statusCode,
      ).toBe(401);
    } finally {
      await app.close();
    }
  });
});

describe('profile API authority and public projection', () => {
  it('shows a running premium as a frame to everyone, and a failed premium read leaves it off', async () => {
    let failing = false;
    const holders = new Set<string>();
    const { app, alice } = await fixture(async (id) => {
      if (failing) throw Error('meta down');
      return holders.has(id);
    });
    holders.add(alice);
    try {
      const read = async (who: string, login: string) =>
        (
          await app.inject({ url: `/profiles?login=${login}`, headers: { authorization: who } })
        ).json();
      expect((await read('Bob', 'Alice')).premium).toBe(true);
      expect((await read('Alice', 'Alice')).premium).toBe(true);
      expect(await read('Alice', 'Bob')).not.toHaveProperty('premium');
      failing = true;
      const fallback = await read('Bob', 'Alice');
      expect(fallback.login).toBe('Alice');
      expect(fallback).not.toHaveProperty('premium');
    } finally {
      await app.close();
    }
  });

  it('only the session owner can save, and a different player sees the saved card', async () => {
    const { app, profiles, alice, bob } = await fixture();
    try {
      const look = defaultAppearance();
      look.portrait = 17;
      look.slots[6] = 'first';
      expect(
        (await app.inject({ method: 'POST', url: '/profiles/me', payload: look })).statusCode,
      ).toBe(401);
      expect((await app.inject({ method: 'GET', url: '/profiles?login=Alice' })).statusCode).toBe(
        401,
      );
      expect(
        (
          await app.inject({
            method: 'POST',
            url: '/profiles/me',
            headers: { authorization: 'Alice' },
            payload: look,
          })
        ).statusCode,
      ).toBe(403);
      await profiles.credit('won', [{ accountId: alice, progress: { wins: 1, matches: 1 } }]);
      const saved = await app.inject({
        method: 'POST',
        url: '/profiles/me',
        headers: { authorization: 'Alice' },
        payload: look,
      });
      expect(saved.statusCode).toBe(200);
      const seen = await app.inject({
        method: 'GET',
        url: '/profiles?login=alice',
        headers: { authorization: 'Bob' },
      });
      expect(seen.json()).toEqual({ ...saved.json(), progress: { wins: 1 } });
      expect(saved.json().progress).toEqual({ wins: 1, matches: 1 });
      expect(seen.body).not.toMatch(/private|email|passHash|accountId|sovereigns/);
      expect(await profiles.appearance(bob)).toEqual(defaultAppearance());
      await profiles.credit('promotion', [{ accountId: alice, progress: { wins: 13, explored: 999 } }]);
      const updated = (
        await app.inject({
          method: 'GET',
          url: '/profiles?login=Alice',
          headers: { authorization: 'Bob' },
        })
      ).json();
      expect(updated.slots[6]).toBe('first');
      expect(medalGrade('first', updated.progress)).toBe(2);
      expect(updated.progress).toEqual({ wins: 10 });
      expect((await profiles.progress(alice)).wins).toBe(14);
    } finally {
      await app.close();
    }
  });
  it('rejects forged counters/grades, target IDs, duplicate medals, URLs and oversized grids', async () => {
    const { app, profiles, alice } = await fixture();
    try {
      const look = defaultAppearance();
      for (const payload of [
        { ...look, progress: { wins: 999 } },
        { ...look, grade: 1 },
        { ...look, accountId: 'other' },
        { ...look, portrait: 'https://evil.test/p.png' },
        { ...look, portrait: 41 },
        { ...look, slots: Array(16).fill(null) },
        { ...look, slots: Array(15).fill('first') },
        { ...look, slots: ['__proto__', ...Array(14).fill(null)] },
      ]) {
        const r = await app.inject({
          method: 'POST',
          url: '/profiles/me',
          headers: { authorization: 'Alice' },
          payload,
        });
        expect(r.statusCode).toBe(400);
      }
      expect(await profiles.appearance(alice)).toEqual(look);
      expect(
        (await app.inject({ url: '/profiles?login=missing', headers: { authorization: 'Bob' } }))
          .statusCode,
      ).toBe(404);
    } finally {
      await app.close();
    }
  });
});

it('counts only completed, seated accounts and handles coalition winners once', async () => {
  const profiles = new MemoryProfileStore();
  const state = createInitialState({ seed: 'profile', version: { data: '1', manifest: '1' } });
  for (const id of ['p1', 'p2', 'bot'])
    state.players[id] = {
      id,
      name: id,
      faction: '',
      resources: {},
      status: 'active',
      ...(id === 'bot' ? {} : { seated: true as const }),
    };
  state.match.winner = 'p1';
  state.match.winners = ['p1', 'p2'];
  state.match.rewards = {
    p1: { xp: 1, place: 1 },
    p2: { xp: 1, place: 1 },
    bot: { xp: 1, place: 3 },
  };
  const seats = async () => ({ p1: 'a', p2: 'b', bot: 'c' });
  await creditProfileMatch(profiles, seats, 'match', state);
  expect(await profiles.progress('a')).toEqual({});
  state.match.status = 'ended';
  await creditProfileMatch(profiles, seats, 'match', state);
  await creditProfileMatch(profiles, seats, 'match', state);
  expect(await profiles.progress('a')).toMatchObject({ matches: 1, wins: 1, teamWins: 1 });
  expect(await profiles.progress('b')).toMatchObject({ matches: 1, wins: 1, teamWins: 1 });
  expect(await profiles.progress('c')).toEqual({});
});
