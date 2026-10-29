import Fastify from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MetaCommandResult, MetaEconomyView } from '@void/protocol';
import { registerMetaEconomyApi, type MetaEconomyApiDeps } from './metaEconomyApi';
import type { CorpMembership } from './store';

const apps: ReturnType<typeof Fastify>[] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});
function setup(
  options: {
    authenticated?: boolean;
    rateMax?: number;
    corpOf?: (accountId: string) => Promise<CorpMembership | null>;
  } = {},
) {
  const view: MetaEconomyView = {
    catalogVersion: 'v0',
    materials: [],
    recipes: [],
    supplyGoal: null,
    items: [],
    salvageableItemIds: [],
    seasons: [],
    cosmetics: [],
  };
  const ok: MetaCommandResult = { ok: true, receipt: { id: 'request-1', kind: 'craft', at: 1 } };
  const economy: MetaEconomyApiDeps['economy'] = {
    readModel: vi.fn(async () => view),
    matchRewards: vi.fn(async () => ({ receipts: [], finalReady: false })),
    setSupplyGoal: vi.fn(async () => ok),
    craft: vi.fn(async () => ok),
    salvage: vi.fn(async () => ok),
    selectPass: vi.fn(async () => ok),
    chooseSeasonReward: vi.fn(async () => ok),
    buyOffer: vi.fn(async () => ok),
    claimPremiumDaily: vi.fn(async () => ok),
    corpStyle: vi.fn(async () => ({ active: 'high_tech', backdrop: 'orbit', owned: ['high_tech'] })),
    buyCorpStyle: vi.fn(async () => ok),
    applyCorpStyle: vi.fn(async () => ok),
  };
  const app = Fastify();
  apps.push(app);
  registerMetaEconomyApi(app, {
    economy,
    identify: async () =>
      options.authenticated === false ? null : { accountId: 'session-owner', login: 'Player' },
    now: () => 0,
    rateMax: options.rateMax,
    ...(options.corpOf ? { corpOf: options.corpOf } : {}),
  });
  return { app, economy };
}
const member = (role: CorpMembership['role']) => async (): Promise<CorpMembership> => ({
  corpId: 'corp-1',
  accountId: 'session-owner',
  login: 'Player',
  role,
});
const craft = { requestId: 'request-1', recipeId: 'armor', allowSoulbound: false };

