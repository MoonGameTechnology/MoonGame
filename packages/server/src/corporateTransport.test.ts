import { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto';
import { request as httpRequest } from 'node:http';
import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import {
  corporateEndpoint,
  corporateIdentity,
  corporateRequest,
  registerCorporateGateway,
} from './corporateTransport';

const key = randomBytes(32).toString('hex');
function signed(path: string, body: unknown, at = Date.now()) {
  const claims = JSON.stringify({
    at,
    nonce: randomUUID(),
    who: { accountId: 'account', login: 'Pilot' },
    ip: '192.0.2.1',
  });
  const digest = createHash('sha256')
    .update(JSON.stringify(body ?? null))
    .digest('hex');
  return {
    'x-corp-claims': Buffer.from(claims).toString('base64url'),
    'x-corp-signature': createHmac('sha256', key)
      .update(`${claims}\nPOST\n${path}\n${digest}`)
      .digest('hex'),
  };
}
describe('corporate service trust boundary', () => {
  it('rejects unsigned, modified, stale and replayed gateway requests', async () => {
    const app = Fastify();
    const identify = corporateIdentity(app, key);
    app.post('/corps', async (request) => ({ who: await identify(request), ip: request.ip }));
    try {
      const headers = signed('/corps', { name: 'Original' });
      expect(
        (await app.inject({ method: 'POST', url: '/corps', payload: { name: 'Original' } }))
          .statusCode,
      ).toBe(401);
      expect(
        (await app.inject({ method: 'POST', url: '/corps', headers, payload: { name: 'Changed' } }))
          .statusCode,
      ).toBe(401);
      const valid = await app.inject({
        method: 'POST',
        url: '/corps',
        headers,
        payload: { name: 'Original' },
      });
      expect(valid.statusCode).toBe(200);
      expect(valid.json()).toEqual({
        who: { accountId: 'account', login: 'Pilot' },
        ip: '192.0.2.1',
      });
      expect(
        (
          await app.inject({
            method: 'POST',
            url: '/corps',
            headers,
            payload: { name: 'Original' },
          })
        ).statusCode,
      ).toBe(429);
      expect(
        (
          await app.inject({
            method: 'POST',
            url: '/corps',
            headers: signed('/corps', {}, Date.now() - 31_000),
            payload: {},
          })
        ).statusCode,
      ).toBe(401);
    } finally {
      await app.close();
    }
  });
  it('isolates a corporate outage from the game and inventory routes', async () => {
    const app = Fastify();
    registerCorporateGateway(app, { url: 'http://127.0.0.1:1', key, timeoutMs: 50 }, async () => ({
      accountId: 'account',
      login: 'Pilot',
    }));
    app.get('/matches', async () => ({ matches: ['active'] }));
    app.get('/arsenal/me', async () => ({ items: ['personal-item'] }));
    try {
      const down = await app.inject('/corps/me');
      expect(down.statusCode).toBe(503);
      expect(down.json()).toEqual({ error: 'E_CORPORATIONS_UNAVAILABLE' });
      expect((await app.inject('/matches')).statusCode).toBe(200);
      expect((await app.inject('/arsenal/me')).statusCode).toBe(200);
    } finally {
      await app.close();
    }
  });
  it('rejects ambiguous endpoint credentials and unsafe configuration', () => {
    expect(() => corporateEndpoint({ CORPORATIONS_URL: 'http://corp:8789' })).toThrow(
      'E_CORPORATIONS_CONFIG',
    );
    expect(() =>
      corporateEndpoint({ CORPORATIONS_URL: 'http://user:pass@corp:8789', CORPORATIONS_KEY: key }),
    ).toThrow('E_CORPORATIONS_CONFIG');
    expect(
      corporateEndpoint({ CORPORATIONS_URL: 'https://corps.example.test', CORPORATIONS_KEY: key }),
    ).toEqual({ url: 'https://corps.example.test', key });
  });
});

it('accepts only a response authenticated by the corporate peer', async () => {
  const signedPeer = Fastify(),
    fakePeer = Fastify();
  corporateIdentity(signedPeer, key);
  signedPeer.get('/corps', async () => ({ ok: true }));
  fakePeer.get('/corps', async () => ({ ok: true, role: 'head' }));
  try {
    const signedUrl = await signedPeer.listen({ host: '127.0.0.1', port: 0 });
    const fakeUrl = await fakePeer.listen({ host: '127.0.0.1', port: 0 });
    expect(await corporateRequest({ url: signedUrl, key }, 'GET', '/corps')).toEqual({
      status: 200,
      body: { ok: true },
    });
    await expect(corporateRequest({ url: fakeUrl, key }, 'GET', '/corps')).rejects.toThrow(
      'E_CORPORATIONS_RESPONSE',
    );
  } finally {
    await Promise.all([signedPeer.close(), fakePeer.close()]);
  }
});

it('stops repeatedly calling an unavailable signed peer without retrying writes', async () => {
  const peer = Fastify();
  corporateIdentity(peer, key);
  let calls = 0;
  peer.post('/corps', async (_request, reply) => {
    calls++;
    return reply.code(503).send({ error: 'E_CORPORATIONS_UNAVAILABLE' });
  });
  try {
    const endpoint = { url: await peer.listen({ host: '127.0.0.1', port: 0 }), key };
    for (let i = 0; i < 3; i++)
      expect((await corporateRequest(endpoint, 'POST', '/corps', { name: 'test' })).status).toBe(
        503,
      );
    await expect(corporateRequest(endpoint, 'POST', '/corps', { name: 'test' })).rejects.toThrow(
      'E_DEPENDENCY_OPEN',
    );
    expect(calls).toBe(3);
  } finally {
    await peer.close();
  }
});

it('does not let one rate-limited caller open the corporate circuit for other users', async () => {
  const peer = Fastify();
  const identify = corporateIdentity(peer, key);
  peer.post('/corps', async (request, reply) => {
    const who = await identify(request);
    if (who?.accountId === 'limited') return reply.code(429).send({ error: 'E_RATE_LIMIT' });
    return { ok: true };
  });
  try {
    const endpoint = { url: await peer.listen({ host: '127.0.0.1', port: 0 }), key };
    for (let i = 0; i < 6; i++)
      expect(
        (
          await corporateRequest(
            endpoint,
            'POST',
            '/corps',
            {},
            { accountId: 'limited', login: 'Limited' },
          )
        ).status,
      ).toBe(429);
    expect(
      (
        await corporateRequest(
          endpoint,
          'POST',
          '/corps',
          {},
          { accountId: 'other', login: 'Other' },
        )
      ).status,
    ).toBe(200);
  } finally {
    await peer.close();
  }
});

it('rejects paths changed by URL normalization before they can poison the shared circuit', async () => {
  const peer = Fastify(),
    game = Fastify();
  corporateIdentity(peer, key);
  let calls = 0;
  peer.get('/health', async () => {
    calls++;
    return { ok: true };
  });
  peer.get('/corps/me', async () => {
    calls++;
    return { ok: true };
  });
  try {
    const endpoint = { url: await peer.listen({ host: '127.0.0.1', port: 0 }), key };
    registerCorporateGateway(game, endpoint, async () => ({ accountId: 'pilot', login: 'Pilot' }));
    const address = new URL(await game.listen({ host: '127.0.0.1', port: 0 }));
    // fetch/app.inject normalize this attack before it reaches Game; raw HTTP does not.
    const raw = (path: string) =>
      new Promise<number | undefined>((resolve, reject) => {
        const request = httpRequest(
          { hostname: address.hostname, port: address.port, path },
          (response) => {
            response.resume();
            response.on('end', () => resolve(response.statusCode));
          },
        );
        request.on('error', reject);
        request.end();
      });
    for (const path of ['/corps/%2e%2e/health', '/corps/%2E./health', '/corps/../health'])
      expect(await raw(path)).toBe(400);
    expect(calls).toBe(0);
    expect(await raw('/corps/me')).toBe(200);
    expect(calls).toBe(1);
  } finally {
    await Promise.all([game.close(), peer.close()]);
  }
});

it('caps hanging corporate calls while independent game routes remain available', async () => {
  const peer = Fastify(),
    game = Fastify();
  corporateIdentity(peer, key);
  let release!: () => void, admitted!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const full = new Promise<void>((resolve) => {
    admitted = resolve;
  });
  let calls = 0;
  peer.get('/corps', async () => {
    if (++calls === 16) admitted();
    await held;
    return { ok: true };
  });
  game.get('/matches', async () => ({ matches: ['active'] }));
  let requests: Promise<unknown>[] = [];
  try {
    const endpoint = { url: await peer.listen({ host: '127.0.0.1', port: 0 }), key };
    requests = Array.from({ length: 16 }, () => corporateRequest(endpoint, 'GET', '/corps'));
    await full;
    await expect(corporateRequest(endpoint, 'GET', '/corps')).rejects.toThrow('E_DEPENDENCY_BUSY');
    expect((await game.inject('/matches')).statusCode).toBe(200);
    release();
    await Promise.all(requests);
    expect((await corporateRequest(endpoint, 'GET', '/corps')).status).toBe(200);
    expect(calls).toBe(17);
  } finally {
    release();
    await Promise.allSettled(requests);
    await Promise.all([peer.close(), game.close()]);
  }
});
