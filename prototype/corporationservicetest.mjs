// Real independent-process failure test. Only explicitly named local test databases.
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdtempSync, openSync, closeSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { bundleNetserver } from './bundle-netserver.mjs';
const require = createRequire(new URL('../packages/server/package.json', import.meta.url));
const { Pool } = require('pg');
const gameUrl = process.env.GAME_TEST_DATABASE_URL,
  corpUrl = process.env.CORPORATIONS_TEST_DATABASE_URL;
for (const value of [gameUrl, corpUrl]) {
  const url = value ? new URL(value) : null;
  assert(
    url && ['127.0.0.1', 'localhost'].includes(url.hostname) && url.pathname.endsWith('_test'),
    'Provide two local *_test database URLs',
  );
}
assert.notEqual(gameUrl, corpUrl);
await bundleNetserver();
const artifacts =
  process.env.CORPORATIONS_SMOKE_ARTIFACTS ?? mkdtempSync(join(tmpdir(), 'corp-service-smoke-'));
const key = randomBytes(32).toString('hex'),
  secret = randomBytes(32).toString('hex');
const children = new Set();
const files = [];
function launch(file, env, name) {
  const fd = openSync(join(artifacts, `${name}.log`), 'a');
  files.push(fd);
  const base = { ...process.env, ...env };
  for (const k of [
    'PROD',
    'TLS_KEY_FILE',
    'TLS_CERT_FILE',
    'RESET_BASE_URL',
    'SMTP_HOST',
    'AUTH_JWT_PREVIOUS_SECRET',
    'AUTH_JWT_PREVIOUS_UNTIL',
  ])
    delete base[k];
  const child = spawn(process.execPath, [file], { env: base, stdio: ['ignore', fd, fd] });
  children.add(child);
  return child;
}
async function stop(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  await new Promise((resolve) => {
    const timer = setTimeout(() => child.kill('SIGKILL'), 4000);
    child.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
    child.kill('SIGTERM');
  });
}
async function request(port, path, token, body) {
  const response = await fetch(`http://127.0.0.1:${port}${path}`, {
    method: body ? 'POST' : 'GET',
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: globalThis.AbortSignal.timeout(5000),
  });
  return { status: response.status, body: await response.json() };
}
async function ready(port, child) {
  for (let i = 0; i < 100; i++) {
    assert(child.exitCode === null && child.signalCode === null, 'test process exited');
    try {
      if ((await request(port, '/ready')).status === 200) return;
    } catch {
      /* Startup readiness can precede the listening socket. */
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw Error('test process did not become ready');
}
const gamePort = Number(process.env.GAME_TEST_PORT ?? 18891),
  corpPort = Number(process.env.CORPORATIONS_TEST_PORT ?? 18892);
let corp;
const db = new Pool({ connectionString: gameUrl });
try {
  const game = launch(
    'packages/server/dist/proto-server.mjs',
    {
      HOST: '127.0.0.1',
      PORT: String(gamePort),
      DATABASE_URL: gameUrl,
      AUTH_JWT_SECRET: secret,
      GATE: '1',
      CORPORATIONS_KEY: key,
      CORPORATIONS_URL: `http://127.0.0.1:${corpPort}`,
    },
    'game',
  );
  await ready(gamePort, game);
  assert.equal((await request(gamePort, '/matches')).status, 200);
  // Cold boot also succeeds before the independent service has started.
  corp = launch(
    'packages/server/dist/corporation-server.mjs',
    { HOST: '127.0.0.1', PORT: String(corpPort), DATABASE_URL: corpUrl, CORPORATIONS_KEY: key },
    'corporations',
  );
  await ready(corpPort, corp);
  const suffix = randomBytes(5).toString('hex');
  const registered = await request(gamePort, '/auth/register', null, {
    login: `Probe${suffix}`,
    password: 'Synthetic-Playtest-762!',
  });
  assert.equal(registered.status, 201);
  const token = registered.body.token;
  const created = await request(gamePort, '/corps', token, { name: `Probe ${suffix}` });
  assert.equal(created.status, 201);
  const corpId = created.body.corpId;
  assert(corpId);
  assert.equal((await request(corpPort, '/corps/me')).status, 401);
  await db.query(
    "INSERT INTO arsenal(item_id,account_id,kind,form,def_id,grade,soulbound,durability,origin,acquired_at) VALUES($1,$2,'hull','instance','cruiser',0,false,5,'drop',0)",
    [`inventory-${suffix}`, registered.body.accountId],
  );
  assert.equal(
    (await request(gamePort, '/arsenal/me', token)).body.items[0].itemId,
    `inventory-${suffix}`,
  );
  await stop(corp);
  const unavailable = await request(gamePort, '/corps/me', token);
  assert.equal(unavailable.status, 503);
  assert.equal((await request(gamePort, '/arsenal/me', token)).status, 200);
  assert.equal((await request(gamePort, '/matches', token)).status, 200);
  const newAccount = await request(gamePort, '/auth/register', null, {
    login: `Other${suffix}`,
    password: 'Synthetic-Playtest-762!',
  });
  assert.equal(newAccount.status, 201);
  corp = launch(
    'packages/server/dist/corporation-server.mjs',
    { HOST: '127.0.0.1', PORT: String(corpPort), DATABASE_URL: corpUrl, CORPORATIONS_KEY: key },
    'corporations-restarted',
  );
  await ready(corpPort, corp);
  const restored = await request(gamePort, '/corps/me', token);
  assert.equal(restored.status, 200);
  assert.equal(restored.body.membership.corpId, corpId);
  const unauthorized = await request(gamePort, `/corps/${corpId}/role`, newAccount.body.token, {
    target: registered.body.accountId,
    role: 'officer',
  });
  assert.equal(unauthorized.status, 403);
  console.log(
    JSON.stringify({
      ok: true,
      independentDatabases: true,
      coldBootWithoutCorporations: true,
      corporateOutageStatus: unavailable.status,
      inventoryAvailable: true,
      matchesAvailable: true,
      registrationAvailable: true,
      membershipSurvivesRestart: true,
      unauthorizedRoleRejected: true,
      artifacts,
    }),
  );
} finally {
  await Promise.all([...children].map(stop));
  await db.end();
  for (const fd of files) closeSync(fd);
}
