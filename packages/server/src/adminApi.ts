import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { PlayerId } from '@void/shared-core';
import type { Identity } from './matchApi';

/**
 * ADM-1 — the operator's command surface over a live playtest: see who is actually
 * sitting in a match, and take a seat back from someone who should not hold it.
 *
 *   GET  /admin/whoami                 → { login, admin: true }
 *   GET  /admin/matches/:id/roster     → who holds each seat, and who is online
 *   POST /admin/matches/:id/kick       → { nick } — free that seat
 *
 * Why this exists at all: a seat becomes permanent the moment its player reaches the
 * map (`seatClaim.ts`, rule 6 — and that promise is what `seat.release` refuses to
 * break). It is the right promise for a player and the wrong one for a host running a
 * session with real people in it: one griefer, or one commander who claimed a chair
 * and never came back, otherwise costs the whole match a restart. So the power to undo
 * it is NAMED, narrow and attributable rather than absent.
 *
 * Four decisions carry that:
 *
 * 1. **An admin is an ACCOUNT, not a shared secret.** Authority is a login listed in
 *    `admins`; the caller proves it with the same session every other account route
 *    takes, re-checked against the current password. A bearer token in an env var
 *    would have been less code and worse: it names nobody in the log, it cannot be
 *    revoked without a restart, and it has to be pasted into a browser to be used.
 *    A password reset revokes admin access for free, because it revokes the session.
 * 2. **Empty list ⇒ the routes DO NOT EXIST.** No admins configured is not «anyone
 *    may» and not «a 403 door»: nothing is mounted at all (fail-secure, invariant #4).
 *    A deployment that never sets `ADMIN_LOGINS` has no admin surface to attack.
 * 3. **The kick names a PERSON, the answer names a SEAT.** The admin picks a nick from
 *    the roster; the reply says which chair came free. Addressing the seat instead
 *    would let a stale roster kick whoever happens to sit there now — the classic
 *    read-then-act race, with a real person on the wrong end of it.
 * 4. **A kick frees the chair; it does not delete the empire.** The side stays on the
 *    map (its planets and fleets belong to the world, not to the person), so play
 *    continues under the absent-player AI and the freed chair is claimable again.
 *    Erasing a mid-match empire would rewrite everyone else's game, not just the
 *    kicked player's.
 */

/** One row of the admin roster: a seat, who holds it, and whether they are online. */
export interface AdminSeatRow {
  playerId: PlayerId;
  /** The side's in-world name (from the map), never the account's. */
  name: string;
  faction: string;
  /** Account holding the seat, or null when the chair is free. ADMIN-ONLY: the public
   *  seats route deliberately shows `taken`, not who. */
  nick: string | null;
  /** The player reached the map (`seat.confirm`) — the seat is theirs until a kick. */
  seated: boolean;
  /** A socket is open for this seat right now. */
  connected: boolean;
}

export interface AdminRoster {
  matchId: string;
  /** Whole days of world time elapsed — the roster's «how far in are we». */
  day: number;
  ended: boolean;
  /** The entry window is still open (a newcomer may take a freed chair). */
  entryOpen: boolean;
  seats: AdminSeatRow[];
}

/** Refusals the host's `kick` may return; everything else is an internal error. */
export type AdminKickRefusal = 'E_NO_MATCH' | 'E_NOT_SEATED' | 'E_INTERNAL';

export interface AdminApiDeps {
  /** Resolve the caller from the session token — REQUIRED, no anonymous fallback. */
  identify(request: FastifyRequest): Promise<Identity | null>;
  /** Logins with command authority. Empty ⇒ nothing is mounted (decision 2). */
  admins: ReadonlySet<string>;
  /** The match's seats, or null when there is no such match. */
  roster(matchId: string): Promise<AdminRoster | null>;
  /** Free `nick`'s seat in `matchId`: core action, store unbind, socket close. */
  kick(
    matchId: string,
    nick: string,
  ): Promise<{ ok: true; playerId: PlayerId; closed: number } | { ok: false; code: AdminKickRefusal }>;
}

/**
 * Admin logins from a comma/space-separated env value (`ADMIN_LOGINS=alice, bob`).
 *
 * Lower-cased because account logins dedup case-insensitively in the stores: an admin
 * listed as «Alice» must not lose their authority by signing in as «alice». Blank
 * entries are dropped, so a trailing comma is not an empty-string admin — an env typo
 * must never widen the set (fail-secure), only ever narrow it.
 */
export function adminLoginsFromEnv(raw: string | undefined): ReadonlySet<string> {
  return new Set(
    (raw ?? '')
      .split(/[,\s]+/)
      .map((s) => s.trim().toLowerCase())
      .filter((s) => s !== ''),
  );
}

/** Does this login command? Case-insensitive, mirroring how logins dedup (see above). */
export function isAdmin(login: string, admins: ReadonlySet<string>): boolean {
  return admins.has(login.toLowerCase());
}

/** HTTP status for a refusal — kept beside the codes so both hosts answer alike. */
const KICK_STATUS: Record<AdminKickRefusal, number> = {
  E_NO_MATCH: 404,
  E_NOT_SEATED: 409,
  E_INTERNAL: 500,
};

export function registerAdminApi(app: FastifyInstance, deps: AdminApiDeps): void {
  // Decision 2: no admins ⇒ no admin surface. Not a 403 door — no door.
  if (deps.admins.size === 0) return;

  /** The calling admin, or null once the reply has been filled with the refusal. */
  const commander = async (
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<Identity | null> => {
    const who = await deps.identify(request);
    if (!who) {
      void reply.code(401);
      void reply.send({ error: 'E_UNAUTHORIZED' as const });
      return null;
    }
    if (!isAdmin(who.login, deps.admins)) {
      void reply.code(403);
      void reply.send({ error: 'E_FORBIDDEN' as const });
      return null;
    }
    return who;
  };

  // Lets the admin client tell «wrong password» from «this account has no authority»
  // without guessing from a failed roster read.
  app.get('/admin/whoami', async (request, reply) => {
    const who = await commander(request, reply);
    if (!who) return reply;
    return { login: who.login, admin: true as const };
  });

  app.get('/admin/matches/:id/roster', async (request, reply) => {
    const who = await commander(request, reply);
    if (!who) return reply;
    const { id } = request.params as { id: string };
    const roster = await deps.roster(id);
    if (!roster) {
      void reply.code(404);
      return { error: 'E_NO_MATCH' as const };
    }
    return roster;
  });

  app.post('/admin/matches/:id/kick', async (request, reply) => {
    const who = await commander(request, reply);
    if (!who) return reply;
    const { id } = request.params as { id: string };
    const nick = (request.body as { nick?: unknown } | null)?.nick;
    if (typeof nick !== 'string' || nick.trim() === '') {
      void reply.code(400);
      return { error: 'E_BAD_REQUEST' as const };
    }
    const result = await deps.kick(id, nick.trim());
    if (!result.ok) {
      void reply.code(KICK_STATUS[result.code]);
      return { error: result.code };
    }
    // Attributable by construction (decision 1): the log names who did it to whom.
    process.stderr.write(
      `[admin] ${who.login} kicked ${nick.trim()} from match ${id} (seat ${result.playerId})\n`,
    );
    return { ok: true as const, playerId: result.playerId, closed: result.closed };
  });
}
