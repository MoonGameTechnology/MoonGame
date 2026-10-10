import type { Pool, PoolClient } from 'pg';
import { createHash, createHmac, pbkdf2Sync, randomBytes } from 'node:crypto';
import { migrate, schemaFingerprint } from './store/postgres';

/** This database is dedicated to the game. Never grant DML on arbitrary public tables. */
export const APP_TABLES = [
  'matches',
  'seats',
  'receipts',
  'users',
  'corps',
  'corp_members',
  'corp_audit',
  'corp_ready',
  'player_ready',
  'ava_challenges',
  'ava_roster',
  'ava_results',
  'ava_sessions',
  'ava_feed',
  'medals',
  'arsenal',
  'corp_arsenal_rent',
  'meta_wallets',
  'meta_market_listings',
  'meta_market_ledger',
  'drop_claims',
  'drop_meta',
  'commander_xp',
  'commander_credits',
  'player_profiles',
  'profile_progress',
  'profile_credits',
  'push_subscriptions',
  'friend_edges',
] as const;
const OWNER = 'vd_schema';
const DML = 'vd_runtime';

/** DDL identifiers cannot be bound as $1. Ask PostgreSQL to quote %I/%L through
 * parameterized format(), then execute that statement on the SAME transaction client.
 * Templates are fixed internal literals; no caller SQL or raw value interpolation. */
async function executeDdl(
  client: PoolClient,
  template: string,
  parameters: readonly string[],
): Promise<void> {
  const { rows } = await client.query<{ sql: string }>(
    'SELECT format($1::text, VARIADIC $2::text[]) AS sql',
    [template, parameters],
  );
  await client.query(rows[0]!.sql);
}

/** PostgreSQL SCRAM verifier (RFC 5802). Hex credentials are already SASLprep-safe.
 * Keep the plaintext password out of ALTER ROLE statements and database error logs. */
function passwordVerifier(password: string): string {
  const salt = randomBytes(16);
  const salted = pbkdf2Sync(password, salt, 4096, 32, 'sha256');
  const clientKey = createHmac('sha256', salted).update('Client Key').digest();
  const storedKey = createHash('sha256').update(clientKey).digest('base64');
  const serverKey = createHmac('sha256', salted).update('Server Key').digest('base64');
  return `SCRAM-SHA-256$4096:${salt.toString('base64')}$${storedKey}:${serverKey}`;
}

/** Legacy dev boots still migrate. The hardened process NEVER receives migration creds. */
export async function prepareRuntimeDatabase(pool: Pool, env: NodeJS.ProcessEnv): Promise<void> {
  try {
    if (env.DB_REQUIRE_LEAST_PRIVILEGE === '1' && env.DB_AUTO_MIGRATE !== '0')
      throw new Error('E_DB_RUNTIME_ROLE');
    if (env.DB_AUTO_MIGRATE !== '0') await migrate(pool);
    if (env.DB_REQUIRE_LEAST_PRIVILEGE === '1') {
      if (env.DB_AUTO_MIGRATE !== '0') throw new Error('E_DB_RUNTIME_ROLE');
      const { rows } = await pool.query<{ unsafe: boolean }>(`
        SELECT r.rolsuper OR r.rolcreatedb OR r.rolcreaterole OR r.rolreplication
          OR r.rolbypassrls
          OR EXISTS (SELECT 1 FROM pg_roles granted
            WHERE granted.rolname NOT IN (current_user, 'vd_runtime')
              AND pg_has_role(current_user, granted.oid, 'MEMBER'))
          OR EXISTS (SELECT 1 FROM pg_namespace n WHERE n.nspname !~ '^pg_'
            AND n.nspname <> 'information_schema' AND has_schema_privilege(current_user, n.oid, 'CREATE'))
          OR has_database_privilege(current_user, current_database(), 'CREATE')
          OR has_database_privilege(current_user, current_database(), 'TEMP')
          OR EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
            WHERE n.nspname='public' AND c.relkind IN ('r','p','S','v','m','f')
              AND pg_has_role(current_user, c.relowner, 'MEMBER')) AS unsafe
        FROM pg_roles r WHERE r.rolname=current_user
      `);
      if (rows.length !== 1 || rows[0]!.unsafe) throw new Error('E_DB_RUNTIME_ROLE');
      // A missing migration/grant refuses startup rather than failing on a player's write.
      const { rows: revision } = await pool.query<{ fingerprint: string }>(
        'SELECT fingerprint FROM public.vd_schema_revision WHERE id=1',
      );
      if (revision[0]?.fingerprint !== schemaFingerprint()) throw new Error('E_DB_SCHEMA_REVISION');
      for (const table of APP_TABLES) {
        const { rows: all } = await pool.query<{ ok: boolean }>(
          `SELECT bool_and(has_table_privilege(current_user, $1, privilege)) AS ok
           FROM unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE']) AS privilege`,
          [`public.${table}`],
        );
        if (!all[0]?.ok) throw new Error('E_DB_RUNTIME_ROLE');
      }
    }
  } catch {
    await pool.end();
    throw new Error('E_DB_BOOT'); // connection strings and SQL details must not escape
  }
}

