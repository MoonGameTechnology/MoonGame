import Fastify, { type FastifyRequest } from 'fastify';
import { describe, expect, it } from 'vitest';
import { MemoryCorpStore } from './store';
import { CorpService } from './corpService';
import { registerCorpApi } from './corpApi';

async function setup(rateMax = 30) {
  const store = new MemoryCorpStore();
  const made = await store.createCorp('Builders', 'head', 'Head');
  if (!made.ok) throw new Error(made.code);
  await store.addMember(made.corpId, 'member', 'Member', 'member');
  const app = Fastify();
  registerCorpApi(app, {
    service: new CorpService({ store, now: () => 0 }),
    rateMax,
    features: { ava: false, medals: false },
    identify: async (req: FastifyRequest) => {
      const id = req.headers['x-user'];
      return typeof id === 'string' ? { accountId: id, login: id } : null;
    },
  });
  return { app, store, corpId: made.corpId, base: `/corps/${made.corpId}` };
}

describe('corporation construction HTTP authority', () => {
  it('requires a session, denies outsiders and ignores payload identity/price/time', async () => {
    const { app, store, corpId, base } = await setup();
    try {
      for (const [method, url] of [
        ['GET', `${base}/infrastructure`],
        ['POST', `${base}/build`],
      ] as const) {
        const result = await app.inject({ method, url });
        expect(result.statusCode).toBe(401);
      }
      expect(
        (await app.inject({ url: `${base}/infrastructure`, headers: { 'x-user': 'stranger' } }))
          .statusCode,
      ).toBe(403);
      const body = {
        buildingId: 'headquarters',
        expectedLevel: 0,
        accountId: 'head',
        cost: -1000,
        completesAt: 0,
      };
      expect(
        (
          await app.inject({
            method: 'POST',
            url: `${base}/build`,
            headers: { 'x-user': 'member' },
            payload: body,
          })
        ).statusCode,
      ).toBe(403);
      const built = await app.inject({
        method: 'POST',
        url: `${base}/build`,
        headers: { 'x-user': 'head' },
        payload: body,
      });
      expect(built.statusCode).toBe(200);
      expect(built.json().construction).toMatchObject({ cost: 0, completesAt: 3_600_000 });
      expect((await store.getCorp(corpId))?.influence).toBe(0);
      const member = await app.inject({
        url: `${base}/infrastructure`,
        headers: { 'x-user': 'member' },
      });
      expect(member.json().canBuild).toBe(false);
      const me = await app.inject({ url: '/corps/me', headers: { 'x-user': 'head' } });
      expect(me.json().features).toEqual({ ava: false, medals: false });
    } finally {
      await app.close();
    }
  });

  it('rejects malformed intents and rate-limits construction writes', async () => {
    const { app, base } = await setup(3);
    try {
      for (const payload of [
        {},
        { buildingId: 'headquarters', expectedLevel: -1 },
        { buildingId: 'headquarters', expectedLevel: 0.5 },
      ]) {
        const result = await app.inject({
          method: 'POST',
          url: `${base}/build`,
          headers: { 'x-user': 'head' },
          payload,
        });
        expect(result.statusCode).toBe(400);
      }
      const result = await app.inject({
        method: 'POST',
        url: `${base}/build`,
        headers: { 'x-user': 'head' },
        payload: { buildingId: 'headquarters', expectedLevel: 0 },
      });
      expect(result.statusCode).toBe(429);
    } finally {
      await app.close();
    }
  });

  it('unexpected storage failures return a stable code without internal details', async () => {
    const { app, store, base } = await setup();
    store.infrastructure = async () => {
      throw new Error('private database credentials');
    };
    try {
      const result = await app.inject({
        url: `${base}/infrastructure`,
        headers: { 'x-user': 'head' },
      });
      expect(result.statusCode).toBe(500);
      expect(result.json()).toEqual({ error: 'E_INTERNAL' });
    } finally {
      await app.close();
    }
  });
});
