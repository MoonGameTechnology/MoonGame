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
import { extendedEnd, minimumBid, SNIPE_WINDOW_MS } from './metaAuction';

const HOUR = 3_600_000;
const item = (itemId: string, accountId: string) => ({
  itemId,
  accountId,
  kind: 'module' as const,
  form: 'instance' as const,
  defId: 'ion_engine',
  soulbound: false,
  origin: 'drop' as const,
  acquiredAt: 1,
});

describe('auction rules', () => {
  it('steps the next bid by 5% with integer math and at least one warrant', () => {
    expect(minimumBid(100, { endsAt: 0, bids: 0 })).toBe(100);
    expect(
      minimumBid(100, { endsAt: 0, bids: 1, leader: { accountId: 'a', login: 'a', amount: 100 } }),
    ).toBe(105);
    expect(
      minimumBid(1, { endsAt: 0, bids: 1, leader: { accountId: 'a', login: 'a', amount: 3 } }),
    ).toBe(4);
  });

  it('extends only a bid in the last two minutes', () => {
    expect(extendedEnd(10 * HOUR, 0)).toBe(10 * HOUR);
    expect(extendedEnd(1000 + SNIPE_WINDOW_MS - 1, 1000)).toBe(1000 + SNIPE_WINDOW_MS);
  });
});

interface Stand {
  market: MetaMarket;
  arsenal: ArsenalStore;
  clock: { now: number };
  ids: (name: string) => string;
  credit(accountId: string, amount: number): Promise<void>;
  close(): Promise<void>;
}

function memoryStand(): Stand {
  const clock = { now: 1_000 };
  const arsenal = new MemoryArsenalStore();
  const market = new MemoryMetaMarket(arsenal, () => clock.now, 0);
  const economy = new MemoryMetaEconomyStore(arsenal, new MemoryDropStore(), market);
  market.setEconomy(economy);
  return {
    market,
    arsenal,
    clock,
    ids: (name) => name,
    credit: async (id, amount) => {
      await market.creditWarrants(id, amount, 'fixture', 'fixture', 0);
    },
    close: async () => undefined,
  };
}

