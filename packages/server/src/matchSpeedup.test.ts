import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import type { Action, GameState } from '@void/shared-core';
import { MatchSovereignLedger } from './matchSovereigns';
import { readResourceOrder, readSpeedupOrder, registerMatchSpeedupApi, type SpeedupRoom } from './matchSpeedup';
import { MemoryMetaEconomyStore } from './metaEconomyStore';
import { MemoryMetaMarket } from './metaMarket';
import { createDevMatch, loadShippedData } from './scenario';
import { MemoryAccountStore, MemoryArsenalStore, MemoryDropStore } from './store';

/**
 * TEC-3.1: speeding up a queue for ◆ through the host route, against a real dev-match room
 * and the shipped value of time (10 ◆ per game hour, +10% per hour within a game day).
 * A day into the match the budget is (1.5 − 1) × 24 = 12 hours; green has just ordered a
 * factory (6 h).
 */
const data = loadShippedData();
const HOUR = 3_600_000;
const T0 = 1_000;
const apps: FastifyInstance[] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

type Submit = SpeedupRoom['submitServerAction'];

async function fixture(
  options: {
    sovereigns?: number;
    goldActions?: boolean;
    /** Wraps the room's submit: lets a test lose or fail the room's answer. */
    submit?: (real: Submit) => Submit;
    rateMax?: number;
  } = {},
) {
  let wall = T0;
  const seeded = createDevMatch(data, { id: 'm1', time: T0, now: () => wall }).state;
  if (options.goldActions === false) seeded.match.goldActions = false;
  const room = createDevMatch(data, { id: 'm1', time: T0, now: () => wall, initialState: seeded });
  wall = T0 + 24 * HOUR;
  const ordered = await room.submitServerAction('green', {
    id: 'order',
    type: 'building.construct',
    playerId: 'green',
    payload: { planetId: 'home_green', building: 'factory' },
    issuedAt: wall,
  });
  expect(ordered).toEqual({ ok: true });
  const order = () => room.state.scheduled.find((e) => e.type === 'construction.complete')!;
  const { seq, at } = order();

  const accounts = new MemoryAccountStore();
  await accounts.resolveSeat('m1', 'Pilot', ['green']);
  await accounts.resolveSeat('ghost', 'Pilot', ['green']);
  const arsenal = new MemoryArsenalStore();
  const store = new MemoryMetaEconomyStore(arsenal, new MemoryDropStore(), new MemoryMetaMarket(arsenal, () => 0));
  await store.transaction(['acc'], async (tx) => {
    tx.account('acc').sovereigns = options.sovereigns ?? 500;
  });
  const real: Submit = (playerId, action) => room.submitServerAction(playerId, action);
  const wrapped: SpeedupRoom = {
    get state(): GameState {
      return room.state;
    },
    liveContext: () => room.liveContext(),
    submitServerAction: options.submit ? options.submit(real) : real,
  };
  const app = Fastify();
  apps.push(app);
  registerMatchSpeedupApi(app, {
    ledger: new MatchSovereignLedger(store),
    identify: async (request) => {
      const login = request.headers['x-login'];
      if (login === 'Pilot') return { accountId: 'acc', login };
      if (login === 'Stranger') return { accountId: 'stranger', login };
      return null;
    },
    seatOf: (matchId, login) => accounts.seatOf(matchId, login),
    rooms: { get: (matchId) => (matchId === 'm1' ? wrapped : undefined) },
    ...(options.rateMax !== undefined ? { rateMax: options.rateMax } : {}),
  });
  const post = (body: Record<string, unknown>, login = 'Pilot', match = 'm1', path = 'speedup') =>
    app.inject({ method: 'POST', url: `/matches/${match}/${path}`, headers: { 'x-login': login }, payload: body });
  const balance = async () => (await store.read('acc')).sovereigns ?? 0;
  return { room, seq, at, order, post, balance };
}

const speed = (seq: number, hours: number, requestId = 'r1') => ({ requestId, kind: 'construction', seq, hours });

