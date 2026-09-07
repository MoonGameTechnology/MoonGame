import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Identity } from './matchApi';
import type { MetaMarket } from './metaMarket';

export function registerMetaMarketApi(
  app: FastifyInstance,
  deps: { market: MetaMarket; identify(request: FastifyRequest): Promise<Identity | null> },
): void {
  const who = async (request: FastifyRequest, reply: FastifyReply): Promise<Identity | null> => {
    const identity = await deps.identify(request);
    if (!identity) void reply.code(401);
    return identity;
  };
  app.get('/meta-market', async (request, reply) => {
    const identity = await who(request, reply);
    if (!identity) return { error: 'E_AUTH' as const };
    const [balance, listings, history] = await Promise.all([
      deps.market.balance(identity.accountId),
      deps.market.listings(),
      deps.market.history(identity.accountId),
    ]);
    return {
      balance,
      feeRate: 0.08,
      listings: listings.map((listing) => ({
        ...listing,
        mine: listing.sellerId === identity.accountId,
      })),
      history,
    };
  });
  app.post('/meta-market/list', async (request, reply) => {
    const identity = await who(request, reply);
    if (!identity) return { error: 'E_AUTH' as const };
    const body = request.body as { itemId?: unknown; price?: unknown } | null;
    if (typeof body?.itemId !== 'string' || typeof body.price !== 'number') {
      void reply.code(400);
      return { error: 'E_BAD_REQUEST' as const };
    }
    const result = await deps.market.list(
      identity.accountId,
      identity.login,
      body.itemId,
      body.price,
    );
    if (!result.ok) void reply.code(result.code === 'E_NOT_OWNER' ? 404 : 409);
    return result.ok ? result : { error: result.code };
  });
  app.post('/meta-market/buy', async (request, reply) => {
    const identity = await who(request, reply);
    if (!identity) return { error: 'E_AUTH' as const };
    const id = (request.body as { listingId?: unknown } | null)?.listingId;
    if (typeof id !== 'string') {
      void reply.code(400);
      return { error: 'E_BAD_REQUEST' as const };
    }
    const result = await deps.market.buy(identity.accountId, id);
    if (!result.ok) void reply.code(result.code === 'E_NO_LISTING' ? 404 : 409);
    return result.ok ? result : { error: result.code };
  });
  app.post('/meta-market/cancel', async (request, reply) => {
    const identity = await who(request, reply);
    if (!identity) return { error: 'E_AUTH' as const };
    const id = (request.body as { listingId?: unknown } | null)?.listingId;
    if (typeof id !== 'string') {
      void reply.code(400);
      return { error: 'E_BAD_REQUEST' as const };
    }
    const result = await deps.market.cancel(identity.accountId, id);
    if (!result.ok) void reply.code(404);
    return result.ok ? result : { error: result.code };
  });
}
