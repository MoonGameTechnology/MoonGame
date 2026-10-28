import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import { Pool } from 'pg';
import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, readFile, rm, lstat, chown, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { registerAuthApi, sessionFingerprint } from './authApi';
import { MemoryUserStore } from './store/memory';
import { migrate, PostgresUserStore } from './store/postgres';
import { hashPassword } from './password';
import { eraseAccountDatabase, scrubPersonalJson, type ErasureSubject } from './accountErasure';
import { runAccountErasure, eraseAccountLogs, durableReplace, validateErasureConfiguration } from './accountErasureWorker';
import { PostgresMetaEconomyStore } from './metaEconomyStore';
import { analyticsActor } from './analyticsActor';

const subject: ErasureSubject = {
  accountId: randomUUID(),
  replacement: `deleted:${randomUUID()}`,
  login: 'active',
  email: 'p+ilot@example.org',
};
const salt = 'synthetic-erasure-analytics-salt-32';
const paths: string[] = [];
afterEach(async () => {
  await Promise.all(paths.splice(0).map((p) => rm(p, { recursive: true, force: true })));
});
async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), 'erasure-'));
  paths.push(dir);
  const logs = join(dir, 'logs');
  await mkdir(logs, { mode: 0o700 });
  const ledger = join(dir, 'ledger.json');
  await writeFile(ledger, '[]', { mode: 0o600 });
  return { logs, ledger };
}

it('scrubs identity keys and display names without changing gameplay enums', () => {
  expect(
    scrubPersonalJson(
      { [subject.accountId]: { name: 'ACTIVE', status: 'active', text: 'P+ilot@example.org' } },
      subject,
    ),
  ).toEqual({ [subject.replacement]: { name: '[deleted]', status: 'active', text: '[deleted]' } });
});

it('removes linked anonymous events and retains other authenticated people on shared devices', async () => {
  const { logs } = await fixture();
  const file = join(logs, 'client-2026-10-18.jsonl');
  const actor = analyticsActor(salt)(subject.accountId);
  await writeFile(
    file,
    [
      { install: 'device', session: 'one', event: 'start' },
      { actor, install: 'device', session: 'two' },
      { actor: 'other', install: 'device', session: 'three', event: 'win' },
      { install: 'unrelated', event: 'start' },
    ]
      .map((r) => JSON.stringify(r))
      .join('\n') + '\n',
    { mode: 0o600 },
  );
  await eraseAccountLogs(logs, subject, [salt]);
  expect(
    (await readFile(file, 'utf8'))
      .trim()
      .split('\n')
      .map((s) => JSON.parse(s)),
  ).toEqual([
    { actor: 'other', event: 'win' },
    { install: 'unrelated', event: 'start' },
  ]);
  await writeFile(file, '{"incomplete":', { mode: 0o600 });
  await expect(eraseAccountLogs(logs, subject, [salt])).rejects.toThrow('E_ERASURE_LOG_TRUNCATED');
});

it('requires the current password, explicit confirmation and a durable queue before acknowledging', async () => {
  const users = new MemoryUserStore();
  const password = 'a private phrase';
  const hash = await hashPassword(password, { N: 4096, r: 8, p: 1 });
  const made = await users.createUser('pilot', hash);
  if (!made.ok) throw Error('fixture');
  const record = await users.findById(made.userId);
  if (!record) throw Error('fixture');
  const claim = { accountId: made.userId, login: 'pilot', pwfp: sessionFingerprint(record) };
  const revoked = vi.fn();
  const app = Fastify();
  registerAuthApi(app, {
    users,
    accountDeletionEnabled: true,
    signSession: async () => 'token',
    verifySession: async () => ({ ok: true, claim }),
    onSessionsRevoked: revoked,
  });
  const send = (payload: object) =>
    app.inject({
      method: 'POST',
      url: '/auth/delete-account',
      headers: { authorization: 'Bearer token' },
      payload,
    });
  try {
    expect((await send({ password: '', confirm: 'DELETE' })).statusCode).toBe(400);
    expect((await send({ password: 'wrong phrase', confirm: 'DELETE' })).statusCode).toBe(401);
    expect((await send({ password, confirm: 'no' })).statusCode).toBe(400);
    const enqueue = vi.spyOn(users, 'requestDeletion').mockRejectedValueOnce(Error('storage down'));
    expect((await send({ password, confirm: 'DELETE' })).statusCode).toBe(500);
    expect(await users.findById(made.userId)).not.toBeNull();
    expect(revoked).not.toHaveBeenCalled();
    enqueue.mockRestore();
    const requestId = randomUUID();
    const response = await send({ password, confirm: 'DELETE', requestId });
    expect(response.statusCode).toBe(202);
    expect(response.json()).toMatchObject({ status: 'pending' });
    expect(response.headers['cache-control']).toBe('no-store');
    expect(await users.findById(made.userId)).toBeNull();
    expect(revoked).toHaveBeenCalledWith(made.userId);
    expect((await send({ password, confirm: 'DELETE', requestId })).json()).toEqual({ status: 'pending', requestId });
    expect((await send({ password, confirm: 'DELETE', requestId: randomUUID() })).statusCode).toBe(401);
    expect((await send({ password, confirm: 'DELETE' })).statusCode).toBe(401);
  } finally {
    await app.close();
  }
});

