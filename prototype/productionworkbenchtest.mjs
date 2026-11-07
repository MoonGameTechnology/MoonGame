/* global document, localStorage, innerWidth, window, getComputedStyle */
/** Real bundled-client smoke: run after pnpm run prototype. No production server mutations. */
import assert from 'node:assert/strict';
import {
  instrumentedGame,
  enterSkirmish,
  launchBrowser,
  serve,
  waitForApp,
} from './harnessKit.mjs';
const site = await serve(await instrumentedGame(`
window.__productionBroke = () => { s.players[ME].resources = Object.fromEntries(data.resources.map(id => [id, 0])); shipyard.render(); };
window.__productionFixture = (ready = true) => {
  s.players[ME].resources = Object.fromEntries(data.resources.map(id => [id, 90000]));
  s.players[ME].technologies = { completed: Object.keys(data.technologies) };
  const world = Object.values(s.planets).find(p => p.owner === ME);
  for (const type of ['shipyard', 'spaceport', 'barracks', 'factory']) {
    const level = 1 + (data.buildings[type]?.upgrades?.length ?? 0);
    world.buildings = world.buildings.filter(b => b.type !== type);
    if (ready || type !== 'shipyard') world.buildings.push({type,level});
  }
  shipyard.render();
};
`));
const browser = await launchBrowser();
const errors = [];
const results = [];
try {
  for (const [width, height, locale] of [
    [390, 844, 'ru'],
    [320, 740, 'en'],
    [1440, 960, 'en'],
    [844, 390, 'ru'],
  ]) {
    console.log(JSON.stringify({ checking: { width, height, locale } }));
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
    // The constructor is under test; pause through the existing speed control.
    await page.evaluate(() => document.getElementById('spd-pause').click());
    await page.evaluate(() => document.getElementById('rail-constructor').click());
    await page.locator('#constructor.show').waitFor();
    await page.evaluate(() => document.getElementById('intro')?.classList.remove('show'));
    assert.equal(await page.locator('#buildwin').count(), 0);
    await page.evaluate(() => window.__productionBroke());
    await page.locator('#constructor [data-ctab="buildings"]').first().click();
    await page.locator('#constructor [data-pw-info="building:barracks"]').scrollIntoViewIfNeeded();
    const scrollBefore = await page.locator('#constructorbody').evaluate(el => el.scrollTop);
    await page.evaluate(() => window.__productionBroke());
    const scrollAfter = await page.locator('#constructorbody').evaluate(el => el.scrollTop);
    assert.ok(Math.abs(scrollAfter - scrollBefore) <= 2, `building scroll reset: ${scrollBefore} -> ${scrollAfter}`);
    await page.locator('#constructor [data-ctab="ships"]').first().click();
    // Separate info action and research -> return to the same card.
    await page.locator('#constructor [data-pw-info="unit:heavy_cruiser"]').click();
    await page.locator('#codex.show').waitFor();
    assert.equal(await page.locator('#codex .pw-dossier-title .cx-close').count(), 1);
    assert.ok(await page.locator('#codex .pw-dossier-title .cx-close svg').isVisible());
    const signature = page.locator('#codex [data-term="signature"]');
    await signature.scrollIntoViewIfNeeded();
    await page.waitForTimeout(100); // Scroll dismisses term popovers; let the card settle first.
    if (width < 600) await signature.tap(); else await signature.click();
    await page.locator('.termtip').waitFor();
    await page.keyboard.press('Escape');
    await page.locator('#codex details > summary').first().click();
    const sectionsBefore = await page.locator('#codex details').evaluateAll(es => es.map(e => e.open));
    await page.locator('#codex [data-pw-income]').click();
    await page.locator('#codex .pw-income-table').waitFor();
    assert.equal(await page.locator('#codex .pw-income-table tbody tr').count(), 5);
    await page.locator('#codex .cx-close').click();
    assert.deepEqual(await page.locator('#codex details').evaluateAll(es => es.map(e => e.open)), sectionsBefore);
    await page.locator('#codex [data-bw-tech]').first().click();
    await page.locator('#tech.show').waitFor();
    if (await page.locator('#intro.show button').isVisible()) await page.locator('#intro.show button').click();
    if (await page.locator('#tech .tt-mx').isVisible()) await page.locator('#tech .tt-mx').click();
    await page.locator('#tech .tw-close').click();
    await page.locator('#codex.show').waitFor();
    await page.locator('#codex [data-pw-building="shipyard"]').click();
    await page.locator('#codex .cx-lvls button:not(:disabled)').last().click();
    assert.ok(await page.locator('#codex .pw-better,#codex .pw-worse').count());
    await page.locator('#codex .cx-close').click();
    assert.ok(await page.locator('#codex [data-pw-building="shipyard"]').count());
    await page.locator('#codex .cx-close').click();
    await page.evaluate(() => window.__productionFixture());
    // Save an unmodified hull and load it from the empty ship lane, with a real price.
    await page.locator('#constructor [data-cnhull="frigate"]').click();
    await page.locator('#constructor .pw-fitting-tools [data-cntpl]').click();
    await page.locator('#constructor .cn-tpl [data-cntplsave]').click();
    await page.locator('.pw-template-editor [data-pw-template-submit]').click();
    assert.ok(await page.locator('.pw-template-editor [role="alert"]').innerText());
    await page.locator('.pw-template-editor [data-pw-template-name]').fill('Playtest build');
    await page.evaluate(() => window.__productionFixture());
    assert.equal(await page.locator('.pw-template-editor [data-pw-template-name]').inputValue(), 'Playtest build');
    await page.locator('.pw-template-editor [data-pw-template-submit]').click();
    assert.equal(await page.locator('.pw-template-editor').count(), 0);
    assert.ok(await page.locator('#constructor .cn-tpn').filter({ hasText: 'Playtest build' }).count());
    await page.evaluate(() => document.activeElement.blur());
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('.pw-template-picker').count(), 0);
    assert.ok(await page.locator('#constructor.pw-fitting-open.show').count());
    await page.locator('#constructor [data-pw-fit-close]').click();
    await page.locator('#constructor [data-pw-queue]').click();
    await page.locator('#constructor [data-pw-empty="ships"]').click();
    assert.ok(await page.locator('#constructor .cn-tplrow .rcost').count());
    await page.locator('#constructor [data-cntpldel]').first().click();
    await page.locator('.pw-template-editor [data-pw-template-close]').last().click();
    assert.ok(await page.locator('#constructor [data-cntpluse]').count());
    await page.locator('#constructor [data-cntpluse]').first().click();
    assert.ok(await page.locator('#constructor [data-cnhull="frigate"].on').count());
    // Slot tiles install/remove fittings, including the cross inside a selected tile.
    await page.locator('#constructor [data-cnmod]').first().click();
    await page.locator('#constructor .cn-bay.filled').first().click();
    await page.locator('#constructor [data-cnrm]').click();
    assert.equal(await page.locator('#constructor .cn-bay.filled').count(), 0);
    await page.locator('#constructor [data-pw-fit-close]').click();
    // A destroyed facility becomes a visible requirement with a working anchor.
    await page.evaluate(() => window.__productionFixture(false));
    await page.locator('#constructor [data-pw-building="shipyard"]').first().click();
    assert.ok(await page.locator('#constructor [data-bw="shipyard"].pw-anchor').count());
    await page.locator('#constructor [data-ctab="infantry"]').first().click();
    await page.locator('#constructor [data-ctab="heroes"]').click();
    await page.locator('#constructor .hx-bay.off[data-htab="abilities"]').first().click();
    assert.ok(await page.locator('#constructor .pw-hero-pool[open]').count());
    await page.evaluate(() => document.activeElement.blur());
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#constructor .pw-hero-pool[open]').count(), 0);
    assert.ok(await page.locator('#constructor.show').count());
    await page.locator('#constructor .hx-bay.off[data-htab="abilities"]').first().click();
    assert.ok(await page.locator('#constructor .pw-hero-pool[open]').count());
    await page.keyboard.press('Escape');
    await page.locator('#constructor [data-htab="ship"]').click();
    await page.locator('#constructor .pw-hero-equipment > summary').click();
    await page.locator('#constructor .pw-hardware-slot.off').first().click();
    await page.locator('#constructor .pw-hardware-option:not([hidden]) [data-hinstall]').first().click();
    assert.equal(await page.locator('#constructor [data-pw-installed-hero]').count(), 1);
    await page.locator('#constructor [data-huninstall]').click();
    assert.equal(await page.locator('#constructor [data-pw-installed-hero]').count(), 0);
    await page.locator('#constructor [data-pw-hardware-hull]').click();
    assert.equal(await page.locator('#constructor .pw-flagship-picker[open]').count(), 1);
    await page.evaluate(() => document.activeElement.blur());
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#constructor .pw-hero-equipment[open]').count(), 1);
    await page.evaluate(() => document.activeElement.blur());
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#constructor .pw-hero-equipment[open]').count(), 0);
    assert.ok(await page.locator('#constructor.show').count());
    await page.locator('#constructor .pw-flagship-picker > summary').click();
    assert.ok(await page.locator('#constructor .pw-flagship-picker[open]').count());
    await page.locator('#constructor [data-hflagship="scout"]').click();
    assert.ok(await page.locator('#constructor .pw-flagship-picker[open]').count());
    assert.ok(await page.locator('#constructor [data-hflagship="scout"].on').count());
    await page.evaluate(() => document.activeElement.blur());
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#constructor .pw-flagship-picker[open]').count(), 0);
    assert.ok(await page.locator('#constructor.show').count());
    await page.locator('#constructor .pw-flagship-picker > summary').click();
    await page.mouse.click(2, 2);
    assert.equal(await page.locator('#constructor .pw-flagship-picker[open]').count(), 0);
    assert.ok(await page.locator('#constructor.show').count());
    await page.locator('#constructor .pw-flagship-picker > summary').click();
    await page.locator('#constructor [data-hflagapply]').click();
    assert.equal(await page.locator('#constructor .pw-flagship-picker[open]').count(), 0);
    assert.ok(await page.locator('#constructor [data-hflagapply]').isDisabled());
    // A changing queue count must not reopen a disclosure the player closed.
    await page.evaluate(() => window.__productionFixture());
    await page.locator('#constructor [data-ctab="ships"]').first().click();
    if (await page.locator('#constructor .pw-queues[open]').count())
      await page.locator('#constructor .pw-queues > summary').click();
    await page.locator('#constructor [data-cnhull="frigate"]').click();
    await page.locator('#constructor [data-cnbuild]').click();
    assert.equal(await page.locator('#constructor .pw-queues[open]').count(), 0);
    assert.ok(await page.locator('#constructor .pw-job').count());
    // Repeating an equipped order after switching tabs must reopen its exact draft.
    await page.locator('#constructor [data-cnhull="frigate"]').click();
    const repeatedModule = await page.locator('#constructor [data-cnmod]').first().getAttribute('data-cnmod');
    await page.locator('#constructor [data-cnmod]').first().click();
    await page.locator('#constructor [data-cnbuild]').click();
    await page.locator('#constructor [data-ctab="infantry"]').first().click();
    await page.locator('#constructor [data-cnagain]').click();
    assert.ok(await page.locator('#constructor.pw-fitting-open').count());
    assert.equal(await page.locator('#constructor .cn-bay.filled [data-cnrm]').getAttribute('data-cnrm'), repeatedModule);
    assert.ok(await page.locator('#constructor [data-cnbuild]').isVisible());
    await page.locator('#constructor [data-cnbuild]').click();
    assert.equal(await page.locator('#constructor.pw-fitting-open').count(), 0);
    await page.locator('#constructor [data-ctab="infantry"]').first().click();
    await page.locator('#constructor [data-cnhull="militia"]').click();
    for (let n = 1; n < 4; n++) await page.locator('#constructor [data-cncount="+"]').click();
    assert.equal(await page.locator('#constructor .cn-sv').innerText(), '4');
    await page.locator('#constructor [data-cnbuild]').click();
    assert.equal(await page.locator('#constructor.pw-fitting-open').count(), 0);
    assert.match(await page.locator('#constructor #cn-queue').innerText(), /×4/);
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
} catch (error) {
  const page = browser.contexts().flatMap(context => context.pages()).at(-1);
  if (page) {
    await page.screenshot({ path: '/mnt/data/production-fidelity/browser-failure.png' });
    console.log(JSON.stringify(await page.evaluate(() => ['tech', 'codex', 'constructor'].map(id => {
      const el = document.getElementById(id);
      return { id, classes: el.className, rect: el.getBoundingClientRect().toJSON(), z: getComputedStyle(el).zIndex };
    }))));
  }
  throw error;
} finally {
  await browser.close();
  await site.close();
}
