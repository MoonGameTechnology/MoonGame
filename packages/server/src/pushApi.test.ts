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
  endpoint: 'https://fcm.googleapis.com/fcm/send/abc',
  keys: { p256dh: 'p256dh-key', auth: 'auth-key' },
};

function harness(
  opts: { vapidPublicKey?: string; rateMax?: number; now?: () => number } = {},
): { app: ReturnType<typeof Fastify>; store: MemoryPushStore } {
  const store = new MemoryPushStore();
  const app = Fastify();
  registerPushApi(app, {
    store,
    identify: identifyByHeader,
    ...(opts.vapidPublicKey ? { vapidPublicKey: opts.vapidPublicKey } : {}),
    ...(opts.rateMax !== undefined ? { rateMax: opts.rateMax } : {}),
    ...(opts.now ? { now: opts.now } : {}),
  });
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

  it('rejects an endpoint outside the known push-service allow-list (SSRF guard)', async () => {
    const { app } = harness();
    const targets = [
      'http://169.254.169.254/latest/meta-data/', // cloud metadata, not https
      'https://169.254.169.254/latest/meta-data/', // https, but not an allowed host
      'https://internal.corp.local/hook',
      'https://evil.com/googleapis.com', // host must MATCH, not merely contain
    ];
    for (const endpoint of targets) {
      const res = await app.inject({
        method: 'POST',
        url: '/push/subscribe',
        headers: as('alice'),
        payload: { endpoint, keys: { p256dh: 'p', auth: 'a' } },
      });
      expect(res.statusCode).toBe(400);
    }
    await app.close();
  });

  it('accepts endpoints from the known push-service hosts', async () => {
    const { app } = harness();
    const endpoints = [
      'https://fcm.googleapis.com/fcm/send/abc',
      'https://updates.push.services.mozilla.com/wpush/v2/abc',
      'https://example.notify.windows.com/abc',
      'https://web.push.apple.com/abc',
    ];
    for (const endpoint of endpoints) {
      const res = await app.inject({
        method: 'POST',
        url: '/push/subscribe',
        headers: as('alice'),
        payload: { endpoint, keys: { p256dh: 'p', auth: 'a' } },
      });
      expect(res.statusCode).toBe(200);
    }
    await app.close();
  });

  it('rate-limits repeated subscribe attempts per IP', async () => {
    const now = 0;
    const { app } = harness({ rateMax: 2, now: () => now });
    for (let i = 0; i < 2; i++) {
      const res = await app.inject({
        method: 'POST',
        url: '/push/subscribe',
        headers: as('alice'),
        payload: validSub,
      });
      expect(res.statusCode).toBe(200);
    }
    const limited = await app.inject({
      method: 'POST',
      url: '/push/subscribe',
      headers: as('alice'),
      payload: validSub,
    });
    expect(limited.statusCode).toBe(429);
    await app.close();
  });

  it('exposes /push/key only when a VAPID public key is configured', async () => {
    const off = harness();
    expect((await off.app.inject({ method: 'GET', url: '/push/key' })).statusCode).toBe(404);
    await off.app.close();

    const on = harness({ vapidPublicKey: 'pub-key-123' });
    const res = await on.app.inject({ method: 'GET', url: '/push/key' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ publicKey: 'pub-key-123' });
    await on.app.close();
  });
});
