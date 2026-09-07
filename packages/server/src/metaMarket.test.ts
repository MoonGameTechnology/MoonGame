import { describe, expect, it } from 'vitest';
import { MemoryArsenalStore } from './store';
import { META_MARKET_FEE, MemoryMetaMarket } from './metaMarket';
import { PostgresArsenalStore, migrate } from './store';
import { PostgresMetaMarket } from './metaMarket';
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

  it('rejects soulbound items, blueprints, self-buy and insufficient funds', async () => {
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
    expect(await market.list('seller', 'S', 'blue', 10)).toMatchObject({
      ok: false,
      code: 'E_BLUEPRINT',
    });
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
