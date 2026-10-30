import { afterEach, describe, expect, it } from 'vitest';
import {
  mkdtemp,
  writeFile,
  readFile,
  readdir,
  chmod,
  symlink,
  rm,
  mkdir,
  utimes,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { detect, sample } from './monitor.mjs';
import { EVENTS, projectRecord, readRecords } from './records.mjs';
import { parseQuery, query } from './query.mjs';
import { parseConfig } from './control.mjs';
import { projectEdge } from './edge-records.mjs';
import { withEdgeLogging } from './edge-logging.mjs';

const now = Date.parse('2026-10-30T05:00:00Z'),
  run = '11111111-2222-4333-8444-555555555555';
const day = '2026-10-30',
  source = day + ':' + 'a'.repeat(24);
const dirs = [];
afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'security-detect-'));
  dirs.push(root);
  await chmod(root, 0o700);
  const logs = join(root, 'logs'),
    metrics = join(root, 'metrics');
  await mkdir(logs, { mode: 0o700 });
  await mkdir(metrics);
  return { root, logs, metrics };
}
const event = (type, i = 0, extra = {}) => ({
  schema: 2,
  kind: 'security.event',
  run,
  sequence: i + 1,
  event: type,
  count: i + 1,
  at: now - 30000 + i * 100,
  source,
  route: '/auth/login',
  method: 'POST',
  ...extra,
});
const status = (extra = {}) => ({
  schema: 2,
  kind: 'security.status',
  run,
  at: now - 1000,
  startedAt: now - 600000,
  stableCorrelation: 1,
  sampled: 0,
  failed: 0,
  journal: { written: 30, dropped: 0, failed: 0 },
  counts: Object.fromEntries([...EVENTS].map((e) => [e, 0])),
  ...extra,
});
async function put(dir, prefix, rows) {
  await writeFile(
    join(dir, `${prefix}-${day}.jsonl`),
    rows.map((r) => JSON.stringify(r)).join('\n') + '\n',
    { mode: 0o600 },
  );
}

describe('evidence-based detection, not automatic punishment', () => {
  it('finds a burst and slow auth probing without flagging an ordinary login/register flow', () => {
    expect(detect([event('auth.reject'), event('auth.success', 1)], now).incidents).toEqual([]);
    expect(
      detect(
        Array.from({ length: 20 }, (_, i) => event(i % 2 ? 'ws.reject' : 'auth.reject', i)),
        now,
      ).incidents.map((r) => r.rule),
    ).toContain('auth-burst');
    const slow = Array.from({ length: 15 }, (_, i) =>
      event('auth.reject', i, { at: now - 540000 + i * 35000 }),
    );
    const rules = detect(slow, now).incidents.map((r) => r.rule);
    expect(rules).toContain('auth-slow');
    expect(rules).not.toContain('auth-burst');
  });
  it('separates sources and only flags a success for the same prior-failure target', () => {
    const failures = Array.from({ length: 5 }, (_, i) =>
      event('auth.reject', i, { target: 'b'.repeat(24) }),
    );
    expect(detect(failures, now).incidents).toEqual([]);
    expect(
      detect([...failures, event('auth.success', 6, { target: 'c'.repeat(24) })], now).incidents,
    ).toEqual([]);
    expect(
      detect([...failures, event('auth.success', 6, { target: 'b'.repeat(24) })], now).incidents,
    ).toContainEqual(expect.objectContaining({ rule: 'success-after-failures', severity: 'high' }));
    expect(
      detect(
        Array.from({ length: 20 }, (_, i) =>
          event('auth.reject', i, { source: day + ':' + i.toString(16).padStart(24, '0') }),
        ),
        now,
      ).incidents,
    ).toEqual([]);
  });
  it('recognizes repeated mixed-script registration tests without saving the nicknames', () => {
    const rows = Array.from({ length: 3 }, (_, i) =>
      event('auth.success', i, {
        route: '/auth/register',
        inputClass: 'mixed-script',
        target: i.toString(16).padStart(24, '0'),
      }),
    );
    expect(detect(rows, now).incidents).toContainEqual(
      expect.objectContaining({ rule: 'mixed-script-probes', count: 3 }),
    );
    expect(detect([rows[0], rows[0], rows[0]], now).incidents).toEqual([]);
  });
  it('detects security-boundary and server failures, not normal gameplay or timestamps outside the window', () => {
    expect(
      detect(
        Array.from({ length: 30 }, (_, i) => event('http.mutation', i)),
        now,
      ).incidents,
    ).toEqual([]);
    expect(
      detect(
        Array.from({ length: 5 }, (_, i) => event('action.reject', i)),
        now,
      ).incidents.map((r) => r.rule),
    ).toContain('action-boundary');
    expect(
      detect(
        Array.from({ length: 5 }, (_, i) => event('http.error', i)),
        now,
      ).incidents.map((r) => r.rule),
    ).toContain('server-errors');
    expect(
      detect(
        Array.from({ length: 50 }, (_, i) => event('auth.reject', i, { at: now - 700000 })),
        now,
      ).incidents,
    ).toEqual([]);
  });
  it('sees probes rejected at Caddy before reaching the game', () => {
    const rows = Array.from({ length: 5 }, (_, i) => ({
      kind: 'security.edge',
      at: now - 1000 + i,
      route: 'operator',
      method: 'GET',
      status: 404,
    }));
    expect(detect(rows, now).incidents.map((r) => r.rule)).toContain('edge-probes');
  });
  it('deduplicates event delivery and flags conflicting reuse of a producer event ID', () => {
    const row = event('auth.reject');
    const result = detect(
      Array.from({ length: 30 }, () => row),
      now,
    );
    expect(result.incidents).toEqual([]);
    expect(result.duplicates).toBe(29);
    expect(detect([row, { ...row, status: 403 }], now).conflicts).toBe(1);
  });
  it('distinguishes a repeated-version restart loop from ordinary releases', () => {
    const rows = Array.from({ length: 4 }, (_, i) =>
      event('process.start', i, {
        version: '123456789abc',
        run: `${i.toString().repeat(8)}-2222-4333-8444-555555555555`,
      }),
    );
    expect(detect(rows, now).incidents.map((r) => r.rule)).toContain('restart-burst');
    expect(
      detect(
        rows.map((r, i) => ({ ...r, version: i.toString().repeat(12) })),
        now,
      ).incidents,
    ).toEqual([]);
  });
  it('bounds attacker-controlled cardinality and makes exhaustion observable', () => {
    const rows = Array.from({ length: 5000 }, (_, i) =>
      event('auth.reject', i, {
        at: now - 1000,
        source: day + ':' + i.toString(16).padStart(24, '0'),
      }),
    );
    expect(detect(rows, now).limited).toBeGreaterThan(0);
  });
});

