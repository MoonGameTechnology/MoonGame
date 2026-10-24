// Optional sideload updates from our HTTPS site. Never a dependency of game boot.
// RuStore builds keep their store channel; browser builds do not check APK versions.
import distribution from '../../mobile/distribution.json';

export interface BuildInfo {
  versionCode: number;
  sha: string;
  versionName?: string;
}
export interface UpdateInfo extends BuildInfo {
  versionName: string;
  apkUrl: string;
  notes: string;
  /** Checked by the native installer against the downloaded bytes before install. */
  apkSha256: string;
}
declare const __PLAYER_BUILD__: boolean | undefined;
export const RELEASE_LANE = typeof __PLAYER_BUILD__ !== 'undefined' && __PLAYER_BUILD__ === true ? 'player' : 'alpha';
export const DOWNLOAD_ROOT = `${distribution.origin}${distribution.basePath}`;
export const VERSION_URL = `${DOWNLOAD_ROOT}/${RELEASE_LANE}/latest.json`;
const APP_IDS = { alpha: 'com.voiddominion.prototype', player: 'com.voiddominion.player' } as const;
const validCode = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n) && n > 0 && n <= 2100000000;
interface GlobalWithBuild {
  __BUILD__?: { versionCode?: unknown; versionName?: unknown; sha?: unknown; server?: unknown; channel?: unknown; privacyUrl?: unknown };
}
export function isRuStoreBuild(): boolean {
  return (globalThis as GlobalWithBuild).__BUILD__?.channel === 'rustore';
}
export function currentBuild(): BuildInfo | null {
  const b = (globalThis as GlobalWithBuild).__BUILD__;
  if (!b || !validCode(b.versionCode)) return null;
  return { versionCode: b.versionCode, sha: typeof b.sha === 'string' ? b.sha : '',
    ...(typeof b.versionName === 'string' ? { versionName: b.versionName } : {}) };
}
export function bakedServer(): string | null {
  const server = (globalThis as GlobalWithBuild).__BUILD__?.server;
  return typeof server === 'string' && server ? server : null;
}

/** Only immutable APKs from this application's lane at the configured HTTPS origin. */
export function isTrustedApkUrl(url: string): boolean {
  try {
    const u = new URL(url);
    const base = `${distribution.basePath}/${RELEASE_LANE}/`;
    return u.origin === distribution.origin && !u.username && !u.password && !u.search && !u.hash &&
      u.pathname.startsWith(base) && new RegExp(`^[1-9][0-9]*-[a-f0-9]{7,40}/void-dominion-${RELEASE_LANE}\\.apk$`).test(u.pathname.slice(base.length));
  } catch { return false; }
}
export function parseVersion(value: unknown): UpdateInfo | null {
  if (!value || typeof value !== 'object') return null;
  const r = value as Record<string, unknown>;
  if (!validCode(r.versionCode) || typeof r.versionName !== 'string' || !r.versionName.trim() || r.versionName.length > 80 ||
      typeof r.sha !== 'string' || !/^[a-f0-9]{7,40}$/.test(r.sha) ||
      typeof r.notes !== 'string' || r.notes.length > 8192 || typeof r.apkUrl !== 'string' || !isTrustedApkUrl(r.apkUrl) ||
      typeof r.apkSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(r.apkSha256) || r.appId !== APP_IDS[RELEASE_LANE]) return null;
  const expected = `${DOWNLOAD_ROOT}/${RELEASE_LANE}/${r.versionCode}-${r.sha}/void-dominion-${RELEASE_LANE}.apk`;
  if (r.apkUrl !== expected) return null;
  return { versionCode: r.versionCode, versionName: r.versionName, sha: r.sha, apkUrl: r.apkUrl, notes: r.notes, apkSha256: r.apkSha256 };
}

/** Thrown when this WebView cannot verify Ed25519 at all — distinct from a forged file. */
class NoEd25519 extends Error {}
const fromBase64 = (text: string): Uint8Array | null => {
  try {
    const bytes = Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
    return btoa(String.fromCharCode(...bytes)) === text ? bytes : null;
  } catch { return null; }
};
/**
 * The site serves `{payload, signature}`: a manifest signed in CI with a key the download
 * host never holds. Only the exact signed bytes are parsed, so a compromised host can at
 * most withhold updates, not point this APK at other bytes.
 */