describe('POST /matches/:id/speedup (TEC-3.1)', () => {
  it('debits the core price and moves the order earlier', async () => {
    const f = await fixture();
    const res = await f.post(speed(f.seq, 2));
    // Two hours at +10%: 10 × (2 + 0.1 × 2²/2) = 22 ◆.
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, sovereigns: 22 });
    expect(await f.balance()).toBe(478);
    expect(f.order().at).toBe(f.at - 2 * HOUR);
    expect(f.room.state.players.green!.speedup).toMatchObject({ usedHours: 2, dayHours: 2 });
  });

  it('a retry of the same request replays the answer without a second debit', async () => {
    const f = await fixture();
    await f.post(speed(f.seq, 2));
    const again = await f.post(speed(f.seq, 2));
    expect(again.statusCode).toBe(200);
    expect(again.json()).toEqual({ ok: true, sovereigns: 22 });
    expect(await f.balance()).toBe(478);
    expect(f.order().at).toBe(f.at - 2 * HOUR);
  });

  it('the same request id with another order is a conflict', async () => {
    const f = await fixture();
    await f.post(speed(f.seq, 2));
    const other = await f.post(speed(f.seq, 3));
    expect([other.statusCode, other.json()]).toEqual([409, { error: 'E_IDEMPOTENCY_CONFLICT' }]);
    expect(await f.balance()).toBe(478);
    expect(f.order().at).toBe(f.at - 2 * HOUR);
  });

  it('too few ◆ — refused, nothing moves', async () => {
    const f = await fixture({ sovereigns: 5 });
    const res = await f.post(speed(f.seq, 2));
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ error: 'E_SOVEREIGNS' });
    expect(await f.balance()).toBe(5);
    expect(f.order().at).toBe(f.at);
  });

  it('over the K budget — refused before any ◆ move', async () => {
    const f = await fixture();
    const res = await f.post(speed(f.seq, 13));
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ error: 'E_SPEEDUP_BUDGET' });
    expect(await f.balance()).toBe(500);
  });

  it('a match without gold sells no speed-ups', async () => {
    const f = await fixture({ goldActions: false });
    const res = await f.post(speed(f.seq, 1));
    expect(res.json()).toEqual({ error: 'E_GOLD_OFF' });
    expect(await f.balance()).toBe(500);
  });

  it('the core refuses after the debit — the ◆ come back', async () => {
    const f = await fixture();
    const res = await f.post(speed(f.seq + 100, 1)); // no such order
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ error: 'E_NOT_ACTIVE', refunded: 11 });
    expect(await f.balance()).toBe(500);
    // The refusal is final for this request id.
    expect((await f.post(speed(f.seq + 100, 1))).json()).toEqual({ error: 'E_NOT_ACTIVE', refunded: 11 });
    expect(await f.balance()).toBe(500);
  });

  it('an unknown room answer settles nothing; the retry resolves it with one debit', async () => {
    let lost = true;
    const f = await fixture({
      submit: (real) => async (playerId, action) => {
        if (!lost) return real(playerId, action);
        lost = false;
        await real(playerId, action); // applied, but the answer is lost
        return { ok: false, code: 'E_INTERNAL' };
      },
    });
    const first = await f.post(speed(f.seq, 2));
    expect(first.statusCode).toBe(503);
    expect(first.json()).toEqual({ error: 'E_UNAVAILABLE' });
    expect(await f.balance()).toBe(478);
    const retry = await f.post(speed(f.seq, 2));
    expect(retry.json()).toEqual({ ok: true, sovereigns: 22 });
    expect(await f.balance()).toBe(478);
    expect(f.order().at).toBe(f.at - 2 * HOUR); // applied once
  });

  it('a failed room write settles nothing; the retry applies the order', async () => {
    let failing = true;
    const f = await fixture({
      submit: (real) => async (playerId, action) => {
        if (!failing) return real(playerId, action);
        failing = false;
        return { ok: false, code: 'E_UNAVAILABLE' };
      },
    });
    expect((await f.post(speed(f.seq, 2))).statusCode).toBe(503);
    expect(f.order().at).toBe(f.at);
    expect((await f.post(speed(f.seq, 2))).json()).toEqual({ ok: true, sovereigns: 22 });
    expect(await f.balance()).toBe(478);
    expect(f.order().at).toBe(f.at - 2 * HOUR);
  });

  it("the player's order limit refunds and says to retry later", async () => {
    const f = await fixture({ submit: () => async () => ({ ok: false, code: 'E_RATE_LIMIT' }) });
    const res = await f.post(speed(f.seq, 1));
    expect(res.statusCode).toBe(429);
    expect(res.json()).toEqual({ error: 'E_RATE_LIMIT', refunded: 11 });
    expect(await f.balance()).toBe(500);
  });

  it("one account's requests run one at a time, so each is priced on the world before it", async () => {
    // A durable room answers after its write: the first order is not applied yet while the
    // second one would be priced.
    const f = await fixture({
      submit: (real) => async (playerId, action) => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        return real(playerId, action);
      },
    });
    const [a, b] = await Promise.all([f.post(speed(f.seq, 1, 'a')), f.post(speed(f.seq, 1, 'b'))]);
    // 10 × 1.05 = 10.5 → 11; then 10 × (1 + 0.1 × 1.5) = 11.5 → 12.
    expect([a.json(), b.json()]).toEqual([
      { ok: true, sovereigns: 11 },
      { ok: true, sovereigns: 12 },
    ]);
    expect(await f.balance()).toBe(477);
    expect(f.order().at).toBe(f.at - 2 * HOUR);
  });

  it('no session — 401; no seat — 403; no such match — 404', async () => {
    const f = await fixture();
    expect((await f.post(speed(f.seq, 1), 'Nobody')).statusCode).toBe(401);
    const stranger = await f.post(speed(f.seq, 1), 'Stranger');
    expect([stranger.statusCode, stranger.json()]).toEqual([403, { error: 'E_FORBIDDEN' }]);
    const ghost = await f.post(speed(f.seq, 1), 'Pilot', 'ghost');
    expect([ghost.statusCode, ghost.json()]).toEqual([404, { error: 'E_NO_MATCH' }]);
    expect(await f.balance()).toBe(500);
  });

  it('a malformed order is 400', async () => {
    const f = await fixture();
    for (const body of [
      { ...speed(f.seq, 1), extra: 1 },
      { ...speed(f.seq, 1), hours: -1 },
      { ...speed(f.seq, 1), hours: 5000 },
      { requestId: 'r1', kind: 'construction', hours: 1 },
      { ...speed(f.seq, 1), kind: 'fleet' },
      { ...speed(f.seq, 1), requestId: '../x' },
    ]) {
      expect((await f.post(body)).statusCode).toBe(400);
    }
    expect(await f.balance()).toBe(500);
  });

  it('per-IP rate limit', async () => {
    const f = await fixture({ rateMax: 2 });
    await f.post(speed(f.seq, 1, 'a'));
    await f.post(speed(f.seq, 1, 'b'));
    expect((await f.post(speed(f.seq, 1, 'c'))).statusCode).toBe(429);
  });
});

