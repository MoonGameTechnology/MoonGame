import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import type { EntitlementCommandV1, EntitlementReceipt, EntitlementResult } from '@void/protocol';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { DependencyGuard } from './dependencyGuard';

const ROOT = '/internal/commerce/entitlements';
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const HASH = /^[a-f0-9]{64}$/;
const WINDOW_MS = 30_000;
const MAX_RESPONSE_BYTES = 1_048_576;
type Capability = 'entitlement.grant' | 'entitlement.revoke' | 'entitlement.status';

export interface CommerceEntitlementService {
  apply(command: EntitlementCommandV1): Promise<EntitlementResult>;
  status(commandId: string): Promise<EntitlementReceipt | null>;
}
export interface CommerceEndpoint {
  url: string;
  keyId: string;
  key: string;
  timeoutMs?: number;
}
interface Claims {
  issuer: 'commerce';
  audience: 'meta-economy';
  capability: Capability;
  keyId: string;
  at: number;
  nonce: string;
}
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return (
    Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key))
  );
}
function validId(value: unknown): value is string {
  return typeof value === 'string' && ID.test(value);
}
function validTime(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}
function digest(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}
/** Flat, closed command schema: key order never changes the persistent idempotency hash. */
export function hashEntitlementCommand(input: Omit<EntitlementCommandV1, 'payloadHash'>): string {
  return digest(
    JSON.stringify(
      Object.fromEntries(Object.entries(input).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))),
    ),
  );
}
export function parseEntitlementCommand(value: unknown): EntitlementCommandV1 | null {
  if (!record(value)) return null;
  const keys = [
    'version',
    'commandId',
    'kind',
    'source',
    'orderId',
    'provider',
    'providerTransactionId',
    'accountId',
    'productId',
    'catalogVersion',
    'payloadHash',
    'at',
  ];
  if (value.kind === 'revoke') keys.push('originalCommandId');
  if (
    !exactKeys(value, keys) ||
    value.version !== 1 ||
    !['grant', 'revoke'].includes(String(value.kind)) ||
    !['payment', 'rewarded_ad'].includes(String(value.source)) ||
    !validTime(value.at) ||
    typeof value.payloadHash !== 'string' ||
    !HASH.test(value.payloadHash)
  )
    return null;
  if (
    ![
      'commandId',
      'orderId',
      'provider',
      'providerTransactionId',
      'accountId',
      'productId',
      'catalogVersion',
    ].every((key) => validId(value[key])) ||
    (value.kind === 'revoke' && !validId(value.originalCommandId))
  )
    return null;
  const command = value as unknown as EntitlementCommandV1;
  const { payloadHash, ...input } = command;
  if (hashEntitlementCommand(input) !== payloadHash) return null;
  return { ...command };
}
function parseReceipt(value: unknown): EntitlementReceipt | null {
  if (
    !record(value) ||
    !exactKeys(value, ['commandId', 'payloadHash', 'status', 'at']) ||
    !validId(value.commandId) ||
    typeof value.payloadHash !== 'string' ||
    !HASH.test(value.payloadHash) ||
    !['applied', 'revoked', 'review-required'].includes(String(value.status)) ||
    !validTime(value.at)
  )
    return null;
  return value as unknown as EntitlementReceipt;
}
function requestSignature(
  key: string,
  method: string,
  path: string,
  body: unknown,
  claims: string,
): string {
  return createHmac('sha256', key)
    .update(`${claims}\n${method}\n${path}\n${digest(JSON.stringify(body ?? null))}`)
    .digest('hex');
}
function responseSignature(
  key: string,
  claims: string,
  status: number,
  body: string | Buffer,
): string {
  return createHmac('sha256', key)
    .update(`${claims}\nresponse\n${status}\n${digest(body)}`)
    .digest('hex');
}
function equalSignature(expected: string, supplied: unknown): boolean {
  return (
    typeof supplied === 'string' &&
    HASH.test(supplied) &&
    timingSafeEqual(Buffer.from(expected), Buffer.from(supplied))
  );
}
function validKey(key: unknown): key is string {
  return typeof key === 'string' && Buffer.byteLength(key) >= 32 && Buffer.byteLength(key) <= 4096;
}

