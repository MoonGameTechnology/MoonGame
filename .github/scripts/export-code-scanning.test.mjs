import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { snapshotAlerts, snapshotMarkdown } from './export-code-scanning.mjs';

const reply = (data) => ({ ok: true, json: async () => data });
const alert = (number) => ({
  number,
  state: 'open',
  html_url: `https://github.com/o/r/security/code-scanning/${number}`,
  tool: { name: 'CodeQL' },
  rule: { id: 'js/test', severity: 'warning', security_severity_level: 'high' },
  most_recent_instance: {
    location: { path: 'src/app.ts', start_line: 2, end_line: 3 },
    message: { text: 'do not export this secret' },
  },
  secret: 'do not export this secret',
});
function options(pages) {
  const calls = [];
  return {
    calls,
    repo: 'o/r',
    token: 'test-token-never-logged',
    now: () => '2026-11-07T08:00:00Z',
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      if (url.endsWith('/o/r')) return reply({ default_branch: 'main' });
      if (url.includes('/commits/')) return reply({ sha: 'a'.repeat(40) });
      const page = Number(new URL(url).searchParams.get('page'));
      const result = pages[page - 1];
      if (result instanceof Error) throw result;
      return Array.isArray(result) ? reply(result) : result;
    },
  };
}

describe('read-only Code scanning inventory', () => {
  it('reads all pages and exports metadata without secrets, snippets or messages', async () => {
    const args = options([Array.from({ length: 100 }, (_, n) => alert(n + 1)), [alert(101)]]);
    const result = await snapshotAlerts(args);
    expect(result.available).toBe(true);
    expect(result.count).toBe(101);
    expect(result.byTool).toEqual({ CodeQL: 101 });
    expect(result.bySecuritySeverity).toEqual({ high: 101 });
    expect(result.observedDefaultBranchSha).toBe('a'.repeat(40));
    expect(result.alerts[100].location).toEqual({ path: 'src/app.ts', startLine: 2, endLine: 3 });
    expect(JSON.stringify(result)).not.toContain('do not export this secret');
    expect(JSON.stringify(result)).not.toContain(args.token);
    expect(args.calls).toHaveLength(4);
    for (const call of args.calls) {
      expect(call.init.redirect).toBe('error');
      expect(call.init.headers.authorization).toBe(`Bearer ${args.token}`);
      expect(call.url).toMatch(/^https:\/\/api\.github\.com\/repos\/o\/r/);
    }
    expect(args.calls[2].url).toContain('ref=refs%2Fheads%2Fmain');
    expect(snapshotMarkdown(result)).toContain('**101**');
  });
  it('distinguishes a complete zero from unavailable data', async () => {
    expect(await snapshotAlerts(options([[]]))).toMatchObject({
      available: true,
      count: 0,
      alerts: [],
    });
    const denied = await snapshotAlerts(options([{ ok: false, status: 403 }]));
    expect(denied).toMatchObject({ available: false, count: null, error: 'E_GITHUB_HTTP_403' });
    expect(snapshotMarkdown(denied)).toContain('Число находок неизвестно');
  });
  it('never presents a partial export as a complete total', async () => {
    const result = await snapshotAlerts(
      options([Array.from({ length: 100 }, (_, n) => alert(n + 1)), { ok: false, status: 500 }]),
    );
    expect(result).toMatchObject({
      available: false,
      count: null,
      alerts: [],
      byTool: {},
      error: 'E_GITHUB_HTTP_500',
    });
  });
  it('rejects invalid responses and duplicated alerts', async () => {
    expect(await snapshotAlerts(options([reply({})]))).toMatchObject({
      available: false,
      error: 'E_INVALID_PAGE',
    });
    expect(await snapshotAlerts(options([[alert(1), alert(1)]]))).toMatchObject({
      available: false,
      count: null,
      error: 'E_DUPLICATE_ALERT',
    });
    expect(await snapshotAlerts(options([[{ ...alert(1), state: 'dismissed' }]]))).toMatchObject({
      available: false,
      error: 'E_INVALID_ALERT',
    });
  });
  it('does not expose transport errors or send a token for invalid repository input', async () => {
    const args = options([new Error('secret response test-token-never-logged')]);
    expect(await snapshotAlerts(args)).toMatchObject({ available: false, error: 'E_REQUEST' });
    args.calls.length = 0;
    expect(await snapshotAlerts({ ...args, repo: 'https://other.test' })).toMatchObject({
      available: false,
      error: 'E_REPOSITORY',
    });
    expect(args.calls).toEqual([]);
  });
  it('uses trusted default-branch code and no write permissions in workflow_run context', () => {
    const yaml = readFileSync(new URL('../workflows/security-alerts.yml', import.meta.url), 'utf8');
    expect(yaml).toContain('ref: ${{ github.event.repository.default_branch }}');
    expect(yaml).not.toMatch(/:\s*write\b/);
    expect(yaml).not.toContain('head_sha');
    expect(yaml).not.toContain('pull_request_target');
    expect(yaml).toContain('security-events: read');
    expect(yaml).toContain('if-no-files-found: error');
  });
});
