import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Identity } from './matchApi';

export interface CorporateEndpoint {
  url: string;
  key: string;
  timeoutMs?: number;
}
export function corporateEndpoint(env: NodeJS.ProcessEnv): CorporateEndpoint | undefined {
  if (!env.CORPORATIONS_URL) return undefined;
  const url = new URL(env.CORPORATIONS_URL);
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash ||
    !env.CORPORATIONS_KEY ||
    env.CORPORATIONS_KEY.length < 32
  )
    throw Error('E_CORPORATIONS_CONFIG');
  return { url: url.origin, key: env.CORPORATIONS_KEY };
}
function digest(body: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify(body ?? null))
    .digest('hex');
}
function signature(
  key: string,
  method: string,
  path: string,
  body: unknown,
  claims: string,
): string {
  return createHmac('sha256', key)
    .update(`${claims}\n${method}\n${path}\n${digest(body)}`)
    .digest('hex');
}
export async function corporateRequest(
  endpoint: CorporateEndpoint,
  method: string,
  path: string,
  body?: unknown,
  who?: Identity,
  ip = '127.0.0.1',
): Promise<{ status: number; body: unknown }> {
  const claims = JSON.stringify({
    at: Date.now(),
    nonce: randomUUID(),
    who: who ? { accountId: who.accountId, login: who.login } : null,
    ip,
  });
  const response = await fetch(`${endpoint.url}${path}`, {
    method,
    redirect: 'error',
    signal: AbortSignal.timeout(endpoint.timeoutMs ?? 2000),
    headers: {
      'content-type': 'application/json',
      'x-corp-claims': Buffer.from(claims).toString('base64url'),
      'x-corp-signature': signature(endpoint.key, method, path, body, claims),
    },
    ...(method === 'GET' ? {} : { body: JSON.stringify(body ?? null) }),
  });
  // A corrupt/untrusted response cannot become a successful game operation.
  const reader = response.body?.getReader();
  if (!reader) throw Error('E_CORPORATIONS_RESPONSE');
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > 1_048_576) throw Error('E_CORPORATIONS_RESPONSE');
      chunks.push(next.value);
    }
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
  const payload = Buffer.concat(chunks);
  const supplied = response.headers.get('x-corp-response-signature');
  const expected = createHmac('sha256', endpoint.key)
    .update(
      `${claims}\nresponse\n${response.status}\n${createHash('sha256').update(payload).digest('hex')}`,
    )
    .digest('hex');
  if (
    !supplied ||
    !/^[a-f0-9]{64}$/.test(supplied) ||
    !timingSafeEqual(Buffer.from(expected), Buffer.from(supplied))
  )
    throw Error('E_CORPORATIONS_RESPONSE');
  return { status: response.status, body: JSON.parse(payload.toString()) as unknown };
}

/** Browser identity is verified by the game gateway, including password revocation.
 * Only short-lived, body-bound gateway assertions enter this service. */
