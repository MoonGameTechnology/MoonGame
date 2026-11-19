/**
 * Speeding up a queue for Sovereigns ◆ (TEC-3.1, `docs/time-economy-roadmap.md`): the host
 * route `POST /matches/:id/speedup`.
 *
 * The core action `queue.speedup` is host-only (TEC-3): ◆ live on the account, outside the
 * match, so no client can send it. This route is the one way in. For the session's account
 * and its seat in the match it
 *
 * 1. prices the order with the core's own `speedupPrice` on the room's live context;
 * 2. debits that price under the request's receipt (`MatchSovereignLedger.spend`);
 * 3. submits `queue.speedup` carrying the price — the core re-checks it on its own world;
 * 4. records the room's verdict (`settle`): accepted keeps the ◆, refused returns them.
 *
 * A retry with the same `requestId` never debits twice: a settled request replays its
 * outcome; an unsettled one resumes at step 3 with the amount already taken, and the room's
 * receipt for the order's id says whether it was applied. When the room's answer is unknown
 * (its write failed, an unexpected throw) nothing is settled and the client gets
 * `E_UNAVAILABLE` (503): repeating the same request resolves it.
 *
 * Requests of one account run one at a time in this process. Two speed-ups priced off the
 * same world would leave the second one's price stale, and two copies of one request racing
 * to settle could record a refusal for an order the room applied.
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import {
  hasTimeValue,
  speedupLeftHours,
  speedupPrice,
  type Action,
  type Context,
  type GameState,
  type QueueRef,
} from '@void/shared-core';
import type { Identity } from './matchApi';
import { metaEconomyFingerprint } from './metaEconomy';
import type { MatchQuote, MatchReplay, MatchSovereignLedger } from './matchSovereigns';
import { slidingWindowIpLimiter } from './rateLimit';

/** What the route needs from a match room (`MatchRoom` satisfies it). */
export interface SpeedupRoom {
  readonly state: GameState;
  liveContext(): Context;
  submitServerAction(playerId: string, action: Action): Promise<{ ok: boolean; code?: string }>;
}

/** The host's rooms (`RoomRegistry` satisfies it): a hibernated match wakes for the order. */
export interface SpeedupRooms {
  get(matchId: string): SpeedupRoom | undefined;
  resolve?(matchId: string): Promise<SpeedupRoom | undefined>;
  release?(matchId: string): void;
}

export interface MatchSpeedupApiDeps {
  ledger: MatchSovereignLedger;
  identify(request: FastifyRequest): Promise<Identity | null>;
  /** The account's seat in the match (`AccountStore.seatOf`), by its login. */
  seatOf(matchId: string, login: string): Promise<string | null>;
  rooms: SpeedupRooms;
  now?: () => number;
  rateMax?: number;
}

interface SpeedupOrder {
  requestId: string;
  ref: QueueRef;
  hours: number;
}

interface Answer {
  status: number;
  body: Record<string, unknown>;
}

const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
/** Well past any real queue; the core refuses more than the queue has left anyway. */
const MAX_HOURS = 1000;
/** The room's answers that leave unknown whether the order was applied. */
const UNKNOWN = new Set(['E_UNAVAILABLE', 'E_INTERNAL']);

const id = (value: unknown): value is string => typeof value === 'string' && ID.test(value);

/** The body is the order and nothing else: `{ requestId, kind, seq | technology, hours }`. */
export function readSpeedupOrder(body: unknown): SpeedupOrder | null {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) return null;
  const b = body as Record<string, unknown>;
  const { requestId, kind, hours } = b;
  if (!id(requestId)) return null;
  if (typeof hours !== 'number' || !Number.isFinite(hours) || hours <= 0 || hours > MAX_HOURS)
    return null;
  const keys = Object.keys(b).sort().join(',');
  if (kind === 'construction' && keys === 'hours,kind,requestId,seq') {
    const seq = b.seq;
    if (typeof seq !== 'number' || !Number.isSafeInteger(seq) || seq < 0) return null;
    return { requestId, ref: { kind, seq }, hours };
  }
  if (kind === 'research' && keys === 'hours,kind,requestId,technology' && id(b.technology))
    return { requestId, ref: { kind, technology: b.technology }, hours };
  return null;
}

/** The price of a fresh order, or why the room would refuse it before any ◆ move. The
 *  core checks all of this again; checking here keeps doomed orders off the ledger. */
