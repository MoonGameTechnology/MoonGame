/* global window, localStorage, requestAnimationFrame */
/** Настройки FPS и перевозки на настоящей карте, ПК/телефон, RU/EN/reduced motion. */
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import {
  enterSkirmish,
  instrumentedGame,
  launchBrowser,
  serve,
  withDiagnostics,
} from './harnessKit.mjs';

const hooks = `
import { centerOn as __fxCenter } from './mapCamera';
import { drawTroopTransferEffects as __drawTransfers } from './mapTransfers';
import { openSettings as __openSettings } from './settingsView';
import { frameRateMode as __frameRateMode, motionOn as __motionOn } from './graphicsPrefs';
import { loadArmy as __fxLoad, unloadArmy as __fxUnload, assaultFleet as __fxAssault, moveFleet as __fxMove } from './game';
window.__transferFxTest = {
  settings: __openSettings,
  mode: __frameRateMode,
  motion: __motionOn,
  renderedAt: () => lastReal,
  stage() {
    const staged = structuredClone(s);
    const home = Object.values(staged.planets).find(p => p.owner === ME && p.kind === 'planet');
    const away = Object.values(staged.planets).find(p => p.id !== home.id && p.kind === 'planet');
    const ship = Object.entries(data.units).find(([,d]) => d.domain === 'space' && d.stats.cargoCapacity >= 6)[0];
    home.garrison = [{unit:'militia',count:10}];
    away.owner = 'p2'; away.buildings = []; away.garrison = [{unit:'militia',count:2}];
    const make = (id, at, troops=0) => ({ id,owner:ME,location:at,movement:null,orbit:'near',
      units:[{unit:ship,count:1}],traits:[],landing:troops?[{unit:'militia',count:troops}]:[] });
    staged.fleets = { loading:make('loading',home.id), unloading:make('unloading',home.id,2), assault:make('assault',away.id,2) };
    staged.battles = {};
    staged.diplomacy = {...(staged.diplomacy??{}), [[ME,'p2'].sort().join('|')]:'war'};
    installMatch(staged,new Map()); speed=0;
    playerOrder(__fxLoad(ME,'loading','militia',2));
    playerOrder(__fxUnload(ME,'unloading','militia',1));
    playerOrder(__fxAssault(ME,'assault'));
    __fxCenter(home.position,2.4);
    return {home:home.id,away:away.id,loading:!!s.fleets.loading.loading?.length,
      unloading:!!s.fleets.unloading.unloading?.length,assault:!!s.fleets.assault.assaultLanding};
  },
  sample(now) {
    const paths = [], points = [];
    const proxy = new Proxy(cx, {get(target,key) {
      const value=Reflect.get(target,key,target);
      if(typeof value!=='function')return value;
      return (...args) => {
        if(key==='quadraticCurveTo')paths.push(args);
        if(key==='lineTo')points.push(args);
        return value.apply(target,args);
      };
    },set(target,key,value){Reflect.set(target,key,value,target);return true;}});
    __drawTransfers(s,ME,proxy,now);
    return {paths,points};
  },
  visualTime(now) { hologramTime=now; },
  look(id) { __fxCenter(s.planets[id].position,2.4); },
  cancel() {
    const to=s.planets[s.fleets.loading.location].links[0];
    for(const id of ['loading','unloading'])playerOrder(__fxMove(ME,id,to));
  },
  finish() { apply(advance(s,s.time+5_400_000)); },
};
`;