export async function openSignedVersion(value: unknown, publicKey: string = distribution.manifestPublicKey): Promise<UpdateInfo | null> {
  if (!value || typeof value !== 'object') return null;
  const { payload, signature } = value as Record<string, unknown>;
  if (typeof payload !== 'string' || typeof signature !== 'string') return null;
  const key = fromBase64(publicKey), data = fromBase64(payload), sig = fromBase64(signature);
  if (!key || key.length !== 32 || !data || !sig || sig.length !== 64) return null;
  let ok: boolean;
  try {
    const subtle = globalThis.crypto?.subtle;
    if (!subtle) throw new NoEd25519();
    const cryptoKey = await subtle.importKey('raw', key as BufferSource, { name: 'Ed25519' }, false, ['verify'])
      .catch(() => { throw new NoEd25519(); });
    ok = await subtle.verify({ name: 'Ed25519' }, cryptoKey, sig as BufferSource, data as BufferSource);
  } catch (e) {
    if (e instanceof NoEd25519) throw e;
    return null;
  }
  if (!ok) return null;
  try { return parseVersion(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(data))); } catch { return null; }
}
export function isNewer(local: BuildInfo, remote: UpdateInfo): boolean { return remote.versionCode > local.versionCode; }
export type UpdateCheck =
  | { kind: 'dormant' }
  | { kind: 'offline'; error: string }
  | { kind: 'http'; status: number }
  | { kind: 'unparsable' }
  | { kind: 'unverified' }
  | { kind: 'unsupported' }
  | { kind: 'current'; local: number; remote: number }
  | { kind: 'update'; info: UpdateInfo; local: number };

async function readJson(res: Response): Promise<unknown> {
  const reader = res.body?.getReader();
  if (!reader) return null;
  const chunks: Uint8Array[] = []; let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 32768) return null;
      chunks.push(value);
    }
    const body = new Uint8Array(bytes); let offset = 0;
    for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
    return JSON.parse(new TextDecoder().decode(body));
  } finally { await reader.cancel().catch(() => {}); }
}
export async function checkForUpdateDetailed(fetchImpl: typeof fetch = fetch, publicKey: string = distribution.manifestPublicKey): Promise<UpdateCheck> {
  if (isRuStoreBuild()) return { kind: 'dormant' };
  const local = currentBuild();
  if (!local) return { kind: 'dormant' };
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), 5000);
  try {
    const res = await fetchImpl(VERSION_URL, { cache: 'no-store', credentials: 'omit', redirect: 'error',
      headers: { Accept: 'application/json' }, signal: abort.signal });
    if (!res.ok) return { kind: 'http', status: res.status };
    let body: unknown;
    try { body = await readJson(res); } catch { body = null; }
    if (!body) return { kind: 'unparsable' };
    let remote: UpdateInfo | null;
    try { remote = await openSignedVersion(body, publicKey); } catch { return { kind: 'unsupported' }; }
    if (!remote) return { kind: 'unverified' };
    return isNewer(local, remote) ? { kind: 'update', info: remote, local: local.versionCode }
      : { kind: 'current', local: local.versionCode, remote: remote.versionCode };
  } catch { return { kind: 'offline', error: 'E_UPDATE_UNAVAILABLE' }; }
  finally { clearTimeout(timer); }
}
export async function checkForUpdate(fetchImpl: typeof fetch = fetch, publicKey: string = distribution.manifestPublicKey): Promise<UpdateInfo | null> {
  const result = await checkForUpdateDetailed(fetchImpl, publicKey);
  return result.kind === 'update' ? result.info : null;
}
export function buildLabel(build: BuildInfo): string {
  return build.versionName || (build.sha ? `${isRuStoreBuild() ? 'rustore' : RELEASE_LANE}-${build.sha}` : String(build.versionCode));
}
