import { describe, expect, it } from 'vitest';
import Fastify from 'fastify';
import {
  registerMatchApi,
  registerSeatsApi,
  type JoinFailure,
  type MatchApiDeps,
  type SeatView,
  type SeatsApiDeps,
} from './matchApi';

// SV-2.4 — the create/join HTTP routes. The route layer maps the deps' results to HTTP;
// the deps (seed a match, resolve a seat, mint a token) are wired in main.ts.

function appWith(deps: MatchApiDeps) {
  const app = Fastify();
  registerMatchApi(app, deps);
  return app;
}

const denyJoin: MatchApiDeps['join'] = () => Promise.resolve({ error: 'E_NO_MATCH' });

describe('SV-2.4 · match API', () => {
  it('POST /matches creates a match and returns its id + seats', async () => {
    const app = appWith({
      createMatch: () => Promise.resolve({ matchId: 'm-1', seats: ['green', 'red'] }),
      join: denyJoin,
    });
    const res = await app.inject({ method: 'POST', url: '/matches' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ matchId: 'm-1', seats: ['green', 'red'] });
    await app.close();
  });

  it('GET /matches/:id/join returns a seat + token for a nick', async () => {
    const app = appWith({
      createMatch: () => Promise.resolve({ matchId: 'm-1', seats: [] }),
      join: (matchId, { nick }) => Promise.resolve({ playerId: 'green', token: `tok:${matchId}:${nick}` }),
    });
    const res = await app.inject({ method: 'GET', url: '/matches/m-1/join?nick=alice' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ playerId: 'green', token: 'tok:m-1:alice' });
    await app.close();
  });

  // ADDR-2/ENTRY-4: выбор с экрана входа едет в АДРЕСЕ, а роут обязан донести его до
  // резолвера мест. Цепочка «ссылка → клиент → роут → заявка» была собрана с обоих концов
  // и не проверена ни разу посередине: клиент `sci` не переносил вовсе, а этот разбор не
  // покрывал ни один тест.
  it('доносит выбор из адреса до резолвера: место, дом и совет учёных', async () => {
    let seen: unknown = null;
    const app = appWith({
      createMatch: () => Promise.resolve({ matchId: 'm-1', seats: [] }),
      join: (_matchId, req) => {
        seen = req;
        return Promise.resolve({ playerId: 'p2', token: 'tok' });
      },
    });
    const res = await app.inject({
      method: 'GET',
      url: '/matches/m-1/join?nick=alice&slot=p2&faction=azure&sci=overseer,polymath',
    });
    expect(res.statusCode).toBe(200);
    expect(seen).toMatchObject({
      preferredSlot: 'p2',
      preferredFaction: 'azure',
      preferredScientists: ['overseer', 'polymath'],
    });
    await app.close();
  });

  it('пустой sci — это «не выбирал», а не «выбрал пусто»', async () => {
    const seen: Array<Record<string, unknown>> = [];
    const app = appWith({
      createMatch: () => Promise.resolve({ matchId: 'm-1', seats: [] }),
      join: (_matchId, req) => {
        seen.push(req as unknown as Record<string, unknown>);
        return Promise.resolve({ playerId: 'p2', token: 'tok' });
      },
    });
    await app.inject({ method: 'GET', url: '/matches/m-1/join?nick=alice&sci=' });
    expect(seen[0]).not.toHaveProperty('preferredScientists');
    await app.close();
  });

  it('rejects a join with no nick (400)', async () => {
    const app = appWith({
      createMatch: () => Promise.resolve({ matchId: 'm', seats: [] }),
      join: denyJoin,
    });
    const res = await app.inject({ method: 'GET', url: '/matches/m-1/join' });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'E_NICK_REQUIRED' });
    await app.close();
  });

  it('maps join failures to stable statuses', async () => {
    const cases: Array<[JoinFailure['error'], number]> = [
      ['E_NO_MATCH', 404],
      ['E_MATCH_FULL', 409],
      ['E_NOT_ROSTERED', 403],
      ['E_ENTRY_CLOSED', 403],
      ['E_AUTH_DISABLED', 501],
    ];
    for (const [error, status] of cases) {
      const app = appWith({
        createMatch: () => Promise.resolve({ matchId: 'm', seats: [] }),
        join: () => Promise.resolve({ error }),
      });
      const res = await app.inject({ method: 'GET', url: '/matches/m/join?nick=a' });
      expect(res.statusCode, error).toBe(status);
      expect(res.json()).toEqual({ error });
      await app.close();
    }
  });

  it('omitting createMatch leaves POST /matches unmounted, but join still serves', async () => {
    // A host that seeds matches out of band (netserver, NETA2-7) exposes join alone.
    const app = appWith({
      join: (matchId, { nick }) => Promise.resolve({ playerId: 'green', token: `tok:${matchId}:${nick}` }),
    });
    expect((await app.inject({ method: 'POST', url: '/matches' })).statusCode).toBe(404); // not mounted
    const res = await app.inject({ method: 'GET', url: '/matches/m/join?nick=a' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ playerId: 'green', token: 'tok:m:a' });
    await app.close();
  });

  it('rate-limits create+join per IP over a shared window (429 past the cap)', async () => {
    const app = appWith({
      createMatch: () => Promise.resolve({ matchId: 'm', seats: [] }),
      join: (_matchId, nick) => Promise.resolve({ playerId: 'green', token: `tok:${nick}` }),
      now: () => 1_000, // frozen clock → all attempts fall in one window
      rateMax: 2, // create+join share the budget
    });
    // Two attempts pass (one create, one join), the third is throttled.
    expect((await app.inject({ method: 'POST', url: '/matches' })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/matches/m/join?nick=a' })).statusCode).toBe(200);
    const throttled = await app.inject({ method: 'POST', url: '/matches' });
    expect(throttled.statusCode).toBe(429);
    expect(throttled.json()).toEqual({ error: 'E_RATE_LIMIT' });
    await app.close();
  });

  it('a fresh window clears the throttle', async () => {
    let clock = 0;
    const app = appWith({
      createMatch: () => Promise.resolve({ matchId: 'm', seats: [] }),
      join: denyJoin,
      now: () => clock,
      rateMax: 1,
      rateWindowMs: 1_000,
    });
    expect((await app.inject({ method: 'POST', url: '/matches' })).statusCode).toBe(200);
    expect((await app.inject({ method: 'POST', url: '/matches' })).statusCode).toBe(429);
    clock = 1_000; // window elapsed → budget refills
    expect((await app.inject({ method: 'POST', url: '/matches' })).statusCode).toBe(200);
    await app.close();
  });
});

