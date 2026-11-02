/* global window, localStorage */
/** Exact army selection through the real menu and kernel, desktop/mobile and RU/EN. */
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import {
  enterSkirmish,
  instrumentedGame,
  launchBrowser,
  serve,
  withDiagnostics,
} from './harnessKit.mjs';

const hooks = `
import { centerOn as __armyCenter } from './mapCamera';
import { effectiveStats as __armyStats } from '../../packages/shared-core/src/index';
window.__armySelection = {
  stage() {
    const staged = structuredClone(s);
    const home = Object.values(staged.planets).find(p => p.owner === ME && p.kind === 'planet');
    const ship = Object.entries(data.units).find(([,d]) => d.domain === 'space' && d.stats.cargoCapacity >= 6)[0];
    const veterans = {unit:'militia',count:4,battles:3};
    const hp = __armyStats(data.units.militia, veterans, data).hp;
    home.buildings = []; home.garrison = [
      {unit:'militia',count:4}, {...veterans,hp:hp*2}, {...veterans}
    ];
    staged.fleets = { transport:{id:'transport',owner:ME,location:home.id,movement:null,
      orbit:'near',units:[{unit:ship,count:1}],traits:[],landing:[]} };
    staged.battles = {};
    installMatch(staged,new Map()); speed=0;
    setFleetSelection(['transport']); invalidatePanel(); renderPanel();
    __armyCenter(home.position,2.4);
    return {hp};
  },
  snapshot() {
    const f=s.fleets.transport;
    return {garrison:s.planets[f.location].garrison,landing:f.landing??[],loading:f.loading??[],unloading:f.unloading??[]};
  },
  advance() { apply(advance(s,s.time+3600000)); }
};
`;
const site = await serve(await instrumentedGame(hooks));
const browser = await launchBrowser();
const out = process.env.TROOP_SELECTION_SHOTS;
if (out) mkdirSync(out, { recursive: true });
try {
  for (const width of [1440, 390, 320])
    for (const locale of ['ru', 'en']) {
      const phone = width < 600;
      const page = await browser.newPage({
        viewport: { width, height: phone ? 844 : 1000 },
        isMobile: phone,
        hasTouch: phone,
      });
      page.setDefaultTimeout(15000);
      const errors = [];
      page.on('pageerror', (e) => errors.push(e.message));
      page.on('console', (m) => {
        if (m.type() === 'error') errors.push(m.text());
      });
      try {
        await withDiagnostics(page, `army-selection-${width}-${locale}`, async () => {
          await page.addInitScript((lang) => localStorage.setItem('vd.locale', lang), locale);
          await page.goto(site.url);
          await enterSkirmish(page, { tap: phone });
          await page.locator('#maploading').waitFor({ state: 'hidden' });
          const { hp } = await page.evaluate(() => window.__armySelection.stage());
          await page.locator('#maploading').waitFor({ state: 'hidden' });
          if (phone && !(await page.locator('[data-cmd="troops"]:visible').count()))
            await page.locator('[data-cmd="more"]:visible').first().click();
          await page.locator('[data-cmd="troops"]:visible').first().click();
          const menu = page.locator('.tpop:visible');
          await menu.waitFor();
          await page.waitForFunction(() =>
            window.__armySelection.snapshot().garrison.every((s) => !!s.armyGroup),
          );
          const before = await page.evaluate(() => window.__armySelection.snapshot());
          assert.equal(await menu.locator('[data-troop-group]').count(), 3);
          const group = before.garrison[1].armyGroup;
          const row = menu.locator(`[data-troop-group="garrison:${group}"]`);
          assert.match(await row.innerText(), /50%/);
          assert.match(await row.innerText(), locale === 'ru' ? /Выслуга: 3/ : /Service grade: 3/);
          assert.match(await row.innerText(), locale === 'ru' ? /Боёв: 3/ : /Battles: 3/);
          await row.locator('[data-cmd="tstep"][data-n="1"]').click();
          await row.locator('[data-cmd="tstep"][data-n="1"]').click();
          assert.equal(await row.locator('.tdelta').innerText(), '+2');
          assert.equal(await menu.locator('.chosen').count(), 1);
          const overflow = await menu.evaluate((el) => ({
            scroll: el.scrollWidth,
            client: el.clientWidth,
            left: el.getBoundingClientRect().left,
            right: el.getBoundingClientRect().right,
          }));
          assert.ok(overflow.scroll <= overflow.client + 1, JSON.stringify(overflow));
          assert.ok(overflow.left >= -1 && overflow.right <= width + 1, JSON.stringify(overflow));
          if (out) await page.screenshot({ path: `${out}/${width}-${locale}.png` });
          await menu.locator('[data-cmd="tok"]').click();
          const ordered = await page.evaluate(() => window.__armySelection.snapshot());
          assert.deepEqual(ordered.loading[0].sources, [{ group, count: 2 }]);
          assert.equal(ordered.garrison[1].count, 4);
          await page.evaluate(() => window.__armySelection.advance());
          const loaded = await page.evaluate(() => window.__armySelection.snapshot());
          assert.equal(loaded.landing[0].count, 2);
          assert.equal(loaded.landing[0].hp, hp);
          assert.equal(loaded.landing[0].battles, 3);
          assert.deepEqual(
            loaded.garrison.map((s) => s.count),
            [4, 2, 4],
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
          const unload = menu.locator(`[data-troop-group="hold:${aboard}"]`);
          assert.match(await unload.innerText(), /50%/);
          await unload.locator('[data-cmd="tstep"][data-n="-1"]').click();
          await menu.locator('[data-cmd="tok"]').click();
          const unloading = await page.evaluate(() => window.__armySelection.snapshot());
          assert.deepEqual(unloading.unloading[0].sources, [{ group: aboard, count: 1 }]);
          assert.equal(unloading.landing[0].count, 2);
          await page.evaluate(() => window.__armySelection.advance());
          const done = await page.evaluate(() => window.__armySelection.snapshot());
          assert.equal(done.landing[0].count, 1);
          assert.equal(done.landing[0].hp, hp / 2);
          assert.deepEqual(errors, []);
          console.log(
            `PASS ${width}px ${locale}: three distinct formations, exact wounded veterans loaded/unloaded, no overflow or browser errors`,
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
