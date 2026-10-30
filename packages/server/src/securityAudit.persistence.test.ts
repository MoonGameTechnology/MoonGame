import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { SecurityAudit, securityAuditFromEnv } from './securityAudit';

const salt = 'security-correlation-fixture-key-32-characters';
const dirs: string[] = [];
afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

describe('persistent investigation context', () => {
  it('correlates instances, rotates source at UTC midnight, and never retains raw identities', () => {
    let now = Date.parse('2026-10-29T23:59:59Z');
    const lines: string[] = [];
    const audit = new SecurityAudit(
      (line) => lines.push(line),
      () => now,
      { salt },
    );
    const request = {};
    audit.request(request, '::ffff:192.0.2.31', 'POST', '/auth/register');
    audit.identify(request, 'private-account-id');
    audit.target(request, 'аtt_probe');
    const before = audit.context(request)!;
    const peer = {};
    audit.bind(peer, before, request);
    const other = new SecurityAudit(
      () => {},
      () => now,
      { salt },
    );
    const second = {};
    other.request(second, '192.0.2.31', 'POST', '/auth/register');
    other.identify(second, 'private-account-id');
    expect(other.context(second)?.source).toBe(before.source);
    expect(other.context(second)?.actor).toBe(before.actor);
    expect(before.target).toHaveLength(24);
    expect(before.inputClass).toBe('mixed-script');
    audit.record('auth.success', undefined, 'secret-match-id', before);
    now += 2000;
    expect(audit.context(peer)?.source).not.toBe(before.source);
    expect(audit.context(peer)?.actor).toBe(before.actor);
    expect(lines.join('')).not.toMatch(
      /192\.0\.2\.31|private-account-id|аtt_probe|secret-match-id/,
    );
  });
  it('does not create unerasable identity pseudonyms without the persistent key', () => {
    const audit = new SecurityAudit(() => {});
    const req = {};
    audit.request(req, '192.0.2.31', 'GET', '/matches/:id');
    audit.identify(req, 'private-id');
    audit.target(req, 'private-login');
    expect(audit.context(req)).not.toHaveProperty('source');
    expect(audit.context(req)).not.toHaveProperty('actor');
    expect(audit.context(req)).not.toHaveProperty('target');
    expect(audit.summary().stableCorrelation).toBe(0);
  });
  it('retains contextual probes individually and exposes overload instead of hiding loss', () => {
    const lines: string[] = [];
    const audit = new SecurityAudit(
      (line) => lines.push(line),
      () => 0,
      { salt },
    );
    for (let i = 0; i < 1000; i++) {
      const req = {};
      audit.request(req, '192.0.2.31', 'POST', '/auth/login');
      audit.record('auth.reject', 'E_AUTH', undefined, audit.context(req));
    }
    expect(lines.filter((line) => JSON.parse(line).kind === 'security.event')).toHaveLength(64);
    expect(audit.summary()).toMatchObject({ sampled: 936, counts: { 'auth.reject': 1000 } });
    expect(lines.map((line) => JSON.parse(line))).toContainEqual(
      expect.objectContaining({ kind: 'security.alert', count: 20 }),
    );
  });
  it('survives replacement of the producer and has independent priority/heartbeat journals', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'security-persist-'));
    dirs.push(dir);
    const env = {
      PROD: '1',
      ANALYTICS_SALT: salt,
      SECURITY_LOG_DIR: dir,
      GIT_SHA: 'bad-token-is-not-a-version',
    };
    const first = securityAuditFromEnv(env)!;
    first.start();
    const req = {};
    first.request(req, '192.0.2.31', 'POST', '/auth/login');
    first.identify(req, 'private-id');
    first.target(req, 'private-login');
    first.record('auth.success', undefined, undefined, first.context(req));
    first.record('http.reject', 'E_BAD_REQUEST', undefined, { ...first.context(req), status: 400 });
    await first.close();
    const second = securityAuditFromEnv(env)!;
    second.start();
    await second.close();
    const names = await readdir(dir);
    expect(names.some((name) => name.startsWith('security-auth-'))).toBe(true);
    expect(names.some((name) => name.startsWith('security-status-'))).toBe(true);
    const rows = (await Promise.all(names.map((name) => readFile(join(dir, name), 'utf8'))))
      .join('')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    expect(rows.filter((r) => r.event === 'process.start')).toHaveLength(2);
    expect(new Set(rows.filter((r) => r.event === 'process.start').map((r) => r.run)).size).toBe(2);
    expect(rows).toContainEqual(
      expect.objectContaining({
        event: 'auth.success',
        schema: 2,
        actor: expect.stringMatching(/^[a-f0-9]{16}$/),
      }),
    );
    expect(JSON.stringify(rows)).not.toMatch(
      /192\.0\.2\.31|private-id|private-login|bad-token-is-not-a-version/,
    );
  });
});
