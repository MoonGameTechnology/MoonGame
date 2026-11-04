import { randomUUID } from 'node:crypto';
import { afterAll, expect } from 'vitest';
import { Pool } from 'pg';

// Server suites perform DDL and deliberate fault injection. Sharing one database
// makes a different file's migrate() deadlock otherwise valid DML or trip its timer.
const original = process.env.DATABASE_URL;
const path = expect.getState().testPath;
if (original && path?.replaceAll('\\', '/').includes('/packages/server/')) {
  const admin = new Pool({ connectionString: original, max: 1 });
  const database = `vd_vitest_${randomUUID().replaceAll('-', '')}`;
  const target = new URL(original);
  target.pathname = `/${database}`;
  const create = await admin.query<{ sql: string }>('SELECT format($1::text,$2::text) AS sql', [
    'CREATE DATABASE %I',
    database,
  ]);
  try {
    await admin.query(create.rows[0]!.sql);
  } catch (error) {
    await admin.end();
    throw error;
  }
  process.env.DATABASE_URL = target.toString();
  afterAll(async () => {
    process.env.DATABASE_URL = original;
    try {
      if (!/^vd_vitest_[a-f0-9]{32}$/.test(database)) throw new Error('E_TEST_DATABASE');
      // Pool.end() can resolve before PostgreSQL observes the TCP closes. Never
      // terminate those sockets: an idle client's FATAL would escape its test.
      for (let attempt = 0; ; attempt++) {
        const { rows } = await admin.query<{ n: number }>(
          'SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname=$1',
          [database],
        );
        if (rows[0]!.n === 0) break;
        if (attempt >= 40) throw new Error('E_TEST_DATABASE_BUSY');
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      const drop = await admin.query<{ sql: string }>('SELECT format($1::text,$2::text) AS sql', [
        'DROP DATABASE %I',
        database,
      ]);
      await admin.query(drop.rows[0]!.sql);
    } finally {
      await admin.end();
    }
  }, 30_000);
}
