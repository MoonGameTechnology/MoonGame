import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import pg from 'pg';
import {
  MemoryArsenalStore,
  MemoryDropStore,
  PostgresArsenalStore,
  PostgresDropStore,
  migrate,
} from './store';
import { MemoryMetaMarket, PostgresMetaMarket } from './metaMarket';
import { MemoryMetaEconomyStore, PostgresMetaEconomyStore } from './metaEconomyStore';

const databaseUrl = process.env.DATABASE_URL;
const pools: pg.Pool[] = [];
afterEach(async () => {
  await Promise.all(pools.splice(0).map((pool) => pool.end()));
});

async function fixture(backend: 'memory' | 'postgres') {
  if (backend === 'postgres') {
    const pool = new pg.Pool({ connectionString: databaseUrl });
    pools.push(pool);
    await migrate(pool);
    const arsenal = new PostgresArsenalStore(pool);
    const drops = new PostgresDropStore(pool);
    const market = new PostgresMetaMarket(pool);
    const economy = new PostgresMetaEconomyStore(pool);
    market.setEconomy(economy);
    return { arsenal, drops, market, economy };
  }
  const arsenal = new MemoryArsenalStore();
  const drops = new MemoryDropStore();
  const market = new MemoryMetaMarket(arsenal);
  const economy = new MemoryMetaEconomyStore(arsenal, drops, market);
  market.setEconomy(economy);
  return { arsenal, drops, market, economy };
}

for (const backend of ['memory', 'postgres'] as const) {
  describe.skipIf(backend === 'postgres' && !databaseUrl)(
    `Meta/Economy transaction — ${backend}`,
    () => {
      it('rolls back materials, arsenal, pity, warrants and receipt on a failed delivery', async () => {
        const { arsenal, drops, market, economy } = await fixture(backend);
        const account = randomUUID(),
          receipt = randomUUID(),
          itemId = randomUUID();
        await expect(
          economy.transaction([account], async (tx) => {
            tx.account(account).materials.push({
              lotId: 'earned',
              materialId: 'alloy',
              quantity: 10,
              soulbound: false,
              source: 'match',
              sourceId: 'match',
              acquiredAt: 1,
            });
            await tx.arsenal.grant({
              itemId,
              accountId: account,
              kind: 'module',
              form: 'blueprint',
              defId: 'ablative_plating',
              soulbound: false,
              origin: 'drop',
              acquiredAt: 1,
            });
            await tx.drops.stepPity(account, false, 4);
            await tx.drops.claim('match', account);
            await tx.creditWarrants(account, 10, 'match_reward', 'match', 1);
            await tx.saveReceipt(receipt, 'one', { granted: true });
            throw Error('delivery failed');
          }),
        ).rejects.toThrow('delivery failed');
        expect((await economy.read(account)).materials).toEqual([]);
        expect(await arsenal.get(itemId)).toBeNull();
        expect(await drops.pityOf(account)).toBe(0);
        expect(await drops.claim('match', account)).toBe(true);
        expect(await market.balance(account)).toBe(0);
        expect(
          (await market.history(account)).filter((entry) => entry.reason === 'match_reward'),
        ).toEqual([]);
        expect(await economy.receipt(receipt)).toBeNull();
      });

      it('serializes competing changes and persists the exact response with its grant', async () => {
        const { economy, market } = await fixture(backend);
        const account = randomUUID(),
          key = randomUUID();
        const grant = () =>
          economy.transaction([account], async (tx) => {
            const previous = await tx.receipt(key);
            if (previous) return previous.response;
            tx.account(account).counters.grants = (tx.account(account).counters.grants ?? 0) + 1;
            const response = {
              balance: await tx.creditWarrants(account, 17, 'match_reward', 'match', 1),
            };
            await tx.saveReceipt(key, 'fingerprint', response);
            return response;
          });
        expect(await Promise.all([grant(), grant()])).toEqual([{ balance: 17 }, { balance: 17 }]);
        expect(await market.balance(account)).toBe(17);
        expect((await economy.read(account)).counters.grants).toBe(1);
        await expect(
          economy.transaction([account], async (tx) => {
            tx.account(account).counters.grants = 999;
            await tx.saveReceipt(key, 'changed', { balance: 999 });
          }),
        ).rejects.toThrow('E_IDEMPOTENCY_CONFLICT');
        expect((await economy.read(account)).counters.grants).toBe(1);
      });

      it('returns detached state and prevents a paid lot from becoming tradable', async () => {
        const { economy } = await fixture(backend);
        const account = randomUUID();
        await expect(
          economy.transaction([account], async (tx) => {
            tx.account(account).materials.push({
              lotId: 'paid',
              materialId: 'alloy',
              quantity: 5,
              soulbound: false,
              source: 'commerce',
              sourceId: 'purchase',
              acquiredAt: 1,
            });
          }),
        ).rejects.toThrow('E_SOULBOUND');
        const detached = await economy.read(account);
        detached.counters.changed = 1;
        expect((await economy.read(account)).counters).toEqual({});
      });

      it('shares the inventory gate with trading and reserves materials outside craft stock', async () => {
        const { economy, market } = await fixture(backend);
        const seller = randomUUID(),
          buyer = randomUUID();
        await economy.transaction([seller, buyer], async (tx) => {
          tx.account(seller).materials.push({
            lotId: 'earned',
            materialId: 'alloy',
            quantity: 10,
            soulbound: false,
            source: 'match',
            sourceId: 'match',
            acquiredAt: 1,
          });
          await tx.creditWarrants(buyer, 100, 'match_reward', 'match', 1);
        });
        const listed = await market.listMaterials(seller, 'Seller', 'alloy', 8, 20, randomUUID());
        expect(listed.ok).toBe(true);
        if (!listed.ok) return;
        expect(
          (await economy.read(seller)).materials.reduce((sum, lot) => sum + lot.quantity, 0),
        ).toBe(2);
        const bought = await market.buyMaterial(buyer, listed.listing.id, randomUUID());
        expect(bought.ok).toBe(true);
        expect((await economy.read(buyer)).materials).toEqual([
          expect.objectContaining({
            quantity: 8,
            source: 'match',
            sourceId: 'match',
            soulbound: false,
          }),
        ]);
        expect(await market.balance(buyer)).toBe(80);
        expect(await market.balance(seller)).toBe(18);
      });
    },
  );
}
