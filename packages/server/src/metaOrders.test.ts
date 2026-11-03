import { describe, expect, it } from 'vitest';
import pg from 'pg';
import {
  MemoryArsenalStore,
  MemoryDropStore,
  PostgresArsenalStore,
  migrate,
  type ArsenalStore,
} from './store';
import { MemoryMetaEconomyStore, PostgresMetaEconomyStore } from './metaEconomyStore';
import { MemoryMetaMarket, PostgresMetaMarket, type MetaMarket } from './metaMarket';
import { MAX_BUY_ORDERS, validOrderTerms } from './metaOrders';

const KEY = 'module:instance:ion_engine';
const item = (itemId: string, accountId: string, defId = 'ion_engine') => ({
  itemId,
  accountId,
  kind: 'module' as const,
  form: 'instance' as const,
  defId,
  soulbound: false,
  origin: 'drop' as const,
  acquiredAt: 1,
});

describe('buy order terms', () => {
  it('accepts a type key, a positive price and 1..10 pieces', () => {
    expect(validOrderTerms(KEY, 50, 3)).toBeNull();
    expect(validOrderTerms('module:instance:ION', 50, 1)).toBe('E_BAD_REQUEST');
    expect(validOrderTerms('weapon:instance:x', 50, 1)).toBe('E_BAD_REQUEST');
    expect(validOrderTerms(KEY, 0, 1)).toBe('E_BAD_PRICE');
    expect(validOrderTerms(KEY, 1.5, 1)).toBe('E_BAD_PRICE');
    expect(validOrderTerms(KEY, 10, 11)).toBe('E_BAD_QUANTITY');
  });
});

interface Stand {
  market: MetaMarket;
  arsenal: ArsenalStore;
  ids: (name: string) => string;
  credit(accountId: string, amount: number): Promise<void>;
  close(): Promise<void>;
}

function memoryStand(): Stand {
  const arsenal = new MemoryArsenalStore();
  const market = new MemoryMetaMarket(arsenal, () => 1_000, 0);
  market.setEconomy(new MemoryMetaEconomyStore(arsenal, new MemoryDropStore(), market));
  return {
    market,
    arsenal,
    ids: (name) => name,
    credit: async (id, amount) => {
      await market.creditWarrants(id, amount, 'fixture', 'fixture', 0);
    },
    close: async () => undefined,
  };
}

