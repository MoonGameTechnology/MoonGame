import { describe, expect, it } from 'vitest';
import Fastify, { type FastifyRequest } from 'fastify';
import { registerPushApi } from './pushApi';
import { MemoryPushStore } from './store';
import type { Identity } from './matchApi';

// ONB-5: the push subscription HTTP contract — session-gated, and a caller can
// only ever write/clear their OWN subscription.

function identifyByHeader(request: FastifyRequest): Promise<Identity | null> {
  const login = request.headers['x-test-user'];
  if (typeof login !== 'string' || login === '') return Promise.resolve(null);
  return Promise.resolve({ accountId: `acc-${login}`, login });
}
const as = (login: string): Record<string, string> => ({ 'x-test-user': login });

const validSub = {
  endpoint: 'https://push.example/abc',
  keys: { p256dh: 'p256dh-key', auth: 'auth-key' },
};

function harness(vapidPublicKey?: string): { app: ReturnType<typeof Fastify>; store: MemoryPushStore } {
  const store = new MemoryPushStore();
  const app = Fastify();
  registerPushApi(app, { store, identify: identifyByHeader, ...(vapidPublicKey ? { vapidPublicKey } : {}) });
  return { app, store };
}

describe('push HTTP API', () => {
  it('is session-gated: anonymous → 401 on subscribe/unsubscribe', async () => {
    const { app } = harness();
    expect(
      (await app.inject({ method: 'POST', url: '/push/subscribe', payload: validSub })).statusCode,
    ).toBe(401);
    expect((await app.inject({ method: 'POST', url: '/push/unsubscribe' })).statusCode).toBe(401);
    await app.close();
  });

  it('rejects a malformed subscription body with 400', async () => {
    const { app } = harness();
    const res = await app.inject({
      method: 'POST',
      url: '/push/subscribe',
      headers: as('alice'),
      payload: { endpoint: 'https://push.example/x' },
    });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it('saves the subscription under the caller identity only', async () => {
    const { app, store } = harness();
    const res = await app.inject({
      method: 'POST',
      url: '/push/subscribe',
      headers: as('alice'),
      payload: validSub,
    });
    expect(res.statusCode).toBe(200);
    await expect(store.of('acc-alice')).resolves.toEqual(validSub);
    await expect(store.of('acc-bob')).resolves.toBeUndefined();
    await app.close();
  });

  it('unsubscribe removes only the caller own subscription', async () => {
    const { app, store } = harness();
    await store.save('acc-alice', validSub);
    await store.save('acc-bob', validSub);
    const res = await app.inject({ method: 'POST', url: '/push/unsubscribe', headers: as('alice') });
    expect(res.statusCode).toBe(200);
    await expect(store.of('acc-alice')).resolves.toBeUndefined();
    await expect(store.of('acc-bob')).resolves.toEqual(validSub);
    await app.close();
  });

  it('exposes /push/key only when a VAPID public key is configured', async () => {
    const off = harness();
    expect((await off.app.inject({ method: 'GET', url: '/push/key' })).statusCode).toBe(404);
    await off.app.close();

    const on = harness('pub-key-123');
    const res = await on.app.inject({ method: 'GET', url: '/push/key' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ publicKey: 'pub-key-123' });
    await on.app.close();
  });
});
