import { describe, expect, it, afterEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { decodeJwt } from 'jose';
import {
  registerAuthApi,
  liveSession,
  pwFingerprint,
  authRateFromEnv,
  SESSION_REAUTH_SEC,
  type RecoveryMail,
} from './authApi';
import {
  signSessionToken,
  verifySessionToken,
  signResetToken,
  verifyResetToken,
  hmacSecret,
} from './auth';
import { MemoryUserStore } from './store';
import { registerMatchApi, type MatchApiDeps } from './matchApi';
import { hashPassword, verifyPassword, passwordWork, type ScryptParams } from './password';

// SE-1.x — the login+password HTTP API: registration, login, uniform failures,
// rate limiting, and the session gate on the match API.

const FAST: ScryptParams = { N: 2 ** 12, r: 8, p: 1 };
const KEY = hmacSecret('test-secret');
const SIGN = { key: KEY, algorithm: 'HS256', issuer: 'test', audience: 'session' };
const VERIFY = { key: KEY, algorithms: ['HS256'], issuer: 'test', audience: 'session' };

let app: FastifyInstance | null = null;
afterEach(async () => {
  await app?.close();
  app = null;
});

interface AuthAppOptions {
  scryptParams?: ScryptParams;
  users?: MemoryUserStore;
  now?: () => number;
  rateMax?: number;
  rateWindowMs?: number;
  onRegistered?: (accountId: string, login: string) => Promise<void>;
  onPasswordChanged?: (accountId: string) => Promise<void>;
}

function authApp(options: AuthAppOptions = {}): FastifyInstance {
  app = Fastify();
  registerAuthApi(app, {
    users: new MemoryUserStore(),
    signSession: (accountId, login, pwfp) =>
      signSessionToken({ accountId, login, pwfp }, SIGN, { ttlSeconds: 3600 }),
    scryptParams: FAST,
    ...options,
  });
  return app;
}

const post = (
  server: FastifyInstance,
  url: string,
  body: unknown,
): Promise<{ statusCode: number; json(): unknown }> =>
  server.inject({ method: 'POST', url, payload: body as object });

describe('SE-1.x · /auth/register + /auth/login', () => {
  it('gradually rehashes a verified legacy password and issues a session for the committed hash', async () => {
    const users = new MemoryUserStore();
    const before = await hashPassword('legacy orbit signal', FAST);
    const created = await users.createUser('UpgradePilot', before);
    if (!created.ok) throw new Error('fixture');
    const revoked = vi.fn(async () => {});
    const server = authApp({ users, scryptParams: { ...FAST, p: 3 }, onPasswordChanged: revoked });
    const response = await post(server, '/auth/login', { login: 'UpgradePilot', password: 'legacy orbit signal' });
    expect(response.statusCode).toBe(200);
    const current = await users.findById(created.userId);
    expect(current?.passHash).toMatch(/^scrypt\$4096\$8\$3\$/);
    expect(await verifyPassword('legacy orbit signal', current!.passHash)).toBe(true);
    const verified = await verifySessionToken((response.json() as { token: string }).token, VERIFY);
    expect(verified.ok && verified.claim.pwfp).toBe(pwFingerprint(current!.passHash));
    expect(verified.ok && verified.claim.pwfp).not.toBe(pwFingerprint(before));
    expect(revoked).toHaveBeenCalledExactlyOnceWith(created.userId);
  });

  it.each(['reset', 'deletion', 'logout'] as const)('rehash cannot restore credentials overtaken by %s', async (change) => {
    const users = new MemoryUserStore();
    const before = await hashPassword('legacy orbit signal', FAST);
    const reset = await hashPassword('a different password', FAST);
    const created = await users.createUser('RacePilot', before);
    if (!created.ok) throw new Error('fixture');
    const cas = users.setPasswordIfCurrent.bind(users);
    users.setPasswordIfCurrent = async (...args) => {
      if (change === 'reset') await users.setPassword(created.userId, reset);
      else if (change === 'logout') await users.revokeSessions(created.userId);
      else await users.requestDeletion({ ...(await users.findById(created.userId))! });
      return cas(...args);
    };
    const server = authApp({ users, scryptParams: { ...FAST, p: 3 } });
    const response = await post(server, '/auth/login', { login: 'RacePilot', password: 'legacy orbit signal' });
    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: 'E_AUTH' });
    if (change === 'reset') expect((await users.findById(created.userId))?.passHash).toBe(reset);
    if (change === 'deletion') expect(await users.findById(created.userId)).toBeNull();
    if (change === 'logout') expect((await users.findById(created.userId))?.sessionNonce).toBeTruthy();
  });

  it.each(['reset', 'logout'] as const)('an already-current hash cannot mint a session across concurrent %s', async (change) => {
    const users = new MemoryUserStore();
    const before = await hashPassword('current orbit signal', FAST);
    const reset = await hashPassword('a different password', FAST);
    const created = await users.createUser('CurrentPilot', before);
    if (!created.ok) throw new Error('fixture');
    const findById = users.findById.bind(users);
    users.findById = async (id) => {
      if (change === 'reset') await users.setPassword(id, reset);
      else await users.revokeSessions(id);
      return findById(id);
    };
    const server = authApp({ users });
    const response = await post(server, '/auth/login', { login: 'CurrentPilot', password: 'current orbit signal' });
    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: 'E_AUTH' });
  });

  it('shares a bounded KDF budget across callers and refuses overload uniformly', async () => {
    const users = new MemoryUserStore();
    await users.createUser('BusyPilot', await hashPassword('busy orbit signal', FAST));
    const server = authApp({ users });
    // Complete the startup decoy AND its first verification before taking slots.
    expect((await post(server, '/auth/login', { login: 'unknown-pilot', password: 'busy orbit signal' })).statusCode).toBe(401);
    let release!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    const admitted = Array.from({ length: 18 }, () => passwordWork.run(() => held));
    try {
      for (const [url, login] of [['/auth/login', 'BusyPilot'], ['/auth/login', 'unknown-pilot'], ['/auth/register', 'BrandNewPilot']]) {
        const response = await post(server, url!, { login, password: 'busy orbit signal' });
        expect(response.statusCode).toBe(503);
        expect(response.json()).toEqual({ error: 'E_AUTH_BUSY' });
      }
    } finally {
      release();
      await Promise.allSettled(admitted);
    }
    expect((await post(server, '/auth/login', { login: 'BusyPilot', password: 'busy orbit signal' })).statusCode).toBe(200);
  });

  it('retries a decoy whose initial warming was refused by saturation', async () => {
    let release!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    const admitted = Array.from({ length: 18 }, () => passwordWork.run(() => held));
    const server = authApp();
    try {
      const response = await post(server, '/auth/login', { login: 'unknown-pilot', password: 'busy orbit signal' });
      expect(response.statusCode).toBe(503);
      expect(response.json()).toEqual({ error: 'E_AUTH_BUSY' });
    } finally {
      release();
      await Promise.allSettled(admitted);
    }
    const recovered = await post(server, '/auth/login', { login: 'unknown-pilot', password: 'busy orbit signal' });
    expect(recovered.statusCode).toBe(401);
    expect(recovered.json()).toEqual({ error: 'E_AUTH' });
  });

  it('enforces new-password rules server-side without rewriting accepted secrets', async () => {
    const users = new MemoryUserStore();
    const server = authApp({ users });
    for (const password of ['old-pass', '123456789012', 'Password123456!', 'x'.repeat(12), ' '.repeat(11) + 'a', 'valid secret\u202Einput']) {
      const r = await post(server, '/auth/register', { login: 'newpilot', password });
      expect(r.statusCode).toBe(400);
      expect(r.json()).toEqual({ error: 'E_PASSWORD_POLICY' });
      expect(await users.findUser('newpilot')).toBeNull();
    }
    const password = '  orbit signal  ';
    expect((await post(server, '/auth/register', { login: 'newpilot', password })).statusCode).toBe(201);
    expect((await post(server, '/auth/login', { login: 'newpilot', password })).statusCode).toBe(200);
    expect((await post(server, '/auth/login', { login: 'newpilot', password: password.trim() })).statusCode).toBe(401);
  });

  it('allows an existing account to log in with its original legacy password', async () => {
    const users = new MemoryUserStore();
    const hash = await hashPassword('old-pass', FAST);
    await users.createUser('legacy', hash);
    await users.createUser('Идиот', hash);
    const server = authApp({ users });
    for (const login of ['LEGACY', 'Идиот']) {
      expect((await post(server, '/auth/login', { login, password: 'old-pass' })).statusCode).toBe(200);
      for (const password of ['bad-pass', 'orbit-signal']) {
        expect((await post(server, '/auth/login', { login, password })).statusCode).toBe(401);
        const fallback = await post(server, '/auth/register', { login, password });
        expect(fallback.statusCode).toBe(409);
        expect(fallback.json()).toEqual({ error: 'E_LOGIN_TAKEN' });
      }
    }
  });

  it('does not consume a reset link on a weak password and revokes it after a valid reset', async () => {
    const users = new MemoryUserStore();
    const hash = await hashPassword('legacy88', FAST);
    const created = await users.createUser('oldpilot', hash);
    if (!created.ok) throw new Error('fixture');
    app = Fastify();
    registerAuthApi(app, {
      users, scryptParams: FAST, signSession: async () => 'session',
      signReset: async () => 'reset-one',
      verifyReset: async (token) => token === 'reset-one'
        ? { accountId: created.userId, pwfp: pwFingerprint(hash) } : null,
      resetBaseUrl: 'https://play.example', sendRecoveryMail: async () => {},
    });
    const weak = await post(app, '/auth/reset', { token: 'reset-one', password: 'Password123456!' });
    expect(weak.statusCode).toBe(400);
    expect(weak.json()).toEqual({ error: 'E_PASSWORD_POLICY' });
    expect((await users.findById(created.userId))?.passHash).toBe(hash);
    const body = { token: 'reset-one', password: 'a quiet orbit above the moon' };
    expect((await post(app, '/auth/reset', body)).statusCode).toBe(200);
    expect((await post(app, '/auth/reset', body)).statusCode).toBe(401);
  });

  it('rejects offensive nicknames and obfuscated variants before account creation', async () => {
    const users = new MemoryUserStore();
    const server = authApp({ users });
    for (const login of ['Идиот42', 'Идиот١', 'ИдиотⅨ', 'mуdаk', 'f_u_c_k', 'sh1t𐒠', 'sh1t']) {
      const r = await post(server, '/auth/register', { login, password: 'orbit-signal' });
      expect(r.statusCode).toBe(400);
      expect(r.json()).toEqual({ error: 'E_NICKNAME_BLOCKED' });
      expect(await users.findUser(login)).toBeNull();
    }
    expect((await post(server, '/auth/register', { login: 'Assassin', password: 'orbit-signal' })).statusCode).toBe(201);
  });

  it('refuses extra fields, arrays, injected email and oversized request bodies', async () => {
    const server = authApp();
    for (const extra of [{ role: 'admin' }, { email: '<img>@example.com' }, { email: 'a@x.com\r\nBcc:b@x.com' }]) {
      const r = await post(server, '/auth/register', { login: 'safeuser', password: 'orbit-signal', ...extra });
      expect(r.statusCode).toBe(400);
      expect(r.json()).toEqual({ error: 'E_BAD_CREDENTIALS' });
    }
    expect((await post(server, '/auth/register', [])).statusCode).toBe(400);
    expect((await post(server, '/auth/register', { login: 'safeuser', password: 'x'.repeat(5000) })).statusCode).toBe(413);
  });

  it('registers an account and returns a working session token', async () => {
    const server = authApp();
    const r = await post(server, '/auth/register', { login: 'Vasya', password: 'orbit-longenough' });
    expect(r.statusCode).toBe(201);
    const body = r.json() as { accountId: string; login: string; token: string };
    expect(body.login).toBe('Vasya');
    expect(body.accountId).not.toBe('');
    const verified = await verifySessionToken(body.token, VERIFY);
    expect(verified.ok).toBe(true);
    if (verified.ok) {
      expect(verified.claim.accountId).toBe(body.accountId);
      expect(verified.claim.login).toBe('Vasya');
      expect(verified.claim.pwfp).not.toBe(''); // stamped with the password fingerprint
    }
  });

  it('logs in with the right password; rejects a wrong one and an unknown login UNIFORMLY', async () => {
    const server = authApp();
    await post(server, '/auth/register', { login: 'alice', password: 'orbit-password-1' });

    const ok = await post(server, '/auth/login', { login: 'alice', password: 'orbit-password-1' });
    expect(ok.statusCode).toBe(200);
    expect((ok.json() as { login: string }).login).toBe('alice');

    const wrongPw = await post(server, '/auth/login', { login: 'alice', password: 'orbit-password-2' });
    const noUser = await post(server, '/auth/login', { login: 'nobody99', password: 'orbit-password-1' });
    // The SAME status and the SAME body — account existence does not leak.
    expect(wrongPw.statusCode).toBe(401);
    expect(noUser.statusCode).toBe(401);
    expect(wrongPw.json()).toEqual({ error: 'E_AUTH' });
    expect(noUser.json()).toEqual({ error: 'E_AUTH' });
  });

  it('login lookup is case-insensitive and keeps the registered display form', async () => {
    const server = authApp();
    await post(server, '/auth/register', { login: 'Vasya', password: 'orbit-longenough' });
    const dup = await post(server, '/auth/register', { login: 'vasya', password: 'orbit-longenough' });
    expect(dup.statusCode).toBe(409);
    expect(dup.json()).toEqual({ error: 'E_LOGIN_TAKEN' });

    const r = await post(server, '/auth/login', { login: 'VASYA', password: 'orbit-longenough' });
    expect(r.statusCode).toBe(200);
    expect((r.json() as { login: string }).login).toBe('Vasya'); // display form preserved
  });

  it('accepts the suggested cyrillic callsigns («Носорог-1») — the welcome golden path', async () => {
    const server = authApp();
    const r = await post(server, '/auth/register', { login: 'Носорог-1', password: 'orbit-longenough' });
    expect(r.statusCode).toBe(201);
    expect((r.json() as { login: string }).login).toBe('Носорог-1');
    // …and unicode dedup stays case-insensitive
    const dup = await post(server, '/auth/register', { login: 'носорог-1', password: 'orbit-longenough' });
    expect(dup.statusCode).toBe(409);
    const ok = await post(server, '/auth/login', { login: 'НОСОРОГ-1', password: 'orbit-longenough' });
    expect(ok.statusCode).toBe(200);
    // spaces/emoji are still out — \p{L}\p{N}_- only
    const emoji = await post(server, '/auth/register', { login: 'зая🔥', password: 'orbit-longenough' });
    expect(emoji.statusCode).toBe(400);
  });

  it('rejects malformed credentials with one stable code (no field-level detail)', async () => {
    const server = authApp();
    for (const bad of [
      { login: 'ok_login', password: 'short' }, // < 8 chars
      { login: 'ok_login', password: 'x'.repeat(129) }, // > 128 chars
      { login: 'no', password: 'orbit-longenough' }, // login too short
      { login: 'bad name!', password: 'orbit-longenough' }, // forbidden chars
      { login: 'ok_login' }, // missing password
      {}, // missing everything
    ]) {
      const r = await post(server, '/auth/register', bad);
      expect(r.statusCode).toBe(400);
      expect(r.json()).toEqual({ error: 'E_BAD_CREDENTIALS' });
    }
    // A JSON body that isn't an object at all (same stable code)…
    const str = await server.inject({
      method: 'POST',
      url: '/auth/register',
      payload: '"not an object"',
      headers: { 'content-type': 'application/json' },
    });
    expect(str.statusCode).toBe(400);
    expect(str.json()).toEqual({ error: 'E_BAD_CREDENTIALS' });
    // …and a non-JSON body never reaches the route as credentials — Fastify's
    // content-type/JSON parsing refuses it with a 4xx (415 or 400 by version).
    const text = await server.inject({
      method: 'POST',
      url: '/auth/register',
      payload: 'login=x&password=y',
      headers: { 'content-type': 'text/plain' },
    });
    expect(text.statusCode).toBeGreaterThanOrEqual(400);
    expect(text.statusCode).toBeLessThan(500);
  });

  it('rate-limits per IP across register+login, and the window resets', async () => {
    let clock = 1_000;
    const server = authApp({ now: () => clock, rateMax: 3, rateWindowMs: 60_000 });
    const creds = { login: 'busy_bee', password: 'orbit-longenough' };
    await post(server, '/auth/register', creds);
    await post(server, '/auth/login', creds);
    await post(server, '/auth/login', creds);
    const throttled = await post(server, '/auth/login', creds);
    expect(throttled.statusCode).toBe(429);
    expect(throttled.json()).toEqual({ error: 'E_RATE_LIMIT' });

    clock += 60_001; // backoff past the window → attempts admit again
    const after = await post(server, '/auth/login', creds);
    expect(after.statusCode).toBe(200);
  });

  // Регрессия живого прогона: на прежнем потолке (10) пятый по счёту НОВЫЙ игрок с
  // общего адреса получал 429 — первый вход стоит двух запросов (вход, потом
  // регистрация), а весь плейтест сидит за одним NAT. Тест держит именно то число,
  // ради которого потолок поднимали: целая партия успевает зарегистрироваться.
  it('admits a whole lobby registering at once from one address (default budget)', async () => {
    const server = authApp();
    for (let i = 0; i < 10; i += 1) {
      const creds = { login: `recruit_${i}`, password: 'orbit-longenough' };
      // Ровно клиентский порядок: сперва вход (уйдёт в 401 — оракула «есть ли логин»
      // на сервере нет), затем регистрация.
      const login = await post(server, '/auth/login', creds);
      expect(login.statusCode, `игрок ${i}: вход`).toBe(401);
      const reg = await post(server, '/auth/register', creds);
      expect(reg.statusCode, `игрок ${i}: регистрация`).toBe(201);
    }
  });

  it('takes the budget from the environment, and a broken value keeps the default', () => {
    expect(authRateFromEnv({ AUTH_RATE_MAX: '5', AUTH_RATE_WINDOW_MS: '1000' })).toEqual({
      rateMax: 5,
      rateWindowMs: 1000,
    });
    // Опечатка в env НЕ снимает тормоз: неразобранное значение = «дефолт», а не
    // «без лимита» (fail-secure).
    expect(authRateFromEnv({ AUTH_RATE_MAX: 'many', AUTH_RATE_WINDOW_MS: '0' })).toEqual({});
    expect(authRateFromEnv({})).toEqual({});
    expect(authRateFromEnv({ AUTH_RATE_MAX: '-1' })).toEqual({});
  });

  it('honours an env-tightened budget end to end', async () => {
    const server = authApp(authRateFromEnv({ AUTH_RATE_MAX: '2' }));
    const creds = { login: 'busy_bee', password: 'orbit-longenough' };
    await post(server, '/auth/register', creds);
    await post(server, '/auth/login', creds);
    expect((await post(server, '/auth/login', creds)).statusCode).toBe(429);
  });

  it('calls onRegistered once per successful registration (ARS-2 starter hook)', async () => {
    const registered: string[] = [];
    const server = authApp({
      onRegistered: (accountId) => {
        registered.push(accountId);
        return Promise.resolve();
      },
    });
    const r = await post(server, '/auth/register', { login: 'fresh', password: 'orbit-longenough' });
    const body = r.json() as { accountId: string };
    expect(registered).toEqual([body.accountId]);
    // a duplicate login fails registration → the hook does not fire again
    await post(server, '/auth/register', { login: 'fresh', password: 'orbit-longenough' });
    expect(registered).toHaveLength(1);
  });

  it('a throwing onRegistered never fails the registration itself', async () => {
    const server = authApp({
      onRegistered: () => Promise.reject(new Error('store down')),
    });
    const r = await post(server, '/auth/register', { login: 'lucky', password: 'orbit-longenough' });
    expect(r.statusCode).toBe(201); // the account exists; the idempotent hook re-runs out of band
    expect((r.json() as { login: string }).login).toBe('lucky');
  });
});