function loginName(value: string | undefined): string {
  if (!value || !/^vd_(?:app|migrate)_[a-z0-9_]{1,40}$/.test(value))
    throw new Error('E_DB_ROLE_CONFIG');
  return value;
}

async function ensureRole(client: PoolClient, name: string, login = false): Promise<void> {
  const { rows } = await client.query<{ unsafe: boolean }>(
    `SELECT rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls
       OR rolcanlogin <> $2 AS unsafe FROM pg_roles WHERE rolname=$1`,
    [name, login],
  );
  if (rows[0]?.unsafe) throw new Error('E_DB_ROLE_UNSAFE');
  if (!rows.length) {
    await executeDdl(
      client,
      login
        ? 'CREATE ROLE %I LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS'
        : 'CREATE ROLE %I NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS',
      [name],
    );
  }
}

async function recordSchema(client: PoolClient): Promise<void> {
  await client.query(`CREATE TABLE IF NOT EXISTS public.vd_schema_revision (
    id integer PRIMARY KEY CHECK (id=1), fingerprint text NOT NULL)`);
  await client.query(
    'INSERT INTO public.vd_schema_revision(id,fingerprint) VALUES (1,$1) ON CONFLICT(id) DO UPDATE SET fingerprint=excluded.fingerprint',
    [schemaFingerprint()],
  );
  await client.query('GRANT SELECT ON public.vd_schema_revision TO vd_runtime');
}

async function grantData(client: PoolClient): Promise<void> {
  for (const table of APP_TABLES) {
    await executeDdl(client, 'GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO %I', [
      table,
      DML,
    ]);
  }
  // Only sequences owned by our tables, never sequences belonging to another application.
  const { rows } = await client.query<{ name: string }>(
    `
    SELECT s.relname AS name FROM pg_class s JOIN pg_namespace n ON n.oid=s.relnamespace
    JOIN pg_depend d ON d.objid=s.oid AND d.classid='pg_class'::regclass
    JOIN pg_class t ON t.oid=d.refobjid
    WHERE s.relkind='S' AND n.nspname='public' AND t.relname=ANY($1::text[])
      AND d.deptype IN ('a','i')`,
    [APP_TABLES],
  );
  for (const { name } of rows) {
    await executeDdl(client, 'GRANT USAGE, SELECT ON SEQUENCE public.%I TO %I', [name, DML]);
  }
}

/** Administrative bootstrap/expand step. Requires a dedicated database and backup first.
 * Existing runtime logins stay usable: cutover/revocation is an explicit operator step. */
