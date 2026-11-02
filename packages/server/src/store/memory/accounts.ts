/** В памяти: аккаунты, командиры и учётки игроков (SLIM-5). */
import { reservedBotLogin } from '../../botNicknames';
import { randomUUID } from 'node:crypto';
import type { PlayerId } from '@void/shared-core';
import type { AccountStore, CommanderStore, SeatAssignment, UserRecord, UserStore } from '../types';

/** In-memory seat map — `room → nick → side`. */
export class MemoryAccountStore implements AccountStore {
  private readonly rooms = new Map<string, Map<string, PlayerId>>();
  /** Seat-lock ticket hashes — `room → nick → sha256(ticket)` (REL-5). */
  private readonly tickets = new Map<string, Map<string, string>>();

  resolveSeat(
    room: string,
    nick: string,
    seats: readonly PlayerId[],
    preferred?: PlayerId,
  ): Promise<SeatAssignment | null> {
    let byNick = this.rooms.get(room);
    if (!byNick) {
      byNick = new Map();
      this.rooms.set(room, byNick);
    }
    const existing = byNick.get(nick);
    if (existing) return Promise.resolve({ playerId: existing, isNew: false });
    const taken = new Set(byNick.values());
    // Preferred slot: use it if it exists and is free (REL-7 seat selection).
    if (preferred && seats.includes(preferred) && !taken.has(preferred)) {
      byNick.set(nick, preferred);
      return Promise.resolve({ playerId: preferred, isNew: true });
    }
    const free = seats.find((s) => !taken.has(s));
    if (!free) return Promise.resolve(null); // room full
    byNick.set(nick, free);
    return Promise.resolve({ playerId: free, isNew: true });
  }

  seatOf(room: string, nick: string): Promise<PlayerId | null> {
    return Promise.resolve(this.rooms.get(room)?.get(nick) ?? null);
  }

  bindSeatTicket(room: string, nick: string, ticketHash: string): Promise<string | null> {
    if (!this.rooms.get(room)?.has(nick)) return Promise.resolve(null); // no seat → nothing to lock
    let byNick = this.tickets.get(room);
    if (!byNick) {
      byNick = new Map();
      this.tickets.set(room, byNick);
    }
    const existing = byNick.get(nick);
    if (existing !== undefined) return Promise.resolve(existing); // first bind wins
    byNick.set(nick, ticketHash);
    return Promise.resolve(ticketHash);
  }

  seatTicket(room: string, nick: string): Promise<string | null> {
    return Promise.resolve(this.tickets.get(room)?.get(nick) ?? null);
  }

  resetSeatTicket(room: string, nick: string): Promise<void> {
    this.tickets.get(room)?.delete(nick);
    return Promise.resolve();
  }

  releaseSeat(room: string, nick: string): Promise<PlayerId | null> {
    const seat = this.rooms.get(room)?.get(nick) ?? null;
    if (seat === null) return Promise.resolve(null);
    this.rooms.get(room)?.delete(nick);
    // Билет уходит вместе с местом: оставленный хэш запер бы кресло для того, кто
    // сядет в него следующим (`bindSeatTicket` — «первый связавший выигрывает»).
    this.tickets.get(room)?.delete(nick);
    return Promise.resolve(seat);
  }

  occupiedSeats(room: string): Promise<number> {
    return Promise.resolve(this.rooms.get(room)?.size ?? 0);
  }

  seatedNicks(room: string): Promise<Array<{ playerId: PlayerId; nick: string }>> {
    const byNick = this.rooms.get(room);
    if (!byNick) return Promise.resolve([]);
    return Promise.resolve([...byNick].map(([nick, playerId]) => ({ playerId, nick })));
  }
}

/** In-memory commander XP (EC-*): a lifetime-XP tally per account plus the set of
 *  already-credited matchIds for idempotency. Loses everything on restart — the
 *  Postgres store is the durable one; this serves tests and the no-DB dev run. */
export class MemoryCommanderStore implements CommanderStore {
  private readonly xp = new Map<string, number>();
  private readonly credited = new Set<string>();

  creditMatch(
    matchId: string,
    rows: ReadonlyArray<{ accountId: string; xp: number }>,
  ): Promise<boolean> {
    if (this.credited.has(matchId)) return Promise.resolve(false);
    this.credited.add(matchId);
    for (const { accountId, xp } of rows) {
      if (xp > 0) this.xp.set(accountId, (this.xp.get(accountId) ?? 0) + xp);
    }
    return Promise.resolve(true);
  }

  xpOf(accountId: string): Promise<number> {
    return Promise.resolve(this.xp.get(accountId) ?? 0);
  }

