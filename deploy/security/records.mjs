// A separate trust boundary: project producer data again before investigating it.
// No raw line, exception, path, header, query or body is returned on parse failure.
import { constants } from 'node:fs';
import { open, opendir, lstat } from 'node:fs/promises';
import { join } from 'node:path';
import { StringDecoder } from 'node:string_decoder';

export const EVENTS = new Set([
  'auth.reject',
  'auth.success',
  'auth.change',
  'auth.logout',
  'auth.delete',
  'ws.reject',
  'ws.accept',
  'action.reject',
  'rate.limit',
  'http.reject',
  'http.error',
  'http.mutation',
  'process.start',
  'process.stop',
]);
export const RULES = new Set([
  'auth-burst',
  'auth-slow',
  'input-probes',
  'mixed-script-probes',
  'success-after-failures',
  'action-boundary',
  'server-errors',
  'rate-limit',
  'audit-loss',
  'audit-stale',
  'correlation-missing',
  'detector-capacity',
  'maintenance-stuck',
  'edge-probes',
  'restart-burst',
]);
const METHODS = new Set([
  'GET',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
  'HEAD',
  'OPTIONS',
  'WS',
  'OTHER',
]);
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const integer = (x) => Number.isSafeInteger(x) && x >= 0;
const object = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
export const DAY = 86400000;
export const RETENTION_DAYS = 14;
const dayAt = (at) => new Date(at).toISOString().slice(0, 10);

export function projectRecord(row) {
  if (
    !object(row) ||
    !integer(row.at) ||
    !['security.event', 'security.alert', 'security.status', 'security.incident'].includes(row.kind)
  )
    return null;
  const out = { schema: row.schema, kind: row.kind, at: row.at };
  if (row.kind === 'security.incident') {
    if (
      row.schema !== 1 ||
      !RULES.has(row.rule) ||
      !/^[a-f0-9]{32}$/.test(row.id) ||
      !['warning', 'high'].includes(row.severity) ||
      !integer(row.count) ||
      !integer(row.firstAt) ||
      !integer(row.lastAt)
    )
      return null;
    Object.assign(out, {
      id: row.id,
      rule: row.rule,
      severity: row.severity,
      count: row.count,
      firstAt: row.firstAt,
      lastAt: row.lastAt,
    });
    if (integer(row.observedAt)) out.observedAt = row.observedAt;
  } else {
    if (row.schema !== 2 || typeof row.run !== 'string' || !UUID.test(row.run)) return null;
    out.run = row.run;
    if (row.kind === 'security.status') {
      if (
        !object(row.journal) ||
        !object(row.counts) ||
        !['written', 'dropped', 'failed'].every((key) => integer(row.journal[key])) ||
        !['sampled', 'failed', 'stableCorrelation', 'startedAt'].every((key) =>
          integer(row[key]),
        ) ||
        ![0, 1].includes(row.stableCorrelation) ||
        ![...EVENTS].every((key) => integer(row.counts[key]))
      )
        return null;
      out.journal = Object.fromEntries(
        ['written', 'dropped', 'failed'].map((key) => [key, row.journal[key]]),
      );
      for (const key of ['sampled', 'failed', 'stableCorrelation', 'startedAt'])
        out[key] = row[key];
      out.counts = Object.fromEntries([...EVENTS].map((key) => [key, row.counts[key]]));
      return out;
    }
    if (!EVENTS.has(row.event) || !integer(row.sequence) || !integer(row.count)) return null;
    Object.assign(out, { event: row.event, sequence: row.sequence, count: row.count });
    if (row.service === 'game') out.service = 'game';
    if (typeof row.version === 'string' && /^(?:dev|[a-f0-9]{7,40})$/.test(row.version))
      out.version = row.version;
    if (['info', 'warning', 'error'].includes(row.severity)) out.severity = row.severity;
    if (['auth', 'actions', 'rate'].includes(row.category)) out.category = row.category;
  }
  for (const [field, pattern] of [
    ['requestId', UUID],
    ['actor', /^[a-f0-9]{16}$/],
    ['target', /^[a-f0-9]{24}$/],
    ['source', /^\d{4}-\d{2}-\d{2}:[a-f0-9]{24}$/],
    ['match', /^[a-f0-9]{24}$/],
    ['code', /^E_[A-Z0-9_]{1,48}$/],
  ])
    if (typeof row[field] === 'string' && pattern.test(row[field])) out[field] = row[field];
  if (
    typeof row.route === 'string' &&
    (row.route === 'unmatched' || /^\/[A-Za-z0-9_/:.*-]{0,119}$/.test(row.route))
  )
    out.route = row.route;
  if (METHODS.has(row.method)) out.method = row.method;
  if (integer(row.status) && row.status >= 100 && row.status <= 599) out.status = row.status;
  if (row.inputClass === 'mixed-script') out.inputClass = row.inputClass;
  return out;
}

