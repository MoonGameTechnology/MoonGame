import { describe, expect, it } from 'vitest';
import Fastify from 'fastify';
import { matchCreationAccess } from './matchCreationAccess';
import { registerMatchApi } from './matchApi';

describe('account-scoped session creation', () => {
  it.each(['1', 'true'])('production %s denies by default while development retains its existing API', production => {
    expect(matchCreationAccess({})).toBeUndefined();
    expect(matchCreationAccess({ PROD: '0', MATCH_CREATOR_ACCOUNT_IDS: '' })).toBeUndefined();
    expect(matchCreationAccess({ PROD: production })!({ accountId: 'owner', login: 'Owner' })).toBe(false);
  });
  it('checks live account IDs, not a reused name or caller-supplied account ID', async () => {
    const app = Fastify();
    let created = 0;
    registerMatchApi(app, {
      identify: async request => request.headers.authorization === 'creator'
        ? { accountId: 'owner', login: 'Owner' }
        : request.headers.authorization === 'other' ? { accountId: 'other', login: 'Owner' } : null,
      canCreate: matchCreationAccess({ PROD: '1', MATCH_CREATOR_ACCOUNT_IDS: ' owner ' }),
      createMatch: async () => { created++; return { matchId: 'test', seats: ['p1', 'p2'] }; },
      join: async () => ({ error: 'E_NO_MATCH' }),
    });
    try {
      expect((await app.inject({ method: 'POST', url: '/matches' })).statusCode).toBe(401);
      const denied = await app.inject({ method: 'POST', url: '/matches', headers: { authorization: 'other' }, payload: { accountId: 'owner' } });
      expect(denied.statusCode).toBe(403);
      expect(denied.json()).toEqual({ error: 'E_FORBIDDEN' });
      expect(created).toBe(0);
      expect((await app.inject({ method: 'POST', url: '/matches', headers: { authorization: 'creator' } })).statusCode).toBe(200);
      expect(created).toBe(1);
    } finally { await app.close(); }
  });
  it('a restricted host cannot accidentally authorize an unidentified dev caller', async () => {
    const app = Fastify();
    registerMatchApi(app, { canCreate: () => true, createMatch: async () => { throw new Error('must not create'); }, join: async () => ({ error: 'E_NO_MATCH' }) });
    try { expect((await app.inject({ method: 'POST', url: '/matches' })).statusCode).toBe(403); }
    finally { await app.close(); }
  });
});