  topXp(limit: number): Promise<Array<{ accountId: string; xp: number }>> {
    return Promise.resolve(this.ranked().slice(0, Math.max(0, limit)));
  }

  standingOf(accountId: string): Promise<{ rank: number | null; xp: number; total: number }> {
    const all = this.ranked();
    const xp = this.xp.get(accountId);
    // Ties SHARE a rank — the index in the sorted array would give «я такой-то по
    // счёту», which for equal XP depends on the tiebreaker and reads as unfair.
    const rank = xp === undefined ? null : all.filter((r) => r.xp > xp).length + 1;
    return Promise.resolve({ rank, xp: xp ?? 0, total: all.length });
  }

  /** XP desc, then accountId asc — a stable order, so equal rows don't shuffle. */
  private ranked(): Array<{ accountId: string; xp: number }> {
    return [...this.xp]
      .map(([accountId, xp]) => ({ accountId, xp }))
      .sort((a, b) => b.xp - a.xp || (a.accountId < b.accountId ? -1 : 1));
  }
}

/** In-memory user store — accounts keyed by lower-cased login (case-insensitive). */
export class MemoryUserStore implements UserStore {
  private readonly byLogin = new Map<string, UserRecord>();

  private readonly deletionRequests = new Map<string, string>();
  deletionStatus(accountId: string, requestId: string): Promise<boolean> {
    return Promise.resolve(this.deletionRequests.get(accountId) === requestId);
  }
  requestDeletion(user: UserRecord, requestId: string = randomUUID()): Promise<string | null> {
    const rec = this.byLogin.get(user.login.toLowerCase());
    if (!rec || rec.userId !== user.userId || rec.deletionRequestedAt ||
        rec.passHash !== user.passHash || rec.sessionNonce !== user.sessionNonce)
      return Promise.resolve(null);
    this.deletionRequests.set(user.userId, requestId);
    rec.deletionRequestedAt = new Date().toISOString();
    rec.sessionNonce = requestId;
    return Promise.resolve(requestId);
  }

  createUser(
    login: string,
    passHash: string,
    email?: string,
  ): Promise<
    { ok: true; userId: string } | { ok: false; code: 'E_LOGIN_TAKEN' | 'E_EMAIL_TAKEN' }
  > {
    const key = login.toLowerCase();
    if (reservedBotLogin(login) || this.byLogin.has(key))
      return Promise.resolve({ ok: false, code: 'E_LOGIN_TAKEN' });
    const mail = email?.toLowerCase();
    if (mail && this.byEmail(mail)) return Promise.resolve({ ok: false, code: 'E_EMAIL_TAKEN' });
    const userId = randomUUID();
    this.byLogin.set(key, { userId, login, passHash, registrationReward: true, ...(mail ? { email: mail } : {}) });
    return Promise.resolve({ ok: true, userId });
  }

  findUser(login: string): Promise<UserRecord | null> {
    const user = this.byLogin.get(login.toLowerCase());
    return Promise.resolve(user && !user.deletionRequestedAt ? user : null);
  }

  findUserByEmail(email: string): Promise<UserRecord | null> {
    const user = this.byEmail(email.toLowerCase());
    return Promise.resolve(user && !user.deletionRequestedAt ? user : null);
  }

  findById(userId: string): Promise<UserRecord | null> {
    for (const rec of this.byLogin.values()) {
      if (rec.userId === userId && !rec.deletionRequestedAt) return Promise.resolve(rec);
    }
    return Promise.resolve(null);
  }

  loginsOf(userIds: readonly string[]): Promise<Record<string, string>> {
    const want = new Set(userIds);
    const out: Record<string, string> = {};
    for (const rec of this.byLogin.values()) if (want.has(rec.userId) && !rec.deletionRequestedAt) out[rec.userId] = rec.login;
    return Promise.resolve(out);
  }

  revokeSessions(userId: string): Promise<void> {
    for (const rec of this.byLogin.values()) {
      if (rec.userId === userId) rec.sessionNonce = randomUUID();
    }
    return Promise.resolve();
  }

  setPassword(userId: string, passHash: string): Promise<void> {
    for (const rec of this.byLogin.values()) {
      if (rec.userId === userId) rec.passHash = passHash;
    }
    return Promise.resolve();
  }

  setPasswordIfCurrent(userId: string, expectedHash: string, passHash: string): Promise<boolean> {
    for (const rec of this.byLogin.values()) {
      if (rec.userId === userId && rec.passHash === expectedHash && !rec.deletionRequestedAt) {
        rec.passHash = passHash;
        return Promise.resolve(true);
      }
    }
    return Promise.resolve(false);
  }

  private byEmail(mail: string): UserRecord | null {
    for (const rec of this.byLogin.values()) if (rec.email === mail) return rec;
    return null;
  }
}
