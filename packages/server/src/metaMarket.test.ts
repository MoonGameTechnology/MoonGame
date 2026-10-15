import { describe, expect, it } from 'vitest';
import { MemoryArsenalStore, MemoryDropStore } from './store';
import { MemoryMetaEconomyStore, PostgresMetaEconomyStore } from './metaEconomyStore';
import type { MaterialLot } from '@void/protocol';
import { META_MARKET_FEE, MemoryMetaMarket } from './metaMarket';
import { PostgresArsenalStore, migrate } from './store';
import { MAX_META_LISTINGS, PostgresMetaMarket } from './metaMarket';
import pg from 'pg';

/** Фаусет по умолчанию выключен (anti-RMT), поэтому тесты задают его явно. */
const FAUCET = 500;

const item = (id: string, owner: string, soulbound = false) => ({
  itemId: id,
  accountId: owner,
  kind: 'module' as const,
  form: 'instance' as const,
  defId: 'ion_engine',
  grade: 2,
  soulbound,
  durability: 5,
  origin: 'drop' as const,
  acquiredAt: 1,
});

const databaseUrl = process.env.DATABASE_URL;
describe.skipIf(!databaseUrl)('meta market — PostgreSQL', () => {
  it('commits item, wallets and ledger atomically under competing buyers', async () => {
    const pool = new pg.Pool({ connectionString: databaseUrl });
    await migrate(pool);
    const suffix = `test-${Date.now()}-${Math.random()}`;
    const seller = `seller-${suffix}`,
      a = `a-${suffix}`,
      b = `b-${suffix}`,
      itemId = `item-${suffix}`;
    const arsenal = new PostgresArsenalStore(pool);
    await arsenal.grant(item(itemId, seller));
    const market = new PostgresMetaMarket(pool, () => 123, FAUCET);
    const listed = await market.list(seller, 'Seller', itemId, 100);
    expect(listed.ok).toBe(true);
    if (!listed.ok) return;
    const buys = await Promise.all([
      market.buy(a, listed.listing.id),
      market.buy(b, listed.listing.id),
    ]);
    expect(buys.filter((x) => x.ok)).toHaveLength(1);
    expect(await market.balance(seller)).toBe(592);
    expect(await market.history(seller)).toEqual(
      expect.arrayContaining([expect.objectContaining({ reason: 'sale', delta: 92 })]),
    );
    await pool.query('DELETE FROM meta_market_ledger WHERE account_id = ANY($1)', [[seller, a, b]]);
    await pool.query('DELETE FROM meta_wallets WHERE account_id = ANY($1)', [[seller, a, b]]);
    await pool.query('DELETE FROM meta_market_listings WHERE seller_id=$1', [seller]);
    await pool.query('DELETE FROM arsenal WHERE item_id=$1', [itemId]);
    await pool.end();
  });

  it('a burst of concurrent listings stays under the per-seller cap', async () => {
    const pool = new pg.Pool({ connectionString: databaseUrl, max: 20 });
    await migrate(pool);
    const seller = `cap-${Date.now()}-${Math.random()}`;
    const ids = Array.from({ length: MAX_META_LISTINGS + 5 }, (_, i) => `${seller}-${i}`);
    const arsenal = new PostgresArsenalStore(pool);
    for (const id of ids) await arsenal.grant(item(id, seller));
    const market = new PostgresMetaMarket(pool, () => 1, 0);
    const results = await Promise.all(ids.map((id) => market.list(seller, 'Cap', id, 5)));
    expect(results.filter((r) => r.ok)).toHaveLength(MAX_META_LISTINGS);
    await pool.query('DELETE FROM meta_market_listings WHERE seller_id=$1', [seller]);
    await pool.query('DELETE FROM arsenal WHERE account_id=$1', [seller]);
    await pool.end();
  });
});