function scenarios(make: () => Promise<Stand>): void {
  it('freezes the order, buys an offer at or below it later and refunds the change', async () => {
    const s = await make();
    try {
      const [buyer, seller, one, two, other] = ['buyer', 'seller', 'one', 'two', 'other'].map(
        s.ids,
      ) as [string, string, string, string, string];
      await s.credit(buyer, 1000);
      const book = s.market.orderBook();
      const placed = await book.place(buyer, 'Buyer', KEY, 100, 2, 'o1');
      expect(placed).toMatchObject({ ok: true, balance: 800, fills: [] });
      if (!placed.ok) return;
      // Повтор того же запроса — та же квитанция, без второй заморозки.
      expect(await book.place(buyer, 'Buyer', KEY, 100, 2, 'o1')).toMatchObject({
        ok: true,
        balance: 800,
      });
      expect(await s.market.balance(buyer)).toBe(800);

      await s.arsenal.grant(item(one, seller));
      await s.arsenal.grant(item(two, seller));
      await s.arsenal.grant(item(other, seller, 'shield_booster'));
      // Чужой тип и лот дороже заказа заказ не трогают.
      const wrong = await s.market.list(seller, 'Seller', other, 10);
      if (!wrong.ok) throw Error('list failed');
      expect(await book.matchListing(wrong.listing.id)).toBeNull();
      const pricey = await s.market.list(seller, 'Seller', two, 150);
      if (!pricey.ok) throw Error('list failed');
      expect(await book.matchListing(pricey.listing.id)).toBeNull();

      const cheap = await s.market.list(seller, 'Seller', one, 70);
      if (!cheap.ok) throw Error('list failed');
      expect(await book.matchListing(cheap.listing.id)).toEqual({
        orderId: placed.order.id,
        listingId: cheap.listing.id,
        buyer: { accountId: buyer, login: 'Buyer' },
        seller: { accountId: seller, login: 'Seller' },
      });
      expect((await s.arsenal.get(one))?.accountId).toBe(buyer);
      expect(await s.market.balance(buyer)).toBe(830);
      expect(await s.market.balance(seller)).toBe(70 - Math.ceil(70 * 0.08));
      expect((await s.market.listings()).some((l) => l.id === cheap.listing.id)).toBe(false);
      expect(await book.mine(buyer)).toMatchObject([{ id: placed.order.id, filled: 1 }]);

      // Отмена возвращает замороженное за оставшуюся штуку.
      expect(await book.cancel(seller, placed.order.id)).toEqual({
        ok: false,
        code: 'E_FORBIDDEN',
      });
      expect(await book.cancel(buyer, placed.order.id)).toEqual({ ok: true, balance: 930 });
      expect(await book.mine(buyer)).toEqual([]);
      expect(await book.cancel(buyer, placed.order.id)).toEqual({
        ok: false,
        code: 'E_NO_BUY_ORDER',
      });
    } finally {
      await s.close();
    }
  });

  it('fills at once from the cheapest offers, never buys its own lot and caps open orders', async () => {
    const s = await make();
    try {
      const [buyer, seller, a, b, own] = ['buyer', 'seller', 'a', 'b', 'own'].map(s.ids) as [
        string,
        string,
        string,
        string,
        string,
      ];
      await s.credit(buyer, 5000);
      await s.arsenal.grant(item(a, seller));
      await s.arsenal.grant(item(b, seller));
      await s.arsenal.grant(item(own, buyer));
      const lotA = await s.market.list(seller, 'Seller', a, 60);
      const lotB = await s.market.list(seller, 'Seller', b, 40);
      const mine = await s.market.list(buyer, 'Buyer', own, 10);
      if (!lotA.ok || !lotB.ok || !mine.ok) throw Error('list failed');
      const book = s.market.orderBook();
      const placed = await book.place(buyer, 'Buyer', KEY, 50, 3, 'now');
      expect(placed).toMatchObject({ ok: true, balance: 5000 - 150 + 10 });
      if (!placed.ok) return;
      expect(placed.fills.map((f) => f.listingId)).toEqual([lotB.listing.id]);
      expect((await s.arsenal.get(b))?.accountId).toBe(buyer);
      expect((await s.arsenal.get(a))?.accountId).toBe(seller);
      expect((await s.arsenal.get(own))?.accountId).toBe(buyer);
      expect(await book.mine(buyer)).toMatchObject([{ filled: 1, quantity: 3 }]);

      for (let i = 1; i < MAX_BUY_ORDERS; i++)
        expect(await book.place(buyer, 'Buyer', KEY, 1, 1, `cap-${i}`)).toMatchObject({
          ok: true,
        });
      expect(await book.place(buyer, 'Buyer', KEY, 1, 1, 'over')).toEqual({
        ok: false,
        code: 'E_BUY_ORDER_LIMIT',
      });
      expect(await book.place(s.ids('poor'), 'Poor', KEY, 10, 1, 'p')).toEqual({
        ok: false,
        code: 'E_INSUFFICIENT',
      });
    } finally {
      await s.close();
    }
  });
}

describe('buy orders — memory', () => {
  scenarios(async () => memoryStand());
});

const databaseUrl = process.env.DATABASE_URL;
describe.skipIf(!databaseUrl)('buy orders — PostgreSQL', () => {
  scenarios(async () => {
    const pool = new pg.Pool({ connectionString: databaseUrl });
    await migrate(pool);
    const suffix = `ord-${Date.now()}-${Math.random()}`;
    const used = new Set<string>();
    const market = new PostgresMetaMarket(pool, () => 1_000, 0);
    market.setEconomy(new PostgresMetaEconomyStore(pool));
    return {
      market,
      arsenal: new PostgresArsenalStore(pool),
      ids: (name) => {
        used.add(`${name}-${suffix}`);
        return `${name}-${suffix}`;
      },
      credit: async (id, amount) => {
        await market.ensureWallet(id);
        await pool.query('UPDATE meta_wallets SET warrants=warrants+$2 WHERE account_id=$1', [
          id,
          amount,
        ]);
      },
      close: async () => {
        const all = [...used];
        await pool.query('DELETE FROM meta_market_orders WHERE account_id = ANY($1)', [all]);
        await pool.query('DELETE FROM meta_market_listings WHERE seller_id = ANY($1)', [all]);
        await pool.query('DELETE FROM meta_market_ledger WHERE account_id = ANY($1)', [all]);
        await pool.query('DELETE FROM meta_market_receipts WHERE account_id = ANY($1)', [all]);
        await pool.query('DELETE FROM meta_wallets WHERE account_id = ANY($1)', [all]);
        await pool.query('DELETE FROM meta_economy_accounts WHERE account_id = ANY($1)', [all]);
        await pool.query('DELETE FROM arsenal WHERE item_id = ANY($1)', [all]);
        await pool.end();
      },
    };
  });
});
