/** Postgres: друзья (SLIM-5). */
import type { Pool } from 'pg';
import type { FriendEdge, FriendParty, FriendStore } from '../types';

interface FriendRow {
  lo_id: string;
  hi_id: string;
  lo_login: string;
  hi_login: string;
  requested_by: string;
  accepted: boolean;
  changed_at: string;
}

/** FRIENDS-1 · Durable social graph. Same one-row-per-pair model as the memory store
 *  (see {@link FriendStore}); the canonical sort happens here, not in the service. */
export class PostgresFriendStore implements FriendStore {
  constructor(private readonly pool: Pool) {}

  /** Canonical order: the pair is stored sorted, so lookups never need both directions. */
  private static pair(x: FriendParty, y: FriendParty): { lo: FriendParty; hi: FriendParty } {
    return x.accountId < y.accountId ? { lo: x, hi: y } : { lo: y, hi: x };
  }

  async edgesOf(accountId: string): Promise<FriendEdge[]> {
    const r = await this.pool.query<FriendRow>(
      `SELECT lo_id, hi_id, lo_login, hi_login, requested_by, accepted, changed_at
         FROM friend_edges WHERE lo_id = $1 OR hi_id = $1`,
      [accountId],
    );
    return r.rows.map((row) => {
      const mineIsLo = row.lo_id === accountId;
      return {
        accountId: mineIsLo ? row.hi_id : row.lo_id,
        login: mineIsLo ? row.hi_login : row.lo_login,
        kind: row.accepted ? 'friend' : row.requested_by === accountId ? 'outgoing' : 'incoming',
        at: Number(row.changed_at),
      } satisfies FriendEdge;
    });
  }

  async request(
    from: FriendParty,
    to: FriendParty,
    at: number,
  ): Promise<{ ok: true } | { ok: false; code: 'E_EXISTS' }> {
    const { lo, hi } = PostgresFriendStore.pair(from, to);
    // ON CONFLICT DO NOTHING is the fail-secure form: an existing pair (pending either
    // way, or accepted) is never overwritten — it reports as E_EXISTS.
    const r = await this.pool.query(
      `INSERT INTO friend_edges (lo_id, hi_id, lo_login, hi_login, requested_by, accepted, changed_at)
       VALUES ($1, $2, $3, $4, $5, false, $6)
       ON CONFLICT (lo_id, hi_id) DO NOTHING`,
      [lo.accountId, hi.accountId, lo.login, hi.login, from.accountId, at],
    );
    return (r.rowCount ?? 0) > 0 ? { ok: true } : { ok: false, code: 'E_EXISTS' };
  }

  async accept(
    accountId: string,
    otherId: string,
    at: number,
  ): Promise<{ ok: true } | { ok: false; code: 'E_NO_EDGE' }> {
    const [lo, hi] = accountId < otherId ? [accountId, otherId] : [otherId, accountId];
    // The WHERE clause IS the rule: pending, and asked by the OTHER side.
    const r = await this.pool.query(
      `UPDATE friend_edges SET accepted = true, changed_at = $3
        WHERE lo_id = $1 AND hi_id = $2 AND accepted = false AND requested_by <> $4`,
      [lo, hi, at, accountId],
    );
    return (r.rowCount ?? 0) > 0 ? { ok: true } : { ok: false, code: 'E_NO_EDGE' };
  }

  async drop(
    accountId: string,
    otherId: string,
  ): Promise<{ ok: true } | { ok: false; code: 'E_NO_EDGE' }> {
    const [lo, hi] = accountId < otherId ? [accountId, otherId] : [otherId, accountId];
    const r = await this.pool.query(`DELETE FROM friend_edges WHERE lo_id = $1 AND hi_id = $2`, [
      lo,
      hi,
    ]);
    return (r.rowCount ?? 0) > 0 ? { ok: true } : { ok: false, code: 'E_NO_EDGE' };
  }

  async hidesMatches(accountId: string): Promise<boolean> {
    const r = await this.pool.query<{ hide_matches: boolean }>(
      `SELECT hide_matches FROM friend_privacy WHERE account_id = $1`,
      [accountId],
    );
    return r.rows[0]?.hide_matches ?? false;
  }

  async setHidesMatches(accountId: string, hide: boolean): Promise<void> {
    await this.pool.query(
      `INSERT INTO friend_privacy (account_id, hide_matches) VALUES ($1, $2)
       ON CONFLICT (account_id) DO UPDATE SET hide_matches = EXCLUDED.hide_matches`,
      [accountId, hide],
    );
  }
}
