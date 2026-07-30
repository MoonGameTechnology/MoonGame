import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Identity } from './matchApi';
import type { PushStore, PushSubscriptionRecord } from './store';
import { slidingWindowIpLimiter } from './rateLimit';

/**
 * ONB-5 — Web Push subscription HTTP API. Session-gated like the arsenal/corp APIs:
 * a subscription is bound to the account that owns it, never a query param.
 *
 *   GET  /push/key           the VAPID public key the client subscribes with
 *   POST /push/subscribe     {endpoint, keys:{p256dh, auth}}  — replaces any prior sub
 *   POST /push/unsubscribe   drop the stored subscription
 */

export interface PushApiDeps {
  store: PushStore;
  identify(request: FastifyRequest): Promise<Identity | null>;
  /** The VAPID public key to hand the client for `PushManager.subscribe()`. Route is
   *  omitted entirely when push isn't configured (graceful degradation). */
  vapidPublicKey?: string;
  /** Injectable clock + limits for the per-IP rate limit (deterministic tests). */
  now?: () => number;
  rateMax?: number;
  rateWindowMs?: number;
}

/** `sendPush` (`push.ts`) later makes a SERVER-SIDE request to `endpoint` — an
 *  authenticated caller could otherwise plant an internal/link-local URL and turn
 *  the eventual send into a blind SSRF probe (e.g. a cloud metadata endpoint). Only
 *  the real push services' hosts are accepted; everything else is rejected up front,
 *  before it ever reaches storage. */
const ALLOWED_PUSH_HOSTS = [
  /(^|\.)googleapis\.com$/,
  /(^|\.)google\.com$/,
  /^updates\.push\.services\.mozilla\.com$/,
  /(^|\.)notify\.windows\.com$/,
  /^web\.push\.apple\.com$/,
];
const MAX_ENDPOINT_LEN = 2048;
const MAX_KEY_LEN = 512;

function isSubscription(body: unknown): body is PushSubscriptionRecord {
  if (!body || typeof body !== 'object') return false;
  const b = body as { endpoint?: unknown; keys?: unknown };
  if (typeof b.endpoint !== 'string' || !b.endpoint || b.endpoint.length > MAX_ENDPOINT_LEN) {
    return false;
  }
  if (!b.keys || typeof b.keys !== 'object') return false;
  const k = b.keys as { p256dh?: unknown; auth?: unknown };
  if (typeof k.p256dh !== 'string' || !k.p256dh || k.p256dh.length > MAX_KEY_LEN) return false;
  if (typeof k.auth !== 'string' || !k.auth || k.auth.length > MAX_KEY_LEN) return false;
  let url: URL;
  try {
    url = new URL(b.endpoint);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:') return false;
  return ALLOWED_PUSH_HOSTS.some((re) => re.test(url.hostname));
}

const RATE_MAX = 10;
const RATE_WINDOW_MS = 60_000;
const RATE_MAX_IPS = 10_000;

export function registerPushApi(app: FastifyInstance, deps: PushApiDeps): void {
  const now = deps.now ?? ((): number => Date.now());
  const rateMax = deps.rateMax ?? RATE_MAX;
  const rateWindowMs = deps.rateWindowMs ?? RATE_WINDOW_MS;
  const rateLimited = slidingWindowIpLimiter({
    now,
    max: rateMax,
    windowMs: rateWindowMs,
    maxIps: RATE_MAX_IPS,
  });

  const identified = async (
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<Identity | null> => {
    const who = await deps.identify(request);
    if (!who) void reply.code(401);
    return who;
  };

  if (deps.vapidPublicKey) {
    const publicKey = deps.vapidPublicKey;
    app.get('/push/key', () => ({ publicKey }));
  }

  app.post('/push/subscribe', async (request, reply) => {
    if (rateLimited(request.ip)) {
      void reply.code(429);
      return { error: 'E_RATE_LIMIT' as const };
    }
    const who = await identified(request, reply);
    if (!who) return { error: 'E_AUTH' as const };
    if (!isSubscription(request.body)) {
      void reply.code(400);
      return { error: 'E_BAD_SUBSCRIPTION' as const };
    }
    await deps.store.save(who.accountId, request.body);
    return { ok: true };
  });

  app.post('/push/unsubscribe', async (request, reply) => {
    if (rateLimited(request.ip)) {
      void reply.code(429);
      return { error: 'E_RATE_LIMIT' as const };
    }
    const who = await identified(request, reply);
    if (!who) return { error: 'E_AUTH' as const };
    await deps.store.remove(who.accountId);
    return { ok: true };
  });
}
