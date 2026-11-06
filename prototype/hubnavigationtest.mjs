#!/usr/bin/env node
/* global localStorage, location, getComputedStyle */
/** Real built clients: matches share the hub's navigation and retain their live controls. */
import assert from 'node:assert/strict';
import { mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { builtPage, enterHubByCallsign, launchBrowser, serve, waitForApp, withDiagnostics } from './harnessKit.mjs';

const match = (matchId) => ({
  matchId, mapId: 'ffa-20', days: 5, status: 'running',
  players: { seated: 3, capacity: 20 }, rules: { timeScale: 12 },
});
const lists = { available: [match('12345678')], active: [match('87654321')], archived: [] };
const routes = {
  '/dev.html': builtPage(),
  '/player.html': builtPage('void-dominion-player.html'),
};
for (const name of readdirSync('prototype/dist')) {
  if (/^sim-worker-[a-f0-9]+\.js$/.test(name))
    routes['/' + name] = { type: 'application/javascript', body: readFileSync('prototype/dist/' + name) };
}
const site = await serve(routes);
const artifacts = process.env.HUB_NAV_ARTIFACTS ?? '.playwright-mcp';
mkdirSync(artifacts, { recursive: true });
try {
  for (const [profile, width, height, lang] of [
    ['dev', 360, 800, 'ru'],
    ['player', 320, 740, 'ru'],
    ['player', 390, 844, 'en'],
    ['player', 844, 390, 'en'],
    ['dev', 1360, 900, 'ru'],
    ['player', 1920, 1080, 'en'],
  ]) {
    // One browser at a time, including on the live VPS used for local verification.
    const browser = await launchBrowser();
    try {
      const mobile = width < 900;
      const context = await browser.newContext({
        viewport: { width, height }, isMobile: mobile, hasTouch: mobile,
      });
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.addInitScript(({ lang }) => {
        localStorage.setItem('void.nick', 'Navigator');
        localStorage.setItem('void.server', location.origin.replace(/^http/, 'ws'));
        localStorage.setItem('vd.locale', lang);
      }, { lang });
      await page.route('**/matches?**', route => route.fulfill({ json: lists }));
      await withDiagnostics(page, `hub-nav-${profile}-${width}`, async () => {
        await page.goto(`${site.url}/${profile}.html`);
        await waitForApp(page);
        await enterHubByCallsign(page, 'Navigator', mobile);
        await page.locator('#hub').waitFor({ state: 'visible' });
        assert.equal(await page.locator('#hub .hub-banner').count(), 0);
        const games = page.locator('.hub-tab[data-hub="games"]');
        const nav = page.locator('.hub-nav');
        // The profile and wallet header belongs to «Домой» only (owner, 2026-11-05).
        const header = page.locator('#hub .hub-id');
        assert.equal(await header.isVisible(), true, 'the header stands on «Домой»');
        await games.click();
        await page.locator('#mlist .mrow').first().waitFor();
        assert.equal(await header.isVisible(), false, 'no header on «Игры»');
        assert.equal(await page.locator('#hp-games > #connect').count(), 1);
        assert.equal(await page.locator('#cback').count(), 0);
        assert.equal(await games.evaluate(el => el.classList.contains('active')), true);
        assert.equal(await nav.isVisible(), true);
        const bounds = await nav.boundingBox();
        assert.ok(bounds.y + bounds.height <= height + 1, 'navigation extends below the viewport');
        const body = await page.locator('#connect .mbody').boundingBox();
        assert.ok(body.height > 30 && body.y + body.height <= bounds.y + 1, 'list overlaps navigation');
        assert.ok(await page.locator('#connect').evaluate(el => el.scrollWidth <= el.clientWidth + 1), 'browser overflows');
        if (!mobile)
          assert.equal(await page.locator('#connect').evaluate(el => getComputedStyle(el).zoom), '1');

        await page.locator('.mtab[data-tab="active"]').click();
        await page.locator('#mnum-in').fill('87654321');
        for (const tab of ['arsenal', 'corp', 'more', 'home']) {
          await page.locator(`.hub-tab[data-hub="${tab}"]`).click();
          // First visit to a cabinet offers its normal contextual hint.
          const intro = page.locator('#intro.show button');
          if (await intro.isVisible()) await intro.click();
          assert.equal(await nav.isVisible(), true);
          assert.equal(await page.locator(`#hp-${tab}`).isVisible(), true);
          assert.equal(await header.isVisible(), tab === 'home', `header on «${tab}»`);
          assert.equal(await page.locator('#connect').isVisible(), false);
          if (tab === 'more') {
            // A page opened from «Ещё» keeps «Ещё» lit and has no header either.
            await page.locator('#hub-rank').click();
            assert.equal(await page.locator('#hub').getAttribute('data-panel'), 'rank');
            assert.equal(await header.isVisible(), false, 'no header on a page from «Ещё»');
            assert.equal(await nav.locator('.hub-tab.active').getAttribute('data-hub'), 'more');
          }
          await games.click();
          await page.locator('.mtab[data-tab="active"].active').waitFor();
          assert.equal(await page.locator('#mnum-in').inputValue(), '87654321');
          assert.equal(await page.locator('#hp-games > #connect').count(), 1);
        }
        assert.equal(await page.locator('#connect').count(), 1, 'the browser must never be cloned');
        if (profile === 'player' && (width === 390 || width === 1920))
          await page.screenshot({ path: `${artifacts}/hub-matches-${width}.png` });
        assert.deepEqual(errors, []);
      });
      await context.close();
      console.log(`✓ hub navigation: ${profile}, ${width}×${height}, ${lang}`);
    } finally {
      await browser.close();
    }
  }
} finally {
  await site.close();
}
