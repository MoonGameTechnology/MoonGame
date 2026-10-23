import { describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { build } from 'esbuild';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { migrate, PostgresUserStore } from './store/postgres';
import { metaEconomyFingerprint as fingerprint } from './metaEconomy';

const base = process.env.DATABASE_URL;
const execute = promisify(execFile);
describe.skipIf(!base)('account erasure executable on a shared game/corporation database', () => {
  it('shares its maintenance pool while still refusing an unrelated idle runtime client', async () => {
    const name = `erasure_cli_${randomUUID().replaceAll('-', '')}`;
    const admin = new Pool({ connectionString: base, max: 1 });
    await mkdir(resolve('packages/server/dist'), { recursive: true });
    const dir = await mkdtemp(resolve('packages/server/dist/erasure-cli-'));
    const url = new URL(base!); url.pathname = `/${name}`;
    let pool: Pool | undefined;
    let created = false;
    try {
      await admin.query(`CREATE DATABASE "${name}"`); created = true;
      pool = new Pool({ connectionString: url.href, max: 1 });
      await migrate(pool);
      const store = new PostgresUserStore(pool);
      const made = await store.createUser('SyntheticDelete', 'synthetic-password-hash');
      if (!made.ok) throw Error('fixture');
      const user = await store.findById(made.userId);
      if (!user) throw Error('fixture');
      await store.requestDeletion(user);
      const key = `meta:season-day:${fingerprint([made.userId, fingerprint(['active-day', 6])])}`;
      await pool.query('INSERT INTO meta_economy_receipts(receipt_key,fingerprint,response) VALUES($1,$2,$3)',
        [key, fingerprint({ day: 6 }), { ok: true, receipt: { id: key, kind: 'season-day', at: 7 * 86400000 } }]);
      await mkdir(join(dir, 'logs'), { mode: 0o700 });
      await writeFile(join(dir, 'ledger.json'), '[]', { mode: 0o600 });
      const executable = join(dir, 'worker.mjs');
      await build({ entryPoints: [resolve('scripts/account-erasure.ts')], outfile: executable,
        bundle: true, platform: 'node', format: 'esm', external: ['pg'] });
      const env = { PATH: process.env.PATH, ERASURE_GAME_DATABASE_URL: url.href,
        ERASURE_CORP_DATABASE_URL: url.href, ERASURE_COMMERCE_MODE: 'disabled',
        ERASURE_LEDGER: join(dir, 'ledger.json'), ERASURE_LOG_DIR: join(dir, 'logs'),
        ERASURE_ANALYTICS_SALTS: JSON.stringify(['synthetic-cli-analytics-salt-32-bytes']) };
      const run = (...args: string[]) => execute(process.execPath, [executable, ...args], { env, timeout: 20000 });
      await expect(run()).rejects.toMatchObject({ code: 1, stderr: expect.stringContaining('E_ERASURE_DATABASE_ONLINE') });
      await pool.end(); pool = undefined;
      // Wait for PostgreSQL to observe the FIN before asserting exclusive maintenance.
      for (let attempt = 0; attempt < 100; attempt++) {
        const live = await admin.query('SELECT count(*)::int n FROM pg_stat_activity WHERE datname=$1', [name]);
        if (!live.rows[0].n) break;
        await new Promise(done => setTimeout(done, 50));
      }
      expect((await run()).stdout).toContain('Account erasure completed: 1');
      await expect(run('--pending')).rejects.toMatchObject({ code: 3, stderr: '' });
      pool = new Pool({ connectionString: url.href, max: 1 });
      expect((await pool.query('SELECT 1 FROM users')).rowCount).toBe(0);
      expect((await pool.query('SELECT 1 FROM meta_economy_receipts')).rowCount).toBe(0);
      expect((await pool.query('SELECT completed_at IS NOT NULL AS done FROM account_deletions')).rows[0].done).toBe(true);
      expect((await pool.query('SELECT required FROM account_erasure_guard')).rows[0].required).toBe(false);
    } finally {
      await pool?.end();
      if (created) {
        for (let attempt = 0; attempt < 100; attempt++) {
          const live = await admin.query('SELECT count(*)::int n FROM pg_stat_activity WHERE datname=$1', [name]);
          if (!live.rows[0].n) break;
          await new Promise(done => setTimeout(done, 50));
        }
        await admin.query(`DROP DATABASE "${name}"`);
      }
      await admin.end();
      await rm(dir, { recursive: true, force: true });
    }
  }, 60000);
});
