#!/usr/bin/env node
/* global AbortSignal */
/** Real, sequential load samples of the production netserver bundle on Linux.
 * Run: nice -n 15 taskset -c 2 node prototype/bot-load-perf.mjs
 * Small validation: add --limits=2 --observe-ms=10000.
 * In-memory stores, no human sockets, three identical FFA-20 maps plus the same
 * bootstrap duel in EVERY case. This measures early accelerated AI work, not
 * PostgreSQL, mature battles, human fan-out or the capacity of a production VPS.
 */
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtemp, readFile, rm, symlink } from 'node:fs/promises';
import { createServer } from 'node:net';
import { availableParallelism, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { bundleNetserver } from './bundle-netserver.mjs';

const args = new Map(process.argv.slice(2).map((arg) => {
  const match = /^--([a-z-]+)=(.+)$/.exec(arg);
  assert.ok(match, `Expected --name=value, received ${arg}`);
  return [match[1], match[2]];
}));
assert.equal(args.size, process.argv.length - 2, 'Duplicate option');
const known = new Set(['limits', 'observe-ms', 'warmup-ms', 'time-scale', 'probe-ms']);
for (const key of args.keys()) assert.ok(known.has(key), `Unknown option ${key}`);
function integer(key, fallback, min, max) {
  const raw = args.get(key) ?? String(fallback);
  assert.match(raw, /^(0|[1-9][0-9]*)$/);
  const value = Number(raw);
  assert.ok(Number.isSafeInteger(value) && value >= min && value <= max, `Invalid ${key}`);
  return value;
}
const limits = (args.get('limits') ?? '0,2,7,20').split(',').map((raw) => {
  assert.match(raw, /^(0|2|7|20)$/);
  return Number(raw);
});
assert.equal(new Set(limits).size, limits.length, 'Duplicate limit');
const observeMs = integer('observe-ms', 30_000, 1000, 60_000);
const warmupMs = integer('warmup-ms', 30_000, 10_000, 60_000);
const timeScale = integer('time-scale', 1440, 720, 1440);
const probeMs = integer('probe-ms', 250, 100, 1000);
assert.equal(process.platform, 'linux', 'CPU/RSS samples require Linux /proc');
const clockTicks = Number(execFileSync('getconf', ['CLK_TCK'], { encoding: 'utf8' }).trim());
assert.ok(Number.isFinite(clockTicks) && clockTicks > 0);
const report = (value) => console.log(JSON.stringify(value));
const provenance = {
  revision: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  workingTreeDirty: execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim() !== '',
  node: process.version,
  availableCpus: availableParallelism(),
  affinity: (await readFile('/proc/self/status', 'utf8')).match(/^Cpus_allowed_list:\s*(.+)$/m)?.[1],
};
report({ stage: 'build', ...provenance });
const bundle = resolve(await bundleNetserver());

async function freePort() {
  const picker = createServer();
  await new Promise((resolve, reject) => {
    picker.once('error', reject);
    picker.listen(0, '127.0.0.1', resolve);
  });
  const port = picker.address().port;
  await new Promise((resolve, reject) => picker.close((error) => error ? reject(error) : resolve()));
  return port;
}

async function processSample(pid) {
  const [stat, status] = await Promise.all([
    readFile(`/proc/${pid}/stat`, 'utf8'),
    readFile(`/proc/${pid}/status`, 'utf8'),
  ]);
  const fields = stat.slice(stat.lastIndexOf(')') + 2).trim().split(/\s+/);
  const kb = (key) => Number(status.match(new RegExp(`^${key}:\\s+(\\d+)`, 'm'))?.[1]);
  const sample = {
    cpuMs: (Number(fields[11]) + Number(fields[12])) * 1000 / clockTicks,
    rssMiB: kb('VmRSS') / 1024,
    peakRssMiB: kb('VmHWM') / 1024,
  };
  assert.ok(Object.values(sample).every(Number.isFinite), 'Invalid child /proc sample');
  return sample;
}
function percentile(values, fraction) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)] ?? null;
}
const rounded = (n) => Math.round(n * 1000) / 1000;

