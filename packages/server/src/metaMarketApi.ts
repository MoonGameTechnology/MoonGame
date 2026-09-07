import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Identity } from './matchApi';
import { META_MARKET_FEE, type MetaMarket } from './metaMarket';
import { slidingWindowIpLimiter } from './rateLimit';

/** Торговля — спам- и абьюз-поверхность (`economy-roadmap.md` EC-0.3: wash-trading
 *  сдерживается лимитом сделок в окне), поэтому ПИШУЩИЕ маршруты делят per-IP бюджет —
 *  тот же ограниченный по памяти лимитер, что у `corpApi`/`avaApi`. Чтение свободно. */
const RATE_MAX = 30;
const RATE_WINDOW_MS = 60_000;
const RATE_MAX_IPS = 10_000;

export interface MetaMarketApiDeps {
  market: MetaMarket;
  identify(request: FastifyRequest): Promise<Identity | null>;
  /** Инъекция часов и лимитов для детерминированных тестов (как в `corpApi`). */
  now?: () => number;
  rateMax?: number;
  rateWindowMs?: number;
}

export function registerMetaMarketApi(app: FastifyInstance, deps: MetaMarketApiDeps): void {
  const rateLimited = slidingWindowIpLimiter({
    now: deps.now ?? ((): number => Date.now()),
    max: deps.rateMax ?? RATE_MAX,
    windowMs: deps.rateWindowMs ?? RATE_WINDOW_MS,
    maxIps: RATE_MAX_IPS,
  });

  const who = async (request: FastifyRequest, reply: FastifyReply): Promise<Identity | null> => {
    const identity = await deps.identify(request);
    if (!identity) void reply.code(401);
    return identity;
  };

  /**
   * Fail-secure (инвариант #4): любой неожиданный бросок превращается в стабильный
   * `E_INTERNAL` без деталей, а подробности уходят в лог сервера.
   *
   * Без этой обёртки нарушение `CHECK (warrants >= 0)` или дедлок Postgres доезжали бы
   * до клиента как 500 со стеком — то есть утечка внутреннего устройства там, где
   * контракт обещает только код. Держать её обязательно даже после того, как кошельки
   * стали запираться `FOR UPDATE`: блокировка убирает известную гонку, а обёртка
   * закрывает класс — таймаут, обрыв пула, ещё не написанный путь.
   */
  const guarded = async <T>(
    reply: FastifyReply,
    run: () => Promise<T>,
  ): Promise<T | { error: 'E_INTERNAL' }> => {
    try {
      return await run();
    } catch (err) {
      app.log.error({ err }, 'meta-market request failed');
      void reply.code(500);
      return { error: 'E_INTERNAL' as const };
    }
  };

  /** Пишущие маршруты: сначала бюджет, потом сессия. */
  const writeGate = async (
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<Identity | null> => {
    if (rateLimited(request.ip)) {
      void reply.code(429);
      return null;
    }
    return who(request, reply);
  };

  app.get('/meta-market', async (request, reply) =>
    guarded(reply, async () => {
      const identity = await who(request, reply);
      if (!identity) return { error: 'E_AUTH' as const };
      const [balance, listings, history] = await Promise.all([
        deps.market.balance(identity.accountId),
        deps.market.listings(),
        deps.market.history(identity.accountId),
      ]);
      return {
        balance,
        feeRate: META_MARKET_FEE,
        listings: listings.map((listing) => ({
          ...listing,
          mine: listing.sellerId === identity.accountId,
        })),
        history,
      };
    }),
  );

  app.post('/meta-market/list', async (request, reply) =>
    guarded(reply, async () => {
      const identity = await writeGate(request, reply);
      if (!identity) {
        return { error: reply.statusCode === 429 ? ('E_RATE_LIMIT' as const) : ('E_AUTH' as const) };
      }
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
    }),
  );

  app.post('/meta-market/buy', async (request, reply) =>
    guarded(reply, async () => {
      const identity = await writeGate(request, reply);
      if (!identity) {
        return { error: reply.statusCode === 429 ? ('E_RATE_LIMIT' as const) : ('E_AUTH' as const) };
      }
      const id = (request.body as { listingId?: unknown } | null)?.listingId;
      if (typeof id !== 'string') {
        void reply.code(400);
        return { error: 'E_BAD_REQUEST' as const };
      }
      const result = await deps.market.buy(identity.accountId, id);
      if (!result.ok) void reply.code(result.code === 'E_NO_LISTING' ? 404 : 409);
      return result.ok ? result : { error: result.code };
    }),
  );

  app.post('/meta-market/cancel', async (request, reply) =>
    guarded(reply, async () => {
      const identity = await writeGate(request, reply);
      if (!identity) {
        return { error: reply.statusCode === 429 ? ('E_RATE_LIMIT' as const) : ('E_AUTH' as const) };
      }
      const id = (request.body as { listingId?: unknown } | null)?.listingId;
      if (typeof id !== 'string') {
        void reply.code(400);
        return { error: 'E_BAD_REQUEST' as const };
      }
      const result = await deps.market.cancel(identity.accountId, id);
      if (!result.ok) void reply.code(404);
      return result.ok ? result : { error: result.code };
    }),
  );
}
