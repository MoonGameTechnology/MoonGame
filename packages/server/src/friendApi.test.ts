import { describe, expect, it } from 'vitest';
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import { registerFriendApi, INVITE_TTL_MS } from './friendApi';
import { FriendService } from './friendService';
import { MemoryFriendStore, MemoryUserStore } from './store';
import type { Identity } from './matchApi';

/**
 * FRIENDS-2 — «войти к другу», «скрывать мои партии» и приглашения. Каждое правило здесь —
 * то, что клиент НЕ должен суметь обойти (инвариант #5): прячет и проверяет сервер.
 */

/** Seats: login → the one match it plays. */
type Seats = Record<string, string>;

async function world(logins: string[], seats: Seats = {}) {
  const users = new MemoryUserStore();
  const ids: Record<string, string> = {};
  for (const login of logins) {
    const made = await users.createUser(login, 'hash');
    if (!made.ok) throw new Error(made.code);
    ids[login] = made.userId;
  }
  const friends = new MemoryFriendStore();
  const service = new FriendService({ friends, users });
  let clock = 1_000_000;
  const app: FastifyInstance = Fastify();
  registerFriendApi(app, {
    service,
    identify: (request: FastifyRequest): Promise<Identity | null> => {
      const login = request.headers['x-test-user'];
      if (typeof login !== 'string' || !ids[login]) return Promise.resolve(null);
      return Promise.resolve({ accountId: ids[login]!, login });
    },
    matches: {
      seatOf: (login) =>
        Promise.resolve(seats[login] ? { matchId: seats[login]!, days: 2 } : null),
      holdsSeat: (matchId, login) => Promise.resolve(seats[login] === matchId),
    },
    now: () => clock,
    rateMax: 1_000,
  });
  const as = (login: string) => ({ 'x-test-user': login });
  const befriend = async (a: string, b: string) => {
    await service.request({ accountId: ids[a]!, login: a }, b);
    await service.accept(ids[b]!, ids[a]!);
  };
  const list = async (login: string) =>
    (await app.inject({ method: 'GET', url: '/friends', headers: as(login) })).json() as {
      rows: { login: string; presence: { kind: string; matchId?: string } }[];
      invites: { fromLogin: string; matchId: string }[];
      hideMatches: boolean;
    };
  const tick = (ms: number) => {
    clock += ms;
  };
  return { app, ids, as, befriend, list, tick, service };
}

describe('FRIENDS-2 · войти к другу', () => {
  it('друг в партии — в присутствии её номер, по нему клиент войдёт', async () => {
    const w = await world(['Vasya', 'Petya'], { Petya: '48219370' });
    await w.befriend('Vasya', 'Petya');
    const row = (await w.list('Vasya')).rows[0]!;
    expect(row.presence).toEqual({ kind: 'match', day: 3, matchId: '48219370' });
  });

  it('«скрывать мои партии»: сервер не отдаёт ни номер, ни само «в матче»', async () => {
    const w = await world(['Vasya', 'Petya'], { Petya: '48219370' });
    await w.befriend('Vasya', 'Petya');
    const set = await w.app.inject({
      method: 'POST',
      url: '/friends/privacy',
      headers: w.as('Petya'),
      payload: { hideMatches: true },
    });
    expect(set.statusCode).toBe(200);
    expect((await w.list('Petya')).hideMatches).toBe(true);
    const row = (await w.list('Vasya')).rows[0]!;
    expect(row.presence.kind).not.toBe('match');
    expect(JSON.stringify(row)).not.toContain('48219370');
  });

  it('незнакомцу, которому ещё не ответили, место не показывается', async () => {
    const w = await world(['Vasya', 'Petya'], { Petya: '48219370' });
    await w.service.request({ accountId: w.ids.Vasya!, login: 'Vasya' }, 'Petya');
    const row = (await w.list('Vasya')).rows[0]!;
    expect(row.presence).toEqual({ kind: 'unknown' });
  });

  it('настройка принимает только true/false', async () => {
    const w = await world(['Vasya']);
    const res = await w.app.inject({
      method: 'POST',
      url: '/friends/privacy',
      headers: w.as('Vasya'),
      payload: { hideMatches: 'yes' },
    });
    expect(res.statusCode).toBe(400);
    expect((await w.list('Vasya')).hideMatches).toBe(false);
  });
});

