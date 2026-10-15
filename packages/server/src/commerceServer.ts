import Fastify, { type FastifyRequest } from 'fastify';
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import type { CommerceService } from './commerceService';
import { slidingWindowIpLimiter } from './rateLimit';

export interface CommerceServerOptions {
  service: CommerceService;
  /** Game authenticates the session. Commerce never receives the Game JWT secret. */
  identify(request: FastifyRequest): Promise<string | null>;
  logger?: boolean;
  tls?: { key: Buffer; cert: Buffer };
}

export function createCommerceServer(options: CommerceServerOptions) {
  const app = Fastify({
    logger: options.logger ?? false,
    bodyLimit: 65_536,
    ...(options.tls ? { https: { ...options.tls, minVersion: 'TLSv1.2' as const } } : {}),
  });
  const limited = slidingWindowIpLimiter({
    now: Date.now,
    max: 120,
    windowMs: 60_000,
    maxIps: 10_000,
  });
  app.addHook('onRequest', async (request, reply) => {
    reply.header('cache-control', 'no-store');
    reply.header('x-content-type-options', 'nosniff');
    if (request.url !== '/health' && request.url !== '/ready' && limited(request.ip))
      return reply.code(429).send({ error: 'E_RATE_LIMIT' });
  });
  app.setErrorHandler((error, _request, reply) => {
    const message = error instanceof Error ? error.message : '';
    const known: Record<string, number> = {
      E_AUTH: 401,
      E_BAD_REQUEST: 400,
      E_COMMERCE_PROOF: 401,
      E_COMMERCE_CONFLICT: 409,
      E_COMMERCE_REVIEW_REQUIRED: 409,
      E_COMMERCE_UNAVAILABLE: 503,
    };
    if (Object.hasOwn(known, message)) return reply.code(known[message]!).send({ error: message });
    const status = (error as { statusCode?: number }).statusCode;
    if (status && status >= 400 && status < 500)
      return reply.code(status).send({ error: 'E_BAD_REQUEST' });
    return reply.code(503).send({ error: 'E_COMMERCE_UNAVAILABLE' });
  });
  app.get('/health', async () => ({ ok: true }));
  app.get('/ready', async (_request, reply) => {
    try {
      await options.service.ready();
      return { ok: true };
    } catch {
      return reply.code(503).send({ ok: false });
    }
  });
  app.get('/commerce/offers', async () => ({ offers: options.service.offers() }));
  app.post('/commerce/orders', async (request, reply) => {
    const accountId = await options.identify(request);
    if (!accountId) return reply.code(401).send({ error: 'E_AUTH' });
    const body = request.body as Record<string, unknown> | null;
    if (
      !body ||
      typeof body !== 'object' ||
      Array.isArray(body) ||
      Object.keys(body).length !== 3 ||
      typeof body.requestId !== 'string' ||
      typeof body.productId !== 'string' ||
      typeof body.catalogVersion !== 'string'
    )
      return reply.code(400).send({ error: 'E_BAD_REQUEST' });
    const order = await options.service.createOrder(
      accountId,
      body.requestId,
      body.productId,
      body.catalogVersion,
    );
    return { order };
  });
  app.get<{ Params: { orderId: string } }>('/commerce/orders/:orderId', async (request, reply) => {
    const accountId = await options.identify(request);
    if (!accountId) return reply.code(401).send({ error: 'E_AUTH' });
    const order = await options.service.order(accountId, request.params.orderId);
    return order ? { order } : reply.code(404).send({ error: 'E_NOT_FOUND' });
  });
  // Provider verification requires original bytes, never reserialized JSON.
  void app.register(async (scope) => {
    scope.removeAllContentTypeParsers();
    scope.addContentTypeParser(
      '*',
      { parseAs: 'buffer', bodyLimit: 65_536 },
      (_request, body, done) => done(null, body),
    );
    scope.post<{ Params: { provider: string } }>(
      '/commerce/webhooks/:provider',
      async (request, reply) => {
        if (!Buffer.isBuffer(request.body)) return reply.code(400).send({ error: 'E_BAD_REQUEST' });
        const headers = Object.fromEntries(
          Object.entries(request.headers).filter(
            (entry): entry is [string, string] => typeof entry[1] === 'string',
          ),
        );
        await options.service.webhook(request.params.provider, headers, request.body);
        return { accepted: true };
      },
    );
  });
  return app;
}

/** Narrow Game→Commerce identity assertion; no bearer JWT or arbitrary actor from a browser. */
export function commerceGatewayIdentity(options: {
  keys: Readonly<Record<string, string>>;
  claimNonce(nonce: string, expiresAt: number): Promise<boolean>;
  now?: () => number;
}): (request: FastifyRequest) => Promise<string | null> {
  const keys = Object.fromEntries(Object.entries(options.keys));
  if (
    !Object.keys(keys).length ||
    Object.entries(keys).some(([id, key]) => !/^[A-Za-z0-9_-]{1,64}$/.test(id) || key.length < 32)
  )
    throw Error('E_COMMERCE_CONFIG');
  const now = options.now ?? Date.now;
  return async (request) => {
    const encoded = request.headers['x-commerce-gateway-claims'];
    const supplied = request.headers['x-commerce-gateway-signature'];
    if (
      typeof encoded !== 'string' ||
      encoded.length > 2048 ||
      typeof supplied !== 'string' ||
      !/^[a-f0-9]{64}$/.test(supplied)
    )
      return null;
    try {
      const claimsText = Buffer.from(encoded, 'base64url').toString('utf8');
      const claims = JSON.parse(claimsText) as Record<string, unknown>;
      if (
        !claims ||
        typeof claims !== 'object' ||
        Array.isArray(claims) ||
        Object.keys(claims).length !== 7 ||
        claims.issuer !== 'game' ||
        claims.audience !== 'commerce' ||
        claims.capability !== 'orders.self' ||
        typeof claims.keyId !== 'string' ||
        !Object.hasOwn(keys, claims.keyId) ||
        typeof claims.accountId !== 'string' ||
        !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(claims.accountId) ||
        typeof claims.nonce !== 'string' ||
        !/^[A-Za-z0-9_-]{16,64}$/.test(claims.nonce) ||
        typeof claims.at !== 'number' ||
        !Number.isSafeInteger(claims.at) ||
        Math.abs(now() - claims.at) > 30_000
      )
        return null;
      const bodyHash = createHash('sha256')
        .update(JSON.stringify(request.body ?? null))
        .digest('hex');
      const expected = createHmac('sha256', keys[claims.keyId]!)
        .update(`${claimsText}\n${request.method}\n${request.url}\n${bodyHash}`)
        .digest('hex');
      if (!timingSafeEqual(Buffer.from(expected), Buffer.from(supplied))) return null;
      if (!(await options.claimNonce(`${claims.keyId}:${claims.nonce}`, claims.at + 30_000)))
        return null;
      return claims.accountId;
    } catch {
      return null;
    }
  };
}
