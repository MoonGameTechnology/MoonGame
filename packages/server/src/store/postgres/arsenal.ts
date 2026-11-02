/** Postgres: арсенал игрока и выпавшая добыча (SLIM-5). */
import type { Pool } from 'pg';
import type { ArsenalItem } from '@void/shared-core';
import type { ArsenalStore, DropStore, OwnedArsenalItem } from '../types';

interface ArsenalRow {
  item_id: string;
  account_id: string;
  kind: string;
  form: string;
  def_id: string;
  grade: number | null;
  soulbound: boolean;
  durability: number | null;
  origin: string;
  acquired_at: string;
}

function ownedItemOf(row: ArsenalRow): OwnedArsenalItem {
  return {
    itemId: row.item_id,
    accountId: row.account_id,
    kind: row.kind as ArsenalItem['kind'],
    form: row.form as ArsenalItem['form'],
    defId: row.def_id,
    ...(row.grade === null ? {} : { grade: row.grade }),
    soulbound: row.soulbound,
    ...(row.durability === null ? {} : { durability: row.durability }),
    origin: row.origin as ArsenalItem['origin'],
    acquiredAt: Number(row.acquired_at),
  };
}

const ARSENAL_COLS =
  'item_id, account_id, kind, form, def_id, grade, soulbound, durability, origin, acquired_at';

/** Postgres arsenal store (ARS-2). The PK makes `grant` idempotent (ON CONFLICT DO
 *  NOTHING — first write wins); transfer/consume are owner-guarded conditional writes,
 *  so a double-sell race and a soulbound move are impossible at the storage level. */
export class PostgresArsenalStore implements ArsenalStore {
  constructor(private readonly pool: Pick<Pool, 'query'>) {}

  async grant(item: OwnedArsenalItem): Promise<void> {
    await this.pool.query(
      // nosemgrep: no-sql-string-interpolation -- ARSENAL_COLS is a fixed column-list constant, not user input
      `INSERT INTO arsenal (${ARSENAL_COLS})
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT (item_id) DO NOTHING`,
      [
        item.itemId,
        item.accountId,
        item.kind,
        item.form,
        item.defId,
        item.grade ?? null,
        item.soulbound,
        item.durability ?? null,
        item.origin,
        item.acquiredAt,
      ],
    );
  }

  async get(itemId: string): Promise<OwnedArsenalItem | null> {
    const r = await this.pool.query<ArsenalRow>( // nosemgrep: no-sql-string-interpolation -- ARSENAL_COLS is a fixed column-list constant, not user input
      `SELECT ${ARSENAL_COLS} FROM arsenal WHERE item_id = $1`,
      [itemId],
    );
    return r.rows[0] ? ownedItemOf(r.rows[0]) : null;
  }

  async listOf(accountId: string): Promise<ArsenalItem[]> {
    const r = await this.pool.query<ArsenalRow>( // nosemgrep: no-sql-string-interpolation -- ARSENAL_COLS is a fixed column-list constant, not user input
      `SELECT ${ARSENAL_COLS} FROM arsenal WHERE account_id = $1
       ORDER BY kind, def_id, item_id`,
      [accountId],
    );
    return r.rows.map((row) => {
      const { accountId: _owner, ...item } = ownedItemOf(row);
      return item;
    });
  }

  async transfer(
    itemId: string,
    from: string,
    to: string,
  ): Promise<{ ok: true } | { ok: false; code: 'E_NOT_OWNER' | 'E_SOULBOUND' }> {
    // The conditional UPDATE is the invariant: only the current owner's, non-soulbound
    // item moves — atomically, so two racing buyers cannot both win.
    const r = await this.pool.query(
      `UPDATE arsenal SET account_id = $3
       WHERE item_id = $1 AND account_id = $2 AND NOT soulbound`,
      [itemId, from, to],
    );
    if ((r.rowCount ?? 0) > 0) return { ok: true };
    // Post-hoc classification only (the guard above already held the invariant).
    const row = await this.get(itemId);
    return row && row.accountId === from && row.soulbound
      ? { ok: false, code: 'E_SOULBOUND' }
      : { ok: false, code: 'E_NOT_OWNER' };
  }

