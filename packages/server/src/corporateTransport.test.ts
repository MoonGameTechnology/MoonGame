import { createHash, createHmac, randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import {
  corporateEndpoint,
  corporateIdentity,
  corporateRequest,
  registerCorporateGateway,
} from './corporateTransport';

const key = 'synthetic-corporations-test-key-32-bytes';
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
