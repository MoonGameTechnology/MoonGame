/* global window */
/** Exercise the exact store artifact, including cold boot and hub navigation. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { launchBrowser, serve, waitForApp, enterHubByCallsign } from './harnessKit.mjs';
const html = readFileSync('prototype/dist/void-dominion-rustore.html', 'utf8');
assert.doesNotMatch(html, /id=["'](?:sector-zero|hub-sector-zero|sz-[^"']*)["']/);
assert.match(readFileSync('prototype/dist/void-dominion-player.html', 'utf8'), /id="hub-sector-zero"/);
const site = await serve({ '/': html });
const browser = await launchBrowser();
try {
  for (const width of [390, 1440]) {
    const page = await browser.newPage({ viewport: { width, height: 844 } });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', msg => { if (msg.type() === 'error') console.error(msg.text()); });
    await page.addInitScript(() => { window.__BUILD__ = { channel: 'rustore', versionCode: 1 }; });
    await page.goto(site.url);
    await waitForApp(page);
    await enterHubByCallsign(page, 'RuStoreTester');
    assert.equal(await page.locator('#hub-sector-zero,#sector-zero,[id^="sz-"]').count(), 0);
    await page.locator('#hub-play').click();
    await page.locator('#cbrowse').waitFor({ state: 'visible' });
    assert.deepEqual(errors, []);
    console.log(`RuStore ${width}: boot, hub and match browser; no campaign`);
    await page.close();
  }
} finally { await browser.close(); await site.close(); }
