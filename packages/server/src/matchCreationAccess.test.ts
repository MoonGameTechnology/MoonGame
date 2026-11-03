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
      expect((await app.inject({ method: 'GET', url: '/matches/capabilities' })).statusCode).toBe(401);
      const deniedCapability = await app.inject({ method: 'GET', url: '/matches/capabilities?accountId=owner&nick=Owner', headers: { authorization: 'other' } });
      expect(deniedCapability.json()).toEqual({ canCreate: false });
      expect(deniedCapability.headers['cache-control']).toBe('no-store');
      const grantedCapability = await app.inject({ method: 'GET', url: '/matches/capabilities', headers: { authorization: 'creator' } });
      expect(grantedCapability.json()).toEqual({ canCreate: true });
      expect(created).toBe(0);
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
    try {
      expect((await app.inject({ method: 'GET', url: '/matches/capabilities' })).json()).toEqual({ canCreate: false });
      expect((await app.inject({ method: 'POST', url: '/matches' })).statusCode).toBe(403);
    }
    finally { await app.close(); }
  });
  it('does not advertise creation when the host has no create route', async () => {
    const app = Fastify();
    registerMatchApi(app, { join: async () => ({ error: 'E_NO_MATCH' }) });
    try { expect((await app.inject('/matches/capabilities')).json()).toEqual({ canCreate: false }); }
    finally { await app.close(); }
  });
  it('capability checks fail closed without leaking a failed policy', async () => {
    const app = Fastify();
    registerMatchApi(app, {
      identify: async () => ({ accountId: 'owner', login: 'Owner' }),
      canCreate: () => { throw new Error('private policy detail'); },
      createMatch: async () => ({ matchId: 'test', seats: ['p1'] }),
      join: async () => ({ error: 'E_NO_MATCH' }),
    });
    try {
      const response = await app.inject('/matches/capabilities');
      expect(response.statusCode).toBe(503);
      expect(response.json()).toEqual({ error: 'E_UNAVAILABLE' });
    } finally { await app.close(); }
  });
});
