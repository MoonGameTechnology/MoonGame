import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import Fastify from 'fastify';
import rateLimit from '@fastify/rate-limit';
import { migrate } from './store/postgres';
import {
  MemoryPlayerActivityStore,
  PostgresPlayerActivityStore,
  type PlayerActivityStore,
} from './playerActivity';
import { registerPlayerActivityApi } from './playerActivityApi';

const t = Date.UTC(2026, 9, 20, 12),
  a = 'a'.repeat(32),
  b = 'b'.repeat(32);
async function overlap(store: PlayerActivityStore) {
  const closed = 'c'.repeat(32);
  await store.pulse('alice', closed, false, t, 2);
  await store.pulse('alice', closed, true, t + 1, 1);
  expect((await store.snapshot(t + 1)).online).toBe(0);
  await store.pulse('alice', a, true, t, 1);
  await store.pulse('alice', b, true, t + 10_000, 1);
  await store.pulse('alice', a, true, t + 30_000, 2);
  await store.pulse('alice', b, true, t + 40_000, 2);
  await store.pulse('alice', a, false, t + 45_000, 3);
  await store.pulse('alice', b, false, t + 50_000, 3);
  const out = await store.snapshot(t + 50_000);
  expect(out.online).toBe(0);
  expect(out.days.at(-1)).toEqual({ day: '2026-10-20', players: 1, visits: 2, seconds: 50 });
  // A delayed/duplicate active packet must not resurrect a hidden tab.
  await store.pulse('alice', a, true, t + 55_000, 2);
  expect((await store.snapshot(t + 55_000)).online).toBe(0);
  await store.pulse('alice', a, true, t + 60_000, 4);
  await store.pulse('alice', a, false, t + 65_000, 5);
  expect((await store.snapshot(t + 65_000)).days.at(-1)?.seconds).toBe(55);
}
async function lostClose(store: PlayerActivityStore) {
  await store.pulse('carol', a, true, t, 1);
  // seq 2 was a hidden/offline close; it is lost, then arrives too late.
  await store.pulse('carol', a, true, t + 20_000, 3);
  await store.pulse('carol', a, false, t + 21_000, 2);
  await store.pulse('carol', a, true, t + 30_000, 4);
  await store.pulse('carol', a, false, t + 35_000, 5);
  expect((await store.snapshot(t + 35_000)).days.at(-1)).toEqual({
    day: '2026-10-20', players: 1, visits: 2, seconds: 15,
  });
}
describe('player activity semantics', () => {
  it('counts entry signals once, ignores replay and hidden signals', async () => {
    const store = new MemoryPlayerActivityStore(t);
    await store.pulse('alice', a, true, t, 1, true);
    await store.pulse('alice', a, true, t, 1, true);
    await store.pulse('alice', a, false, t + 1000, 2, true);
    await store.pulse('alice', a, true, t + 2000, 3);
    await store.pulse('alice', a, true, t + 3000, 4, true);
    expect((await store.snapshot(t + 3000)).days.at(-1)?.sectorZeroEntries).toBe(2);
  });
  it('does not charge hidden time across a lost sequence', async () => {
    await lostClose(new MemoryPlayerActivityStore(t));
  });
  it('unions concurrent devices and excludes hidden periods', async () => {
    await overlap(new MemoryPlayerActivityStore(t));
  });
  it('splits confirmed intervals at UTC midnight and drops offline gaps', async () => {
    const start = Date.UTC(2026, 9, 20, 23, 59, 50),
      store = new MemoryPlayerActivityStore(start);
    await store.pulse('alice', a, true, start, 1);
    await store.pulse('alice', a, true, start + 30_000, 2);
    expect((await store.snapshot(start + 30_000)).days).toEqual([
      { day: '2026-10-20', players: 1, visits: 1, seconds: 10 },
      { day: '2026-10-21', players: 1, visits: 0, seconds: 20 },
    ]);
    await store.pulse('alice', a, true, start + 300_000, 3);
    expect((await store.snapshot(start + 300_000)).days.at(-1)?.seconds).toBe(20);
    expect((await store.snapshot(start + 400_000)).online).toBe(0);
    expect((await store.snapshot(start + 31 * 86400000)).days.every((d) => d.players === 0)).toBe(
      true,
    );
  });
  it('counts accounts, not channels, and bounds a channel spray', async () => {
    const store = new MemoryPlayerActivityStore(t);
    for (let i = 0; i < 8; i++)
      await store.pulse('alice', i.toString(16).padStart(32, '0'), true, t, 1);
    await expect(store.pulse('alice', a, true, t, 1)).rejects.toThrow('E_ACTIVITY_CAP');
    await store.pulse('bob', a, true, t, 1);
    expect((await store.snapshot(t)).online).toBe(2);
    expect((await store.snapshot(t)).days.at(-1)?.players).toBe(2);
  });
  it('keeps heartbeat budgets independent from the shared HTTP backstop', async () => {
    const app = Fastify();
    await app.register(rateLimit, { max: 1, timeWindow: '1 minute' });
    app.get('/ordinary', async () => ({ ok: true }));
    registerPlayerActivityApi(app, {
      store: new MemoryPlayerActivityStore(t), now: () => t,
      identify: async () => ({ accountId: 'alice', login: 'alice' }),
      operator: () => false,
    });
    try {
      expect((await app.inject('/ordinary')).statusCode).toBe(200);
      expect((await app.inject('/ordinary')).statusCode).toBe(429);
      for (let sequence = 1; sequence <= 31; sequence++) {
        const response = await app.inject({ method: 'POST', url: '/activity/pulse',
          payload: { channel: a, sequence, active: true } });
        expect(response.statusCode).toBe(sequence <= 30 ? 204 : 429);
      }
    } finally { await app.close(); }
  });
  it('protects both HTTP boundaries; errors never leak internals', async () => {
    const app = Fastify();
    const store = new MemoryPlayerActivityStore(t);
    registerPlayerActivityApi(app, {
      store,
      now: () => t,
      allowedOrigins: ['https://game.example'],
      identify: async (req) =>
        req.headers.authorization === 'Bearer player'
          ? { accountId: 'alice', login: 'alice' }
          : null,
      operator: (req) => req.headers.authorization === 'Bearer operator',
    });
    const post = (
      payload: object,
      authorization = 'Bearer player',
      origin = 'https://game.example',
    ) =>
      app.inject({
        method: 'POST',
        url: '/activity/pulse',
        headers: { authorization, origin },
        payload,
      });
    try {
      expect((await post({ channel: a, sequence: 1, active: true }, '')).statusCode).toBe(401);
      expect(
        (
          await post(
            { channel: a, sequence: 1, active: true },
            'Bearer player',
            'https://evil.example',
          )
        ).statusCode,
      ).toBe(403);
      expect(
        (await post({ channel: a, sequence: 1, active: true, accountId: 'bob' })).statusCode,
      ).toBe(400);
      expect((await post({ channel: a, sequence: 1, active: true, sectorZero: 'true' })).statusCode).toBe(400);
      expect((await post({ channel: a, sequence: 1, active: true, sectorZero: true, accountId: 'bob' })).statusCode).toBe(400);
      expect((await post({ channel: a, sequence: 1, active: true, sectorZero: true })).statusCode).toBe(204);
      expect((await store.snapshot(t)).days.at(-1)?.sectorZeroEntries).toBe(1);
      expect((await app.inject('/metrics/activity')).statusCode).toBe(404);
      const out = await app.inject({
        url: '/metrics/activity',
        headers: { authorization: 'Bearer operator' },
      });
      expect(out.headers['cache-control']).toBe('no-store');
      expect(out.body).not.toContain('alice');
      expect(out.json().online).toBe(1);
      store.pulse = async () => {
        throw Error('database password secret');
      };
      expect((await post({ channel: a, sequence: 2, active: true })).body).toBe(
        '{"error":"E_ACTIVITY_UNAVAILABLE"}',
      );
    } finally {
      await app.close();
    }
  });
});

