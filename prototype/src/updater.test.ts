import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildLabel, checkForUpdate, checkForUpdateDetailed, currentBuild, isNewer, isTrustedApkUrl, openSignedVersion, parseVersion, VERSION_URL, type UpdateInfo } from './updater';
const g = globalThis as { __BUILD__?: unknown };
const root = 'https://77-221-140-87.sslip.io/downloads/android';
const apkSha256 = 'a'.repeat(64);
const manifest = (versionCode = 42) => ({ versionCode, versionName: 'alpha-deadbee', sha: 'deadbee',
  apkUrl: `${root}/alpha/${versionCode}-deadbee/void-dominion-alpha.apk`, notes: 'Changes', apkSha256 });
// The site serves what CI signed; `appId`/`signerSha256` travel along but are not shown to the player.
const published = (versionCode = 42) => ({ ...manifest(versionCode), appId: 'com.voiddominion.prototype', signerSha256: 'b'.repeat(64) });
const b64 = (bytes: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(bytes)));
const keyPair = async () => {
  const pair = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']) as CryptoKeyPair;
  return { privateKey: pair.privateKey, publicKey: b64(await crypto.subtle.exportKey('raw', pair.publicKey)) };
};
const keys = await keyPair(), stranger = await keyPair();
const sign = async (value: unknown, key = keys.privateKey) => {
  const payload = new TextEncoder().encode(JSON.stringify(value));
  return { payload: b64(payload), signature: b64(await crypto.subtle.sign({ name: 'Ed25519' }, key, payload)) };
};
const fetchOk = (value: unknown): typeof fetch => vi.fn(async () => new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } })) as typeof fetch;
const fetchSigned = async (value: unknown = published()) => fetchOk(await sign(value));
afterEach(() => { delete g.__BUILD__; vi.useRealTimers(); });
describe('site APK version contract', () => {
  it('accepts versionCode, versionName, immutable same-site APK, its digest and notes', () => expect(parseVersion(published())).toEqual(manifest()));
  it.each([
    { versionCode: -1 }, { versionCode: 1.5 }, { versionCode: 2100000001 }, { versionCode: '42' },
    { versionName: '' }, { notes: 'x'.repeat(8193) }, { sha: 'not-a-sha' },
    { apkUrl: 'https://github.com/a/b/app.apk' }, { apkUrl: `${root}/player/42-deadbee/void-dominion-player.apk` },
    { apkUrl: `${root}/alpha/41-deadbee/void-dominion-alpha.apk` },
    { apkSha256: 'A'.repeat(64) }, { apkSha256: 'a'.repeat(63) }, { apkSha256: undefined }, { appId: 'com.voiddominion.player' },
  ])('rejects invalid or mixed release metadata: %j', (patch) => expect(parseVersion({ ...published(), ...patch })).toBeNull());
  it('rejects malformed JSON values', () => { for (const x of [null, [], 'version']) expect(parseVersion(x)).toBeNull(); });
  it('allows only HTTPS APK paths at the configured server', () => {
    expect(isTrustedApkUrl(manifest().apkUrl)).toBe(true);
    for (const url of [manifest().apkUrl.replace('https:', 'http:'), manifest().apkUrl+'?x=1', manifest().apkUrl+'#x', 'https://77-221-140-87.sslip.io.evil.test/a.apk', 'https://user@77-221-140-87.sslip.io/downloads/android/alpha/42-deadbee/void-dominion-alpha.apk']) expect(isTrustedApkUrl(url)).toBe(false);
  });
});
describe('signed by CI, not trusted because of the host', () => {
  it('opens exactly the bytes the CI key signed', async () => {
    expect(await openSignedVersion(await sign(published()), keys.publicKey)).toEqual(manifest());
  });
  it('refuses a manifest signed by any other key, edited, or unsigned', async () => {
    const good = await sign(published());
    const other = await sign(published(43));
    for (const forged of [
      await sign(published(), stranger.privateKey), { ...good, payload: other.payload }, { payload: good.payload },
      { ...good, signature: good.signature.slice(4) }, published(), null, 'x',
    ]) expect(await openSignedVersion(forged, keys.publicKey)).toBeNull();
  });
  it('a valid signature does not excuse invalid metadata', async () => {
    expect(await openSignedVersion(await sign({ ...published(), apkUrl: 'https://evil.test/a.apk' }), keys.publicKey)).toBeNull();
  });
  it('without a baked key nothing is ever offered', async () => {
    expect(await openSignedVersion(await sign(published()), '')).toBeNull();
  });
  it('a WebView without Ed25519 says so instead of passing or blaming the file', async () => {
    g.__BUILD__ = { versionCode: 41 };
    const importKey = vi.spyOn(crypto.subtle, 'importKey').mockRejectedValue(new Error('NotSupportedError'));
    try { expect(await checkForUpdateDetailed(await fetchSigned(), keys.publicKey)).toEqual({ kind: 'unsupported' }); }
    finally { importKey.mockRestore(); }
  });
  it('a forged file is reported as such and never offered', async () => {
    g.__BUILD__ = { versionCode: 41 };
    expect(await checkForUpdateDetailed(fetchOk(await sign(published(), stranger.privateKey)), keys.publicKey)).toEqual({ kind: 'unverified' });
    expect(await checkForUpdateDetailed(fetchOk(published()), keys.publicKey)).toEqual({ kind: 'unverified' });
  });
});
describe('optional update, never a boot dependency', () => {
  it('checks only our server and bypasses caches without cookies', async () => {
    g.__BUILD__ = { versionCode: 41, sha: 'abc1234' }; const fetcher = await fetchSigned();
    expect((await checkForUpdate(fetcher, keys.publicKey))?.versionCode).toBe(42);
    expect(fetcher).toHaveBeenCalledWith(VERSION_URL, expect.objectContaining({ cache: 'no-store', credentials: 'omit', redirect: 'error' }));
    expect(VERSION_URL).toBe(`${root}/alpha/latest.json`);
  });
  it.each([42, 43])('equal or older remote does not prompt (%s)', async (versionCode) => {
    g.__BUILD__ = { versionCode }; expect(await checkForUpdate(await fetchSigned(), keys.publicKey)).toBeNull();
  });
  it('browser and store APK never fetch sideload updates', async () => {
    const fetcher = await fetchSigned(); expect(await checkForUpdateDetailed(fetcher)).toEqual({ kind: 'dormant' });
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
    for (const text of ['not json', ' '.repeat(32769)]) expect((await checkForUpdateDetailed(vi.fn(async () => new Response(text)))).kind).toBe('unparsable');
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
