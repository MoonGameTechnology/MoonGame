import { describe, expect, it } from 'vitest';
import { createServer as http } from 'node:http';
import { createServer as https } from 'node:https';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { healthcheck } from './healthcheck.mjs';

describe('container liveness over verified TLS', () => {
  it('probes HTTP and rejects a partial TLS configuration', async () => {
    const server = http((_, res) => res.end('ok'));
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    try {
      const env = { PORT: String(server.address().port) };
      expect(await healthcheck(env)).toBe(true);
      expect(await healthcheck({ ...env, TLS_CERT_FILE: '/missing' })).toBe(false);
    } finally {
      await new Promise((r) => server.close(r));
    }
  });
  it('accepts the configured TLS identity and rejects a hostname mismatch and unknown CA', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'health-tls-'));
    const key = join(dir, 'key.pem'),
      cert = join(dir, 'cert.pem'),
      other = join(dir, 'other.pem');
    let server;
    try {
      for (const out of [cert, other])
        execFileSync(
          'openssl',
          [
            'req',
            '-x509',
            '-newkey',
            'rsa:2048',
            '-nodes',
            '-keyout',
            key,
            '-out',
            out,
            '-days',
            '1',
            '-subj',
            '/CN=localhost',
            '-addext',
            'subjectAltName=DNS:localhost',
          ],
          { stdio: 'ignore' },
        );
      server = https({ key: readFileSync(key), cert: readFileSync(other) }, (_, res) =>
        res.end('ok'),
      );
      await new Promise((r) => server.listen(0, '127.0.0.1', r));
      const env = { PORT: String(server.address().port), TLS_KEY_FILE: key, TLS_CERT_FILE: other };
      expect(await healthcheck(env)).toBe(true);
      expect(await healthcheck({ ...env, HEALTHCHECK_TLS_SERVERNAME: 'wrong.invalid' })).toBe(
        false,
      );
      expect(await healthcheck({ ...env, HEALTHCHECK_CA_FILE: cert })).toBe(false);
    } finally {
      if (server) await new Promise((r) => server.close(r));
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