function scenarios(make: () => Promise<Stand>): void {
  it('holds the leading bid, refunds the outbid leader at once and pays the seller at the end', async () => {
    const s = await make();
    try {
      const [seller, a, b, thing] = ['seller', 'a', 'b', 'thing'].map(s.ids) as [
        string,
        string,
        string,
        string,
      ];
      await s.arsenal.grant(item(thing, seller));
      await s.credit(a, 1000);
      await s.credit(b, 1000);
      const house = s.market.auctionHouse();
      const opened = await house.open(seller, 'Seller', thing, 100, undefined, 12, 6);
      expect(opened.ok).toBe(true);
      if (!opened.ok) return;
      const id = opened.listing.id;
      // На торгах предмет нельзя купить по цене и он не виден в книге продажи по цене.
      expect((await s.market.listings()).some((l) => l.id === id)).toBe(false);
      expect(await s.market.buy(a, id, 'x')).toEqual({ ok: false, code: 'E_NO_LISTING' });

      expect(await house.bid(seller, 'Seller', id, 100, 't0')).toEqual({
        ok: false,
        code: 'E_OWN_LISTING',
      });
      expect(await house.bid(a, 'A', id, 99, 't1')).toEqual({ ok: false, code: 'E_BID_TOO_LOW' });
      expect(await house.bid(a, 'A', id, 100, 't2')).toMatchObject({
        ok: true,
        balance: 900,
        won: false,
      });
      // Повтор той же ставки с тем же id — та же квитанция, без второго списания.
      expect(await house.bid(a, 'A', id, 100, 't2')).toMatchObject({ ok: true, balance: 900 });
      expect(await s.market.balance(a)).toBe(900);
      expect(await house.bid(a, 'A', id, 200, 't3')).toEqual({ ok: false, code: 'E_LEADING' });
      expect(await house.bid(b, 'B', id, 104, 't4')).toEqual({ ok: false, code: 'E_BID_TOO_LOW' });
      expect(await house.bid(b, 'B', id, 105, 't5')).toMatchObject({ ok: true, balance: 895 });
      expect(await s.market.balance(a)).toBe(1000);
      // Лот со ставками снять нельзя.
      expect(await s.market.cancel(seller, id)).toEqual({ ok: false, code: 'E_HAS_BIDS' });

      expect(await house.settleDue()).toEqual([]);
      s.clock.now += 12 * HOUR;
      expect(await house.bid(a, 'A', id, 500, 't6')).toEqual({
        ok: false,
        code: 'E_AUCTION_ENDED',
      });
      const settled = await house.settleDue();
      expect(settled).toEqual([
        {
          listingId: id,
          sellerId: seller,
          sellerLogin: 'Seller',
          winner: { accountId: b, login: 'B' },
        },
      ]);
      expect((await s.arsenal.get(thing))?.accountId).toBe(b);
      expect(await s.market.balance(seller)).toBe(105 - Math.ceil(105 * 0.08));
      expect(await s.market.balance(b)).toBe(895);
      expect(await house.lots()).toEqual([]);
      expect(await house.settleDue()).toEqual([]);
    } finally {
      await s.close();
    }
  });

  it('extends a last-minute bid, sells at buyout at once and returns an unsold item', async () => {
    const s = await make();
    try {
      const [seller, a, b, one, two] = ['seller', 'a', 'b', 'one', 'two'].map(s.ids) as [
        string,
        string,
        string,
        string,
        string,
      ];
      await s.arsenal.grant(item(one, seller));
      await s.arsenal.grant(item(two, seller));
      await s.credit(a, 1000);
      await s.credit(b, 1000);
      const house = s.market.auctionHouse();
      const first = await house.open(seller, 'Seller', one, 100, 300, 12, 6);
      const second = await house.open(seller, 'Seller', two, 50, undefined, 24, 6);
      if (!first.ok || !second.ok) throw Error('open failed');
      // Полка общая с продажей по цене: третий лот при лимите 2 отбит.
      await s.arsenal.grant(item(s.ids('three'), seller));
      expect(
        await house.open(seller, 'Seller', s.ids('three'), 10, undefined, 12, 2),
      ).toMatchObject({ ok: false });
      expect(await house.open(seller, 'Seller', one, 10, undefined, 12, 6)).toMatchObject({
        ok: false,
      });

      s.clock.now += 12 * HOUR - 30_000;
      expect(await house.bid(a, 'A', first.listing.id, 100, 'late')).toMatchObject({ ok: true });
      const late = (await house.lots()).find((l) => l.id === first.listing.id)!;
      expect(late.auction.endsAt).toBe(s.clock.now + SNIPE_WINDOW_MS);
      expect(await house.bid(b, 'B', first.listing.id, 999, 'buy')).toMatchObject({
        ok: true,
        balance: 700,
        won: true,
      });
      expect(await s.market.balance(a)).toBe(1000);
      expect((await s.arsenal.get(one))?.accountId).toBe(b);

      s.clock.now += 13 * HOUR;
      expect(await house.settleDue()).toEqual([
        { listingId: second.listing.id, sellerId: seller, sellerLogin: 'Seller' },
      ]);
      expect((await s.arsenal.get(two))?.accountId).toBe(seller);
    } finally {
      await s.close();
    }
  });
}

describe('auction — memory', () => {
  scenarios(async () => memoryStand());

  it('refuses bad terms', async () => {
    const s = memoryStand();
    await s.arsenal.grant(item('x', 'seller'));
    const house = s.market.auctionHouse();
    expect(await house.open('seller', 'S', 'x', 100, 100, 12, 6)).toEqual({
      ok: false,
      code: 'E_BAD_PRICE',
    });
    expect(await house.open('seller', 'S', 'x', 100, undefined, 5, 6)).toEqual({
      ok: false,
      code: 'E_BAD_DURATION',
    });
    expect(await house.open('other', 'O', 'x', 100, undefined, 12, 6)).toEqual({
      ok: false,
      code: 'E_NOT_OWNER',
    });
  });
});

const databaseUrl = process.env.DATABASE_URL;
describe.skipIf(!databaseUrl)('auction — PostgreSQL', () => {
  scenarios(async () => {
    const pool = new pg.Pool({ connectionString: databaseUrl });
    await migrate(pool);
    const clock = { now: 1_000 };
    const suffix = `auc-${Date.now()}-${Math.random()}`;
    const ids = (name: string): string => `${name}-${suffix}`;
    const market = new PostgresMetaMarket(pool, () => clock.now, 0);
    market.setEconomy(new PostgresMetaEconomyStore(pool));
    const used = new Set<string>();
    return {
      market,
      arsenal: new PostgresArsenalStore(pool),
      clock,
      ids: (name) => {
        used.add(ids(name));
        return ids(name);
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
