#!/usr/bin/env node
/* global AbortSignal */
/** Real production-bundle HTTP/WS smoke, isolated memory host, one actual human
 * socket. Covers bot DM admission, sparse scheduling and flood/privacy bounds.
 * Delayed replies and diplomatic consent are covered by fake-clock unit tests. No production database, mailer or external service is inherited. */
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { build } from 'esbuild';
import WebSocket from 'ws';
import { bundleNetserver } from './bundle-netserver.mjs';

const start = Date.now(),
  deadline = start + 50_000;
const report = (stage, detail = {}) => console.log(JSON.stringify({ stage, ...detail }));
const secret = randomBytes(32).toString('hex');
const password = `Smoke-aA1-${randomBytes(24).toString('base64url')}`;
let server, ws, sessionToken, joinToken, spawnError, socketError, welcome, state;
let hostStartedAt,
  exited,
  log = '';
const chats = [],
  errors = [];
const safe = (raw) =>
  [secret, password, sessionToken, joinToken]
    .filter(Boolean)
    .reduce((text, value) => text.replaceAll(value, '[redacted]'), String(raw))
    .replace(/([?&]token=)[^&\s)]+/g, '$1[redacted]');
const killOnExit = () => server?.kill('SIGKILL');
process.on('exit', killOnExit);
const watchdog = setTimeout(() => {
  ws?.terminate();
  server?.kill('SIGKILL');
  process.stderr.write('bot social host smoke: E_SMOKE_TIMEOUT\n');
  process.exit(1);
}, 50_000);

async function until(check, description, timeout = 5000) {
  const end = Math.min(deadline - 1500, Date.now() + timeout);
  while (Date.now() < end) {
    if (spawnError) throw new Error('E_SMOKE_SPAWN');
    if (socketError) throw new Error('E_SMOKE_SOCKET');
    if (server && (server.exitCode !== null || server.signalCode !== null))
      throw new Error('Host exited during ' + description);
    const value = await check();
    if (value) return value;
    await delay(100);
  }
  throw new Error('Timed out: ' + description);
}
const picker = createServer();
let base;
async function request(path, options = {}, expected = 200) {
  const response = await fetch(base + path, {
    ...options,
    headers: {
      ...(options.body ? { 'content-type': 'application/json' } : {}),
      ...(sessionToken && !path.startsWith('/metrics')
        ? { authorization: `Bearer ${sessionToken}` }
        : {}),
    },
    signal: AbortSignal.timeout(3000),
  });
  const body = await response.json();
  assert.equal(
    response.status,
    expected,
    `${path.split('?')[0]}: ${response.status} ${body.error ?? ''}`,
  );
  return body;
}
function hostCpuMs() {
  try {
    const result = spawnSync('getconf', ['CLK_TCK'], { encoding: 'utf8', timeout: 1000 });
    const hz = Number(result.stdout.trim());
    assert.ok(result.status === 0 && hz > 0);
    const stat = readFileSync(`/proc/${server.pid}/stat`, 'utf8');
    const fields = stat
      .slice(stat.lastIndexOf(')') + 2)
      .trim()
      .split(/\s+/);
    return Math.round(((Number(fields[11]) + Number(fields[12])) * 1000) / hz);
  } catch {
    return null;
  } // Non-Linux hosts do not expose /proc process accounting.
}

