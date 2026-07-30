import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Identity } from './matchApi';
import type { PushStore, PushSubscriptionRecord } from './store';

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
}

function isSubscription(body: unknown): body is PushSubscriptionRecord {
  if (!body || typeof body !== 'object') return false;
  const b = body as { endpoint?: unknown; keys?: unknown };
  if (typeof b.endpoint !== 'string' || !b.endpoint) return false;
  if (!b.keys || typeof b.keys !== 'object') return false;
  const k = b.keys as { p256dh?: unknown; auth?: unknown };
  return typeof k.p256dh === 'string' && !!k.p256dh && typeof k.auth === 'string' && !!k.auth;
}

export function registerPushApi(app: FastifyInstance, deps: PushApiDeps): void {
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
    const who = await identified(request, reply);
    if (!who) return { error: 'E_AUTH' as const };
    await deps.store.remove(who.accountId);
    return { ok: true };
  });
}
