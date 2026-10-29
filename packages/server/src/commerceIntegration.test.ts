import { COMMERCE_CATALOG_VERSION, commerceOffers } from './commerceCatalog';
import Fastify from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { CommerceService, type CommerceProvider } from './commerceService';
import { MemoryCommerceStore, type CommerceVerification } from './commerceStore';
import {
  createCommerceEntitlementClient,
  registerCommerceEntitlementApi,
} from './commerceTransport';
import { MetaEconomy } from './metaEconomy';
import { loadMetaEconomyCatalog, loadMetaEconomyCatalogHistory } from './metaEconomyCatalog';
import { MemoryMetaEconomyStore } from './metaEconomyStore';
import { MemoryMetaMarket } from './metaMarket';
import { MemoryArsenalStore, MemoryDropStore } from './store';
import { loadDropTables, loadShippedData } from './scenario';

const apps: ReturnType<typeof Fastify>[] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

async function setup() {
  const data = loadShippedData();
  const catalog = loadMetaEconomyCatalog(data);
  const now = catalog.seasons[0]!.startsAt + 86_400_000;
  const arsenal = new MemoryArsenalStore();
  const drops = new MemoryDropStore();
  const market = new MemoryMetaMarket(arsenal, () => now);
  const metaStore = new MemoryMetaEconomyStore(arsenal, drops, market);
  market.setEconomy(metaStore);
  const economy = new MetaEconomy({
    store: metaStore,
    catalog,
    catalogHistory: loadMetaEconomyCatalogHistory(data),
    dropTables: loadDropTables(data),
    now: () => now,
  });
  const app = Fastify();
  apps.push(app);
  const key = 'test-only-transport-key-'.repeat(3);
  registerCommerceEntitlementApi(app, {
    keys: { v1: key },
    service: {
      apply: (command) => economy.applyEntitlement(command),
      status: (id) => economy.entitlementStatus(id),
    },
    claimNonce: (nonce, expires) => metaStore.claimNonce(nonce, expires),
  });
  const url = await app.listen({ host: '127.0.0.1', port: 0 });
  const provider: CommerceProvider = {
    id: 'test-only',
    offers: [
      { productId: 'supply_personal', price: { amountMinor: 100, currency: 'USD' } },
      { productId: 'rewarded_supply' },
    ],
    verify: async ({ rawBody }) =>
      JSON.parse(Buffer.from(rawBody).toString()) as CommerceVerification,
  };
  const orders = new MemoryCommerceStore();
  const commerce = new CommerceService(
    orders,
    createCommerceEntitlementClient({ url, keyId: 'v1', key }),
    [provider],
    () => now,
  );
  const proof = (
    orderId: string,
    productId = 'supply_personal',
    kind: CommerceVerification['kind'] = 'payment',
  ): CommerceVerification => ({
    eventId: `${orderId}:${kind}`,
    orderId,
    provider: provider.id,
    providerTransactionId: `tx:${orderId}`,
    accountId: 'alice',
    productId,
    catalogVersion: catalog.version,
    kind,
    ...(productId === 'rewarded_supply' ? {} : { amountMinor: 100, currency: 'USD' }),
  });
  const send = (value: CommerceVerification) =>
    commerce.webhook(provider.id, {}, Buffer.from(JSON.stringify(value)));
  return { commerce, economy, metaStore, market, proof, send, now, orders };
}

describe('Commerce to real Meta/Economy over signed HTTP', () => {
  it('delivers an already issued old-catalog order after the catalog update, once', async () => {
    const f = await setup();
    const orderId = 'paid-before-catalog-update';
    await f.orders.create({
      orderId, accountId: 'alice', requestId: 'legacy-checkout', provider: 'test-only',
      offer: { ...commerceOffers().find((offer) => offer.productId === 'supply_personal')!,
        catalogVersion: 'meta-v0.1', available: true, price: { amountMinor: 100, currency: 'USD' } },
      state: 'pending', createdAt: f.now - 1,
    });
    await f.send({ ...f.proof(orderId), catalogVersion: 'meta-v0.1' });
    await f.commerce.deliver();
    expect((await f.commerce.order('alice', orderId))?.state).toBe('fulfilled');
    expect(await f.commerce.deliver()).toBe(0);
    const lots = (await f.metaStore.read('alice')).materials;
    expect(lots.map((lot) => lot.quantity).sort((a, b) => a - b)).toEqual([2, 3, 3, 5]);
    expect(lots.every((lot) => lot.soulbound)).toBe(true);
  });
  it('grants one bound pack, records its receipt and reverses only its materials', async () => {
    const f = await setup();
    await f.economy.settle({
      matchId: 'earned',
      accountId: 'alice',
      kind: 'final',
      place: 1,
      participation: true,
      occurredAt: f.now,
    });
    const earned = (await f.metaStore.read('alice')).materials;
    const warrants = await f.market.balance('alice');
    const order = await f.commerce.createOrder('alice', 'purchase', 'supply_personal', COMMERCE_CATALOG_VERSION);
    await f.send(f.proof(order.orderId));
    await f.commerce.deliver();
    expect((await f.commerce.order('alice', order.orderId))?.state).toBe('fulfilled');
    const paid = (await f.metaStore.read('alice')).materials.filter(
      (lot) => lot.source === 'commerce',
    );
    expect(paid.map((lot) => lot.quantity).sort((a, b) => a - b)).toEqual([2, 3, 3, 5]);
    expect(paid.every((lot) => lot.soulbound)).toBe(true);
    await f.send(f.proof(order.orderId));
    expect(await f.commerce.deliver()).toBe(0);
    expect(await f.market.balance('alice')).toBe(warrants);
    await f.send(f.proof(order.orderId, 'supply_personal', 'refund'));
    await f.commerce.deliver();
    expect((await f.commerce.order('alice', order.orderId))?.state).toBe('revoked');
    expect((await f.metaStore.read('alice')).materials).toEqual(earned);
  });

  it('enforces the account daily rewarded limit in Meta despite three verified orders', async () => {
    const f = await setup();
    const orders = [];
    for (let i = 0; i < 3; i++) {
      const order = await f.commerce.createOrder(
        'alice',
        `ad-${i}`,
        'rewarded_supply',
        COMMERCE_CATALOG_VERSION,
      );
      orders.push(order);
      await f.send(f.proof(order.orderId, 'rewarded_supply', 'rewarded_ad'));
    }
    await f.commerce.deliver();
    const states = await Promise.all(
      orders.map((order) => f.commerce.order('alice', order.orderId)),
    );
    expect(states.filter((order) => order?.state === 'fulfilled')).toHaveLength(2);
    expect(states.filter((order) => order?.state === 'review-required')).toHaveLength(1);
    const lots = (await f.metaStore.read('alice')).materials;
    expect(
      lots.filter((lot) => lot.source === 'ad').reduce((sum, lot) => sum + lot.quantity, 0),
    ).toBe(12);
    expect(lots.every((lot) => lot.soulbound)).toBe(true);
    expect(await f.market.balance('alice')).toBe(0);
  });
});
