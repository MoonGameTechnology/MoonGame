import Fastify, { type FastifyRequest } from 'fastify';
import { describe, expect, it } from 'vitest';
import { MemoryArsenalStore, MemoryDropStore } from './store';
import { MemoryMetaEconomyStore } from './metaEconomyStore';
import { MemoryMetaMarket } from './metaMarket';
import { registerMetaMarketApi } from './metaMarketApi';

describe('meta market HTTP API', () => {
  it('is authenticated and completes a listing and purchase end to end', async () => {
    const arsenal = new MemoryArsenalStore();
    await arsenal.grant({
      itemId: 'i',
      accountId: 'seller',
      kind: 'module',
      form: 'instance',
      defId: 'ion_engine',
      soulbound: false,
      origin: 'drop',
      acquiredAt: 1,
    });
    // Фаусет выключен по умолчанию (ARS-0 anti-RMT), поэтому тест выдаёт покупателю
    // варранты явно — иначе покупать не на что и сквозной путь не проверяется.
    const market = new MemoryMetaMarket(arsenal, () => 1, 500);
    const app = Fastify();
    const changed: Array<{ accountId: string; owner: string | undefined }> = [];
    registerMetaMarketApi(app, {
      market,
      onChanged: async (identity) => {
        changed.push({ accountId: identity.accountId, owner: (await arsenal.get('i'))?.accountId });
        throw Error('room is temporarily unavailable');
      },
      identify: (r: FastifyRequest) => {
        const login = r.headers['x-user'];
        return Promise.resolve(typeof login === 'string' ? { accountId: login, login } : null);
      },
    });
    expect((await app.inject({ url: '/meta-market' })).statusCode).toBe(401);
    const listed = await app.inject({
      method: 'POST',
      url: '/meta-market/list',
      headers: { 'x-user': 'seller' },
      payload: { itemId: 'i', price: 100 },
    });
    expect(listed.statusCode).toBe(200);
    const listingId = (listed.json() as { listing: { id: string } }).listing.id;
    const bought = await app.inject({
      method: 'POST',
      url: '/meta-market/buy',
      headers: { 'x-user': 'buyer' },
      payload: { listingId },
    });
    expect(bought.statusCode).toBe(200);
    expect((await arsenal.get('i'))?.accountId).toBe('buyer');
    expect(changed).toEqual([
      { accountId: 'buyer', owner: 'buyer' },
      { accountId: 'seller', owner: 'buyer' },
    ]);
    await app.close();
  });
  it('пишущие маршруты под per-IP лимитом (EC-0.3 wash-trading), чтение свободно', async () => {
    const market = new MemoryMetaMarket(new MemoryArsenalStore(), () => 1, 500);
    const app = Fastify();
    registerMetaMarketApi(app, {
      market,
      identify: () => Promise.resolve({ accountId: 'a', login: 'a' }),
      now: () => 0,
      rateMax: 1,
      rateWindowMs: 60_000,
    });
    const buy = (): Promise<{ statusCode: number }> =>
      app.inject({ method: 'POST', url: '/meta-market/buy', payload: { listingId: 'nope' } });
    expect((await buy()).statusCode).toBe(404); // бюджет израсходован, но запрос прошёл
    expect((await buy()).statusCode).toBe(429); // второй за окно — отбит
    expect((await app.inject({ url: '/meta-market' })).statusCode).toBe(200); // чтение свободно
    await app.close();
  });

  it('неожиданный бросок отдаёт стабильный E_INTERNAL, а не стек (инвариант #4)', async () => {
    const market = new MemoryMetaMarket(new MemoryArsenalStore(), () => 1, 0);
    market.listings = () => Promise.reject(new Error('внутренняя деталь БД'));
    const app = Fastify({ logger: false });
    registerMetaMarketApi(app, {
      market,
      identify: () => Promise.resolve({ accountId: 'a', login: 'a' }),
    });
    const res = await app.inject({ url: '/meta-market' });
    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({ error: 'E_INTERNAL' });
    expect(res.body).not.toContain('внутренняя деталь');
    await app.close();
  });
});

