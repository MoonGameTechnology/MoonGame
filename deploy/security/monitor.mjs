// Host-side detection only. No network, Docker, DB, credentials or response powers.
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { open, rename, unlink, lstat, opendir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { readRecords, privateDirectory, RULES, DAY, RETENTION_DAYS } from './records.mjs';
import { readEdge } from './edge-records.mjs';

const WINDOW = 600000,
  MAX_RECORDS = 16384,
  MAX_GROUPS = 4096;
const dayAt = (at) => new Date(at).toISOString().slice(0, 10);
const digest = (s) => createHash('sha256').update(s).digest('hex').slice(0, 32);
const denied = (r) => ['auth.reject', 'ws.reject'].includes(r.event);

/** A detection is a suspicion with evidence references, never a confirmed attack.
 * Rules are fixed, cardinality is bounded, game-rule errors are not inputs. */
export function detect(events, now) {
  const groups = new Map(),
    found = new Map(),
    seen = new Map();
  let limited = 0,
    duplicates = 0,
    conflicts = 0;
  const add = (rule, key, row, window, threshold, severity = 'warning', distinct = false) => {
    const groupKey = `${rule}:${key}`;
    if (!groups.has(groupKey)) {
      if (groups.size >= MAX_GROUPS) {
        limited++;
        return;
      }
      groups.set(groupKey, []);
    }
    const rows = groups.get(groupKey);
    while (rows.length && rows[0].at < row.at - window) rows.shift();
    rows.push(row);
    if (rows.length > 128) rows.shift();
    const count = distinct
      ? new Set(rows.map((r) => r[distinct === true ? 'target' : distinct]).filter(Boolean)).size
      : rows.length;
    if (count < threshold) return;
    const id = digest(`${rule}:${key}:${Math.floor(row.at / window)}`);
    found.set(id, {
      schema: 1,
      kind: 'security.incident',
      id,
      rule,
      severity,
      at: row.at,
      firstAt: rows[0].at,
      lastAt: row.at,
      count,
      ...Object.fromEntries(
        ['actor', 'target', 'source', 'requestId', 'match', 'route']
          .filter((k) => row[k])
          .map((k) => [k, row[k]]),
      ),
    });
  };
  for (const row of [...events].sort(
    (a, b) => a.at - b.at || (a.sequence ?? 0) - (b.sequence ?? 0),
  )) {
    if (row.at < now - WINDOW || row.at > now) continue;
    if (row.kind === 'security.edge') {
      if (row.route === 'operator' && [401, 403, 404].includes(row.status))
        add('edge-probes', 'global', row, 60000, 5);
      continue;
    }
    if (row.kind !== 'security.event') continue;
    const eventId = `${row.run}:${row.sequence}`;
    if (seen.has(eventId)) {
      duplicates++;
      if (JSON.stringify(seen.get(eventId)) !== JSON.stringify(row)) conflicts++;
      continue;
    }
    seen.set(eventId, row);
    if (row.event === 'process.start')
      add('restart-burst', row.version ?? 'unknown', row, WINDOW, 4, 'high', 'run');
    const key = row.source ?? 'uncorrelated';
    if (denied(row)) {
      add('auth-burst', key, row, 60000, 20);
      add('auth-slow', key, row, WINDOW, 15);
      if (row.target)
        add('success-after-failures', `${key}:${row.target}`, row, WINDOW, Number.MAX_SAFE_INTEGER);
    }
    if (row.event === 'auth.success' && row.target) {
      const group = groups.get(`success-after-failures:${key}:${row.target}`);
      if (group?.length >= 5) {
        const id = digest(
          `success-after-failures:${key}:${row.target}:${Math.floor(row.at / WINDOW)}`,
        );
        found.set(id, {
          schema: 1,
          kind: 'security.incident',
          id,
          rule: 'success-after-failures',
          severity: 'high',
          at: row.at,
          firstAt: group[0].at,
          lastAt: row.at,
          count: group.length,
          ...Object.fromEntries(
            ['actor', 'target', 'source', 'requestId', 'route']
              .filter((k) => row[k])
              .map((k) => [k, row[k]]),
          ),
        });
      }
    }
    if (row.event === 'http.reject') add('input-probes', key, row, 60000, 30);
    if (row.inputClass === 'mixed-script' && row.target && row.route === '/auth/register')
      add('mixed-script-probes', key, row, 300000, 3, 'warning', true);
    if (row.event === 'action.reject') add('action-boundary', key, row, 60000, 5, 'high');
    if (row.event === 'http.error') add('server-errors', 'global', row, 60000, 5, 'high');
    if (row.event === 'rate.limit') add('rate-limit', key, row, 60000, 10);
  }
  return {
    incidents: [...found.values()].map((row) => ({ ...row, observedAt: now })),
    limited,
    duplicates,
    conflicts,
  };
}

async function appendIncident(directory, row) {
  const owner = await privateDirectory(directory);
  const path = join(directory, `security-incidents-${dayAt(row.at)}.jsonl`);
  const file = await open(
    path,
    constants.O_WRONLY |
      constants.O_APPEND |
      constants.O_CREAT |
      constants.O_NOFOLLOW |
      constants.O_NONBLOCK,
    0o600,
  );
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.nlink !== 1 || stat.mode & 0o077)
      throw Error('E_SECURITY_INCIDENT_FILE');
    const line = JSON.stringify(row) + '\n';
    if (stat.size + Buffer.byteLength(line) > 1024 * 1024) return false;
    if (stat.uid !== owner.uid || stat.gid !== owner.gid) await file.chown(owner.uid, owner.gid);
    await file.writeFile(line);
    await file.datasync();
    return true;
  } finally {
    await file.close();
  }
}
async function pruneIncidents(directory, now) {
  const cutoff = dayAt(now - (RETENTION_DAYS - 1) * DAY);
  for await (const entry of await opendir(directory)) {
    const match = /^security-incidents-(\d{4}-\d{2}-\d{2})\.jsonl$/.exec(entry.name);
    if (entry.isFile() && match && match[1] < cutoff) await unlink(join(directory, entry.name));
  }
}
async function publish(path, content, mode = 0o644) {
  const temp = `${path}.tmp-${process.pid}`;
  let file;
  try {
    file = await open(
      temp,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
      mode,
    );
    await file.writeFile(content);
    await file.datasync();
    await file.close();
    file = undefined;
    await rename(temp, path);
  } finally {
    await file?.close();
    await unlink(temp).catch((e) => {
      if (e.code !== 'ENOENT') throw e;
    });
  }
}
function operational(rule, now, key, count = 1) {
  return {
    schema: 1,
    kind: 'security.incident',
    id: digest(`${rule}:${key}`),
    rule,
    severity: 'high',
    at: now,
    observedAt: now,
    firstAt: now,
    lastAt: now,
    count,
  };
}
export async function sample({
  directory,
  metricsDirectory,
  edgeDirectory,
  maintenanceMarker,
  maintenanceSuccess,
  now = Date.now(),
}) {
  const stats = {
    up: 1,
    edgeUp: edgeDirectory ? 1 : 0,
    invalid: 0,
    limited: 0,
    storageLimited: 0,
    records: 0,
    heartbeat: 0,
  };
  const from = Math.floor(now / DAY) * DAY - (RETENTION_DAYS - 1) * DAY;
  const old = [],
    events = [];
  try {
    await privateDirectory(directory);
    const oldIds = new Set();
    for await (const row of readRecords(directory, {
      from,
      to: now,
      prefixes: ['security-incidents'],
      newestFirst: true,
      onInvalid: () => stats.invalid++,
    })) {
      if (oldIds.has(row.id)) continue;
      if (old.length >= 65536) {
        stats.limited++;
        break;
      }
      oldIds.add(row.id);
      old.push({ id: row.id, rule: row.rule, at: row.at });
    }
    for await (const row of readRecords(directory, {
      from: now - WINDOW,
      to: now,
      prefixes: ['security-status'],
      onInvalid: () => stats.invalid++,
    }))
      events.push(row);
    for await (const row of readRecords(directory, {
      from: now - WINDOW,
      to: now,
      prefixes: ['security', 'security-auth'],
      onInvalid: () => stats.invalid++,
    })) {
      if (events.length >= MAX_RECORDS) {
        stats.limited++;
        break;
      }
      events.push(row);
    }
  } catch {
    stats.up = 0;
  }
  if (edgeDirectory) {
    try {
      events.push(
        ...(await readEdge(edgeDirectory, {
          from: now - WINDOW,
          to: now,
          onInvalid: () => stats.invalid++,
        })),
      );
    } catch {
      stats.edgeUp = 0;
      stats.up = 0;
    }
  }
  stats.records = events.length;
  const status = events.filter((r) => r.kind === 'security.status').sort((a, b) => b.at - a.at)[0];
  if (status) stats.heartbeat = status.at;
  const result = detect(events, now);
  stats.limited += result.limited;
  stats.invalid += result.conflicts;
  const candidates = result.incidents.slice(0, 128);
  stats.limited += Math.max(0, result.incidents.length - candidates.length);
  const statusKey = status?.run ?? dayAt(now);
  if (!status || now - status.at > 180000)
    candidates.push(operational('audit-stale', now, statusKey));
  if (
    status &&
    (status.sampled || status.failed || status.journal.dropped || status.journal.failed)
  )
    candidates.push(
      operational(
        'audit-loss',
        now,
        status.run,
        status.sampled + status.failed + status.journal.dropped + status.journal.failed,
      ),
    );
  if (status && status.stableCorrelation !== 1)
    candidates.push(operational('correlation-missing', now, status.run));
  if (stats.invalid || stats.limited || !stats.up)
    candidates.push(
      operational(
        'detector-capacity',
        now,
        dayAt(now),
        stats.invalid + stats.limited + Number(!stats.up),
      ),
    );
  if (maintenanceMarker && maintenanceSuccess) {
    try {
      const marker = await lstat(maintenanceMarker),
        success = await lstat(maintenanceSuccess);
      if (
        marker.isFile() &&
        !marker.isSymbolicLink() &&
        success.isFile() &&
        !success.isSymbolicLink() &&
        now - success.mtimeMs > 300000
      )
        candidates.push(operational('maintenance-stuck', now, String(Math.floor(success.mtimeMs))));
    } catch (e) {
      if (e.code !== 'ENOENT') {
        stats.up = 0;
      }
    }
  }
  const known = new Set(old.map((r) => r.id));
  for (const row of candidates)
    if (!known.has(row.id)) {
      try {
        if (await appendIncident(directory, row)) {
          known.add(row.id);
          old.push(row);
        } else {
          stats.storageLimited = 1;
          break;
        }
      } catch {
        stats.up = 0;
      }
    }
  try {
    await pruneIncidents(directory, now);
  } catch {
    stats.up = 0;
  }
  const lines = [];
  const metric = (name, value, labels = '') => {
    lines.push(`${name}${labels} ${value}`);
  };
  metric('moongame_security_detector_up', stats.up);
  metric('moongame_security_edge_up', stats.edgeUp);
  metric('moongame_security_detector_sample_timestamp_seconds', now / 1000);
  metric('moongame_security_detector_heartbeat_timestamp_seconds', stats.heartbeat / 1000);
  metric('moongame_security_detector_invalid_records', stats.invalid);
  metric('moongame_security_detector_capacity_limited', Number(stats.limited > 0));
  metric('moongame_security_detector_storage_limited', stats.storageLimited);
  metric('moongame_security_detector_records', stats.records);
  metric('moongame_security_detector_duplicate_records', result.duplicates);
  for (const rule of RULES) {
    const window = [
      'auth-burst',
      'input-probes',
      'action-boundary',
      'server-errors',
      'rate-limit',
      'edge-probes',
    ].includes(rule)
      ? 60000
      : rule === 'mixed-script-probes'
        ? 300000
        : WINDOW;
    const active = candidates.filter((r) => r.rule === rule && r.lastAt >= now - window);
    const saved = old.filter((r) => r.rule === rule);
    metric('moongame_security_incidents_active', active.length, `{rule="${rule}"}`);
    metric('moongame_security_incidents_retained', saved.length, `{rule="${rule}"}`);
    metric(
      'moongame_security_incident_last_timestamp_seconds',
      Math.max(0, ...saved.map((r) => r.at)) / 1000,
      `{rule="${rule}"}`,
    );
  }
  await publish(join(metricsDirectory, 'security.prom'), lines.join('\n') + '\n');
  return { stats, incidents: candidates };
}

async function main() {
  if (process.argv.length !== 3 || process.argv[2] !== 'sample') throw Error('E_SECURITY_COMMAND');
  const directory = process.env.SECURITY_LOG_DIR,
    metricsDirectory = process.env.SECURITY_METRICS_DIR;
  if (
    !directory ||
    directory !== resolve(directory) ||
    !metricsDirectory ||
    metricsDirectory !== resolve(metricsDirectory)
  )
    throw Error('E_SECURITY_CONFIG');
  const info = await lstat(metricsDirectory);
  if (!info.isDirectory() || info.isSymbolicLink() || info.mode & 0o022)
    throw Error('E_SECURITY_METRICS_DIRECTORY');
  await sample({
    directory,
    metricsDirectory,
    edgeDirectory: process.env.SECURITY_EDGE_LOG_DIR,
    maintenanceMarker: process.env.SECURITY_MAINTENANCE_MARKER,
    maintenanceSuccess: process.env.SECURITY_MAINTENANCE_SUCCESS,
  });
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  main().catch(() => {
    process.stderr.write('E_SECURITY_MONITOR\n');
    process.exitCode = 1;
  });
