#!/usr/bin/env node
/* global window, document, localStorage */
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { instrumentedGame, launchBrowser, serve, waitForApp } from './harnessKit.mjs';

// Only the clock is accelerated. All orders and selections go through the visible UI.
const host = await serve(
  await instrumentedGame(`
// Счётчики гида — у обучения (REFM-221); \`main.ts\` их больше не видит.
import { guideFleet as __guideFleet, guideMineLevel as __guideMineLevel, guideShipCount as __guideShipCount, guideHeroFleet as __guideHeroFleet } from '../../decisions/firstMatchGuide';
window.__trail = [];
{ let last = '';
  setInterval(() => {
    const now = String(selPlanet) + '|' + String(selFleet);
    if (now !== last) window.__trail.push({ step: document.querySelector('#spotlight')?.dataset.step, sel: now, day: s.time });
    last = now;
    if (window.__trail.length > 12) window.__trail.shift();
  }, 25);
}
window.__guideTest = {
  advanceHours: (hours) => apply(advance(s, s.time + hours * 3600000)),
  facts: () => ({ planets: Object.values(s.planets).filter(p => p.owner === ME).map(p => p.id),
    ships: __guideShipCount(s, ME), fleet: __guideFleet(s, ME), onboard: loadOnboard(),
    xp: loadMeta().xp, mine: __guideMineLevel(s, 'home_1'), tech: s.players[ME]?.technologies, selected: selFleet,
    hero: Object.values(s.heroes ?? {}).find(h => h.owner === ME && h.grade === 'main'),
    lots: (s.market ?? []).filter(o => o.owner === 'npc-guild').length,
    log: logLines.slice(-6), world: selPlanet,
    heroFleet: (() => { const f = __guideHeroFleet(s, ME); return f && { id: f.id, at: f.location, mv: f.movement }; })(),
    medal: Object.keys(localStorage).filter(k => k.startsWith('vd.medal.tutorial.')).map(k => JSON.parse(localStorage.getItem(k))) }),
};`),
);
const browser = await launchBrowser();
mkdirSync('/tmp/gw-onboarding', { recursive: true });
const modes = process.argv.includes('--desktop')
  ? ['desktop']
  : process.argv.includes('--phone')
    ? ['phone']
    : ['desktop', 'phone'];
