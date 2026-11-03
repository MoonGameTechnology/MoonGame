import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { AuctionRouteKit } from './metaAuctionApi';
import type { BuyOrder, MetaOrders, OrderFill } from './metaOrders';

/** Свой заказ в ответе `GET /meta-market`: без id аккаунта. */
export type BuyOrderView = Omit<BuyOrder, 'accountId' | 'login'>;

/**
 * Заказы на покупку (`metaOrders.ts`): оставить, отменить и выкупить только что
 * выставленный лот. Каждое исполнение меняет арсенал обеих сторон, поэтому обе
 * пересобираются (`changed`), как при обычной покупке.
 */
export function registerMetaOrderRoutes(
  app: FastifyInstance,
  orders: MetaOrders,
  kit: AuctionRouteKit,
): {
  mine(accountId: string): Promise<BuyOrderView[]>;
  afterList(listingId: string, request: FastifyRequest): Promise<void>;
} {
  const synced = async (fills: OrderFill[], request: FastifyRequest): Promise<void> => {
    for (const fill of fills) {
      await kit.changed(fill.buyer, request);
      await kit.changed(fill.seller, request);
    }
  };

  app.post('/meta-market/order', async (request, reply) =>
    kit.guarded(reply, async () => {
      const identity = await kit.writeGate(request, reply);
      if (!identity) return kit.gateError(reply);
      const body = request.body as {
        key?: unknown;
        price?: unknown;
        quantity?: unknown;
        requestId?: unknown;
      } | null;
      if (
        typeof body?.key !== 'string' ||
        typeof body.price !== 'number' ||
        typeof body.quantity !== 'number' ||
        typeof body.requestId !== 'string'
      ) {
        void reply.code(400);
        return { error: 'E_BAD_REQUEST' };
      }
      const result = await orders.place(
        identity.accountId,
        identity.login,
        body.key,
        body.price,
        body.quantity,
        body.requestId,
      );
      if (!result.ok) {
        void reply.code(
          ['E_BAD_REQUEST', 'E_BAD_PRICE', 'E_BAD_QUANTITY'].includes(result.code) ? 400 : 409,
        );
        return { error: result.code };
      }
      await synced(result.fills, request);
      const { accountId: _account, login: _login, ...order } = result.order;
      return { ok: true, order, balance: result.balance, filled: result.fills.length };
    }),
  );

  app.post('/meta-market/order/cancel', async (request, reply) =>
    kit.guarded(reply, async () => {
      const identity = await kit.writeGate(request, reply, false);
      if (!identity) return kit.gateError(reply);
      const body = request.body as { orderId?: unknown } | null;
      if (typeof body?.orderId !== 'string') {
        void reply.code(400);
        return { error: 'E_BAD_REQUEST' };
      }
      const result = await orders.cancel(identity.accountId, body.orderId);
      if (!result.ok) void reply.code(result.code === 'E_NO_BUY_ORDER' ? 404 : 403);
      return result.ok ? result : { error: result.code };
    }),
  );

  return {
    mine: async (accountId) =>
      (await orders.mine(accountId)).map(
        ({ accountId: _account, login: _login, ...order }) => order,
      ),
    afterList: async (listingId, request) => {
      try {
        const fill = await orders.matchListing(listingId);
        if (fill) await synced([fill], request);
      } catch {
        // Лот уже выставлен и виден в книге: сбой подбора заказа не отменяет продажу.
        app.log.error({ code: 'E_ORDER_MATCH', requestId: request.id }, 'order match failed');
      }
    },
  };
}
