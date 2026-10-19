/**
 * The game server the Cloudflare site sends players to.
 *
 * On Cloudflare the page and the match server live on different origins: the site is
 * static assets, the server runs on our own host (`deploy/`). Without a baked address the
 * address field starts on the page's own origin (decisions/serverAddress.ts, rule 8),
 * where no server answers, so «Игра по сети» opened onto an empty list. The APK solves the
 * same problem by baking `window.__BUILD__.server` (`mobile/inject-build.mjs`); the site
 * does the same with only the server field, so the updater stays dormant on the web.
 *
 * The address comes from `GAME_SERVER` at build time (`wrangler.jsonc` → `build.command`).
 */

/** Only an absolute https:// or wss:// origin; anything else fails the build. */
export function parseServer(raw) {
  if (!raw) return undefined;
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`stage-site: GAME_SERVER must be an absolute URL, got "${raw}"`);
  }
  if (url.protocol !== 'https:' && url.protocol !== 'wss:') {
    throw new Error(`stage-site: GAME_SERVER must be https:// or wss://, got "${raw}"`);
  }
  return `${url.protocol}//${url.host}`;
}

/** `html` with the server baked in before `</head>`; unchanged when there is no server. */
export function bakeServer(html, server) {
  if (!server) return html;
  if (!html.includes('</head>')) throw new Error('stage-site: no </head> to anchor the server tag');
  // JSON.stringify keeps the value safely quoted inside the inline script.
  const tag = `<script>window.__BUILD__=${JSON.stringify({ server })};</script>`;
  return html.replace('</head>', `${tag}</head>`);
}