try {
  await new Promise((resolve, reject) => {
    picker.once('error', reject);
    picker.listen(0, '127.0.0.1', resolve);
  });
  const port = picker.address().port;
  await new Promise((resolve, reject) =>
    picker.close((error) => (error ? reject(error) : resolve())),
  );
  base = `http://127.0.0.1:${port}`;
  report('build-production-bundle');
  const bundle = await bundleNetserver();
  // Reuse the shipped protocol delta/envelope and presentation adapter, rather
  // than inventing a second wire implementation or duplicate translated prose.
  const built = await build({
    stdin: {
      contents: `export { applyDelta, getStance } from './packages/shared-core/src/index';
      export { createActionEnvelope } from './packages/action-layer/src/envelope';
      export { SYSTEM_BOT_ROSTER } from './packages/server/src/botRoster';`,
      resolveDir: process.cwd(),
      loader: 'ts',
    },
    bundle: true,
    platform: 'node',
    format: 'cjs',
    write: false,
  });
  const mod = { exports: {} };
  new Function('module', 'exports', built.outputFiles[0].text)(mod, mod.exports);
  const { applyDelta, getStance, SYSTEM_BOT_ROSTER } = mod.exports;
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
    AUTH_JWT_SECRET: secret,
    ALLOWED_ORIGINS: base,
    AUTH_RATE_MAX: '200',
    GATE: '1',
    MATCHES: '1',
    TIME_SCALE: '24',
    BOT_FILL_PERCENT: '35',
    BOT_ACTIVE_LIMIT: '7',
    BOT_JOIN_MIN_MS: '1000',
    BOT_JOIN_MAX_MS: '1000',
  });
  hostStartedAt = Date.now();
  server = spawn(process.execPath, [bundle], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  server.once('error', (error) => {
    spawnError = error;
  });
  exited = new Promise((resolve) => server.once('close', resolve));
  for (const stream of [server.stdout, server.stderr])
    stream.on('data', (chunk) => {
      log = (log + chunk).slice(-12_000);
    });
  await until(
    async () => {
      try {
        return (await request('/health')).ok;
      } catch {
        return false;
      }
    },
    'host startup',
    10_000,
  );
  const registered = await request(
    '/auth/register',
    {
      method: 'POST',
      body: JSON.stringify({ login: `BotChat${randomBytes(4).toString('hex')}`, password }),
    },
    201,
  );
  sessionToken = registered.token;
  assert.equal(typeof sessionToken, 'string');
  const match = await request('/matches', {
    method: 'POST',
    body: JSON.stringify({ mapId: 'ffa-20' }),
  });
  const layout = await until(
    async () => {
      const current = await request(`/matches/${match.matchId}/seats`);
      const known = new Set(SYSTEM_BOT_ROSTER.map((identity) => identity.login));
      return current.seats.filter((seat) => seat.taken && known.has(seat.nick)).length === 7
        ? current
        : false;
    },
    'seven gradual bot arrivals',
    12_000,
  );
  assert.equal(layout.seats.length, 20);
  const botSeats = SYSTEM_BOT_ROSTER.slice(0, 7).map((identity) => {
    const seat = layout.seats.find((candidate) => candidate.nick === identity.login);
    assert.ok(seat, 'catalogue identity was admitted');
    return seat.playerId;
  });
  const [firstBot, secondBot] = botSeats;
  assert.equal((await request('/metrics/summary')).joins, 0);
  const joined = await request(`/matches/${match.matchId}/join`);
  joinToken = joined.token;
  ws = new WebSocket(
    `${base.replace(/^http/, 'ws')}/matches/${match.matchId}?token=${encodeURIComponent(joinToken)}`,
    { origin: base },
  );
  ws.on('error', () => {
    socketError = true;
  });
  ws.on('message', (bytes) => {
    try {
      const message = JSON.parse(bytes.toString());
      if (message.type === 'welcome') welcome = message;
      if (message.type === 'welcome' || message.type === 'state') state = message.state;
      if (message.type === 'delta') state = applyDelta(state, message.delta);
      if (message.type === 'chat.msg' && chats.length < 100) chats.push(message.message);
      if ((message.type === 'error' || message.type === 'rejection') && errors.length < 100)
        errors.push({ type: message.type, code: message.code });
    } catch {
      socketError = true;
    }
  });
  await until(() => welcome, 'authenticated welcome');
  assert.equal(welcome.playerId, joined.playerId);
  assert.equal(welcome.gated, true);
  const me = welcome.playerId;
  const replies = () => chats.filter((m) => m.from !== me);
  const chat = (text, to, channel = 'dm', extra = {}) =>
    ws.send(JSON.stringify({ type: 'chat.send', text, channel, ...(to ? { to } : {}), ...extra }));
  const nonce = randomBytes(12).toString('hex');
  chat('hello public-' + nonce, undefined, 'session');
  await delay(500);
  assert.equal(replies().length, 0, 'public chat never starts a bot reply');
  // Regardless of whether a rare availability window is open, no response can
  // arrive before twelve real seconds. This exercises the actual production
  // scheduler without a special environment flag or substituted implementation.
  const acceptedAt = Date.now();
  const privateNonce = 'private-' + randomBytes(12).toString('hex');
  chat('привет ' + privateNonce, firstBot, 'dm', { from: secondBot });
  for (let index = 0; index < 20; index++) chat('hello flood-' + index, firstBot);
  await until(
    () => chats.some((message) => message.text === 'привет ' + privateNonce),
    'accepted private DM',
  );
  assert.equal(
    chats.find((message) => message.text.includes(privateNonce)).from,
    me,
    'sender spoofing is ignored',
  );
  await until(() => errors.some((error) => error.code === 'E_CHAT_RATE'), 'flood is rate limited');
  await delay(4200);
  assert.ok(Date.now() - acceptedAt < 12_000, 'observation stays below minimum reply delay');
  assert.equal(replies().length, 0, 'bots never reply instantly or cascade after a burst');
  assert.ok(
    chats.every((message) => message.from === me),
    'bot traffic never impersonates a human',
  );
  assert.ok(
    chats
      .filter((message) => message.text.includes(privateNonce))
      .every((message) => message.channel === 'dm' && message.to === firstBot),
    'private text stays private',
  );
  assert.equal(getStance(state, me, firstBot), 'peace', 'foreign DM does not change diplomacy');
  assert.ok(errors.every((error) => error.type === 'error' && error.code === 'E_CHAT_RATE'));
  assert.equal((await request('/metrics')).connections, 1);
  assert.equal((await request('/metrics/summary')).joins, 1);
  const cpuMs = hostCpuMs();
  ws.close();
  await until(
    async () => (await request('/metrics')).connections === 0,
    'human socket closes',
    3000,
  );
  const metrics = await request('/metrics/summary');
  assert.equal(metrics.joins, 1);
  assert.equal(metrics.leaves, 1);
  assert.equal(metrics.deadLetters, 0);
  assert.equal(metrics.advanceOverflows, 0);
  report('PASS', {
    elapsedMs: Date.now() - start,
    hostElapsedMs: Date.now() - hostStartedAt,
    actualBotReplies: replies().length,
    scheduledDelayMinMs: 12_000,
    joins: 1,
    leaves: 1,
    connections: 0,
    childCpuMs: cpuMs,
    cpuScope: 'Whole isolated host scenario including startup/world/AI; not per-reply cost.',
  });
} catch (error) {
  process.stderr.write(
    'bot social host smoke failed: ' + safe(error.message) + '\n' + safe(log) + '\n',
  );
  process.exitCode = 1;
} finally {
  if (picker.listening) await new Promise((resolve) => picker.close(resolve));
  ws?.terminate();
  server?.kill('SIGTERM');
  if (exited) await Promise.race([exited, delay(1500)]);
  if (server?.pid && server.exitCode === null && server.signalCode === null) {
    server.kill('SIGKILL');
    if (exited) await Promise.race([exited, delay(1000)]);
  }
  clearTimeout(watchdog);
  process.off('exit', killOnExit);
}
