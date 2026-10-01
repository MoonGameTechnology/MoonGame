// Bake the build identity into the packaged web content so the running APK knows which
// build it is and can compare itself against the rolling release (prototype/src/updater.ts).
//
// CI calls this AFTER copying the prototype HTML into www/index.html, passing the
// monotonic versionCode (commit count) and the short SHA. It injects a tiny script that
// sets `window.__BUILD__` before the app script runs. The browser / dev build never runs
// this step, so it has no __BUILD__ and the updater stays dormant there.
//
// The packaging channel (VOID_CHANNEL, channel.mjs) is baked next to it, so the web layer
// knows WHERE updates come from: a store build (`rustore`) never touches the GitHub lane.
// The default github channel bakes no field at all — the dev/player lanes stay byte-identical.
//
//   node inject-build.mjs <htmlFile> <versionCode> <sha>
import { readFileSync, writeFileSync } from 'node:fs';
import { packagingChannel } from './channel.mjs';

const [file, versionCodeRaw, shaRaw] = process.argv.slice(2);
if (!file || versionCodeRaw === undefined) {
  console.error('usage: node inject-build.mjs <htmlFile> <versionCode> <sha>');
  process.exit(1);
}

const versionCode = Number(versionCodeRaw);
if (!Number.isInteger(versionCode) || versionCode <= 0) {
  throw new Error(`inject-build: versionCode must be a positive integer, got "${versionCodeRaw}"`);
}
const sha = String(shaRaw ?? '').replace(/[^0-9a-fA-F]/g, '').slice(0, 40);
const channel = packagingChannel();
const build = channel === 'github' ? { versionCode, sha } : { versionCode, sha, channel };

let html = readFileSync(file, 'utf8');
if (html.includes('window.__BUILD__')) {
  console.log('inject-build: __BUILD__ already present — leaving as-is.');
  process.exit(0);
}

// JSON.stringify keeps the values safely quoted/escaped inside the inline script.
const tag = `<script>window.__BUILD__=${JSON.stringify(build)};</script>`;
if (!html.includes('</head>')) {
  throw new Error('inject-build: no </head> in the HTML to anchor the build tag');
}
html = html.replace('</head>', `${tag}</head>`);
writeFileSync(file, html);
console.log(
  `inject-build: baked versionCode=${versionCode} sha=${sha || '(none)'} channel=${channel} into ${file}`,
);
