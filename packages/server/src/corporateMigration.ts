import type { Pool } from 'pg';
import { migrate } from './store';

/** Only corporate-owned records move. Matches, seating, inventory and rentals stay
 * in the game database. Run with corporate writes paused at the gateway. */
export const CORPORATE_TABLES = [
  'corps',
  'corp_members',
  'corp_audit',
  'corp_ready',
  'player_ready',
  'ava_challenges',
  'ava_roster',
  'ava_results',
  'ava_feed',
  'medals',
] as const;
// Identifiers are fixed literals. Only row data enters SQL parameters; source schema
// metadata never becomes executable SQL in the destination.
const COPY_SQL = {
  corps: {
    read: 'SELECT * FROM corps',
    count: 'SELECT count(*) AS n FROM corps',
    write: 'INSERT INTO corps SELECT * FROM json_populate_record(NULL::corps, $1::json)',
  },
  corp_members: {
    read: 'SELECT * FROM corp_members',
    count: 'SELECT count(*) AS n FROM corp_members',
    write:
      'INSERT INTO corp_members SELECT * FROM json_populate_record(NULL::corp_members, $1::json)',
  },
  corp_audit: {
    read: 'SELECT * FROM corp_audit',
    count: 'SELECT count(*) AS n FROM corp_audit',
    write: 'INSERT INTO corp_audit SELECT * FROM json_populate_record(NULL::corp_audit, $1::json)',
  },
  corp_ready: {
    read: 'SELECT * FROM corp_ready',
    count: 'SELECT count(*) AS n FROM corp_ready',
    write: 'INSERT INTO corp_ready SELECT * FROM json_populate_record(NULL::corp_ready, $1::json)',
  },
  player_ready: {
    read: 'SELECT * FROM player_ready',
    count: 'SELECT count(*) AS n FROM player_ready',
    write:
      'INSERT INTO player_ready SELECT * FROM json_populate_record(NULL::player_ready, $1::json)',
  },
  ava_challenges: {
    read: 'SELECT * FROM ava_challenges',
    count: 'SELECT count(*) AS n FROM ava_challenges',
    write:
      'INSERT INTO ava_challenges SELECT * FROM json_populate_record(NULL::ava_challenges, $1::json)',
  },
  ava_roster: {
    read: 'SELECT * FROM ava_roster',
    count: 'SELECT count(*) AS n FROM ava_roster',
    write: 'INSERT INTO ava_roster SELECT * FROM json_populate_record(NULL::ava_roster, $1::json)',
  },
  ava_results: {
    read: 'SELECT * FROM ava_results',
    count: 'SELECT count(*) AS n FROM ava_results',
    write:
      'INSERT INTO ava_results SELECT * FROM json_populate_record(NULL::ava_results, $1::json)',
  },
  ava_feed: {
    read: 'SELECT * FROM ava_feed',
    count: 'SELECT count(*) AS n FROM ava_feed',
    write: 'INSERT INTO ava_feed SELECT * FROM json_populate_record(NULL::ava_feed, $1::json)',
  },
  medals: {
    read: 'SELECT * FROM medals',
    count: 'SELECT count(*) AS n FROM medals',
    write: 'INSERT INTO medals SELECT * FROM json_populate_record(NULL::medals, $1::json)',
  },
} as const;
export async function migrateCorporations(
  source: Pool,
  destination: Pool,
  apply = false,
): Promise<Record<string, number>> {
  if (apply) await migrate(destination);
  const from = await source.connect(),
    to = await destination.connect().catch((error: unknown) => {
      from.release();
      throw error;
    });
  const counts: Record<string, number> = {};
  try {
    await from.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    await to.query('BEGIN');
    // Lock target tables against concurrent corporate writes during the import.
    if (apply)
      await to.query(
        'LOCK TABLE corps,corp_members,corp_audit,corp_ready,player_ready,ava_challenges,ava_roster,ava_results,ava_feed,medals IN EXCLUSIVE MODE',
      );
    for (const table of CORPORATE_TABLES) {
      const sql = COPY_SQL[table];
      const exists = (await to.query('SELECT to_regclass($1) AS name', [`public.${table}`])).rows[0]
        ?.name;
      if (exists && Number((await to.query(sql.count)).rows[0].n) !== 0)
        throw Error('E_CORPORATIONS_TARGET_NOT_EMPTY');
      const rows = await from.query<Record<string, unknown>>(sql.read);
      counts[table] = rows.rowCount ?? 0;
      if (!apply || rows.rows.length === 0) continue;
      for (const row of rows.rows) await to.query(sql.write, [JSON.stringify(row)]);
    }
    if (apply)
      await to.query(
        "SELECT setval(pg_get_serial_sequence('corp_audit','id'),COALESCE(MAX(id),1),MAX(id) IS NOT NULL) FROM corp_audit",
      );
    await to.query('COMMIT');
    await from.query('COMMIT');
    return counts;
  } catch (error) {
    await to.query('ROLLBACK').catch(() => undefined);
    await from.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    from.release();
    to.release();
  }
}