function quote(state: GameState, seat: string, hours: number, ctx: Context): MatchQuote {
  const def = ctx.data.timeValue;
  if (state.match.status === 'ended') return { ok: false, code: 'E_MATCH_ENDED' };
  if (!hasTimeValue(def)) return { ok: false, code: 'E_NOT_AVAILABLE' };
  if (state.match.goldActions === false) return { ok: false, code: 'E_GOLD_OFF' };
  if (hours > speedupLeftHours(state, seat, def, ctx) + 1e-9)
    return { ok: false, code: 'E_SPEEDUP_BUDGET' };
  return { ok: true, amount: speedupPrice(state, seat, hours, def, ctx) };
}

const refuse = (status: number, code: string): Answer => ({ status, body: { error: code } });

function answerOf(outcome: MatchReplay): Answer {
  if (outcome.ok) return { status: 200, body: { ok: true, sovereigns: outcome.amount } };
  if (!('refunded' in outcome)) return refuse(409, outcome.code);
  return {
    status: outcome.code === 'E_RATE_LIMIT' ? 429 : 409,
    body: { error: outcome.code, refunded: outcome.refunded },
  };
}

async function speedup(
  deps: MatchSpeedupApiDeps,
  who: Identity,
  matchId: string,
  order: SpeedupOrder,
): Promise<Answer> {
  const seat = await deps.seatOf(matchId, who.login);
  if (!seat) return refuse(403, 'E_FORBIDDEN');
  const request = {
    matchId,
    requestId: order.requestId,
    order: { seat, ...order.ref, hours: order.hours },
  };
  const settled = await deps.ledger.replay(who.accountId, request);
  if (settled) return answerOf(settled);
  const room = deps.rooms.get(matchId) ?? (await deps.rooms.resolve?.(matchId));
  if (!room) return refuse(404, 'E_NO_MATCH');
  try {
    const ctx = room.liveContext();
    const spent = await deps.ledger.spend(who.accountId, {
      ...request,
      quote: () => quote(room.state, seat, order.hours, ctx),
    });
    if (!spent.ok) return refuse(409, spent.code);
    const verdict = await room.submitServerAction(seat, {
      id: `speedup:${metaEconomyFingerprint([who.accountId, matchId, order.requestId]).slice(0, 32)}`,
      type: 'queue.speedup',
      playerId: seat,
      payload: { ...order.ref, hours: order.hours, price: spent.amount },
      issuedAt: ctx.now,
    });
    const code = verdict.ok ? undefined : (verdict.code ?? 'E_INTERNAL');
    if (code !== undefined && UNKNOWN.has(code)) return refuse(503, 'E_UNAVAILABLE');
    const outcome = await deps.ledger.settle(
      who.accountId,
      matchId,
      order.requestId,
      code === undefined ? { ok: true } : { ok: false, code },
    );
    return answerOf(outcome);
  } finally {
    deps.rooms.release?.(matchId);
  }
}

export function registerMatchSpeedupApi(app: FastifyInstance, deps: MatchSpeedupApiDeps): void {
  const limited = slidingWindowIpLimiter({
    now: deps.now ?? Date.now,
    max: deps.rateMax ?? 30,
    windowMs: 60_000,
    maxIps: 10_000,
  });
  const tails = new Map<string, Promise<unknown>>();
  const serial = <T>(key: string, work: () => Promise<T>): Promise<T> => {
    const run = (tails.get(key) ?? Promise.resolve()).then(work);
    const forget = (): void => {
      if (tails.get(key) === tail) tails.delete(key);
    };
    const tail: Promise<void> = run.then(forget, forget);
    tails.set(key, tail);
    return run;
  };
  app.post('/matches/:id/speedup', { bodyLimit: 1024 }, async (request, reply) => {
    reply.header('cache-control', 'no-store');
    if (limited(request.ip)) return reply.code(429).send({ error: 'E_RATE_LIMIT' });
    try {
      const who = await deps.identify(request);
      if (!who) return reply.code(401).send({ error: 'E_AUTH' });
      const matchId = (request.params as { id?: unknown }).id;
      const order = readSpeedupOrder(request.body);
      if (!id(matchId) || !order) return reply.code(400).send({ error: 'E_BAD_REQUEST' });
      const answer = await serial(who.accountId, () => speedup(deps, who, matchId, order));
      return reply.code(answer.status).send(answer.body);
    } catch {
      app.log.error({ code: 'E_UNAVAILABLE', requestId: request.id }, 'match speed-up failed');
      return reply.code(503).send({ error: 'E_UNAVAILABLE' });
    }
  });
}
