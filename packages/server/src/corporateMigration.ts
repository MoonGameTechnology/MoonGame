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
    if (apply) await to.query(`LOCK TABLE ${CORPORATE_TABLES.join(',')} IN EXCLUSIVE MODE`);
    for (const table of CORPORATE_TABLES) {
      const exists = (await to.query('SELECT to_regclass($1) AS name', [`public.${table}`])).rows[0]
        ?.name;
      if (exists && Number((await to.query(`SELECT count(*) AS n FROM ${table}`)).rows[0].n) !== 0)
        throw Error('E_CORPORATIONS_TARGET_NOT_EMPTY');
      const rows = await from.query<Record<string, unknown>>(`SELECT * FROM ${table}`);
      counts[table] = rows.rowCount ?? 0;
      if (!apply || rows.rows.length === 0) continue;
      const columns = rows.fields.map((field) => field.name);
      const names = columns.map((name) => `"${name.replaceAll('"', '""')}"`).join(',');
      const placeholders = columns.map((_, i) => `$${i + 1}`).join(',');
      for (const row of rows.rows)
        await to.query(
          `INSERT INTO ${table}(${names}) VALUES(${placeholders})`,
          columns.map((name) => row[name]),
        );
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
