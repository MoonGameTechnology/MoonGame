/* global AbortSignal */
/** Isolated, destructive ONLY to its own disposable Docker container. No production
 * DATABASE_URL/config is read. Needs Docker, pg_dump (via container), psql, age and
 * installed workspace dependencies. Evidence and synthetic keys stay in a private
 * temp directory; only report.json is suitable for attaching to a review. */
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { createHash, createHmac, generateKeyPairSync, randomBytes, randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, readdirSync, copyFileSync, openSync, closeSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { bundleNetserver } from '../prototype/bundle-netserver.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(root);
process.umask(0o077);
const { Pool } = createRequire(join(root, 'packages/server/package.json'))('pg');
const dir = mkdtempSync(join(tmpdir(), 'moongame-erasure-drill-'));
const container = `moongame-erasure-drill-${randomUUID()}`;
const image = process.env.ERASURE_DRILL_POSTGRES_IMAGE ??
  readFileSync(join(root, 'deploy/docker-compose.yml'), 'utf8').match(/image:\s*(postgres:[^\s#]+)/)?.[1];
assert.ok(image, 'PostgreSQL image missing');
// A clean allowlist prevents ambient production credentials/endpoints entering children.
const env = { PATH: process.env.PATH, HOME: dir, LANG: 'C.UTF-8' };
const report = { sourceSha: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  sourceFilesSha256: Object.fromEntries(['deploy/account-erasure-drill.mjs', 'scripts/account-erasure.ts',
    'packages/server/src/accountErasureWorker.ts', 'packages/server/src/accountErasure.ts',
    'packages/server/src/legacyReceiptOwnership.ts',
    'packages/server/src/databaseSecurity.ts', 'deploy/backup.sh', 'deploy/restore.sh'].map(path =>
    [path, createHash('sha256').update(readFileSync(join(root, path))).digest('hex')])),
  syntheticOnly: true, topology: 'game and corporations in one PostgreSQL database',
  startedAt: new Date().toISOString(), checks: [] };
const record = name => { report.checks.push({ name, ok: true }); console.log(`PASS ${name}`); };
let child;
let adminUrl;
let containerCreated = false;
let sequence = 0;
async function command(bin, args, extra = {}, expected = 0) {
  const file = openSync(join(dir, `command-${++sequence}.log`), 'w', 0o600);
  const proc = spawn(bin, args, { cwd: root, env: { ...env, ...extra }, stdio: ['ignore', file, file] });
  const timer = setTimeout(() => proc.kill('SIGKILL'), 120_000);
  try {
    const code = await new Promise((done, fail) => { proc.on('error', fail); proc.on('close', done); });
    assert.equal(code, expected, `command ${sequence} (${bin}) failed; private log in ${dir}`);
  } finally { clearTimeout(timer); closeSync(file); }
}
async function sql(text, values = [], url = adminUrl) {
  const pool = new Pool({ connectionString: url, max: 1 });
  try { return await pool.query(text, values); } finally { await pool.end(); }
}
async function offline() {
  for (let attempt = 0; attempt < 100; attempt++) {
    const { rows } = await sql("SELECT count(*)::int n FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() AND backend_type='client backend'");
    if (!rows[0].n) return;
    await delay(50);
  }
  throw Error('drill runtime did not disconnect');
}
async function stop() {
  if (child && child.exitCode === null && child.signalCode === null) {
    const proc = child;
    const timer = setTimeout(() => proc.kill('SIGKILL'), 15_000);
    await new Promise(done => { proc.once('close', done); proc.kill('SIGTERM'); });
    clearTimeout(timer);
  }
  child = undefined;
  await offline();
}
try {
  await bundleNetserver();
  record('standard build contains the maintenance executable');
  const password = randomBytes(32).toString('hex');
  const pgEnv = join(dir, 'postgres.env');
  writeFileSync(pgEnv, `POSTGRES_PASSWORD=${password}\nPOSTGRES_DB=drill\n`);
  await command('docker', ['run', '-d', '--name', container, '--label', 'moongame.task=erasure-drill',
    '--memory', '768m', '--cpus', '1', '--publish', '127.0.0.1::5432', '--env-file', pgEnv, image]);
  containerCreated = true;
  const address = execFileSync('docker', ['port', container, '5432/tcp'], { encoding: 'utf8' }).trim();
  assert.match(address, /^127\.0\.0\.1:\d+$/);
  adminUrl = `postgres://postgres:${password}@${address}/drill`;
  for (let attempt = 0; attempt < 100; attempt++) {
    try { await sql('SELECT 1'); break; } catch { if (attempt === 99) throw Error('drill PostgreSQL startup'); await delay(100); }
  }
  report.postgresImage = execFileSync('docker', ['inspect', container, '--format', '{{.Image}}'], { encoding: 'utf8' }).trim();
  report.postgresVersion = (await sql('SHOW server_version')).rows[0].server_version;
  const runtimePassword = randomBytes(32).toString('hex');
  const runtimeUrl = new URL(adminUrl); runtimeUrl.username = 'vd_app_drill'; runtimeUrl.password = runtimePassword;
  await command(process.execPath, ['packages/server/dist/database-admin.mjs', 'provision'], {
    DB_ADMIN_URL: adminUrl, DB_RUNTIME_USER: 'vd_app_drill', DB_RUNTIME_PASSWORD: runtimePassword,
    DB_MIGRATION_USER: 'vd_migrate_drill', DB_MIGRATION_PASSWORD: randomBytes(32).toString('hex'),
  });
  const runtime = join(dir, 'runtime'); mkdirSync(runtime);
  symlinkSync(join(root, 'data'), join(runtime, 'data'), 'dir');
  const logs = join(runtime, 'playtest-logs'); mkdirSync(logs);
  const ledger = join(dir, 'ledger.json'); writeFileSync(ledger, '[]');
  const salt = randomBytes(32).toString('hex');
  const erasureEnv = { ERASURE_GAME_DATABASE_URL: adminUrl, ERASURE_CORP_DATABASE_URL: adminUrl,
    ERASURE_LEDGER: ledger, ERASURE_LOG_DIR: logs, ERASURE_ANALYTICS_SALTS: JSON.stringify([salt]), ERASURE_COMMERCE_MODE: 'disabled' };
  const worker = (...args) => command(process.execPath, ['packages/server/dist/account-erasure.mjs', ...args], erasureEnv);
  const picker = createServer(); await new Promise(done => picker.listen(0, '127.0.0.1', done));
  const port = picker.address().port; await new Promise(done => picker.close(done));
  const base = `http://127.0.0.1:${port}`;
  const runtimeEnv = { ...env, DATABASE_URL: runtimeUrl.href, DB_AUTO_MIGRATE: '0', DB_REQUIRE_LEAST_PRIVILEGE: '1',
    PROD: '0', HOST: '127.0.0.1', PORT: String(port), ACCOUNT_DELETION_ENABLED: '1',
    AUTH_JWT_SECRET: randomBytes(32).toString('hex'), ANALYTICS_SALT: salt, ALLOWED_ORIGINS: base,
    AUTH_RATE_MAX: '200', MATCHES: '1', GATE: '1', SEAT_LOCK: '1' };
  async function start(blocked = false) {
    let output = '';
    child = spawn(process.execPath, [join(root, 'packages/server/dist/proto-server.mjs')],
      { cwd: runtime, env: runtimeEnv, stdio: ['ignore', 'pipe', 'pipe'] });
    const proc = child;
    proc.stdout.on('data', data => { output = (output + data).slice(-20000); });
    proc.stderr.on('data', data => { output = (output + data).slice(-20000); });
    for (let attempt = 0; attempt < 300; attempt++) {
      if (proc.exitCode !== null || proc.signalCode !== null) {
        writeFileSync(join(dir, `server-${++sequence}.log`), output);
        // The boot boundary deliberately hides internal database details.
        assert.ok(blocked && output.includes('E_DB_BOOT'), 'unexpected runtime startup failure');
        child = undefined; return;
      }
      try {
        const response = await fetch(base + '/health', { signal: AbortSignal.timeout(300) });
        if (response.ok) { assert.equal(blocked, false, 'restored runtime served traffic before replay'); return; }
      } catch { /* wait for the isolated listener */ }
      await delay(100);
    }
    throw Error('drill runtime startup timed out');
  }
  async function api(path, body, token) {
    const response = await fetch(base + path, { method: 'POST', headers: {
      'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}),
    }, body: JSON.stringify(body), signal: AbortSignal.timeout(10000) });
    return { status: response.status, body: response.status === 204 ? null : await response.json() };
  }
  await start();
  const aCreds = { login: 'DrillDelete', password: randomBytes(24).toString('base64url') };
  const bCreds = { login: 'DrillKeep', password: randomBytes(24).toString('base64url') };
  const a = await api('/auth/register', { ...aCreds, email: 'synthetic-delete@example.invalid' });
  const b = await api('/auth/register', bCreds);
  assert.equal(a.status, 201); assert.equal(b.status, 201);
  assert.equal((await api('/auth/login', { ...aCreds, password: '' })).status, 400);
  record('real HTTP registration; empty password cannot log in; least-privilege runtime boots');
  const aid = a.body.accountId, bid = b.body.accountId;
  const install = randomUUID();
  for (const token of [undefined, a.body.token, b.body.token]) {
    const result = await api('/telemetry', { v: 1, install, session: randomUUID(), build: 'erasure-drill',
      events: [{ id: randomUUID(), e: 'app_loaded', t: Date.now() }] }, token);
    assert.equal(result.status, 204);
  }
  await stop();
  for (const [id, balance] of [[aid, 42], [bid, 73]]) {
    await sql('INSERT INTO player_profiles VALUES($1,$2) ON CONFLICT(account_id) DO UPDATE SET appearance=excluded.appearance', [id, { portrait: 'synthetic' }]);
    await sql('INSERT INTO meta_wallets VALUES($1,$2) ON CONFLICT(account_id) DO UPDATE SET warrants=excluded.warrants', [id, balance]);
    await sql("INSERT INTO profile_progress VALUES($1,'synthetic',12)", [id]);
  }
  await sql("INSERT INTO corps(id,name) VALUES('drill','Synthetic Corporation')");
  await sql("INSERT INTO corp_members(account_id,corp_id,login,role) VALUES($1,'drill','DrillDelete','head'),($2,'drill','DrillKeep','member')", [aid, bid]);
  await sql("INSERT INTO meta_economy_receipts(receipt_key,fingerprint,response,account_ids) VALUES('drill-own','own','{}',$1),('drill-shared','shared',$2,$3)", [[aid], { accountId: aid, other: bid }, [aid, bid]]);
  const fingerprint = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
  for (const id of [aid, bid]) {
    const key = `meta:season-day:${fingerprint([id, fingerprint(['active-day', 6])])}`;
    await sql('INSERT INTO meta_economy_receipts(receipt_key,fingerprint,response) VALUES($1,$2,$3)',
      [key, fingerprint({ day: 6 }), { ok: true, receipt: { id: key, kind: 'season-day', at: 7 * 86400000 } }]);
  }
  const kept = async () => (await sql('SELECT u.*,p.appearance,w.warrants,pr.value FROM users u JOIN player_profiles p ON p.account_id=u.id JOIN meta_wallets w ON w.account_id=u.id JOIN profile_progress pr ON pr.account_id=u.id WHERE u.id=$1', [bid])).rows;
  const before = JSON.stringify(await kept());
  const keys = generateKeyPairSync('ed25519');
  writeFileSync(join(dir, 'sign.pem'), keys.privateKey.export({ type: 'pkcs8', format: 'pem' }));
  writeFileSync(join(dir, 'verify.pem'), keys.publicKey.export({ type: 'spki', format: 'pem' }));
  await command('age-keygen', ['-o', join(dir, 'age.key')]);
  const recipient = execFileSync('age-keygen', ['-y', join(dir, 'age.key')], { encoding: 'utf8' }).trim();
  const bin = join(dir, 'bin'); mkdirSync(bin);
  // Use the SAME pg_dump major version as the container, as the prod compose path does.
  writeFileSync(join(bin, 'pg_dump'), `#!/bin/bash\nset -eu\nargs=()\nwhile (( $# )); do\n if [[ "$1" = -d ]]; then shift 2; else args+=("$1"); shift; fi\ndone\nexec docker exec ${container} pg_dump -U postgres -d drill "\${args[@]}"\n`, { mode: 0o700 });
  const backupId = randomUUID();
  const backupEnv = { DATABASE_URL: adminUrl, PATH: `${bin}:${env.PATH}`, BACKUP_DIR: join(dir, 'backups'),
    BACKUP_FORMAT: 'bundle-v1', BACKUP_AGE_RECIPIENT: recipient, BACKUP_SIGNING_KEY: join(dir, 'sign.pem'),
    BACKUP_DOMAIN: 'synthetic', BACKUP_PRODUCER: 'erasure-drill', BACKUP_ID: backupId };
  await command('bash', ['deploy/backup.sh'], backupEnv);
  const archive = join(backupEnv.BACKUP_DIR, readdirSync(backupEnv.BACKUP_DIR).find(f => f.endsWith('.vdbak')));
  report.backupSha256 = createHash('sha256').update(readFileSync(archive)).digest('hex');
  const oldLogs = join(dir, 'old-logs'); mkdirSync(oldLogs);
  for (const name of readdirSync(logs)) copyFileSync(join(logs, name), join(oldLogs, name));
  record('encrypted and signed snapshot predates the deletion request');
  await start();
  const requestId = randomUUID();
  const request = { password: aCreds.password, confirm: 'DELETE', requestId };
  assert.equal((await api('/auth/delete-account', { ...request, password: '' }, a.body.token)).status, 400);
  assert.equal((await api('/auth/delete-account', { ...request, password: 'wrong password' }, a.body.token)).status, 401);
  assert.equal((await api('/auth/delete-account', request, a.body.token)).status, 202);
  assert.equal((await api('/auth/delete-account', request, a.body.token)).status, 202);
  assert.equal((await api('/auth/login', aCreds)).status, 401);
  record('password guard, durable request, lost-response retry and immediate login revocation');
  await command(process.execPath, ['packages/server/dist/account-erasure.mjs'], erasureEnv, 1);
  assert.match(readFileSync(join(dir, `command-${sequence}.log`), 'utf8'), /E_ERASURE_DATABASE_ONLINE/);
  record('maintenance refuses a live runtime connection');
  await stop();
  await worker();
  async function verifyErased() {
    for (const table of ['users', 'player_profiles', 'profile_progress', 'meta_wallets', 'corp_members', 'registration_rewards']) {
      const column = table === 'users' ? 'id' : 'account_id';
      assert.equal((await sql(`SELECT 1 FROM ${table} WHERE ${column}=$1`, [aid])).rowCount, 0);
    }
    assert.equal(JSON.stringify(await kept()), before);
    assert.equal((await sql('SELECT role FROM corp_members WHERE account_id=$1', [bid])).rows[0].role, 'head');
    assert.equal((await sql("SELECT 1 FROM meta_economy_receipts WHERE receipt_key='drill-own'")).rowCount, 0);
    const receipt = (await sql("SELECT account_ids,response FROM meta_economy_receipts WHERE receipt_key='drill-shared'")).rows[0];
    assert.deepEqual(receipt.account_ids, [bid]); assert.ok(!JSON.stringify(receipt.response).includes(aid));
    const legacy = (await sql("SELECT account_ids FROM meta_economy_receipts WHERE receipt_key LIKE 'meta:season-day:%'")).rows;
    assert.deepEqual(legacy, [{ account_ids: [bid] }]);
    assert.equal((await sql('SELECT completed_at IS NOT NULL AS done FROM account_deletions WHERE account_id=$1', [aid])).rows[0].done, true);
    const lines = readdirSync(logs).flatMap(f => readFileSync(join(logs, f), 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l)));
    const actor = id => createHmac('sha256', salt).update(id).digest('hex').slice(0, 16);
    assert.ok(!lines.some(row => row.actor === actor(aid) || row.install === install));
    assert.ok(lines.some(row => row.actor === actor(bid)));
  }
  await verifyErased();
  record('single-database erasure removes private rows/log linkage; other player and shared corporation survive');
  await start();
  assert.equal((await api('/auth/login', aCreds)).status, 401);
  assert.equal((await api('/auth/login', bCreds)).status, 200);
  await stop();
  const started = performance.now();
  await command('bash', ['deploy/restore.sh', archive], { DATABASE_URL: adminUrl,
    BACKUP_REQUIRE_SIGNED: '1', BACKUP_VERIFY_KEY: join(dir, 'verify.pem'), BACKUP_EXPECT_DOMAIN: 'synthetic',
    BACKUP_EXPECT_PRODUCER: 'erasure-drill', BACKUP_EXPECT_ID: backupId, BACKUP_AGE_IDENTITY: join(dir, 'age.key') });
  report.restoreMilliseconds = Math.round(performance.now() - started);
  for (const name of readdirSync(oldLogs)) copyFileSync(join(oldLogs, name), join(logs, name));
  assert.equal((await sql('SELECT 1 FROM users WHERE id=$1', [aid])).rowCount, 1);
  assert.equal((await sql('SELECT 1 FROM account_deletions')).rowCount, 0);
  assert.equal((await sql('SELECT required FROM account_erasure_guard')).rows[0].required, true);
  await start(true); await offline();
  record('old signed snapshot restores data but runtime refuses to boot before erasure replay');
  await worker('--replay'); await verifyErased();
  await worker('--replay'); await verifyErased();
  await start();
  assert.equal((await api('/auth/login', aCreds)).status, 401);
  assert.equal((await api('/auth/login', bCreds)).status, 200);
  assert.equal((await api('/auth/register', aCreds)).status, 409);
  await stop();
  await command(process.execPath, ['packages/server/dist/account-erasure.mjs', '--pending'], erasureEnv, 3);
  record('external ledger replays idempotently; deleted account stays blocked, other player logs in');
  report.ok = true;
} catch (error) {
  writeFileSync(join(dir, 'failure.log'), error instanceof Error ? error.stack ?? error.message : String(error));
  report.ok = false;
  // Only assertions/synthetic fixture values can occur; no database URLs or child environment.
  report.failure = error instanceof assert.AssertionError ? error.message : 'E_DRILL_FAILED';
  process.exitCode = 1;
} finally {
  if (child) await stop().catch(() => child?.kill('SIGKILL'));
  if (containerCreated) await command('docker', ['rm', '-f', '-v', container]).catch(() => {
    report.ok = false; report.failure = 'E_DRILL_CLEANUP'; process.exitCode = 1;
  });
  report.finishedAt = new Date().toISOString();
  writeFileSync(join(dir, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(`Evidence: ${dir}/report.json`);
  console.log(report.ok ? 'PASS isolated erasure/restore drill' : `FAIL ${report.failure}`);
}
