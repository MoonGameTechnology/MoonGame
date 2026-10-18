import { constants, createReadStream } from 'node:fs';
import { open, readFile, readdir, lstat, rename, unlink } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { analyticsActor } from './analyticsActor';
import {
  eraseAccountDatabase,
  requireOfflineDatabase,
  type ErasureSubject,
} from './accountErasure';

interface Tombstone {
  accountId: string;
  replacement: string;
  pending?: ErasureSubject;
  completed?: boolean;
  completedAt?: string;
}

async function privateFile(path: string): Promise<void> {
  const stat = await lstat(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.mode & 0o077)
    throw Error('E_ERASURE_FILE_MODE');
}

export async function durableReplace(path: string, content: string): Promise<void> {
  const temp = `${path}.${randomUUID()}.tmp`;
  const owner = await lstat(path);
  try {
    const file = await open(temp, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600);
    try {
      await file.chown(owner.uid, owner.gid);
      await file.writeFile(content);
      await file.sync();
    } finally { await file.close(); }
    await rename(temp, path);
    const directory = await open(dirname(path), constants.O_RDONLY);
    try { await directory.sync(); } finally { await directory.close(); }
  } finally {
    await unlink(temp).catch(error => { if (error.code !== 'ENOENT') throw error; });
  }
}

/** Stream with a hard line bound; corrupted/truncated journals stop erasure, never
 * silently skip data and mark the request complete. Services must be stopped. */
async function* records(path: string): AsyncGenerator<Record<string, unknown>> {
  let pending = '';
  for await (const chunk of createReadStream(path, { encoding: 'utf8', highWaterMark: 16384 })) {
    pending += chunk;
    let end: number;
    while ((end = pending.indexOf('\n')) >= 0) {
      if (end > 65536) throw Error('E_ERASURE_LOG_LINE');
      const line = pending.slice(0, end);
      pending = pending.slice(end + 1);
      if (!line.trim()) continue;
      const row: unknown = JSON.parse(line);
      if (!row || typeof row !== 'object' || Array.isArray(row))
        throw Error('E_ERASURE_LOG_FORMAT');
      yield row as Record<string, unknown>;
    }
    if (pending.length > 65536) throw Error('E_ERASURE_LOG_LINE');
  }
  if (pending.trim()) throw Error('E_ERASURE_LOG_TRUNCATED');
}

export async function eraseAccountLogs(
  dir: string,
  subject: ErasureSubject,
  salts: string[],
): Promise<void> {
  const stat = await lstat(dir);
  if (!stat.isDirectory() || stat.isSymbolicLink() || stat.mode & 0o077)
    throw Error('E_ERASURE_LOG_DIRECTORY');
  const names = await readdir(dir);
  // Unsupported archive/subdirectory must be inventoried, not silently ignored.
  if (names.some((n) => !n.endsWith('.jsonl'))) throw Error('E_ERASURE_LOG_INVENTORY');
  const paths = names.map((n) => join(dir, n));
  const actors = new Set(salts.map((salt) => analyticsActor(salt)(subject.accountId)));
  const installs = new Set<string>();
  const seats = new Set<string>();
  const ownActor = (r: Record<string, unknown>): boolean =>
    typeof r.actor === 'string' && actors.has(r.actor);
  for (const path of paths) {
    await privateFile(path);
    for await (const row of records(path))
      if (ownActor(row)) {
        if (typeof row.install === 'string') installs.add(row.install);
        if (typeof row.match === 'string' && typeof row.playerId === 'string')
          seats.add(`${row.match}\0${row.playerId}`);
      }
  }
  for (const path of paths) {
    const temp = `${path}.${randomUUID()}.tmp`;
    const owner = await lstat(path);
    const file = await open(temp, 'wx', 0o600);
    try {
      await file.chown(owner.uid, owner.gid);
      for await (const row of records(path)) {
        const raw = JSON.stringify(row);
        const ownSeat =
          typeof row.match === 'string' &&
          typeof row.playerId === 'string' &&
          seats.has(`${row.match}\0${row.playerId}`);
        // Anonymous events from the linked installation are removed too. Keep an
        // authenticated OTHER user's events on a shared device, stripping linkage.
        if (
          ownActor(row) ||
          ownSeat ||
          raw.includes(subject.accountId) ||
          (subject.email && raw.toLowerCase().includes(subject.email.toLowerCase())) ||
          (!row.actor && typeof row.install === 'string' && installs.has(row.install))
        )
          continue;
        if (typeof row.install === 'string' && installs.has(row.install)) {
          delete row.install;
          delete row.session;
        }
        await file.writeFile(`${JSON.stringify(row)}\n`);
      }
      await file.sync();
      await file.close();
      await rename(temp, path);
    } catch (error) {
      await unlink(temp).catch(() => undefined);
      throw error;
    } finally {
      await file.close();
    }
  }
  const directory = await open(dir, constants.O_RDONLY);
  try {
    await directory.sync();
  } finally {
    await directory.close();
  }
}