// ADDR-6 — the seat layout is pre-join browsing for a match you may still enter (REL-7),
// and intel about strangers' homeworlds for one you may not. The route tells those apart.

/** Two seats, one of them free — a match a newcomer could still join. */
const SEATS: SeatView[] = [
  { playerId: 'p1', name: 'alice', faction: 'solar', start: 'planet-1', taken: true },
  { playerId: 'p2', name: '', faction: 'void', start: 'planet-2', taken: false },
];

/** Every seat claimed — nothing left to browse for, whatever the entry window says. */
const FULL: SeatView[] = SEATS.map((s) => ({ ...s, taken: true }));

function seatsApp(deps: Partial<SeatsApiDeps> = {}) {
  const app = Fastify();
  registerSeatsApi(app, {
    seats: () => Promise.resolve({ seats: SEATS, ended: false }),
    entryOpen: () => true,
    seatOf: (_matchId, login) => Promise.resolve(login === 'alice' ? 'p1' : null),
    ...deps,
  });
  return app;
}

/** An `identify` hook that trusts a bare `?as=` — a stand-in for a verified session. */
const identifyAs: SeatsApiDeps['identify'] = (request) => {
  const who = (request.query as { as?: string }).as;
  return Promise.resolve(who ? { accountId: `acct:${who}`, login: who } : null);
};

