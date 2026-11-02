/** Real production-host code + fixture starting technology; no database or live services.
 * The public gated WS protocol delegates/recalls, then EVERY socket disconnects.
 * Admin metrics only observe: they never join or wake the match. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import WebSocket from 'ws';
import { bundleNetserver } from './bundle-netserver.mjs';

const HOUR = 3600000;
const periodMs = 2000; // 2 game hours / TIME_SCALE 3600.
const serverOutfile = `packages/server/dist/steward-offline-${process.pid}.mjs`;
const marker =
  '  if (AUTH && !restoredSnap) initialState = initializeOrdinaryArsenal(initialState, data);';
const bundle = await bundleNetserver({
  serverOutfile,
  plugins: [
    {
      name: 'steward-starting-state-only',
      setup(build) {
        build.onLoad({ filter: /[/\\]prototype[/\\]netserver\.ts$/ }, async (args) => {
          const source = await readFile(args.path, 'utf8');
          assert.equal(
            source.split(marker).length,
            2,
            'fixture anchor must identify exactly one state initializer',
          );
          return {
            loader: 'ts',
            resolveDir: path.dirname(args.path),
            contents: source.replace(
              marker,
              `
  if (!restoredSnap && !ava) {
    for (const player of Object.values(initialState.players)) {
      if (player.npc) continue;
      player.technologies ??= { completed: [], active: [] };
      player.technologies.completed.push('ai_stewardship');
      player.resources = { ...player.resources, metal:60000, credits:60000, food:60000, energy:60000, microelectronics:6000 };
    }
  }
${marker}`,
            ),
          };
        });
      },
    },
  ],
});

const picker = createServer();
await new Promise((resolve, reject) => {
  picker.once('error', reject);
  picker.listen(0, '127.0.0.1', resolve);
});
const port = picker.address().port;
await new Promise((resolve, reject) =>
  picker.close((error) => (error ? reject(error) : resolve())),
);
const base = `http://127.0.0.1:${port}`;
const secret = randomBytes(32).toString('hex');
let sessionToken;
const env = Object.fromEntries(
  ['PATH', 'SystemRoot', 'WINDIR', 'TMPDIR', 'TEMP', 'TMP'].flatMap((key) =>
    process.env[key] === undefined ? [] : [[key, process.env[key]]],
  ),
);
Object.assign(env, {
  HOST: '127.0.0.1',
  PORT: String(port),
  PROD: '0',
  NODE_ENV: 'test',
  GATE: '1',
  SEAT_LOCK: '1',
  TIME_SCALE: '3600',
  MATCHES: '1',
  AI_GRACE_MS: '0',
  BOT_FILL_PERCENT: '0',
  BOT_ACTIVE_LIMIT: '0',
  ALLOWED_ORIGINS: base,
  AUTH_JWT_SECRET: secret,
});
const server = spawn(process.execPath, [bundle], { env, stdio: ['ignore', 'pipe', 'pipe'] });
let log = '',
  socket,
  failure;
server.once('error', (error) => {
  failure = error;
});
for (const stream of [server.stdout, server.stderr])
  stream.on('data', (chunk) => {
    log = (log + chunk).slice(-10000);
  });
const exited = new Promise((resolve) => server.once('exit', resolve));
const killOnExit = () => server.kill('SIGKILL');
process.on('exit', killOnExit);
const watchdog = setTimeout(killOnExit, 65000);
const clients = new Map();
const manual = new Set();

async function request(route, options = {}, expected = 200) {
  const response = await fetch(base + route, {
    ...options,
    headers: {
      ...(options.body ? { 'content-type': 'application/json' } : {}),
      ...(sessionToken && !route.startsWith('/metrics')
        ? { authorization: `Bearer ${sessionToken}` }
        : {}),
    },
    signal: globalThis.AbortSignal.timeout(3000),
  });
  const body = await response.json();
  assert.equal(response.status, expected, `${route}: ${response.status} ${body.error ?? ''}`);
  return body;
}
async function until(check, description, timeout = 6000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (failure) throw failure;
    assert.equal(server.exitCode, null, `host exited during ${description}: ${log}`);
    const value = await check();
    if (value) return value;
    await delay(80);
  }
  throw new Error(`Timeout: ${description}`);
}
const journal = async () => (await request('/metrics/recent?n=200')).recent;
const ownOrders = (rows, match, after) =>
  rows.filter(
    (row) =>
      row.match === match &&
      row.kind === 'action' &&
      row.playerId === 'p1' &&
      row.ok &&
      !manual.has(row.actionId) &&
      row.t >= after,
  );
async function connect(match) {
  const joined = await request(`/matches/${match}/join?slot=p1`);
  const url = new URL(`${base.replace(/^http/, 'ws')}/matches/${match}`);
  url.searchParams.set('token', joined.token);
  const welcome = await new Promise((resolve, reject) => {
    socket = new WebSocket(url, { origin: base });
    const timer = setTimeout(() => reject(new Error('welcome timeout')), 5000);
    socket.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    socket.on('message', (bytes) => {
      const message = JSON.parse(bytes.toString());
      if (message.type === 'error' || message.type === 'rejection') {
        failure = new Error(`WS rejected: ${message.code}`);
        clearTimeout(timer);
        reject(failure);
      }
      if (message.type === 'welcome') {
        clearTimeout(timer);
        resolve(message);
      }
    });
  });
  assert.equal(welcome.playerId, 'p1');
  assert.equal(welcome.gated, true);
  clients.set(match, { welcome, next: 1 });
  return welcome;
}
async function command(match, type, payload) {
  const client = clients.get(match);
  const { welcome } = client;
  const clientSeq = client.next++;
  const actionId = `${welcome.sessionId}:${welcome.playerId}:${clientSeq}`;
  const issuedAt = Date.now();
  manual.add(actionId);
  socket.send(
    JSON.stringify({
      type: 'action.v1',
      envelope: {
        schemaVersion: 1,
        matchId: match,
        playerId: 'p1',
        sessionId: welcome.sessionId,
        clientSeq,
        actionId,
        issuedAt,
        action: { id: actionId, type, playerId: 'p1', payload, issuedAt },
      },
    }),
  );
  await until(
    async () =>
      (await journal()).some((row) => row.kind === 'action' && row.actionId === actionId && row.ok),
    `accepted ${type}`,
  );
}
async function disconnect() {
  const closing = socket;
  await new Promise((resolve) => {
    const timer = setTimeout(() => {
      closing.terminate();
      resolve();
    }, 2000);
    closing.once('close', () => {
      clearTimeout(timer);
      resolve();
    });
    closing.close();
  });
  await until(async () => (await request('/metrics')).connections === 0, 'all sockets closed');
  // Finish only an already-admitted atomic pair, never a new decision after recall.
  await delay(200);
  return Date.now();
}
async function assertQuiet(match, after, description) {
  await delay(periodMs + 350);
  assert.deepEqual(ownOrders(await journal(), match, after), [], description);
  assert.equal((await request('/metrics')).connections, 0);
}

try {
  await until(
    async () => {
      try {
        return (await request('/health')).ok;
      } catch {
        return false;
      }
    },
    'host startup',
    15000,
  );
  const registered = await request(
    '/auth/register',
    {
      method: 'POST',
      body: JSON.stringify({
        login: `StewardSmoke${randomBytes(4).toString('hex')}`,
        password: `Smoke-aA1-${randomBytes(24).toString('base64url')}`,
      }),
    },
    201,
  );
  sessionToken = registered.token;
  const first = await request('/matches', {
    method: 'POST',
    body: JSON.stringify({ mapId: 'duel-1' }),
  });
  const match = first.matchId;
  await assertQuiet(
    match,
    Date.now(),
    'an ordinary unattended human seat must not get an expansion AI',
  );
  const welcome = await connect(match);
  assert.ok(welcome.state.players.p1.technologies.completed.includes('ai_stewardship'));
  await command(match, 'steward.delegate', {
    posture: 'active_defend',
    until: welcome.state.time + 24 * HOUR,
  });
  const offlineAt = await disconnect();
  const issued = await until(
    async () => {
      const rows = ownOrders(await journal(), match, offlineAt);
      return rows.some((row) => row.type !== 'steward.report') && rows;
    },
    'active Steward issues a real accepted order with zero sockets',
    periodMs * 4 + 600,
  );
  assert.equal((await request('/metrics')).connections, 0);
  assert.ok(issued.some((row) => !row.type.startsWith('steward.')));
  assert.deepEqual(
    (await journal()).filter(
      (row) =>
        row.match === match && row.kind === 'action' && row.playerId !== 'p1' && row.t >= offlineAt,
    ),
    [],
    'the other human seat is not an autonomous bot',
  );
  console.log('Offline Steward orders OK');

  await connect(match);
  await command(match, 'steward.recall', {});
  await assertQuiet(match, await disconnect(), 'recall stops further autonomous orders');
  console.log('Offline Steward recall OK');

  const second = await request('/matches', {
    method: 'POST',
    body: JSON.stringify({ mapId: 'duel-1' }),
  });
  const short = await connect(second.matchId);
  await command(second.matchId, 'steward.delegate', {
    posture: 'defend',
    until: short.state.time + 8 * HOUR,
  });
  const defendAt = await disconnect();
  await until(
    async () =>
      ownOrders(await journal(), second.matchId, defendAt).some(
        (row) => !row.type.startsWith('steward.'),
      ),
    'defensive Steward also issues real offline orders',
    periodMs * 2 + 600,
  );
  console.log('Offline defensive Steward orders OK');
  await until(
    async () =>
      (await journal()).some(
        (row) =>
          row.match === second.matchId &&
          row.kind === 'events' &&
          row.events.some((event) => event.type === 'steward.expired'),
      ),
    'watch expires without reconnecting',
    10000,
  );
  await assertQuiet(
    second.matchId,
    Date.now(),
    'expiry leaves no autonomous orders after the deadline',
  );
  const expired = await connect(second.matchId);
  assert.equal(expired.state.players.p1.steward, undefined);
  await disconnect();
  console.log('Offline Steward expiry OK');
  const metrics = await request('/metrics/summary');
  assert.equal(metrics.deadLetters, 0);
  assert.equal(metrics.advanceOverflows, 0);
  console.log('Steward host regression OK');
} catch (error) {
  process.stderr.write(
    `Steward host test failed: ${error.message}\n${log.replaceAll(secret, '[redacted]')}\n`,
  );
  throw error;
} finally {
  clearTimeout(watchdog);
  socket?.terminate();
  server.kill('SIGTERM');
  await Promise.race([exited, delay(1500)]);
  if (server.exitCode === null && server.signalCode === null) {
    server.kill('SIGKILL');
    await exited;
  }
  process.off('exit', killOnExit);
  await rm(serverOutfile, { force: true });
}
