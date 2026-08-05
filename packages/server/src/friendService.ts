import type { FriendEdge, FriendParty, FriendStore, UserStore } from './store';

/**
 * FRIENDS-1 — the friend list: requests, acceptance, and the roster.
 *
 * The whole feature is a social graph plus five rules, all enforced HERE and never in
 * the client (invariant #5 / OWASP A01): the client asks and renders, the server
 * decides. Every failure is a stable `E_*` code with no detail (invariant #4 / A10) —
 * in particular, «no such callsign» and «that account already has an edge with you»
 * must not become an account-enumeration oracle for a stranger, so a request to a
 * callsign that does not exist reads exactly like one that does but is already linked.
 *
 * The rules:
 *  1. You cannot befriend yourself.
 *  2. The target must exist — resolved by CALLSIGN, because that is what a player
 *     types and the only handle they ever see. Lookup is case-insensitive (UserStore).
 *  3. One edge per pair, ever: a second request (either direction) or a request to an
 *     existing friend is `E_EXISTS`.
 *  4. Only the ASKED side may accept — the store's `accept` enforces it, so the rule
 *     survives even if a future caller forgets it.
 *  5. A roster cap, so the list stays a list and not a mailing target (A10 abuse).
 *
 * Deliberately NOT here: presence («онлайн», «в матче»). It is not a property of the
 * graph but of the live server, so it is computed at the API edge from the match
 * registry — see `friendApi.ts`. Keeping it out of the service is what lets the whole
 * of this file be pure rules over a store.
 */

export type FriendErrorCode =
  | 'E_BAD_TARGET'
  | 'E_SELF'
  | 'E_NO_ACCOUNT'
  | 'E_EXISTS'
  | 'E_NO_EDGE'
  | 'E_LIMIT';

export type FriendFail = { ok: false; code: FriendErrorCode };

/** How many accepted friends one account may hold. */
export const FRIEND_LIMIT = 100;

export interface FriendServiceDeps {
  friends: FriendStore;
  /** Accounts, for resolving a typed callsign to a real account (case-insensitive). */
  users: UserStore;
  /** Injectable clock (deterministic tests). */
  now?: () => number;
  /** Roster cap; injectable so a test does not have to add a hundred rows. */
  limit?: number;
}

export class FriendService {
  private readonly friends: FriendStore;
  private readonly users: UserStore;
  private readonly now: () => number;
  private readonly limit: number;

  constructor(deps: FriendServiceDeps) {
    this.friends = deps.friends;
    this.users = deps.users;
    this.now = deps.now ?? ((): number => Date.now());
    this.limit = deps.limit ?? FRIEND_LIMIT;
  }

  /** Everything the viewer's friends screen shows: accepted friends and both pending
   *  directions, each already presented from the viewer's side by the store. */
  async list(accountId: string): Promise<FriendEdge[]> {
    const edges = await this.friends.edgesOf(accountId);
    // Newest change first inside each group; the API groups, this only orders.
    return edges.sort((a, b) => b.at - a.at || (a.login < b.login ? -1 : a.login > b.login ? 1 : 0));
  }

  /** Ask a CALLSIGN to be friends. The typed string never reaches the store — it is
   *  resolved to an account first, so an edge can only ever point at a real one. */
  async request(who: FriendParty, callsign: string): Promise<{ ok: true } | FriendFail> {
    const typed = callsign.trim();
    if (!typed) return { ok: false, code: 'E_BAD_TARGET' };
    const target = await this.users.findUser(typed);
    if (!target) return { ok: false, code: 'E_NO_ACCOUNT' };
    if (target.userId === who.accountId) return { ok: false, code: 'E_SELF' };
    // The cap is checked on the ASKER only: accepting is what actually costs the
    // asked side a slot, and that is checked in `accept`.
    if (await this.atLimit(who.accountId)) return { ok: false, code: 'E_LIMIT' };
    const made = await this.friends.request(
      who,
      { accountId: target.userId, login: target.login },
      this.now(),
    );
    return made.ok ? { ok: true } : { ok: false, code: 'E_EXISTS' };
  }

  /** Accept an INCOMING request. `E_NO_EDGE` covers all three ways this can be wrong
   *  (no such edge, already accepted, or it is your own outgoing one) — one opaque
   *  code, because distinguishing them tells a caller about rows it cannot see. */
  async accept(accountId: string, otherId: string): Promise<{ ok: true } | FriendFail> {
    if (!otherId) return { ok: false, code: 'E_BAD_TARGET' };
    if (await this.atLimit(accountId)) return { ok: false, code: 'E_LIMIT' };
    const done = await this.friends.accept(accountId, otherId, this.now());
    return done.ok ? { ok: true } : { ok: false, code: 'E_NO_EDGE' };
  }

  /** Decline, withdraw, or unfriend — one operation, because all three mean «no edge
   *  between us». Either side may drop; there is nothing to gate. */
  async drop(accountId: string, otherId: string): Promise<{ ok: true } | FriendFail> {
    if (!otherId) return { ok: false, code: 'E_BAD_TARGET' };
    const done = await this.friends.drop(accountId, otherId);
    return done.ok ? { ok: true } : { ok: false, code: 'E_NO_EDGE' };
  }

  /** Accepted friends only — pending edges cost nothing until they are accepted. */
  private async atLimit(accountId: string): Promise<boolean> {
    const edges = await this.friends.edgesOf(accountId);
    return edges.filter((e) => e.kind === 'friend').length >= this.limit;
  }
}
