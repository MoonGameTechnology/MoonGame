import { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto';
import type { EntitlementCommandV1, EntitlementReceipt } from '@void/protocol';
import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import {
  createCommerceEntitlementClient,
  hashEntitlementCommand,
  parseEntitlementCommand,
  registerCommerceEntitlementApi,
} from './commerceTransport';

const path = '/internal/commerce/entitlements';
const key = randomBytes(32).toString('hex');
const oldKey = randomBytes(32).toString('hex');
const keyId = 'key-2026-10';
function command(
  overrides: Partial<Omit<EntitlementCommandV1, 'payloadHash'>> = {},
): EntitlementCommandV1 {
  const input: Omit<EntitlementCommandV1, 'payloadHash'> = {
    version: 1,
    commandId: 'order:grant',
    kind: 'grant',
    source: 'payment',
    orderId: 'order',
    provider: 'test',
    providerTransactionId: 'transaction',
    accountId: 'pilot',
    productId: 'supply-pack',
    catalogVersion: 'v0',
    at: 1,
    ...overrides,
  };
  return { ...input, payloadHash: hashEntitlementCommand(input) };
}
function receipt(input = command()): EntitlementReceipt {
  return {
    commandId: input.commandId,
    payloadHash: input.payloadHash,
    status: input.kind === 'grant' ? 'applied' : 'revoked',
    at: Date.now(),
  };
}
function signed(
  body: unknown,
  options: {
    claims?: Record<string, unknown>;
    method?: string;
    url?: string;
    signingKey?: string;
  } = {},
) {
  const claims = JSON.stringify({
    issuer: 'commerce',
    audience: 'meta-economy',
    capability: 'entitlement.grant',
    keyId,
    at: Date.now(),
    nonce: randomUUID(),
    ...options.claims,
  });
  const hash = createHash('sha256')
    .update(JSON.stringify(body ?? null))
    .digest('hex');
  return {
    'x-commerce-claims': Buffer.from(claims).toString('base64url'),
    'x-commerce-signature': createHmac('sha256', options.signingKey ?? key)
      .update(`${claims}\n${options.method ?? 'POST'}\n${options.url ?? path}\n${hash}`)
      .digest('hex'),
  };
}
function setup(options: { claimNonce?: (nonce: string, expiry: number) => Promise<boolean> } = {}) {
  const app = Fastify();
  const apply = vi.fn(async (input: EntitlementCommandV1) => ({
    ok: true as const,
    receipt: receipt(input),
  }));
  const status = vi.fn(async (_id: string): Promise<EntitlementReceipt | null> => null);
  registerCommerceEntitlementApi(app, {
    keys: { [keyId]: key, retired: oldKey },
    service: { apply, status },
    ...options,
  });
  app.get('/matches', async () => ({ matches: ['active'] }));
  return { app, apply, status };
}

describe('Commerce entitlement command validation', () => {
  it('uses an order-independent hash, requires a closed schema, and binds every field', () => {
    const valid = command();
    expect(parseEntitlementCommand(valid)).toEqual(valid);
    const { payloadHash, ...input } = valid;
    expect(
      hashEntitlementCommand(Object.fromEntries(Object.entries(input).reverse()) as typeof input),
    ).toBe(payloadHash);
    for (const invalid of [
      null,
      [],
      { ...valid, amount: 900 },
      { ...valid, productId: 'another-product' },
      { ...valid, accountId: 'other' },
      { ...valid, originalCommandId: 'grant' },
      command({ at: -1 }),
      command({ commandId: '../escape' }),
      command({ kind: 'revoke' }),
    ])
      expect(parseEntitlementCommand(invalid)).toBeNull();
    expect(
      parseEntitlementCommand(command({ kind: 'revoke', originalCommandId: valid.commandId })),
    ).not.toBeNull();
  });
  it('rejects unsafe peer configuration before making a request', () => {
    for (const url of [
      'ftp://peer',
      'http://user:password@peer',
      'http://peer/path',
      'http://peer?query=1',
      'http://peer#fragment',
    ])
      expect(() => createCommerceEntitlementClient({ url, keyId, key })).toThrow(
        'E_COMMERCE_CONFIG',
      );
    expect(() =>
      createCommerceEntitlementClient({ url: 'http://peer', keyId: '../key', key }),
    ).toThrow('E_COMMERCE_CONFIG');
    expect(() =>
      createCommerceEntitlementClient({ url: 'http://peer', keyId, key: 'short' }),
    ).toThrow('E_COMMERCE_CONFIG');
    expect(() =>
      createCommerceEntitlementClient({ url: 'http://peer', keyId, key, timeoutMs: 2001 }),
    ).toThrow('E_COMMERCE_CONFIG');
  });
});

describe('Commerce scoped service trust boundary', () => {
  it('rejects browser calls, tampered bodies, wrong issuer/audience/key, stale proofs and replays', async () => {
    const { app, apply } = setup();
    const payload = command();
    try {
      expect((await app.inject({ method: 'POST', url: path, payload })).statusCode).toBe(401);
      const headers = signed(payload);
      expect(
        (
          await app.inject({
            method: 'POST',
            url: path,
            payload: { ...payload, accountId: 'other' },
            headers,
          })
        ).statusCode,
      ).toBe(401);
      for (const claims of [
        { issuer: 'game' },
        { audience: 'game' },
        { keyId: 'missing' },
        { at: Date.now() - 31_000 },
        { at: Date.now() + 31_000 },
        { capability: 'anything' },
        { extra: 'unknown' },
      ])
        expect(
          (
            await app.inject({
              method: 'POST',
              url: path,
              payload,
              headers: signed(payload, { claims }),
            })
          ).statusCode,
        ).toBe(401);
      const valid = await app.inject({ method: 'POST', url: path, payload, headers });
      expect(valid.statusCode).toBe(200);
      expect(valid.headers['x-commerce-response-signature']).toMatch(/^[a-f0-9]{64}$/);
      expect((await app.inject({ method: 'POST', url: path, payload, headers })).statusCode).toBe(
        401,
      );
      expect(apply).toHaveBeenCalledTimes(1);
      expect((await app.inject('/matches')).statusCode).toBe(200);
    } finally {
      await app.close();
    }
  });
  it('binds capability to operation and validates commands before invoking Meta', async () => {
    const { app, apply, status } = setup();
    const payload = command();
    try {
      expect(
        (
          await app.inject({
            method: 'POST',
            url: path,
            payload,
            headers: signed(payload, { claims: { capability: 'entitlement.revoke' } }),
          })
        ).statusCode,
      ).toBe(403);
      const statusPath = `${path}/order`;
      expect(
        (
          await app.inject({
            method: 'GET',
            url: statusPath,
            headers: signed(null, { method: 'GET', url: statusPath }),
          })
        ).statusCode,
      ).toBe(403);
      const withAmount = { ...payload, amount: 999 };
      expect(
        (
          await app.inject({
            method: 'POST',
            url: path,
            payload: withAmount,
            headers: signed(withAmount),
          })
        ).statusCode,
      ).toBe(400);
      expect(apply).not.toHaveBeenCalled();
      expect(status).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });
  it('accepts an explicit key rotation overlap and an old command with a fresh request proof', async () => {
    const { app, apply } = setup();
    try {
      const url = await app.listen({ host: '127.0.0.1', port: 0 });
      for (const credentials of [
        { keyId, key },
        { keyId: 'retired', key: oldKey },
      ]) {
        const client = createCommerceEntitlementClient({ url, ...credentials });
        const result = await client.apply(command());
        expect(result.ok).toBe(true);
        expect(await client.status('unknown:id')).toBeNull();
      }
      expect(apply).toHaveBeenCalledTimes(2);
      expect(apply.mock.calls[0]?.[0].at).toBe(1);
    } finally {
      await app.close();
    }
  });
  it('uses persistent replay protection across instances, and fails closed on a nonce-store outage', async () => {
    const nonces = new Set<string>();
    const claimNonce = vi.fn(async (nonce: string) => {
      if (nonces.has(nonce)) return false;
      nonces.add(nonce);
      return true;
    });
    const first = setup({ claimNonce }),
      second = setup({ claimNonce });
    const unavailable = setup({
      claimNonce: async () => {
        throw Error('private DB detail');
      },
    });
    const payload = command(),
      headers = signed(payload);
    try {
      expect(
        (await first.app.inject({ method: 'POST', url: path, payload, headers })).statusCode,
      ).toBe(200);
      expect(
        (await second.app.inject({ method: 'POST', url: path, payload, headers })).statusCode,
      ).toBe(401);
      expect(second.apply).not.toHaveBeenCalled();
      const failure = await unavailable.app.inject({ method: 'POST', url: path, payload, headers });
      expect(failure.statusCode).toBe(503);
      expect(failure.json()).toEqual({ error: 'E_COMMERCE_UNAVAILABLE' });
      expect(unavailable.apply).not.toHaveBeenCalled();
      expect((await unavailable.app.inject('/matches')).statusCode).toBe(200);
    } finally {
      await Promise.all([first.app.close(), second.app.close(), unavailable.app.close()]);
    }
  });
  it('does not retry ambiguous writes and opens the bounded dependency circuit', async () => {
    const { app, apply } = setup();
    apply.mockRejectedValue(Error('private failure'));
    try {
      const client = createCommerceEntitlementClient({
        url: await app.listen({ host: '127.0.0.1', port: 0 }),
        keyId,
        key,
      });
      for (let i = 0; i < 3; i++)
        await expect(client.apply(command())).rejects.toThrow('E_COMMERCE_UNAVAILABLE');
      await expect(client.apply(command())).rejects.toThrow('E_DEPENDENCY_OPEN');
      expect(apply).toHaveBeenCalledTimes(3);
      expect((await app.inject('/matches')).statusCode).toBe(200);
    } finally {
      await app.close();
    }
  });
  it('bounds signed admission and request body size', async () => {
    const { app, apply } = setup();
    try {
      const payload = command();
      for (let i = 0; i < 240; i++)
        expect(
          (await app.inject({ method: 'POST', url: path, payload, headers: signed(payload) }))
            .statusCode,
        ).toBe(200);
      expect(
        (await app.inject({ method: 'POST', url: path, payload, headers: signed(payload) }))
          .statusCode,
      ).toBe(429);
      const large = { ...payload, extra: 'x'.repeat(20_000) };
      expect(
        (await app.inject({ method: 'POST', url: path, payload: large, headers: signed(large) }))
          .statusCode,
      ).toBe(413);
      expect(apply).toHaveBeenCalledTimes(240);
    } finally {
      await app.close();
    }
  });
});

it('rejects unsigned, malformed, oversized, mismatched and redirected peer responses', async () => {
  const peer = Fastify();
  let mode = 'unsigned';
  peer.addHook('onSend', async (req, reply, payload) => {
    if (mode !== 'unsigned' && typeof payload === 'string') {
      const claims = Buffer.from(String(req.headers['x-commerce-claims']), 'base64url').toString();
      reply.header(
        'x-commerce-response-signature',
        createHmac('sha256', key)
          .update(
            `${claims}\nresponse\n${reply.statusCode}\n${createHash('sha256').update(payload).digest('hex')}`,
          )
          .digest('hex'),
      );
    }
    return payload;
  });
  peer.post(path, async (_req, reply) => {
    if (mode === 'redirect') return reply.redirect('/somewhere');
    if (mode === 'oversized') return { text: 'x'.repeat(1_048_577) };
    if (mode === 'malformed') return { ok: true, receipt: { ...receipt(), amount: 7 } };
    if (mode === 'mismatched') return { ok: true, receipt: { ...receipt(), commandId: 'other' } };
    return { ok: true, receipt: receipt() };
  });
  peer.get(`${path}/:commandId`, async () => ({ ...receipt(), commandId: 'other' }));
  try {
    const url = await peer.listen({ host: '127.0.0.1', port: 0 });
    for (mode of ['unsigned', 'malformed', 'oversized', 'mismatched', 'redirect'])
      await expect(
        createCommerceEntitlementClient({ url, keyId, key }).apply(command()),
      ).rejects.toThrow();
    await expect(
      createCommerceEntitlementClient({ url, keyId, key }).status('expected'),
    ).rejects.toThrow('E_COMMERCE_RESPONSE');
  } finally {
    await peer.close();
  }
});

it('bounds hanging writes without blocking match routes or retrying the command', async () => {
  const { app, apply } = setup();
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  apply.mockImplementation(async (input) => {
    await held;
    return { ok: true, receipt: receipt(input) };
  });
  try {
    const client = createCommerceEntitlementClient({
      url: await app.listen({ host: '127.0.0.1', port: 0 }),
      keyId,
      key,
      timeoutMs: 50,
    });
    await expect(client.apply(command())).rejects.toThrow();
    expect(apply).toHaveBeenCalledTimes(1);
    expect((await app.inject('/matches')).statusCode).toBe(200);
  } finally {
    release();
    await app.close();
  }
});

it('caps admitted service calls and reserves nonces before awaiting the durable store', async () => {
  const { app, apply } = setup();
  let release!: () => void, admitted!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const ready = new Promise<void>((resolve) => {
    admitted = resolve;
  });
  let count = 0;
  apply.mockImplementation(async (input) => {
    if (++count === 16) admitted();
    await held;
    return { ok: true, receipt: receipt(input) };
  });
  const requests: Promise<unknown>[] = [];
  try {
    for (let i = 0; i < 16; i++) {
      const payload = command({ commandId: `order-${i}` });
      requests.push(
        app
          .inject({ method: 'POST', url: path, payload, headers: signed(payload) })
          .then((result) => expect(result.statusCode).toBe(200)),
      );
    }
    await ready;
    const payload = command();
    expect(
      (await app.inject({ method: 'POST', url: path, payload, headers: signed(payload) }))
        .statusCode,
    ).toBe(429);
    expect(apply).toHaveBeenCalledTimes(16);
    expect((await app.inject('/matches')).statusCode).toBe(200);
  } finally {
    release();
    await Promise.all(requests);
    await app.close();
  }

  let unlock!: () => void, entered!: () => void;
  const blocked = new Promise<void>((resolve) => {
    unlock = resolve;
  });
  const claimed = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const durable = setup({
    claimNonce: async () => {
      entered();
      await blocked;
      return true;
    },
  });
  const payload = command(),
    headers = signed(payload);
  const first = durable.app
    .inject({ method: 'POST', url: path, payload, headers })
    .then((result) => expect(result.statusCode).toBe(200));
  try {
    await claimed;
    expect(
      (await durable.app.inject({ method: 'POST', url: path, payload, headers })).statusCode,
    ).toBe(401);
  } finally {
    unlock();
    await first;
    await durable.app.close();
  }
});
