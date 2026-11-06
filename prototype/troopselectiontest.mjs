/* global window, document, localStorage, location, history, getComputedStyle */
/** Exact army selection through the real menu and kernel, desktop/mobile and RU/EN. */
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { stop } from 'esbuild';
import {
  enterSkirmish,
  enterHubByCallsign,
  instrumentedGame,
  launchBrowser,
  serve,
  withDiagnostics,
} from './harnessKit.mjs';

const hooks = `
import { centerOn as __armyCenter } from './mapCamera';
import { effectiveStats as __armyStats } from '../../packages/shared-core/src/index';
window.__armySelection = {
  stage(many = false) {
    const staged = structuredClone(s);
    const home = Object.values(staged.planets).find(p => p.owner === ME && p.kind === 'planet');
    const ship = Object.entries(data.units).find(([,d]) => d.domain === 'space' && d.stats.cargoCapacity >= 6)[0];
    const veterans = {unit:'militia',count:4,battles:3};
    const hp = __armyStats(data.units.militia, veterans, data).hp;
    home.buildings = []; home.garrison = [
      {unit:'militia',count:4}, {...veterans,hp:hp*2}, {...veterans}
    ];
    const heavy = {unit:'heavy_infantry',count:4,battles:3};
    const heavyHp = __armyStats(data.units.heavy_infantry, heavy, data).hp;
    if (many) home.garrison = [
      ...Array.from({length:7},(_,i)=>({unit:'militia',count:1,battles:i})),
      {...heavy,hp:heavyHp*2}
    ];
    staged.fleets = { transport:{id:'transport',owner:ME,location:home.id,movement:null,
      orbit:'near',units:[{unit:ship,count:1}],traits:[],landing:[]} };
    staged.battles = {};
    installMatch(staged,new Map()); speed=0;
    setFleetSelection(['transport']); invalidatePanel(); renderPanel();
    __armyCenter(home.position,2.4);
    prepareEnteringMap();
    return {hp,heavyHp};
  },
  snapshot() {
    const f=s.fleets.transport;
    return {garrison:s.planets[f.location].garrison,landing:f.landing??[],loading:f.loading??[],unloading:f.unloading??[]};
  },
  advance() { apply(advance(s,s.time+3600000)); }
};
`;

/** No locator auto-scroll: prove that the actual button is visible and receives a tap. */
async function buttonPoint(button) {
  return button.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const list = el.closest('.tlist')?.getBoundingClientRect();
    const x = r.x + r.width / 2, y = r.y + r.height / 2;
    return { x, y, visible: r.width >= 43 && r.height >= 43 &&
      (!list || r.top >= list.top && r.bottom <= list.bottom) &&
      y >= 0 && y < window.innerHeight && el.contains(document.elementFromPoint(x, y)) };
  });
}

async function tapButton(page, button, phone) {
  const point = await buttonPoint(button);
  assert.ok(point.visible, `button must be fully visible and clickable: ${JSON.stringify(point)}`);
  if (phone) await page.touchscreen.tap(point.x, point.y);
  else await page.mouse.click(point.x, point.y);
}

/** Scroll with native touch gestures, rather than forcing a click through clipped content. */
async function reachHeavy(page, menu, button, phone) {
  const list = menu.locator('.tlist');
  const rect = await list.boundingBox();
  assert.ok(rect && rect.height >= 80, `transfer list needs usable height: ${JSON.stringify(rect)}`);
  const session = phone ? await page.context().newCDPSession(page) : null;
  try {
    for (let attempt = 0; attempt < 20; attempt++) {
      if ((await buttonPoint(button)).visible) return;
      const target = await button.boundingBox();
      const center = rect.y + rect.height / 2;
      const amount = Math.max(-rect.height * .6, Math.min(rect.height * .6, target.y + target.height / 2 - center));
      const x = rect.x + 16;
      if (session) {
        const from = amount > 0 ? rect.y + rect.height - 16 : rect.y + 16;
        await session.send('Input.dispatchTouchEvent', {type:'touchStart',touchPoints:[{x,y:from}]});
        for (let step = 1; step <= 8; step++) {
          await session.send('Input.dispatchTouchEvent', {type:'touchMove',touchPoints:[{x,y:from-amount*step/8}]});
          await page.waitForTimeout(20);
        }
        await session.send('Input.dispatchTouchEvent', {type:'touchEnd',touchPoints:[]});
      } else {
        await page.mouse.move(x, center);
        await page.mouse.wheel(0, amount);
      }
      await page.waitForTimeout(160);
    }
    assert.fail('heavy-infantry controls must be reachable by normal scrolling');
  } finally { await session?.detach(); }
}