  async consume(itemId: string, accountId: string): Promise<boolean> {
    const r = await this.pool.query(`DELETE FROM arsenal WHERE item_id = $1 AND account_id = $2`, [
      itemId,
      accountId,
    ]);
    return (r.rowCount ?? 0) > 0;
  }

  async wear(itemId: string, by: number): Promise<{ durability?: number } | null> {
    // Only an INSTANCE (durability IS NOT NULL) actually wears — a blueprint's row
    // stays NULL and the UPDATE simply changes nothing for it (still 1 row touched
    // if it exists, so we read the value back either way to report it honestly).
    const r = await this.pool.query<{ durability: number | null }>(
      `UPDATE arsenal SET durability = GREATEST(0, durability - $2)
       WHERE item_id = $1 AND durability IS NOT NULL
       RETURNING durability`,
      [itemId, by],
    );
    if (r.rows[0]) return { durability: r.rows[0].durability ?? undefined };
    const row = await this.get(itemId);
    if (!row) return null;
    return { durability: undefined }; // exists, but a blueprint — nothing to wear
  }
}

export class PostgresDropStore implements DropStore {
  constructor(private readonly pool: Pool) {}

  async claim(matchId: string, accountId: string): Promise<boolean> {
    // ON CONFLICT DO NOTHING + rowCount IS the exactly-once gate: only the first
    // inserter of the (match, account) pair proceeds to roll.
    const r = await this.pool.query(
      `INSERT INTO drop_claims (match_id, account_id) VALUES ($1, $2)
       ON CONFLICT DO NOTHING`,
      [matchId, accountId],
    );
    return (r.rowCount ?? 0) > 0;
  }

  async pityOf(accountId: string): Promise<number> {
    const r = await this.pool.query<{ pity: number }>(
      `SELECT pity FROM drop_meta WHERE account_id = $1`,
      [accountId],
    );
    return r.rows[0]?.pity ?? 0;
  }

  async setPity(accountId: string, value: number): Promise<void> {
    await this.pool.query(
      `INSERT INTO drop_meta (account_id, pity) VALUES ($1, $2)
       ON CONFLICT (account_id) DO UPDATE SET pity = $2`,
      [accountId, value],
    );
  }

  async stepPity(accountId: string, hit: boolean, pityAfter: number): Promise<number> {
    // The row lock is the atomicity: a second award pass for the same account waits
    // here and then reads the streak this one wrote, never the one it is replacing.
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO drop_meta (account_id) VALUES ($1) ON CONFLICT (account_id) DO NOTHING`,
        [accountId],
      );
      const r = await client.query<{ pity: number }>(
        `SELECT pity FROM drop_meta WHERE account_id = $1 FOR UPDATE`,
        [accountId],
      );
      const pity = r.rows[0]?.pity ?? 0;
      await client.query(`UPDATE drop_meta SET pity = $2 WHERE account_id = $1`, [
        accountId,
        hit || pity + 1 >= pityAfter ? 0 : pity + 1,
      ]);
      await client.query('COMMIT');
      return pity;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  }

  async addShards(accountId: string, delta: number): Promise<void> {
    // Atomic increment — two concurrent battle credits both land.
    await this.pool.query(
      `INSERT INTO drop_meta (account_id, shards) VALUES ($1, $2)
       ON CONFLICT (account_id) DO UPDATE SET shards = drop_meta.shards + $2`,
      [accountId, delta],
    );
  }

  async shardsOf(accountId: string): Promise<number> {
    const r = await this.pool.query<{ shards: number }>(
      `SELECT shards FROM drop_meta WHERE account_id = $1`,
      [accountId],
    );
    return r.rows[0]?.shards ?? 0;
  }
}