describe('main economy HTTP boundary', () => {
  it('requires an account for reads and writes and never forwards an anonymous intent', async () => {
    const { app, economy } = setup({ authenticated: false });
    expect((await app.inject({ url: '/meta-economy/me' })).json()).toEqual({ error: 'E_AUTH' });
    expect(
      (await app.inject({ method: 'POST', url: '/meta-economy/craft', payload: craft })).statusCode,
    ).toBe(401);
    expect(economy.readModel).not.toHaveBeenCalled();
    expect(economy.craft).not.toHaveBeenCalled();
    expect((await app.inject({ url: '/meta-economy/matches/war_1/rewards' })).statusCode).toBe(401);
    expect(economy.matchRewards).not.toHaveBeenCalled();
  });

  it('reads only the session owner’s committed receipts and never invokes a reward mutation', async () => {
    const { app, economy } = setup();
    const receipt = { id: 'committed-receipt', kind: 'settlement', at: 123, warrants: 20 };
    vi.mocked(economy.matchRewards).mockResolvedValue({ receipts: [receipt], finalReady: true });
    const response = await app.inject({
      url: '/meta-economy/matches/war_1/rewards?accountId=victim',
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.json()).toEqual({ receipts: [receipt], finalReady: true });
    expect(economy.matchRewards).toHaveBeenCalledWith('session-owner', 'war_1');
    expect(economy.craft).not.toHaveBeenCalled();
    expect(economy.salvage).not.toHaveBeenCalled();
    expect(economy.setSupplyGoal).not.toHaveBeenCalled();
    expect(economy.selectPass).not.toHaveBeenCalled();
    expect(economy.chooseSeasonReward).not.toHaveBeenCalled();
  });

  it('validates match IDs and keeps unavailable receipt reads fail-secure', async () => {
    const { app, economy } = setup();
    for (const matchId of ['bad%2Fmatch', '%3Cscript%3E']) {
      const response = await app.inject({ url: `/meta-economy/matches/${matchId}/rewards` });
      expect(response.statusCode).toBe(400);
      expect(response.json()).toEqual({ error: 'E_BAD_REQUEST' });
    }
    // Fastify rejects an overlong route parameter before invoking our handler.
    expect(
      (await app.inject({ url: `/meta-economy/matches/${'x'.repeat(129)}/rewards` })).statusCode,
    ).toBe(414);
    expect(economy.matchRewards).not.toHaveBeenCalled();
    vi.mocked(economy.matchRewards).mockRejectedValueOnce(
      new Error('postgres://secret/private-table'),
    );
    const response = await app.inject({ url: '/meta-economy/matches/war_1/rewards' });
    expect(response.statusCode).toBe(503);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.json()).toEqual({ error: 'E_UNAVAILABLE' });
  });

  it('takes ownership from the session and rejects client-issued sources, grants and owners', async () => {
    const { app, economy } = setup();
    for (const extra of [
      { accountId: 'victim' },
      { source: 'match' },
      { quantity: 999 },
      { soulbound: false },
    ]) {
      const response = await app.inject({
        method: 'POST',
        url: '/meta-economy/craft',
        payload: { ...craft, ...extra },
      });
      expect(response.statusCode).toBe(400);
      expect(response.json()).toEqual({ error: 'E_BAD_REQUEST' });
    }
    expect(economy.craft).not.toHaveBeenCalled();
    const response = await app.inject({
      method: 'POST',
      url: '/meta-economy/craft',
      payload: craft,
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(economy.craft).toHaveBeenCalledWith('session-owner', craft);
    for (const route of ['settle', 'grant', 'entitlement']) {
      expect(
        (
          await app.inject({
            method: 'POST',
            url: `/meta-economy/${route}`,
            payload: { accountId: 'session-owner' },
          })
        ).statusCode,
      ).toBe(404);
    }
  });

  it('requires explicit binding consent and a bounded stable request id', async () => {
    const { app, economy } = setup();
    for (const payload of [
      null,
      [],
      { requestId: 'r', recipeId: 'armor' },
      { ...craft, allowSoulbound: 'false' },
      { ...craft, requestId: 'x'.repeat(129) },
      { ...craft, requestId: '../bad' },
    ]) {
      expect(
        (
          await app.inject({
            method: 'POST',
            url: '/meta-economy/craft',
            headers: { 'content-type': 'application/json' },
            payload: JSON.stringify(payload),
          })
        ).statusCode,
      ).toBe(400);
    }
    expect(economy.craft).not.toHaveBeenCalled();
  });

  it('buys a store offer for the session owner only and passes no price from the client', async () => {
    const { app, economy } = setup();
    const buy = { requestId: 'buy-1', offerId: 'premium_30' };
    for (const extra of [{ price: 0 }, { accountId: 'victim' }, { sovereigns: 999 }]) {
      const response = await app.inject({
        method: 'POST',
        url: '/meta-economy/store/buy',
        payload: { ...buy, ...extra },
      });
      expect(response.statusCode).toBe(400);
    }
    expect(economy.buyOffer).not.toHaveBeenCalled();
    vi.mocked(economy.buyOffer).mockResolvedValueOnce({ ok: false, code: 'E_SOVEREIGNS' });
    const poor = await app.inject({ method: 'POST', url: '/meta-economy/store/buy', payload: buy });
    expect(poor.statusCode).toBe(409);
    expect(poor.json()).toEqual({ error: 'E_SOVEREIGNS' });
    expect(economy.buyOffer).toHaveBeenCalledWith('session-owner', buy);
  });

  it('claims premium daily Sovereigns for the session owner, with nothing else in the body', async () => {
    const { app, economy } = setup();
    const claim = { requestId: 'daily-1' };
    const forged = await app.inject({
      method: 'POST',
      url: '/meta-economy/premium/daily',
      payload: { ...claim, amount: 999 },
    });
    expect(forged.statusCode).toBe(400);
    expect(economy.claimPremiumDaily).not.toHaveBeenCalled();
    const ok = await app.inject({
      method: 'POST',
      url: '/meta-economy/premium/daily',
      payload: claim,
    });
    expect(ok.statusCode).toBe(200);
    expect(economy.claimPremiumDaily).toHaveBeenCalledWith('session-owner', claim);
  });

  it('mounts the base style routes only with the corporation lookup', async () => {
    const { app } = setup();
    expect((await app.inject({ url: '/meta-economy/corp-style' })).statusCode).toBe(404);
    const buy = { requestId: 'style-1', offerId: 'corp_style_high_tech' };
    expect(
      (await app.inject({ method: 'POST', url: '/meta-economy/corp-style/buy', payload: buy }))
        .statusCode,
    ).toBe(404);
  });

  it('reads the base style of the session owner’s corporation', async () => {
    const outside = setup({ corpOf: async () => null });
    expect((await outside.app.inject({ url: '/meta-economy/corp-style' })).json()).toEqual({
      corp: null,
    });
    const recruit = setup({ corpOf: member('recruit') });
    expect((await recruit.app.inject({ url: '/meta-economy/corp-style' })).json()).toEqual({
      corp: null,
    });
    expect(recruit.economy.corpStyle).not.toHaveBeenCalled();
    for (const [role, head] of [
      ['member', false],
      ['head', true],
    ] as const) {
      const { app, economy } = setup({ corpOf: member(role) });
      const response = await app.inject({ url: '/meta-economy/corp-style?corpId=other' });
      expect(response.headers['cache-control']).toBe('no-store');
      expect(response.json()).toEqual({
        corp: { head, active: 'high_tech', backdrop: 'orbit', owned: ['high_tech'] },
      });
      expect(economy.corpStyle).toHaveBeenCalledWith('corp-1');
    }
    const down = setup({
      corpOf: async () => {
        throw Error('E_CORPORATIONS_UNAVAILABLE');
      },
    });
    const response = await down.app.inject({ url: '/meta-economy/corp-style' });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ error: 'E_UNAVAILABLE' });
  });

  it('lets only the head buy and apply a base style, for the session’s own corporation', async () => {
    const buy = { requestId: 'style-1', offerId: 'corp_style_high_tech' };
    const apply = { requestId: 'style-2', styleId: 'high_tech' };
    for (const [corpOf, code] of [
      [async () => null, 'E_NOT_MEMBER'],
      [member('recruit'), 'E_NOT_MEMBER'],
      [member('officer'), 'E_FORBIDDEN'],
      [member('member'), 'E_FORBIDDEN'],
    ] as const) {
      const { app, economy } = setup({ corpOf });
      for (const [url, payload] of [
        ['/meta-economy/corp-style/buy', buy],
        ['/meta-economy/corp-style/apply', apply],
      ] as const) {
        const response = await app.inject({ method: 'POST', url, payload });
        expect(response.statusCode).toBe(409);
        expect(response.json()).toEqual({ error: code });
      }
      expect(economy.buyCorpStyle).not.toHaveBeenCalled();
      expect(economy.applyCorpStyle).not.toHaveBeenCalled();
    }
    const { app, economy } = setup({ corpOf: member('head') });
    for (const forged of [
      { ...buy, corpId: 'victim-corp' },
      { ...buy, price: 0 },
      { ...apply, corpId: 'victim-corp' },
    ]) {
      const url = 'offerId' in forged ? 'corp-style/buy' : 'corp-style/apply';
      const response = await app.inject({
        method: 'POST',
        url: `/meta-economy/${url}`,
        payload: forged,
      });
      expect(response.statusCode).toBe(400);
    }
    expect(
      (await app.inject({ method: 'POST', url: '/meta-economy/corp-style/buy', payload: buy }))
        .statusCode,
    ).toBe(200);
    expect(economy.buyCorpStyle).toHaveBeenCalledWith('session-owner', 'corp-1', buy);
    expect(
      (await app.inject({ method: 'POST', url: '/meta-economy/corp-style/apply', payload: apply }))
        .statusCode,
    ).toBe(200);
    expect(economy.applyCorpStyle).toHaveBeenCalledWith('corp-1', apply);
  });

  it('limits writes and returns stable errors without database details', async () => {
    const { app, economy } = setup({ rateMax: 1 });
    vi.mocked(economy.craft).mockRejectedValueOnce(
      Error('postgres://secret-password/internal-table'),
    );
    const failed = await app.inject({ method: 'POST', url: '/meta-economy/craft', payload: craft });
    expect(failed.statusCode).toBe(503);
    expect(failed.json()).toEqual({ error: 'E_UNAVAILABLE' });
    expect(
      (await app.inject({ method: 'POST', url: '/meta-economy/craft', payload: craft })).json(),
    ).toEqual({ error: 'E_RATE_LIMIT' });
    expect((await app.inject({ url: '/meta-economy/me' })).statusCode).toBe(200);
  });
});