describe('meta market', () => {
  it('atomically transfers one tradable instance and burns the fee', async () => {
    const arsenal = new MemoryArsenalStore();
    await arsenal.grant(item('rare', 'seller'));
    const market = new MemoryMetaMarket(arsenal, () => 10, FAUCET);
    const listed = await market.list('seller', 'Seller', 'rare', 100);
    expect(listed.ok).toBe(true);
    if (!listed.ok) return;
    const [a, b] = await Promise.all([
      market.buy('buyer-a', listed.listing.id),
      market.buy('buyer-b', listed.listing.id),
    ]);
    expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1);
    const winner = a.ok ? 'buyer-a' : 'buyer-b';
    expect((await arsenal.get('rare'))?.accountId).toBe(winner);
    expect(await market.balance('seller')).toBe(FAUCET + 100 - Math.ceil(100 * META_MARKET_FEE));
    expect(await market.listings()).toEqual([]);
  });

  it('фаусет выключен по умолчанию — регистрация не печатает варранты (ARS-0 anti-RMT)', async () => {
    const market = new MemoryMetaMarket(new MemoryArsenalStore(), () => 1);
    expect(await market.balance('fresh-account')).toBe(0);
  });

  it('rejects soulbound items, self-buy and insufficient funds; earned blueprints trade', async () => {
    const arsenal = new MemoryArsenalStore();
    await arsenal.grant(item('bound', 'seller', true));
    await arsenal.grant({
      ...item('blue', 'seller'),
      form: 'blueprint',
      grade: undefined,
      durability: undefined,
    });
    await arsenal.grant(item('costly', 'seller'));
    const market = new MemoryMetaMarket(arsenal, () => 1, FAUCET);
    expect(await market.list('seller', 'S', 'bound', 10)).toMatchObject({
      ok: false,
      code: 'E_SOULBOUND',
    });
    expect(await market.list('seller', 'S', 'blue', 10)).toMatchObject({ ok: true });
    const lot = await market.list('seller', 'S', 'costly', 501);
    expect(lot.ok).toBe(true);
    if (!lot.ok) return;
    expect(await market.buy('seller', lot.listing.id)).toMatchObject({
      ok: false,
      code: 'E_OWN_LISTING',
    });
    expect(await market.buy('buyer', lot.listing.id)).toMatchObject({
      ok: false,
      code: 'E_INSUFFICIENT',
    });
  });
});

const material = (lotId: string, quantity: number, soulbound = false): MaterialLot => ({
  lotId,
  materialId: 'ferroalloys',
  quantity,
  soulbound,
  source: soulbound ? 'ad' : 'match',
  sourceId: 'source-match',
  acquiredAt: 1,
});

function memoryEconomy() {
  const arsenal = new MemoryArsenalStore();
  const market = new MemoryMetaMarket(arsenal, () => 100, FAUCET);
  const economy = new MemoryMetaEconomyStore(arsenal, new MemoryDropStore(), market);
  market.setEconomy(economy);
  return { arsenal, market, economy };
}