describe('durable bounded incidents and investigation', () => {
  it('persists once across independent samples, projects no secrets, and resolves active state after the window', async () => {
    const { logs, metrics } = await fixture();
    await put(logs, 'security', [
      ...Array.from({ length: 20 }, (_, i) =>
        event('auth.reject', i, { headers: { authorization: 'SECRET' }, payload: 'SECRET' }),
      ),
    ]);
    await put(logs, 'security-status', [status()]);
    const first = await sample({ directory: logs, metricsDirectory: metrics, now });
    expect(first.stats.up).toBe(1);
    expect(first.incidents.map((r) => r.rule)).toContain('auth-burst');
    const path = join(logs, `security-incidents-${day}.jsonl`),
      before = await readFile(path, 'utf8');
    await sample({ directory: logs, metricsDirectory: metrics, now: now + 1000 });
    expect(await readFile(path, 'utf8')).toBe(before);
    expect(before).not.toContain('SECRET');
    const report = await query(logs, { from: now - 60000, to: now, limit: 3, source });
    expect(report.returned).toBe(3);
    expect(report.truncated).toBe(true);
    expect(JSON.stringify(report)).not.toContain('SECRET');
    await put(logs, 'security-status', [status({ at: now + 61000 })]);
    await sample({ directory: logs, metricsDirectory: metrics, now: now + 61000 });
    expect(await readFile(join(metrics, 'security.prom'), 'utf8')).toContain(
      'moongame_security_incidents_active{rule="auth-burst"} 0',
    );
  });
  it('reports stale/missing evidence, sampling, disk loss, missing correlation and corrupt records', async () => {
    const { logs, metrics } = await fixture();
    let r = await sample({ directory: logs, metricsDirectory: metrics, now });
    expect(r.incidents.map((r) => r.rule)).toContain('audit-stale');
    await put(logs, 'security-status', [
      status({ sampled: 2, stableCorrelation: 0, journal: { written: 0, dropped: 1, failed: 1 } }),
    ]);
    await writeFile(join(logs, `security-${day}.jsonl`), 'not-json\n', { mode: 0o600 });
    r = await sample({ directory: logs, metricsDirectory: metrics, now });
    expect(r.stats.invalid).toBe(1);
    expect(r.incidents.map((r) => r.rule)).toEqual(
      expect.arrayContaining(['audit-loss', 'correlation-missing', 'detector-capacity']),
    );
  });
  it('detects stuck erasure maintenance and refuses linked/public input files', async () => {
    const { root, logs, metrics } = await fixture();
    const marker = join(root, 'pending'),
      success = join(root, 'success');
    await writeFile(marker, '', { mode: 0o600 });
    await writeFile(success, '', { mode: 0o600 });
    await utimes(success, new Date(now - 400000), new Date(now - 400000));
    await put(logs, 'security-status', [status()]);
    const result = await sample({
      directory: logs,
      metricsDirectory: metrics,
      maintenanceMarker: marker,
      maintenanceSuccess: success,
      now,
    });
    expect(result.incidents.map((r) => r.rule)).toContain('maintenance-stuck');
    const secret = join(root, 'secret');
    await writeFile(secret, 'SECRET', { mode: 0o600 });
    await symlink(secret, join(logs, `security-${day}.jsonl`));
    expect((await sample({ directory: logs, metricsDirectory: metrics, now })).stats.up).toBe(0);
  });
  it('expires only its own incident files and keeps source journals untouched', async () => {
    const { logs, metrics } = await fixture();
    const old = 'security-incidents-2026-10-01.jsonl';
    await writeFile(join(logs, old), 'old', { mode: 0o600 });
    await writeFile(join(logs, 'match-2026-10-01.jsonl'), 'keep', { mode: 0o600 });
    await put(logs, 'security-status', [status()]);
    await sample({ directory: logs, metricsDirectory: metrics, now });
    expect(await readdir(logs)).not.toContain(old);
    expect(await readFile(join(logs, 'match-2026-10-01.jsonl'), 'utf8')).toBe('keep');
  });
  it('reports missing edge files as unavailable even when the directory is readable', async () => {
    const { root, logs, metrics } = await fixture();
    const edgeDirectory = join(root, 'edge');
    await mkdir(edgeDirectory, { mode: 0o700 });
    await put(logs, 'security-status', [status()]);
    const result = await sample({ directory: logs, metricsDirectory: metrics, edgeDirectory, now });
    expect(result.stats).toMatchObject({ up: 0, edgeUp: 0 });
  });
  it('rejects invalid filters and projects only known event fields', () => {
    expect(() => parseQuery(['--actor', 'private-account-id'], now)).toThrow('E_SECURITY_QUERY');
    expect(() => parseQuery(['--limit', '1001'], now)).toThrow('E_SECURITY_QUERY');
    expect(() => parseQuery(['--from', '2020-01-01T00:00:00Z'], now)).toThrow('E_SECURITY_QUERY');
    expect(() =>
      parseConfig(
        'SECURITY_LOG_DIR=/logs\nSECURITY_METRICS_DIR=/metrics\nSECURITY_STATE_DIR=/state\nEVIL=$(id)',
      ),
    ).toThrow('E_SECURITY_CONFIG');
    expect(
      projectRecord({
        ...event('auth.reject'),
        body: { password: 'SECRET' },
        requestId: 'SECRET',
        actor: 'SECRET',
      }),
    ).not.toHaveProperty('body');
    expect(
      projectEdge({
        ts: now / 1000,
        status: 404,
        security_route: 'operator',
        security_method: 'GET',
        request: { ip: 'SECRET' },
      }),
    ).toEqual({ kind: 'security.edge', at: now, status: 404, route: 'operator', method: 'GET' });
  });
  it('skips an oversized line through its newline without accepting a forged JSON suffix', async () => {
    const { logs } = await fixture();
    const valid = JSON.stringify(event('auth.reject'));
    await writeFile(
      join(logs, `security-${day}.jsonl`),
      'x'.repeat(33000) + valid + '\n' + valid + '\n',
      { mode: 0o600 },
    );
    const records = [];
    let invalid = 0;
    for await (const row of readRecords(logs, {
      from: now - 60000,
      to: now,
      onInvalid: () => invalid++,
    }))
      records.push(row);
    expect(records).toHaveLength(1);
    expect(invalid).toBe(1);
  });
  it('makes Caddy insertion idempotent and preserves separate operator sites', () => {
    const before = '{$DOMAIN} {\nrespond 200\n}\nmonitor.example { respond 403 }';
    const after = withEdgeLogging(before);
    expect(withEdgeLogging(after)).toBe(after);
    expect(after).toContain('monitor.example { respond 403 }');
    expect(after).toContain('request delete');
    expect(after).toContain('resp_headers delete');
    expect(() => withEdgeLogging(before, '/tmp/../SECRET')).toThrow('E_SECURITY_EDGE_CONFIG');
  });
});
