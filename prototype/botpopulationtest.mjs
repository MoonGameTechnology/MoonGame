#!/usr/bin/env node
/* global AbortSignal */
/** Manual HTTP/WS smoke of the exact netserver bundle used by the production image.
 * Run from the repository root: node prototype/botpopulationtest.mjs
 * Uses an isolated in-memory host; no external database, mail or commerce endpoint. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import WebSocket from 'ws';
import { bundleNetserver } from './bundle-netserver.mjs';

const start = Date.now();
const deadline = start + 50_000;
const report = (stage, detail = {}) => console.log(JSON.stringify({ stage, ...detail }));
const picker = createServer();
await new Promise((resolve, reject) => {
  picker.once('error', reject);
  picker.listen(0, '127.0.0.1', resolve);
});
const port = picker.address().port;
await new Promise((resolve, reject) => picker.close((error) => error ? reject(error) : resolve()));
const base = `http://127.0.0.1:${port}`;
const secret = randomBytes(32).toString('hex');

report('build-production-bundle');
const bundle = await bundleNetserver();
// Allowlist process plumbing instead of inheriting endpoints/credentials from a real deployment.
const env = Object.fromEntries(['PATH', 'SystemRoot', 'WINDIR', 'TMPDIR', 'TEMP', 'TMP']
  .flatMap((key) => process.env[key] === undefined ? [] : [[key, process.env[key]]]));
Object.assign(env, {
  HOST: '127.0.0.1', PORT: String(port), PROD: '0', NODE_ENV: 'test',
  AUTH_JWT_SECRET: secret, ALLOWED_ORIGINS: base, AUTH_RATE_MAX: '200', GATE: '1',
  MATCHES: '1', TIME_SCALE: '7200', BOT_FILL_PERCENT: '35', BOT_ACTIVE_LIMIT: '11',
  BOT_JOIN_MIN_MS: '1000', BOT_JOIN_MAX_MS: '1000',
});
const server = spawn(process.execPath, [bundle], { env, stdio: ['ignore', 'pipe', 'pipe'] });
let log = '';
let spawnError;
server.once('error', (error) => { spawnError = error; });
for (const stream of [server.stdout, server.stderr])
  stream.on('data', (chunk) => { log = (log + chunk).slice(-12_000); });
const exited = new Promise((resolve) => server.once('exit', resolve));
const killAtDeadline = setTimeout(() => server.kill('SIGKILL'), Math.max(1, deadline - Date.now()));
const killOnExit = () => server.kill('SIGKILL');
process.on('exit', killOnExit);
let ws;
let sessionToken;
let joinToken;

async function request(path, options = {}, expected = 200) {
  const response = await fetch(base + path, {
    ...options,
    headers: {
      ...(options.body ? { 'content-type': 'application/json' } : {}),
      // Operator routes accept a direct loopback peer; a human session JWT is
      // intentionally NOT an operator token and must not be sent to those routes.
      ...(sessionToken && !path.startsWith('/metrics') ? { authorization: `Bearer ${sessionToken}` } : {}),
      ...options.headers,
    },
    signal: AbortSignal.timeout(3000),
  });
  const body = await response.json();
  assert.equal(response.status, expected, `${path.split('?')[0]}: ${response.status} ${body.error ?? ''}`);
  return body;
}

async function until(check, description, timeout = 15_000) {
  const untilAt = Math.min(deadline, Date.now() + timeout);
  while (Date.now() < untilAt) {
    if (spawnError) throw spawnError;
    if (server.exitCode !== null || server.signalCode !== null)
      throw new Error(`Host exited during ${description}`);
    const value = await check();
    if (value) return value;
    await delay(150);
  }
  throw new Error(`Timed out: ${description}`);
}

try {
  await until(async () => {
    try { return (await request('/health')).ok; } catch { return false; }
  }, 'host startup', 15_000);
  report('host-ready');

  const login = `BotSmoke${randomBytes(4).toString('hex')}`;
  const password = `Smoke-aA1-${randomBytes(24).toString('base64url')}`;
  const registered = await request('/auth/register', {
    method: 'POST', body: JSON.stringify({ login, password }),
  }, 201);
  assert.equal(typeof registered.token, 'string');
  sessionToken = registered.token;
  const botSeats = (layout) => layout.seats.filter((seat) => seat.taken && !!seat.nick && seat.nick !== login);
  const seeded = await request('/matches/proto/seats');
  assert.equal(botSeats(seeded).length, 0, '35% rounds down to zero on a duel');

  const first = await request('/matches', { method: 'POST', body: JSON.stringify({ mapId: 'ffa-20' }) });
  assert.equal(botSeats(await request(`/matches/${first.matchId}/seats`)).length, 0,
    'no batch at map creation');
  let previousCount = 0;
  const firstLayout = await until(async () => {
    const layout = await request(`/matches/${first.matchId}/seats`);
    const count = botSeats(layout).length;
    assert.ok(count <= previousCount + 1, 'bots arrive one at a time');
    previousCount = count;
    return count === 7 ? layout : false;
  }, 'seven gradual arrivals on a 20-seat map');
  const second = await request('/matches', { method: 'POST', body: JSON.stringify({ mapId: 'ffa-20' }) });
  const secondLayout = await until(async () => {
    const layout = await request(`/matches/${second.matchId}/seats`);
    return botSeats(layout).length === 4 ? layout : false;
  }, 'second map reaches the remaining global capacity');
  await delay(2200);
  assert.equal(botSeats(await request(`/matches/${first.matchId}/seats`)).length, 7, 'per-map cap holds');
  assert.equal(botSeats(await request(`/matches/${second.matchId}/seats`)).length, 4, 'global cap holds');
  assert.equal(firstLayout.seats.length, 20);
  assert.equal(secondLayout.seats.length, 20);
  const allBots = [...botSeats(firstLayout), ...botSeats(secondLayout)];
  assert.equal(new Set(allBots.map((seat) => seat.nick)).size, 11, 'identities never repeat');
  report('population-cap', { bootstrap: 0, first: 7, second: 4, activeLimit: 11 });

  for (const bot of allBots) {
    const profile = await request(`/profiles?login=${encodeURIComponent(bot.nick)}`);
    assert.deepEqual(Object.keys(profile).sort(), ['kind', 'login', 'portrait', 'progress', 'recentMatches', 'slots', 'xp']);
    assert.equal(profile.kind, 'bot');
    assert.equal(profile.login, bot.nick);
    assert.equal(profile.xp, 0);
    assert.deepEqual(profile.progress, {});
    assert.deepEqual(profile.recentMatches, []);
    assert.ok(profile.slots.every((slot) => slot === null));
    assert.ok(!JSON.stringify(profile).includes('system-bot:'), 'public profiles contain no private system ID');
  }
  const refused = await request('/auth/register', {
    method: 'POST', body: JSON.stringify({ login: allBots[0].nick, password }),
  }, 409);
  assert.equal(refused.error, 'E_LOGIN_TAKEN', 'the bot namespace cannot be registered');
  const empty = await request('/metrics');
  assert.equal(empty.connections, 0);
  assert.equal((await request('/metrics/summary')).joins, 0);
  report('profiles-and-identity', { checked: allBots.length, earnedXp: 0, inventedHistory: false, humanConnections: 0 });

  const owned = new Map([
    [first.matchId, new Set(botSeats(firstLayout).map((seat) => seat.playerId))],
    [second.matchId, new Set(botSeats(secondLayout).map((seat) => seat.playerId))],
  ]);
  const orders = new Map();
  await until(async () => {
    const journal = await request('/metrics/recent?n=200');
    for (const row of journal.recent) {
      if (row.kind === 'action' && row.ok && owned.get(row.match)?.has(row.playerId) &&
          /^(fleet\.|building\.|unit\.|technology\.)/.test(row.type)) orders.set(row.match, row.type);
    }
    assert.equal((await request('/metrics/summary')).joins, 0, 'AI work must precede any human WebSocket');
    return orders.size === 2;
  }, 'both unwatched FFA rooms issue real successful bot orders', 22_000);
  assert.equal((await request('/metrics')).connections, 0);
  report('zero-peer-ai', { firstOrder: orders.get(first.matchId), secondOrder: orders.get(second.matchId), joins: 0, connections: 0 });

  const occupiedBot = botSeats(firstLayout)[0];
  const joined = await request(`/matches/${first.matchId}/join?slot=${encodeURIComponent(occupiedBot.playerId)}&nick=${encodeURIComponent(occupiedBot.nick)}`);
  assert.ok(!botSeats(firstLayout).some((seat) => seat.playerId === joined.playerId), 'a human never takes a dedicated bot seat');
  joinToken = joined.token;
  assert.equal((await request('/metrics/summary')).joins, 0, 'HTTP reservation is not a fabricated connection');
  const welcome = await new Promise((resolve, reject) => {
    ws = new WebSocket(`${base.replace(/^http/, 'ws')}/matches/${first.matchId}?token=${encodeURIComponent(joinToken)}`, { origin: base });
    const timer = setTimeout(() => reject(new Error('Authenticated welcome timeout')), 5000);
    ws.once('error', (error) => { clearTimeout(timer); reject(error); });
    ws.on('message', (bytes) => {
      const message = JSON.parse(bytes.toString());
      if (message.type === 'error') { clearTimeout(timer); reject(new Error(`WS ${message.code}`)); }
      if (message.type === 'welcome') { clearTimeout(timer); resolve(message); }
    });
  });
  assert.equal(welcome.playerId, joined.playerId);
  const afterJoin = await request(`/matches/${first.matchId}/seats`);
  assert.equal(afterJoin.seats.find((seat) => seat.playerId === joined.playerId)?.nick, login);
  assert.deepEqual(botSeats(afterJoin), botSeats(firstLayout));
  assert.equal((await request('/metrics')).connections, 1);
  assert.equal((await request('/metrics/summary')).joins, 1);
  ws.close();
  await until(async () => (await request('/metrics')).connections === 0, 'human socket closes', 3000);
  const finalMetrics = await request('/metrics/summary');
  assert.equal(finalMetrics.joins, 1);
  assert.equal(finalMetrics.leaves, 1);
  assert.equal(finalMetrics.deadLetters, 0);
  assert.equal(finalMetrics.advanceOverflows, 0);
  report('PASS', { durationMs: Date.now() - start, botProfiles: 11, joins: 1, leaves: 1, connections: 0 });
} catch (error) {
  let safeLog = log.replaceAll(secret, '[redacted]');
  if (sessionToken) safeLog = safeLog.replaceAll(sessionToken, '[redacted]');
  if (joinToken) safeLog = safeLog.replaceAll(joinToken, '[redacted]');
  process.stderr.write(`bot population host smoke failed: ${error.message}\n${safeLog}\n`);
  throw error;
} finally {
  clearTimeout(killAtDeadline);
  ws?.terminate();
  server.kill('SIGTERM');
  await Promise.race([exited, delay(1500)]);
  if (server.exitCode === null && server.signalCode === null) {
    server.kill('SIGKILL');
    await exited;
  }
  process.off('exit', killOnExit);
}
