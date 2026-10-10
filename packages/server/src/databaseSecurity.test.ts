import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  APP_TABLES,
  migrateDatabase,
  prepareRuntimeDatabase,
  provisionDatabase,
  retireDatabaseLogin,
} from './databaseSecurity';
import { migrate, PostgresUserStore } from './store/postgres';

it('requires an explicit DML grant decision when a migration introduces a table', () => {
  const sql = readFileSync(new URL('./store/postgres.ts', import.meta.url), 'utf8');
  const names = [...sql.matchAll(/CREATE TABLE IF NOT EXISTS (\w+)/g)].map((m) => m[1]);
  expect([...APP_TABLES].sort()).toEqual(names.sort());
});

it('rejects injectable role names and non-hex credentials before connecting', async () => {
  const config = {
    DB_RUNTIME_USER: 'vd_app_safe',
    DB_RUNTIME_PASSWORD: 'a'.repeat(64),
    DB_MIGRATION_USER: 'vd_migrate_safe',
    DB_MIGRATION_PASSWORD: 'b'.repeat(64),
  };
  const unusablePool = {} as Pool;
  await expect(
    provisionDatabase(unusablePool, { ...config, DB_RUNTIME_USER: "vd_app_x'; DROP ROLE void;--" }),
  ).rejects.toThrow('E_DB_ROLE_CONFIG');
  await expect(
    provisionDatabase(unusablePool, { ...config, DB_RUNTIME_PASSWORD: "x';--" }),
  ).rejects.toThrow('E_DB_ROLE_CONFIG');
  await expect(retireDatabaseLogin(unusablePool, 'vd_migrate_safe')).rejects.toThrow(
    'E_DB_ROLE_CONFIG',
  );
});

