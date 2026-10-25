import { once } from 'node:events';
import { SignJWT } from 'jose';
import { describe, expect, it, vi } from 'vitest';
import { WebSocket } from 'ws';
import { createDevMatch, loadShippedData } from './scenario';
import { createMultiplayerServer } from './wsServer';
import { hmacSecret, signJoinToken, type JoinClaim } from './auth';

// Isolated audit probes for the exact production revision. These use synthetic
// identities and loopback sockets only; no production account or data is loaded.
const data = loadShippedData();
const key = hmacSecret('isolated-trust-audit-key-not-a-production-credential');
const auth = { key, algorithms: ['HS256'], issuer: 'audit', audience: 'match' };
const signing = { key, algorithm: 'HS256', issuer: 'audit', audience: 'match' };
const origin = 'https://game.audit.invalid';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

function token(accountId: string, playerId: string, pwfp = 'before') {
  return signJoinToken({ matchId: 'dev', accountId, playerId, pwfp }, signing, { ttlSeconds: 300 });
}

function rejection(url: string, headers: Record<string, string> = {}): Promise<number> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url, { origin, headers });
    ws.on('unexpected-response', (_request, response) => {
      ws.terminate();
      resolve(response.statusCode ?? 0);
    });
    ws.on('open', () => {
      ws.terminate();
      reject(new Error('Unauthorized connection unexpectedly opened'));
    });
    ws.on('error', () => { /* Rejected HTTP upgrade is asserted above. */ });
  });
}

async function welcome(url: string): Promise<WebSocket> {
  const ws = new WebSocket(url, { origin });
  const [message] = await once(ws, 'message');
  expect(JSON.parse(String(message))).toMatchObject({ type: 'welcome' });
  return ws;
}

describe('trust boundary audit: combined identity races', () => {
  it('four handshakes cannot survive logout using late stale store replies; another account stays connected', async () => {
    const room = createDevMatch(data);
    const blocked: Array<ReturnType<typeof deferred<string>>> = [];
    const reads = new Map<string, number>();
    let fingerprint = 'before';
    let block = true;
    const server = createMultiplayerServer({
      room, auth, allowedOrigins: [origin],
      accountPwfp: async (account) => account === 'alice' ? fingerprint : 'before',
      accountSeat: async (_match, account) => {
        if (account === 'bob') return 'red';
        const count = (reads.get(account) ?? 0) + 1;
        reads.set(account, count);
        // Each initial lookup passes. The second lookup of each connection is
        // paused only once all four initial lookups reached the same barrier.
        if (block && count > 4) {
          const read = deferred<string>();
          blocked.push(read);
          return read.promise;
        }
        return 'green';
      },
      registry: {
        get: () => room,
        ids: () => ['dev'],
        resolve: async () => {
          if (block) await vi.waitFor(() => expect(reads.get('alice')).toBeGreaterThanOrEqual(4));
          return room;
        },
      },
    });
    const url = await server.listen();
    // Open Bob before the barrier is enabled for Alice.
    block = false;
    const bob = await welcome(`${url}?token=${await token('bob', 'red')}`);
    block = true;
    try {
      const old = await token('alice', 'green');
      const attempts = Array.from({ length: 4 }, () => rejection(`${url}?token=${old}`));
      await vi.waitFor(() => expect(blocked).toHaveLength(4));
      fingerprint = 'after';
      room.evictAccount('alice', 'E_SESSION_REVOKED');
      for (const read of blocked) read.resolve('green');
      expect(await Promise.all(attempts)).toEqual([401, 401, 401, 401]);
      expect(room.peerCount).toBe(1);
      expect(bob.readyState).toBe(WebSocket.OPEN);
      expect(await rejection(`${url}?token=${old}`)).toBe(401);
      block = false;
      const fresh = await welcome(`${url}?token=${await token('alice', 'green', 'after')}`);
      fresh.terminate();
    } finally {
      block = false;
      for (const read of blocked) read.resolve('green');
      bob.terminate();
      await server.close();
    }
  });

  it('seat reassignment during cold loading refuses the old signed capability and admits its new owner', async () => {
    const room = createDevMatch(data);
    const loading = deferred<typeof room>();
    const started = deferred<void>();
    let owner = 'alice';
    const server = createMultiplayerServer({
      registry: { get: () => undefined, ids: () => ['dev'], resolve: async () => {
        started.resolve();
        return loading.promise;
      } },
      auth, allowedOrigins: [origin],
      accountPwfp: async () => 'before',
      accountSeat: async (_match, account) => account === owner ? 'green' : null,
    });
    const url = await server.listen();
    try {
      const attempt = rejection(`${url}?token=${await token('alice', 'green')}`);
      await started.promise;
      owner = 'bob';
      loading.resolve(room);
      expect(await attempt).toBe(403);
      expect(room.peerCount).toBe(0);
      const fresh = await welcome(`${url}?token=${await token('bob', 'green')}`);
      fresh.terminate();
    } finally {
      loading.resolve(room);
      await server.close();
    }
  });

  it('a late store exception fails closed and does not poison the following valid join', async () => {
    const room = createDevMatch(data);
    let reads = 0;
    const server = createMultiplayerServer({
      room, auth, allowedOrigins: [origin],
      accountPwfp: async () => 'before',
      accountSeat: async () => {
        reads += 1;
        if (reads === 2) throw new Error('synthetic private store failure');
        return 'green';
      },
    });
    const url = await server.listen();
    try {
      const signed = await token('alice', 'green');
      expect(await rejection(`${url}?token=${signed}`)).toBe(500);
      expect(room.peerCount).toBe(0);
      const fresh = await welcome(`${url}?token=${signed}`);
      fresh.terminate();
    } finally {
      await server.close();
    }
  });

  it.each(['session+jwt', 'reset+jwt', 'JWT'])('a correctly signed %s cannot become a join token through forged headers or query identity', async (typ) => {
    const room = createDevMatch(data);
    const claims: JoinClaim = { matchId: 'dev', playerId: 'green', accountId: 'alice', pwfp: 'before' };
    const wrongPurpose = await new SignJWT({ ...claims })
      .setProtectedHeader({ alg: 'HS256', typ })
      .setIssuer('audit').setAudience('match').setIssuedAt().setExpirationTime('5m').sign(key);
    const lookup = vi.fn(async () => 'green');
    const server = createMultiplayerServer({ room, auth, allowedOrigins: [origin], accountSeat: lookup });
    const url = await server.listen();
    try {
      expect(await rejection(`${url}?token=${wrongPurpose}&player=green&nick=admin&ticket=anything`, {
        'x-forwarded-for': '127.0.0.1', 'x-forwarded-proto': 'https', 'x-user-id': 'alice',
      })).toBe(401);
      expect(lookup).not.toHaveBeenCalled();
      expect(room.peerCount).toBe(0);
    } finally {
      await server.close();
    }
  });
});
