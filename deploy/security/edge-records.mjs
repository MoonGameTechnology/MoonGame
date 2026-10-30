import { constants } from 'node:fs';
import { open, opendir } from 'node:fs/promises';
import { join } from 'node:path';
import { privateDirectory, boundedLines } from './records.mjs';
const CLASSES = new Set([
  'auth.register',
  'auth.login',
  'auth.logout',
  'auth.delete',
  'auth.reset',
  'auth.recover',
  'operator',
  'matches',
  'corporations',
  'economy',
  'other',
]);
const METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS', 'OTHER']);
export function projectEdge(row) {
  if (
    !row ||
    typeof row !== 'object' ||
    Array.isArray(row) ||
    typeof row.ts !== 'number' ||
    !Number.isFinite(row.ts) ||
    row.ts < 0 ||
    !Number.isInteger(row.status) ||
    row.status < 100 ||
    row.status > 599 ||
    !CLASSES.has(row.security_route) ||
    !METHODS.has(row.security_method)
  )
    return null;
  return {
    kind: 'security.edge',
    at: Math.round(row.ts * 1000),
    status: row.status,
    route: row.security_route,
    method: row.security_method,
  };
}
export async function readEdge(directory, { from, to, onInvalid = () => {} }) {
  await privateDirectory(directory);
  const names = [];
  for await (const entry of await opendir(directory)) {
    if (/^access(?:-[0-9TZ.:-]+-(?:size|time))?\.log$/.test(entry.name)) names.push(entry.name);
    if (names.length > 8) throw Error('E_SECURITY_EDGE_INVENTORY');
  }
  if (!names.length) throw Error('E_SECURITY_EDGE_MISSING');
  const rows = [];
  let total = 0;
  for (const name of names.sort()) {
    const file = await open(
      join(directory, name),
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
    try {
      const stat = await file.stat();
      if (!stat.isFile() || stat.nlink !== 1 || stat.mode & 0o077 || stat.size > 2 * 1024 * 1024)
        throw Error('E_SECURITY_EDGE_FILE');
      total += stat.size;
      if (total > 8 * 1024 * 1024) throw Error('E_SECURITY_EDGE_BUDGET');
      for await (const raw of boundedLines(file, stat.size, {
        onInvalid,
        stalePartial: stat.mtimeMs < to - 30000,
      })) {
        let row;
        try {
          row = projectEdge(JSON.parse(raw));
        } catch {
          /* untrusted producer */
        }
        if (!row) {
          onInvalid();
          continue;
        }
        if (row.at >= from && row.at <= to) {
          if (rows.length >= 16384) throw Error('E_SECURITY_EDGE_CAPACITY');
          rows.push(row);
        }
      }
    } finally {
      await file.close();
    }
  }
  return rows;
}
