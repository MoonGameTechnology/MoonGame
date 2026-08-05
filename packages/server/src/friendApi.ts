import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { FriendErrorCode, FriendService } from './friendService';
import type { Identity } from './matchApi';
import { slidingWindowIpLimiter } from './rateLimit';

/**
 * FRIENDS-1 — the friend list HTTP API. Session-gated on every route: the acting
 * identity comes from the session, NEVER from the payload, so the API is only
 * registered on auth-enabled servers (same shape as the corp API).
 *
 *   GET  /friends                    my roster: friends + both pending directions,
 *                                    each row carrying its live presence
 *   POST /friends/request  {callsign} ask a callsign to be friends
 *   POST /friends/:id/accept          accept an incoming request
 *   POST /friends/:id/drop            decline · withdraw · unfriend (one operation)
 *
 * PRESENCE is computed here rather than in the service on purpose: «в матче · день 3»
 * is a property of the LIVE server, not of the social graph — it is read from the
 * match registry at request time and never stored. What the API can honestly say:
 *
 *  · `match` — the friend holds a seat in a live match right now (with its day);
 *  · `online` — their client called this API within {@link ONLINE_MS};
 *  · `seen` — the last time it did, when that was longer ago;
 *  · `unknown` — never seen since this process started.
 *
 * The «seen» stamp is per-process and in memory: it is a courtesy, not a fact worth
 * a database round-trip, and this server is single-process by design (multi-process
 * scale is an explicit later brick). A restart therefore resets it to `unknown` —
 * which reads as «нет данных», not as a false «офлайн».
 */

/** How fresh a stamp must be to read as «онлайн». */
export const ONLINE_MS = 2 * 60_000;

export type PresenceKind = 'match' | 'online' | 'seen' | 'unknown';

export interface FriendPresence {
  kind: PresenceKind;
  /** In-game day of the match they are in (`match` only). */
  day?: number;
  /** Ms since they were last seen (`seen` only). */
  agoMs?: number;
}

/** One row of the friends screen: the edge plus how to read its owner right now. */
export interface FriendRow {
  accountId: string;
  login: string;
  kind: 'friend' | 'incoming' | 'outgoing';
  presence: FriendPresence;
}

/** What the API needs to know about live matches — a narrow port, so the friends
 *  feature does not depend on the whole registry (and a test can hand it two rows). */
export interface MatchPresenceSource {
  /** Which live match this login holds a seat in, with its in-game day; null if none. */
  seatOf(login: string): Promise<{ matchId: string; days: number } | null>;
}

export interface FriendApiDeps {
  service: FriendService;
  /** Resolve the caller from the session token — REQUIRED, no anonymous fallback. */
  identify(request: FastifyRequest): Promise<Identity | null>;
  /** Live-match lookup for presence. Absent ⇒ presence never reports `match`. */
  matches?: MatchPresenceSource;
  now?: () => number;
  rateMax?: number;
  rateWindowMs?: number;
}

const STATUS: Record<FriendErrorCode, number> = {
  E_BAD_TARGET: 400,
  E_SELF: 400,
  E_NO_ACCOUNT: 404,
  E_NO_EDGE: 404,
  E_EXISTS: 409,
  E_LIMIT: 409,
};

/** Social writes are a spam surface — same per-IP budget as the corp API. */
const RATE_MAX = 30;
const RATE_WINDOW_MS = 60_000;
const RATE_MAX_IPS = 10_000;

export function registerFriendApi(app: FastifyInstance, deps: FriendApiDeps): void {
  const service = deps.service;
  const now = deps.now ?? ((): number => Date.now());
  const rateLimited = slidingWindowIpLimiter({
    now,
    max: deps.rateMax ?? RATE_MAX,
    windowMs: deps.rateWindowMs ?? RATE_WINDOW_MS,
    maxIps: RATE_MAX_IPS,
  });
  /** accountId → last time that account's client called this API. Bounded by the
   *  account count of a live process; a restart clears it (see the file header). */
  const seen = new Map<string, number>();

  const identified = async (
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<Identity | null> => {
    const who = await deps.identify(request);
    if (!who) {
      void reply.code(401);
      return null;
    }
    seen.set(who.accountId, now()); // any authenticated call IS the presence signal
    return who;
  };

  const failed = (reply: FastifyReply, code: FriendErrorCode): { error: FriendErrorCode } => {
    void reply.code(STATUS[code]);
    return { error: code };
  };

  const presenceOf = async (accountId: string, login: string): Promise<FriendPresence> => {
    const seat = await deps.matches?.seatOf(login);
    if (seat) return { kind: 'match', day: seat.days + 1 }; // day 1 is the first day
    const at = seen.get(accountId);
    if (at === undefined) return { kind: 'unknown' };
    const ago = Math.max(0, now() - at);
    return ago <= ONLINE_MS ? { kind: 'online' } : { kind: 'seen', agoMs: ago };
  };

  app.get('/friends', async (request, reply) => {
    const who = await identified(request, reply);
    if (!who) return { error: 'E_UNAUTHORIZED' };
    const edges = await service.list(who.accountId);
    const rows: FriendRow[] = [];
    for (const e of edges) {
      rows.push({
        accountId: e.accountId,
        login: e.login,
        kind: e.kind,
        presence: await presenceOf(e.accountId, e.login),
      });
    }
    return { rows };
  });

  app.post('/friends/request', async (request, reply) => {
    const who = await identified(request, reply);
    if (!who) return { error: 'E_UNAUTHORIZED' };
    if (rateLimited(request.ip)) {
      void reply.code(429);
      return { error: 'E_RATE_LIMITED' };
    }
    const body = (request.body ?? {}) as { callsign?: unknown };
    if (typeof body.callsign !== 'string') return failed(reply, 'E_BAD_TARGET');
    const r = await service.request(who, body.callsign);
    return r.ok ? { ok: true } : failed(reply, r.code);
  });

  app.post('/friends/:id/accept', async (request, reply) => {
    const who = await identified(request, reply);
    if (!who) return { error: 'E_UNAUTHORIZED' };
    if (rateLimited(request.ip)) {
      void reply.code(429);
      return { error: 'E_RATE_LIMITED' };
    }
    const { id } = request.params as { id: string };
    const r = await service.accept(who.accountId, id);
    return r.ok ? { ok: true } : failed(reply, r.code);
  });

  app.post('/friends/:id/drop', async (request, reply) => {
    const who = await identified(request, reply);
    if (!who) return { error: 'E_UNAUTHORIZED' };
    if (rateLimited(request.ip)) {
      void reply.code(429);
      return { error: 'E_RATE_LIMITED' };
    }
    const { id } = request.params as { id: string };
    const r = await service.drop(who.accountId, id);
    return r.ok ? { ok: true } : failed(reply, r.code);
  });
}