// The operation chapters (firstMatchOperation.ts) name their own steps `<chapter>.<step>`;
// these wait on the world clock and move forward in one-hour hops, never past a step.
const opWait = (step) => /^[a-z]+\.(?:[a-z]+-wait|troops-aboard|flight|capture)$/.test(step);
const shots = new Set([
  'mine-order',
  'ship-order',
  'course',
  'done',
  'market.sell',
  'hero.remove',
  'hero.world',
  'ground.militia',
  'aviation.load',
  'landing.troops-max',
  'landing.course',
  'assault.strike-target',
  'assault.rally',
  'assault.capture',
]);
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
// The guide scrolls a target below a window's fold into view (smoothly): press it once the
// highlight stands still on screen, as a player would.
async function settledRing(page) {
  const { height } = page.viewportSize();
  let prev = null;
  for (let i = 0; i < 40; i++) {
    const rect = await page.locator('.sl-ring').boundingBox();
    const centre = rect && rect.y + rect.height / 2;
    if (
      rect &&
      prev &&
      Math.abs(rect.x - prev.x) < 1 &&
      Math.abs(rect.y - prev.y) < 1 &&
      centre > 0 &&
      centre < height
    )
      return rect;
    prev = rect;
    await page.waitForTimeout(100);
  }
  return prev;
}
async function stepMoved(page, step, timeout, required = false) {
  try {
    await page.waitForFunction(
      (previous) => document.querySelector('#spotlight')?.dataset.step !== previous,
      step,
      { timeout },
    );
    return true;
  } catch (e) {
    if (required) throw e;
    return false;
  }
}
try {
  for (const mode of modes) {
    const page = await browser.newPage(
      mode === 'phone'
        ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }
        : { viewport: { width: 1280, height: 800 } },
    );
    const errors = [];
    await page.addInitScript(() => {
      window.__clicks = [];
      document.addEventListener(
        'pointerdown',
        (e) =>
          window.__clicks.push({
            x: e.clientX,
            y: e.clientY,
            step: document.querySelector('#spotlight')?.dataset.step,
            tgt: e.target?.id || String(e.target?.className),
          }),
        true,
      );
    });
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
        for (let guard = 0; guard < 160; guard++) {
          await page.locator('#spotlight').waitFor({ state: 'visible' });
          const step = await page.locator('#spotlight').getAttribute('data-step');
          assert.notEqual(step, last, `stuck at ${step}`);
          last = step;
          console.log(mode, step);
          // The lesson's ×300 rides on the speedbar on PC and on the phone's speed button.
          if (step === 'welcome')
            if (mode === 'phone')
              assert.match(await page.locator('#phone-speed').innerText(), /×300/);
            else assert.ok(await page.locator('#spd-lesson').isVisible(), 'no ×300');
          if (pass === 0 && shots.has(step))
            await page.screenshot({ path: `/tmp/gw-onboarding/${mode}-${step}.png` });
          if (pass === 1 && step.includes('.')) {
            // The replay checks the chapter skip: the operation is left for later.
            await page.locator('.sl-skip-stage').click();
          } else if (['mine-wait', 'research-wait', 'ship-wait', 'capture'].includes(step)) {
            await page.evaluate(() => window.__guideTest.advanceHours(24));
          } else if (opWait(step)) {
            for (let h = 0; h < 48; h++) {
              await page.evaluate(() => window.__guideTest.advanceHours(1));
              await page.waitForTimeout(50);
              if ((await page.locator('#spotlight').getAttribute('data-step')) !== step) break;
            }
          } else if (['welcome', 'nav', 'score', 'done'].includes(step)) {
            await page.locator('.sl-next').click();
            if (step === 'done') break;
          } else {
            if (['home', 'fleet', 'course'].includes(step) || step.includes('.')) {
              const reveal = page.locator('.sl-reveal');
              if (await reveal.isVisible()) {
                await reveal.click();
                await page.waitForTimeout(200);
              }
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
              // A target the guide is still scrolling out from under a panel's edge can
              // miss the first press; a step that has not moved is pressed again.
              for (let attempt = 0; attempt < 3; attempt++) {
                // Four militia: the order button is pressed four times.
                for (let n = step === 'ground.militia' && attempt === 0 ? 4 : 1; n > 0; n--) {
                  const rect = await settledRing(page);
                  assert.ok(rect && rect.width > 0, `missing target for ${step}`);
                  // A real pointer event at the highlighted target, including canvas objects.
                  if (mode === 'phone')
                    await page.touchscreen.tap(rect.x + rect.width / 2, rect.y + rect.height / 2);
                  else await page.mouse.click(rect.x + rect.width / 2, rect.y + rect.height / 2);
                  if (n > 1) await page.waitForTimeout(150);
                }
                if (await stepMoved(page, step, 4000)) break;
              }
            }
          }
          await stepMoved(page, step, 30000, true);
        }
        const medal = page.locator('#tutorial-medal');
        if (pass === 0) {
          // The whole course earns the medal: the award window opens over the match.
          await medal.waitFor({ state: 'visible' });
          await page.waitForFunction(
            () => document.querySelector('#tutorial-medal [role="status"]')?.textContent,
          );
          await page.screenshot({ path: `/tmp/gw-onboarding/${mode}-medal.png` });
          await medal.locator('[data-tmedal="ok"]').click();
          await medal.waitFor({ state: 'hidden' });
        } else {
          await page.waitForTimeout(300);
          assert.equal(await medal.isVisible(), false, 'the medal window opens once');
        }
        const facts = await page.evaluate(() => window.__guideTest.facts());
        assert.equal(facts.onboard.completed, true);
        assert.ok(facts.mine >= 2);
        assert.ok(facts.ships >= 1);
        assert.ok(facts.tech.completed.includes('frigate_design'));
        assert.ok(facts.planets.includes('shale'));
        assert.deepEqual(facts.medal, [{ earned: true, claimed: [] }]);
        if (pass === 0) {
          // The operation by real orders: both guild lots, the refit, the deployed hero ship
          // and the garrisoned world taken by the landing.
          assert.equal(facts.lots, 0);
          assert.deepEqual(facts.hero.modules, ['repair_bay', 'cargo_bay']);
          assert.ok(facts.hero.fleetId);
          assert.ok(facts.planets.includes('world_1'));
        }
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
        `${mode}: complete, real research/build/movement/capture, market/hero/troops/aviation/assault and the medal; replay/chapter skip/skip/fold and existing save preserved`,
      );
    } catch (e) {
      console.error(e);
      await page.screenshot({ path: `/tmp/gw-onboarding/${mode}-failure.png` }).catch(() => {});
      // The same state in the job log too: the artifact is not always at hand.
      const where = await page
        .evaluate(() => ({
          step: document.querySelector('#spotlight')?.dataset.step,
          copy: document.querySelector('.sl-copy')?.textContent,
          log: window.__guideTest?.facts().log,
          side: document.querySelector('#side')?.innerText.slice(0, 1500),
          picked: window.__guideTest?.facts().world,
          selected: window.__guideTest?.facts().selected,
          fleets: window.__guideTest?.facts().heroFleet,
          clicks: window.__clicks?.slice(-6),
          trail: window.__trail,
        }))
        .catch(() => null);
      console.error(`${mode} failure state:`, JSON.stringify(where, null, 2));
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
