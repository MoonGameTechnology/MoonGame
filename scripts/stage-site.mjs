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
import { copyFileSync, mkdirSync, rmSync } from 'node:fs';

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
mkdirSync(site, { recursive: true });
for (const [published, built] of Object.entries(PAGES)) {
  copyFileSync(`${dist}/${built}`, `${site}/${published}`);
  console.log(`staged ${site}/${published} ← ${built}`);
}