describe('meta market material HTTP API', () => {
  it('authenticates material intents, applies the trade gate and allows owners to cancel', async () => {
    const arsenal = new MemoryArsenalStore();
    const market = new MemoryMetaMarket(arsenal, () => 1, 500);
    const economy = new MemoryMetaEconomyStore(arsenal, new MemoryDropStore(), market);
    market.setEconomy(economy);
    await economy.transaction(['seller'], async (tx) => {
      tx.account('seller').materials.push({
        lotId: 'earned',
        materialId: 'ferroalloys',
        quantity: 20,
        soulbound: false,
        source: 'match',
        sourceId: 'match-1',
        acquiredAt: 1,
      });
    });
    const app = Fastify();
    let tradingAllowed = true;
    registerMetaMarketApi(app, {
      market,
      identify: async (request) =>
        typeof request.headers['x-user'] === 'string'
          ? { accountId: request.headers['x-user'], login: request.headers['x-user'] }
          : null,
      canTrade: async () => tradingAllowed,
    });
    try {
      expect(
        (
          await app.inject({
            method: 'POST',
            url: '/meta-market/material/list',
            payload: { materialId: 'ferroalloys', quantity: 10, price: 20, requestId: 'list' },
          })
        ).statusCode,
      ).toBe(401);
      const listed = await app.inject({
        method: 'POST',
        url: '/meta-market/material/list',
        headers: { 'x-user': 'seller' },
        payload: { materialId: 'ferroalloys', quantity: 10, price: 20, requestId: 'list' },
      });
      expect(listed.statusCode).toBe(200);
      const listingId = listed.json<{ listing: { id: string } }>().listing.id;
      const marketView = await app.inject({ url: '/meta-market', headers: { 'x-user': 'seller' } });
      expect(marketView.json()).toMatchObject({
        canTrade: true,
        materialListings: [{ id: listingId, mine: true, quantity: 10 }],
      });
      tradingAllowed = false;
      const denied = await app.inject({
        method: 'POST',
        url: '/meta-market/material/buy',
        headers: { 'x-user': 'buyer' },
        payload: { listingId, tradeId: 'buy' },
      });
      expect(denied.statusCode).toBe(403);
      expect(denied.json()).toEqual({ error: 'E_LEVEL_REQUIRED' });
      expect(
        (
          await app.inject({
            method: 'POST',
            url: '/meta-market/buy',
            headers: { 'x-user': 'buyer' },
            payload: { listingId, tradeId: 'buy' },
          })
        ).statusCode,
      ).toBe(403);
      const cancelled = await app.inject({
        method: 'POST',
        url: '/meta-market/material/cancel',
        headers: { 'x-user': 'seller' },
        payload: { listingId },
      });
      expect(cancelled.statusCode).toBe(200);
      expect(
        (await economy.read('seller')).materials.reduce((sum, lot) => sum + lot.quantity, 0),
      ).toBe(20);
    } finally {
      await app.close();
    }
  });

  it('replays material purchases with the original trade id and rejects malformed keys', async () => {
    const arsenal = new MemoryArsenalStore();
    const market = new MemoryMetaMarket(arsenal, () => 1, 500);
    const economy = new MemoryMetaEconomyStore(arsenal, new MemoryDropStore(), market);
    market.setEconomy(economy);
    await economy.transaction(['seller'], async (tx) => {
      tx.account('seller').materials.push({
        lotId: 'earned',
        materialId: 'ferroalloys',
        quantity: 20,
        soulbound: false,
        source: 'match',
        sourceId: 'match-1',
        acquiredAt: 1,
      });
    });
    const lot = await market.listMaterials('seller', 'Seller', 'ferroalloys', 20, 100, 'listing');
    if (!lot.ok) throw Error('listing failed');
    const app = Fastify();
    registerMetaMarketApi(app, {
      market,
      identify: async () => ({ accountId: 'buyer', login: 'Buyer' }),
    });
    try {
      const buy = (tradeId: unknown) =>
        app.inject({
          method: 'POST',
          url: '/meta-market/material/buy',
          payload: { listingId: lot.listing.id, tradeId },
        });
      expect((await buy('')).statusCode).toBe(400);
      expect((await buy({ forged: true })).statusCode).toBe(400);
      const first = await buy('receipt');
      const replay = await buy('receipt');
      expect(first.statusCode).toBe(200);
      expect(replay.json()).toEqual(first.json());
      expect(await market.balance('buyer')).toBe(400);
    } finally {
      await app.close();
    }
  });
});
