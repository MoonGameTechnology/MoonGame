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
}
declare const __PLAYER_BUILD__: boolean | undefined;
export const RELEASE_LANE = typeof __PLAYER_BUILD__ !== 'undefined' && __PLAYER_BUILD__ === true ? 'player' : 'alpha';
export const DOWNLOAD_ROOT = `${distribution.origin}${distribution.basePath}`;
export const VERSION_URL = `${DOWNLOAD_ROOT}/${RELEASE_LANE}/latest.json`;
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
      typeof r.notes !== 'string' || r.notes.length > 8192 || typeof r.apkUrl !== 'string' || !isTrustedApkUrl(r.apkUrl)) return null;
  const expected = `${DOWNLOAD_ROOT}/${RELEASE_LANE}/${r.versionCode}-${r.sha}/void-dominion-${RELEASE_LANE}.apk`;
  if (r.apkUrl !== expected) return null;
  return { versionCode: r.versionCode, versionName: r.versionName, sha: r.sha, apkUrl: r.apkUrl, notes: r.notes };
}
export function isNewer(local: BuildInfo, remote: UpdateInfo): boolean { return remote.versionCode > local.versionCode; }
export type UpdateCheck =
  | { kind: 'dormant' }
  | { kind: 'offline'; error: string }
  | { kind: 'http'; status: number }
  | { kind: 'unparsable' }
  | { kind: 'current'; local: number; remote: number }
  | { kind: 'update'; info: UpdateInfo; local: number };

async function readVersion(res: Response): Promise<UpdateInfo | null> {
  const reader = res.body?.getReader();
  if (!reader) return null;
  const chunks: Uint8Array[] = []; let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 16384) return null;
      chunks.push(value);
    }
    const body = new Uint8Array(bytes); let offset = 0;
    for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
    return parseVersion(JSON.parse(new TextDecoder().decode(body)));
  } finally { await reader.cancel().catch(() => {}); }
}
export async function checkForUpdateDetailed(fetchImpl: typeof fetch = fetch): Promise<UpdateCheck> {
  if (isRuStoreBuild()) return { kind: 'dormant' };
  const local = currentBuild();
  if (!local) return { kind: 'dormant' };
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), 5000);
  try {
    const res = await fetchImpl(VERSION_URL, { cache: 'no-store', credentials: 'omit', redirect: 'error',
      headers: { Accept: 'application/json' }, signal: abort.signal });
    if (!res.ok) return { kind: 'http', status: res.status };
    let remote: UpdateInfo | null;
    try { remote = await readVersion(res); } catch { remote = null; }
    if (!remote) return { kind: 'unparsable' };
    return isNewer(local, remote) ? { kind: 'update', info: remote, local: local.versionCode }
      : { kind: 'current', local: local.versionCode, remote: remote.versionCode };
  } catch { return { kind: 'offline', error: 'E_UPDATE_UNAVAILABLE' }; }
  finally { clearTimeout(timer); }
}
export async function checkForUpdate(fetchImpl: typeof fetch = fetch): Promise<UpdateInfo | null> {
  const result = await checkForUpdateDetailed(fetchImpl);
  return result.kind === 'update' ? result.info : null;
}
export function buildLabel(build: BuildInfo): string {
  return build.versionName || (build.sha ? `${isRuStoreBuild() ? 'rustore' : RELEASE_LANE}-${build.sha}` : String(build.versionCode));
}
