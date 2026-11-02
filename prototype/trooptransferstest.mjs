/* global window, localStorage, CanvasRenderingContext2D, requestAnimationFrame */
/** Map-view troop transfer regression: real orders, real canvas, RU/EN, PC/phone. */
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
import { centerOn as __transferCenterOn } from './mapCamera';
import { loadArmy as __loadArmy, unloadArmy as __unloadArmy, assaultFleet as __assaultFleet, moveFleet as __moveFleet } from './game';
window.__transferTest = {
  stage() {
    const staged = structuredClone(s);
    const home = Object.values(staged.planets).find(p => p.owner === ME && p.kind === 'planet');
    const away = Object.values(staged.planets).find(p => p.id !== home.id && p.kind === 'planet');
    const ship = Object.entries(data.units).find(([,d]) => d.domain === 'space' && d.stats.cargoCapacity >= 6)[0];
    home.garrison = [{ unit:'militia', count:10 }];
    away.owner = 'p2'; away.buildings = []; away.garrison = [{ unit:'militia', count:2 }];
    const make = (id, at, troops=0) => ({ id, owner:ME, location:at, movement:null,
      orbit:'near', units:[{unit:ship,count:1}], traits:[],
      landing:troops ? [{unit:'militia',count:troops}] : [] });
    staged.fleets = {
      loading: make('loading',home.id),
      second: make('second',home.id),
      unloading: make('unloading',home.id,2),
      assault: make('assault',away.id,2),
      assault2: make('assault2',away.id,2),
    };
    staged.battles = {};
    staged.diplomacy = { ...(staged.diplomacy??{}), [[ME,'p2'].sort().join('|')]:'war' };
    installMatch(staged,new Map()); speed = 0;
    playerOrder(__loadArmy(ME,'loading','militia',2));
    playerOrder(__loadArmy(ME,'second','militia',1));
    playerOrder(__unloadArmy(ME,'unloading','militia',1));
    playerOrder(__assaultFleet(ME,'assault'));
    playerOrder(__assaultFleet(ME,'assault2'));
    __transferCenterOn(home.position,2.4);
    return {home:home.id,away:away.id,loading:s.fleets.loading.loading?.length,
      unloading:s.fleets.unloading.unloading?.length,assault:!!s.fleets.assault.assaultLanding};
  },
  advance(ms) { apply(advance(s,s.time+ms)); },
  cancel() {
    const to=s.planets[s.fleets.loading.location].links[0];
    for (const id of ['loading','second','unloading']) playerOrder(__moveFleet(ME,id,to));
  },
  look(id,scale=2.4) { __transferCenterOn(s.planets[id].position,scale); },
  selection() { return selectedFleetIds(); },
  time() { return s.time; },
};
`;

const site = await serve(await instrumentedGame(hooks));
const browser = await launchBrowser();
const out = process.env.TRANSFER_SHOTS;
if (out) mkdirSync(out, { recursive: true });
try {
  for (const width of [1440, 390, 320])
    for (const locale of ['ru', 'en']) {
      const phone = width < 600;
      const device = phone ? `phone-${width}` : 'pc';
      const page = await browser.newPage({
        viewport: { width, height: phone ? 844 : 1000 },
        isMobile: phone,
        hasTouch: phone,
        deviceScaleFactor: 1,
      });
      page.setDefaultTimeout(15000);
      const errors = [];
      page.on('pageerror', (e) => errors.push(e.message));
      page.on('console', (m) => {
        if (m.type() === 'error') errors.push(m.text());
      });
      try {
        await withDiagnostics(page, `troop-timers-${device}-${locale}`, async () => {
          await page.addInitScript((lang) => {
            localStorage.setItem('vd.locale', lang);
            window.__transferPaint = [];
            const draw = CanvasRenderingContext2D.prototype.fillText;
            CanvasRenderingContext2D.prototype.fillText = function (text, x, y, ...rest) {
              if (this.canvas.id === 'map' && /^[▲▼] /.test(String(text))) {
                window.__transferPaint.push({ text, x, y, width: this.measureText(text).width });
                if (window.__transferPaint.length > 100) window.__transferPaint.shift();
              }
              return draw.call(this, text, x, y, ...rest);
            };
          }, locale);
          await page.goto(site.url);
          await page.addStyleTag({ content: '#toasts{visibility:hidden!important}' });
          await enterSkirmish(page, { tap: phone });
          await page.locator('#maploading').waitFor({ state: 'hidden' });
          const staged = await page.evaluate(() => window.__transferTest.stage());
          assert.ok(staged.loading && staged.unloading && staged.assault, JSON.stringify(staged));
          await page.locator('#maploading').waitFor({ state: 'hidden' });
          await page.waitForFunction(() =>
            window.__transferPaint.some((r) => r.text.startsWith('▲ ')),
          );
          const paint = async () =>
            page.evaluate(async () => {
              window.__transferPaint = [];
              for (let i = 0; i < 3; i++) await new Promise(requestAnimationFrame);
              return window.__transferPaint;
            });
          let rows = await paint();
          const load = locale === 'ru' ? 'Погрузка' : 'Loading';
          const unload = locale === 'ru' ? 'Высадка' : 'Unloading';
          assert.ok(
            rows.some(
              (r) =>
                r.text.includes(load) && r.text.includes(locale === 'ru' ? '2 флота' : '2 fleets'),
            ),
            JSON.stringify(rows),
          );
          assert.ok(rows.some((r) => r.text.includes(unload)));
          assert.deepEqual(await page.evaluate(() => window.__transferTest.selection()), []);
          for (const row of rows) {
            assert.ok(
              row.x - row.width / 2 >= 0 && row.x + row.width / 2 <= width,
              JSON.stringify(row),
            );
          }
          if (out) await page.screenshot({ path: `${out}/${device}-${locale}.png` });
          await page.evaluate(() => window.__transferTest.advance(60_000));
          rows = await paint();
          assert.ok(rows.some((r) => r.text.includes(load) && r.text.includes('0:59:00')));
          await page.evaluate(() => window.__transferTest.cancel());
          rows = await paint();
          assert.ok(!rows.some((r) => r.text.includes(load) || r.text.includes(unload)));
          await page.evaluate((id) => window.__transferTest.look(id), staged.away);
          const assault = locale === 'ru' ? 'Штурмовая высадка' : 'Assault landing';
          await page.waitForFunction(
            (text) => window.__transferPaint.some((r) => r.text.includes(text)),
            assault,
          );
          rows = await paint();
          assert.ok(rows.some((r) => r.text.includes(assault)));
          assert.ok(rows.every((r) => r.x - r.width / 2 >= 0 && r.x + r.width / 2 <= width));
          if (out)
            await page.screenshot({
              path: `${out}/${device}-${locale}-assault.png`,
            });
          await page.evaluate(() => window.__transferTest.advance(5_400_000));
          rows = await paint();
          assert.ok(!rows.some((r) => r.text.includes(assault)));
          assert.deepEqual(errors, []);
          console.log(
            `PASS ${phone ? 'phone' : 'PC'} ${locale}: unselected map, actual orders, countdown, cancellation, assault completion`,
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
process.exit(0);
