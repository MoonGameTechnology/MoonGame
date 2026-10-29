import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { MetaCommandResult, MetaCorpStyleResponse } from '@void/protocol';
import type { MetaEconomy } from './metaEconomy';
import type { Identity } from './matchApi';
import type { CorpMembership } from './store';
import { slidingWindowIpLimiter } from './rateLimit';

export interface MetaEconomyApiDeps {
  economy: Pick<
    MetaEconomy,
    | 'readModel'
    | 'matchRewards'
    | 'setSupplyGoal'
    | 'craft'
    | 'salvage'
    | 'selectPass'
    | 'chooseSeasonReward'
    | 'buyOffer'
    | 'claimPremiumDaily'
    | 'corpStyle'
    | 'buyCorpStyle'
    | 'applyCorpStyle'
  >;
  identify(request: FastifyRequest): Promise<Identity | null>;
  /** The account's corporation (`CorpStore.membershipOf`). Without it the base style
   *  routes are not mounted. */
  corpOf?(accountId: string): Promise<CorpMembership | null>;
  now?: () => number;
  rateMax?: number;
  /** Best-effort refresh of live build catalogs after the value transaction. */
  onChanged?(identity: Identity): Promise<void>;
}

const id = (value: unknown): value is string =>
  typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value);
const bodyRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const fields = (body: Record<string, unknown>, names: readonly string[]): boolean =>
  Object.keys(body).length === names.length && names.every((key) => Object.hasOwn(body, key));

/** The public surface accepts intentions only. Reward facts, source/binding and
 *  entitlement commands have no route here; account identity is session-derived. */
