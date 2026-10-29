import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { MemoryCorpRentStore, PostgresCorpRentStore, PostgresArsenalStore, migrate } from './store';

describe('warehouse battle allowance', () => {
  it('serializes competing handouts by corp and battle, and keeps other battles independent', async () => {
    const store = new MemoryCorpRentStore();
    const entry = { corpId: 'a', matchupId: 'war', accountId: 'pilot', rentedAt: 1, unworn: true as const };
    const results = await Promise.all(Array.from({ length: 8 }, (_, i) => store.rentWithLimit({ ...entry, itemId: `item-${i}` }, 2)));
    expect(results.filter((r) => r === 'ok')).toHaveLength(2);
    expect(results.filter((r) => r === 'limit')).toHaveLength(6);
    expect(await store.rentWithLimit({ ...entry, itemId: 'item-0' }, 2)).toBe('rented');
    expect(await store.rentWithLimit({ ...entry, matchupId: 'another', itemId: 'item-new' }, 2)).toBe('ok');
    expect((await store.activeForMatchup('war')).every((r) => r.unworn)).toBe(true);
  });
});

describe.skipIf(!process.env.DATABASE_URL)('warehouse concurrent postgres handouts', () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  beforeAll(() => migrate(pool));
  afterAll(() => pool.end());
  it('enforces the shared allowance across store instances and survives restart without wear', async () => {
    const corpId = randomUUID(), matchupId = randomUUID();
    const arsenal = new PostgresArsenalStore(pool);
    const stores = [new PostgresCorpRentStore(pool), new PostgresCorpRentStore(pool)];
    const ids = Array.from({ length: 12 }, () => randomUUID());
    for (const itemId of ids) await arsenal.grant({ itemId, accountId: corpId, kind: 'hull', defId: 'cruiser', form: 'instance', soulbound: false, durability: 5, origin: 'auction', acquiredAt: 1 });
    const results = await Promise.all(ids.map((itemId, i) => stores[i % 2]!.rentWithLimit({ itemId, corpId, matchupId, accountId: 'fighter', rentedAt: 1, unworn: true }, 2)));
    expect(results.filter((r) => r === 'ok')).toHaveLength(2);
    const restarted = new PostgresCorpRentStore(pool);
    const loans = await restarted.activeForCorp(corpId);
    expect(loans).toHaveLength(2);
    expect(loans.every((r) => r.unworn)).toBe(true);
    for (const { itemId } of loans) {
      expect(await restarted.completeReturn(matchupId, itemId, 2, 1)).toBe(true);
      expect(await restarted.completeReturn(matchupId, itemId, 2, 1)).toBe(false);
      expect((await arsenal.get(itemId))?.durability).toBe(5);
    }
    expect(await restarted.activeForCorp(corpId)).toEqual([]);
  });
});
