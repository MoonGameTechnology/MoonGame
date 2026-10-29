import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Identity } from './matchApi';
import type { CorpArsenalService } from './corpArsenalService';

/**
 * Corp-arsenal rentals HTTP API (ARS-6) — session-gated like the corp/medal APIs
 * (the acting identity comes from the session, never the payload).
 *
 *   POST /corp-arsenal/rent  {corpId, itemId, matchupId, accountId}
 *     Hand a corp-owned item to a rostered fighter for one war (head/officer only).
 */

export interface CorpArsenalApiDeps {
  service: CorpArsenalService;
  identify(request: FastifyRequest): Promise<Identity | null>;
}

const STATUS: Record<string, number> = {
  E_FORBIDDEN: 403,
  E_NOT_CORP_ITEM: 404,
  E_NO_MATCHUP: 404,
  E_NOT_PARTY: 403,
  E_ROSTER_LOCKED: 409,
  E_NOT_ROSTERED: 409,
  E_ALREADY_RENTED: 409,
  E_CORP_WAREHOUSE_REQUIRED: 409,
  E_CORP_WAREHOUSE_LIMIT: 409,
  E_BAD_REQUEST: 400,
};

export function registerCorpArsenalApi(app: FastifyInstance, deps: CorpArsenalApiDeps): void {
  const identified = async (
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<Identity | null> => {
    const who = await deps.identify(request);
    if (!who) void reply.code(401);
    return who;
  };

  app.get('/corp-arsenal/:corpId', async (request, reply) => {
    const who = await identified(request, reply);
    if (!who) return { error: 'E_AUTH' };
    const { corpId } = request.params as { corpId: string };
    const { matchupId } = request.query as { matchupId?: unknown };
    if (corpId.length > 100 || (matchupId !== undefined && (typeof matchupId !== 'string' || !matchupId || matchupId.length > 100))) return reply.code(400).send({ error: 'E_BAD_REQUEST' });
    const result = await deps.service.warehouse(who, corpId, matchupId as string | undefined);
    if (!result.ok) return reply.code(STATUS[result.code] ?? 400).send({ error: result.code });
    return reply.header('cache-control', 'no-store').send(result.warehouse);
  });

  app.post('/corp-arsenal/rent', { bodyLimit: 2048 }, async (request, reply) => {
    const who = await identified(request, reply);
    if (!who) return { error: 'E_AUTH' as const };
    const body = request.body as
      | { corpId?: unknown; itemId?: unknown; matchupId?: unknown; accountId?: unknown }
      | null;
    if (
      typeof body?.corpId !== 'string' ||
      typeof body?.itemId !== 'string' ||
      typeof body?.matchupId !== 'string' ||
      typeof body?.accountId !== 'string' ||
      Object.keys(body).some((key) => !['corpId', 'itemId', 'matchupId', 'accountId'].includes(key)) ||
      Object.values(body).some((value) => typeof value !== 'string' || !value || value.length > 100)
    ) {
      void reply.code(400);
      return { error: 'E_BAD_REQUEST' as const };
    }
    const result = await deps.service.rentOut(who, body.corpId, body.itemId, body.matchupId, body.accountId);
    if (!result.ok) {
      void reply.code(STATUS[result.code] ?? 400);
      return { error: result.code };
    }
    return { ok: true };
  });
}
