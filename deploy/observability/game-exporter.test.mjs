/* global Response */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdtemp, writeFile, chmod, symlink, rm, readdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CLIENT_ACTION_TYPES } from '../../packages/shared-core/src/actions/payloadSchemas';
import { ACTION_TYPES, REJECT_CODES } from './game-exporter-catalog.mjs';
import { createExporter, projectSource, readToken, renderMetrics } from './game-exporter.mjs';

export function summary() {
  return {
    joins: 7, leaves: 3, desyncs: 1, deadLetters: 2, advanceOverflows: 0,
    actions: { total: 5, ok: 3, rejected: 2, byType: { 'fleet.move': 5 }, rejectByCode: { E_FORBIDDEN: 2 } },
    submitMs: { count: 5, total: 750, max: 300 },
    broadcastMs: { count: 2, total: 100, max: 70 },
    deltaBytes: { count: 2, total: 900, max: 600 },
    clientFps: { count: 2, total: 110, max: 60 }, clientRttMs: { count: 2, total: 250, max: 150 },
    journal: { match: { written: 9, dropped: 1, failed: 0 }, client: { written: 2, dropped: 0, failed: 0 } },
    telemetry: { batches: 1, events: 4, droppedEvents: 2, rejected: 1, limited: 3, activeInstalls: 2 },
  };
}

const closes = [];
afterEach(async () => { for (const close of closes.splice(0)) await close(); });
async function listen(handler) {
  const server = createServer(handler);
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  closes.push(() => new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); }));
  return server;
}
const sample = (samples, name, labels = {}) => samples.find((s) => s.name === name && Object.entries(labels).every(([k, v]) => s.labels?.[k] === v))?.value;

