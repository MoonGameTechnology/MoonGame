/**
 * Security headers for the static site Cloudflare serves (`wrangler.jsonc`), written as the
 * `_headers` file next to the staged pages.
 *
 * The game server already sends these headers with the same document
 * (`packages/server/src/securityHeaders.ts`), but the Cloudflare copy went out with none: an
 * XSS there ran unrestricted and could read the session token from `localStorage`. The policy
 * here is the server's one with a single difference: `connect-src` also allows `https:`. On
 * Cloudflare the game server is another origin, and the client calls its HTTP API by the
 * address the player chose, so `'self'` alone would cut it off. `siteHeaders.test.ts` keeps
 * the two policies in step.
 *
 * Hashes come from the staged text itself, so a rebuilt page gets a matching policy.
 */
import { createHash } from 'node:crypto';

const TAG_RE = (tag) => new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'gi');

/** `'sha256-…'` of every non-empty inline block of `tag`, as CSP reads it. */
function hashes(html, tag) {
  const out = [];
  for (const m of html.matchAll(TAG_RE(tag))) {
    const body = m[1] ?? '';
    if (body.trim() !== '') {
      out.push(`'sha256-${createHash('sha256').update(body, 'utf8').digest('base64')}'`);
    }
  }
  return out;
}

/** The page's CSP: the server's policy, plus `https:` in `connect-src`. */
export function pagePolicy(html) {
  const scripts = hashes(html, 'script');
  const styles = hashes(html, 'style');
  return [
    "default-src 'none'",
    `script-src ${scripts.join(' ') || "'none'"}`,
    `style-src ${styles.join(' ') || "'none'"}`,
    "style-src-attr 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self' data:",
    "connect-src 'self' https: wss:",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
    "object-src 'none'",
    "worker-src 'none'",
  ].join('; ');
}

/** Headers every response gets, whatever the path. */
export const COMMON_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Permissions-Policy':
    'geolocation=(), camera=(), microphone=(), payment=(), usb=(), serial=(), midi=(), display-capture=()',
  'Cross-Origin-Opener-Policy': 'same-origin-allow-popups',
  'Cross-Origin-Resource-Policy': 'same-origin',
  // Cloudflare serves the site over HTTPS only.
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
};

/** URL paths a staged page answers on: Cloudflare drops `.html`, and `index` is `/`. */
export function pagePaths(published) {
  const bare = published.replace(/\.html$/, '');
  return bare === 'index' ? ['/', '/index.html'] : [`/${bare}`, `/${published}`];
}

/**
 * The `_headers` file for `pages` (published name → staged HTML). Cloudflare joins the
 * values of one header from every rule that matches a path, so the CSP is set only on the
 * page's own paths and the shared headers only under `/*`.
 */
export function headersFile(pages) {
  const block = (path, headers) =>
    [path, ...Object.entries(headers).map(([k, v]) => `  ${k}: ${v}`)].join('\n');
  const blocks = [block('/*', COMMON_HEADERS)];
  for (const [published, html] of Object.entries(pages)) {
    const csp = { 'Content-Security-Policy': pagePolicy(html) };
    for (const path of pagePaths(published)) blocks.push(block(path, csp));
  }
  return `${blocks.join('\n\n')}\n`;
}