const url = process.env.DATABASE_URL;
describe.skipIf(!url)('durable activity on real PostgreSQL', () => {
  const name = 'activity_' + randomUUID().replaceAll('-', '');
  let admin: Pool, pool: Pool;
  beforeAll(async () => {
    admin = new Pool({ connectionString: url, max: 1 });
    await admin.query(`CREATE DATABASE "${name}"`);
    const target = new URL(url!);
    target.pathname = '/' + name;
    pool = new Pool({ connectionString: target.toString(), max: 4 });
    // DROP ... WITH (FORCE) in afterAll can terminate a pooled socket that is still closing; the
    // pool re-emits that 57P01 as its own 'error', which without a listener fails the whole run.
    pool.on('error', () => {});
    await migrate(pool);
    await pool.query('UPDATE player_activity_state SET since_ms=$1', [t]);
    for (const id of ['alice', 'bob', 'carol'])
      await pool.query('INSERT INTO users(id,login,pass_hash) VALUES($1,$1,$2)', [id, 'synthetic']);
  });
  afterAll(async () => {
    await pool?.end();
    await admin?.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
    await admin?.end();
  });
  it('persists entry timestamps once and erases them with the account', async () => {
    await pool.query("INSERT INTO users(id,login,pass_hash) VALUES('sector-entry','sector-entry','synthetic')");
    const store = new PostgresPlayerActivityStore(pool);
    await store.pulse('sector-entry', a, true, t, 1, true);
    await store.pulse('sector-entry', a, true, t, 1, true);
    await store.pulse('sector-entry', a, true, t + 1000, 2);
    await store.pulse('sector-entry', a, true, t + 2000, 3, true);
    const row = (await pool.query("SELECT sector_zero_entries,sector_zero_first_ms,sector_zero_last_ms FROM player_activity_days WHERE account_id='sector-entry'")).rows[0];
    expect(row).toEqual({ sector_zero_entries: 2, sector_zero_first_ms: String(t), sector_zero_last_ms: String(t + 2000) });
    expect((await new PostgresPlayerActivityStore(pool).snapshot(t + 2000)).days.at(-1)?.sectorZeroEntries).toBe(2);
    await pool.query("DELETE FROM users WHERE id='sector-entry'");
    expect((await pool.query("SELECT * FROM player_activity_days WHERE account_id='sector-entry'")).rowCount).toBe(0);
  });
  it('does not charge an unconfirmed gap on PostgreSQL', async () => {
    await lostClose(new PostgresPlayerActivityStore(pool));
    await pool.query("DELETE FROM users WHERE id='carol'");
  });
  it('deduplicates concurrent writers, persists across restart and cascades erasure', async () => {
    const store = new PostgresPlayerActivityStore(pool);
    await overlap(store);
    const restarted = new PostgresPlayerActivityStore(pool);
    expect((await restarted.snapshot(t + 65_000)).days.at(-1)?.seconds).toBe(55);
    await Promise.all([store.pulse('bob', a, true, t, 1), store.pulse('bob', b, true, t, 1)]);
    await Promise.all([
      store.pulse('bob', a, true, t + 30_000, 2),
      store.pulse('bob', b, true, t + 30_000, 2),
    ]);
    expect((await store.snapshot(t + 65_000)).days.at(-1)?.seconds).toBe(85);
    await pool.query("DELETE FROM users WHERE id='alice'");
    expect((await store.snapshot(t + 65_000)).days.at(-1)).toEqual({
      day: '2026-10-20',
      players: 1,
      visits: 2,
      seconds: 30,
    });
    await store.snapshot(t + 31 * 86400000);
    expect((await pool.query('SELECT * FROM player_activity_days')).rowCount).toBe(0);
    expect((await pool.query('SELECT * FROM player_activity_channels')).rowCount).toBe(0);
  });
});