export async function validateErasureConfiguration(options: {
  ledger: string; logDir: string; analyticsSalts: string[];
}): Promise<Tombstone[]> {
  const { ledger, logDir, analyticsSalts } = options;
  if (!Array.isArray(analyticsSalts) || !analyticsSalts.length || analyticsSalts.some(s => typeof s !== 'string' || s.length < 32))
    throw Error('E_ERASURE_SALT_HISTORY');
  // Provision an empty [] file explicitly. A missing ledger after restore is an
  // error; auto-creating it could resurrect every previously deleted account.
  const ledgerDir = await lstat(dirname(ledger));
  if (!ledgerDir.isDirectory() || ledgerDir.isSymbolicLink() || ledgerDir.mode & 0o077)
    throw Error('E_ERASURE_LEDGER_DIRECTORY');
  await privateFile(ledger);
  const ledgerStat = await lstat(ledger);
  if (ledgerStat.size > 16 * 1024 * 1024) throw Error('E_ERASURE_LEDGER_SIZE');
  const parsed: unknown = JSON.parse(await readFile(ledger, 'utf8'));
  if (
    !Array.isArray(parsed) ||
    parsed.some(
      (r) =>
        !r ||
        !/^[0-9a-f-]{36}$/i.test(r.accountId) ||
        !/^deleted:[0-9a-f-]{36}$/i.test(r.replacement) ||
        (r.pending &&
          (r.pending.accountId !== r.accountId ||
            r.pending.replacement !== r.replacement ||
            typeof r.pending.login !== 'string' ||
            !r.pending.login)),
    )
  )
    throw Error('E_ERASURE_LEDGER');
  const logStat = await lstat(logDir);
  if (!logStat.isDirectory() || logStat.isSymbolicLink() || logStat.mode & 0o077)
    throw Error('E_ERASURE_LOG_DIRECTORY');
  for (const name of await readdir(logDir)) {
    if (!name.endsWith('.jsonl')) throw Error('E_ERASURE_LOG_INVENTORY');
    const path = join(logDir, name);
    await privateFile(path);
    for await (const row of records(path)) void row;
  }
  return parsed as Tombstone[];
}

/** Called under the deployment lock with BOTH runtime services stopped. The
 * external ledger survives DB restores. No credential or subject enters stdout. */
export async function runAccountErasure(options: {
  game: Pool;
  corporations: Pool;
  ledger: string;
  logDir: string;
  analyticsSalts: string[];
  replay?: boolean;
}): Promise<number> {
  const { game, corporations, ledger, logDir, analyticsSalts } = options;
  let replay = options.replay === true;
  for (const pool of [game, corporations]) {
    const db = await pool.connect();
    try {
      await requireOfflineDatabase(db);
      const guard = await db.query<{ required: boolean }>('SELECT required FROM account_erasure_guard WHERE id=1');
      if (typeof guard.rows[0]?.required !== 'boolean') throw Error('E_ERASURE_GUARD');
      replay ||= guard.rows[0].required;
    } finally {
      db.release();
    }
  }
  for (const pool of [game, corporations])
    await pool.query('UPDATE account_erasure_guard SET required=true WHERE id=1');
  const entries = await validateErasureConfiguration(options);
  const queued = await game.query<{ account_id: string }>(
    'SELECT account_id FROM account_deletions WHERE completed_at IS NULL ORDER BY requested_at',
  );
  for (const row of queued.rows)
    if (!entries.some((e) => e.accountId === row.account_id))
      entries.push({ accountId: row.account_id, replacement: `deleted:${randomUUID()}` });
  let processed = 0;
  for (const entry of entries) {
    if (
      entry.completed &&
      !replay &&
      !queued.rows.some((r) => r.account_id === entry.accountId)
    )
      continue;
    const user = await game.query<{ login: string; email: string | null }>(
      'SELECT login,email FROM users WHERE id=$1',
      [entry.accountId],
    );
    const corpUser = await corporations.query<{ login: string; email: string | null }>(
      'SELECT login,email FROM users WHERE id=$1',
      [entry.accountId],
    );
    const found = user.rows[0] ?? corpUser.rows[0];
    if (!entry.pending && found)
      entry.pending = {
        accountId: entry.accountId,
        replacement: entry.replacement,
        login: found.login,
        ...(found.email ? { email: found.email } : {}),
      };
    if (!entry.pending) {
      if (queued.rows.some((r) => r.account_id === entry.accountId))
        throw Error('E_ERASURE_SUBJECT_MISSING');
      continue;
    }
    await durableReplace(ledger, JSON.stringify(entries));
    await eraseAccountLogs(logDir, entry.pending, analyticsSalts);
    await eraseAccountDatabase(corporations, entry.pending);
    await eraseAccountDatabase(game, entry.pending);
    // A restored dump can predate the queue row itself. Recreate the reservation
    // from the independent ledger before reopening registration.
    await game.query(
      `INSERT INTO account_deletions(account_id,request_id,login_hash,completed_at)
       VALUES($1,$2,encode(sha256(convert_to(lower($3::text),'UTF8')),'hex'),now())
       ON CONFLICT(account_id) DO UPDATE SET completed_at=now(),login_hash=excluded.login_hash`,
      [entry.accountId, randomUUID(), entry.pending.login],
    );
    entry.completedAt = new Date().toISOString();
    entry.completed = true; // restricted restore ledger; retain through backup lifetime only
    await durableReplace(ledger, JSON.stringify(entries));
    processed++;
  }
  for (const pool of [game, corporations])
    await pool.query('UPDATE account_erasure_guard SET required=false WHERE id=1');
  return processed;
}
