/* global document, localStorage, innerWidth */
/** Real bundled-client smoke: run after pnpm run prototype. No production server mutations. */
import assert from 'node:assert/strict';
import {
  builtPage,
  enterSkirmish,
  launchBrowser,
  pressSpeed,
  serve,
  waitForApp,
} from './harnessKit.mjs';
const site = await serve({ '/': builtPage('void-dominion.html') });
const browser = await launchBrowser();
const errors = [];
const results = [];
try {
  for (const [width, height, locale] of [
    [390, 844, 'ru'],
    [320, 740, 'en'],
    [1440, 960, 'en'],
  ]) {
    const page = await browser.newPage({
      viewport: { width, height },
      isMobile: width < 600,
      hasTouch: width < 600,
    });
    page.on('pageerror', (e) => errors.push(e.message));
    await page.addInitScript((locale) => localStorage.setItem('vd.locale', locale), locale);
    await page.goto(site.url + '/');
    await waitForApp(page);
    await enterSkirmish(page, { tap: width < 600 });
    await pressSpeed(page, '#spd-pause', { tap: width < 600 });
    await page.evaluate(() => document.getElementById('rail-constructor').click());
    await page.locator('#constructor.show').waitFor();
    await page.evaluate(() => document.getElementById('intro')?.classList.remove('show'));
    assert.equal(await page.locator('#buildwin').count(), 0);
    // Separate info action and research -> return to the same card.
    await page.locator('#constructor [data-pw-info="unit:heavy_cruiser"]').click();
    await page.locator('#codex.show').waitFor();
    await page.locator('#codex [data-bw-tech]').first().click();
    await page.locator('#tech.show').waitFor();
    if (await page.locator('#tech .tt-mx').isVisible()) await page.locator('#tech .tt-mx').click();
    await page.locator('#tech .tw-close').click();
    await page.locator('#codex.show').waitFor();
    await page.locator('#codex [data-pw-building="shipyard"]').click();
    await page.locator('#codex [data-cx-blvl="shipyard:2"]').click();
    assert.ok(await page.locator('#codex .pw-better,#codex .pw-worse').count());
    await page.locator('#codex .cx-close').click();
    assert.ok(await page.locator('#codex [data-pw-building="shipyard"]').count());
    await page.locator('#codex .cx-close').click();
    // Save an unmodified hull and load it from the empty ship lane, with a real price.
    await page.locator('#constructor [data-cnhull="frigate"]').click();
    await page.locator('#constructor [data-cntpl]').click();
    await page.locator('#constructor [data-cntplsave]').click();
    await page.locator('#constructor [data-cntpl]').click();
    await page.locator('#constructor [data-pw-queue]').click();
    await page.locator('#constructor [data-pw-empty="ships"]').click();
    assert.ok(await page.locator('#constructor .cn-tplrow .rcost').count());
    await page.locator('#constructor [data-cntpluse]').first().click();
    assert.ok(await page.locator('#constructor [data-cnhull="frigate"].on').count());
    // Slot tiles install/remove fittings, including the cross inside a selected tile.
    await page.locator('#constructor [data-cnmod]').first().click();
    await page.locator('#constructor .cn-bay.filled').first().click();
    await page.locator('#constructor [data-cnrm]').click();
    assert.equal(await page.locator('#constructor .cn-bay.filled').count(), 0);
    // Building anchors remain in the shared screen.
    await page.locator('#constructor [data-pw-building="shipyard"]').first().click();
    assert.ok(await page.locator('#constructor [data-bw="shipyard"].pw-anchor').count());
    await page.locator('#constructor [data-ctab="infantry"]').first().click();
    await page.locator('#constructor [data-ctab="heroes"]').click();
    await page.locator('#constructor [data-htab="ship"]').click();
    await page.locator('#constructor [data-hflagship="scout"]').click();
    assert.ok(await page.locator('#constructor [data-hflagship="scout"].on').count());
    await page.locator('#constructor [data-hflagapply]').click();
    assert.ok(await page.locator('#constructor [data-hflagapply]').isDisabled());
    const overflow = await page
      .locator('#constructorbody')
      .evaluate((el) => el.scrollWidth - el.clientWidth);
    assert.ok(overflow <= 2, `horizontal overflow at ${width}: ${overflow}`);
    assert.ok(await page.evaluate(() => document.body.scrollWidth <= innerWidth));
    if (process.env.VOID_PRODUCTION_SHOTS)
      await page.screenshot({
        path: `${process.env.VOID_PRODUCTION_SHOTS}/production-${width}-${locale}.png`,
      });
    results.push({ width, height, locale });
    await page.close();
  }
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed: results, pageErrors: errors.length }));
} finally {
  await browser.close();
  await site.close();
}
