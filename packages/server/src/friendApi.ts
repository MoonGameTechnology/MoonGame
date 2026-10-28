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
 *   POST /friends/privacy {hideMatches} FRIENDS-2: hide which matches I play from friends
 *   POST /friends/:id/invite {matchId}  FRIENDS-2: call a friend into a match I play
 *   POST /friends/invites/:id/dismiss   FRIENDS-2: drop the invites that friend sent me
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
 *
 * FRIENDS-2 — «войти к другу» and «позвать друга». A `match` presence carries the
 * match id, so the friends screen can offer «Войти» — unless the friend switched on
 * «скрывать мои партии»: then the server never sends the match at all (not even «в
 * матче»), and the row falls back to online/seen. Hiding is enforced HERE, not by the
 * client politely not drawing the button.
 *
 * Neither path grants a seat. Joining still goes through `GET /matches/:id/join` with
 * every gate it has (entry window, capacity, AvA roster): the id is only a way to find
 * the match, the same number any player can type into «Номер партии». An invite is
 * checked on the way IN — only an accepted friend, only into a match the inviter holds
 * a seat in — so nobody can use it to push arbitrary match ids at strangers. Invites
 * are kept in memory like the «seen» stamp: they are short-lived calls, not records.
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
  /** The match they are in (`match` only) — what «Войти» joins. */
  matchId?: string;
}

/** FRIENDS-2 · One pending call into a match, as the invited side sees it. */
export interface FriendInvite {
  fromId: string;
  fromLogin: string;
  matchId: string;
  /** Ms since it was sent. */
  agoMs: number;
}

/** How long an invite stays on the friend's screen. */
export const INVITE_TTL_MS = 30 * 60_000;
/** Pending invites one account can hold; the oldest goes first. */
const INVITES_PER_TARGET = 20;
/** Same alphabet and bound as a match number (`decisions/matchNumber.ts`). */
const MATCH_ID = /^[A-Za-z0-9-]{1,64}$/;

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
  /** Does this login hold a seat in this match? An invite is only valid into a match
   *  its sender plays. Absent ⇒ every invite is refused (fail-secure). */
  holdsSeat?(matchId: string, login: string): Promise<boolean>;
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

/** `E_NOT_SEATED` (FRIENDS-2): an invite into a match the sender has no seat in. */
type ApiErrorCode = FriendErrorCode | 'E_NOT_SEATED';

const STATUS: Record<ApiErrorCode, number> = {
  E_BAD_TARGET: 400,
  E_SELF: 400,
  E_NO_ACCOUNT: 404,
  E_NO_EDGE: 404,
  E_NOT_SEATED: 403,
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
  /** invited accountId → pending invites, oldest first. In memory on purpose (header). */
  const invites = new Map<string, { fromId: string; fromLogin: string; matchId: string; at: number }[]>();

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

  const failed = (reply: FastifyReply, code: ApiErrorCode): { error: ApiErrorCode } => {
    void reply.code(STATUS[code]);
    return { error: code };
  };

  const presenceOf = async (accountId: string, login: string): Promise<FriendPresence> => {
    // A friend who hides their matches is never looked up: not «в матче», not the id.
    const seat = (await service.hidesMatches(accountId)) ? null : await deps.matches?.seatOf(login);
    if (seat) return { kind: 'match', day: seat.days + 1, matchId: seat.matchId }; // day 1 is the first day
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
        // Presence is shown to FRIENDS only: a pending request is not yet a reason to
        // tell someone where you play.
        presence: e.kind === 'friend' ? await presenceOf(e.accountId, e.login) : { kind: 'unknown' },
      });
    }
    // Invites whose sender is still a friend and that have not gone stale.
    const friendIds = new Set(edges.filter((e) => e.kind === 'friend').map((e) => e.accountId));
    const t = now();
    const mine = (invites.get(who.accountId) ?? []).filter(
      (i) => friendIds.has(i.fromId) && t - i.at < INVITE_TTL_MS,
    );
    if (mine.length > 0) invites.set(who.accountId, mine);
    else invites.delete(who.accountId);
    const inviteRows: FriendInvite[] = mine.map((i) => ({
      fromId: i.fromId,
      fromLogin: i.fromLogin,
      matchId: i.matchId,
      agoMs: Math.max(0, t - i.at),
    }));
    return { rows, invites: inviteRows, hideMatches: await service.hidesMatches(who.accountId) };
  });

  app.post('/friends/privacy', async (request, reply) => {
    const who = await identified(request, reply);
    if (!who) return { error: 'E_UNAUTHORIZED' };
    if (rateLimited(request.ip)) {
      void reply.code(429);
      return { error: 'E_RATE_LIMITED' };
    }
    const body = (request.body ?? {}) as { hideMatches?: unknown };
    if (typeof body.hideMatches !== 'boolean') return failed(reply, 'E_BAD_TARGET');
    await service.setHidesMatches(who.accountId, body.hideMatches);
    return { ok: true };
  });

  app.post('/friends/:id/invite', async (request, reply) => {
    const who = await identified(request, reply);
    if (!who) return { error: 'E_UNAUTHORIZED' };
    if (rateLimited(request.ip)) {
      void reply.code(429);
      return { error: 'E_RATE_LIMITED' };
    }
    const { id } = request.params as { id: string };
    const body = (request.body ?? {}) as { matchId?: unknown };
    if (typeof body.matchId !== 'string' || !MATCH_ID.test(body.matchId)) {
      return failed(reply, 'E_BAD_TARGET');
    }
    const matchId = body.matchId;
    if (!(await service.areFriends(who.accountId, id))) return failed(reply, 'E_NO_EDGE');
    // Only into a match the sender actually plays — the invite is «иди ко мне».
    const seated = (await deps.matches?.holdsSeat?.(matchId, who.login)) ?? false;
    if (!seated) return failed(reply, 'E_NOT_SEATED');
    // One invite per sender: a repeat replaces the old one (newer match, fresh clock).
    const list = (invites.get(id) ?? []).filter((i) => i.fromId !== who.accountId);
    list.push({ fromId: who.accountId, fromLogin: who.login, matchId, at: now() });
    invites.set(id, list.slice(-INVITES_PER_TARGET));
    return { ok: true };
  });

  app.post('/friends/invites/:id/dismiss', async (request, reply) => {
    const who = await identified(request, reply);
    if (!who) return { error: 'E_UNAUTHORIZED' };
    const { id } = request.params as { id: string };
    const left = (invites.get(who.accountId) ?? []).filter((i) => i.fromId !== id);
    if (left.length > 0) invites.set(who.accountId, left);
    else invites.delete(who.accountId);
    return { ok: true };
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
