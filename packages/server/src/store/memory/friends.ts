/** В памяти: друзья (SLIM-5). */
import type { FriendEdge, FriendParty, FriendStore } from '../types';

/**
 * FRIENDS-1 · In-memory social graph — one row per pair, keyed canonically.
 *
 * The key is the sorted pair, so «A→B» and «B→A» can never become two rows; the
 * asking side lives in the row (`by`), which is what lets one row read as `incoming`
 * on one screen and `outgoing` on the other.
 */
export class MemoryFriendStore implements FriendStore {
  private readonly rows = new Map<
    string,
    { a: FriendParty; b: FriendParty; by: string; accepted: boolean; at: number }
  >();

  private static key(x: string, y: string): string {
    return x < y ? `${x}\u0000${y}` : `${y}\u0000${x}`;
  }

  edgesOf(accountId: string): Promise<FriendEdge[]> {
    const out: FriendEdge[] = [];
    for (const row of this.rows.values()) {
      const mine = row.a.accountId === accountId ? row.a : row.b.accountId === accountId ? row.b : null;
      if (!mine) continue;
      const other = mine === row.a ? row.b : row.a;
      out.push({
        accountId: other.accountId,
        login: other.login,
        kind: row.accepted ? 'friend' : row.by === accountId ? 'outgoing' : 'incoming',
        at: row.at,
      });
    }
    return Promise.resolve(out);
  }

  request(
    from: FriendParty,
    to: FriendParty,
    at: number,
  ): Promise<{ ok: true } | { ok: false; code: 'E_EXISTS' }> {
    const key = MemoryFriendStore.key(from.accountId, to.accountId);
    if (this.rows.has(key)) return Promise.resolve({ ok: false, code: 'E_EXISTS' as const });
    this.rows.set(key, { a: from, b: to, by: from.accountId, accepted: false, at });
    return Promise.resolve({ ok: true as const });
  }

  accept(
    accountId: string,
    otherId: string,
    at: number,
  ): Promise<{ ok: true } | { ok: false; code: 'E_NO_EDGE' }> {
    const row = this.rows.get(MemoryFriendStore.key(accountId, otherId));
    // Only a PENDING edge someone else opened can be accepted — never your own.
    if (!row || row.accepted || row.by === accountId) {
      return Promise.resolve({ ok: false, code: 'E_NO_EDGE' as const });
    }
    row.accepted = true;
    row.at = at;
    return Promise.resolve({ ok: true as const });
  }

  drop(accountId: string, otherId: string): Promise<{ ok: true } | { ok: false; code: 'E_NO_EDGE' }> {
    const key = MemoryFriendStore.key(accountId, otherId);
    if (!this.rows.delete(key)) return Promise.resolve({ ok: false, code: 'E_NO_EDGE' as const });
    return Promise.resolve({ ok: true as const });
  }

  /** FRIENDS-2 · accounts that hide their matches from friends. */
  private readonly hiding = new Set<string>();

  hidesMatches(accountId: string): Promise<boolean> {
    return Promise.resolve(this.hiding.has(accountId));
  }

  setHidesMatches(accountId: string, hide: boolean): Promise<void> {
    if (hide) this.hiding.add(accountId);
    else this.hiding.delete(accountId);
    return Promise.resolve();
  }
}
