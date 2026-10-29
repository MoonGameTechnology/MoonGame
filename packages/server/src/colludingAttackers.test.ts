import { once } from 'node:events';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { configFromEnv } from './serverConfig';
import { currentPwfp, liveSession, registerAuthApi, sessionFingerprint } from './authApi';
import { isOperatorRequest } from './operatorAccess';
import { MemoryUserStore } from './store';
import { createDevMatch, loadShippedData } from './scenario';
import { createMultiplayerServer } from './wsServer';

// An insider hands credentials to an external accomplice. All credentials and
// accounts are synthetic; these tests never load a live environment or database.
const productionKey = 'synthetic-production-key-for-collusion-audit';
const stage = configFromEnv({ AUTH_JWT_SECRET: 'synthetic-staging-key-for-collusion-audit' });
const production = configFromEnv({ AUTH_JWT_SECRET: productionKey });
const origin = 'https://game.audit.invalid';
const data = loadShippedData();
const cleanup: Array<() => Promise<unknown>> = [];
afterEach(async () => {
  while (cleanup.length) await cleanup.pop()!();
});

async function identity() {
  const users = new MemoryUserStore();
  // Password verification is not exercised here; the real freshness gate hashes
  // this distinct fixture value exactly as it hashes the stored password hash.
  const created = await users.createUser('AuditPilot', 'synthetic-stored-password-hash');
  if (!created.ok) throw new Error('fixture');
  const user = (await users.findById(created.userId))!;
  return { users, user, fingerprint: sessionFingerprint(user) };
}

function authApp(users: MemoryUserStore): FastifyInstance {
  const app = Fastify();
  cleanup.push(() => app.close());
  registerAuthApi(app, {
    users,
    signSession: production.signSession!,
    verifySession: production.verifySession!,
    scryptParams: { N: 2 ** 12, r: 8, p: 1 },
  });
  return app;
}

async function acceptedSession(token: string, users: MemoryUserStore) {
  const verified = await production.verifySession!(token);
  return verified.ok ? liveSession(verified.claim, users) : null;
}

async function game(users: MemoryUserStore, owner: string, auth = production.auth) {
  const room = createDevMatch(data);
  const server = createMultiplayerServer({
    room, auth, allowedOrigins: [origin],
    accountPwfp: (account) => currentPwfp(users, account),
    accountSeat: async (_match, account) => account === owner ? 'green' : null,
  });
  cleanup.push(() => server.close());
  return { server, room, url: await server.listen() };
}

