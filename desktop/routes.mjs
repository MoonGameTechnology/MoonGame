// Pure request routing for the `app://` scheme the desktop window loads the game from.
// Kept apart from `main.mjs` so it can be tested without Electron.
//
// Why a custom scheme and not `file://`: the platform build fetches its language file
// (`assets/locale-<id>.json`) and starts the sim worker from a file next to the page —
// Chromium blocks both on `file://`. A privileged standard scheme behaves like a normal
// origin (fetch, workers, a persistent localStorage for saves).
import { extname, normalize, sep } from 'node:path';

export const SCHEME = 'app';
export const HOST = 'game';
export const START_URL = `${SCHEME}://${HOST}/index.html`;

/**
 * The Yandex Games loader tag (`<script async src="/sdk.js" onload="initSDK()">`) stays in
 * the page exactly as moderation requires. Off the platform there is no SDK, so `/sdk.js`
 * answers with a loader that has no platform behind it: `YaGames.init()` resolves `null`,
 * and `prototype/src/platform/host.ts` silently picks the web adapter (ads and purchases
 * `unavailable`).
 *
 * Why not a 404 or an empty script: `bootstrap.ts` waits for either `window.YaGames` or the
 * `ya-sdk-ready` event. On a cold start the local `/sdk.js` loads before the game bundle, so
 * the event fires before anyone listens, and without `YaGames` the game sat out the whole
 * SDK ceiling (3 s) on every launch. With `YaGames` defined it starts at once in either order.
 */
export const SDK_STUB =
  '// No Yandex Games SDK on desktop: init() yields no platform, the game uses the web one.\n' +
  'window.YaGames = { init: () => Promise.resolve(null) };\n';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.wasm': 'application/wasm',
};

export const contentType = (file) =>
  TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream';

/**
 * Map a request URL to what to serve. Anything outside `app://game/` or outside the web
 * root is `not-found` — fail-secure, never a file from elsewhere on the disk.
 *
 * @param {string} url
 * @param {string} root absolute path of the staged web root (`desktop/www`)
 * @returns {{ kind: 'file', path: string, type: string } | { kind: 'sdk-stub', type: string } | { kind: 'not-found' }}
 */
export function resolveRequest(url, root) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return { kind: 'not-found' };
  }
  if (parsed.protocol !== `${SCHEME}:` || parsed.host !== HOST) return { kind: 'not-found' };
  let pathname;
  try {
    pathname = decodeURIComponent(parsed.pathname);
  } catch {
    return { kind: 'not-found' };
  }
  if (pathname.includes('\0')) return { kind: 'not-found' };
  if (pathname === '/sdk.js') return { kind: 'sdk-stub', type: TYPES['.js'] };
  if (pathname === '/' || pathname === '') pathname = '/index.html';
  const base = normalize(root.endsWith(sep) ? root : root + sep);
  const file = normalize(base + pathname.replace(/^\/+/, ''));
  if (!file.startsWith(base)) return { kind: 'not-found' };
  return { kind: 'file', path: file, type: contentType(file) };
}
