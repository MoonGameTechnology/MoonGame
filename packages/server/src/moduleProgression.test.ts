import { afterEach, describe, expect, it, vi } from 'vitest';
import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { effectiveStats, type ArsenalItem } from '@void/shared-core';
import { MetaEconomy } from './metaEconomy';
import { loadMetaEconomyCatalog } from './metaEconomyCatalog';
import { MemoryMetaEconomyStore, PostgresMetaEconomyStore } from './metaEconomyStore';
import { MemoryMetaMarket, PostgresMetaMarket } from './metaMarket';
import { MemoryArsenalStore, MemoryDropStore, PostgresArsenalStore, migrate } from './store';
import { loadDropTables, loadShippedData } from './scenario';
import { arsenalSnapshotOf } from './arsenal';
import { moduleRoll } from './moduleProgression';

const data = loadShippedData();
const pools: pg.Pool[] = [];
const schemas = new Map<pg.Pool, string>();
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(
    pools.splice(0).map(async (p) => {
      const schema = schemas.get(p);
      if (schema) await p.query(`DROP SCHEMA "${schema}" CASCADE`); // generated hex identifier, fixture-owned
      await p.end();
    }),
  );
});
async function fixture(backend: 'memory' | 'postgres', makeSeed = () => 'seed') {
  const schema = `module_chain_${randomUUID().replaceAll('-', '')}`;
  const pool =
    backend === 'postgres'
      ? new pg.Pool({
          connectionString: process.env.DATABASE_URL,
          options: `-c search_path=${schema}`,
        })
      : null;
  if (pool) {
    pools.push(pool);
    schemas.set(pool, schema);
    await pool.query(`CREATE SCHEMA "${schema}"`); // generated hex identifier, never user input
    await migrate(pool);
  }
  const memoryArsenal = new MemoryArsenalStore();
  const arsenal = pool ? new PostgresArsenalStore(pool) : memoryArsenal;
  const memoryMarket = new MemoryMetaMarket(memoryArsenal);
  const market = pool ? new PostgresMetaMarket(pool) : memoryMarket;
  const store = pool
    ? new PostgresMetaEconomyStore(pool)
    : new MemoryMetaEconomyStore(memoryArsenal, new MemoryDropStore(), memoryMarket);
  market.setEconomy(store);
  const accountId = randomUUID(),
    buyer = randomUUID();
  const service = () =>
    new MetaEconomy({
      store,
      catalog: loadMetaEconomyCatalog(data),
      dropTables: loadDropTables(data),
      moduleData: data,
      moduleSeed: makeSeed,
    });
  const economy = service();
  const grant = async (id: string, extra: Partial<ArsenalItem> = {}, owner = accountId) => {
    const item: ArsenalItem = {
      itemId: `${accountId}:${id}`,
      kind: 'module',
      form: 'instance',
      defId: 'cargo_bay',
      soulbound: false,
      origin: 'craft',
      acquiredAt: 1,
      ...extra,
    };
    await arsenal.grant({ ...item, accountId: owner });
    return item;
  };
  await store.transaction([accountId, buyer], async (tx) => {
    await tx.creditWarrants(accountId, 10_000, 'test', 'test', 1);
    await tx.creditWarrants(buyer, 10_000, 'test', 'test', 1);
  });
  const copies = async (prefix = 'copy', bound = false) =>
    Promise.all(
      [1, 2, 3].map((n) => grant(`${prefix}${n}`, { form: 'blueprint', soulbound: bound })),
    );
  const command = async (
    itemId: string,
    mode: 'stars' | 'rarity' = 'stars',
    requestId = randomUUID(),
  ) => {
    const quote = (await economy.readModel(accountId)).moduleUpgrades!.find(
      (q) => q.itemId === itemId && q.mode === mode,
    )!;
    return {
      requestId,
      itemId,
      mode,
      grade: quote.grade,
      rarity: quote.rarity,
      ingredientIds: quote.ingredientIds,
      allowSoulbound: quote.binds,
    };
  };
  return { arsenal, market, store, economy, service, accountId, buyer, grant, copies, command };
}