describe('ADDR-6 · seat layout API', () => {
  it('serves an open match to an anonymous caller (REL-7 pre-join picking)', async () => {
    const app = seatsApp();
    const res = await app.inject({ method: 'GET', url: '/matches/m-1/seats' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ seats: SEATS });
    await app.close();
  });

  it('refuses an unauthenticated request for a running match by its id', async () => {
    // The heart of the hole: knowing a match id is not a right to read it. The id is
    // public (it rides in the `?join=` deep link and the open-matches feed), so an
    // anonymous `curl` used to lift every player's faction AND homeworld out of a
    // session it had no part in — intel `visibleState()` keeps behind fog in game.
    const app = seatsApp({ entryOpen: () => false });
    const res = await app.inject({ method: 'GET', url: '/matches/m-1/seats' });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ error: 'E_FORBIDDEN' });
    expect(res.body).not.toContain('planet-1'); // no layout leaks alongside the refusal
    await app.close();
  });

  it('serves a running match to a player who holds a seat in it', async () => {
    // A seated player re-entering their own session goes through the picker too, so
    // closing the hole must not lock them out of their own match.
    const app = seatsApp({ entryOpen: () => false, identify: identifyAs });
    const res = await app.inject({ method: 'GET', url: '/matches/m-1/seats?as=alice' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ seats: SEATS });
    await app.close();
  });

  it('refuses a running match to a logged-in stranger', async () => {
    // Authenticated is not the same as entitled: a valid session with no seat here
    // is exactly the account-path version of the anonymous reader above.
    const app = seatsApp({ entryOpen: () => false, identify: identifyAs });
    const res = await app.inject({ method: 'GET', url: '/matches/m-1/seats?as=mallory' });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ error: 'E_FORBIDDEN' });
    await app.close();
  });

  it('treats a full match as closed even inside its entry window', async () => {
    // «Open for entry» means a chair is actually claimable. A full session is one
    // nobody may enter, so its layout is intel like any other running match's.
    const app = seatsApp({
      seats: () => Promise.resolve({ seats: FULL, ended: false }),
      entryOpen: () => true,
    });
    expect((await app.inject({ method: 'GET', url: '/matches/m-1/seats' })).statusCode).toBe(403);
    await app.close();
  });

  it('treats an ended match as closed even inside its entry window', async () => {
    const app = seatsApp({
      seats: () => Promise.resolve({ seats: SEATS, ended: true }),
      entryOpen: () => true,
    });
    expect((await app.inject({ method: 'GET', url: '/matches/m-1/seats' })).statusCode).toBe(403);
    await app.close();
  });

  it('reports an unknown match as E_NO_MATCH (404)', async () => {
    const app = seatsApp({ seats: () => Promise.resolve(null) });
    const res = await app.inject({ method: 'GET', url: '/matches/nope/seats' });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: 'E_NO_MATCH' });
    await app.close();
  });

  it('without `identify`, falls back to the `?nick=` seat check', async () => {
    // The nick host has no authentication at all, so this is participation, not proof —
    // the same posture `registerBrowserApi`'s archive intents already take. It keeps a
    // seated player's own running session readable where sessions do not exist.
    const app = seatsApp({ entryOpen: () => false });
    expect(
      (await app.inject({ method: 'GET', url: '/matches/m-1/seats?nick=alice' })).statusCode,
    ).toBe(200);
    expect(
      (await app.inject({ method: 'GET', url: '/matches/m-1/seats?nick=mallory' })).statusCode,
    ).toBe(403);
    await app.close();
  });

  it('ignores a blank or repeated nick rather than reading it as a seat holder', async () => {
    // `?nick=&nick=` parses to an array, `?nick=` to '' — both are «no nick given»,
    // and neither may reach `seatOf` as a login (fail-secure, like the join route).
    const seatOf: SeatsApiDeps['seatOf'] = (_m, login) =>
      Promise.resolve(login === '' ? 'p1' : null); // a store that would answer '' → seat
    const app = seatsApp({ entryOpen: () => false, seatOf });
    expect((await app.inject({ method: 'GET', url: '/matches/m/seats?nick=' })).statusCode).toBe(403);
    expect(
      (await app.inject({ method: 'GET', url: '/matches/m/seats?nick=a&nick=b' })).statusCode,
    ).toBe(403);
    await app.close();
  });
});
