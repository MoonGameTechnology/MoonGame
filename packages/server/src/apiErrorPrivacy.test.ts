import Fastify from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { registerMetaEconomyApi, type MetaEconomyApiDeps } from './metaEconomyApi';
import { registerMetaMarketApi } from './metaMarketApi';
import { registerCorpApi } from './corpApi';
import { MemoryMetaMarket } from './metaMarket';
import { CorpService } from './corpService';
import { MemoryArsenalStore, MemoryCorpStore } from './store';

// Synthetic dependency diagnostic; this reserved host is never contacted.
const secret = 'postgres://private-user:private-password@private-host.invalid/private-table';
const failure = () => Object.assign(new Error(secret), { detail: secret, query: secret });
const identify = async () => ({ accountId: 'owner', login: 'Player' });
const apps: ReturnType<typeof Fastify>[] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

function setup() {
  const lines: string[] = [];
  const app = Fastify({
    logger: {
      level: 'error',
      stream: {
        write: (line: string) => {
          lines.push(line);
        },
      },
    },
  });
  apps.push(app);
  return { app, lines };
}

function privateErrorsExcluded(lines: string[], code: string) {
  expect(lines).toHaveLength(1);
  expect(lines.join('')).not.toContain('private-');
  const record = JSON.parse(lines[0]!);
  expect(record.code).toBe(code);
  expect(record.requestId).toMatch(/^[A-Za-z0-9._:-]{1,128}$/);
  expect(record).not.toHaveProperty('err');
  expect(record).not.toHaveProperty('stack');
}

describe('API dependency error logging privacy', () => {
  it.each(['request', 'refresh'] as const)(
    'economy %s failures emit a stable diagnostic only',
    async (path) => {
      const { app, lines } = setup();
      const ok = { ok: true as const, receipt: { id: 'request-1', kind: 'craft' as const, at: 1 } };
      const economy: MetaEconomyApiDeps['economy'] = {
        readModel: vi.fn(async () => {
          throw failure();
        }),
        matchRewards: vi.fn(),
        setSupplyGoal: vi.fn(),
        craft: vi.fn(async () => ok),
        salvage: vi.fn(),
        selectPass: vi.fn(),
        chooseSeasonReward: vi.fn(),
        buyOffer: vi.fn(),
      };
      registerMetaEconomyApi(app, {
        economy,
        identify,
        onChanged: async () => {
          throw failure();
        },
      });
      const response = await app.inject(
        path === 'request'
          ? { url: '/meta-economy/me' }
          : {
              method: 'POST',
              url: '/meta-economy/craft',
              payload: { requestId: 'request-1', recipeId: 'armor', allowSoulbound: false },
            },
      );
      expect(response.statusCode).toBe(path === 'request' ? 503 : 200);
      expect(response.body).not.toContain('private-');
      privateErrorsExcluded(lines, path === 'request' ? 'E_UNAVAILABLE' : 'E_META_ECONOMY_SYNC');
    },
  );

  it.each(['request', 'refresh'] as const)(
    'market %s failures emit a stable diagnostic only',
    async (path) => {
      const { app, lines } = setup();
      const market = new MemoryMetaMarket(new MemoryArsenalStore());
      market.listings = async () => {
        throw failure();
      };
      market.buyMaterial = async () => ({ ok: true, balance: 1, tradeId: 'trade-1' });
      registerMetaMarketApi(app, {
        market,
        identify,
        onChanged: async () => {
          throw failure();
        },
      });
      const response = await app.inject(
        path === 'request'
          ? { url: '/meta-market' }
          : {
              method: 'POST',
              url: '/meta-market/material/buy',
              payload: { listingId: 'listing-1', tradeId: 'trade-1' },
            },
      );
      expect(response.statusCode).toBe(path === 'request' ? 500 : 200);
      expect(response.body).not.toContain('private-');
      privateErrorsExcluded(lines, path === 'request' ? 'E_INTERNAL' : 'E_META_MARKET_SYNC');
    },
  );

  it.each(['read', 'build'] as const)(
    'corporation infrastructure %s errors stay private',
    async (path) => {
      const { app, lines } = setup();
      const service = new CorpService({ store: new MemoryCorpStore() });
      service.infrastructure = async () => {
        throw failure();
      };
      registerCorpApi(app, { service, identify });
      const response = await app.inject(
        path === 'read'
          ? { url: '/corps/corp-1/infrastructure' }
          : {
              method: 'POST',
              url: '/corps/corp-1/build',
              payload: { buildingId: 'headquarters', expectedLevel: 0 },
            },
      );
      expect(response.statusCode).toBe(500);
      expect(response.json()).toEqual({ error: 'E_INTERNAL' });
      privateErrorsExcluded(lines, 'E_INTERNAL');
    },
  );
});