describe('FRIENDS-2 · позвать друга', () => {
  const invite = (w: Awaited<ReturnType<typeof world>>, from: string, to: string, matchId: string) =>
    w.app.inject({
      method: 'POST',
      url: `/friends/${w.ids[to]}/invite`,
      headers: w.as(from),
      payload: { matchId },
    });

  it('друг зовёт в свою партию — приглашение у адресата', async () => {
    const w = await world(['Vasya', 'Petya'], { Vasya: 'm-1' });
    await w.befriend('Vasya', 'Petya');
    expect((await invite(w, 'Vasya', 'Petya', 'm-1')).statusCode).toBe(200);
    expect((await w.list('Petya')).invites).toMatchObject([{ fromLogin: 'Vasya', matchId: 'm-1' }]);
  });

  it('звать можно только в партию, где у тебя есть место', async () => {
    const w = await world(['Vasya', 'Petya'], { Vasya: 'm-1' });
    await w.befriend('Vasya', 'Petya');
    const res = await invite(w, 'Vasya', 'Petya', 'm-2');
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ error: 'E_NOT_SEATED' });
    expect((await w.list('Petya')).invites).toEqual([]);
  });

  it('не друга позвать нельзя — ни незнакомца, ни того, кто не принял заявку', async () => {
    const w = await world(['Vasya', 'Petya'], { Vasya: 'm-1' });
    expect((await invite(w, 'Vasya', 'Petya', 'm-1')).statusCode).toBe(404);
    await w.service.request({ accountId: w.ids.Vasya!, login: 'Vasya' }, 'Petya');
    expect((await invite(w, 'Vasya', 'Petya', 'm-1')).statusCode).toBe(404);
    expect((await w.list('Petya')).invites).toEqual([]);
  });

  it('мусор вместо номера партии отсекается', async () => {
    const w = await world(['Vasya', 'Petya'], { Vasya: 'm-1' });
    await w.befriend('Vasya', 'Petya');
    expect((await invite(w, 'Vasya', 'Petya', '<script>')).statusCode).toBe(400);
  });

  it('приглашение гаснет со временем, после «удалить из друзей» и по «✕»', async () => {
    const w = await world(['Vasya', 'Petya'], { Vasya: 'm-1' });
    await w.befriend('Vasya', 'Petya');
    await invite(w, 'Vasya', 'Petya', 'm-1');
    w.tick(INVITE_TTL_MS);
    expect((await w.list('Petya')).invites).toEqual([]);

    await invite(w, 'Vasya', 'Petya', 'm-1');
    await w.app.inject({
      method: 'POST',
      url: `/friends/invites/${w.ids.Vasya}/dismiss`,
      headers: w.as('Petya'),
    });
    expect((await w.list('Petya')).invites).toEqual([]);

    await invite(w, 'Vasya', 'Petya', 'm-1');
    await w.service.drop(w.ids.Petya!, w.ids.Vasya!);
    expect((await w.list('Petya')).invites).toEqual([]);
  });

  it('повторное приглашение заменяет прежнее, а не копится', async () => {
    const w = await world(['Vasya', 'Petya'], { Vasya: 'm-1' });
    await w.befriend('Vasya', 'Petya');
    await invite(w, 'Vasya', 'Petya', 'm-1');
    await invite(w, 'Vasya', 'Petya', 'm-1');
    expect((await w.list('Petya')).invites).toHaveLength(1);
  });

  it('без сессии — 401 на всех новых маршрутах', async () => {
    const w = await world(['Vasya']);
    for (const url of ['/friends/privacy', `/friends/x/invite`, '/friends/invites/x/dismiss']) {
      expect((await w.app.inject({ method: 'POST', url, payload: {} })).statusCode).toBe(401);
    }
  });
});