const site = await serve(await instrumentedGame(hooks));
const browser = await launchBrowser();
const out = process.env.TRANSFER_FX_SHOTS;
if (out) mkdirSync(out, { recursive: true });
const reports = [];
try {
  for (const { width, locale, reduced } of [
    { width: 1440, locale: 'en', reduced: false },
    { width: 390, locale: 'ru', reduced: false },
    { width: 320, locale: 'en', reduced: false },
    { width: 390, locale: 'ru', reduced: true },
  ]) {
    const name = `${width}-${locale}${reduced ? '-reduced' : ''}`;
    const page = await browser.newPage({
      viewport: { width, height: width < 600 ? 844 : 1000 },
      isMobile: width < 600,
      hasTouch: width < 600,
      deviceScaleFactor: 1,
    });
    page.setDefaultTimeout(15000);
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });
    try {
      await withDiagnostics(page, `transfer-fps-${name}`, async () => {
        await page.emulateMedia({ reducedMotion: reduced ? 'reduce' : 'no-preference' });
        await page.addInitScript((lang) => localStorage.setItem('vd.locale', lang), locale);
        await page.goto(site.url);
        await enterSkirmish(page, { tap: width < 600 });
        await page.locator('#maploading').waitFor({ state: 'hidden' });
        const staged = await page.evaluate(() => window.__transferFxTest.stage());
        assert.ok(staged.loading && staged.unloading && staged.assault, JSON.stringify(staged));
        await page.locator('#maploading').waitFor({ state: 'hidden' });
        await page.waitForFunction(() => window.__transferFxTest.sample(1000).paths.length === 2);
        const first = await page.evaluate(() => window.__transferFxTest.sample(1000));
        const next = await page.evaluate(() => window.__transferFxTest.sample(1300));
        if (reduced) {
          assert.equal(await page.evaluate(() => window.__transferFxTest.motion()), false);
          assert.deepEqual(first, next, 'reduced motion сохраняет неподвижное направление');
        } else
          assert.notDeepEqual(first.points, next.points, 'капсулы двигаются по реальным дугам');
        await page.evaluate(() => window.__transferFxTest.visualTime(1200));
        if (out) await page.screenshot({ path: `${out}/${name}-map.png` });

        await page.evaluate(() => window.__transferFxTest.settings());
        await page.locator('[data-settab="graphics"]').click();
        const select = page.locator('#set-frame-rate');
        assert.equal(await select.inputValue(), '60');
        assert.equal(await select.locator('option').count(), 5);
        for (const mode of ['30', '90', '120', 'auto', '60']) {
          await select.selectOption(mode);
          assert.equal(await page.evaluate(() => window.__transferFxTest.mode()), mode);
          assert.equal(await page.evaluate(() => localStorage.getItem('void.frameRate')), mode);
        }
        const bounds = await select.boundingBox();
        assert.ok(
          bounds && bounds.x >= 0 && bounds.x + bounds.width <= width,
          JSON.stringify(bounds),
        );
        if (out) await page.screenshot({ path: `${out}/${name}-settings.png` });
        await page.locator('#set-close').click();

        // Считаем именно выполненные кадры игры, независимо от частоты headless-экрана.
        const rates = {};
        for (const mode of ['30', 'auto']) {
          await page.evaluate(() => window.__transferFxTest.settings());
          await page.locator('[data-settab="graphics"]').click();
          await page.locator('#set-frame-rate').selectOption(mode);
          await page.locator('#set-close').click();
          rates[mode] = await page.evaluate(async () => {
            await new Promise(requestAnimationFrame);
            const stamps = new Set(),
              started = performance.now();
            let native = 0;
            while (performance.now() - started < 1400) {
              await new Promise(requestAnimationFrame);
              stamps.add(window.__transferFxTest.renderedAt());
              native++;
            }
            return { rendered: stamps.size, native, elapsed: performance.now() - started };
          });
          if (mode === '30')
            assert.ok(
              rates[mode].rendered <= (rates[mode].elapsed * 30) / 1000 + 3,
              JSON.stringify(rates),
            );
          else assert.ok(rates[mode].rendered >= rates[mode].native - 2, JSON.stringify(rates));
        }
        await page.evaluate(() => window.__transferFxTest.cancel());
        assert.equal(
          (await page.evaluate(() => window.__transferFxTest.sample(1400))).paths.length,
          0,
        );
        await page.evaluate((id) => window.__transferFxTest.look(id), staged.away);
        await page.waitForFunction(() => window.__transferFxTest.sample(1400).paths.length === 1);
        if (out) await page.screenshot({ path: `${out}/${name}-assault.png` });
        await page.evaluate(() => window.__transferFxTest.finish());
        assert.equal(
          (await page.evaluate(() => window.__transferFxTest.sample(1400))).paths.length,
          0,
        );

        await page.reload();
        await page.waitForFunction(() => !!window.__transferFxTest);
        assert.equal(await page.evaluate(() => window.__transferFxTest.mode()), 'auto');
        assert.deepEqual(errors, []);
        reports.push({ name, rates, persistence: true, cancelled: true, completed: true });
        console.log(`transfer effects + FPS: ${name} OK`);
      });
    } finally {
      await page.close();
    }
  }
  if (out) writeFileSync(`${out}/browser-results.json`, JSON.stringify(reports, null, 2));
} finally {
  await browser.close();
  await site.close();
}