const base = process.env.DATABASE_URL;
describe.skipIf(!base)('erasure across isolated real databases', () => {
  const names = ['erasure_game_', 'erasure_corp_'].map((p) => p + randomUUID().replaceAll('-', ''));
  let admin: Pool;
  let game: Pool;
  let corporations: Pool;
  beforeAll(async () => {
    admin = new Pool({ connectionString: base, max: 1 });
    for (const name of names) await admin.query(`CREATE DATABASE "${name}"`);
    const pools = names.map((name) => {
      const url = new URL(base!);
      url.pathname = `/${name}`;
      return new Pool({ connectionString: url.href, max: 1 });
    });
    game = pools[0]!;
    corporations = pools[1]!;
    for (const pool of pools) await migrate(pool);
  });
  afterAll(async () => {
    await Promise.all([game?.end(), corporations?.end()]);
    for (const name of names) {
      for (let attempt = 0; attempt < 40; attempt++) {
        const live = await admin.query('SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname=$1', [name]);
        if (live.rows[0].n === 0) break;
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      await admin.query(`DROP DATABASE IF EXISTS "${name}"`);
    }
    await admin?.end();
  });
  it('atomically disables sessions, erases both stores, preserves other players and replays after restore', async () => {
    const { logs, ledger } = await fixture();
    const store = new PostgresUserStore(game);
    const made = await store.createUser('active', 'hash', subject.email);
    if (!made.ok) throw Error('fixture');
    const record = await store.findById(made.userId);
    if (!record) throw Error('fixture');
    const id = made.userId;
    await game.query('INSERT INTO registration_rewards (account_id, xp) VALUES ($1, 25)', [id]);
    for (const pool of [game, corporations]) {
      await pool.query('INSERT INTO player_profiles VALUES($1,$2)', [id, { portrait: 'test' }]);
      await pool.query('INSERT INTO meta_wallets VALUES($1,42)', [id]);
      await pool.query('INSERT INTO meta_wallets VALUES($1,73)', ['other']);
      await pool.query(
        "INSERT INTO matches(id,data_version,seq,status,state) VALUES('match','t',12,'ongoing',$1)",
        [
          {
            players: { p1: { accountId: id, name: 'active' }, p2: { name: 'other' } },
            status: 'active',
          },
        ],
      );
      await pool.query(
        "INSERT INTO seats(room,nick,player_id,ticket_hash) VALUES('match',$1,'p1','old-ticket')",
        [id],
      );
    }
    // CORP-9: a battle's breakdown names its seats by account and login.
    const seat = { side: 'challenger', score: 1, provinces: 1, out: false };
    await corporations.query(
      "INSERT INTO ava_results(matchup_id,challenger_corp,target_corp,winner_corp,at,format,report) VALUES('mu','c1','c2','c1',1,2,$1)",
      [
        {
          reason: 'score',
          provinces: 9,
          sides: { challenger: { score: 1, provinces: 2 }, target: { score: 0, provinces: 0 } },
          seats: [
            { ...seat, accountId: id, login: 'active' },
            { ...seat, accountId: 'other', login: 'other' },
          ],
        },
      ],
    );
    await new PostgresMetaEconomyStore(game).transaction([id], tx => tx.saveReceipt('meta:hashed-opaque-key', 'opaque-fingerprint', { ok: true }));
    await new PostgresMetaEconomyStore(game).transaction([id, 'other'], tx => tx.saveReceipt('meta:shared-opaque-key', 'shared-fingerprint', { accountId: id, other: 'other' }));
    const request = await store.requestDeletion(record);
    expect(request).toBeTruthy();
    expect(await store.findById(id)).toBeNull();
    expect(await store.findUser('active')).toBeNull();
    expect(await store.requestDeletion(record)).toBeNull();
    const options = { game, corporations, ledger, logDir: logs, analyticsSalts: [salt] };
    const damaged = join(logs, 'client-broken.jsonl');
    await writeFile(damaged, '{"partial":', { mode: 0o600 });
    await expect(runAccountErasure(options)).rejects.toThrow('E_ERASURE_LOG_TRUNCATED');
    expect(await readFile(ledger, 'utf8')).toBe('[]'); // rejected during validation before mutation
    for (const pool of [game, corporations])
      expect((await pool.query('SELECT required FROM account_erasure_guard')).rows[0].required).toBe(true);
    expect((await game.query('SELECT completed_at FROM account_deletions')).rows[0].completed_at).toBeNull();
    await rm(damaged);
    expect(await runAccountErasure(options)).toBe(1);
    for (const pool of [game, corporations]) {
      expect(
        (await pool.query('SELECT * FROM player_profiles WHERE account_id=$1', [id])).rowCount,
      ).toBe(0);
      expect(
        (await pool.query("SELECT warrants FROM meta_wallets WHERE account_id='other'")).rows[0]
          .warrants,
      ).toBe('73');
      const match = (await pool.query('SELECT state,clock FROM matches')).rows[0];
      expect(JSON.stringify(match)).not.toContain(id);
      expect(match.state.players.p1.name).toBe('[deleted]');
      expect(match.state.players.p2.name).toBe('other');
      expect(match.state.status).toBe('active');
      expect(match.clock).toBeNull();
      expect((await pool.query('SELECT nick,ticket_hash FROM seats')).rows[0]).toMatchObject({
        ticket_hash: null,
      });
    }
    const report = (await corporations.query('SELECT report FROM ava_results')).rows[0].report;
    expect(JSON.stringify(report)).not.toContain(id);
    expect(report.seats).toEqual([
      { ...seat, accountId: expect.stringMatching(/^deleted:/), login: '[deleted]' },
      { ...seat, accountId: 'other', login: 'other' },
    ]);
    expect((await game.query('SELECT * FROM registration_rewards WHERE account_id=$1', [id])).rowCount).toBe(0);
    expect(
      (await game.query('SELECT completed_at FROM account_deletions')).rows[0].completed_at,
    ).toBeTruthy();
    expect((await game.query("SELECT * FROM meta_economy_receipts WHERE receipt_key='meta:hashed-opaque-key'")).rowCount).toBe(0);
    expect((await game.query("SELECT account_ids FROM meta_economy_receipts WHERE receipt_key='meta:shared-opaque-key'")).rows[0].account_ids).toEqual(['other']);
    expect(await store.createUser('ACTIVE', 'different-hash')).toEqual({ ok: false, code: 'E_LOGIN_TAKEN' });
    expect(await store.createUser('newpilot', 'different-hash', subject.email)).toMatchObject({ ok: true });
    expect(await runAccountErasure(options)).toBe(0);
    // Simulate restoring a corporation snapshot without restoring the game users table.
    await corporations.query('INSERT INTO player_profiles VALUES($1,$2)', [
      id,
      { portrait: 'old' },
    ]);
    await corporations.query('UPDATE matches SET state=$1', [{ name: 'active', accountId: id }]);
    await game.query('DELETE FROM account_deletions'); // snapshot predates the request
    await corporations.query('UPDATE account_erasure_guard SET required=true');
    // Even the ordinary scheduled path must replay when a restored guard is set.
    expect(await runAccountErasure(options)).toBe(1);
    expect(await runAccountErasure({ ...options, replay: true })).toBe(1);
    expect(await store.createUser('ACTIVE', 'new-owner')).toEqual({ ok: false, code: 'E_LOGIN_TAKEN' });
    expect((await corporations.query('SELECT * FROM player_profiles')).rowCount).toBe(0);
    expect((await corporations.query('SELECT state FROM matches')).rows[0].state.name).toBe(
      '[deleted]',
    );
    expect(
      (await corporations.query('SELECT required FROM account_erasure_guard')).rows[0].required,
    ).toBe(false);
  });
  it('refuses a database with another live runtime connection', async () => {
    const url = new URL(base!);
    url.pathname = `/${names[0]}`;
    const live = new Pool({ connectionString: url.href });
    await live.query('SELECT 1');
    try {
      await expect(eraseAccountDatabase(game, subject)).rejects.toThrow(
        'E_ERASURE_DATABASE_ONLINE',
      );
    } finally {
      await live.end();
    }
  });
});

it('preserves journal ownership and removes ledger temporaries after failed replacement', async () => {
  const { logs, ledger } = await fixture();
  const file = join(logs, 'events.jsonl');
  await writeFile(file, '{"event":"other"}\n', { mode: 0o600 });
  if (process.getuid?.() === 0) await chown(file, 65532, 65532);
  const before = await lstat(file);
  await eraseAccountLogs(logs, subject, [salt]);
  const after = await lstat(file);
  expect([after.uid, after.gid, after.mode & 0o777]).toEqual([before.uid, before.gid, 0o600]);
  // Renaming a regular temp over a directory must fail and clean up the temp.
  const directory = join(logs, 'cannot-replace'); await mkdir(directory);
  await expect(durableReplace(directory, 'private subject')).rejects.toThrow();
  expect((await readdir(logs)).some(name => name.endsWith('.tmp'))).toBe(false);
  await rm(directory, { recursive: true });
  await expect(validateErasureConfiguration({ ledger, logDir: logs, analyticsSalts: [] })).rejects.toThrow('E_ERASURE_SALT_HISTORY');
  await writeFile(file, '{"broken":', { mode: 0o600 });
  await expect(validateErasureConfiguration({ ledger, logDir: logs, analyticsSalts: [salt] })).rejects.toThrow('E_ERASURE_LOG_TRUNCATED');
});
