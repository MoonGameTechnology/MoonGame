#!/usr/bin/env node
/* global window, document, localStorage */
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { instrumentedGame, launchBrowser, serve, waitForApp } from './harnessKit.mjs';

// Only the clock is accelerated. All orders and selections go through the visible UI.
const host = await serve(
  await instrumentedGame(`
// Счётчики гида — у обучения (REFM-221); \`main.ts\` их больше не видит.
import { guideFleet as __guideFleet, guideMineLevel as __guideMineLevel, guideShipCount as __guideShipCount } from '../../decisions/firstMatchGuide';
window.__guideTest = {
  advanceHours: (hours) => apply(advance(s, s.time + hours * 3600000)),
  facts: () => ({ planets: Object.values(s.planets).filter(p => p.owner === ME).map(p => p.id),
    ships: __guideShipCount(s, ME), fleet: __guideFleet(s, ME), onboard: loadOnboard(),
    xp: loadMeta().xp, mine: __guideMineLevel(s, 'home_1'), tech: s.players[ME]?.technologies, selected: selFleet }),
};`),
);
const browser = await launchBrowser();
mkdirSync('/tmp/gw-onboarding', { recursive: true });
const modes = process.argv.includes('--desktop')
  ? ['desktop']
  : process.argv.includes('--phone')
    ? ['phone']
    : ['desktop', 'phone'];
const controls = {
  'buildings-tab': '[data-act="tab"][data-arg="buildings"]',
  details: '#mobile-sheet [data-mobile="details"]',
  mine: '[data-codex^="b:mine:"]',
  'mine-order': '#codex [data-cx-upg="mine"]',
  'mine-close': '#codex .cx-close',
  'tech-menu': '[data-phone-tab="more"]',
  tech: '#holo-tech:visible, #rail-tech:visible, [data-phone-tab="science"]:visible, [data-phone-more="science"]:visible',
  'research-tab': '#tech [data-ttab="space"]',
  research: '#tech [data-go="frigate_design"]',
  'research-close': '#tech .tw-close',
  'ships-tab': '[data-act="tab"][data-arg="ships"]',
  catalog: '[data-act="openunits"][data-arg="ships"]',
  ship: '#buildwin [data-unit-info="frigate"] .bw-ih b',
  'ship-order': '#codex [data-build="unit:frigate"]',
  'catalog-close': '#buildwin .tw-close',
  move: '[data-cmd="move"]',
  'course-confirm': '[data-cmd="mobile-send"]',
};
try {
  for (const mode of modes) {
    const page = await browser.newPage(
      mode === 'phone'
        ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }
        : { viewport: { width: 1280, height: 800 } },
    );
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.setDefaultTimeout(30000);
    try {
      if (mode === 'phone')
        await page.addInitScript(() =>
          localStorage.setItem('void.phone.bar', 'production,events,diplomacy'),
        );
      await page.goto(host.url);
      await waitForApp(page, { timeout: 30000 });
      await page.locator('#cnew').click();
      const saved = await page.evaluate(() => {
        const value = JSON.stringify({ priorSave: 'must survive the lesson' });
        localStorage.setItem('void.solo.v1', value);
        return value;
      });
      let firstXp;
      const replay = async () => {
        // The same menu action used by the Back/Exit controls; no world mutation.
        await page.evaluate(() => document.getElementById('tomenu').click());
        await page.locator('[data-hub="more"]').click();
        await page.locator('#hub-tutorial').click();
      };
      for (let pass = 0; pass < 2; pass++) {
        if (pass) await replay();
        else await page.locator('#ob-start').click();
        let last = '';
        for (let guard = 0; guard < 40; guard++) {
          await page.locator('#spotlight').waitFor({ state: 'visible' });
          const step = await page.locator('#spotlight').getAttribute('data-step');
          assert.notEqual(step, last, `stuck at ${step}`);
          last = step;
          console.log(mode, step);
          if (['mine-order', 'ship-order', 'course', 'done'].includes(step))
            await page.screenshot({ path: `/tmp/gw-onboarding/${mode}-${step}.png` });
          if (['mine-wait', 'research-wait', 'ship-wait', 'capture'].includes(step)) {
            await page.evaluate(() => window.__guideTest.advanceHours(24));
          } else if (['welcome', 'nav', 'score', 'done'].includes(step)) {
            await page.locator('.sl-next').click();
            if (step === 'done') break;
          } else {
            if (['home', 'fleet', 'course'].includes(step)) {
              await page.locator('.sl-reveal').click();
              await page.waitForTimeout(200);
            }
            if (step === 'fleet') {
              const id = await page.evaluate(() => window.__guideTest.facts().fleet.id);
              const control = page
                .locator(`[data-act="selfleet"][data-arg="${id}"]`)
                .filter({ visible: true })
                .first();
              if (mode === 'phone') await control.tap();
              else await control.click();
            } else if (controls[step]) {
              const control = page.locator(controls[step]).filter({ visible: true }).first();
              if (mode === 'phone') await control.tap();
              else await control.click();
            } else {
              const rect = await page.locator('.sl-ring').boundingBox();
              assert.ok(rect && rect.width > 0, `missing target for ${step}`);
              // A real pointer event at the highlighted target, including canvas objects.
              if (mode === 'phone')
                await page.touchscreen.tap(rect.x + rect.width / 2, rect.y + rect.height / 2);
              else await page.mouse.click(rect.x + rect.width / 2, rect.y + rect.height / 2);
            }
          }
          await page.waitForFunction(
            (previous) => document.querySelector('#spotlight')?.dataset.step !== previous,
            step,
          );
        }
        const facts = await page.evaluate(() => window.__guideTest.facts());
        assert.equal(facts.onboard.completed, true);
        assert.ok(facts.mine >= 2);
        assert.ok(facts.ships >= 1);
        assert.ok(facts.tech.completed.includes('frigate_design'));
        assert.ok(facts.planets.includes('shale'));
        assert.equal(await page.evaluate(() => localStorage.getItem('void.solo.v1')), saved);
        if (pass === 0) firstXp = facts.xp;
        else assert.equal(facts.xp, firstXp, 'replay cannot award XP again');
      }
      await replay();
      await page.locator('.sl-fold').click();
      await page.locator('#spotlight-chip').click();
      await page.locator('.sl-skip').click();
      const skipped = await page.evaluate(() => window.__guideTest.facts());
      assert.equal(skipped.onboard.skipped, true);
      assert.equal(skipped.xp, firstXp);
      assert.equal(await page.evaluate(() => localStorage.getItem('void.solo.v1')), saved);
      assert.deepEqual(errors, []);
      console.log(
        `${mode}: complete, real research/build/movement/capture; replay/skip/fold and existing save preserved`,
      );
    } catch (e) {
      console.error(e);
      await page.screenshot({ path: `/tmp/gw-onboarding/${mode}-failure.png` }).catch(() => {});
      writeFileSync(
        `/tmp/gw-onboarding/${mode}-failure.json`,
        JSON.stringify(
          await page.evaluate(() => ({
            step: document.querySelector('#spotlight')?.dataset.step,
            copy: document.querySelector('.sl-copy')?.textContent,
            facts: window.__guideTest?.facts(),
            buttons: [...document.querySelectorAll('button')]
              .filter((e) => e.offsetWidth && e.offsetHeight)
              .map((e) => ({ id: e.id, text: e.textContent, data: { ...e.dataset } })),
          })),
          null,
          2,
        ),
      );
      throw e;
    } finally {
      await page.close();
    }
  }
} finally {
  await browser.close();
  await host.close();
}