const base = process.env.DATABASE_URL;
// Dedicated databases and unique cluster-wide role names: never mutate void_test or a live DB.
describe.skipIf(!base)('least privilege and expand/contract rotation on real PostgreSQL', () => {
  const suffix = randomBytes(6).toString('hex');
  const name = `void_zta_${suffix}`;
  const app = `vd_app_${suffix}`;
  const app2 = `vd_app_${suffix}_v2`;
  const migrator = `vd_migrate_${suffix}`;
  const pass = randomBytes(32).toString('hex');
  const pass2 = randomBytes(32).toString('hex');
  const migrationPass = randomBytes(32).toString('hex');
  const root = new Pool({ connectionString: base, max: 1 });
  let admin: Pool;
  const pools: Pool[] = [];
  const url = (user?: string, password?: string): string => {
    const dbUrl = new URL(base!);
    dbUrl.pathname = `/${name}`;
    if (user) dbUrl.username = user;
    if (password) dbUrl.password = password;
    return dbUrl.toString();
  };
  const connect = (user?: string, password?: string): Pool => {
    const pool = new Pool({ connectionString: url(user, password), max: 1 });
    pools.push(pool);
    return pool;
  };
  const config = (user = app, password = pass) => ({
    DB_RUNTIME_USER: user,
    DB_RUNTIME_PASSWORD: password,
    DB_MIGRATION_USER: migrator,
    DB_MIGRATION_PASSWORD: migrationPass,
  });
  beforeAll(async () => {
    await root.query(`CREATE DATABASE "${name}"`);
    admin = connect();
    // Rehearse an upgrade with real pre-existing tables and a durable account.
    await migrate(admin);
    expect(await new PostgresUserStore(admin).createUser('existing', 'hash')).toMatchObject({
      ok: true,
    });
    await provisionDatabase(admin, config());
  }, 30_000);
  afterAll(async () => {
    for (const pool of pools) await pool.end();
    // pg-pool resolves end() before all socket closes finish. Wait for the server to
    // observe closure instead of killing idle clients and creating unhandled 57P01s.
    for (let attempt = 0; attempt < 40; attempt++) {
      const { rows } = await root.query(
        'SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname=$1',
        [name],
      );
      if (rows[0].n === 0) break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    await root.query(`DROP DATABASE IF EXISTS "${name}"`);
    for (const role of [app, app2, migrator]) await root.query(`DROP ROLE IF EXISTS "${role}"`);
    // vd_schema/vd_runtime are shared group roles, owned by the deployment, not this test.
    await root.end();
  });

  it('serves durable users with DML only and rejects DDL, role escalation and truncation', async () => {
    const runtime = connect(app, pass);
    await prepareRuntimeDatabase(runtime, {
      DB_AUTO_MIGRATE: '0',
      DB_REQUIRE_LEAST_PRIVILEGE: '1',
    });
    const store = new PostgresUserStore(runtime);
    expect(await store.findUser('existing')).toMatchObject({ login: 'existing' });
    expect(await store.createUser('new', 'hash')).toMatchObject({ ok: true });
    expect(await store.findUser('new')).toMatchObject({ login: 'new' });
    for (const query of [
      'CREATE TABLE public.forbidden(id int)',
      'ALTER TABLE users ADD COLUMN forbidden int',
      'DROP TABLE users',
      'TRUNCATE users',
      'CREATE SCHEMA forbidden',
      'CREATE TEMP TABLE forbidden(id int)',
      'SET ROLE vd_schema',
      'CREATE ROLE forbidden',
      "UPDATE public.vd_schema_revision SET fingerprint='forged' WHERE id=1",
    ])
      await expect(runtime.query(query)).rejects.toMatchObject({ code: '42501' });
  });
  it('migrates under the stable owner on one connection and survives repeated/concurrent migrations', async () => {
    const migration = connect(migrator, migrationPass);
    await Promise.all([
      migrateDatabase(migration),
      migrateDatabase(connect(migrator, migrationPass)),
    ]);
    const { rows } = await migration.query(
      "SELECT tableowner FROM pg_tables WHERE schemaname='public'",
    );
    expect(new Set(rows.map((r: { tableowner: string }) => r.tableowner))).toEqual(
      new Set(['vd_schema']),
    );
    expect((await migration.query('SELECT current_user AS name')).rows[0].name).toBe(migrator);
    const runtime = connect(app, pass);
    await runtime.query(
      "INSERT INTO corp_audit(corp_id, at, actor, action) VALUES ('c',1,'a','test')",
    );
  });
  it('keeps old and new login roles usable through cutover/rollback, then revokes only the old login', async () => {
    await provisionDatabase(admin, config(app2, pass2));
    const old = connect(app, pass);
    const next = connect(app2, pass2);
    expect((await old.query('SELECT count(*) FROM users')).rows).toEqual(
      (await next.query('SELECT count(*) FROM users')).rows,
    );
    await prepareRuntimeDatabase(next, { DB_AUTO_MIGRATE: '0', DB_REQUIRE_LEAST_PRIVILEGE: '1' });
    await retireDatabaseLogin(admin, app);
    expect(await next.query('SELECT 1')).toMatchObject({ rowCount: 1 });
    await expect(old.query('SELECT * FROM public.users')).rejects.toMatchObject({ code: '42501' });
    await expect(connect(app, pass).query('SELECT 1')).rejects.toMatchObject({ code: '28000' });
  });
  it('refuses a privileged runtime with a stable error before executing DDL', async () => {
    await expect(
      prepareRuntimeDatabase(connect(), { DB_AUTO_MIGRATE: '0', DB_REQUIRE_LEAST_PRIVILEGE: '1' }),
    ).rejects.toThrow('E_DB_BOOT');
    await expect(
      prepareRuntimeDatabase(connect(), { DB_REQUIRE_LEAST_PRIVILEGE: '1' }),
    ).rejects.toThrow('E_DB_BOOT');
    // These pools were closed by prepareRuntimeDatabase's fail-closed path.
    pools.splice(pools.length - 2);
  });
  it('refuses a shared database without changing passwords, roles or tables', async () => {
    await admin.query('CREATE TABLE public.unrelated(id int)');
    await expect(provisionDatabase(admin, config())).rejects.toThrow('E_DB_NOT_DEDICATED');
    await admin.query('DROP TABLE public.unrelated');
    expect(await connect(app2, pass2).query('SELECT 1')).toMatchObject({ rowCount: 1 });
  });

  it('refuses a missing/stale migration marker and restores readiness through the migration executable', async () => {
    await admin.query("UPDATE public.vd_schema_revision SET fingerprint='stale' WHERE id=1");
    const runtime = connect(app2, pass2);
    await expect(
      prepareRuntimeDatabase(runtime, { DB_AUTO_MIGRATE: '0', DB_REQUIRE_LEAST_PRIVILEGE: '1' }),
    ).rejects.toThrow('E_DB_BOOT');
    pools.pop(); // the fail-closed boot already closed this pool
    await migrateDatabase(connect(migrator, migrationPass));
    await prepareRuntimeDatabase(connect(app2, pass2), {
      DB_AUTO_MIGRATE: '0',
      DB_REQUIRE_LEAST_PRIVILEGE: '1',
    });
  });

  it('refuses powerful inherited PostgreSQL roles even without a superuser flag', async () => {
    await admin.query(`GRANT pg_read_server_files TO "${app2}"`);
    try {
      await expect(
        prepareRuntimeDatabase(connect(app2, pass2), {
          DB_AUTO_MIGRATE: '0',
          DB_REQUIRE_LEAST_PRIVILEGE: '1',
        }),
      ).rejects.toThrow('E_DB_BOOT');
      pools.pop();
    } finally {
      await admin.query(`REVOKE pg_read_server_files FROM "${app2}"`);
    }
    await prepareRuntimeDatabase(connect(app2, pass2), {
      DB_AUTO_MIGRATE: '0',
      DB_REQUIRE_LEAST_PRIVILEGE: '1',
    });
  });
});
