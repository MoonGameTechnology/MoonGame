import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Identity } from './matchApi';
import {
  auctionView,
  type AuctionLotView,
  type AuctionSettlement,
  type MetaAuctions,
} from './metaAuction';

/** Общие для маршрутов аукциона обёртки `registerMetaMarketApi`: бюджет, сессия, fail-secure. */
export interface AuctionRouteKit {
  guarded<T>(reply: FastifyReply, run: () => Promise<T>): Promise<T | { error: 'E_INTERNAL' }>;
  writeGate(
    request: FastifyRequest,
    reply: FastifyReply,
    requireTrading?: boolean,
  ): Promise<Identity | null>;
  gateError(reply: FastifyReply): { error: string };
  changed(identity: Identity, request: FastifyRequest): Promise<void>;
  shelfLimit(accountId: string): Promise<number | undefined>;
}

const MAX_LIMIT = 20;
const SWEEP_MS = 60_000;

/**
 * Торги со ставками (`metaAuction.ts`): открыть лот, поставить, а истёкшие закрыть.
 * Закрытие идёт и при каждом обзоре рынка, и по таймеру раз в минуту: продавец получает
 * выручку, а победитель — предмет, даже если никто из них аукцион не открывает.
 */
export function registerMetaAuctionRoutes(
  app: FastifyInstance,
  auctions: MetaAuctions,
  kit: AuctionRouteKit,
  onSettled?: (settled: AuctionSettlement[]) => Promise<void>,
  sweepMs = SWEEP_MS,
): { settle(): Promise<void>; views(viewer: string): Promise<AuctionLotView[]> } {
  let running: Promise<void> | null = null;
  const settle = (): Promise<void> => {
    running ??= (async () => {
      try {
        const settled = await auctions.settleDue();
        if (settled.length && onSettled) await onSettled(settled);
      } catch {
        app.log.error({ code: 'E_AUCTION_SETTLE' }, 'auction settlement failed');
      } finally {
        running = null;
      }
    })();
    return running;
  };
  if (sweepMs > 0) {
    const timer = setInterval(() => {
      settle().catch(() => undefined);
    }, sweepMs);
    timer.unref?.();
    app.addHook('onClose', async () => clearInterval(timer));
  }

  app.post('/meta-market/auction/open', async (request, reply) =>
    kit.guarded(reply, async () => {
      const identity = await kit.writeGate(request, reply);
      if (!identity) return kit.gateError(reply);
      const body = request.body as {
        itemId?: unknown;
        start?: unknown;
        buyout?: unknown;
        hours?: unknown;
      } | null;
      if (
        typeof body?.itemId !== 'string' ||
        typeof body.start !== 'number' ||
        typeof body.hours !== 'number' ||
        (body.buyout !== undefined && typeof body.buyout !== 'number')
      ) {
        void reply.code(400);
        return { error: 'E_BAD_REQUEST' };
      }
      const result = await auctions.open(
        identity.accountId,
        identity.login,
        body.itemId,
        body.start,
        body.buyout as number | undefined,
        body.hours,
        (await kit.shelfLimit(identity.accountId)) ?? MAX_LIMIT,
      );
      if (!result.ok)
        void reply.code(
          result.code === 'E_BAD_PRICE' || result.code === 'E_BAD_DURATION' ? 400 : 409,
        );
      return result.ok
        ? { ok: true, listing: auctionView(result.listing, identity.accountId) }
        : { error: result.code };
    }),
  );

  app.post('/meta-market/auction/bid', async (request, reply) =>
    kit.guarded(reply, async () => {
      const identity = await kit.writeGate(request, reply);
      if (!identity) return kit.gateError(reply);
      const body = request.body as {
        listingId?: unknown;
        amount?: unknown;
        tradeId?: unknown;
      } | null;
      if (
        typeof body?.listingId !== 'string' ||
        typeof body.amount !== 'number' ||
        typeof body.tradeId !== 'string'
      ) {
        void reply.code(400);
        return { error: 'E_BAD_REQUEST' };
      }
      await settle();
      const result = await auctions.bid(
        identity.accountId,
        identity.login,
        body.listingId,
        body.amount,
        body.tradeId,
      );
      if (result.ok && result.won) await kit.changed(identity, request);
      if (!result.ok)
        void reply.code(
          result.code === 'E_NO_LISTING'
            ? 404
            : result.code === 'E_BAD_REQUEST' || result.code === 'E_BAD_PRICE'
              ? 400
              : 409,
        );
      return result.ok ? result : { error: result.code };
    }),
  );

  return {
    settle,
    views: async (viewer) => (await auctions.lots()).map((lot) => auctionView(lot, viewer)),
  };
}
