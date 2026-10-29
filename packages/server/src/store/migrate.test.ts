/**
 * `migrate` retries a schema attempt Postgres aborted as a deadlock (40P01): the advisory
 * lock serializes migrations, but not the schema's DDL against another session's DML on
 * the same tables. A fake pool stands in for Postgres, so this runs without a database.
 */
import { describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { migrate } from './postgres';

/** A pool whose schema statement fails with `errors[n]` on the n-th attempt. */
function fakePool(errors: Array<{ code?: string; message: string }>) {
  const log: string[] = [];
  let attempt = 0;
  const client = {
    query: async (sql: string) => {
      if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') log.push(sql);
      else if (sql.startsWith('SELECT pg_advisory_xact_lock')) log.push('lock');
      else {
        log.push('schema');
        const error = errors[attempt++];
        if (error) throw Object.assign(new Error(error.message), error);
      }
      return {};
    },
    release: () => void log.push('release'),
  };
  return { pool: { connect: async () => client } as unknown as Pool, log };
}

const deadlock = { code: '40P01', message: 'deadlock detected' };

describe('migrate', () => {
  it('retries an attempt aborted as a deadlock and commits the next one', async () => {
    const { pool, log } = fakePool([deadlock]);
    await migrate(pool);
    expect(log).toEqual([
      'BEGIN',
      'lock',
      'schema',
      'ROLLBACK',
      'release',
      'BEGIN',
      'lock',
      'schema',
      'COMMIT',
      'release',
    ]);
  });

  it('gives up after the third deadlock', async () => {
    const { pool, log } = fakePool([deadlock, deadlock, deadlock]);
    await expect(migrate(pool)).rejects.toMatchObject({ code: '40P01' });
    expect(log.filter((step) => step === 'schema')).toHaveLength(3);
  });

  it('does not retry any other error', async () => {
    const { pool, log } = fakePool([{ code: '42P07', message: 'relation already exists' }]);
    await expect(migrate(pool)).rejects.toMatchObject({ code: '42P07' });
    expect(log.filter((step) => step === 'schema')).toHaveLength(1);
  });
});
