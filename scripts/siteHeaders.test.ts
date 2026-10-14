import { describe, expect, it } from 'vitest';
import { COMMON_HEADERS, headersFile, pagePaths, pagePolicy } from './siteHeaders.mjs';
import { inlineHashes, securityHeaders } from '../packages/server/src/securityHeaders';

const PAGE = '<!doctype html><style>b{color:red}</style><script>boot()</script><script></script>';

describe('static site headers (Cloudflare `_headers`)', () => {
  it("is the server's page policy with `https:` added to connect-src", () => {
    const server = securityHeaders({ inline: inlineHashes(PAGE), https: true });
    const expected = server['content-security-policy']!.replace(
      "connect-src 'self' wss:",
      "connect-src 'self' https: wss:",
    );
    expect(pagePolicy(PAGE)).toBe(expected);
  });

  it("carries the server's other page headers, HSTS included", () => {
    const server = securityHeaders({ inline: inlineHashes(PAGE), https: true });
    const lower = Object.fromEntries(
      Object.entries(COMMON_HEADERS).map(([k, v]) => [k.toLowerCase(), v]),
    );
    const { 'content-security-policy': _csp, ...rest } = server;
    expect(lower).toEqual(rest);
  });

  it('answers each page on its bare and .html paths', () => {
    expect(pagePaths('index.html')).toEqual(['/', '/index.html']);
    expect(pagePaths('player.html')).toEqual(['/player', '/player.html']);
  });

  it('sets the CSP once per path, from that page', () => {
    const file = headersFile({ 'index.html': PAGE, 'player.html': '<script>other()</script>' });
    const rules = file.trim().split('\n\n');
    expect(rules[0]!.startsWith('/*\n')).toBe(true);
    expect(rules[0]).not.toContain('Content-Security-Policy');
    const csp = (path: string): string[] =>
      rules.filter((r) => r.split('\n')[0] === path).map((r) => r.split('\n')[1]!);
    expect(csp('/')).toEqual([`  Content-Security-Policy: ${pagePolicy(PAGE)}`]);
    expect(csp('/player')).toEqual([
      `  Content-Security-Policy: ${pagePolicy('<script>other()</script>')}`,
    ]);
    expect(pagePolicy(PAGE)).not.toBe(pagePolicy('<script>other()</script>'));
  });
});
