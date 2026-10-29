import type { FastifyInstance, FastifyRequest } from 'fastify';
import { closedInput } from '@void/protocol';
import { slidingWindowIpLimiter } from './rateLimit';
import type { CorpMaterials } from './corpMaterials';
import type { Identity } from './matchApi';

export function registerCorpMaterialsApi(
  app: FastifyInstance,
  service: CorpMaterials,
  identify: (request: FastifyRequest) => Promise<Identity | null>,
  recover = true,
): void {
  const limited = slidingWindowIpLimiter({
    now: Date.now,
    max: 30,
    windowMs: 60_000,
    maxIps: 10_000,
  });
  app.get('/meta-economy/corp-materials', async (req, reply) => {
    reply.header('cache-control', 'no-store');
    const who = await identify(req);
    if (!who) return reply.code(401).send({ error: 'E_AUTH' });
    try {
      return { corp: await service.view(who.accountId) };
    } catch {
      return reply.code(503).send({ error: 'E_UNAVAILABLE' });
    }
  });
  for (const action of ['contribute', 'build'] as const) {
    app.post(`/meta-economy/corp-materials/${action}`, { bodyLimit: 2048 }, async (req, reply) => {
      reply.header('cache-control', 'no-store');
      if (limited(req.ip)) return reply.code(429).send({ error: 'E_RATE_LIMIT' });
      const who = await identify(req);
      if (!who) return reply.code(401).send({ error: 'E_AUTH' });
      const b = req.body;
      const fields =
        action === 'contribute'
          ? ['requestId', 'materialId', 'quantity']
          : ['requestId', 'buildingId', 'expectedLevel', 'price'];
      if (
        !closedInput(b, fields) ||
        Object.keys(b).length !== fields.length ||
        typeof b.requestId !== 'string' ||
        !/^[A-Za-z0-9_-]{8,128}$/.test(b.requestId) ||
        (action === 'contribute'
          ? typeof b.materialId !== 'string' || typeof b.quantity !== 'number'
          : typeof b.buildingId !== 'string' ||
            !/^[a-z_]{1,64}$/.test(b.buildingId) ||
            !Number.isSafeInteger(b.expectedLevel) ||
            (b.expectedLevel as number) < 0 ||
            (b.expectedLevel as number) > 100 ||
            typeof b.price !== 'string' ||
            !/^[a-f0-9]{64}$/.test(b.price))
      )
        return reply.code(400).send({ error: 'E_BAD_REQUEST' });
      try {
        const result =
          action === 'contribute'
            ? await service.contribute(
                who.accountId,
                b.requestId,
                b.materialId as string,
                b.quantity as number,
              )
            : await service.build(who.accountId, {
                requestId: b.requestId,
                buildingId: b.buildingId as string,
                expectedLevel: b.expectedLevel as number,
                price: b.price as string,
              });
        if (!result.ok)
          return reply.code(result.code === 'E_FORBIDDEN' ? 403 : 409).send({ error: result.code });
        return result;
      } catch {
        return reply.code(503).send({ error: 'E_UNAVAILABLE' });
      }
    });
  }
  if (!recover) return;
  const timer = setInterval(() => {
    void service.sweep().catch(() => undefined);
  }, 15_000);
  timer.unref();
  app.addHook('onClose', async () => {
    clearInterval(timer);
  });
  app.addHook('onReady', async () => {
    void service.sweep().catch(() => undefined);
  });
}
