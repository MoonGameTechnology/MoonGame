import { COMMERCE_CATALOG_VERSION } from './commerceCatalog';
import { createHash, createHmac, randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { commerceGatewayIdentity, createCommerceServer } from './commerceServer';
import { CommerceService, type CommerceProvider } from './commerceService';
import { MemoryCommerceStore, type CommerceVerification } from './commerceStore';

const apps: FastifyInstance[] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

function setup(configured = false) {
  const store = new MemoryCommerceStore();
  const provider: CommerceProvider = {
    id: 'test-only',
    offers: [{ productId: 'supply_personal', price: { amountMinor: 100, currency: 'USD' } }],
    verify: vi.fn(async ({ headers, rawBody }) =>
      headers['x-test-proof'] === 'verified'
        ? (JSON.parse(Buffer.from(rawBody).toString()) as CommerceVerification)
        : null,
    ),
  };
  const service = new CommerceService(
    store,
    {
      status: async () => null,
      apply: async (command) => ({
        ok: true,
        receipt: {
          commandId: command.commandId,
          payloadHash: command.payloadHash,
          status: 'applied',
          at: 1000,
        },
      }),
    },
    configured ? [provider] : [],
    () => 1000,
  );
  const app = createCommerceServer({
    service,
    identify: async (request) => (request.headers['x-test-account'] === 'alice' ? 'alice' : null),
  });
  apps.push(app);
  return { app, service, store, provider };
}

describe('standalone Commerce HTTP boundary', () => {
  it('starts without Meta/provider connectivity and advertises unavailable offers', async () => {
    const f = setup();
    expect((await f.app.inject('/ready')).statusCode).toBe(200);
    expect(
      (await f.app.inject('/commerce/offers'))
        .json<{ offers: { available: boolean }[] }>()
        .offers.every((offer) => !offer.available),
    ).toBe(true);
    const response = await f.app.inject({
      method: 'POST',
      url: '/commerce/orders',
      headers: { 'x-test-account': 'alice' },
      payload: { requestId: 'r1', productId: 'supply_personal', catalogVersion: COMMERCE_CATALOG_VERSION },
    });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ error: 'E_COMMERCE_UNAVAILABLE' });
  });

  it('rejects unauthenticated orders and does not accept an account from request data', async () => {
    const f = setup(true);
    const payload = { requestId: 'r1', productId: 'supply_personal', catalogVersion: COMMERCE_CATALOG_VERSION };
    expect(
      (await f.app.inject({ method: 'POST', url: '/commerce/orders', payload })).statusCode,
    ).toBe(401);
    expect(
      (
        await f.app.inject({
          method: 'POST',
          url: '/commerce/orders',
          headers: { 'x-test-account': 'alice' },
          payload: { ...payload, accountId: 'victim' },
        })
      ).statusCode,
    ).toBe(400);
    const created = await f.app.inject({
      method: 'POST',
      url: '/commerce/orders',
      headers: { 'x-test-account': 'alice' },
      payload,
    });
    expect(created.statusCode).toBe(200);
    const orderId = created.json<{ order: { orderId: string } }>().order.orderId;
    expect((await f.app.inject(`/commerce/orders/${orderId}`)).statusCode).toBe(401);
    expect(
      (
        await f.app.inject({
          url: `/commerce/orders/${orderId}`,
          headers: { 'x-test-account': 'alice' },
        })
      ).statusCode,
    ).toBe(200);
  });

  it('preserves exact provider body bytes, stores pending proof, and never grants in webhook handling', async () => {
    const f = setup(true);
    const order = await f.service.createOrder('alice', 'r1', 'supply_personal', COMMERCE_CATALOG_VERSION);
    const payload = JSON.stringify(
      {
        provider: 'test-only',
        eventId: 'ev1',
        providerTransactionId: 'tx1',
        orderId: order.orderId,
        accountId: 'alice',
        productId: 'supply_personal',
        catalogVersion: COMMERCE_CATALOG_VERSION,
        kind: 'payment',
        amountMinor: 100,
        currency: 'USD',
      },
      null,
      2,
    );
    const response = await f.app.inject({
      method: 'POST',
      url: '/commerce/webhooks/test-only',
      headers: { 'content-type': 'application/json', 'x-test-proof': 'verified' },
      payload,
    });
    expect(response.statusCode).toBe(200);
    expect(Buffer.from(vi.mocked(f.provider.verify).mock.calls[0]![0].rawBody).toString()).toBe(
      payload,
    );
    expect((await f.service.order('alice', order.orderId))?.state).toBe('pending');
    await f.service.deliver();
    expect((await f.service.order('alice', order.orderId))?.state).toBe('fulfilled');
  });

  it('rejects a forged callback, unknown provider and oversized original body', async () => {
    const f = setup(true);
    expect(
      (
        await f.app.inject({
          method: 'POST',
          url: '/commerce/webhooks/test-only',
          payload: { success: true },
        })
      ).statusCode,
    ).toBe(401);
    expect(
      (
        await f.app.inject({
          method: 'POST',
          url: '/commerce/webhooks/browser',
          payload: { onRewarded: true },
        })
      ).statusCode,
    ).toBe(503);
    expect(
      (
        await f.app.inject({
          method: 'POST',
          url: '/commerce/webhooks/test-only',
          headers: { 'content-type': 'application/json' },
          payload: 'x'.repeat(65_537),
        })
      ).statusCode,
    ).toBe(413);
  });

  it('returns only a stable code when a verifier exposes internal error details', async () => {
    const f = setup(true);
    vi.mocked(f.provider.verify).mockRejectedValue(Error('secret provider credentials'));
    const response = await f.app.inject({
      method: 'POST',
      url: '/commerce/webhooks/test-only',
      payload: {},
    });
    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: 'E_COMMERCE_PROOF' });
    expect(response.body).not.toContain('secret');
  });
});