describe('OBS-1.1 bounded Game metrics boundary', () => {
  it('pins action names to shipping handlers and caps label catalogs', async () => {
    expect([...CLIENT_ACTION_TYPES].every((type) => ACTION_TYPES.has(type))).toBe(true);
    const dir = new URL('../../packages/shared-core/src/modules/', import.meta.url);
    const files = (await readdir(dir, { recursive: true })).filter((file) => file.endsWith('.ts') && !file.endsWith('.test.ts'));
    const sources = await Promise.all(files.map((file) => readFile(new URL(file, dir), 'utf8')));
    const registered = new Set(sources.flatMap((source) => [...source.matchAll(/api\.onAction\(\s*['"]([^'"]+)/g)].map((match) => match[1])));
    expect([...ACTION_TYPES].sort()).toEqual([...registered].sort());
    expect(ACTION_TYPES.size).toBeLessThanOrEqual(256);
    expect(REJECT_CODES.size).toBeLessThanOrEqual(64);
    const gate = new URL('../../packages/action-layer/src/', import.meta.url);
    const gateFiles = (await readdir(gate)).filter((file) => file.endsWith('.ts') && !file.endsWith('.test.ts'));
    const codeSources = [...sources, ...await Promise.all(gateFiles.map((file) => readFile(new URL(file, gate), 'utf8')))].join('\n');
    const codes = new Set([...codeSources.matchAll(/['"](E_[A-Z_]+)['"]/g)].map((match) => match[1]));
    expect([...REJECT_CODES].filter((code) => !codes.has(code))).toEqual([]);
  });

  it('copies process counters once, converts ms to seconds and emits aggregate allowlist only', () => {
    const s = summary();
    s.actions.byType['SECRET-user-token'] = 10;
    s.actions.rejectByCode['SECRET-password'] = 4;
    s.actions.total = 15; s.actions.ok = 9; s.actions.rejected = 6;
    s.economy = { actor: 'SECRET' }; s.end = { winner: 'SECRET' }; s.headers = { Authorization: 'SECRET' };
    const p = projectSource('summary', s);
    expect(sample(p.samples, 'moongame_joins_total')).toBe(7);
    expect(sample(p.samples, 'moongame_submit_duration_seconds_sum')).toBe(0.75);
    expect(sample(p.samples, 'moongame_client_rtt_seconds_max')).toBe(0.15);
    expect(sample(p.samples, 'moongame_action_rejects_total', { code: 'other' })).toBe(4);
    expect(p.rejectedSeries).toBe(1);
    expect(renderMetrics(p.samples)).not.toContain('SECRET');
    expect(renderMetrics(p.samples)).not.toContain('_bucket');
  });

  it('distinguishes no samples from a measured zero and ignores absent optional sources', () => {
    const s = summary();
    s.submitMs = { count: 0, total: 0, max: 0 }; s.clientFps = null; s.clientRttMs = null;
    delete s.telemetry; delete s.journal;
    const p = projectSource('summary', s);
    expect(sample(p.samples, 'moongame_submit_duration_seconds_count')).toBe(0);
    expect(sample(p.samples, 'moongame_submit_duration_seconds_max')).toBeUndefined();
    expect(sample(p.samples, 'moongame_client_fps_count')).toBeUndefined();
    expect(sample(p.samples, 'moongame_telemetry_events_total')).toBeUndefined();
  });

  it('rejects schema drift, inconsistent action totals and invalid mandatory or present optional values', () => {
    for (const invalid of [undefined, NaN, Infinity, -1, '5']) {
      const s = summary(); s.joins = invalid;
      expect(projectSource('summary', s)).toBeNull();
    }
    for (const field of ['submitMs', 'broadcastMs', 'deltaBytes']) {
      const s = summary(); delete s[field].total;
      expect(projectSource('summary', s)).toBeNull();
    }
    const s = summary(); s.actions.total++;
    expect(projectSource('summary', s)).toBeNull();
    const optional = summary(); optional.clientFps.max = -1;
    expect(projectSource('summary', optional)).toBeNull();
    const map = summary(); map.actions.byType = [];
    expect(projectSource('summary', map)).toBeNull();
    expect(projectSource('metrics', { matches: 0, connections: 0 })?.samples).toHaveLength(2);
    expect(projectSource('metrics', { matches: 1 })).toBeNull();
  });

  it('uses fixed destinations, no redirects, body caps and a hard timeout without exposing errors', async () => {
    const observed = [];
    const exporter = createExporter({ token: 'secret', request: async (url, options) => {
      observed.push([url, options]);
      return new Response('x'.repeat(65537));
    } });
    const text = await exporter.scrape();
    expect(text).not.toContain('secret');
    expect(observed.map(([url]) => new URL(url).pathname).sort()).toEqual(['/health', '/metrics', '/metrics/summary', '/ready']);
    expect(observed.every(([, opts]) => opts.redirect === 'error')).toBe(true);
    expect(observed.find(([url]) => url.endsWith('/health'))[1].headers).toEqual({});
    expect(observed.find(([url]) => url.endsWith('/metrics'))[1].headers).toEqual({ Authorization: 'Bearer secret' });
    expect(text.match(/moongame_source_up\{source="\w+"\} 0/g)).toHaveLength(4);
    expect(() => createExporter({ sourcePort: 1.5 })).toThrow('E_OBS_CONFIG');
  });

  it('refuses redirect hops and never forwards the bearer or probes raw endpoints', async () => {
    let leaked = 0;
    const destination = await listen((_req, res) => { leaked++; res.end('{}'); });
    const source = await listen((_req, res) => { res.writeHead(302, { Location: `http://127.0.0.1:${destination.address().port}/` }); res.end(); });
    const output = await createExporter({ sourcePort: source.address().port, token: 'SECRET' }).scrape();
    expect(output).not.toContain('SECRET');
    expect(leaked).toBe(0);
    expect(output.match(/moongame_source_up\{source="\w+"\} 0/g)).toHaveLength(4);
    expect(output).not.toContain('moongame_source_last_success_timestamp_seconds');
  });

  it('enforces the exposition cap even if a later code change bypasses the small catalogs', () => {
    const samples = Array.from({ length: 5001 }, () => ({ name: 'bounded', value: 1, type: 'gauge', labels: {} }));
    expect(() => renderMetrics(samples)).toThrow('E_OBS_BUDGET');
    expect(() => renderMetrics([{ name: 'bounded', value: 1, type: 'gauge', labels: { type: 'x'.repeat(1048576) } }])).toThrow('E_OBS_BUDGET');
  });

  it('removes failed-source values, preserves last success, shares concurrent scrapes and permits reset', async () => {
    let failed = false, calls = 0, timestamp = 100;
    let s = summary();
    const server = await listen((req, res) => {
      calls++;
      if (req.url === '/metrics/summary' && failed) { res.writeHead(404); res.end('SECRET'); return; }
      const body = { '/health': { ok: true, version: 'abc1234' }, '/ready': { ready: false }, '/metrics': { matches: 1, connections: 0 }, '/metrics/summary': s }[req.url];
      res.writeHead(req.url === '/ready' ? 503 : 200); res.end(JSON.stringify(body));
    });
    const options = { sourcePort: server.address().port, now: () => timestamp * 1000 };
    const exporter = createExporter(options);
    const first = await Promise.all([exporter.scrape(), exporter.scrape()]);
    expect(calls).toBe(4); expect(first[0]).toBe(first[1]);
    expect(first[0]).toContain('moongame_game_ready 0');
    expect(first[0]).toContain('moongame_joins_total 7');
    failed = true; timestamp = 120;
    const absent = await exporter.scrape();
    expect(absent).toContain('moongame_source_up{source="summary"} 0');
    expect(absent).toContain('moongame_source_last_success_timestamp_seconds{source="summary"} 100');
    expect(absent).not.toContain('moongame_joins_total');
    failed = false; s = summary(); s.joins = 1;
    expect(await exporter.scrape()).toContain('moongame_joins_total 1');
    expect(await createExporter(options).scrape()).toContain('moongame_joins_total 1');
  });

  it('times out even after headers and serves only the read-only metrics and liveness paths', async () => {
    const source = await listen((_req, res) => { res.writeHead(200); res.write('{'); });
    const exporter = createExporter({ sourcePort: source.address().port, timeoutMs: 70 });
    const started = Date.now();
    const output = await exporter.scrape();
    expect(Date.now() - started).toBeLessThan(1200);
    expect(output).not.toContain('moongame_matches ');
    const endpoint = exporter.server;
    endpoint.listen(0, '127.0.0.1'); await once(endpoint, 'listening');
    closes.push(() => new Promise((resolve) => { endpoint.close(resolve); endpoint.closeAllConnections(); }));
    const base = `http://127.0.0.1:${endpoint.address().port}`;
    expect((await fetch(base + '/health')).status).toBe(200);
    expect((await fetch(base + '/metrics', { method: 'POST' })).status).toBe(404);
    expect((await fetch(base + '/metrics/recent')).status).toBe(404);
    const response = await fetch(base + '/metrics');
    expect(response.headers.get('content-type')).toContain('text/plain');
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it.each(['headers', 'body'])('reports hanging %s before the 2s consumer scrape deadline', async (phase) => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      const untilAbort = (signal) => new Promise((_, reject) => {
        const abort = () => reject(new Error('PRIVATE'));
        if (signal.aborted) abort();
        else signal.addEventListener('abort', abort, { once: true });
      });
      const request = vi.fn((_url, { signal }) => phase === 'headers'
        ? untilAbort(signal)
        : Promise.resolve({
          ok: true, status: 200,
          body: { async *[Symbol.asyncIterator]() { yield Buffer.from('{'); await untilAbort(signal); } },
        }));
      let settled = false;
      const pending = createExporter({ request }).scrape().then((output) => { settled = true; return output; });
      await vi.advanceTimersByTimeAsync(1499);
      expect(settled).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      // Assert before awaiting: a regression to 2000ms must fail, not hang the test.
      expect(settled).toBe(true);
      const output = await pending;
      expect(output.match(/moongame_source_up\{source="\w+"\} 0/g)).toHaveLength(4);
      expect(output).not.toContain('PRIVATE');
      expect(output).not.toContain('moongame_source_last_success_timestamp_seconds');
      expect(vi.getTimerCount()).toBe(0);
      expect(() => createExporter({ timeoutMs: 2000 })).not.toThrow();
      expect(() => createExporter({ timeoutMs: 2001 })).toThrow('E_OBS_CONFIG');
    } finally {
      try { await vi.runAllTimersAsync(); }
      finally { vi.useRealTimers(); }
    }
  });

  it('reads a bounded private plain secret and refuses symlinks or world-readable files', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'obs-secret-'));
    closes.push(() => rm(dir, { recursive: true, force: true }));
    const path = join(dir, 'token'); await writeFile(path, 'a'.repeat(32) + '\n', { mode: 0o600 });
    expect(await readToken(path)).toBe('a'.repeat(32));
    await symlink(path, join(dir, 'link'));
    await expect(readToken(join(dir, 'link'))).rejects.toThrow('E_OBS_CONFIG');
    await chmod(path, 0o644);
    await expect(readToken(path)).rejects.toThrow('E_OBS_CONFIG');
  });
});
