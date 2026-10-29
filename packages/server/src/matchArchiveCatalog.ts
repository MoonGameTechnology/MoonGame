import type { Pool } from 'pg';
import type { AccountStore, MatchStore } from './store/types';
import type { ArchiveMetadata, ArchiveSummaryMetadata } from './matchArchiveMetadata';

export interface MatchArchiveCatalog {
  list(nick: string, since: number): Promise<ArchiveSummaryMetadata[]>;
}
export const ARCHIVE_CATALOG_LIMIT = 1000;

/** Memory/dev catalog: inspect small metadata only, never clone/load whole worlds. */
export class StoreArchiveCatalog implements MatchArchiveCatalog {
  constructor(private readonly store: MatchStore, private readonly accounts: AccountStore) {}
  async list(nick: string, since: number): Promise<ArchiveSummaryMetadata[]> {
    const ids = await this.store.endedMatchIds?.(since) ?? [];
    const owned: string[] = [];
    for (const id of ids) if (await this.accounts.seatOf(id, nick)) owned.push(id);
    const rows = await this.store.archiveMetadata?.(owned.slice(0, ARCHIVE_CATALOG_LIMIT), since) ?? [];
    return Promise.all(rows.map(async (row) => ({ ...row, seated: await this.accounts.occupiedSeats(row.matchId) })));
  }
}

/** The production query joins ownership and reads normalized, bounded metadata.
 * Neither listing nor restarting the host reads matches.state. */
export async function readArchiveMetadata(
  pool: Pick<Pool, 'query'>,
  scope: { since: number; nick: string } | { since: number; ids: readonly string[] },
): Promise<ArchiveSummaryMetadata[]> {
  if ('ids' in scope && scope.ids.length === 0) return [];
  const own = 'nick' in scope;
  // Keep both SQL statements literal. Ownership/ids and the result cap are bound
  // parameters; no query fragment or value is interpolated into SQL (SD-1.3).
  const sql = own
    ? `SELECT m.id, m.created_at, m.ended_at, m.archive_meta,
        (SELECT count(*)::int FROM seats occupied WHERE occupied.room=m.id) AS seated
      FROM matches m JOIN seats mine ON mine.room=m.id AND mine.nick=$2
      WHERE m.status='ended' AND m.ended_at>$1 AND m.archive_meta IS NOT NULL
      ORDER BY m.ended_at DESC, m.id LIMIT $3`
    : `SELECT m.id, m.created_at, m.ended_at, m.archive_meta,
        (SELECT count(*)::int FROM seats occupied WHERE occupied.room=m.id) AS seated
      FROM matches m
      WHERE m.status='ended' AND m.ended_at>$1 AND m.archive_meta IS NOT NULL
        AND m.id=ANY($2::text[])
      ORDER BY m.ended_at DESC, m.id LIMIT $3`;
  const result = await pool.query<{
    id: string; created_at: Date; ended_at: Date; archive_meta: ArchiveMetadata; seated: number;
  }>(sql, [new Date(scope.since), 'nick' in scope ? scope.nick : scope.ids, ARCHIVE_CATALOG_LIMIT]);
  return result.rows.map((row) => ({ ...row.archive_meta, matchId: row.id,
    createdAt: row.created_at.getTime(), endedAt: row.ended_at.getTime(), seated: row.seated }));
}
export class PostgresArchiveCatalog implements MatchArchiveCatalog {
  constructor(private readonly pool: Pool) {}
  list(nick: string, since: number): Promise<ArchiveSummaryMetadata[]> {
    return readArchiveMetadata(this.pool, { nick, since });
  }
}