export async function provisionDatabase(pool: Pool, env: NodeJS.ProcessEnv): Promise<void> {
  const app = loginName(env.DB_RUNTIME_USER);
  const migrator = loginName(env.DB_MIGRATION_USER);
  if (!app.startsWith('vd_app_') || !migrator.startsWith('vd_migrate_'))
    throw new Error('E_DB_ROLE_CONFIG');
  for (const password of [env.DB_RUNTIME_PASSWORD, env.DB_MIGRATION_PASSWORD]) {
    if (!password || !/^[a-f0-9]{64}$/.test(password)) throw new Error('E_DB_ROLE_CONFIG');
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(144731, 31)');
    const { rows: foreign } = await client.query<{ relname: string }>(
      `
      SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND c.relkind IN ('r','p','v','m','f')
        AND NOT c.relname=ANY($1::text[])`,
      [[...APP_TABLES, 'vd_schema_revision']],
    );
    if (foreign.length) throw new Error('E_DB_NOT_DEDICATED');
    await ensureRole(client, OWNER);
    await ensureRole(client, DML);
    await ensureRole(client, app, true);
    await ensureRole(client, migrator, true);
    // Refuse inherited privileges from an existing, unrelated role.
    for (const [role, group] of [
      [app, DML],
      [migrator, OWNER],
      [DML, ''],
      [OWNER, ''],
    ] as const) {
      const { rows } = await client.query(
        `SELECT 1 FROM pg_auth_members m
        JOIN pg_roles member ON member.oid=m.member JOIN pg_roles parent ON parent.oid=m.roleid
        WHERE member.rolname=$1 AND parent.rolname<>$2`,
        [role, group],
      );
      if (rows.length) throw new Error('E_DB_ROLE_UNSAFE');
    }
    // Passwords are hex-only, never echoed or put into argv. SQL receives only verifiers;
    // verifiers are sensitive too, so administrative statement logging must stay disabled.
    await executeDdl(client, 'ALTER ROLE %I PASSWORD %L', [
      app,
      passwordVerifier(env.DB_RUNTIME_PASSWORD!),
    ]);
    await executeDdl(client, 'ALTER ROLE %I PASSWORD %L', [
      migrator,
      passwordVerifier(env.DB_MIGRATION_PASSWORD!),
    ]);
    await executeDdl(client, 'GRANT %I TO %I', [DML, app]);
    await executeDdl(client, 'GRANT %I TO %I', [OWNER, migrator]);
    const { rows: db } = await client.query<{ name: string }>('SELECT current_database() AS name');
    await executeDdl(client, 'REVOKE ALL ON DATABASE %I FROM PUBLIC', [db[0]!.name]);
    await executeDdl(client, 'REVOKE CONNECT ON DATABASE %I FROM %I, %I', [
      db[0]!.name,
      DML,
      OWNER,
    ]);
    // CONNECT belongs to the per-deployment login, not a shared cluster-wide group.
    await executeDdl(client, 'GRANT CONNECT ON DATABASE %I TO %I, %I', [
      db[0]!.name,
      app,
      migrator,
    ]);
    await client.query('REVOKE ALL ON SCHEMA public FROM PUBLIC');
    await executeDdl(client, 'GRANT USAGE ON SCHEMA public TO %I', [DML]);
    await executeDdl(client, 'GRANT USAGE, CREATE ON SCHEMA public TO %I', [OWNER]);
    const { rows: existing } = await client.query<{ relname: string }>(
      `
      SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND c.relkind IN ('r','p') AND c.relname=ANY($1::text[])`,
      [APP_TABLES],
    );
    const { rows: marker } = await client.query(
      "SELECT to_regclass('public.vd_schema_revision') AS name",
    );
    if (marker[0]?.name)
      await client.query('ALTER TABLE public.vd_schema_revision OWNER TO vd_schema');
    for (const { relname } of existing) {
      await executeDdl(client, 'ALTER TABLE public.%I OWNER TO %I', [relname, OWNER]);
    }
    await client.query('SET LOCAL ROLE vd_schema');
    await migrate(client);
    await recordSchema(client);
    await grantData(client);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/** One checked-out client, one transaction, stable NOLOGIN owner, serialized DDL. */
export async function migrateDatabase(pool: Pool): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(144731, 31)');
    await client.query('SET LOCAL ROLE vd_schema');
    await migrate(client);
    await recordSchema(client);
    await grantData(client);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/** Contract step AFTER cutover + health + rollback window. NOLOGIN alone would leave
 * existing pooled connections able to write; revoke the DML membership as well. */
export async function retireDatabaseLogin(pool: Pool, value: string | undefined): Promise<void> {
  const role = loginName(value);
  if (!role.startsWith('vd_app_')) throw new Error('E_DB_ROLE_CONFIG');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(144731, 31)');
    const { rows } = await client.query<{ ok: boolean }>(
      `SELECT pg_has_role(oid, 'vd_runtime', 'MEMBER') AND NOT rolsuper
        AND NOT rolcreaterole AND NOT pg_has_role(oid, 'vd_schema', 'MEMBER') AS ok
       FROM pg_roles WHERE rolname=$1`,
      [role],
    );
    if (!rows[0]?.ok) throw new Error('E_DB_ROLE_UNSAFE');
    await executeDdl(client, 'ALTER ROLE %I NOLOGIN', [role]);
    await executeDdl(client, 'REVOKE vd_runtime FROM %I', [role]);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
