import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildLabel, checkForUpdate, checkForUpdateDetailed, currentBuild, isNewer, isTrustedApkUrl, parseVersion, VERSION_URL, type UpdateInfo } from './updater';
const g = globalThis as { __BUILD__?: unknown };
const root = 'https://77-221-140-87.sslip.io/downloads/android';
const manifest = (versionCode = 42) => ({ versionCode, versionName: 'alpha-deadbee', sha: 'deadbee',
  apkUrl: `${root}/alpha/${versionCode}-deadbee/void-dominion-alpha.apk`, notes: 'Changes' });
const fetchOk = (value: unknown): typeof fetch => vi.fn(async () => new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } })) as typeof fetch;
afterEach(() => { delete g.__BUILD__; vi.useRealTimers(); });
describe('site APK version contract', () => {
  it('accepts versionCode, versionName, immutable same-site APK and notes', () => expect(parseVersion(manifest())).toEqual(manifest()));
  it.each([
    { versionCode: -1 }, { versionCode: 1.5 }, { versionCode: 2100000001 }, { versionCode: '42' },
    { versionName: '' }, { notes: 'x'.repeat(8193) }, { sha: 'not-a-sha' },
    { apkUrl: 'https://github.com/a/b/app.apk' }, { apkUrl: `${root}/player/42-deadbee/void-dominion-player.apk` },
    { apkUrl: `${root}/alpha/41-deadbee/void-dominion-alpha.apk` },
  ])('rejects invalid or mixed release metadata: %j', (patch) => expect(parseVersion({ ...manifest(), ...patch })).toBeNull());
  it('rejects malformed JSON values', () => { for (const x of [null, [], 'version']) expect(parseVersion(x)).toBeNull(); });
  it('allows only HTTPS APK paths at the configured server', () => {
    expect(isTrustedApkUrl(manifest().apkUrl)).toBe(true);
    for (const url of [manifest().apkUrl.replace('https:', 'http:'), manifest().apkUrl+'?x=1', manifest().apkUrl+'#x', 'https://77-221-140-87.sslip.io.evil.test/a.apk', 'https://user@77-221-140-87.sslip.io/downloads/android/alpha/42-deadbee/void-dominion-alpha.apk']) expect(isTrustedApkUrl(url)).toBe(false);
  });
});
describe('optional update, never a boot dependency', () => {
  it('checks only our server and bypasses caches without cookies', async () => {
    g.__BUILD__ = { versionCode: 41, sha: 'abc1234' }; const fetcher = fetchOk(manifest());
    expect((await checkForUpdate(fetcher))?.versionCode).toBe(42);
    expect(fetcher).toHaveBeenCalledWith(VERSION_URL, expect.objectContaining({ cache: 'no-store', credentials: 'omit', redirect: 'error' }));
    expect(VERSION_URL).toBe(`${root}/alpha/latest.json`);
  });
  it.each([42, 43])('equal or older remote does not prompt (%s)', async (versionCode) => {
    g.__BUILD__ = { versionCode }; expect(await checkForUpdate(fetchOk(manifest()))).toBeNull();
  });
  it('browser and store APK never fetch sideload updates', async () => {
    const fetcher = fetchOk(manifest()); expect(await checkForUpdateDetailed(fetcher)).toEqual({ kind: 'dormant' });
    g.__BUILD__ = { versionCode: 1, channel: 'rustore' }; expect(await checkForUpdateDetailed(fetcher)).toEqual({ kind: 'dormant' });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('network failure is harmless and diagnosable', async () => {
    g.__BUILD__ = { versionCode: 1 }; const bad = vi.fn(async () => { throw Error('offline'); });
    expect((await checkForUpdateDetailed(bad)).kind).toBe('offline'); expect(await checkForUpdate(bad)).toBeNull();
  });
  it('keeps HTTP failure distinct from current', async () => {
    g.__BUILD__ = { versionCode: 1 };
    expect(await checkForUpdateDetailed(vi.fn(async () => new Response('', { status: 503 })))).toEqual({ kind: 'http', status: 503 });
  });
  it('rejects corrupt and oversized responses', async () => {
    g.__BUILD__ = { versionCode: 1 };
    for (const text of ['not json', ' '.repeat(16385)]) expect((await checkForUpdateDetailed(vi.fn(async () => new Response(text)))).kind).toBe('unparsable');
  });
  it('aborts a hanging request instead of holding boot forever', async () => {
    vi.useFakeTimers(); g.__BUILD__ = { versionCode: 1 };
    const fetcher: typeof fetch = vi.fn((_url, init) => new Promise<Response>((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(Error('timeout')))));
    const result = checkForUpdate(fetcher); await vi.advanceTimersByTimeAsync(5000); expect(await result).toBeNull();
  });
});
it('reads optional versionName and rejects invalid installed version codes', () => {
  g.__BUILD__ = { versionCode: 1, sha: 'abc1234', versionName: 'alpha-abc1234' };
  expect(buildLabel(currentBuild()!)).toBe('alpha-abc1234');
  for (const versionCode of [0, -1, 1.5, '2', NaN]) { g.__BUILD__ = { versionCode }; expect(currentBuild()).toBeNull(); }
});
it('comparison depends only on Android versionCode', () => {
  expect(isNewer({ versionCode: 41, sha: '' }, manifest() as UpdateInfo)).toBe(true);
  expect(isNewer({ versionCode: 42, sha: '' }, manifest() as UpdateInfo)).toBe(false);
});
