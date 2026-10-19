import { describe, expect, it } from 'vitest';
import { bakeServer, parseServer } from './siteServer.mjs';

const PAGE = '<!doctype html><head><script>boot()</script></head><body></body>';

describe('game server baked into the Cloudflare site', () => {
  it('keeps only the scheme and host of an https or wss address', () => {
    expect(parseServer('https://play.example.com/matches?x=1')).toBe('https://play.example.com');
    expect(parseServer('wss://77-221-140-87.sslip.io')).toBe('wss://77-221-140-87.sslip.io');
    expect(parseServer(undefined)).toBeUndefined();
    expect(parseServer('')).toBeUndefined();
  });

  it('fails the build on a plain or broken address', () => {
    expect(() => parseServer('ws://play.example.com')).toThrow(/https:\/\/ or wss:\/\//);
    expect(() => parseServer('http://play.example.com')).toThrow(/https:\/\/ or wss:\/\//);
    expect(() => parseServer('play.example.com')).toThrow(/absolute URL/);
  });

  it('bakes only the server field, so the APK updater stays dormant', () => {
    const html = bakeServer(PAGE, 'wss://play.example.com');
    expect(html).toContain(
      '<script>window.__BUILD__={"server":"wss://play.example.com"};</script></head>',
    );
    const baked = /window\.__BUILD__=(\{[^<]*\});/.exec(html)![1]!;
    expect(JSON.parse(baked)).toEqual({ server: 'wss://play.example.com' });
  });

  it('leaves the page alone without a server', () => {
    expect(bakeServer(PAGE, undefined)).toBe(PAGE);
  });
});
