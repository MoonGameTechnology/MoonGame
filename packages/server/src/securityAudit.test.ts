import { describe, expect, it, vi } from 'vitest';
import { SecurityAudit, securityAuditFromEnv } from './securityAudit';

describe('bounded, secret-free security audit', () => {
  it('aggregates HTTP and WebSocket failures into the same authorization budget', () => {
    const lines: string[] = [];
    const audit = new SecurityAudit(
      (line) => lines.push(line),
      () => 0,
    );
    for (let i = 0; i < 19; i++) audit.record('auth.reject');
    audit.record('ws.reject');
    expect(lines.map((line) => JSON.parse(line))).toContainEqual(
      expect.objectContaining({ kind: 'security.alert', category: 'auth', count: 20 }),
    );
  });
  it('counts an unsampled flood, alerts once, and starts a fresh window', () => {
    let now = 0;
    const lines: string[] = [];
    const audit = new SecurityAudit(
      (line) => lines.push(line),
      () => now,
    );
    for (let i = 0; i < 10_000; i++) audit.record('auth.reject', 'E_AUTH');
    expect(lines.map((line) => JSON.parse(line).kind)).toEqual([
      'security.event',
      'security.alert',
    ]);
    expect(JSON.parse(lines[1]!)).toMatchObject({ category: 'auth', count: 20 });
    now = 60_000;
    for (let i = 0; i < 20; i++) audit.record('auth.reject');
    expect(lines.filter((line) => JSON.parse(line).kind === 'security.alert')).toHaveLength(2);
  });
  it('never logs raw identifiers, token/error text, arbitrary object fields or unknown events', () => {
    const lines: string[] = [];
    const audit = new SecurityAudit(
      (line) => lines.push(line),
      () => 0,
    );
    audit.record('action.reject', 'password=top-secret', 'private-match-token');
    audit.record('leaked event' as never, 'E_AUTH');
    const result = JSON.parse(lines[0]!);
    expect(result).toMatchObject({ kind: 'security.event', code: 'E_UNKNOWN' });
    expect(result.match).toMatch(/^[a-f0-9]{24}$/);
    expect(lines.join('')).not.toMatch(/top-secret|private-match-token|leaked event/);
  });
  it('contains sink failures and reports the failure once per minute', () => {
    const stderr = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    try {
      const audit = new SecurityAudit(
        () => {
          throw new Error('secret');
        },
        () => 0,
      );
      expect(() => {
        audit.record('auth.reject');
        audit.record('rate.limit');
      }).not.toThrow();
      expect(stderr).toHaveBeenCalledTimes(1);
      expect(stderr.mock.calls[0]![0]).not.toContain('secret');
    } finally {
      stderr.mockRestore();
    }
  });
  it('enables the shipped release posture and explicit staging only', () => {
    expect(securityAuditFromEnv({ PROD: '1' })).toBeInstanceOf(SecurityAudit);
    expect(securityAuditFromEnv({ SECURITY_AUDIT: '1' })).toBeInstanceOf(SecurityAudit);
    expect(securityAuditFromEnv({})).toBeUndefined();
  });
});