async function runCase(activeLimit) {
  const dir = await mkdtemp(join(tmpdir(), 'moongame-bot-load-'));
  // The production host reads some shipped catalogs relative to cwd. Its journals
  // stay in this disposable directory; catalogs come from this worktree only.
  await symlink(resolve('data'), join(dir, 'data'), 'dir');
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  const secret = randomBytes(32).toString('hex');
  const password = `Load-aA1-${randomBytes(24).toString('base64url')}`;
  // Explicit plumbing allowlist: never inherit DATABASE_URL, mail, registry,
  // corporate/commerce endpoints, NODE_OPTIONS or deployment credentials.
  const env = Object.fromEntries(['PATH', 'TMPDIR', 'TMP', 'TEMP']
    .flatMap((key) => process.env[key] === undefined ? [] : [[key, process.env[key]]]));
  Object.assign(env, {
    HOST: '127.0.0.1', PORT: String(port), PROD: '0', NODE_ENV: 'test',
    AUTH_JWT_SECRET: secret, ALLOWED_ORIGINS: base, GATE: '1', AUTH_RATE_MAX: '200',
    MATCHES: '1', TIME_SCALE: String(timeScale), BOT_FILL_PERCENT: '35',
    BOT_ACTIVE_LIMIT: String(activeLimit), BOT_JOIN_MIN_MS: '1000', BOT_JOIN_MAX_MS: '1000',
  });
  const child = spawn(process.execPath, ['--max-old-space-size=512', bundle], {
    cwd: dir, env, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let spawnError;
  let log = '';
  let token;
  child.once('error', (error) => { spawnError = error; });
  for (const stream of [child.stdout, child.stderr])
    stream.on('data', (chunk) => { log = (log + chunk).slice(-8000); });
  const exited = new Promise((resolve) => child.once('exit', resolve));
  const stop = () => child.kill('SIGKILL');
  const watchdog = setTimeout(stop, 20_000 + warmupMs + observeMs);
  process.on('exit', stop);
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  function alive() {
    if (spawnError) throw spawnError;
    assert.equal(child.exitCode, null, 'Production host exited');
    assert.equal(child.signalCode, null, 'Production host was terminated');
  }
  async function request(path, options = {}, expected = 200) {
    alive();
    const response = await fetch(base + path, {
      ...options,
      headers: {
        ...(options.body ? { 'content-type': 'application/json' } : {}),
        ...(token && !path.startsWith('/metrics') ? { authorization: `Bearer ${token}` } : {}),
      },
      signal: AbortSignal.timeout(3000),
    });
    const body = await response.json();
    assert.equal(response.status, expected, `${path}: HTTP ${response.status}`);
    return body;
  }
  const botSeats = (layout) => layout.seats.filter((seat) => seat.taken && seat.nick?.startsWith('~'));
  try {
    const startupDeadline = Date.now() + 15_000;
    let ready = false;
    while (Date.now() < startupDeadline) {
      alive();
      try { ready = (await request('/health')).ok === true; } catch { /* bounded startup only */ }
      if (ready) break;
      await delay(100);
    }
    assert.ok(ready, 'Production host startup timeout');
    const registered = await request('/auth/register', {
      method: 'POST', body: JSON.stringify({ login: 'BotLoadObserver', password }),
    }, 201);
    token = registered.token;
    assert.equal(typeof token, 'string');
    const ids = [];
    for (let n = 0; n < 3; n++) {
      const created = await request('/matches', {
        method: 'POST', body: JSON.stringify({ mapId: 'ffa-20' }),
      });
      ids.push(created.matchId);
    }
    const layouts = () => Promise.all(ids.map((id) => request(`/matches/${id}/seats`)));
    const warmedAt = Date.now();
    let seats;
    do {
      seats = await layouts();
      if (seats.reduce((sum, layout) => sum + botSeats(layout).length, 0) === activeLimit) break;
      await delay(100);
    } while (Date.now() - warmedAt < warmupMs);
    const distribution = seats.map((layout) => botSeats(layout).length);
    assert.equal(distribution.reduce((a, b) => a + b, 0), activeLimit, 'Population warmup timeout');
    assert.ok(distribution.every((n) => n <= 7), 'FFA20 bot cap exceeded');
    assert.ok(seats.every((layout) => layout.seats.length === 20), 'Map differs between cases');
    assert.equal(botSeats(await request('/matches/proto/seats')).length, 0, 'Duel gained a bot');
    const owned = new Map(ids.map((id, i) => [id, new Set(botSeats(seats[i]).map((seat) => seat.playerId))]));
    const before = await request('/metrics/summary');
    const initial = await processSample(child.pid);
    const wallStart = performance.now();
    const wallTimestamp = Date.now();
    const samples = [];
    const latencies = [];
    const probeLag = [];
    let healthFailures = 0;
    let nextProbe = wallStart;
    report({ stage: 'observing', activeLimit, distribution, warmupMs: Date.now() - warmedAt });
    while (performance.now() - wallStart < observeMs) {
      alive();
      probeLag.push(Math.max(0, performance.now() - nextProbe));
      const start = performance.now();
      try {
        assert.equal((await request('/health')).ok, true);
        latencies.push(performance.now() - start);
      } catch { healthFailures++; }
      samples.push(await processSample(child.pid));
      nextProbe += probeMs;
      // Never queue catch-up probes after a slow response.
      nextProbe = Math.max(nextProbe, performance.now());
      await delay(Math.max(0, Math.min(nextProbe, wallStart + observeMs) - performance.now()));
    }
    const wallMs = performance.now() - wallStart;
    const final = await processSample(child.pid);
    const after = await request('/metrics/summary');
    // The zero-bot baseline legitimately has no observations and therefore no
    // journal file. Active cases must still prove real orders from the journal.
    const journal = activeLimit === 0 ? { recent: [] } : await request('/metrics/recent?n=200');
    const metrics = await request('/metrics');
    const finalDistribution = (await layouts()).map((layout) => botSeats(layout).length);
    assert.deepEqual(finalDistribution, distribution, 'Population changed during observation');
    const orders = journal.recent.filter((row) => row.kind === 'action' && row.ok &&
      row.t >= wallTimestamp && owned.get(row.match)?.has(row.playerId) &&
      /^(fleet\.|building\.|unit\.|technology\.)/.test(row.type));
    const sampledRooms = new Set(orders.map((row) => row.match));
    const perType = Object.fromEntries(Object.keys(after.actions.byType).map((type) =>
      [type, after.actions.byType[type] - (before.actions.byType[type] ?? 0)]).filter(([, n]) => n > 0));
    const cpuMs = final.cpuMs - initial.cpuMs;
    const result = {
      stage: 'result', activeLimit, distribution, mapId: 'ffa-20', seed: 'prototype-1', maps: 3, bootstrapDuel: 1,
      fillPercent: 35, timeScale, observeMs: rounded(wallMs),
      gameHoursObserved: rounded(wallMs * timeScale / 3_600_000),
      cpuMs: rounded(cpuMs), cpuPercentOfOneCore: rounded(cpuMs * 100 / wallMs),
      rssMiB: {
        initial: rounded(initial.rssMiB), final: rounded(final.rssMiB),
        mean: rounded(samples.reduce((sum, sample) => sum + sample.rssMiB, 0) / samples.length),
        peak: rounded(Math.max(initial.peakRssMiB, final.peakRssMiB, ...samples.map((s) => s.peakRssMiB))),
      },
      health: { samples: latencies.length, failures: healthFailures,
        p95Ms: rounded(percentile(latencies, 0.95) ?? 0), maxMs: rounded(Math.max(0, ...latencies)),
        callerScheduleLagP95Ms: rounded(percentile(probeLag, 0.95) ?? 0) },
      actions: { ok: after.actions.ok - before.actions.ok,
        rejected: after.actions.rejected - before.actions.rejected, byType: perType,
        botGameplaySamples: orders.length, botRoomsWithOrders: sampledRooms.size },
      deadLetters: after.deadLetters - before.deadLetters,
      advanceOverflows: after.advanceOverflows - before.advanceOverflows,
      humanJoins: after.joins, connections: metrics.connections,
      submitMs: after.submitMs, advanceMs: after.advanceMs,
      provenance,
      limitations: ['in-memory, no PostgreSQL', 'no human WebSockets or fan-out',
        'early accelerated game hours, no mature battles', 'one sample per case, not VPS capacity',
        'health HTTP includes caller scheduling; caller lag is not server event-loop delay',
        'RSS high-water mark includes startup; child heap capped at 512MiB'],
    };
    report(result);
    assert.equal(healthFailures, 0, 'Health probes failed');
    assert.equal(after.joins, 0, 'Synthetic human join');
    assert.equal(metrics.connections, 0, 'Synthetic human connection');
    assert.equal(after.deadLetters, 0, 'Failed scheduled world event');
    assert.equal(after.advanceOverflows, 0, 'World catch-up overflow');
    if (activeLimit > 0) {
      assert.ok(result.actions.ok > 0, 'No successful actions observed');
      assert.equal(sampledRooms.size, distribution.filter((n) => n > 0).length,
        'Every populated room must issue real successful gameplay orders during observation');
    } else assert.equal(result.actions.ok, 0, 'Zero-bot baseline issued actions');
  } catch (error) {
    let safeLog = log.replaceAll(secret, '[redacted]').replaceAll(password, '[redacted]');
    if (token) safeLog = safeLog.replaceAll(token, '[redacted]');
    process.stderr.write(`Bot load case ${activeLimit} failed: ${error.message}\n${safeLog}\n`);
    throw error;
  } finally {
    clearTimeout(watchdog);
    child.kill('SIGTERM');
    await Promise.race([exited, delay(1500)]);
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGKILL');
      await Promise.race([exited, delay(1000)]);
    }
    process.off('exit', stop);
    process.off('SIGINT', stop);
    process.off('SIGTERM', stop);
    await rm(dir, { recursive: true, force: true });
  }
}

for (const limit of limits) await runCase(limit);
report({ stage: 'PASS', cases: limits.length });
