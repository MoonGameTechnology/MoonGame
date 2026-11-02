#!/usr/bin/env node
/* global window, document, navigator, localStorage */
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { instrumentedGame, serve, launchBrowser, withDiagnostics } from './harnessKit.mjs';

const battleId = 'ava-12345678-1234-4abc-a123-12345678abcd';
const match = (matchId, over = {}) => ({ matchId, mapId: 'ffa-20', days: 52,
  status: 'running', players: { seated: 4, capacity: 4 }, rules: { timeScale: 1 }, ...over });
const lists = {
  available: [match('48219372')],
  active: [match(battleId), match('48219370', { players: { seated: 8, capacity: 20 }, days: 65 })],
  archived: [match('ava-archive', { status: 'ended' })],
};
const hooks = `import { refreshMyMatches as __refreshMine } from './matchBrowser';
window.__sessionCards = {
  async home() {
    nickInput.value = 'AdmiralDest';
    srvInput.value = location.origin.replace(/^http/, 'ws');
    openHub();
    await __refreshMine();
  }
};`;
const site = await serve(await instrumentedGame(hooks));
const browser = await launchBrowser();
mkdirSync('.playwright-mcp', { recursive: true });
try {
  for (const [width, height, lang] of [[320, 740, 'ru'], [393, 852, 'ru'], [390, 844, 'en'], [1366, 900, 'ru']]) {
    const context = await browser.newContext({ viewport: { width, height }, isMobile: width < 600, hasTouch: width < 600 });
    await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: site.url });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.setDefaultTimeout(15000);
    await page.addInitScript(lang => localStorage.setItem('vd.locale', lang), lang);
    await page.route('**/auth/status', route => route.fulfill({ status: 404, body: '{}' }));
    await page.route('**/matches?**', route => route.fulfill({ json: lists }));
    await withDiagnostics(page, `session-number-${width}-${lang}`, async () => {
      await page.goto(site.url);
      await page.evaluate(() => window.__sessionCards.home());
      const card = page.locator('#hub-mine .hm-row').first();
      const number = card.locator('.mnumber');
      await number.waitFor({ state: 'visible' });
      assert.equal(await number.innerText(), '№ ava-12345678…abcd');
      assert.equal(await card.getByRole('button', { name: lang === 'ru' ? 'Скопировать номер' : 'Copy number', exact: true }).count(), 0);
      await number.click();
      assert.equal(await page.evaluate(() => navigator.clipboard.readText()), battleId);
      assert.equal(await number.evaluate(el => el.classList.contains('copied')), true);
      const size = await card.boundingBox();
      assert.ok(size.height < 250, `card should stay compact at ${width}px: ${size.height}`);
      assert.ok(await card.evaluate(el => el.scrollWidth <= el.clientWidth + 1), 'card overflows horizontally');
      if (width === 393) await page.screenshot({ path: '.playwright-mcp/session-number-home.png' });
      await page.locator('.hub-tab[data-hub="games"]').click();
      await page.locator('.mtab[data-tab="corporate"]').click();
      await page.waitForFunction(() => document.querySelectorAll('#mlist .mrow').length === 2);
      assert.equal(await page.locator('.mtab[data-tab="corporate"] .mcount').innerText(), '2');
      assert.equal(await page.locator('#mlist .mrow').first().getAttribute('data-match'), battleId);
      assert.equal(await page.locator('#mlist .mrow').last().getAttribute('data-match'), 'ava-archive');
      const overflow = await page.locator('#cbrowse').evaluate(el => el.scrollWidth - el.clientWidth);
      assert.ok(overflow <= 1, `browser overflows by ${overflow}px at ${width}px`);
      const tabsFit = await page.locator('.mtabs').evaluate(el => [...el.children].every(child => child.getBoundingClientRect().right <= el.getBoundingClientRect().right + 1));
      assert.equal(tabsFit, true);
      if (width === 393) await page.screenshot({ path: '.playwright-mcp/session-number-corporate.png' });
      await page.locator('.mtab[data-tab="active"]').click();
      assert.equal(await page.locator('#mlist .mrow').count(), 1);
      assert.equal(await page.locator('#mlist .mrow').getAttribute('data-match'), '48219370');
      assert.deepEqual(errors, []);
    });
    await context.close();
  }
  console.log('✓ sessions: copy full UUID, compact mobile cards, corporate tab and separate regular matches (RU/EN, 320–1366px)');
} finally {
  await browser.close();
  await site.close();
}
