import { once } from 'node:events';
import { afterEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { createDevMatch, loadShippedData } from './scenario';
import { createMultiplayerServer, type MultiplayerServerHandle } from './wsServer';
import { InMemoryRoomRegistry, revokeAccountConnections } from './roomRegistry';
import { registerAuthApi, currentPwfp, pwFingerprint } from './authApi';
import {
  hmacSecret,
  signJoinToken,
  signResetToken,
  signSessionToken,
  verifyResetToken,
  type JoinClaim,
} from './auth';
import { hashPassword, type ScryptParams } from './password';
import { MemoryUserStore } from './store';
import type { MatchRoom } from './matchRoom';
import type { ServerMessage } from './protocol';

// A password reset revokes more than sessions: the join token minted from an old session
// is refused at the handshake (its `pwfp` no longer matches), and every game socket the
// account already has open — in any live match — is closed with `E_SESSION_REVOKED`.
// Other accounts' sockets are untouched, and the seat is not released.

const data = loadShippedData();
const FAST: ScryptParams = { N: 2 ** 12, r: 8, p: 1 };
const KEY = hmacSecret('revocation-test-secret');
const auth = { key: KEY, algorithms: ['HS256'], issuer: 'void', audience: 'match' };
const joinSign = { key: KEY, algorithm: 'HS256', issuer: 'void', audience: 'match' };
const sessionSign = { key: KEY, algorithm: 'HS256', issuer: 'void', audience: 'session' };
const resetSign = { key: KEY, algorithm: 'HS256', issuer: 'void', audience: 'reset' };
const resetVerify = { key: KEY, algorithms: ['HS256'], issuer: 'void', audience: 'reset' };

interface Harness {
  server: MultiplayerServerHandle;
  users: MemoryUserStore;
  rooms: Record<string, MatchRoom>;
  /** ws://host:port/matches */
  wsBase: string;
  httpBase: string;
}

let current: Harness | null = null;
const open: WebSocket[] = [];
afterEach(async () => {
  for (const ws of open.splice(0)) ws.terminate();
  await current?.server.close();
  current = null;
});

async function harness(opts: { accountPwfp?: (id: string) => Promise<string | null> } = {}) {
  const users = new MemoryUserStore();
  const rooms = {
    m1: createDevMatch(data, { id: 'm1' }),
    m2: createDevMatch(data, { id: 'm2' }),
  };
  const registry = new InMemoryRoomRegistry(Object.values(rooms));
  const server = createMultiplayerServer({
    registry,
    auth,
    accountPwfp: opts.accountPwfp ?? ((id) => currentPwfp(users, id)),
    httpRoutes: (app) =>
      registerAuthApi(app, {
        users,
        signSession: (accountId, login, pwfp) =>
          signSessionToken({ accountId, login, pwfp }, sessionSign, { ttlSeconds: 3600 }),
        signReset: (accountId, pwfp) =>
          signResetToken({ accountId, pwfp }, resetSign, { ttlSeconds: 900 }),
        verifyReset: async (token) => {
          const r = await verifyResetToken(token, resetVerify);
          return r.ok ? r.claim : null;
        },
        resetBaseUrl: 'https://play.example',
        sendRecoveryMail: async () => {},
        onPasswordChanged: (accountId) => {
          revokeAccountConnections(registry, accountId);
        },
        scryptParams: FAST,
      }),
  });
  const url = new URL(await server.listen());
  current = {
    server,
    users,
    rooms,
    wsBase: `ws://${url.host}/matches`,
    httpBase: `http://${url.host}`,
  };
  return current;
}

async function account(h: Harness, login: string, password: string) {
  const passHash = await hashPassword(password, FAST);
  const created = await h.users.createUser(login, passHash);
  if (!created.ok) throw new Error('createUser failed');
  return { accountId: created.userId, pwfp: pwFingerprint(passHash) };
}

const joinToken = (claim: JoinClaim) => signJoinToken(claim, joinSign, { ttlSeconds: 300 });

/** Connect and wait for the welcome; the socket stays open (closed in afterEach). */
async function connect(h: Harness, matchId: string, token: string): Promise<WebSocket> {
  const ws = new WebSocket(`${h.wsBase}/${matchId}?token=${token}`);
  open.push(ws);
  const [raw] = await once(ws, 'message');
  expect(JSON.parse(String(raw))).toMatchObject({ type: 'welcome' });
  return ws;
}

function rejectStatus(target: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(target);
    ws.on('unexpected-response', (_req, res) => {
      ws.terminate();
      resolve(res.statusCode ?? 0);
    });
    ws.on('open', () => {
      ws.close();
      reject(new Error('expected the handshake to be rejected, but it connected'));
    });
    ws.on('error', () => {
      /* the raw 401 arrives via 'unexpected-response' */
    });
  });
}

