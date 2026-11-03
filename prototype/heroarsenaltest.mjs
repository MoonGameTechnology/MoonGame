#!/usr/bin/env node
/* global window, document, getComputedStyle, localStorage */
/** Хаб → герой → модули, способности, развитие → запись → перезагрузка. */
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { enterSkirmish, instrumentedGame, launchBrowser, serve, waitForApp, withDiagnostics } from './harnessKit.mjs';

const hooks = `
import * as __heroProfile from './sectorProfile';
import { presentMatchHeroRewards as __presentHeroReward } from './heroRewards';
import { openSectorZero as __openSectorZero } from './sectorZeroShell';
window.__heroArsenalTest = {
  seed: () => __heroProfile.saveSectorProgress({ ...__heroProfile.sectorProgress, research: 10000,
    heroTokens: { ...__heroProfile.sectorProgress.heroTokens, commander: 100 } }),
  read: () => __heroProfile.sectorProgress,
  openSector: (hero) => __openSectorZero({ hero }),
  back: () => stepBack(false),
  matchReward: () => {
    shipyard.open('heroes');
    __presentHeroReward([{ kind: 'skill', hero: 'commander', id: 'neural_lace', from: 0, to: 1 }], data);
  },
};`;
const stand = await serve(await instrumentedGame(hooks));
const browser = await launchBrowser();
mkdirSync('.playwright-mcp', { recursive: true });
const results = [];
try {
  for (const [locale, width, height] of [['ru', 1366, 900], ['en', 390, 844]]) {
    const context = await browser.newContext({ viewport: { width, height }, isMobile: width < 600, hasTouch: width < 600 });
    await context.addInitScript((lang) => localStorage.setItem('vd.locale', lang), locale);
    const page = await context.newPage();
    page.setDefaultTimeout(15000);
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await withDiagnostics(page, `hero-arsenal-${locale}`, async () => {
      await page.goto(stand.url);
      await waitForApp(page);
      await page.locator('#cnew').click();
      await page.locator('[data-hub="arsenal"]').click();
      await page.locator('[data-ar-tab="heroes"]').click();
      await page.locator('[data-ar-hero="commander"]').click();
      assert(await page.locator('.ar-hero-skills').isVisible());
      assert((await page.locator('.ar-hero .hero-portrait').first().boundingBox()).width >= 40);
      assert.equal(await page.locator('[data-ar-hero-sector]').count(), 0);
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
      const tabBox = await page.locator('[data-ar-tab="heroes"]').boundingBox();
      assert(tabBox.x + tabBox.width <= width);
      await page.screenshot({ path: `.playwright-mcp/hero-catalog-${locale}.png`, fullPage: true });
      await page.evaluate(() => window.__heroArsenalTest.seed());
      await page.evaluate(() => window.__heroArsenalTest.openSector('commander'));
      await page.locator('[data-prep="hero-tab"][data-id="ship"]').waitFor();
      await page.locator('[data-prep="bay"][data-slot="utility"]').first().click();
      await page.locator('[data-prep="fit-hero"][data-id="ion_engine"]').click();
      assert((await page.evaluate(() => window.__heroArsenalTest.read().heroes.commander.ship)).includes('ion_engine'));
      assert.equal(await page.locator('#hero-reward[open]').count(), 0);
      await page.screenshot({ path: `.playwright-mcp/hero-ship-${locale}.png`, fullPage: true });
      await page.locator('[data-prep="hero-tab"][data-id="tree"]').click();
      for (const skill of ['neural_lace', 'overclocked_helm', 'corridor_sustained']) {
        await page.locator(`[data-prep="skill-node"][data-id="${skill}"]`).click();
        await page.locator(`[data-prep="skill"][data-id="${skill}"]`).click();
        await page.locator('#hero-reward[open]').waitFor();
        assert((await page.evaluate(() => window.__heroArsenalTest.read().heroes.commander.skills)).includes(skill));
        if (skill === 'corridor_sustained') {
          assert.match(await page.locator('#hero-reward-title').innerText(), locale === 'ru' ? /улучшена/ : /upgraded/);
          await page.screenshot({ path: `.playwright-mcp/hero-skill-reward-${locale}.png` });
        }
        await page.locator('[data-hero-reward="next"]').click();
      }
      await page.screenshot({ path: `.playwright-mcp/hero-skills-${locale}.png`, fullPage: true });
      await page.locator('[data-prep="hero-tab"][data-id="stars"]').click();
      const before = await page.evaluate(() => window.__heroArsenalTest.read().heroes.commander.level);
      await page.locator('[data-prep="upgrade-hero"]').click();
      await page.locator('#hero-reward[open]').waitFor();
      assert.equal(await page.evaluate(() => window.__heroArsenalTest.read().heroes.commander.level), before + 1);
      assert.match(await page.locator('#hero-reward .mr-grade').innerText(), new RegExp(`${before} → ${before + 1}`));
      assert.equal(await page.locator('#hero-reward .mr-new').evaluate((el) => getComputedStyle(el).animationName), 'module-star');
      await page.emulateMedia({ reducedMotion: 'reduce' });
      assert.equal(await page.locator('#hero-reward .mr-new').evaluate((el) => getComputedStyle(el).animationName), 'none');
      await page.screenshot({ path: `.playwright-mcp/hero-star-reward-${locale}.png` });
      await page.evaluate(() => window.__heroArsenalTest.back());
      assert(await page.locator('#sz-workshop').isVisible());
      assert.equal(await page.locator('#hero-reward[open]').count(), 0);
      await page.locator('[data-prep="hero"][data-id="vanguard"]').click();
      await page.locator('[data-prep="unlock-hero"][data-id="vanguard"]').click();
      await page.locator('#hero-reward[open]').waitFor();
      await page.locator('[data-hero-reward="next"]').click();
      const saved = await page.evaluate(() => window.__heroArsenalTest.read().heroes);
      await page.reload();
      await waitForApp(page);
      await page.waitForFunction(() => window.__heroArsenalTest.read().heroes.vanguard !== undefined);
      assert.deepEqual(await page.evaluate(() => window.__heroArsenalTest.read().heroes), saved);
      assert.equal(await page.locator('.hero-reward-dialog[open]').count(), 0);
      if (await page.locator('#sector-zero').isVisible()) await page.locator('#sz-back').click();
      if (await page.locator('#cnew').isVisible()) await page.locator('#cnew').click();
      await enterSkirmish(page, { fromWelcome: false });
      await page.evaluate(() => window.__heroArsenalTest.matchReward());
      await page.locator('#match-hero-reward[open]').waitFor();
      assert(!(await page.locator('#tech').isVisible()));
      await page.keyboard.press('KeyT');
      assert(!(await page.locator('#tech').isVisible()));
      assert(await page.locator('#match-hero-reward[open]').isVisible());
      await page.evaluate(() => window.__heroArsenalTest.back());
      assert.equal(await page.locator('#match-hero-reward[open]').count(), 0);
      assert(await page.locator('#herobody').isVisible());
      assert.deepEqual(errors, []);
      results.push({ locale, viewport: `${width}x${height}`, fit: true, skills: 3, star: before + 1, acquired: 'vanguard', reload: true, reducedMotion: true, platformBack: 'both dialogs' });
    });
    await context.close();
  }
  writeFileSync('.playwright-mcp/hero-arsenal-results.json', JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results));
} finally {
  await browser.close();
  await stand.close();
}