export function registerMetaEconomyApi(app: FastifyInstance, deps: MetaEconomyApiDeps): void {
  const limited = slidingWindowIpLimiter({
    now: deps.now ?? Date.now,
    max: deps.rateMax ?? 30,
    windowMs: 60_000,
    maxIps: 10_000,
  });
  const guard = async (reply: FastifyReply, run: () => Promise<unknown>): Promise<unknown> => {
    reply.header('cache-control', 'no-store');
    try {
      return await run();
    } catch {
      app.log.error(
        { code: 'E_UNAVAILABLE', requestId: reply.request.id },
        'meta-economy request failed',
      );
      return reply.code(503).send({ error: 'E_UNAVAILABLE' });
    }
  };
  app.get('/meta-economy/me', async (request, reply) =>
    guard(reply, async () => {
      const who = await deps.identify(request);
      if (!who) return reply.code(401).send({ error: 'E_AUTH' });
      return deps.economy.readModel(who.accountId);
    }),
  );
  app.get('/meta-economy/matches/:matchId/rewards', async (request, reply) =>
    guard(reply, async () => {
      const who = await deps.identify(request);
      if (!who) return reply.code(401).send({ error: 'E_AUTH' });
      const matchId = (request.params as { matchId?: unknown }).matchId;
      if (!id(matchId)) return reply.code(400).send({ error: 'E_BAD_REQUEST' });
      return deps.economy.matchRewards(who.accountId, matchId);
    }),
  );

  const post = (
    path: string,
    validate: (body: Record<string, unknown>) => boolean,
    run: (accountId: string, body: Record<string, unknown>) => Promise<MetaCommandResult>,
  ): void => {
    app.post(`/meta-economy/${path}`, { bodyLimit: 4096 }, async (request, reply) =>
      guard(reply, async () => {
        if (limited(request.ip)) return reply.code(429).send({ error: 'E_RATE_LIMIT' });
        const who = await deps.identify(request);
        if (!who) return reply.code(401).send({ error: 'E_AUTH' });
        const body = request.body;
        if (!bodyRecord(body) || !id(body.requestId) || !validate(body))
          return reply.code(400).send({ error: 'E_BAD_REQUEST' });
        const result = await run(who.accountId, body);
        if (!result.ok) return reply.code(409).send({ error: result.code });
        if (deps.onChanged) {
          try {
            await deps.onChanged(who);
          } catch {
            app.log.error(
              { code: 'E_META_ECONOMY_SYNC', requestId: request.id },
              'meta-economy live catalog refresh failed',
            );
          }
        }
        return result;
      }),
    );
  };
  post(
    'supply-goal',
    (b) => fields(b, ['requestId', 'recipeId']) && (b.recipeId === null || id(b.recipeId)),
    (account, b) =>
      deps.economy.setSupplyGoal(account, {
        requestId: b.requestId as string,
        recipeId: b.recipeId as string | null,
      }),
  );
  post(
    'craft',
    (b) =>
      fields(b, ['requestId', 'recipeId', 'allowSoulbound']) &&
      id(b.recipeId) &&
      typeof b.allowSoulbound === 'boolean',
    (account, b) =>
      deps.economy.craft(account, {
        requestId: b.requestId as string,
        recipeId: b.recipeId as string,
        allowSoulbound: b.allowSoulbound as boolean,
      }),
  );
  post(
    'salvage',
    (b) => fields(b, ['requestId', 'itemId']) && id(b.itemId),
    (account, b) =>
      deps.economy.salvage(account, {
        requestId: b.requestId as string,
        itemId: b.itemId as string,
      }),
  );
  post(
    'season/select',
    (b) => fields(b, ['requestId', 'seasonId']) && id(b.seasonId),
    (account, b) =>
      deps.economy.selectPass(account, {
        requestId: b.requestId as string,
        seasonId: b.seasonId as string,
      }),
  );
  post(
    'season/claim',
    (b) =>
      fields(b, ['requestId', 'seasonId', 'level', 'defId']) &&
      id(b.seasonId) &&
      id(b.defId) &&
      typeof b.level === 'number' &&
      Number.isSafeInteger(b.level) &&
      b.level > 0 &&
      b.level <= 1000,
    (account, b) =>
      deps.economy.chooseSeasonReward(account, {
        requestId: b.requestId as string,
        seasonId: b.seasonId as string,
        level: b.level as number,
        defId: b.defId as string,
      }),
  );
  post(
    'store/buy',
    (b) => fields(b, ['requestId', 'offerId']) && id(b.offerId),
    (account, b) =>
      deps.economy.buyOffer(account, {
        requestId: b.requestId as string,
        offerId: b.offerId as string,
      }),
  );
  post(
    'premium/daily',
    (b) => fields(b, ['requestId']),
    (account, b) => deps.economy.claimPremiumDaily(account, { requestId: b.requestId as string }),
  );

  // CORP-14: the corporation's base style. The corporation comes from the session, never
  // from the request; only its head spends on the style and applies it.
  const corpOf = deps.corpOf;
  if (!corpOf) return;
  app.get('/meta-economy/corp-style', async (request, reply) =>
    guard(reply, async (): Promise<unknown> => {
      const who = await deps.identify(request);
      if (!who) return reply.code(401).send({ error: 'E_AUTH' });
      const membership = await corpOf(who.accountId);
      if (!membership || membership.role === 'recruit') return { corp: null };
      const style = await deps.economy.corpStyle(membership.corpId);
      const response: MetaCorpStyleResponse = {
        corp: { head: membership.role === 'head', ...style },
      };
      return response;
    }),
  );
  const asHead = async (
    accountId: string,
    run: (corpId: string) => Promise<MetaCommandResult>,
  ): Promise<MetaCommandResult> => {
    const membership = await corpOf(accountId);
    if (!membership || membership.role === 'recruit') return { ok: false, code: 'E_NOT_MEMBER' };
    if (membership.role !== 'head') return { ok: false, code: 'E_FORBIDDEN' };
    return run(membership.corpId);
  };
  post(
    'corp-style/buy',
    (b) => fields(b, ['requestId', 'offerId']) && id(b.offerId),
    (account, b) =>
      asHead(account, (corpId) =>
        deps.economy.buyCorpStyle(account, corpId, {
          requestId: b.requestId as string,
          offerId: b.offerId as string,
        }),
      ),
  );
  post(
    'corp-style/apply',
    (b) => fields(b, ['requestId', 'styleId']) && id(b.styleId),
    (account, b) =>
      asHead(account, (corpId) =>
        deps.economy.applyCorpStyle(corpId, {
          requestId: b.requestId as string,
          styleId: b.styleId as string,
        }),
      ),
  );
}