describe('meta market receipts and material reservations', () => {
  it('replays a successful item purchase without another transfer, rejecting a changed payload', async () => {
    const { arsenal, market, economy } = memoryEconomy();
    await arsenal.grant({ ...item('blueprint', 'seller'), form: 'blueprint' });
    await economy.transaction(['seller'], async (tx) => {
      tx.account('seller').itemSources['blueprint'] = {
        source: 'match',
        sourceId: 'original-match',
      };
    });
    const listed = await market.list('seller', 'Seller', 'blueprint', 100);
    if (!listed.ok) throw Error('listing failed');
    const first = await market.buy('buyer', listed.listing.id, 'purchase-1');
    expect(first).toEqual({ ok: true, balance: 400, tradeId: 'purchase-1' });
    expect(await market.buy('buyer', listed.listing.id, 'purchase-1')).toEqual(first);
    expect(await market.buy('buyer', 'other-listing', 'purchase-1')).toEqual({
      ok: false,
      code: 'E_IDEMPOTENCY_CONFLICT',
    });
    expect(await market.balance('seller')).toBe(592);
    expect((await arsenal.get('blueprint'))?.origin).toBe('drop');
    expect((await economy.read('buyer')).itemSources['blueprint']).toEqual({
      source: 'match',
      sourceId: 'original-match',
    });
    expect((await economy.read('seller')).itemSources['blueprint']).toBeUndefined();
    expect(
      (await market.history('buyer')).filter((entry) => entry.reason === 'purchase'),
    ).toHaveLength(1);
  });

  it('reserves earned stock once and keeps paid/ad stock out of the market', async () => {
    const { market, economy } = memoryEconomy();
    await economy.transaction(['seller'], async (tx) => {
      tx.account('seller').materials.push(material('earned', 20), material('bound', 50, true));
    });
    const listed = await market.listMaterials('seller', 'Seller', 'ferroalloys', 15, 100, 'list-1');
    expect(listed.ok).toBe(true);
    if (!listed.ok) return;
    expect(
      await market.listMaterials('seller', 'Seller', 'ferroalloys', 15, 100, 'list-1'),
    ).toEqual(listed);
    expect(
      await market.listMaterials('seller', 'Seller', 'ferroalloys', 16, 100, 'list-1'),
    ).toEqual({ ok: false, code: 'E_IDEMPOTENCY_CONFLICT' });
    expect(
      (await economy.read('seller')).materials.find((lot) => lot.lotId === 'earned')?.quantity,
    ).toBe(5);
    expect(await market.listMaterials('seller', 'Seller', 'ferroalloys', 6, 100, 'list-2')).toEqual(
      { ok: false, code: 'E_INSUFFICIENT_MATERIALS' },
    );
    expect(await market.cancelMaterial('intruder', listed.listing.id)).toEqual({
      ok: false,
      code: 'E_FORBIDDEN',
    });
    expect(await market.cancelMaterial('seller', listed.listing.id)).toEqual({ ok: true });
    const returned = (await economy.read('seller')).materials.filter(
      (lot) => lot.source === 'match',
    );
    expect(returned.reduce((sum, lot) => sum + lot.quantity, 0)).toBe(20);
    expect(returned.every((lot) => lot.sourceId === 'source-match' && !lot.soulbound)).toBe(true);
  });

  it('serializes buyers, preserves material provenance and replays the purchase receipt', async () => {
    const { market, economy } = memoryEconomy();
    await economy.transaction(['seller'], async (tx) => {
      tx.account('seller').materials.push(material('earned', 20));
    });
    const listed = await market.listMaterials('seller', 'Seller', 'ferroalloys', 20, 100, 'list-1');
    if (!listed.ok) throw Error('listing failed');
    const results = await Promise.all(
      ['a', 'b'].map((buyer) => market.buyMaterial(buyer, listed.listing.id, 'purchase')),
    );
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    const winner = results[0]!.ok ? 'a' : 'b';
    expect(await market.buyMaterial(winner, listed.listing.id, 'purchase')).toEqual(
      results.find((result) => result.ok),
    );
    expect(await market.buy(winner, listed.listing.id, 'purchase')).toEqual({
      ok: false,
      code: 'E_IDEMPOTENCY_CONFLICT',
    });
    expect((await economy.read(winner)).materials).toEqual([
      expect.objectContaining({
        quantity: 20,
        source: 'match',
        sourceId: 'source-match',
        soulbound: false,
      }),
    ]);
    expect(await market.balance(winner)).toBe(400);
    expect(await market.balance('seller')).toBe(592);
    expect(await market.materialListings()).toEqual([]);
  });

  it('rolls back a failure after material movement, wallets and receipt were staged', async () => {
    const { market, economy } = memoryEconomy();
    await economy.transaction(['seller'], async (tx) => {
      tx.account('seller').materials.push(material('earned', 20));
    });
    const listed = await market.listMaterials('seller', 'Seller', 'ferroalloys', 20, 100, 'list-1');
    if (!listed.ok) throw Error('listing failed');
    const transaction = economy.transaction.bind(economy);
    economy.transaction = (ids, work) =>
      transaction(ids, async (tx) => {
        await work(tx);
        throw Error('injected commit failure');
      });
    await expect(market.buyMaterial('buyer', listed.listing.id, 'purchase')).rejects.toThrow(
      'injected commit failure',
    );
    economy.transaction = transaction;
    expect(await market.balance('buyer')).toBe(500);
    expect(await market.balance('seller')).toBe(500);
    expect((await economy.read('buyer')).materials).toEqual([]);
    expect(await market.materialListings()).toHaveLength(1);
    expect(await market.buyMaterial('buyer', listed.listing.id, 'purchase')).toEqual({
      ok: true,
      balance: 400,
      tradeId: 'purchase',
    });
  });

  it('shares the seller cap across item and material lots', async () => {
    const { market, economy, arsenal } = memoryEconomy();
    await economy.transaction(['seller'], async (tx) => {
      tx.account('seller').materials.push(material('earned', MAX_META_LISTINGS));
    });
    await arsenal.grant(item('item', 'seller'));
    await market.list('seller', 'Seller', 'item', 10);
    const results = await Promise.all(
      Array.from({ length: MAX_META_LISTINGS }, (_, index) =>
        market.listMaterials('seller', 'Seller', 'ferroalloys', 1, 1, `list-${index}`),
      ),
    );
    expect(results.filter((result) => result.ok)).toHaveLength(MAX_META_LISTINGS - 1);
    expect(results.filter((result) => !result.ok)).toEqual([{ ok: false, code: 'E_ORDER_LIMIT' }]);
  });
});

