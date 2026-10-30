// Operator-only investigation CLI. It prints the same allowlisted projection as
// the detector and records reads without copying filter values into another log.
import { constants } from 'node:fs';
import { open, opendir, unlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { isMainModule } from '../observability/main-module.mjs';
import { readRecords, privateDirectory, RULES, DAY, RETENTION_DAYS } from './records.mjs';

export function parseQuery(args, now = Date.now()) {
  const out = { from: now - DAY, to: now, limit: 100, incidents: false };
  const seen = new Set();
  for (let i = 0; i < args.length; i++) {
    const key = args[i];
    if (seen.has(key)) throw Error('E_SECURITY_QUERY');
    seen.add(key);
    if (key === '--incidents') {
      out.incidents = true;
      continue;
    }
    const value = args[++i];
    if (typeof value !== 'string') throw Error('E_SECURITY_QUERY');
    if (key === '--from' || key === '--to') {
      if (
        !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value) ||
        !Number.isFinite(Date.parse(value))
      )
        throw Error('E_SECURITY_QUERY');
      out[key.slice(2)] = Date.parse(value);
    } else if (key === '--limit') {
      if (!/^[1-9][0-9]{0,3}$/.test(value) || Number(value) > 1000) throw Error('E_SECURITY_QUERY');
      out.limit = Number(value);
    } else {
      const patterns = {
        '--request': /^[a-f0-9-]{36}$/,
        '--actor': /^[a-f0-9]{16}$/,
        '--target': /^[a-f0-9]{24}$/,
        '--source': /^\d{4}-\d{2}-\d{2}:[a-f0-9]{24}$/,
        '--rule': /^[a-z-]{1,40}$/,
      };
      if (!patterns[key]?.test(value) || (key === '--rule' && !RULES.has(value)))
        throw Error('E_SECURITY_QUERY');
      out[key === '--request' ? 'requestId' : key.slice(2)] = value;
    }
  }
  if (
    out.from < now - RETENTION_DAYS * DAY ||
    out.from > out.to ||
    out.to > now ||
    out.to - out.from > RETENTION_DAYS * DAY
  )
    throw Error('E_SECURITY_QUERY');
  return out;
}
export async function query(directory, options) {
  const rows = [];
  let invalid = 0,
    matched = 0;
  const prefixes = options.incidents
    ? ['security-incidents']
    : ['security', 'security-auth', 'security-status', 'security-incidents'];
  for await (const row of readRecords(directory, {
    from: options.from,
    to: options.to,
    prefixes,
    onInvalid: () => invalid++,
  })) {
    if (
      !['requestId', 'actor', 'target', 'source', 'rule'].every(
        (key) => !options[key] || row[key] === options[key],
      )
    )
      continue;
    matched++;
    rows.push(row);
    rows.sort((a, b) => b.at - a.at);
    if (rows.length > options.limit) rows.pop();
  }
  return {
    from: new Date(options.from).toISOString(),
    to: new Date(options.to).toISOString(),
    returned: rows.length,
    matched,
    invalidRecords: invalid,
    truncated: matched > rows.length,
    records: rows,
  };
}
async function auditAccess(directory, value, now) {
  const owner = await privateDirectory(directory);
  if (owner.uid !== process.getuid()) throw Error('E_SECURITY_OPERATOR_AUDIT');
  const file = await open(
    join(directory, `access-${new Date(now).toISOString().slice(0, 10)}.jsonl`),
    constants.O_WRONLY |
      constants.O_APPEND |
      constants.O_CREAT |
      constants.O_NOFOLLOW |
      constants.O_NONBLOCK,
    0o600,
  );
  try {
    const stat = await file.stat();
    if (
      !stat.isFile() ||
      stat.nlink !== 1 ||
      stat.mode & 0o077 ||
      stat.uid !== owner.uid ||
      stat.size > 1024 * 1024
    )
      throw Error('E_SECURITY_OPERATOR_AUDIT');
    await file.writeFile(
      JSON.stringify({
        schema: 1,
        kind: 'security.operator_read',
        at: now,
        uid: process.getuid(),
        ...value,
      }) + '\n',
    );
    await file.datasync();
  } finally {
    await file.close();
  }
  const cutoff = new Date(now - (RETENTION_DAYS - 1) * DAY).toISOString().slice(0, 10);
  for await (const entry of await opendir(directory)) {
    const match = /^access-(\d{4}-\d{2}-\d{2})\.jsonl$/.exec(entry.name);
    if (entry.isFile() && match && match[1] < cutoff) await unlink(join(directory, entry.name));
  }
}
async function main() {
  const directory = process.env.SECURITY_LOG_DIR,
    state = process.env.SECURITY_STATE_DIR;
  if (!directory || directory !== resolve(directory) || !state || state !== resolve(state))
    throw Error('E_SECURITY_QUERY_CONFIG');
  const now = Date.now(),
    options = parseQuery(process.argv.slice(2), now);
  const filters = ['requestId', 'actor', 'target', 'source', 'rule'].filter((key) => options[key]);
  await auditAccess(state, { operation: 'query.start', filters }, now);
  const result = await query(directory, options);
  await auditAccess(
    state,
    { operation: 'query.complete', filters, rows: result.returned },
    Date.now(),
  );
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
}
if (isMainModule(import.meta.url))
  main().catch(() => {
    process.stderr.write('E_SECURITY_QUERY\n');
    process.exitCode = 1;
  });
