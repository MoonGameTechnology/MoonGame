import { execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:tls';
import { describe, expect, it } from 'vitest';
import { mailerFromEnv } from './mailer';

it('refuses incomplete delivery and plaintext/invalid configurations', () => {
  expect(mailerFromEnv({})).toBeUndefined();
  expect(() => mailerFromEnv({ RESET_BASE_URL: 'https://play.example' })).toThrow('E_MAIL_CONFIG');
  const env = {
    RESET_BASE_URL: 'https://play.example',
    SMTP_HOST: 'localhost',
    SMTP_FROM: 'reset@example.test',
  };
  for (const bad of [
    { SMTP_TLS_MODE: 'none' },
    { SMTP_USER: 'u' },
    { SMTP_FROM: 'a@example.test,b@example.test' },
    { PROD: '1', RESET_BASE_URL: 'http://play.example' },
  ]) {
    expect(() => mailerFromEnv({ ...env, ...bad })).toThrow('E_MAIL_CONFIG');
  }
});

describe('real local SMTP over verified TLS', () => {
  it('delivers a reset message, rejects foreign TLS identity and header injection', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'smtp-test-'));
    const key = join(dir, 'key.pem'),
      cert = join(dir, 'cert.pem');
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
        cert,
        '-days',
        '1',
        '-subj',
        '/CN=localhost',
        '-addext',
        'subjectAltName=DNS:localhost',
      ],
      { stdio: 'ignore' },
    );
    const delivered: string[] = [];
    const server = createServer({ key: readFileSync(key), cert: readFileSync(cert) }, (socket) => {
      let buffer = '',
        message = '',
        inData = false;
      socket.setEncoding('utf8');
      socket.on('error', () => {});
      socket.write('220 localhost test SMTP\r\n');
      socket.on('data', (chunk) => {
        buffer += chunk;
        while (buffer.includes('\r\n')) {
          const at = buffer.indexOf('\r\n'),
            line = buffer.slice(0, at);
          buffer = buffer.slice(at + 2);
          if (inData) {
            if (line === '.') {
              delivered.push(message);
              inData = false;
              socket.write('250 delivered\r\n');
            } else message += line + '\n';
          } else if (line.startsWith('EHLO')) socket.write('250-localhost\r\n250 8BITMIME\r\n');
          else if (line === 'DATA') {
            inData = true;
            socket.write('354 continue\r\n');
          } else if (line === 'QUIT') socket.end('221 bye\r\n');
          else socket.write('250 ok\r\n');
        }
      });
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const env = {
      RESET_BASE_URL: 'https://play.example',
      SMTP_HOST: '127.0.0.1',
      SMTP_PORT: String((server.address() as { port: number }).port),
      SMTP_FROM: 'reset@example.test',
      SMTP_TLS_SERVERNAME: 'localhost',
      SMTP_CA_FILE: cert,
    };
    const msg = {
      to: 'player@example.test',
      subject: 'Password reset',
      text: 'https://play.example/?reset=synthetic-token',
    };
    try {
      await mailerFromEnv(env)!(msg);
      expect(delivered).toHaveLength(1);
      expect(delivered[0]).toContain('reset=synthetic-token');
      await expect(
        mailerFromEnv({ ...env, SMTP_TLS_SERVERNAME: 'wrong.invalid' })!(msg),
      ).rejects.toThrow('E_MAIL_DELIVERY');
      await expect(mailerFromEnv({ ...env, SMTP_CA_FILE: undefined })!(msg)).rejects.toThrow(
        'E_MAIL_DELIVERY',
      );
      await expect(
        mailerFromEnv(env)!({ ...msg, to: 'a@example.test\r\nBcc: b@example.test' }),
      ).rejects.toThrow('E_MAIL_ADDRESS');
      expect(delivered).toHaveLength(1);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
