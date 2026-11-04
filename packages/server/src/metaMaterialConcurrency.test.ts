import { describe, expect, it } from 'vitest';
import pg from 'pg';
import { migrate } from './store';
import { PostgresMetaMarket } from './metaMarket';
import { PostgresMetaEconomyStore } from './metaEconomyStore';

const connectionString = process.env.DATABASE_URL;

describe.skipIf(!connectionString)(
  'Material market conservation using independent PostgreSQL pools',
  () => {
    it.each([2, 4, 6])(
      'conserves a stock of %i across 12 concurrent material listings, purchase and adapter restart',
      async (stock) => {
        const pools = [
          new pg.Pool({ connectionString, max: 8 }),
          new pg.Pool({ connectionString, max: 8 }),
        ];
        const seller = `audit-f16-${stock}-${crypto.randomUUID()}`;
        const buyer = `${seller}-buyer`;
        try {
          await migrate(pools[0]!);
          const economies = pools.map((pool) => new PostgresMetaEconomyStore(pool));
          const markets = pools.map((pool, i) => {
            const market = new PostgresMetaMarket(pool, () => 100, 500);
            market.setEconomy(economies[i]!);
            return market;
          });
          await economies[0]!.transaction([seller], async (tx) => {
            tx.account(seller).materials.push({
              lotId: 'earned',
              materialId: 'construction_blocks',
              quantity: stock,
              soulbound: false,
              source: 'match',
              sourceId: 'audit-source',
              acquiredAt: 1,
            });
          });
          const results = await Promise.all(
            Array.from({ length: 12 }, (_, i) =>
              markets[i % 2]!.listMaterials(
                seller,
                'AuditSeller',
                'construction_blocks',
                4,
                1,
                `list-${i}`,
              ),
            ),
          );
          const winners = results.flatMap((r, i) =>
            r.ok ? [{ result: r, requestId: `list-${i}` }] : [],
          );
          expect(winners).toHaveLength(Math.floor(stock / 4));
          expect(results.filter((r) => !r.ok)).toEqual(
            Array.from({ length: 12 - winners.length }, () => ({
              ok: false,
              code: 'E_INSUFFICIENT_MATERIALS',
            })),
          );
          const sum = async (account: string) =>
            (await economies[0]!.read(account)).materials.reduce((n, x) => n + x.quantity, 0);
          const escrow = await pools[0]!.query(
            'SELECT coalesce(sum(quantity),0) AS amount FROM meta_material_listings WHERE seller_id=$1',
            [seller],
          );
          expect((await sum(seller)) + Number(escrow.rows[0].amount)).toBe(stock);
          const persisted = await pools[0]!.query(
            'SELECT count(*) AS amount FROM meta_market_receipts WHERE account_id=$1',
            [seller],
          );
          expect(Number(persisted.rows[0].amount)).toBe(winners.length);
          for (const winner of winners) {
            const purchase = await markets[1]!.buyMaterial(
              buyer,
              winner.result.listing.id,
              'purchase',
            );
            expect(purchase.ok).toBe(true);
            const restarted = new PostgresMetaMarket(pools[1]!, () => 200, 500);
            restarted.setEconomy(new PostgresMetaEconomyStore(pools[1]!));
            expect(
              await restarted.listMaterials(
                seller,
                'AuditSeller',
                'construction_blocks',
                4,
                1,
                winner.requestId,
              ),
            ).toEqual(winner.result);
            expect(
              await restarted.buyMaterial(buyer, winner.result.listing.id, 'purchase'),
            ).toEqual(purchase);
          }
          expect((await sum(seller)) + (await sum(buyer))).toBe(stock);
          const active = await pools[0]!.query(
            'SELECT count(*) AS amount FROM meta_material_listings WHERE seller_id=$1',
            [seller],
          );
          expect(Number(active.rows[0].amount)).toBe(0);
        } finally {
          await Promise.all(pools.map((pool) => pool.end()));
        }
      },
    );
  },
);