/** Dedicated peer with a bounded circuit and no automatic write retries. */
export function createCommerceEntitlementClient(
  endpoint: CommerceEndpoint,
): CommerceEntitlementService {
  let url: URL;
  try {
    url = new URL(endpoint.url);
  } catch {
    throw Error('E_COMMERCE_CONFIG');
  }
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash ||
    !validId(endpoint.keyId) ||
    !validKey(endpoint.key) ||
    (endpoint.timeoutMs !== undefined &&
      (!Number.isSafeInteger(endpoint.timeoutMs) ||
        endpoint.timeoutMs <= 0 ||
        endpoint.timeoutMs > 2000))
  )
    throw Error('E_COMMERCE_CONFIG');
  // Snapshot configuration so a caller cannot change identity midway through a request.
  const origin = url.origin,
    key = endpoint.key,
    keyId = endpoint.keyId,
    timeout = endpoint.timeoutMs ?? 2000;
  const guard = new DependencyGuard();
  async function request(
    method: 'GET' | 'POST',
    path: string,
    capability: Capability,
    body?: EntitlementCommandV1,
  ): Promise<unknown> {
    return guard.run(async () => {
      const claims = JSON.stringify({
        issuer: 'commerce',
        audience: 'meta-economy',
        capability,
        keyId,
        at: Date.now(),
        nonce: randomUUID(),
      } satisfies Claims);
      const response = await fetch(`${origin}${path}`, {
        method,
        redirect: 'error',
        signal: AbortSignal.timeout(timeout),
        headers: {
          'content-type': 'application/json',
          'x-commerce-claims': Buffer.from(claims).toString('base64url'),
          'x-commerce-signature': requestSignature(key, method, path, body, claims),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      const reader = response.body?.getReader();
      if (!reader) throw Error('E_COMMERCE_RESPONSE');
      const chunks: Uint8Array[] = [];
      let size = 0;
      try {
        for (;;) {
          const part = await reader.read();
          if (part.done) break;
          size += part.value.byteLength;
          if (size > MAX_RESPONSE_BYTES) throw Error('E_COMMERCE_RESPONSE');
          chunks.push(part.value);
        }
      } finally {
        await reader.cancel().catch(() => undefined);
        reader.releaseLock();
      }
      const payload = Buffer.concat(chunks);
      if (
        !equalSignature(
          responseSignature(key, claims, response.status, payload),
          response.headers.get('x-commerce-response-signature'),
        )
      )
        throw Error('E_COMMERCE_RESPONSE');
      if (response.status !== 200) throw Error('E_COMMERCE_UNAVAILABLE');
      try {
        return JSON.parse(payload.toString()) as unknown;
      } catch {
        throw Error('E_COMMERCE_RESPONSE');
      }
    });
  }
  return {
    async apply(command) {
      const parsed = parseEntitlementCommand(command);
      if (!parsed) throw Error('E_BAD_REQUEST');
      const result = await request(
        'POST',
        ROOT,
        parsed.kind === 'grant' ? 'entitlement.grant' : 'entitlement.revoke',
        parsed,
      );
      if (
        record(result) &&
        result.ok === false &&
        exactKeys(result, ['ok', 'code']) &&
        typeof result.code === 'string' &&
        /^E_[A-Z0-9_]{1,80}$/.test(result.code)
      )
        return { ok: false, code: result.code };
      const receipt =
        record(result) && result.ok === true && exactKeys(result, ['ok', 'receipt'])
          ? parseReceipt(result.receipt)
          : null;
      if (
        !receipt ||
        receipt.commandId !== parsed.commandId ||
        receipt.payloadHash !== parsed.payloadHash
      )
        throw Error('E_COMMERCE_RESPONSE');
      return { ok: true, receipt };
    },
    async status(commandId) {
      if (!validId(commandId)) throw Error('E_BAD_REQUEST');
      const value = await request(
        'GET',
        `${ROOT}/${encodeURIComponent(commandId)}`,
        'entitlement.status',
      );
      if (value === null) return null;
      const receipt = parseReceipt(value);
      if (!receipt || receipt.commandId !== commandId) throw Error('E_COMMERCE_RESPONSE');
      return receipt;
    },
  };
}

/** Only these internal routes use Commerce authentication; Game routes remain independent.
 * Production supplies a durable nonce claim. The bounded memory fallback is for tests/dev. */
export function registerCommerceEntitlementApi(
  app: FastifyInstance,
  options: {
    keys: Readonly<Record<string, string>>;
    service: CommerceEntitlementService;
    claimNonce?: (nonce: string, expiresAt: number) => Promise<boolean>;
    now?: () => number;
  },
): void {
  const entries = Object.entries(options.keys);
  if (
    !entries.length ||
    entries.length > 8 ||
    entries.some(([id, key]) => !validId(id) || !validKey(key))
  )
    throw Error('E_COMMERCE_CONFIG');
  const keys = new Map(entries),
    now = options.now ?? Date.now;
  const seen = new Map<string, number>();
  const rates = new Map<string, { start: number; count: number }>();
  let inFlight = 0;
  app.register(async (scoped) => {
    const proofs = new WeakMap<
      FastifyRequest,
      { claims: string; key: string; capability: Capability }
    >();
    scoped.addHook('onSend', async (req, reply, payload) => {
      const proof = proofs.get(req);
      if (proof && (typeof payload === 'string' || Buffer.isBuffer(payload)))
        reply.header(
          'x-commerce-response-signature',
          responseSignature(proof.key, proof.claims, reply.statusCode, payload),
        );
      return payload;
    });
    scoped.addHook('preHandler', async (req, reply) => {
      const encoded = req.headers['x-commerce-claims'],
        supplied = req.headers['x-commerce-signature'];
      if (typeof encoded !== 'string' || encoded.length > 2048 || !/^[A-Za-z0-9_-]+$/.test(encoded))
        return reply.code(401).send({ error: 'E_AUTH' });
      let claims: string, parsed: Claims, key: string;
      try {
        claims = Buffer.from(encoded, 'base64url').toString();
        const value: unknown = JSON.parse(claims);
        if (
          !record(value) ||
          !exactKeys(value, ['issuer', 'audience', 'capability', 'keyId', 'at', 'nonce']) ||
          value.issuer !== 'commerce' ||
          value.audience !== 'meta-economy' ||
          !['entitlement.grant', 'entitlement.revoke', 'entitlement.status'].includes(
            String(value.capability),
          ) ||
          !validId(value.keyId) ||
          !validId(value.nonce) ||
          !validTime(value.at) ||
          Math.abs(now() - value.at) > WINDOW_MS
        )
          throw Error('claims');
        parsed = value as unknown as Claims;
        const selected = keys.get(parsed.keyId);
        if (
          !selected ||
          !equalSignature(
            requestSignature(selected, req.method, req.url, req.body, claims),
            supplied,
          )
        )
          throw Error('signature');
        key = selected;
      } catch {
        return reply.code(401).send({ error: 'E_AUTH' });
      }
      proofs.set(req, { claims, key, capability: parsed.capability });
      const time = now();
      const rate = rates.get(parsed.keyId);
      if (!rate || time - rate.start >= 60_000) rates.set(parsed.keyId, { start: time, count: 1 });
      else if (++rate.count > 240) return reply.code(429).send({ error: 'E_RATE_LIMIT' });
      for (const [nonce, expiry] of seen) if (expiry <= time) seen.delete(nonce);
      const nonce = `${parsed.keyId}:${parsed.nonce}`;
      if (seen.has(nonce)) return reply.code(401).send({ error: 'E_AUTH' });
      if (seen.size >= 10_000) return reply.code(429).send({ error: 'E_RATE_LIMIT' });
      // Reserve before awaiting persistent storage to prevent concurrent in-process replay.
      seen.set(nonce, parsed.at + WINDOW_MS + 1);
      try {
        if (options.claimNonce && !(await options.claimNonce(nonce, parsed.at + WINDOW_MS + 1)))
          return reply.code(401).send({ error: 'E_AUTH' });
      } catch {
        return reply.code(503).send({ error: 'E_COMMERCE_UNAVAILABLE' });
      }
    });
    scoped.post(ROOT, { bodyLimit: 16_384 }, async (req, reply) => {
      const command = parseEntitlementCommand(req.body);
      if (!command) return reply.code(400).send({ error: 'E_BAD_REQUEST' });
      if (proofs.get(req)?.capability !== `entitlement.${command.kind}`)
        return reply.code(403).send({ error: 'E_AUTH' });
      if (inFlight >= 16) return reply.code(429).send({ error: 'E_RATE_LIMIT' });
      inFlight++;
      try {
        return await options.service.apply(command);
      } catch {
        return reply.code(503).send({ error: 'E_COMMERCE_UNAVAILABLE' });
      } finally {
        inFlight--;
      }
    });
    scoped.get<{ Params: { commandId: string } }>(`${ROOT}/:commandId`, async (req, reply) => {
      if (proofs.get(req)?.capability !== 'entitlement.status')
        return reply.code(403).send({ error: 'E_AUTH' });
      if (!validId(req.params.commandId)) return reply.code(400).send({ error: 'E_BAD_REQUEST' });
      if (inFlight >= 16) return reply.code(429).send({ error: 'E_RATE_LIMIT' });
      inFlight++;
      try {
        return await options.service.status(req.params.commandId);
      } catch {
        return reply.code(503).send({ error: 'E_COMMERCE_UNAVAILABLE' });
      } finally {
        inFlight--;
      }
    });
  });
}
