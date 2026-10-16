// Bake the build identity into the packaged web content so the running APK knows which
// build it is and can compare itself against the rolling release (prototype/src/updater.ts).
//
// CI calls this AFTER copying the prototype HTML into www/index.html, passing the
// monotonic versionCode (commit count) and the short SHA. It injects a tiny script that
// sets `window.__BUILD__` before the app script runs. The browser / dev build never runs
// this step, so it has no __BUILD__ and the updater stays dormant there.
//
// Optional <server>: the game server the APK's address field starts on when the player
// has not connected anywhere yet (decisions/serverAddress.ts, rule 8). Without it the
// APK page (http://localhost, no port) would default to ws://localhost:8788.
//
//   node inject-build.mjs <htmlFile> <versionCode> <sha> [server]
import { readFileSync, writeFileSync } from 'node:fs';

const [file, versionCodeRaw, shaRaw, serverRaw] = process.argv.slice(2);
if (!file || versionCodeRaw === undefined) {
  console.error('usage: node inject-build.mjs <htmlFile> <versionCode> <sha> [server]');
  process.exit(1);
}

const versionCode = Number(versionCodeRaw);
if (!Number.isInteger(versionCode) || versionCode <= 0) {
  throw new Error(`inject-build: versionCode must be a positive integer, got "${versionCodeRaw}"`);
}
const sha = String(shaRaw ?? '').replace(/[^0-9a-fA-F]/g, '').slice(0, 40);
const server = parseServer(serverRaw);

/** Only an absolute https:// or wss:// origin; anything else fails the build. */
function parseServer(raw) {
  if (!raw) return undefined;
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`inject-build: server must be an absolute URL, got "${raw}"`);
  }
  if (url.protocol !== 'https:' && url.protocol !== 'wss:') {
    throw new Error(`inject-build: server must be https:// or wss://, got "${raw}"`);
  }
  return `${url.protocol}//${url.host}`;
}

let html = readFileSync(file, 'utf8');
if (html.includes('window.__BUILD__')) {
  console.log('inject-build: __BUILD__ already present — leaving as-is.');
  process.exit(0);
}

// JSON.stringify keeps the values safely quoted/escaped inside the inline script.
const tag = `<script>window.__BUILD__=${JSON.stringify({ versionCode, sha, server })};</script>`;
if (!html.includes('</head>')) {
  throw new Error('inject-build: no </head> in the HTML to anchor the build tag');
}
html = html.replace('</head>', `${tag}</head>`);
writeFileSync(file, html);
console.log(
  `inject-build: baked versionCode=${versionCode} sha=${sha || '(none)'} server=${server ?? '(none)'} into ${file}`,
);