export function corporateIdentity(
  app: FastifyInstance,
  key: string,
  claimNonce?: (nonce: string, expires: number) => Promise<boolean>,
): (request: FastifyRequest) => Promise<Identity | null> {
  const identities = new WeakMap<object, Identity | null>();
  const seen = new Map<string, number>();
  const proofs = new WeakMap<object, string>();
  app.addHook('onSend', async (request, reply, payload) => {
    const claims = proofs.get(request);
    if (claims && (typeof payload === 'string' || Buffer.isBuffer(payload))) {
      const hash = createHash('sha256').update(payload).digest('hex');
      reply.header(
        'x-corp-response-signature',
        createHmac('sha256', key)
          .update(`${claims}\nresponse\n${reply.statusCode}\n${hash}`)
          .digest('hex'),
      );
    }
    return payload;
  });
  app.addHook('preHandler', async (request, reply) => {
    if (request.url === '/health' || request.url === '/ready') return;
    const encoded = request.headers['x-corp-claims'],
      supplied = request.headers['x-corp-signature'];
    if (
      typeof encoded !== 'string' ||
      encoded.length > 4096 ||
      typeof supplied !== 'string' ||
      !/^[a-f0-9]{64}$/.test(supplied)
    )
      return reply.code(401).send({ error: 'E_AUTH' });
    try {
      const claims = Buffer.from(encoded, 'base64url').toString();
      const expected = signature(key, request.method, request.url, request.body, claims);
      if (!timingSafeEqual(Buffer.from(expected), Buffer.from(supplied))) throw Error('signature');
      const parsed = JSON.parse(claims) as {
        at: number;
        nonce: string;
        who: Identity | null;
        ip: string;
      };
      const now = Date.now();
      if (
        !Number.isSafeInteger(parsed.at) ||
        Math.abs(now - parsed.at) > 30_000 ||
        typeof parsed.nonce !== 'string' ||
        parsed.nonce.length > 64 ||
        typeof parsed.ip !== 'string' ||
        parsed.ip.length > 128 ||
        (parsed.who !== null &&
          (typeof parsed.who?.accountId !== 'string' || typeof parsed.who?.login !== 'string'))
      )
        throw Error('claims');
      for (const [nonce, expires] of seen) if (expires <= now) seen.delete(nonce);
      if (seen.has(parsed.nonce) || seen.size >= 10_000)
        return reply.code(429).send({ error: 'E_RATE_LIMIT' });
      if (
        claimNonce &&
        !(await claimNonce(parsed.nonce, parsed.at + 30_000).catch(() => {
          throw Error('E_CORPORATIONS_UNAVAILABLE');
        }))
      )
        return reply.code(401).send({ error: 'E_AUTH' });
      seen.set(parsed.nonce, parsed.at + 30_000);
      proofs.set(request, claims);
      identities.set(request, parsed.who);
      // The source IP is signed by the trusted gateway, never a browser header.
      Object.defineProperty(request, 'ip', { value: parsed.ip });
    } catch (error) {
      if (error instanceof Error && error.message === 'E_CORPORATIONS_UNAVAILABLE')
        return reply.code(503).send({ error: 'E_CORPORATIONS_UNAVAILABLE' });
      return reply.code(401).send({ error: 'E_AUTH' });
    }
  });
  return async (request) => identities.get(request) ?? null;
}

export function registerCorporateGateway(
  app: FastifyInstance,
  endpoint: CorporateEndpoint,
  identify: (request: FastifyRequest) => Promise<Identity | null>,
  features = { ava: true, medals: true },
): void {
  const handler = async (request: FastifyRequest, reply: import('fastify').FastifyReply) => {
    const who = await identify(request);
    if (!who) return reply.code(401).send({ error: 'E_AUTH' });
    try {
      const result = await corporateRequest(
        endpoint,
        request.method,
        request.url,
        request.body,
        who,
        request.ip,
      );
      if (request.url === '/corps/me' && result.status === 200)
        return reply.send({ ...(result.body as object), features });
      return reply.code(result.status).send(result.body);
    } catch {
      return reply.code(503).send({ error: 'E_CORPORATIONS_UNAVAILABLE' });
    }
  };
  for (const prefix of [
    '/corps',
    ...(features.ava ? ['/ava'] : []),
    ...(features.medals ? ['/medals'] : []),
  ]) {
    app.route({ method: ['GET', 'POST'], url: prefix, handler });
    app.route({ method: ['GET', 'POST'], url: `${prefix}/*`, handler });
  }
}

/** Freeze only corporate operations while their state moves to a new database. */
export function registerCorporateMaintenance(app: FastifyInstance, enabled: boolean): void {
  if (!enabled) return;
  app.addHook('preHandler', async (request, reply) => {
    if (
      ['/corps', '/ava', '/medals', '/corp-arsenal'].some(
        (prefix) =>
          request.url === prefix ||
          request.url.startsWith(`${prefix}/`) ||
          request.url.startsWith(`${prefix}?`),
      )
    ) {
      return reply.code(503).send({ error: 'E_CORPORATIONS_MAINTENANCE' });
    }
  });
}