describe('POST /matches/:id/resources (TEC-4)', () => {
  const buy = (resource: string, hours: number, requestId = 'b1') => ({ requestId, resource, hours });

  it('sells the hours of a resource at the speed-up price, from the same budget', async () => {
    const f = await fixture();
    const metal = f.room.state.players.green!.resources.metal ?? 0;
    const res = await f.post(buy('metal', 1), 'Pilot', 'm1', 'resources');
    // 1 ЭЧ of metal = 22 / 0.65 = 33.8 → 33; the first hour of the day costs 11 ◆.
    expect([res.statusCode, res.json()]).toEqual([200, { ok: true, sovereigns: 11 }]);
    expect(f.room.state.players.green!.resources.metal).toBe(metal + 33);
    expect(await f.balance()).toBe(489);
    // The next speed-up hour is the second one of the day.
    expect((await f.post(speed(f.seq, 1, 's1'))).json()).toEqual({ ok: true, sovereigns: 12 });
  });

  it('a resource outside the matrix is refused before any ◆ move', async () => {
    const f = await fixture();
    const res = await f.post(buy('biomass', 1), 'Pilot', 'm1', 'resources');
    expect([res.statusCode, res.json()]).toEqual([400, { error: 'E_BAD_REQUEST' }]);
    expect(await f.balance()).toBe(500);
  });

  it('one request id cannot pay for a speed-up and a purchase', async () => {
    const f = await fixture();
    await f.post(speed(f.seq, 1, 'same'));
    const res = await f.post(buy('metal', 1, 'same'), 'Pilot', 'm1', 'resources');
    expect([res.statusCode, res.json()]).toEqual([409, { error: 'E_IDEMPOTENCY_CONFLICT' }]);
    expect(await f.balance()).toBe(489);
  });

  it('reads only `{ requestId, resource, hours }`', () => {
    expect(readResourceOrder(buy('metal', 2))).toEqual({ requestId: 'b1', resource: 'metal', hours: 2 });
    expect(readResourceOrder({ ...buy('metal', 2), extra: 1 })).toBeNull();
    expect(readResourceOrder(buy('metal', 0))).toBeNull();
    expect(readResourceOrder(buy('../x', 1))).toBeNull();
  });
});

describe('readSpeedupOrder', () => {
  it('reads a construction or research order and nothing else', () => {
    expect(readSpeedupOrder({ requestId: 'r', kind: 'construction', seq: 3, hours: 1.5 })).toEqual({
      requestId: 'r',
      ref: { kind: 'construction', seq: 3 },
      hours: 1.5,
    });
    expect(readSpeedupOrder({ requestId: 'r', kind: 'research', technology: 'optics', hours: 2 })).toEqual({
      requestId: 'r',
      ref: { kind: 'research', technology: 'optics' },
      hours: 2,
    });
    expect(readSpeedupOrder({ requestId: 'r', kind: 'research', seq: 3, hours: 2 })).toBeNull();
    expect(readSpeedupOrder([])).toBeNull();
    expect(readSpeedupOrder(null)).toBeNull();
  });
});

/** Keeps the narrow room contract honest: the real room satisfies it. */
const _contract: (room: ReturnType<typeof createDevMatch>) => SpeedupRoom = (room) => room;
void _contract;
void (null as unknown as Action);
