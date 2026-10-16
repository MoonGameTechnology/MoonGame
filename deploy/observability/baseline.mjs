/* global AbortSignal */
// OBS-0.1: manual, bounded, read-only capture. This is not a running exporter.
import { readFile, lstat, statfs, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { cpus } from 'node:os';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

const run = promisify(execFile);
const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const PATHS = { health: '/health', ready: '/ready', metrics: '/metrics', summary: '/metrics/summary', matches: '/matches' };
const MAPS = new Set(['duel-1', 'ffa-4', 'team-2v2', 'team-3v3', 'ffa-20', 'ffa-50']);
const number = (n) => typeof n === 'number' && Number.isFinite(n) && n >= 0 ? n : null;
const version = (v) => typeof v === 'string' && /^[a-f0-9]{7,40}$/.test(v) ? v : null;

/** Never copy arbitrary objects, keys, error text, game state or identities. */
export function projectSource(source, input) {
  if (source === 'matches') {
    // Anonymous browser feed includes only joinable Available, not every registry room.
    if (!Array.isArray(input?.available) || input.available.length > 1000) return null;
    const groups = new Map();
    for (const row of input.available) {
      const map = MAPS.has(row?.mapId) ? row.mapId : 'other';
      const scale = [1, 2, 4, 24].includes(row?.rules?.timeScale) ? row.rules.timeScale : null;
      const key = `${map}/${scale}`;
      if (!groups.has(key)) groups.set(key, { map, timeScale: scale, matches: 0 });
      groups.get(key).matches += 1;
    }
    return [...groups.values()].sort((a, b) => a.map.localeCompare(b.map) || (a.timeScale ?? 0) - (b.timeScale ?? 0));
  }
  if (!input || typeof input !== 'object') return null;
  if (source === 'health') return input.ok === true ? { ok: true, version: version(input.version) } : null;
  if (source === 'ready') return typeof input.ready === 'boolean' ? { ready: input.ready } : null;
  if (source === 'metrics') {
    const matches = number(input.matches), connections = number(input.connections);
    return matches === null || connections === null ? null : { matches, connections };
  }
  if (source !== 'summary') return null;
  const value = {};
  for (const field of ['joins', 'leaves', 'desyncs', 'deadLetters', 'advanceOverflows']) value[field] = number(input[field]);
  for (const [field, path] of [['actionsTotal', 'total'], ['actionsOk', 'ok'], ['actionsRejected', 'rejected']]) value[field] = number(input.actions?.[path]);
  if (Object.values(value).some((v) => v === null)) return null;
  for (const [field, path, divisor] of [['submitSeconds', 'submitMs', 1000], ['broadcastSeconds', 'broadcastMs', 1000], ['deltaBytes', 'deltaBytes', 1]]) {
    const series = input[path];
    value[field] = series && ['count', 'total', 'max'].every((k) => number(series[k]) !== null)
      ? { count: series.count, total: series.total / divisor, max: series.max / divisor } : null;
  }
  // Null means not observed/supported, not a healthy zero.
  value.journal = {};
  for (const stream of ['match', 'client']) {
    const s = input.journal?.[stream];
    value.journal[stream] = s && ['written', 'dropped', 'failed'].every((k) => number(s[k]) !== null)
      ? { written: s.written, dropped: s.dropped, failed: s.failed } : null;
  }
  value.telemetry = input.telemetry && ['batches', 'events', 'droppedEvents', 'rejected', 'limited', 'activeInstalls'].every((k) => number(input.telemetry[k]) !== null)
    ? Object.fromEntries(['batches', 'events', 'droppedEvents', 'rejected', 'limited', 'activeInstalls'].map((k) => [k, input.telemetry[k]])) : null;
  return value;
}

/** Fixed loopback destinations, bounded body/time, no redirect or automatic retries. */
export async function readJson(path, token, request = fetch) {
  try {
    if (!Object.values(PATHS).includes(path)) throw new Error();
    const response = await request(`http://127.0.0.1:8788${path}`, {
      signal: AbortSignal.timeout(2000), redirect: 'error',
      headers: token && path.startsWith('/metrics') ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!response.ok && !(path === '/ready' && response.status === 503)) throw new Error();
    const chunks = []; let bytes = 0;
    for await (const chunk of response.body) {
      bytes += chunk.byteLength;
      if (bytes > 65536) { await response.body.cancel().catch(() => {}); throw new Error(); }
      chunks.push(Buffer.from(chunk));
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch { throw new Error('E_OBS_SOURCE'); }
}

async function command(binary, args, timeout = 3000) {
  try { return (await run(binary, args, { cwd: ROOT, timeout, maxBuffer: 65536 })).stdout.trim(); }
  catch { return null; }
}

async function tokenFromFile(path) {
  if (!path) return undefined;
  const s = await lstat(path);
  if (!s.isFile() || (s.mode & 0o077) || ![0, process.getuid()].includes(s.uid)) throw new Error('E_OBS_CONFIG');
  const line = (await readFile(path, 'utf8')).split('\n').findLast((s) => s.startsWith('METRICS_TOKEN='));
  const token = line?.slice('METRICS_TOKEN='.length).trim().replace(/^['"]|['"]$/g, '');
  return token?.length >= 32 ? token : undefined;
}

async function cpuTime() {
  const values = (await readFile('/proc/stat', 'utf8')).split('\n')[0].trim().split(/\s+/).slice(1, 9).map(Number);
  return { total: values.reduce((a, b) => a + b, 0), idle: values[3] + values[4] };
}

async function hostSample(previous) {
  const current = await cpuTime();
  const mem = Object.fromEntries((await readFile('/proc/meminfo', 'utf8')).split('\n').map((line) => line.match(/^(MemTotal|MemAvailable):\s+(\d+) kB$/)).filter(Boolean).map((m) => [m[1], Number(m[2]) * 1024]));
  const disk = await statfs('/');
  return { cpuTime: current, value: {
    cpuBusyRatio: current.total > previous.total ? 1 - (current.idle - previous.idle) / (current.total - previous.total) : null,
    memoryTotalBytes: mem.MemTotal, memoryAvailableBytes: mem.MemAvailable,
    diskTotalBytes: disk.blocks * disk.bsize, diskAvailableBytes: disk.bavail * disk.bsize,
    inodesTotal: disk.files, inodesFree: disk.ffree,
  } };
}

async function containerSample() {
  // Projection is performed inside Docker: Config.Env, mounts and health log text never leave the command.
  return Object.fromEntries(await Promise.all(['server', 'postgres', 'caddy'].map(async (service) => {
    const format = '{"running":{{json .State.Running}},"oomKilled":{{json .State.OOMKilled}},"restarts":{{json .RestartCount}},"startedAt":{{json .State.StartedAt}},"imageId":{{json .Image}},"memoryCapBytes":{{json .HostConfig.Memory}}}';
    const text = await command('docker', ['inspect', '--format', format, `deploy-${service}-1`]);
    try { return [service, text === null ? null : JSON.parse(text)]; } catch { return [service, null]; }
  })));
}

async function main() {
  const args = process.argv.slice(2), allowed = new Set(['--out', '--env-file', '--samples', '--interval-ms']);
  if (args.length % 2 || args.some((v, i) => i % 2 === 0 && !allowed.has(v))) throw new Error('E_OBS_CONFIG');
  const options = Object.fromEntries(Array.from({ length: args.length / 2 }, (_, i) => [args[i * 2], args[i * 2 + 1]]));
  const samples = Number(options['--samples'] ?? 9), interval = Number(options['--interval-ms'] ?? 15000);
  if (!options['--out'] || !Number.isInteger(samples) || samples < 2 || samples > 40 || !Number.isInteger(interval) || interval < 1000 || interval > 60000) throw new Error('E_OBS_CONFIG');
  const token = await tokenFromFile(options['--env-file']);
  const report = {
    schemaVersion: 1, mode: 'passive-pre-observability',
    collectorSha256: createHash('sha256').update(await readFile(fileURLToPath(import.meta.url))).digest('hex'),
    repositoryCommit: await command('git', ['rev-parse', 'HEAD']), logicalCpus: cpus().length,
    intervalMs: interval, samples: [],
    unavailable: ['histogramP95', 'schedulerBacklog', 'perMatchLiveOps', 'dbDetailedHealth', 'externalBackupHealth'],
  };
  let previous = await cpuTime(); const start = performance.now();
  for (let i = 0; i < samples; i++) {
    const remaining = start + i * interval - performance.now(); if (remaining > 0) await sleep(remaining);
    const [host, containers, sources] = await Promise.all([
      hostSample(previous), containerSample(),
      Promise.all(Object.entries(PATHS).map(async ([source, path]) => {
        try { const value = projectSource(source, await readJson(path, token)); return [source, { status: value === null ? 'invalid' : 'ok', value }]; }
        catch { return [source, { status: 'unavailable', value: null }]; }
      })),
    ]);
    previous = host.cpuTime;
    if (i === 0) host.value.cpuBusyRatio = null; // No full interval before the first sample.
    report.samples.push({ at: new Date().toISOString(), host: host.value, containers, sources: Object.fromEntries(sources) });
  }
  // Exclusive private output: never overwrite a prior baseline or follow an output symlink.
  await writeFile(options['--out'], JSON.stringify(report, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  process.stdout.write('OBS baseline written\n');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(() => { process.stderr.write('E_OBS_BASELINE\n'); process.exitCode = 1; });
}