function connect(url: string, token: string, requestOrigin = origin): Promise<number> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${url}?token=${encodeURIComponent(token)}&player=green&nick=admin`, {
      origin: requestOrigin,
      headers: { 'x-forwarded-for': '127.0.0.1', 'x-user-id': 'AuditPilot' },
    });
    const timeout = setTimeout(() => {
      ws.terminate();
      reject(new Error('handshake timed out'));
    }, 3000);
    const done = (status: number) => { clearTimeout(timeout); ws.terminate(); resolve(status); };
    ws.on('unexpected-response', (_request, response) => done(response.statusCode ?? 0));
    ws.on('message', (message) => {
      if (JSON.parse(String(message)).type === 'welcome') done(101);
    });
    ws.on('error', () => { /* HTTP refusal is observed above; other errors time out. */ });
  });
}

describe('colluding attackers: credentials crossing trust boundaries', () => {
  it('a stolen staging key cannot mint production HTTP, reset or WS credentials, even with the correct account fingerprint', async () => {
    const { users, user, fingerprint } = await identity();
    const { url } = await game(users, user.userId);
    const app = authApp(users);
    const forged = await stage.signSession!(user.userId, user.login, fingerprint);
    expect(await acceptedSession(forged, users)).toBeNull();
    expect((await app.inject({ method: 'POST', url: '/auth/refresh', headers: { authorization: `Bearer ${forged}` } })).statusCode).toBe(401);
    expect(await production.verifyReset!(await stage.signReset!(user.userId, fingerprint))).toBeNull();
    expect(await connect(url, await stage.signToken!('dev', 'green', user.userId, fingerprint))).toBe(401);
    expect(await connect(url, await production.signToken!('dev', 'green', user.userId, fingerprint))).toBe(101);
  });

  it('a production signing key without the current account fingerprint cannot impersonate that account', async () => {
    const { users, user } = await identity();
    const { url } = await game(users, user.userId);
    const forged = await production.signSession!(user.userId, user.login, 'guessed-fingerprint');
    expect(await acceptedSession(forged, users)).toBeNull();
    expect(await connect(url, await production.signToken!('dev', 'green', user.userId))).toBe(401);
    expect(await connect(url, await production.signToken!('dev', 'green', user.userId, 'guessed-fingerprint'))).toBe(401);
  });

  it('a valid stolen join token is replayable, but cannot change its seat or bypass a denied browser origin', async () => {
    const { users, user, fingerprint } = await identity();
    const { url } = await game(users, user.userId);
    const stolen = await production.signToken!('dev', 'green', user.userId, fingerprint);
    expect(await connect(url, stolen)).toBe(101);
    expect(await connect(url, stolen, 'https://attacker.audit.invalid')).toBe(403);
    const wrongSeat = await production.signToken!('dev', 'red', user.userId, fingerprint);
    expect(await connect(url, wrongSeat)).toBe(403);
  });

  it('logout kills the accomplice socket and both the copied and refreshed bearer tokens', async () => {
    const { users, user, fingerprint } = await identity();
    const { url, room } = await game(users, user.userId);
    const app = Fastify();
    cleanup.push(() => app.close());
    registerAuthApi(app, {
      users, signSession: production.signSession!, verifySession: production.verifySession!,
      onSessionsRevoked: (account) => { room.evictAccount(account, 'E_SESSION_REVOKED'); },
      scryptParams: { N: 2 ** 12, r: 8, p: 1 },
    });
    const session = await production.signSession!(user.userId, user.login, fingerprint);
    const stolenJoin = await production.signToken!('dev', 'green', user.userId, fingerprint);
    const ws = new WebSocket(`${url}?token=${encodeURIComponent(stolenJoin)}`, { origin });
    cleanup.push(async () => { ws.terminate(); });
    await once(ws, 'message');
    const renewed = await app.inject({ method: 'POST', url: '/auth/refresh', headers: { authorization: `Bearer ${session}` } });
    expect(renewed.statusCode).toBe(200);
    const refreshed = renewed.json<{ token: string }>().token;
    expect(await acceptedSession(refreshed, users)).not.toBeNull();
    const closed = once(ws, 'close');
    expect((await app.inject({ method: 'POST', url: '/auth/logout', headers: { authorization: `Bearer ${session}` } })).statusCode).toBe(204);
    await closed;
    for (const token of [session, refreshed]) {
      expect(await acceptedSession(token, users)).toBeNull();
      expect((await app.inject({ method: 'POST', url: '/auth/refresh', headers: { authorization: `Bearer ${token}` } })).statusCode).toBe(401);
    }
    expect(await connect(url, stolenJoin)).toBe(401);
  });

  it('logout alone cannot contain an insider retaining the signing key AND current database access; key replacement rejects their next forgery', async () => {
    const { users, user, fingerprint } = await identity();
    const copied = await production.signSession!(user.userId, user.login, fingerprint);
    await users.revokeSessions(user.userId);
    expect(await acceptedSession(copied, users)).toBeNull();
    const current = (await users.findById(user.userId))!;
    const forged = await production.signSession!(user.userId, user.login, sessionFingerprint(current));
    expect(await acceptedSession(forged, users)).not.toBeNull();
    const rotated = configFromEnv({ AUTH_JWT_SECRET: 'synthetic-replacement-key-for-collusion-audit' });
    expect((await rotated.verifySession!(forged)).ok).toBe(false);
    const { url } = await game(users, user.userId, rotated.auth);
    const forgedJoin = await production.signToken!('dev', 'green', user.userId, sessionFingerprint(current));
    expect(await connect(url, forgedJoin)).toBe(401);
    expect(await connect(url, await rotated.signToken!('dev', 'green', user.userId, sessionFingerprint(current)))).toBe(101);
  });

  it('monitoring credentials cannot become a game session or borrow another environment through forwarded loopback headers', async () => {
    const mainToken = 'synthetic-main-monitoring-token-for-audit';
    const stageToken = 'synthetic-stage-monitoring-token-for-audit';
    const req = { remoteAddress: '172.20.0.3', headers: { 'x-forwarded-for': '127.0.0.1', authorization: `Bearer ${stageToken}` } };
    expect(isOperatorRequest(req, mainToken)).toBe(false);
    expect(isOperatorRequest({ ...req, headers: { 'x-forwarded-for': '127.0.0.1' } }, mainToken)).toBe(false);
    expect(isOperatorRequest({ ...req, headers: { authorization: `Bearer ${mainToken}` } }, mainToken)).toBe(true);
    expect((await production.verifySession!(mainToken)).ok).toBe(false);
    expect((await production.verifySession!(stageToken)).ok).toBe(false);
  });
});
