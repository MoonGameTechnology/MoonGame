import { describe, expect, it } from 'vitest';
import { createInitialState, createKernel, parseGameData } from '@void/shared-core';
import { MatchRoom } from './matchRoom';
import { createMultiplayerServer } from './wsServer';
import { SecurityAudit } from './securityAudit';
import { registerAuthApi } from './authApi';
import { MemoryUserStore } from './store';
import { hmacSecret, signSessionToken, verifySessionToken } from './auth';

const salt = 'http-audit-private-fixture-salt-32-characters';
const data = parseGameData({
  version: 'test',
  resources: ['marker'],
  units: {},
  factions: {},
  buildings: {},
  events: {},
  sectors: {},
  planetTypes: {},
});
function room() {
  return new MatchRoom({
    id: 'audit-room',
    initialState: createInitialState({
      seed: 'audit',
      version: { data: 'test', manifest: 'test' },
    }),
    kernel: createKernel([]),
    data,
  });
}

describe('HTTP investigation evidence', () => {
  it('records malformed/conflicting/unknown requests with declared routes and a server-owned request ID', async () => {
    const lines: string[] = [];
    const audit = new SecurityAudit((line) => lines.push(line), Date.now, { salt });
    const server = createMultiplayerServer({
      room: room(),
      securityAudit: audit,
      httpRoutes: (app) => {
        app.get('/probe/:id', async (_req, reply) =>
          reply.code(409).send({ error: 'E_SESSION_CHANGED' }),
        );
        app.post('/parse', async () => ({ ok: true }));
      },
    });
    const base = (await server.listen()).replace(/^ws:/, 'http:').replace(/\/matches\/.*$/, '');
    try {
      const response = await fetch(base + '/probe/private-account-name?token=QUERY_SECRET', {
        headers: {
          'x-request-id': 'CLIENT_SECRET',
          authorization: 'Bearer HEADER_SECRET',
          cookie: 'COOKIE_SECRET',
          'x-forwarded-for': '192.0.2.76',
        },
      });
      await response.text();
      const id = response.headers.get('x-request-id');
      expect(id).toMatch(/^[a-f0-9-]{36}$/);
      expect(lines.map((s) => JSON.parse(s))).toContainEqual(
        expect.objectContaining({
          event: 'http.reject',
          code: 'E_SESSION_CHANGED',
          route: '/probe/:id',
          status: 409,
          requestId: id,
        }),
      );
      await (
        await fetch(base + '/parse', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: '{',
        })
      ).text();
      await (await fetch(base + '/unknown-private-name?token=QUERY_SECRET')).text();
      const records = lines.map((s) => JSON.parse(s));
      expect(records).toContainEqual(
        expect.objectContaining({ event: 'http.reject', status: 400 }),
      );
      expect(records).toContainEqual(
        expect.objectContaining({ event: 'http.reject', status: 404 }),
      );
      expect(lines.join('')).not.toMatch(
        /private-account-name|unknown-private-name|QUERY_SECRET|HEADER_SECRET|COOKIE_SECRET|CLIENT_SECRET|192\.0\.2\.76/,
      );
    } finally {
      await server.close();
    }
  });
  it('binds successful registration/login/logout/deletion to the verified actor without logging credentials', async () => {
    const lines: string[] = [];
    const audit = new SecurityAudit((line) => lines.push(line), Date.now, { salt });
    const users = new MemoryUserStore(),
      key = hmacSecret('audit-http-fixture-key');
    const sign = { key, algorithm: 'HS256', issuer: 'audit', audience: 'session' };
    const verify = { key, algorithms: ['HS256'], issuer: 'audit', audience: 'session' };
    const server = createMultiplayerServer({
      room: room(),
      securityAudit: audit,
      httpRoutes: (app) =>
        registerAuthApi(app, {
          users,
          securityAudit: audit,
          scryptParams: { N: 4096, r: 8, p: 1 },
          rateMax: 100,
          accountDeletionEnabled: true,
          signSession: (accountId, login, pwfp) =>
            signSessionToken({ accountId, login, pwfp }, sign, { ttlSeconds: 3600 }),
          verifySession: (token) => verifySessionToken(token, verify),
        }),
    });
    const base = (await server.listen()).replace(/^ws:/, 'http:').replace(/\/matches\/.*$/, '');
    const password = 'A valid private orbit 42!';
    const post = (path: string, body: object, token?: string) =>
      fetch(base + path, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(token ? { authorization: 'Bearer ' + token } : {}),
        },
        body: JSON.stringify(body),
      });
    try {
      const registered = await post('/auth/register', { login: 'аtt_probe', password });
      expect(registered.status).toBe(201);
      const first = (await registered.json()) as { token: string; accountId: string };
      await (await post('/auth/logout', {}, first.token)).text();
      const login = await post('/auth/login', { login: 'аtt_probe', password });
      expect(login.status).toBe(200);
      const second = (await login.json()) as { token: string };
      const deleted = await post(
        '/auth/delete-account',
        { password, confirm: 'DELETE' },
        second.token,
      );
      expect(deleted.status).toBe(202);
      await deleted.text();
      const records = lines.map((s) => JSON.parse(s));
      const identity = records.find((r) => r.event === 'auth.success').actor;
      expect(identity).toMatch(/^[a-f0-9]{16}$/);
      for (const event of ['auth.success', 'auth.logout', 'auth.delete'])
        expect(records).toContainEqual(expect.objectContaining({ event, actor: identity }));
      expect(records).toContainEqual(
        expect.objectContaining({ event: 'auth.success', inputClass: 'mixed-script' }),
      );
      const text = lines.join('');
      expect(text).not.toContain(password);
      expect(text).not.toContain(first.token);
      expect(text).not.toContain(second.token);
      expect(text).not.toContain(first.accountId);
      expect(text).not.toContain('аtt_probe');
    } finally {
      await server.close();
    }
  });
});
