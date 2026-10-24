/* global AbortController */
// OBS-1.1: separate, read-only, local bootstrap collector. No game modules or state.
import { createServer } from 'node:http';
import { open } from 'node:fs/promises';
import { constants } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { ACTION_TYPES, REJECT_CODES } from './game-exporter-catalog.mjs';
import { loopbackRequestFromEnv } from './loopback-request.mjs';

const SOURCES = { health: '/health', ready: '/ready', metrics: '/metrics', summary: '/metrics/summary', activity:'/metrics/activity' };
const MAX_BODY = 65536, MAX_SAMPLES = 5000, MAX_EXPOSITION = 1048576;
const object = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const number = (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0;
const count = (v) => number(v) && Number.isSafeInteger(v);
const metric = (name, value, type = 'counter', labels = {}) => ({ name, value, type, labels });

/** Only explicit scalar allowlists cross this boundary. Unknown fields are ignored. */
export function projectSource(source, input) {
  if (!object(input)) return null;
  const samples = []; let rejectedSeries = 0;
  const add = (name, value, type, labels) => samples.push(metric(name, value, type, labels));
  if (source === 'health') {
    if (input.ok !== true) return null;
    const version = typeof input.version === 'string' && /^[a-f0-9]{7,40}$/.test(input.version) ? input.version : 'unknown';
    add('moongame_build_info', 1, 'gauge', { version });
  } else if (source === 'ready') {
    if (typeof input.ready !== 'boolean') return null;
    add('moongame_game_ready', Number(input.ready), 'gauge');
  } else if (source === 'metrics') {
    if (!count(input.matches) || !count(input.connections)) return null;
    for (const field of ['matches', 'connections']) add(`moongame_${field}`, input[field], 'gauge');
  } else if (source === 'activity') {
    if(input.schema!==1 || !count(input.since) || !count(input.at) || input.since>input.at ||
      !count(input.online) || !Array.isArray(input.days) || input.days.length>30)return null;
    add('moongame_players_online',input.online,'gauge');
    add('moongame_player_activity_since_timestamp_seconds',input.since/1000,'gauge');
    add('moongame_player_activity_sample_timestamp_seconds',input.at/1000,'gauge');
    let previous='';
    for(const row of input.days){
      if(!object(row) || typeof row.day!=='string' || !/^\d{4}-\d{2}-\d{2}$/.test(row.day) || row.day<=previous ||
        !count(row.players) || !count(row.visits) || !number(row.seconds) || row.seconds>row.players*86400 ||
        !Number.isFinite(Date.parse(row.day+'T00:00:00Z')) || new Date(row.day+'T00:00:00Z').toISOString().slice(0,10)!==row.day ||
        row.day<new Date(input.at-29*86400000).toISOString().slice(0,10) || row.day>new Date(input.at).toISOString().slice(0,10))return null;
      previous=row.day;
      for(const [key,suffix] of [['players','players'],['visits','visits'],['seconds','online_seconds']])
        add(`moongame_player_activity_daily_${suffix}`,row[key],'gauge',{day:row.day});
    }
  } else if (source === 'summary') {
    for (const [field, name] of [['joins', 'joins'], ['leaves', 'leaves'], ['desyncs', 'desyncs'], ['deadLetters', 'dead_letters'], ['advanceOverflows', 'advance_overflows']]) {
      if (!count(input[field])) return null;
      add(`moongame_${name}_total`, input[field]);
    }
    const actions = input.actions;
    if (!object(actions) || !['total', 'ok', 'rejected'].every((key) => count(actions[key])) || actions.total !== actions.ok + actions.rejected) return null;
    for (const outcome of ['ok', 'rejected']) add('moongame_actions_total', actions[outcome], 'counter', { outcome });
    for (const [field, catalog, label, name, expected] of [
      ['byType', ACTION_TYPES, 'type', 'moongame_action_types_total', actions.total],
      ['rejectByCode', REJECT_CODES, 'code', 'moongame_action_rejects_total', actions.rejected],
    ]) {
      const entries = actions[field];
      if (!object(entries)) return null;
      let total = 0, other = 0;
      for (const [key, value] of Object.entries(entries)) {
        if (!count(value)) return null;
        total += value;
        if (catalog.has(key)) add(name, value, 'counter', { [label]: key });
        else if (label === 'code') other += value;
        else rejectedSeries++;
      }
      if (!count(total) || total !== expected) return null;
      if (other > 0) add(name, other, 'counter', { code: 'other' });
    }
    for (const [field, name, divisor, optional] of [
      ['submitMs', 'moongame_submit_duration_seconds', 1000, false],
      ['broadcastMs', 'moongame_broadcast_duration_seconds', 1000, false],
      ['deltaBytes', 'moongame_delta_bytes', 1, false],
      ['clientFps', 'moongame_client_fps', 1, true],
      ['clientRttMs', 'moongame_client_rtt_seconds', 1000, true],
    ]) {
      const stat = input[field];
      if (optional && stat == null) continue;
      if (!object(stat) || !count(stat.count) || !number(stat.total) || !number(stat.max) || (stat.count === 0 && (stat.total !== 0 || stat.max !== 0)) || stat.max > stat.total) return null;
      add(`${name}_sum`, stat.total / divisor);
      add(`${name}_count`, stat.count);
      if (stat.count > 0) add(`${name}_max`, stat.max / divisor, 'gauge');
    }
    if (input.journal !== undefined) {
      if (!object(input.journal)) return null;
      for (const stream of ['match', 'client']) {
        const stat = input.journal[stream];
        if (!object(stat) || !['written', 'dropped', 'failed'].every((key) => count(stat[key]))) return null;
        for (const key of ['written', 'dropped', 'failed']) add(`moongame_journal_${key}_total`, stat[key], 'counter', { stream });
      }
    }
    if (input.telemetry !== undefined) {
      const stat = input.telemetry;
      if (!object(stat) || !['batches', 'events', 'droppedEvents', 'rejected', 'limited', 'activeInstalls'].every((key) => count(stat[key]))) return null;
      for (const [key, suffix] of [['batches', 'batches'], ['events', 'events'], ['droppedEvents', 'dropped_events'], ['rejected', 'rejected'], ['limited', 'limited']]) add(`moongame_telemetry_${suffix}_total`, stat[key]);
      add('moongame_active_installs', stat.activeInstalls, 'gauge');
    }
  } else return null;
  return { samples, rejectedSeries };
}

const escapeLabel = (s) => s.replaceAll('\\', '\\\\').replaceAll('\n', '\\n').replaceAll('"', '\\"');
/** No histogram/p95 claims: count/sum are counters; max is explicitly a lifetime gauge. */
export function renderMetrics(samples) {
  if (samples.length > MAX_SAMPLES) throw new Error('E_OBS_BUDGET');
  const types = new Set(); let output = '';
  for (const sample of samples) {
    if (!number(sample.value)) throw new Error('E_OBS_SOURCE');
    if (!types.has(sample.name)) {
      types.add(sample.name);
      output += `# TYPE ${sample.name} ${sample.type}\n`;
    }
    const entries = Object.entries(sample.labels);
    const labels = entries.length ? `{${entries.map(([key, value]) => `${key}="${escapeLabel(value)}"`).join(',')}}` : '';
    output += `${sample.name}${labels} ${sample.value}\n`;
  }
  if (Buffer.byteLength(output) > MAX_EXPOSITION) throw new Error('E_OBS_BUDGET');
  return output;
}

async function sourceJson(source, port, token, request, timeoutMs) {
  const path = SOURCES[source];
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    // Literal numeric loopback prevents DNS rebinding/remote credentials and has no redirects.
    const response = await request(`http://127.0.0.1:${port}${path}`, {
      signal: controller.signal, redirect: 'error',
      headers: token && path.startsWith('/metrics') ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!response.ok && !(source === 'ready' && response.status === 503)) throw new Error();
    const chunks = []; let bytes = 0;
    for await (const chunk of response.body) {
      bytes += chunk.byteLength;
      if (bytes > MAX_BODY) { controller.abort(); throw new Error(); }
      chunks.push(Buffer.from(chunk));
    }
    const projected = projectSource(source, JSON.parse(Buffer.concat(chunks).toString('utf8')));
    if (!projected || (response.status === 503 && projected.samples[0]?.value !== 0)) throw new Error();
    return projected;
  } catch { throw new Error('E_OBS_SOURCE'); }
  finally { clearTimeout(timer); }
}

/** Shared scrape, fresh projections only. The 1500ms default leaves response headroom
 *  below the consumer's 2s deadline; explicit local overrides still have a 2s cap. */
export function createExporter({ sourcePort = 8788, token, request = loopbackRequestFromEnv(), now = Date.now, timeoutMs = 1500 } = {}) {
  if (!Number.isInteger(sourcePort) || sourcePort < 1 || sourcePort > 65535 || !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 2000) throw new Error('E_OBS_CONFIG');
  const lastSuccess = new Map(); let inFlight, rejectedSeries = 0;
  const scrape = () => {
    if (inFlight) return inFlight;
    inFlight = (async () => {
      const groups = await Promise.all(Object.keys(SOURCES).map(async (source) => {
        let projected = null;
        try {
          projected = await sourceJson(source, sourcePort, token, request, timeoutMs);
          lastSuccess.set(source, now() / 1000);
          rejectedSeries += projected.rejectedSeries;
        } catch { /* Source failure is a measurement, not an exporter crash or a zero. */ }
        const samples = [metric('moongame_source_up', Number(projected !== null), 'gauge', { source })];
        if (lastSuccess.has(source)) samples.push(metric('moongame_source_last_success_timestamp_seconds', lastSuccess.get(source), 'gauge', { source }));
        return [...samples, ...(projected?.samples ?? [])];
      }));
      return renderMetrics([...groups.flat(), metric('moongame_exporter_rejected_series_total', rejectedSeries)]);
    })().finally(() => { inFlight = undefined; });
    return inFlight;
  };
  const server = createServer((req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    if (req.method === 'GET' && req.url === '/health') { res.setHeader('Content-Type', 'application/json'); res.end('{"ok":true}\n'); return; }
    if (req.method !== 'GET' || req.url !== '/metrics') { res.writeHead(404); res.end(); return; }
    scrape().then((body) => { res.setHeader('Content-Type', 'text/plain; version=0.0.4; charset=utf-8'); res.end(body); })
      .catch(() => { res.writeHead(503); res.end('E_OBS_EXPORTER\n'); });
  });
  server.maxConnections = 16; server.maxRequestsPerSocket = 100;
  server.headersTimeout = 3000; server.requestTimeout = 3000; server.keepAliveTimeout = 1000;
  return { scrape, server };
}

/** Open without following links; check the opened inode before bounded reading. */
export async function readToken(path) {
  let file;
  try {
    file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const stat = await file.stat();
    if (!stat.isFile() || (stat.mode & 0o077) || ![0, process.getuid()].includes(stat.uid) || stat.size > 4097) throw new Error();
    const bytes = Buffer.alloc(4098);
    const { bytesRead } = await file.read(bytes, 0, bytes.length, 0);
    const value = bytes.subarray(0, bytesRead).toString('utf8').replace(/\n$/, '');
    // Include the installer's token alphabet; still exclude whitespace/control
    // bytes so an existing credential cannot inject an HTTP header.
    if (!/^[A-Za-z0-9._~+/=:,@%-]{32,4096}$/.test(value)) throw new Error();
    return value;
  } catch { throw new Error('E_OBS_CONFIG'); }
  finally { await file?.close(); }
}

async function main() {
  const port = Number(process.env.GAME_EXPORTER_PORT ?? 9108);
  const sourcePort = Number(process.env.GAME_EXPORTER_SOURCE_PORT ?? 8788);
  if (!Number.isInteger(port) || port < 1 || port > 65535 || process.argv.length !== 2) throw new Error('E_OBS_CONFIG');
  const token = process.env.GAME_EXPORTER_TOKEN_FILE ? await readToken(process.env.GAME_EXPORTER_TOKEN_FILE) : undefined;
  const { server } = createExporter({ sourcePort, token });
  server.on('error', () => { process.stderr.write('E_OBS_EXPORTER\n'); process.exitCode = 1; });
  server.listen(port, '127.0.0.1', () => process.stdout.write('OBS Game exporter listening on loopback\n'));
  for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, () => { server.close(); server.closeAllConnections(); });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(() => { process.stderr.write('E_OBS_EXPORTER\n'); process.exitCode = 1; });
}
