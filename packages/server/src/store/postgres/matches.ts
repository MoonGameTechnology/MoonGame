/** Postgres: партии и квитанции действий (SLIM-5). */
import {
  archiveMetadataOf,
  archiveStateBytes,
  type ArchiveSummaryMetadata,
} from '../../matchArchiveMetadata';
import { readArchiveMetadata } from '../../matchArchiveCatalog';
import { MAX_META_ACTIVITY_FACTS_PER_ROLE } from '../../metaEconomyActivity';
import type { Pool } from 'pg';
import type { MatchSnapshot, MatchStore, ReceiptStore, StoredReceipt } from '../types';

export interface MatchRow {
  id: string;
  data_version: string;
  seq: number;
  status: string;
  state: MatchSnapshot['state'];
  ruleset: MatchSnapshot['ruleset'] | null;
  clock: MatchSnapshot['clock'] | null;
  economy_observations: MatchSnapshot['economyObservations'] | null;
  economy_activity: MatchSnapshot['economyActivity'] | null;
  career: MatchSnapshot['career'] | null;
  match_reward_progress: MatchSnapshot['matchRewardProgress'] | null;
  created_at: Date;
  ended_at: Date | null;
}

export class PostgresMatchStore implements MatchStore {
  async hasPinnedMatches(): Promise<boolean> {
    const result = await this.pool.query<{ found: boolean }>('SELECT EXISTS(SELECT 1 FROM matches WHERE ruleset IS NOT NULL) AS found');
    return result.rows[0]!.found;
  }
  async economyMatchIds(after = '', limit = 100): Promise<string[]> {
    const size = Number.isSafeInteger(limit) ? Math.min(100, Math.max(1, limit)) : 100;
    const result = await this.pool.query<{ id: string }>(
      'SELECT id FROM matches WHERE id>$1 ORDER BY id LIMIT $2',
      [after, size],
    );
    return result.rows.map((row) => row.id);
  }
  constructor(private readonly pool: Pool) {}

  async ping(): Promise<boolean> {
    try {
      // This query is read-only: a client deadline can safely discard its response.
      // pg supports per-query deadlines, although @types/pg declares this option
      // only on ClientConfig. Keep the structural value rather than widening all queries.
      const probe = { text: 'SELECT 1', query_timeout: 1000 };
      await this.pool.query(probe);
      return true;
    } catch {
      return false; // pool exhausted / DB unreachable → not ready
    }
  }

  async load(matchId: string): Promise<MatchSnapshot | null> {
    const r = await this.pool.query<MatchRow>(
      `SELECT id, data_version, seq, status, state, clock, ruleset, economy_observations, economy_activity, career, match_reward_progress, created_at, ended_at FROM matches WHERE id = $1`,
      [matchId],
    );
    const row = r.rows[0];
    return this.snapshotFromRow(row);
  }

  async loadArchive(matchId: string, since: number, maxBytes: number): Promise<MatchSnapshot | null> {
    const r = await this.pool.query<MatchRow>(
      `SELECT id, data_version, seq, status, state, clock, ruleset, economy_observations, economy_activity, career, match_reward_progress, created_at, ended_at
       FROM matches WHERE id=$1 AND status='ended' AND ended_at>$2 AND archive_state_bytes<=$3`,
      [matchId, new Date(since), maxBytes],
    );
    return this.snapshotFromRow(r.rows[0]);
  }

  archiveMetadata(ids: readonly string[], since: number): Promise<ArchiveSummaryMetadata[]> {
    return readArchiveMetadata(this.pool, { ids, since });
  }

