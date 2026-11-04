import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { MemoryUserStore } from './memory';
import { PostgresUserStore, migrate } from './postgres';

it('rejects concurrent confusable memory registrations without changing authentication identity', async () => {
  const users = new MemoryUserStore();
  const results = await Promise.all(
    ['att_probe', 'аtt_probe'].map((n) => users.createUser(n, 'hash')),
  );
  expect(results.filter((r) => r.ok)).toHaveLength(1);
  expect(await users.findUser('аtt_probe')).toBeNull();
  expect(await users.findUser('att_probe')).toMatchObject({ login: 'att_probe' });
});

describe.skipIf(!process.env.DATABASE_URL)('durable registration collision protection', () => {
  const pools = [
    new Pool({ connectionString: process.env.DATABASE_URL }),
    new Pool({ connectionString: process.env.DATABASE_URL }),
  ];
  beforeAll(() => migrate(pools[0]!));
  afterAll(() => Promise.all(pools.map((p) => p.end())));

  it('serializes visually identical registrations across independent pools and keeps the key after adapter recreation', async () => {
    const suffix = randomUUID();
    const names = [`pilot_${suffix}`, `pіlot_${suffix}`];
    const stores = pools.map((p) => new PostgresUserStore(p));
    const results = await Promise.all(names.map((n, i) => stores[i]!.createUser(n, 'hash')));
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok)).toEqual([{ ok: false, code: 'E_LOGIN_TAKEN' }]);
    const winner = results.findIndex((r) => r.ok);
    expect(await new PostgresUserStore(pools[1]!).createUser(names[1 - winner]!, 'hash')).toEqual({
      ok: false,
      code: 'E_LOGIN_TAKEN',
    });
    expect(await stores[0]!.findUser(names[winner]!)).toMatchObject({ login: names[winner] });
    expect(await stores[0]!.findUser(names[1 - winner]!)).toBeNull();
  });

  it('backfills legacy collisions idempotently without renaming either account or permitting a third lookalike', async () => {
    const suffix = randomUUID();
    const names = [`orbit_${suffix}`, `оrbit_${suffix}`];
    for (const name of names)
      await pools[0]!.query('INSERT INTO users(id,login,pass_hash) VALUES($1,$2,$3)', [
        randomUUID(),
        name,
        'hash',
      ]);
    await migrate(pools[0]!);
    await migrate(pools[0]!);
    const users = new PostgresUserStore(pools[0]!);
    for (const name of names) expect(await users.findUser(name)).toMatchObject({ login: name });
    expect(await users.createUser(`οrbit_${suffix}`, 'hash')).toEqual({
      ok: false,
      code: 'E_LOGIN_TAKEN',
    });
  });
});
