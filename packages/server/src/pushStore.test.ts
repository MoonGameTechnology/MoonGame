import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { migrate } from './store/postgres';
import { MemoryPushStore, PostgresPushStore, type PushStore } from './store';

// UIX-4.4 · the per-kind push switches survive a round trip through both stores, and a
// row stored before the switches existed (no `kinds`) still reads as «every kind».

const SUB = {
  endpoint: 'https://fcm.googleapis.com/fcm/send/abc',
  keys: { p256dh: 'p', auth: 'a' },
};

async function roundTrip(store: PushStore): Promise<void> {
  await store.save('acc1', SUB);
  expect(await store.of('acc1')).toEqual(SUB);
  await store.save('acc1', { ...SUB, kinds: ['attacked', 'researched'] });
  expect(await store.of('acc1')).toEqual({ ...SUB, kinds: ['attacked', 'researched'] });
  await store.save('acc1', { ...SUB, kinds: [] });
  expect(await store.of('acc1')).toEqual({ ...SUB, kinds: [] });
  await store.save('acc1', SUB); // back to «every kind»
  expect(await store.of('acc1')).toEqual(SUB);
  await store.remove('acc1');
  expect(await store.of('acc1')).toBeUndefined();
}

describe('push subscription store keeps the per-kind switches', () => {
  it('in memory', async () => {
    await roundTrip(new MemoryPushStore());
  });
});

const url = process.env.DATABASE_URL;
describe.skipIf(!url)('on real PostgreSQL', () => {
  const name = 'push_' + randomUUID().replaceAll('-', '');
  let admin: Pool, pool: Pool;
  beforeAll(async () => {
    admin = new Pool({ connectionString: url, max: 1 });
    await admin.query(`CREATE DATABASE "${name}"`);
    const target = new URL(url!);
    target.pathname = '/' + name;
    pool = new Pool({ connectionString: target.toString(), max: 2 });
    await migrate(pool);
  });
  afterAll(async () => {
    await pool?.end();
    if (!admin) return;
    try {
      // pg-pool resolves end() before every socket has closed. Let PostgreSQL
      // observe their closure instead of interrupting idle clients with 57P01.
      for (let attempt = 0; attempt < 40; attempt++) {
        const { rows } = await admin.query(
          'SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname=$1',
          [name],
        );
        if (rows[0].n === 0) break;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      await admin.query(`DROP DATABASE IF EXISTS "${name}"`);
    } finally {
      await admin.end();
    }
  });
  it('round-trips kinds, and an empty list is not «every kind»', async () => {
    await roundTrip(new PostgresPushStore(pool));
  });
  it('a row stored before the column existed reads as every kind', async () => {
    await pool.query(
      `INSERT INTO push_subscriptions (account_id, endpoint, p256dh, auth) VALUES ('old', $1, 'p', 'a')`,
      [SUB.endpoint],
    );
    expect(await new PostgresPushStore(pool).of('old')).toEqual(SUB);
  });
});