const site = await serve(await instrumentedGame(hooks));
// The compiler's asset graph can retain hundreds of MB; the browser only needs its output.
await stop();
const browser = await launchBrowser();
const out = process.env.TROOP_SELECTION_SHOTS;
if (out) mkdirSync(out, { recursive: true });
try {
  for (const {width, height} of [{width:1440,height:1000},{width:390,height:844},{width:320,height:568},{width:844,height:390}])
    for (const locale of ['ru', 'en']) {
      const phone = width < 720 || height < 520;
      const page = await browser.newPage({
        viewport: { width, height },
        isMobile: phone,
        hasTouch: phone,
      });
      page.setDefaultTimeout(15000);
      const errors = [];
      console.log(`CHECK army transfer ${width}x${height} ${locale}`);
      page.on('pageerror', (e) => errors.push(e.message));
      page.on('console', (m) => {
        if (m.type() === 'error') errors.push(m.text());
      });
      try {
        await withDiagnostics(page, `army-selection-${width}-${locale}`, async () => {
          await page.addInitScript((lang) => {
            localStorage.setItem('vd.locale', lang);
            localStorage.setItem('void.server', location.origin.replace(/^http/, 'ws'));
          }, locale);
          // The instrumented module is the readiness signal; browser document
          // lifecycle can lag it in the self-contained asset-heavy page.
          await page.goto(site.url, { waitUntil: 'commit' });
          await page.waitForFunction(() => !!window.__armySelection);
          await enterHubByCallsign(page, 'EmbarkTester', phone);
          await enterSkirmish(page, { tap: phone, fromWelcome: false });
          await page.locator('#maploading').waitFor({ state: 'hidden' });
          const { hp } = await page.evaluate(() => window.__armySelection.stage());
          await page.locator('#maploading').waitFor({ state: 'hidden' });
          if (phone && !(await page.locator('[data-cmd="troops"]:visible').count()))
            await page.locator('[data-cmd="more"]:visible').first().click();
          await page.locator('[data-cmd="troops"]:visible').first().click();
          const menu = page.locator('.tpop:visible');
          await menu.waitFor();
          assert.equal(await menu.evaluate((el) => !!el.closest('#troopswin')), true,
            'army transfer must open in its own window, outside the fleet command grid');
          await page.waitForFunction(() =>
            window.__armySelection.snapshot().garrison.every((s) => !!s.armyGroup),
          );
          const before = await page.evaluate(() => window.__armySelection.snapshot());
          assert.equal(await menu.locator('[data-troop-group]').count(), 2);
          const group = before.garrison[1].armyGroup;
          const row = menu.locator(`[data-troop-group="garrison:${group}"]`);
          assert.match(await row.innerText(), /75%/);
          assert.match(await row.innerText(), locale === 'ru' ? /Выслуга: 3/ : /Service grade: 3/);
          assert.match(await row.innerText(), locale === 'ru' ? /Боёв: 3/ : /Battles: 3/);
          // Both direct entry and native range changes reach the same clamped plan.
          await row.locator('.tdelta').fill('3');
          await row.locator('[data-cmd="tstep"][data-n="1"]').click();
          assert.equal(await row.locator('.tdelta').inputValue(), '4', 'blur/change must not swallow the next plus click');
          await row.locator('.tdelta').fill('1');
          await menu.locator('[data-direction="unload"]').click();
          assert.equal(await menu.locator('[data-direction="unload"]').getAttribute('aria-selected'), 'true');
          await menu.locator('[data-direction="load"]').click();
          await row.locator('.trange').fill('2');
          await row.locator('.trange').dispatchEvent('change');
          assert.equal(await row.locator('.tdelta').inputValue(), '2');
          assert.equal(await menu.locator('.chosen').count(), 1);
          const compact = await row.evaluate((el) => ({
            width: el.getBoundingClientRect().width,
            inner: el.querySelector('.tunit-head').getBoundingClientRect().width,
            accent: getComputedStyle(el.querySelector('.trange')).accentColor,
            gap: getComputedStyle(el.parentElement).gap,
          }));
          assert.ok(compact.inner >= compact.width - 24, JSON.stringify(compact));
          assert.notEqual(compact.accent, 'auto');
          assert.equal(compact.gap, '6px');
          const overflow = await menu.evaluate((el) => ({
            scroll: el.scrollWidth,
            client: el.clientWidth,
            left: el.getBoundingClientRect().left,
            right: el.getBoundingClientRect().right,
          }));
          assert.ok(overflow.scroll <= overflow.client + 1, JSON.stringify(overflow));
          assert.ok(overflow.left >= -1 && overflow.right <= width + 1, JSON.stringify(overflow));
          if (out) await page.screenshot({ path: `${out}/${width}-${locale}.png` });
          await row.locator('.tdelta').fill('1');
          await row.locator('.tdelta').press('Tab');
          await row.locator('.tdelta').fill('2');
          await menu.locator('[data-cmd="tok"]').click();
          await page.locator('#troopswin').waitFor({ state: 'hidden' });
          const ordered = await page.evaluate(() => window.__armySelection.snapshot());
          assert.deepEqual(ordered.loading.flatMap(c => c.sources), [{ group, count: 1 }, { group: before.garrison[2].armyGroup, count: 1 }]);
          assert.deepEqual(ordered.garrison, before.garrison);
          await page.evaluate(() => window.__armySelection.advance());
          const loaded = await page.evaluate(() => window.__armySelection.snapshot());
          assert.equal(loaded.landing.reduce((n,s) => n+s.count, 0), 2);
          assert.equal(loaded.landing.reduce((n,s) => n+(s.hp ?? s.count*hp), 0), hp * 1.5);
          assert.equal(loaded.landing[0].battles, 3);
          assert.deepEqual(
            loaded.garrison.map((s) => s.count),
            [4, 3, 3],
          );
          if (phone && !(await page.locator('[data-cmd="troops"]:visible').count()))
            await page.locator('[data-cmd="more"]:visible').first().click();
          await page.locator('[data-cmd="troops"]:visible').first().click();
          await page.waitForFunction(
            () => !!window.__armySelection.snapshot().landing[0].armyGroup,
          );
          const aboard = await page.evaluate(
            () => window.__armySelection.snapshot().landing[0].armyGroup,
          );
          await menu.locator('[data-cmd="tdirection"][data-direction="unload"]').click();
          const unload = menu.locator(`[data-troop-group="hold:${aboard}"]`);
          assert.match(await unload.innerText(), /75%/);
          await unload.locator('[data-cmd="tstep"][data-n="-1"]').click();
          await menu.locator('[data-cmd="tok"]').click();
          const unloading = await page.evaluate(() => window.__armySelection.snapshot());
          assert.deepEqual(unloading.unloading[0].sources, [{ group: aboard, count: 1 }]);
          assert.equal(unloading.landing.reduce((n,s) => n+s.count,0), 2);
          await page.evaluate(() => window.__armySelection.advance());
          const done = await page.evaluate(() => window.__armySelection.snapshot());
          assert.equal(done.landing[0].count, 1);
          assert.equal(done.landing.reduce((n,s) => n+(s.hp ?? s.count*hp), 0), hp);
          // The reported failure: heavy infantry below a long list of formations.
          const {heavyHp} = await page.evaluate(() => window.__armySelection.stage(true));
          await page.locator('#maploading').waitFor({ state: 'hidden' });
          if (phone && !(await page.locator('[data-cmd="troops"]:visible').count()))
            await page.locator('[data-cmd="more"]:visible').first().click();
          await page.locator('[data-cmd="troops"]:visible').first().click();
          await menu.waitFor();
          await page.waitForFunction(() => window.__armySelection.snapshot().garrison.every(s => !!s.armyGroup));
          const heavyBefore = await page.evaluate(() => window.__armySelection.snapshot());
          const heavyGroup = heavyBefore.garrison.find(s => s.unit === 'heavy_infantry').armyGroup;
          const heavyRow = menu.locator(`[data-troop-group="garrison:${heavyGroup}"]`);
          assert.match(await heavyRow.innerText(), /HP:.*\//);
          assert.match(await heavyRow.innerText(), /50%/);
          const plus = heavyRow.locator('[data-cmd="tstep"][data-n="1"]');
          const confirm = menu.locator('[data-cmd="tok"]');
          assert.ok((await buttonPoint(confirm)).visible, 'confirmation stays visible before scrolling');
          await reachHeavy(page, menu, plus, phone);
          const scroll = await menu.locator('.tlist').evaluate(el => el.scrollTop);
          assert.ok(!phone || scroll > 0, 'heavy infantry fixture exercises the scrollable phone list');
          await tapButton(page, plus, phone);
          assert.equal(await heavyRow.locator('.tdelta').inputValue(), '1');
          assert.ok(Math.abs(await menu.locator('.tlist').evaluate(el => el.scrollTop) - scroll) <= 1,
            'changing quantity must preserve scroll position');
          await tapButton(page, plus, phone);
          assert.equal(await heavyRow.locator('.tdelta').inputValue(), '2');
          assert.equal(await menu.locator('.chosen').count(), 1);
          assert.ok((await buttonPoint(confirm)).visible, 'confirmation stays visible after scrolling');
          if (out) await page.screenshot({path:`${out}/${width}-${locale}-heavy.png`});
          await tapButton(page, confirm, phone);
          const heavyOrdered = await page.evaluate(() => window.__armySelection.snapshot());
          assert.deepEqual(heavyOrdered.loading[0].sources, [{group:heavyGroup,count:2}]);
          await page.evaluate(() => window.__armySelection.advance());
          const heavyDone = await page.evaluate(() => window.__armySelection.snapshot());
          assert.equal(heavyDone.landing[0].unit, 'heavy_infantry');
          assert.equal(heavyDone.landing[0].count, 2);
          assert.ok(Math.abs(heavyDone.landing[0].hp - heavyHp) < 1e-8);
          assert.equal(heavyDone.garrison.find(s => s.unit === 'heavy_infantry').count, 2);
          if ((width === 390 && locale === 'ru') || (width === 1440 && locale === 'en')) {
            if (phone && !(await page.locator('[data-cmd="troops"]:visible').count()))
              await page.locator('[data-cmd="more"]:visible').first().click();
            await page.locator('[data-cmd="troops"]:visible').first().click();
            await menu.waitFor();
            // Keyboard focus stays inside the dialog; Android Back cancels it.
            await page.keyboard.press('Shift+Tab');
            assert.equal(await page.evaluate(() => document.activeElement === [...document.querySelectorAll('#troopswin button:not([disabled]):not([tabindex="-1"]),#troopswin input:not([disabled])')].at(-1)), true);
            await page.keyboard.press('Tab');
            assert.equal(await page.evaluate(() => !!document.activeElement?.closest('.troops-head')), true);
            if (phone) await page.evaluate(() => history.back());
            else await page.keyboard.press('Escape');
            await page.locator('#troopswin').waitFor({state:'hidden'});
            assert.equal(await page.evaluate(() => document.activeElement?.dataset.cmd), 'troops');
            assert.equal((await page.evaluate(() => window.__armySelection.snapshot())).unloading.length, 0);
          }
          assert.deepEqual(errors, []);
          console.log(
            `PASS ${width}x${height} ${locale}: wounded veterans load/unload; heavy infantry reached by native scrolling, HP visible, quantity and confirmation work`,
          );
        });
      } finally {
        await page.close();
      }
    }
} finally {
  await browser.close();
  site.server.closeAllConnections();
  await site.close();
}
