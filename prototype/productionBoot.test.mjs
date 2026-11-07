import { beforeAll, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { migrate, PostgresMatchStore } from '../packages/server/src/store';
import { MODULE_MANIFEST_VERSION } from '../packages/server/src/scenario';
import { LEGACY_MATCH_RULES, matchRules } from '../packages/server/src/matchRules';
import { data } from './src/gameData';

const run = promisify(execFile);
beforeAll(async () => {
  await run(process.execPath, ['prototype/bundle-netserver.mjs']);
}, 30_000);

it.each([undefined, 'unreachable'])('the actual production entry refuses incomplete configuration before touching storage: %s', async (database) => {
  const env = {
    ...process.env, PROD: '1', GATE: '1', SEAT_LOCK: '1', TRUST_PROXY: '1',
    AUTH_JWT_SECRET: 'a'.repeat(64), ALLOWED_ORIGINS: 'https://play.example',
    DB_AUTO_MIGRATE: '0', DB_REQUIRE_LEAST_PRIVILEGE: '1',
    BACKUP_READINESS_VERIFIED: '0',
  };
  if (database) env.DATABASE_URL = ['postgres:', '//vd_app_test:', 'fake-password', '@127.0.0.1:1/test'].join('');
  else delete env.DATABASE_URL;
  try {
    await run(process.execPath, ['packages/server/dist/proto-server.mjs'], { env, timeout: 5000 });
    throw new Error('Production unexpectedly started');
  } catch (error) {
    expect(error.code).toBe(1);
    expect(error.stderr).toContain('BACKUP_READINESS_VERIFIED=1');
    if (!database) expect(error.stderr).toContain('DATABASE_URL (durable production storage)');
    expect(error.stderr).not.toMatch(/fake-password|ECONNREFUSED/);
  }
});

it.skipIf(!process.env.DATABASE_URL)('the production bundle pins fresh/legacy matches and isolates incompatible ordinary/AvA snapshots', async () => {
  const { Pool } = createRequire(new URL('../packages/server/package.json', import.meta.url))('pg');
  const url = new URL(process.env.DATABASE_URL);
  if (!['localhost', '127.0.0.1'].includes(url.hostname) || !url.pathname.endsWith('_test')) {
    throw new Error('Use a local *_test database');
  }
  const admin = new Pool({ connectionString: url.href });
  const name = `resume_${randomUUID().replaceAll('-', '')}_test`;
  await admin.query(`CREATE DATABASE "${name}"`);
  url.pathname = `/${name}`;
  const pool = new Pool({ connectionString: url.href });
  const store = new PostgresMatchStore(pool);
  let server;
  let exited;
  let log = '';
  const stop = async () => {
    if (!server) return;
    if (server.exitCode === null) server.kill('SIGTERM');
    await exited;
    server = undefined;
  };
  const start = async () => {
    log = '';
    const env = { PATH: process.env.PATH, HOST: '127.0.0.1', PORT: '0', PROD: '0',
      NODE_ENV: 'test', MATCHES: '1', DATABASE_URL: url.href, AUTH_JWT_SECRET: 'x'.repeat(64) };
    server = spawn(process.execPath, ['packages/server/dist/proto-server.mjs'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    exited = once(server, 'exit');
    for (const stream of [server.stdout, server.stderr]) stream.on('data', chunk => { log += chunk; });
    for (let i = 0; i < 200; i++) {
      const address = /health\s*:\s*(http:\/\/[^\s/]+)\/health/.exec(log)?.[1];
      if (address) return address;
      if (server.exitCode !== null) throw new Error(log);
      await delay(50);
    }
    throw new Error(`Host startup timeout: ${log}`);
  };
  try {
    await migrate(pool);
    await start();
    await stop();
    const [id] = await store.ongoingMatchIds();
    const fresh = await store.load(id);
    const expected = matchRules(data, MODULE_MANIFEST_VERSION);
    const canMigrate = Object.entries(LEGACY_MATCH_RULES).every(([key, value]) => expected[key] === value);
    expect(fresh.state.version).toEqual(expected);
    expect(fresh.dataVersion).toBe(expected.data);
    const legacy = { ...fresh, matchId: 'legacy', dataVersion: '0.1.0',
      state: { ...fresh.state, version: { data: '0.1.0', manifest: '1' } } };
    await store.save(legacy);
    await store.save({ ...fresh, matchId: 'ava-legacy', state: { ...fresh.state,
      version: { ...expected, manifest: '1' } } });
    const badIds = ['bad-data', 'bad-manifest', 'ava-bad'];
    for (const bad of badIds) {
      await store.save({ ...fresh, matchId: bad, state: { ...fresh.state, version: {
        ...expected, ...(bad === 'bad-data' ? { dataHash: 'changed' } : { manifest: 'old' }),
      } } });
    }
    const before = await Promise.all(badIds.map(bad => store.load(bad)));
    const base = await start();
    expect((await fetch(`${base}/auth/status`)).ok).toBe(true);
    for (const bad of badIds) expect(log).toContain(`match ${bad}: E_MATCH_RULES_MISMATCH`);
    expect(log).not.toContain(`match ${id}: E_MATCH_RULES_MISMATCH`);
    expect(log.includes('match legacy: E_MATCH_RULES_MISMATCH')).toBe(!canMigrate);
    expect(log.includes('match ava-legacy: E_MATCH_RULES_MISMATCH')).toBe(!canMigrate);
    await stop();
    expect(await Promise.all(badIds.map(bad => store.load(bad)))).toEqual(before);
    expect((await store.load('legacy')).state.version).toEqual(canMigrate ? expected : legacy.state.version);
    expect((await store.load('ava-legacy')).state.version).toEqual(canMigrate ? expected : { ...expected, manifest: '1' });
    expect((await store.ongoingMatchIds()).sort()).toEqual([id, 'legacy', 'ava-legacy', ...badIds].sort());
    // Even when EVERY saved match is incompatible the HTTP host stays available,
    // and an empty registry must not erase/reseed the durable roster.
    for (const savedId of await store.ongoingMatchIds()) {
      const saved = await store.load(savedId);
      await store.save({ ...saved, state: { ...saved.state, version: { ...expected, manifest: 'old' } } });
    }
    const allBefore = await pool.query('SELECT id, state, seq FROM matches ORDER BY id');
    const emptyBase = await start();
    expect((await fetch(`${emptyBase}/auth/status`)).ok).toBe(true);
    expect(log).toContain('matches: 0 sessions');
    expect(log).not.toContain('/undefined');
    await stop();
    expect((await pool.query('SELECT id, state, seq FROM matches ORDER BY id')).rows).toEqual(allBefore.rows);
  } finally {
    await stop();
    await pool.end();
    // Pool.end() can finish before PostgreSQL observes the socket close.
    // Forcing an idle connection closed would leak a FATAL into the test runner.
    await expect.poll(async () => {
      const { rows } = await admin.query('SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname=$1', [name]);
      return rows[0].n;
    }, { timeout: 3000 }).toBe(0);
    await admin.query(`DROP DATABASE "${name}"`);
    await admin.end();
  }
}, 30_000);
