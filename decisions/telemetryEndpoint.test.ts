import { describe, expect, it } from 'vitest';
import { telemetryTarget } from './telemetryEndpoint';

const page = (protocol: string, host: string, port = '') => ({
  protocol,
  host: port ? `${host}:${port}` : host,
  hostname: host,
  port,
});

const telemetryUrl = (...a: Parameters<typeof telemetryTarget>) => telemetryTarget(...a)?.url ?? null;

describe('telemetryTarget', () => {
  it('a deployed https page posts to its own site', () => {
    expect(telemetryUrl(null, page('https:', 'play.example'))).toBe('https://play.example/telemetry');
  });

  it('a page served by the prototype server posts to that port', () => {
    expect(telemetryUrl(null, page('http:', '10.0.0.5', '8788'))).toBe('http://10.0.0.5:8788/telemetry');
  });

  it('a file page or the APK falls back to :8788', () => {
    expect(telemetryUrl(null, page('file:', ''))).toBe('http://127.0.0.1:8788/telemetry');
  });

  it('a remembered server wins, normalized like the sign-in box', () => {
    expect(telemetryUrl('wss://friend.example/matches', page('https:', 'play.example'))).toBe(
      'https://friend.example/telemetry',
    );
    expect(telemetryUrl('ws://friend.example', page('https:', 'play.example'))).toBe(
      'https://friend.example/telemetry',
    );
  });

  it('the base is the socket address the session is stored under', () => {
    expect(telemetryTarget(null, page('https:', 'play.example'))?.base).toBe('wss://play.example');
  });

  it('an unparseable remembered address sends nowhere', () => {
    expect(telemetryUrl('ws://exa mple', page('https:', 'play.example'))).toBeNull();
  });
});
