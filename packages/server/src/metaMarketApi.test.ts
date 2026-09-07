import Fastify, { type FastifyRequest } from 'fastify';
import { describe, expect, it } from 'vitest';
import { MemoryArsenalStore } from './store';
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
    registerMetaMarketApi(app, {
      market,
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