for (const backend of ['memory', 'postgres'] as const)
  describe.skipIf(backend === 'postgres' && !process.env.DATABASE_URL)(
    `module chain / ${backend}`,
    () => {
      it('upgrades exactly once, projects real combat stats and transfers the upgraded copy', async () => {
        const f = await fixture(backend),
          item = await f.grant('target', { form: 'blueprint' });
        await f.copies();
        const c = await f.command(item.itemId);
        const result = await f.economy.upgradeModule(f.accountId, c);
        expect(result.ok && result.receipt.moduleUpgrade?.success).toBe(true);
        expect(await f.service().upgradeModule(f.accountId, c)).toEqual(result); // new service / durable receipt
        expect(await f.market.balance(f.accountId)).toBe(9980);
        const owned = await f.arsenal.listOf(f.accountId);
        expect(owned).toHaveLength(1);
        expect(owned[0]?.grade).toBe(1);
        expect(owned[0]?.form).toBe('instance');
        const snapshot = arsenalSnapshotOf(owned);
        const hull = data.units.cruiser!;
        expect(
          effectiveStats(hull, { modules: ['cargo_bay'], moduleStars: snapshot.stars }, data)
            .cargoCapacity,
        ).toBe(
          Math.round(
            hull.stats.cargoCapacity! + data.modules.cargo_bay!.effects.stats.cargoCapacity! * 1.1,
          ),
        );
        await f.economy.selectModule(f.accountId, { requestId: 'select', itemId: item.itemId });
        const listed = await f.market.list(f.accountId, 'seller', item.itemId, 100);
        expect(listed.ok).toBe(true);
        if (!listed.ok) return;
        expect(
          (await f.market.listings()).find((l) => l.id === listed.listing.id)?.item.grade,
        ).toBe(1);
        const bought = await f.market.buy(f.buyer, listed.listing.id, 'trade');
        expect(bought.ok).toBe(true);
        const transferred = await f.arsenal.get(item.itemId);
        expect(transferred).toMatchObject({
          accountId: f.buyer,
          grade: 1,
          upgrade: { attempts: 1, misses: 0 },
        });
        expect(transferred?.preferred).toBeUndefined();
        expect(arsenalSnapshotOf(await f.arsenal.listOf(f.accountId)).modules).toEqual([]);
      });
      it('rejects listed items, чужие ingredients and stale previews without spending', async () => {
        const f = await fixture(backend),
          target = await f.grant('target');
        await f.copies();
        const c = await f.command(target.itemId);
        const foreign = await f.grant('foreign', {}, f.buyer);
        expect(
          await f.economy.upgradeModule(f.accountId, {
            ...c,
            ingredientIds: [foreign.itemId, ...c.ingredientIds.slice(1)],
          }),
        ).toEqual({ ok: false, code: 'E_MODULE_COPIES' });
        const listed = await f.market.list(f.accountId, 'seller', c.ingredientIds[0]!, 100);
        expect(listed.ok).toBe(true);
        expect(await f.economy.upgradeModule(f.accountId, c)).toEqual({
          ok: false,
          code: 'E_ITEM_LISTED',
        });
        expect(await f.market.balance(f.accountId)).toBe(10_000);
        expect((await f.arsenal.listOf(f.accountId)).length).toBe(4);
      });
      it('serializes concurrent upgrades and never launders bound inputs', async () => {
        const f = await fixture(backend),
          item = await f.grant('target');
        await f.copies('a', true);
        const c = await f.command(item.itemId);
        expect(await f.economy.upgradeModule(f.accountId, { ...c, allowSoulbound: false })).toEqual(
          { ok: false, code: 'E_SOULBOUND_CONFIRM' },
        );
        const commands = [c, { ...c, requestId: 'second' }];
        const results = await Promise.all(
          commands.map((command) => f.economy.upgradeModule(f.accountId, command)),
        );
        expect(results.filter((r) => r.ok)).toHaveLength(1);
        expect(await f.market.balance(f.accountId)).toBe(9980);
        expect(await f.arsenal.get(item.itemId)).toMatchObject({ grade: 1, soulbound: true });
        expect(await f.market.list(f.accountId, 'seller', item.itemId, 100)).toEqual({
          ok: false,
          code: backend === 'postgres' ? 'E_NOT_TRADABLE' : 'E_SOULBOUND',
        });
        // Either transaction may acquire the PostgreSQL lock first. Only the
        // committed command owns a receipt whose request id can conflict.
        const committed = commands[results.findIndex((result) => result.ok)]!;
        expect(await f.economy.upgradeModule(f.accountId, { ...committed, mode: 'rarity' })).toEqual({
          ok: false,
          code: 'E_IDEMPOTENCY_CONFLICT',
        });
      });
      it('rolls back the wallet, ingredients and receipt if the final item write fails', async () => {
        const f = await fixture(backend),
          item = await f.grant('target');
        await f.copies();
        const c = await f.command(item.itemId);
        const proto =
          backend === 'postgres' ? PostgresArsenalStore.prototype : MemoryArsenalStore.prototype;
        const write = vi.spyOn(proto, 'update').mockResolvedValueOnce(false);
        expect(await f.economy.upgradeModule(f.accountId, c)).toEqual({
          ok: false,
          code: 'E_NOT_OWNER',
        });
        write.mockRestore();
        expect(await f.market.balance(f.accountId)).toBe(10_000);
        expect(await f.arsenal.listOf(f.accountId)).toHaveLength(4);
        expect((await f.arsenal.get(item.itemId))?.grade).toBeUndefined();
        expect((await f.economy.upgradeModule(f.accountId, c)).ok).toBe(true);
        expect(await f.market.balance(f.accountId)).toBe(9980);
      });
      it('keeps stars on failure, carries pity across service restart, then forces success', async () => {
        const failingSeed = ['a', 'b', 'c', 'd', 'e'].find((s) => moduleRoll(s) >= 0.55)!;
        expect(failingSeed).toBeTruthy();
        const f = await fixture(backend, () => failingSeed),
          item = await f.grant('target', { grade: 3, rarity: 'unique' });
        for (let n = 0; n < 4; n++) {
          await f.copies(`try${n}`);
          const result = await f.service().upgradeModule(f.accountId, await f.command(item.itemId));
          expect(result.ok && result.receipt.moduleUpgrade?.success).toBe(n === 3);
          expect((await f.arsenal.get(item.itemId))?.grade).toBe(n === 3 ? 4 : 3);
        }
        expect(await f.market.balance(f.accountId)).toBe(10_000 - 4 * 180);
      });
      it('raises rarity with an earned blueprint and three copies; a selected weaker copy stays selected', async () => {
        const f = await fixture(backend),
          item = await f.grant('target'),
          stronger = await f.grant('strong', { grade: 3 });
        await f.copies();
        await f.store.transaction([f.accountId], async (tx) => {
          tx.account(f.accountId).moduleBlueprints = { unique: 1 };
        });
        const c = await f.command(item.itemId, 'rarity');
        expect((await f.economy.upgradeModule(f.accountId, c)).ok).toBe(true);
        expect(await f.arsenal.get(item.itemId)).toMatchObject({
          rarity: 'unique',
          soulbound: false,
        });
        await f.economy.selectModule(f.accountId, { itemId: item.itemId, requestId: 'prefer' });
        const snap = arsenalSnapshotOf(await f.arsenal.listOf(f.accountId));
        expect(snap.stars).toBeUndefined();
        expect(snap.rarity).toEqual({ cargo_bay: 'unique' });
        expect((await f.arsenal.get(stronger.itemId))?.grade).toBe(3);
        expect((await f.store.read(f.accountId)).moduleBlueprints?.unique).toBe(0);
      });
    },
  );
