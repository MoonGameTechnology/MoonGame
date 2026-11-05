/* global window, localStorage, CanvasRenderingContext2D, requestAnimationFrame */
/** Map-view troop transfer regression: real orders, real canvas, RU/EN, PC/phone.
 *  A plate row paints its title, then its time, then (two fleets or more) the fleet count —
 *  in that order and nothing in between, so the run of left-aligned texts is parsed back
 *  into rows. */
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
import { noticeFlashes as __transferFlashes } from './mapEffects';
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
  advance(ms) { apply(advance(s,s.time+ms)); return __transferFlashes.filter(f => f.landing).length; },
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
              if (this.canvas.id === 'map' && this.textAlign === 'left') {
                const line = String(text);
                window.__transferPaint.push({ text: line, x, y, width: this.measureText(line).width });
                if (window.__transferPaint.length > 2000) window.__transferPaint.shift();
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
          const title = (ru, en) => (locale === 'ru' ? ru : en).toUpperCase();
          const load = title('Погрузка', 'Loading');
          const unload = title('Высадка', 'Unloading');
          const assault = title('Штурмовая высадка', 'Assault landing');
          await page.waitForFunction(
            (text) => window.__transferPaint.some((r) => r.text === text),
            load,
          );
          const paint = async () =>
            page.evaluate(async () => {
              window.__transferPaint = [];
              for (let i = 0; i < 3; i++) await new Promise(requestAnimationFrame);
              return window.__transferPaint;
            });
          // Title, time and the optional fleet count of one plate row, painted back to back.
          const rowsOf = (paint) =>
            paint.flatMap((r, i) => {
              if (![load, unload, assault].includes(r.text)) return [];
              const time = /^\d+:\d\d:\d\d$/.test(paint[i + 1]?.text) ? paint[i + 1] : null;
              const next = paint[i + 2];
              const count = time && /^\d+$/.test(next?.text) && next.y === time.y ? next : null;
              const parts = [r, time, count].filter(Boolean);
              return [{ title: r.text, time: time?.text, fleets: Number(count?.text ?? 1), parts }];
            });
          const onScreen = (rows) =>
            rows.every((row) => row.parts.every((r) => r.x >= 0 && r.x + r.width <= width));
          let rows = rowsOf(await paint());
          assert.ok(
            rows.some((r) => r.title === load && r.fleets === 2 && r.time),
            JSON.stringify(rows),
          );
          assert.ok(rows.some((r) => r.title === unload && r.time), JSON.stringify(rows));
          assert.deepEqual(await page.evaluate(() => window.__transferTest.selection()), []);
          assert.ok(onScreen(rows), JSON.stringify(rows));
          if (out) await page.screenshot({ path: `${out}/${device}-${locale}.png` });
          await page.evaluate(() => window.__transferTest.advance(60_000));
          rows = rowsOf(await paint());
          assert.ok(rows.some((r) => r.title === load && r.time === '0:59:00'), JSON.stringify(rows));
          await page.evaluate(() => window.__transferTest.cancel());
          rows = rowsOf(await paint());
          assert.ok(!rows.some((r) => r.title === load || r.title === unload));
          await page.evaluate((id) => window.__transferTest.look(id), staged.away);
          await page.waitForFunction(
            (text) => window.__transferPaint.some((r) => r.text === text),
            assault,
          );
          rows = rowsOf(await paint());
          assert.ok(
            rows.some((r) => r.title === assault && r.fleets === 2 && r.time),
            JSON.stringify(rows),
          );
          assert.ok(onScreen(rows), JSON.stringify(rows));
          if (out)
            await page.screenshot({
              path: `${out}/${device}-${locale}-assault.png`,
            });
          // Both assault fleets step ashore: a landing flash each, and the plate is gone.
          const landed = await page.evaluate(() => window.__transferTest.advance(5_400_000));
          assert.equal(landed, 2);
          rows = rowsOf(await paint());
          assert.ok(!rows.some((r) => r.title === assault));
          assert.deepEqual(errors, []);
          console.log(
            `PASS ${phone ? 'phone' : 'PC'} ${locale}: unselected map, actual orders, countdown, cancellation, assault completion and landing flash`,
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