describe('Game identity assertion for Commerce', () => {
  const key = 'g'.repeat(48);
  function sign(body: unknown, overrides: Record<string, unknown> = {}) {
    const claims = JSON.stringify({
      issuer: 'game',
      audience: 'commerce',
      capability: 'orders.self',
      keyId: 'v1',
      accountId: 'alice',
      nonce: randomUUID().replaceAll('-', ''),
      at: 1000,
      ...overrides,
    });
    const hash = createHash('sha256').update(JSON.stringify(body)).digest('hex');
    return {
      'x-commerce-gateway-claims': Buffer.from(claims).toString('base64url'),
      'x-commerce-gateway-signature': createHmac('sha256', key)
        .update(`${claims}\nPOST\n/commerce/orders\n${hash}`)
        .digest('hex'),
    };
  }
  function gateway() {
    const f = setup(true);
    const nonces = new Set<string>();
    const identify = commerceGatewayIdentity({
      keys: { v1: key },
      now: () => 1000,
      claimNonce: async (nonce) => {
        if (nonces.has(nonce)) return false;
        nonces.add(nonce);
        return true;
      },
    });
    const app = createCommerceServer({ service: f.service, identify });
    apps.push(app);
    return app;
  }
  const payload = { requestId: 'r1', productId: 'supply_personal', catalogVersion: COMMERCE_CATALOG_VERSION };

  it('accepts a body-bound assertion once and supports a fresh assertion for order replay', async () => {
    const app = gateway();
    const headers = sign(payload);
    const first = await app.inject({ method: 'POST', url: '/commerce/orders', headers, payload });
    expect(first.statusCode).toBe(200);
    expect(
      (await app.inject({ method: 'POST', url: '/commerce/orders', headers, payload })).statusCode,
    ).toBe(401);
    const replay = await app.inject({
      method: 'POST',
      url: '/commerce/orders',
      headers: sign(payload),
      payload,
    });
    expect(replay.json()).toEqual(first.json());
  });

  it('rejects altered bodies, audience, capability, issuer, expired assertion and unknown key', async () => {
    const app = gateway();
    const modified = { ...payload, requestId: 'altered' };
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/commerce/orders',
          headers: sign(payload),
          payload: modified,
        })
      ).statusCode,
    ).toBe(401);
    for (const overrides of [
      { audience: 'meta-economy' },
      { capability: 'entitlement.grant' },
      { issuer: 'browser' },
      { at: 100_000 },
      { keyId: 'removed' },
    ])
      expect(
        (
          await app.inject({
            method: 'POST',
            url: '/commerce/orders',
            headers: sign(payload, overrides),
            payload,
          })
        ).statusCode,
      ).toBe(401);
  });
});
