import { execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import tls from 'node:tls';
import { describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import {
  createInitialState,
  createKernel,
  parseGameData,
  type Player,
} from '@void/shared-core';
import { MatchRoom } from './matchRoom';
import { createMultiplayerServer, tlsFromEnv } from './wsServer';
import type { ServerMessage } from './protocol';

// A throwaway self-signed cert for localhost, generated at test time via openssl — so no
// private key is ever committed (which the security CI's secret scanners would flag). If
// openssl isn't on PATH the live-TLS test conditionally skips; the pure tlsFromEnv guards
// still run. openssl ships on the CI ubuntu runner, so it exercises there.
function genSelfSigned(): { key: string; cert: string } | null {
  let dir: string | undefined;
  try {
    dir = mkdtempSync(join(tmpdir(), 'void-tls-'));
    execFileSync(
      'openssl',
      ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', join(dir, 'key.pem'),
        '-out', join(dir, 'cert.pem'), '-days', '1', '-subj', '/CN=localhost'],
      { stdio: 'ignore' },
    );
    return {
      key: readFileSync(join(dir, 'key.pem'), 'utf8'),
      cert: readFileSync(join(dir, 'cert.pem'), 'utf8'),
    };
  } catch {
    return null;
  } finally {
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
}

function player(id: string): Player {
  return { id, name: id, faction: id, status: 'active', resources: {} };
}

function makeRoom(): MatchRoom {
  const base = createInitialState({ seed: 'tls-test', version: { data: 'test', manifest: 'test' } });
  return new MatchRoom({
    id: 'tls-room',
    initialState: { ...base, players: { p1: player('p1'), p2: player('p2') } },
    kernel: createKernel([]),
    data: parseGameData({
      version: 'test',
      resources: ['marker'],
      units: {},
      factions: {},
      buildings: {},
      events: {},
      sectors: {},
      planetTypes: {},
    }),
    now: () => 10,
  });
}

function nextMessage(ws: WebSocket): Promise<ServerMessage> {
  return once(ws, 'message').then(([data]) => JSON.parse(data.toString()) as ServerMessage);
}

const certs = genSelfSigned();

describe('createMultiplayerServer — native TLS (RS-5.1)', () => {
  it('plain ws:// when no tls option (unchanged default)', async () => {
    const server = createMultiplayerServer({ room: makeRoom() });
    try {
      expect((await server.listen()).startsWith('ws://')).toBe(true);
    } finally {
      await server.close();
    }
  });

  it.skipIf(!certs)('serves wss:// and completes the handshake over TLS', async () => {
    const server = createMultiplayerServer({
      room: makeRoom(),
      tls: { key: certs!.key, cert: certs!.cert },
    });
    try {
      const url = await server.listen();
      expect(url.startsWith('wss://')).toBe(true);
      // Self-signed → rejectUnauthorized:false (the point is the encrypted handshake, not
      // a trusted CA — a real deploy uses a Let's Encrypt cert, see deploy/README.md).
      // Обоснование держим отдельной строкой, а директиву — чистой: так надёжнее, чем
      // дописывать причину в саму директиву (всё после `nosemgrep:` — список rule-id).
      // Причина: in-test self-signed localhost cert; проверяется сам wss-хендшейк, а в
      // проде сертификат от настоящего CA (deploy/README.md).
      // nosemgrep: problem-based-packs.insecure-transport.js-node.bypass-tls-verification.bypass-tls-verification
      const ws = new WebSocket(`${url}?player=p1`, { rejectUnauthorized: false });
      try {
        const welcome = nextMessage(ws);
        await once(ws, 'open');
        expect(await welcome).toMatchObject({ type: 'welcome', playerId: 'p1' });
      } finally {
        ws.close();
      }
    } finally {
      await server.close();
    }
  });
});

// Encryption audit 2026-10-10, ECP-04: TLS 1.2 stays for old Android WebViews, but only
// with forward-secret AEAD suites; CBC and pre-1.2 handshakes are refused.
describe('native TLS policy', () => {
  /** Handshake outcome for one client offer: the negotiated protocol, or 'refused'. */
  function offer(port: number, options: tls.ConnectionOptions): Promise<string> {
    return new Promise((resolve) => {
      // The throwaway cert is its own CA: trusting it explicitly keeps verification on,
      // so a refusal here can only come from the protocol/cipher policy under test.
      const socket = tls.connect({
        host: '127.0.0.1',
        port,
        servername: 'localhost',
        ca: certs!.cert,
        ...options,
      });
      socket.once('secureConnect', () => {
        resolve(socket.getProtocol() ?? 'unknown');
        socket.destroy();
      });
      socket.once('error', () => resolve('refused'));
    });
  }

  it.skipIf(!certs)('accepts TLS 1.3 and AEAD TLS 1.2, refuses CBC and TLS 1.1', async () => {
    const server = createMultiplayerServer({
      room: makeRoom(),
      tls: { key: certs!.key, cert: certs!.cert },
    });
    try {
      const port = Number(new URL(await server.listen()).port);
      expect(await offer(port, {})).toBe('TLSv1.3');
      expect(
        await offer(port, { maxVersion: 'TLSv1.2', ciphers: 'ECDHE-RSA-AES128-GCM-SHA256' }),
      ).toBe('TLSv1.2');
      expect(
        await offer(port, { maxVersion: 'TLSv1.2', ciphers: 'ECDHE-RSA-AES128-SHA256:AES128-SHA' }),
      ).toBe('refused');
      expect(await offer(port, { minVersion: 'TLSv1.1', maxVersion: 'TLSv1.1' })).toBe('refused');
    } finally {
      await server.close();
    }
  });
});

describe('tlsFromEnv (RS-5.1)', () => {
  it('undefined when neither var is set ⇒ plain ws', () => {
    expect(tlsFromEnv({} as NodeJS.ProcessEnv)).toBeUndefined();
  });

  it('throws on a partial config — fail-secure, no silent downgrade to cleartext', () => {
    expect(() => tlsFromEnv({ TLS_KEY_FILE: '/x/key.pem' } as NodeJS.ProcessEnv)).toThrow(/BOTH/);
    expect(() => tlsFromEnv({ TLS_CERT_FILE: '/x/cert.pem' } as NodeJS.ProcessEnv)).toThrow(/BOTH/);
  });

  it.skipIf(!certs)('reads both PEM files when set', () => {
    const dir = mkdtempSync(join(tmpdir(), 'void-tlsenv-'));
    try {
      const kf = join(dir, 'k.pem');
      const cf = join(dir, 'c.pem');
      writeFileSync(kf, certs!.key);
      writeFileSync(cf, certs!.cert);
      const out = tlsFromEnv({ TLS_KEY_FILE: kf, TLS_CERT_FILE: cf } as NodeJS.ProcessEnv);
      expect(out?.cert.toString()).toContain('BEGIN CERTIFICATE');
      expect(out?.key.toString()).toContain('PRIVATE KEY');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