describe.skipIf(!databaseUrl)('meta market materials — PostgreSQL', () => {
  it('serializes a material purchase against cancellation without losing escrow', async () => {
    const pool = new pg.Pool({ connectionString: databaseUrl });
    await migrate(pool);
    const suffix = `cancel-${Date.now()}-${Math.random()}`;
    const seller = `s-${suffix}`,
      buyer = `b-${suffix}`;
    const market = new PostgresMetaMarket(pool, () => 100, FAUCET);
    const economy = new PostgresMetaEconomyStore(pool);
    market.setEconomy(economy);
    try {
      await economy.transaction([seller], async (tx) => {
        tx.account(seller).materials.push(material('earned', 20));
      });
      const listed = await market.listMaterials(
        seller,
        'Seller',
        'ferroalloys',
        20,
        100,
        'listing',
      );
      if (!listed.ok) throw Error('listing failed');
      const [bought, cancelled] = await Promise.all([
        market.buyMaterial(buyer, listed.listing.id, 'purchase'),
        market.cancelMaterial(seller, listed.listing.id),
      ]);
      expect([bought, cancelled].filter((result) => result.ok)).toHaveLength(1);
      const sellerMaterials = (await economy.read(seller)).materials.reduce(
        (sum, lot) => sum + lot.quantity,
        0,
      );
      const buyerMaterials = (await economy.read(buyer)).materials.reduce(
        (sum, lot) => sum + lot.quantity,
        0,
      );
      expect(sellerMaterials + buyerMaterials).toBe(20);
      expect(buyerMaterials).toBe(bought.ok ? 20 : 0);
      expect(await market.balance(buyer)).toBe(bought.ok ? 400 : 500);
      expect(await market.balance(seller)).toBe(bought.ok ? 592 : 500);
    } finally {
      await pool.query('DELETE FROM meta_material_listings WHERE seller_id=$1', [seller]);
      await pool.query('DELETE FROM meta_market_receipts WHERE account_id=ANY($1)', [
        [seller, buyer],
      ]);
      await pool.query('DELETE FROM meta_market_ledger WHERE account_id=ANY($1)', [
        [seller, buyer],
      ]);
      await pool.query('DELETE FROM meta_wallets WHERE account_id=ANY($1)', [[seller, buyer]]);
      await pool.query('DELETE FROM meta_economy_accounts WHERE account_id=ANY($1)', [
        [seller, buyer],
      ]);
      await pool.end();
    }
  });

  it('reserves, trades and replays across fresh adapters in one economic transaction', async () => {
    const pool = new pg.Pool({ connectionString: databaseUrl });
    await migrate(pool);
    const suffix = `materials-${Date.now()}-${Math.random()}`;
    const seller = `s-${suffix}`,
      buyer = `b-${suffix}`;
    const market = new PostgresMetaMarket(pool, () => 100, FAUCET);
    const economy = new PostgresMetaEconomyStore(pool);
    market.setEconomy(economy);
    try {
      await economy.transaction([seller], async (tx) => {
        tx.account(seller).materials.push(material('earned', 20), material('bound', 100, true));
      });
      const listed = await market.listMaterials(seller, 'Seller', 'ferroalloys', 20, 100, 'list-1');
      if (!listed.ok) throw Error('listing failed');
      expect(
        await market.listMaterials(seller, 'Seller', 'ferroalloys', 20, 100, 'list-1'),
      ).toEqual(listed);
      expect((await economy.read(seller)).materials).toEqual([material('bound', 100, true)]);
      const transaction = economy.transaction.bind(economy);
      economy.transaction = (ids, work) =>
        transaction(ids, async (tx) => {
          await work(tx);
          throw Error('injected database commit failure');
        });
      await expect(market.buyMaterial(buyer, listed.listing.id, 'purchase')).rejects.toThrow(
        'injected database commit failure',
      );
      economy.transaction = transaction;
      expect((await economy.read(buyer)).materials).toEqual([]);
      expect((await market.materialListings()).some((lot) => lot.id === listed.listing.id)).toBe(
        true,
      );
      expect(await market.balance(buyer)).toBe(500);
      expect(await market.balance(seller)).toBe(500);
      const bought = await market.buyMaterial(buyer, listed.listing.id, 'purchase');
      expect(bought).toEqual({ ok: true, balance: 400, tradeId: 'purchase' });
      const restarted = new PostgresMetaMarket(pool, () => 200, FAUCET);
      restarted.setEconomy(new PostgresMetaEconomyStore(pool));
      expect(await restarted.buyMaterial(buyer, listed.listing.id, 'purchase')).toEqual(bought);
      expect(await restarted.buyMaterial(buyer, 'other', 'purchase')).toEqual({
        ok: false,
        code: 'E_IDEMPOTENCY_CONFLICT',
      });
      expect(await market.balance(seller)).toBe(592);
      expect((await economy.read(buyer)).materials).toEqual([
        expect.objectContaining({ quantity: 20, source: 'match', sourceId: 'source-match' }),
      ]);
    } finally {
      await pool.query('DELETE FROM meta_material_listings WHERE seller_id=$1', [seller]);
      await pool.query('DELETE FROM meta_market_receipts WHERE account_id=ANY($1)', [
        [seller, buyer],
      ]);
      await pool.query('DELETE FROM meta_market_ledger WHERE account_id=ANY($1)', [
        [seller, buyer],
      ]);
      await pool.query('DELETE FROM meta_wallets WHERE account_id=ANY($1)', [[seller, buyer]]);
      await pool.query('DELETE FROM meta_economy_accounts WHERE account_id=ANY($1)', [
        [seller, buyer],
      ]);
      await pool.end();
    }
  });
});
