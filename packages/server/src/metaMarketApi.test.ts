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
    const market = new MemoryMetaMarket(arsenal);
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
});