export async function privateDirectory(path) {
  const info = await lstat(path);
  if (!info.isDirectory() || info.isSymbolicLink() || info.mode & 0o077)
    throw Error('E_SECURITY_DIRECTORY');
  return info;
}

/** Skip an oversized line through its newline, not through an arbitrary chunk:
 * a malicious suffix must never become a second apparently valid record. */
export async function* boundedLines(
  file,
  size,
  { consume = () => {}, onInvalid = () => {}, stalePartial = false } = {},
) {
  const decoder = new StringDecoder('utf8');
  let pending = '',
    position = 0,
    discard = false;
  while (position < size) {
    const buffer = Buffer.alloc(Math.min(16384, size - position));
    const { bytesRead } = await file.read(buffer, 0, buffer.length, position);
    if (!bytesRead) break;
    position += bytesRead;
    consume(bytesRead);
    pending += decoder.write(buffer.subarray(0, bytesRead));
    let end;
    while ((end = pending.indexOf('\n')) >= 0) {
      const raw = pending.slice(0, end);
      pending = pending.slice(end + 1);
      if (discard) {
        discard = false;
        continue;
      }
      if (Buffer.byteLength(raw) > 8192) {
        onInvalid();
        continue;
      }
      if (raw.trim()) yield raw;
    }
    if (Buffer.byteLength(pending) > 8192) {
      if (!discard) onInvalid();
      discard = true;
      pending = '';
    }
  }
  pending += decoder.end();
  if (!discard && pending.trim() && stalePartial) onInvalid();
}

/** Bounded streaming reads; only the security namespace, complete lines and an explicit
 * UTC window. Retention erasure can replace files while a read holds the old inode;
 * production callers serialize through the existing maintenance/deployment lock. */
export async function* readRecords(
  directory,
  {
    from,
    to = Date.now(),
    prefixes = ['security', 'security-auth', 'security-status'],
    maxBytes = 128 * 1024 * 1024,
    onInvalid = () => {},
    newestFirst = false,
  } = {},
) {
  await privateDirectory(directory);
  if (
    !integer(from) ||
    !integer(to) ||
    from > to ||
    to - from > RETENTION_DAYS * DAY ||
    !integer(maxBytes)
  )
    throw Error('E_SECURITY_WINDOW');
  const names = [];
  for await (const entry of await opendir(directory)) {
    if (names.length >= 128) throw Error('E_SECURITY_INVENTORY');
    const match = /^(security(?:-auth|-status|-incidents)?)-(\d{4}-\d{2}-\d{2})\.jsonl$/.exec(
      entry.name,
    );
    if (match && prefixes.includes(match[1]) && match[2] >= dayAt(from) && match[2] <= dayAt(to))
      names.push(entry.name);
  }
  let total = 0;
  for (const name of newestFirst ? names.sort().reverse() : names.sort()) {
    let file;
    try {
      file = await open(
        join(directory, name),
        constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
      );
      const info = await file.stat();
      if (!info.isFile() || info.nlink !== 1 || info.mode & 0o077 || info.size > 8 * 1024 * 1024)
        throw Error('E_SECURITY_FILE');
      for await (const raw of boundedLines(file, info.size, {
        onInvalid,
        stalePartial: info.mtimeMs < to - 30000,
        consume: (bytes) => {
          total += bytes;
          if (total > maxBytes) throw Error('E_SECURITY_READ_BUDGET');
        },
      })) {
        let row;
        try {
          row = projectRecord(JSON.parse(raw));
        } catch {
          /* untrusted line */
        }
        if (!row) {
          onInvalid();
          continue;
        }
        if (row.at >= from && row.at <= to) yield row;
      }
    } finally {
      await file?.close();
    }
  }
}