/** Spend a reset token for `accountId` (bound to its current password) via the real route. */
async function resetPassword(h: Harness, accountId: string, password: string): Promise<number> {
  const fp = await currentPwfp(h.users, accountId);
  const token = await signResetToken({ accountId, pwfp: fp! }, resetSign, { ttlSeconds: 900 });
  const res = await fetch(`${h.httpBase}/auth/reset`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token, password }),
  });
  return res.status;
}

describe('password reset revokes game connections', () => {
  it('refuses a join token minted before the reset (stale pwfp → 401)', async () => {
    const h = await harness();
    const alice = await account(h, 'alice', 'old-password');
    const t = await joinToken({ matchId: 'm1', playerId: 'green', ...alice });
    (await connect(h, 'm1', t)).close();

    expect(await resetPassword(h, alice.accountId, 'new-password')).toBe(200);
    expect(await rejectStatus(`${h.wsBase}/m1?token=${t}`)).toBe(401);

    // A token stamped with the NEW fingerprint gets in: the seat is still the owner's.
    const fresh = await joinToken({
      matchId: 'm1',
      playerId: 'green',
      accountId: alice.accountId,
      pwfp: (await currentPwfp(h.users, alice.accountId))!,
    });
    await connect(h, 'm1', fresh);
  });

  it('closes the account’s open sockets in every match; other accounts stay connected', async () => {
    const h = await harness();
    const alice = await account(h, 'alice', 'old-password');
    const bob = await account(h, 'bob', 'bobs-password');
    const a1 = await connect(
      h,
      'm1',
      await joinToken({ matchId: 'm1', playerId: 'green', ...alice }),
    );
    const a2 = await connect(
      h,
      'm2',
      await joinToken({ matchId: 'm2', playerId: 'green', ...alice }),
    );
    const b1 = await connect(h, 'm1', await joinToken({ matchId: 'm1', playerId: 'red', ...bob }));

    const frames = (ws: WebSocket): ServerMessage[] => {
      const got: ServerMessage[] = [];
      ws.on('message', (raw) => got.push(JSON.parse(String(raw)) as ServerMessage));
      return got;
    };
    const a1Frames = frames(a1);
    const closed = (ws: WebSocket): Promise<[number, string]> =>
      new Promise((resolve) => ws.once('close', (code, reason) => resolve([code, String(reason)])));
    const closes = [a1, a2].map(closed);

    expect(await resetPassword(h, alice.accountId, 'new-password')).toBe(200);
    expect(await Promise.all(closes)).toEqual([
      [1000, 'E_SESSION_REVOKED'],
      [1000, 'E_SESSION_REVOKED'],
    ]);
    expect(a1Frames).toContainEqual({ type: 'error', matchId: 'm1', code: 'E_SESSION_REVOKED' });

    // Bob is untouched: still open, still a connected peer of m1, and alice's seat is
    // only disconnected, not taken away (it stays hers in the world).
    expect(b1.readyState).toBe(WebSocket.OPEN);
    expect(h.rooms.m1!.connectedPlayers()).toEqual(['red']);
    expect(h.rooms.m2!.connectedPlayers()).toEqual([]);
    expect(h.rooms.m1!.state.players.green).toBeDefined();
  });

  it('refuses a join token without pwfp, or when the account lookup fails', async () => {
    const h = await harness();
    const alice = await account(h, 'alice', 'old-password');
    const bare = await joinToken({ matchId: 'm1', playerId: 'green', accountId: alice.accountId });
    expect(await rejectStatus(`${h.wsBase}/m1?token=${bare}`)).toBe(401);
    const unknown = await joinToken({
      matchId: 'm1',
      playerId: 'green',
      accountId: 'ghost',
      pwfp: 'x',
    });
    expect(await rejectStatus(`${h.wsBase}/m1?token=${unknown}`)).toBe(401);
    await h.server.close();
    current = null;

    const broken = await harness({
      accountPwfp: () => Promise.reject(new Error('store down')),
    });
    const t = await joinToken({ matchId: 'm1', playerId: 'green', ...alice });
    expect(await rejectStatus(`${broken.wsBase}/m1?token=${t}`)).toBeGreaterThanOrEqual(400);
  });
});
