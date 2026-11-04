/**
 * Stage the public web site that Cloudflare serves (`wrangler.jsonc` → `assets.directory`).
 *
 * Run after `pnpm run prototype`: it picks ONLY the pages meant for players out of
 * `prototype/dist/`. The rest of that folder must not go public — the admin client
 * (`void-dominion-admin.html`), the platform archive (`yandex/`, it expects the Yandex SDK
 * at `/sdk.js`) and the screenshots the browser harnesses leave behind.
 *
 * The pages come from the server build (`dist/served/`): the same game GitHub Pages
 * publishes (`.github/workflows/pages.yml`), but with the art as files in `assets/`. The
 * single-file pages carry it as base64 and outgrew Cloudflare's 25 MiB limit per file;
 * `MAX_FILE_BYTES` below stops the build before the upload would fail.
 */
import {
  cpSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { headersFile } from './siteHeaders.mjs';
import { bakeServer, parseServer } from './siteServer.mjs';

const served = 'prototype/dist/served';
const site = 'prototype/dist/site';

/** Cloudflare refuses the whole upload if any one asset is larger than this. */
const MAX_FILE_BYTES = 25 * 1024 * 1024;

/** Published path → built file in `served`. */
const PAGES = {
  'index.html': 'dev.html',
  'sector-zero.html': 'sector-zero.html',
  'player.html': 'player.html',
};

// A fresh folder each time: a page dropped from the list must not linger on the site.
rmSync(site, { recursive: true, force: true });
// The match server lives on another origin (siteServer.mjs); bake it before hashing, so
// the page policy covers the baked script too.
const server = parseServer(process.env.GAME_SERVER);
mkdirSync(site, { recursive: true });
const staged = {};
for (const [published, built] of Object.entries(PAGES)) {
  staged[published] = bakeServer(readFileSync(`${served}/${built}`, 'utf8'), server);
  writeFileSync(`${site}/${published}`, staged[published]);
  console.log(`staged ${site}/${published} ← ${built}`);
}
// Art and the solo sim worker: the pages ask for them by absolute `/assets/<name>-<hash>`,
// and the page policy lets in only images and a worker from this site (`'self'`).
cpSync(`${served}/assets`, `${site}/assets`, { recursive: true });
console.log(`staged ${site}/assets/ (${readdirSync(`${site}/assets`).length} files)`);
const tooBig = [...Object.keys(PAGES), ...readdirSync(`${site}/assets`).map((n) => `assets/${n}`)]
  .map((rel) => ({ rel, bytes: statSync(`${site}/${rel}`).size }))
  .filter((f) => f.bytes > MAX_FILE_BYTES);
if (tooBig.length > 0) {
  for (const f of tooBig) console.error(`${f.rel}: ${f.bytes} bytes > ${MAX_FILE_BYTES}`);
  throw new Error('a staged file is over the Cloudflare limit of 25 MiB per asset');
}
// Cloudflare reads `_headers` from the assets folder and does not serve it (siteHeaders.mjs).
writeFileSync(`${site}/_headers`, headersFile(staged));
console.log(`staged ${site}/_headers`);
console.log(`game server: ${server ?? '(same origin)'}`);
