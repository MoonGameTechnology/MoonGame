/**
 * Stage the public web site that Cloudflare serves (`wrangler.jsonc` → `assets.directory`).
 *
 * Run after `pnpm run prototype`: it picks ONLY the pages meant for players out of
 * `prototype/dist/`. The rest of that folder must not go public — the admin client
 * (`void-dominion-admin.html`), the platform archive (`yandex/`, it expects the Yandex SDK
 * at `/sdk.js`) and the screenshots the browser harnesses leave behind.
 *
 * The main page is the same file GitHub Pages publishes (`.github/workflows/pages.yml`),
 * so both web addresses show one game.
 */
import { copyFileSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { headersFile } from './siteHeaders.mjs';
import { bakeServer, parseServer } from './siteServer.mjs';

const dist = 'prototype/dist';
const site = `${dist}/site`;

/** Published path → built file. */
const PAGES = {
  'index.html': 'void-dominion.html',
  'sector-zero.html': 'sector-zero.html',
  'player.html': 'void-dominion-player.html',
};

// A fresh folder each time: a page dropped from the list must not linger on the site.
rmSync(site, { recursive: true, force: true });
// The match server lives on another origin (siteServer.mjs); bake it before hashing, so
// the page policy covers the baked script too.
const server = parseServer(process.env.GAME_SERVER);
mkdirSync(site, { recursive: true });
const staged = {};
for (const [published, built] of Object.entries(PAGES)) {
  staged[published] = bakeServer(readFileSync(`${dist}/${built}`, 'utf8'), server);
  writeFileSync(`${site}/${published}`, staged[published]);
  console.log(`staged ${site}/${published} ← ${built}`);
}
// The solo sim worker the pages start (`build.mjs`): the page policy lets in only a worker
// from this site (`worker-src 'self'`), so it is a file here, not a string in the page.
for (const name of readdirSync(dist).filter((n) => /^sim-worker-[0-9a-f]+\.js$/.test(n))) {
  copyFileSync(`${dist}/${name}`, `${site}/${name}`);
  console.log(`staged ${site}/${name}`);
}
// Cloudflare reads `_headers` from the assets folder and does not serve it (siteHeaders.mjs).
writeFileSync(`${site}/_headers`, headersFile(staged));
console.log(`staged ${site}/_headers`);
console.log(`game server: ${server ?? '(same origin)'}`);