describe('SE-1.x · session gate on the match API', () => {
  function gatedApp(): {
    server: FastifyInstance;
    users: MemoryUserStore;
    joins: Parameters<MatchApiDeps['join']>[1][];
  } {
    const users = new MemoryUserStore();
    const joins: Parameters<MatchApiDeps['join']>[1][] = [];
    app = Fastify();
    registerAuthApi(app, {
      users,
      signSession: (accountId, login, pwfp) =>
        signSessionToken({ accountId, login, pwfp }, SIGN, { ttlSeconds: 3600 }),
      scryptParams: FAST,
    });
    const deps: MatchApiDeps = {
      createMatch: () => Promise.resolve({ matchId: 'm1', seats: ['green', 'red'] }),
      join: (matchId, req) => {
        joins.push(req);
        return Promise.resolve({
          playerId: 'green',
          token: `join:${matchId}:${req.nick}:${req.accountId}`,
        });
      },
      // Mirrors production (main.ts / netserver.ts): signature verify THEN a live re-check
      // against the current password, so a reset revokes older sessions at the seat gate.
      identify: async (request) => {
        const header = request.headers.authorization;
        if (typeof header !== 'string' || !header.startsWith('Bearer ')) return null;
        const v = await verifySessionToken(header.slice(7), VERIFY);
        return v.ok ? liveSession(v.claim, users) : null;
      },
    };
    registerMatchApi(app, deps);
    return { server: app, users, joins };
  }

  it('join hands the session password fingerprint to the token minting (pwfp binding)', async () => {
    const { server, users, joins } = gatedApp();
    const reg = await post(server, '/auth/register', { login: 'dave', password: 'orbit-longenough' });
    const { token } = reg.json() as { token: string };
    await server.inject({
      method: 'GET',
      url: '/matches/m1/join',
      headers: { authorization: `Bearer ${token}` },
    });
    const user = await users.findUser('dave');
    expect(joins.at(-1)?.pwfp).toBe(pwFingerprint(user!.passHash));
  });

  it('join requires a session; the seat goes to the SESSION login, not a query nick', async () => {
    const { server } = gatedApp();
    const reg = await post(server, '/auth/register', { login: 'bob', password: 'orbit-longenough' });
    const { token, accountId } = reg.json() as { token: string; accountId: string };

    // No session → 401; a ?nick= cannot substitute for identity.
    const anon = await server.inject({ method: 'GET', url: '/matches/m1/join?nick=mallory' });
    expect(anon.statusCode).toBe(401);
    expect(anon.json()).toEqual({ error: 'E_AUTH' });

    // With a session, the nick IS the account login (query nick ignored).
    const joined = await server.inject({
      method: 'GET',
      url: '/matches/m1/join?nick=mallory',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(joined.statusCode).toBe(200);
    expect((joined.json() as { token: string }).token).toBe(`join:m1:bob:${accountId}`);
  });

  it('create requires a session too; garbage bearer tokens are rejected', async () => {
    const { server } = gatedApp();
    const anon = await server.inject({ method: 'POST', url: '/matches' });
    expect(anon.statusCode).toBe(401);
    const forged = await server.inject({
      method: 'POST',
      url: '/matches',
      headers: { authorization: 'Bearer not-a-jwt' },
    });
    expect(forged.statusCode).toBe(401);

    const reg = await post(server, '/auth/register', { login: 'creator', password: 'orbit-longenough' });
    const { token } = reg.json() as { token: string };
    const created = await server.inject({
      method: 'POST',
      url: '/matches',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(created.statusCode).toBe(200);
    expect(created.json()).toEqual({ matchId: 'm1', seats: ['green', 'red'] });
  });

  it('a password change revokes older sessions at the seat gate (pwfp freshness)', async () => {
    const { server, users } = gatedApp();
    const reg = await post(server, '/auth/register', { login: 'carol', password: 'orbit-longenough' });
    const { token, accountId } = reg.json() as { token: string; accountId: string };

    // The fresh session joins fine — its stamped fingerprint matches the stored hash.
    const before = await server.inject({
      method: 'GET',
      url: '/matches/m1/join',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(before.statusCode).toBe(200);

    // The password changes (a reset) → the OLD session, stamped with the pre-change
    // fingerprint, is revoked even though its JWT is still valid.
    await users.setPassword(accountId, 'a-different-hash');
    const after = await server.inject({
      method: 'GET',
      url: '/matches/m1/join',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(after.statusCode).toBe(401);
    expect(after.json()).toEqual({ error: 'E_AUTH' });
  });
});

describe('SE-1.x · password recovery (/auth/recover + /auth/reset)', () => {
  const RESET_SIGN = { key: KEY, algorithm: 'HS256', issuer: 'test', audience: 'reset' };
  const RESET_VERIFY = { key: KEY, algorithms: ['HS256'], issuer: 'test', audience: 'reset' };

  /** An auth app with recovery wired + a capturing mailer (the reset link never leaves the
   *  test). Mirrors the serverConfig composition: same key, a distinct `reset` audience. */
  function recoverApp(
    resetBaseUrl = 'https://play.example',
    rate: { rateMax?: number; rateWindowMs?: number; recoveryCooldownMs?: number } = {},
    delivery?: () => Promise<void>,
  ): {
    server: FastifyInstance;
    sent: RecoveryMail[];
    users: MemoryUserStore;
  } {
    const sent: RecoveryMail[] = [];
    const users = new MemoryUserStore();
    app = Fastify();
    registerAuthApi(app, {
      users,
      signSession: (accountId, login, pwfp) =>
        signSessionToken({ accountId, login, pwfp }, SIGN, { ttlSeconds: 3600 }),
      verifySession: (token) => verifySessionToken(token, VERIFY),
      signReset: (accountId, pwfp) =>
        signResetToken({ accountId, pwfp }, RESET_SIGN, { ttlSeconds: 900 }),
      verifyReset: async (token) => {
        const r = await verifyResetToken(token, RESET_VERIFY);
        return r.ok ? r.claim : null;
      },
      resetBaseUrl,
      sendRecoveryMail: (msg) => {
        sent.push(msg);
        return delivery?.() ?? Promise.resolve();
      },
      scryptParams: FAST,
      ...rate,
    });
    return { server: app, sent, users };
  }

  // КОМПЕНСАЦИЯ ЗА ПОДАВЛЕННЫЙ CodeQL-запрос `js/missing-rate-limiting`.
  //
  // Запрос ищет ИЗВЕСТНЫЕ ему middleware и, не найдя, объявляет роут незащищённым —
  // наш `slidingWindowIpLimiter` он опознать не может, поэтому все его срабатывания
  // здесь ложные, и он исключён в `.github/codeql/codeql-config.yml`. Исключение
  // выключает запрос ЦЕЛИКОМ, то есть новый auth-роут без лимита CodeQL уже не поймает.
  // Ловит этот тест — и ловит строже: он проверяет ПОВЕДЕНИЕ (пришёл ли 429), а не
  // присутствие известного пакета.
  //
  // Существующий тест выше покрывает только register+login; recover и reset до сих пор
  // не проверялись на лимит вообще. Заводишь новый `/auth/*` — допиши строку в таблицу.
  it('лимитирует КАЖДЫЙ auth-роут (компенсация за подавленный js/missing-rate-limiting)', async () => {
    const ROUTES: Array<{ url: string; body: unknown }> = [
      { url: '/auth/register', body: { login: 'limit_probe', password: 'orbit-longenough' } },
      { url: '/auth/login', body: { login: 'limit_probe', password: 'orbit-longenough' } },
      { url: '/auth/recover', body: { email: 'limit_probe@example.com' } },
      { url: '/auth/reset', body: { token: 'irrelevant', password: 'orbit-longenough' } },
      { url: '/auth/refresh', body: undefined },
    ];
    for (const route of ROUTES) {
      // Своя копия приложения на каждый роут: лимитер общий на IP, и без этого первый
      // же роут сжёг бы квоту за остальных, а тест бы «прошёл», ничего не проверив.
      const { server } = recoverApp('https://play.example', { rateMax: 1, rateWindowMs: 60_000 });
      await post(server, route.url, route.body); // сжигаем единственную попытку
      const throttled = await post(server, route.url, route.body);
      expect(throttled.statusCode, `${route.url} не ответил 429 на исчерпанном лимите`).toBe(429);
      expect(throttled.json()).toEqual({ error: 'E_RATE_LIMIT' });
      await server.close();
    }
  });

  const tokenFrom = (text: string): string => decodeURIComponent(text.match(/\?reset=(\S+)/)![1]!);

  it('answers recovery before a stalled SMTP send finishes, including an unknown address', async () => {
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    const { server, sent } = recoverApp('https://play.example', {}, () => blocked);
    await post(server, '/auth/register', { login: 'timing', password: 'orbit-longenough', email: 'timing@example.com' });
    let status: number | undefined;
    const response = post(server, '/auth/recover', { email: 'timing@example.com' }).then((r) => {
      status = r.statusCode;
      return r;
    });
    try {
      await vi.waitFor(() => expect(sent).toHaveLength(1));
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(status).toBe(200); // The SMTP promise is deliberately still unresolved.
      const unknown = await post(server, '/auth/recover', { email: 'missing@example.com' });
      expect(unknown.statusCode).toBe(200);
      expect(unknown.json()).toEqual((await response).json());
    } finally {
      release();
      await response;
    }
  });

  it('bounds recovery backlog during a delivery outage and continues after a failed send', async () => {
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    let attempts = 0;
    const { server, sent } = recoverApp('https://play.example', { rateMax: 200, recoveryCooldownMs: 0 }, async () => {
      if (++attempts === 1) {
        await blocked;
        throw new Error('synthetic SMTP outage');
      }
    });
    await post(server, '/auth/register', { login: 'queue', password: 'orbit-longenough', email: 'queue@example.com' });
    try {
      await post(server, '/auth/recover', { email: 'queue@example.com' });
      await vi.waitFor(() => expect(sent).toHaveLength(1));
      const replies = await Promise.all(Array.from({ length: 70 }, () =>
        post(server, '/auth/recover', { email: 'queue@example.com' })));
      for (const r of replies) {
        expect(r.statusCode).toBe(200);
        expect(r.json()).toEqual({ ok: true });
      }
      expect(sent).toHaveLength(1); // At most one active SMTP send.
      release();
      await vi.waitFor(() => expect(sent).toHaveLength(65)); // One active + 64 waiting.
    } finally {
      release();
    }
  });

  it('registers with an email, recovers via the mailed link, and sets a new password', async () => {
    const { server, sent } = recoverApp();
    await post(server, '/auth/register', {
      login: 'zoe',
      password: 'orbit-oldpassword',
      email: 'zoe@example.com',
    });

    const rec = await post(server, '/auth/recover', { email: 'zoe@example.com' });
    await vi.waitFor(() => expect(sent).toHaveLength(1));
    expect(rec.statusCode).toBe(200);
    expect(rec.json()).toEqual({ ok: true });
    expect(sent).toHaveLength(1);
    expect(sent[0]!.to).toBe('zoe@example.com');
    const token = tokenFrom(sent[0]!.params.link);

    const reset = await post(server, '/auth/reset', { token, password: 'brandnewpass' });
    expect(reset.statusCode).toBe(200);
    expect((reset.json() as { login: string }).login).toBe('zoe');

    // The new password works; the old one is dead.
    expect(
      (await post(server, '/auth/login', { login: 'zoe', password: 'brandnewpass' })).statusCode,
    ).toBe(200);
    expect(
      (await post(server, '/auth/login', { login: 'zoe', password: 'orbit-oldpassword' })).statusCode,
    ).toBe(401);
  });

  it('two concurrent resets spend the token once and only the winning password works', async () => {
    const { server, sent, users } = recoverApp();
    await post(server, '/auth/register', { login: 'race', password: 'original-pass', email: 'race@example.com' });
    await post(server, '/auth/recover', { email: 'race@example.com' });
    await vi.waitFor(() => expect(sent).toHaveLength(1));
    // Force both requests past the initial read, including a store that returns live records.
    const find = users.findById.bind(users);
    let release!: () => void;
    const barrier = new Promise<void>((resolve) => { release = resolve; });
    let reads = 0;
    users.findById = async (id) => {
      const user = await find(id);
      if (++reads === 2) release();
      await barrier;
      return user;
    };
    const token = tokenFrom(sent[0]!.params.link);
    const passwords = ['concurrent-one', 'concurrent-two'];
    const results = await Promise.all(passwords.map((password) => post(server, '/auth/reset', { token, password })));
    expect(results.map((r) => r.statusCode).sort()).toEqual([200, 401]);
    for (let i = 0; i < passwords.length; i++) {
      expect((await post(server, '/auth/login', { login: 'race', password: passwords[i] })).statusCode)
        .toBe(results[i]!.statusCode === 200 ? 200 : 401);
    }
  });

  it('a reset token is single-use: the second reset with the same token is refused', async () => {
    const { server, sent } = recoverApp();
    await post(server, '/auth/register', {
      login: 'ana',
      password: 'orbit-firstpass1',
      email: 'ana@example.com',
    });
    await post(server, '/auth/recover', { email: 'ana@example.com' });
    await vi.waitFor(() => expect(sent).toHaveLength(1));
    const token = tokenFrom(sent[0]!.params.link);
    expect((await post(server, '/auth/reset', { token, password: 'orbit-secondpass1' })).statusCode).toBe(
      200,
    );
    // The password (and thus its fingerprint) changed → the same token no longer matches.
    const again = await post(server, '/auth/reset', { token, password: 'orbit-thirdpass12' });
    expect(again.statusCode).toBe(401);
    expect(again.json()).toEqual({ error: 'E_AUTH' });
  });

  it('passes bounded recipient metadata and a structural reset link to the host adapter', async () => {
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    const { server, sent } = recoverApp('https://play.example', { recoveryCooldownMs: 0 }, () => blocked);
    await post(server, '/auth/register', { login: 'locale', password: 'orbit-longenough', email: 'locale@example.com' });
    try {
      for (const locale of ['en', 'ru', 'unsupported', { language: 'en' }, 'x'.repeat(65)])
        await post(server, '/auth/recover', { email: 'locale@example.com', locale });
      await vi.waitFor(() => expect(sent).toHaveLength(1));
      release();
      await vi.waitFor(() => expect(sent).toHaveLength(5));
      expect(sent.map((msg) => msg.locale)).toEqual(['en', 'ru', 'unsupported', undefined, undefined]);
      for (const msg of sent) {
        expect(msg).toEqual({
          to: 'locale@example.com',
          template: 'password-reset',
          locale: msg.locale,
          params: { link: expect.stringMatching(/^https:\/\/play\.example\/\?reset=/) },
        });
        expect((await post(server, '/auth/reset', { token: tokenFrom(msg.params.link), password: 'orbit-changedpass' })).statusCode)
          .toBe(sent.indexOf(msg) === 0 ? 200 : 401);
      }
    } finally { release(); }
  });

  it('one recovery mail per account per cooldown, whatever the number of requests', async () => {
    const { server, sent } = recoverApp('https://play.example', { rateMax: 200 });
    await post(server, '/auth/register', { login: 'inbox', password: 'orbit-longenough', email: 'inbox@example.com' });
    await post(server, '/auth/register', { login: 'other', password: 'orbit-longenough', email: 'other@example.com' });
    for (let i = 0; i < 5; i++) {
      const r = await post(server, '/auth/recover', { email: 'inbox@example.com' });
      expect(r.json()).toEqual({ ok: true }); // the answer does not change: no oracle
    }
    await post(server, '/auth/recover', { email: 'other@example.com' });
    await vi.waitFor(() => expect(sent.map((m) => m.to)).toContain('other@example.com'));
    expect(sent.map((m) => m.to)).toEqual(['inbox@example.com', 'other@example.com']);
  });

  it('recover is anti-enumeration: an unknown email still 200s and sends nothing', async () => {
    const { server, sent } = recoverApp();
    const rec = await post(server, '/auth/recover', { email: 'ghost@example.com' });
    expect(rec.statusCode).toBe(200);
    expect(rec.json()).toEqual({ ok: true });
    expect(sent).toHaveLength(0);
  });

  it('an account registered WITHOUT an email has no recovery (nothing sent)', async () => {
    const { server, sent } = recoverApp();
    await post(server, '/auth/register', { login: 'noemail', password: 'orbit-longenough' });
    await post(server, '/auth/recover', { email: 'noemail@example.com' });
    expect(sent).toHaveLength(0);
  });

  it('registration does not reveal or reassign an existing recovery address', async () => {
    const { server } = recoverApp();
    await post(server, '/auth/register', {
      login: 'first',
      password: 'orbit-longenough',
      email: 'shared@example.com',
    });
    const dup = await post(server, '/auth/register', {
      login: 'second',
      password: 'orbit-longenough',
      email: 'Shared@Example.com',
    });
    expect(dup.statusCode).toBe(201);
    expect(dup.json()).toMatchObject({ login: 'second', token: expect.any(String) });
    expect(dup.json()).not.toHaveProperty('email');
    const recovery = await post(server, '/auth/recover', { email: 'shared@example.com' });
    expect(recovery.statusCode).toBe(200);
  });

  it('reset rejects a garbage/forged token uniformly (E_AUTH)', async () => {
    const { server } = recoverApp();
    const bad = await post(server, '/auth/reset', { token: 'not-a-jwt', password: 'orbit-longenough' });
    expect(bad.statusCode).toBe(401);
    expect(bad.json()).toEqual({ error: 'E_AUTH' });
  });

  it('a malformed email at registration is a 400 (not silently dropped)', async () => {
    const { server } = recoverApp();
    const r = await post(server, '/auth/register', {
      login: 'baddie',
      password: 'orbit-longenough',
      email: 'notanemail',
    });
    expect(r.statusCode).toBe(400);
    expect(r.json()).toEqual({ error: 'E_BAD_CREDENTIALS' });
  });

  it('a completed reset kills the pre-reset session but its own new session is live', async () => {
    const { server, sent, users } = recoverApp();
    const reg = await post(server, '/auth/register', {
      login: 'dan',
      password: 'orbit-oldpassword',
      email: 'dan@example.com',
    });
    const preToken = (reg.json() as { token: string }).token;
    const preClaim = await verifySessionToken(preToken, VERIFY);
    expect(preClaim.ok).toBe(true);
    // Before the reset, the registration session authenticates against the live store.
    if (preClaim.ok) expect(await liveSession(preClaim.claim, users)).not.toBeNull();

    await post(server, '/auth/recover', { email: 'dan@example.com' });
    await vi.waitFor(() => expect(sent).toHaveLength(1));
    const reset = await post(server, '/auth/reset', {
      token: tokenFrom(sent[0]!.params.link),
      password: 'brandnewpass',
    });
    const postToken = (reset.json() as { token: string }).token;

    // The pre-reset session no longer authenticates; the session the reset handed back does.
    if (preClaim.ok) expect(await liveSession(preClaim.claim, users)).toBeNull();
    const postClaim = await verifySessionToken(postToken, VERIFY);
    expect(postClaim.ok).toBe(true);
    if (postClaim.ok) expect(await liveSession(postClaim.claim, users)).not.toBeNull();
  });

  it('normalizes a resetBaseUrl with trailing slashes to a single-slash link', async () => {
    // Guards the linear trailing-slash trim that replaced `/\/+$/` (ReDoS-free):
    // the emitted link must carry exactly one '/' before '?reset=', for any run.
    const { server, sent } = recoverApp('https://play.example///');
    await post(server, '/auth/register', {
      login: 'liv',
      password: 'orbit-longenough',
      email: 'liv@example.com',
    });
    await post(server, '/auth/recover', { email: 'liv@example.com' });
    await vi.waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]!.params.link).toContain('https://play.example/?reset=');
    expect(sent[0]!.params.link).not.toContain('https://play.example//?reset=');
  });

  it('liveSession rejects a session for an unknown/deleted account', async () => {
    const users = new MemoryUserStore();
    const claim = { accountId: 'ghost', login: 'ghost', pwfp: pwFingerprint('whatever') };
    expect(await liveSession(claim, users)).toBeNull();
  });
});

describe('AC-0.2 · remember-me: /auth/refresh', () => {
  /** Mirrors the serverConfig composition: the refresh passes `authTime` through. */
  function refreshApp(users = new MemoryUserStore()): { server: FastifyInstance; users: MemoryUserStore } {
    app = Fastify();
    registerAuthApi(app, {
      users,
      signSession: (accountId, login, pwfp, authTime) =>
        signSessionToken({ accountId, login, pwfp, ...(authTime !== undefined ? { authTime } : {}) }, SIGN, {
          ttlSeconds: 3600,
        }),
      verifySession: (token) => verifySessionToken(token, VERIFY),
      scryptParams: FAST,
    });
    return { server: app, users };
  }
  const refresh = (server: FastifyInstance, token?: string, payload?: object) =>
    server.inject({
      method: 'POST',
      url: '/auth/refresh',
      ...(token ? { headers: { authorization: `Bearer ${token}` } } : {}),
      ...(payload ? { payload } : {}),
    });
  /** A session for an existing account, minted with chosen times (as if issued earlier). */
  const sessionFor = async (users: MemoryUserStore, login: string, at: { iatMs?: number; authTime?: number }) => {
    const user = (await users.findUser(login))!;
    return signSessionToken(
      { accountId: user.userId, login: user.login, pwfp: pwFingerprint(user.passHash), ...(at.authTime ? { authTime: at.authTime } : {}) },
      SIGN,
      { ttlSeconds: 3600, ...(at.iatMs ? { now: () => at.iatMs! } : {}) },
    );
  };

  it('a live session renews: later expiry, same account, fingerprint and password moment', async () => {
    const { server, users } = refreshApp();
    await post(server, '/auth/register', { login: 'remy', password: 'orbit-longenough' });
    const old = await sessionFor(users, 'remy', { iatMs: Date.now() - 600_000 });
    const response = await refresh(server, old);
    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    const body = response.json() as { accountId: string; login: string; token: string };
    const before = await verifySessionToken(old, VERIFY);
    const after = await verifySessionToken(body.token, VERIFY);
    if (!before.ok || !after.ok) throw new Error('both sessions verify');
    expect(after.claim).toEqual(before.claim);
    expect(body).toEqual({ accountId: before.claim.accountId, login: 'remy', token: body.token });
    expect(decodeJwt(body.token).exp!).toBeGreaterThan(decodeJwt(old).exp!);
    // The renewed session is a real session: it renews again.
    expect((await refresh(server, body.token)).statusCode).toBe(200);
  });

  it('never revives a session that logout or a password change killed', async () => {
    const { server, users } = refreshApp();
    const reg = await post(server, '/auth/register', { login: 'lou', password: 'orbit-longenough' });
    const { token, accountId } = reg.json() as { token: string; accountId: string };
    expect((await refresh(server, token)).statusCode).toBe(200);
    await users.setPassword(accountId, await hashPassword('another-orbit-signal', FAST));
    expect((await refresh(server, token)).json()).toEqual({ error: 'E_AUTH' });

    const login = await post(server, '/auth/login', { login: 'lou', password: 'another-orbit-signal' });
    const fresh = (login.json() as { token: string }).token;
    const renewed = (await refresh(server, fresh)).json() as { token: string };
    expect((await server.inject({ method: 'POST', url: '/auth/logout', headers: { authorization: `Bearer ${fresh}` } })).statusCode).toBe(204);
    for (const dead of [fresh, renewed.token]) {
      const response = await refresh(server, dead);
      expect(response.statusCode).toBe(401);
      expect(response.json()).toEqual({ error: 'E_AUTH' });
    }
  });

  it('stops renewing once the password entry is SESSION_REAUTH_SEC old', async () => {
    const { server, users } = refreshApp();
    await post(server, '/auth/register', { login: 'ria', password: 'orbit-longenough' });
    const nowSec = Math.floor(Date.now() / 1000);
    const nearly = await sessionFor(users, 'ria', { authTime: nowSec - SESSION_REAUTH_SEC + 60 });
    const renewed = await refresh(server, nearly);
    expect(renewed.statusCode).toBe(200);
    expect(decodeJwt((renewed.json() as { token: string }).token).auth_time).toBe(nowSec - SESSION_REAUTH_SEC + 60);
    const stale = await sessionFor(users, 'ria', { authTime: nowSec - SESSION_REAUTH_SEC });
    const refused = await refresh(server, stale);
    expect(refused.statusCode).toBe(401);
    expect(refused.json()).toEqual({ error: 'E_AUTH' });
  });

  it('refuses a missing or forged bearer and any body', async () => {
    const { server } = refreshApp();
    const reg = await post(server, '/auth/register', { login: 'fay', password: 'orbit-longenough' });
    const { token } = reg.json() as { token: string };
    expect((await refresh(server)).statusCode).toBe(401);
    expect((await refresh(server, 'garbage')).statusCode).toBe(401);
    // Flip the signature's first character: its last one carries only 4 of 6 bits, so an
    // edit at the tail could decode to the same signature and pass.
    const [head, body, sig] = token.split('.') as [string, string, string];
    const forged = `${head}.${body}.${sig[0] === 'A' ? 'B' : 'A'}${sig.slice(1)}`;
    expect((await refresh(server, forged)).statusCode).toBe(401);
    expect((await refresh(server, token, { accountId: 'somebody-else' })).statusCode).toBe(400);
  });
});