  private snapshotFromRow(row: MatchRow | undefined): MatchSnapshot | null {
    if (!row) return null;
    return {
      matchId: row.id,
      dataVersion: row.data_version,
      seq: row.seq,
      status: row.status === 'ended' ? 'ended' : 'ongoing',
      ...(row.created_at ? { createdAt: row.created_at.getTime() } : {}),
      ...(row.ended_at ? { endedAt: row.ended_at.getTime() } : {}),
      ...(row.career ? { career: row.career } : {}),
      ...(row.match_reward_progress ? { matchRewardProgress: row.match_reward_progress } : {}),
      ...(row.ruleset ? { ruleset: row.ruleset } : {}),
      state: row.state, // pg parses jsonb → JS object
      ...(row.clock ? { clock: row.clock } : {}),
      ...(row.economy_observations ? { economyObservations: row.economy_observations } : {}),
      ...(row.economy_activity ? { economyActivity: row.economy_activity } : {}),
    };
  }

  async save(snapshot: MatchSnapshot): Promise<void> {
    await this.saveUsing(this.pool, snapshot);
  }

  async saveWithReceipt(
    snapshot: MatchSnapshot,
    receipt: StoredReceipt,
    receipts: ReceiptStore,
  ): Promise<void> {
    if (!(receipts instanceof PostgresReceiptStore) || !receipts.sharesPool(this.pool))
      throw new Error('E_MATCH_COMMIT_BACKEND');
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const written = await this.saveUsing(client, snapshot);
      if (!written) throw new Error('E_MATCH_COMMIT_STALE');
      await receipts.saveUsing(client, snapshot.matchId, receipt);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  private async saveUsing(query: Pick<Pool, 'query'>, snapshot: MatchSnapshot): Promise<boolean> {
    // Optimistic by seq: only overwrite when our snapshot is at least as new as the
    // stored one (the WHERE on the upsert path drops a stale late write).
    const result = await query.query(
      `INSERT INTO matches (id, data_version, seq, status, state, clock, ruleset, economy_observations, economy_activity, career, ended_at, created_at, archive_meta, archive_state_bytes, match_reward_progress, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $16::jsonb, $7::jsonb, $8::jsonb, $10::jsonb, $11, COALESCE($12, now()), $13::jsonb, $14, $15::jsonb, now())
       ON CONFLICT (id) DO UPDATE SET
         data_version = EXCLUDED.data_version,
         seq          = EXCLUDED.seq,
         status       = EXCLUDED.status,
         state        = EXCLUDED.state,
         clock        = EXCLUDED.clock,
         ruleset      = COALESCE(matches.ruleset, EXCLUDED.ruleset),
         career       = EXCLUDED.career,
         match_reward_progress = COALESCE(EXCLUDED.match_reward_progress, matches.match_reward_progress),
         ended_at     = COALESCE(matches.ended_at, EXCLUDED.ended_at),
         archive_meta = EXCLUDED.archive_meta,
         archive_state_bytes = EXCLUDED.archive_state_bytes,
         economy_observations = CASE
           WHEN matches.economy_observations IS NULL AND EXCLUDED.economy_observations IS NULL THEN NULL
           ELSE COALESCE(EXCLUDED.economy_observations, '{}'::jsonb) || COALESCE(matches.economy_observations, '{}'::jsonb)
         END,
         economy_activity = CASE
           WHEN matches.economy_activity IS NULL AND EXCLUDED.economy_activity IS NULL THEN NULL
           ELSE COALESCE((
             SELECT jsonb_object_agg(tenure, ids) FROM (
               SELECT tenure, jsonb_agg(activity_id ORDER BY activity_rank) AS ids FROM (
                 SELECT tenure, activity_id, row_number() OVER(PARTITION BY tenure ORDER BY source, ordinal, activity_id) AS activity_rank
                 FROM (
                   SELECT DISTINCT ON(tenure, activity_id) tenure, activity_id, source, ordinal FROM (
                     SELECT entry.key AS tenure, activity.value AS activity_id, 0 AS source, activity.ordinality AS ordinal
                     FROM jsonb_each(COALESCE(matches.economy_activity, '{}'::jsonb)) AS entry
                     CROSS JOIN LATERAL jsonb_array_elements_text(entry.value) WITH ORDINALITY AS activity
                     UNION ALL
                     SELECT entry.key AS tenure, activity.value AS activity_id, 1 AS source, activity.ordinality AS ordinal
                     FROM jsonb_each(COALESCE(EXCLUDED.economy_activity, '{}'::jsonb)) AS entry
                     CROSS JOIN LATERAL jsonb_array_elements_text(entry.value) WITH ORDINALITY AS activity
                   ) AS all_activity ORDER BY tenure, activity_id, source, ordinal
                 ) AS distinct_activity
               ) AS ranked_activity WHERE activity_rank <= $9 GROUP BY tenure
             ) AS per_tenure
           ), '{}'::jsonb)
         END,
         updated_at   = now()
       WHERE matches.seq <= EXCLUDED.seq`,
      [
        snapshot.matchId,
        snapshot.dataVersion,
        snapshot.seq,
        snapshot.status,
        snapshot.state,
        snapshot.clock ?? null,
        snapshot.economyObservations ? JSON.stringify(snapshot.economyObservations) : null,
        snapshot.economyActivity
          ? JSON.stringify(
              Object.fromEntries(
                Object.entries(snapshot.economyActivity).map(([key, ids]) => [
                  key,
                  [...new Set(ids)].slice(0, MAX_META_ACTIVITY_FACTS_PER_ROLE),
                ]),
              ),
            )
          : null,
        MAX_META_ACTIVITY_FACTS_PER_ROLE,
        snapshot.career ? JSON.stringify(snapshot.career) : null,
        snapshot.status === 'ended' ? new Date(snapshot.endedAt ?? Date.now()) : null,
        snapshot.createdAt !== undefined ? new Date(snapshot.createdAt) : null,
        snapshot.status === 'ended' ? JSON.stringify(archiveMetadataOf(snapshot)) : null,
        snapshot.status === 'ended' ? archiveStateBytes(snapshot.state) : null,
        snapshot.matchRewardProgress ? JSON.stringify(snapshot.matchRewardProgress) : null,
        snapshot.ruleset ? JSON.stringify(snapshot.ruleset) : null,
      ],
    );
    return result.rowCount === 1;
  }

  async ongoingMatchIds(): Promise<string[]> {
    // Uses matches_status_idx — never touches the JSONB `state`.
    const r = await this.pool.query<{ id: string }>(
      `SELECT id FROM matches WHERE status = 'ongoing'`,
    );
    return r.rows.map((row) => row.id);
  }

  async endedMatchIds(since: number): Promise<string[]> {
    const r = await this.pool.query<{ id: string }>(
      `SELECT id FROM matches WHERE status = 'ended' AND ended_at > $1 ORDER BY ended_at DESC, id`,
      [new Date(since)],
    );
    return r.rows.map((row) => row.id);
  }
}

interface ReceiptRow {
  action_id: string;
  player_id: string;
  seq: number;
  ok: boolean;
  code: string | null;
}

export class PostgresReceiptStore implements ReceiptStore {
  constructor(private readonly pool: Pool) {}

  sharesPool(pool: Pool): boolean {
    return this.pool === pool;
  }

  async loadAll(matchId: string): Promise<StoredReceipt[]> {
    const r = await this.pool.query<ReceiptRow>(
      `SELECT action_id, player_id, seq, ok, code FROM receipts WHERE match_id = $1`,
      [matchId],
    );
    return r.rows.map((row) => ({
      actionId: row.action_id,
      playerId: row.player_id,
      seq: row.seq,
      ok: row.ok,
      ...(row.code !== null ? { code: row.code } : {}),
    }));
  }

  async save(matchId: string, receipt: StoredReceipt): Promise<void> {
    await this.saveUsing(this.pool, matchId, receipt);
  }

  /** Used by the paired match adapter with its transaction client. */
  async saveUsing(
    query: Pick<Pool, 'query'>,
    matchId: string,
    receipt: StoredReceipt,
  ): Promise<void> {
    // Receipts are immutable — first write wins; a re-save of the same action is a no-op.
    await query.query(
      `INSERT INTO receipts (match_id, action_id, player_id, seq, ok, code)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (match_id, action_id) DO NOTHING`,
      [matchId, receipt.actionId, receipt.playerId, receipt.seq, receipt.ok, receipt.code ?? null],
    );
  }
}
