import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Identity } from './matchApi';
import type { PlayerActivityStore } from './playerActivity';
import { slidingWindowIpLimiter } from './rateLimit';

export function registerPlayerActivityApi(
  app: FastifyInstance,
  options: {
    store: PlayerActivityStore;
    identify(request: FastifyRequest): Promise<Identity | null>;
    operator(request: FastifyRequest): boolean;
    allowedOrigins?: readonly string[];
    now?: () => number;
  },
): void {
  const now = options.now ?? Date.now;
  const ipLimited = slidingWindowIpLimiter({ now, max: 1200, windowMs: 60_000 });
  const accountLimited = slidingWindowIpLimiter({ now, max: 30, windowMs: 60_000 });
  const globalLimited = slidingWindowIpLimiter({ now, max: 3000, windowMs: 60_000, maxIps: 1 });
  app.post('/activity/pulse', { bodyLimit: 256, config: { rateLimit: false } }, async (req, reply) => {
    const error = (status: number, code: string) => reply.code(status).send({ error: code });
    reply.header('Cache-Control', 'no-store');
    if (
      options.allowedOrigins &&
      req.headers.origin !== undefined &&
      !options.allowedOrigins.includes(req.headers.origin)
    )
      return error(403, 'E_FORBIDDEN');
    if (ipLimited(req.ip)) return error(429, 'E_RATE_LIMIT');
    const body = req.body as Record<string, unknown> | null;
    if (
      !body ||
      typeof body !== 'object' ||
      Array.isArray(body) ||
      Object.keys(body).some((key) => !['channel', 'sequence', 'active', 'sectorZero'].includes(key)) ||
      (body.sectorZero !== undefined && body.sectorZero !== true) ||
      typeof body.channel !== 'string' ||
      !/^[a-f0-9]{32}$/.test(body.channel) ||
      typeof body.active !== 'boolean' ||
      !Number.isInteger(body.sequence) ||
      Number(body.sequence) < 1 ||
      Number(body.sequence) > 2147483647
    )
      return error(400, 'E_BAD_REQUEST');
    try {
      const who = await options.identify(req);
      if (!who) return error(401, 'E_UNAUTHORIZED');
      if (accountLimited(who.accountId) || globalLimited('*')) return error(429, 'E_RATE_LIMIT');
      await options.store.pulse(
        who.accountId,
        body.channel,
        body.active,
        now(),
        Number(body.sequence),
        body.sectorZero === true,
      );
      return reply.code(204).send();
    } catch {
      return error(503, 'E_ACTIVITY_UNAVAILABLE');
    }
  });
  app.get('/metrics/activity', async (req, reply) => {
    if (!options.operator(req)) return reply.callNotFound();
    reply.header('Cache-Control', 'no-store');
    try {
      return await options.store.snapshot(now());
    } catch {
      return reply.code(503).send({ error: 'E_ACTIVITY_UNAVAILABLE' });
    }
  });
}
