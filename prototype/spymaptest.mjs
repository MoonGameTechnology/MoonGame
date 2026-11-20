#!/usr/bin/env node
/* global window -- имя живёт внутри page.evaluate, то есть в браузере */
/**
 * Шпионы на карте (SPM-1, заказ владельца 2026-11-20), проверенные настоящим браузером на ПК и
 * телефоне: свой шпион в пути — корабль на лейне с пунктиром до цели, стоящие в мире — значок
 * «🕵 N» у его имени, тап по кораблю или значку открывает окно шпионажа.
 *
 * Кого и где рисовать, покрыто в `decisions/spyMarks.test.ts`, путь шпиона — в
 * `espionageWay.test.ts`. Здесь вопрос «игрок видит шпиона на карте и берёт его тапом».
 *
 *   node prototype/spymaptest.mjs                     # или pnpm run smoke:spy-map
 *   SPY_SHOTS=каталог node prototype/spymaptest.mjs    # плюс снимки
 */
import assert from 'node:assert/strict';
import {
  enterSkirmish,
  instrumentedGame,
  launchBrowser,
  serve,
  withDiagnostics,
} from './harnessKit.mjs';

const hooks = `import { mapWasEntered as __mapWasEntered } from './mapLoading';
import { spyOn as __spyOn } from '../../decisions/actions';
import { spyPath as __spyPath } from '../../packages/shared-core/src/index';
window.__spyMapTest = {
  prepared: () => inMatch() && __mapWasEntered && !mapPreparation.active,
  // Шпион 1 летит к миру за три перехода, шпион 2 ждёт приказа у соседа, шпион 3 дома.
  // Часы стоят на 40% пути шпиона 1, камера между ним и целью.
  prepare: () => {
    speed = 0;
    const home = s.capital?.[ME] ?? Object.values(s.planets).find((p) => p.owner === ME).id;
    const far = Object.keys(s.planets)
      .sort()
      .find((id) => (__spyPath(s, ME, home, id)?.route.length ?? 0) === 3);
    const near = s.planets[home].links[0];
    playerOrder(__spyOn(ME, far, 'relocate', 1));
    s = structuredClone(s);
    const spy1 = s.spies[ME].find((x) => x.id === 1);
    s.time = spy1.departedAt + 0.4 * (spy1.arrivesAt - spy1.departedAt);
    const spy2 = s.spies[ME].find((x) => x.id === 2);
    Object.assign(spy2, { state: 'wait', location: near });
    clearSelection();
    invalidatePanel();
    renderPanel();
    const a = s.planets[home].position;
    const b = s.planets[far].position;
    centerOn({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, Math.max(cam.scale, 1.6));
    return { home, far, near, hits: __spyMarkHits().length };
  },
  hits: () => {
    const r = canvas.getBoundingClientRect();
    return __spyMarkHits().map((h) => ({ x: r.left + h.x, y: r.top + h.y, ids: [...h.spyIds] }));
  },
};
import { spyHits as __spyMarkHits } from './mapSpies';`;

const shots = process.env.SPY_SHOTS;
const site = await serve(await instrumentedGame(hooks));
const browser = await launchBrowser();
try {
  for (const viewport of [
    { width: 1280, height: 800 },
    { width: 390, height: 844 },
  ]) {
    const phone = viewport.width < 600;
    const tag = phone ? 'phone' : 'pc';
    const context = await browser.newContext({
      viewport,
      isMobile: phone,
      hasTouch: phone,
      deviceScaleFactor: shots ? 2 : 1,
      locale: 'ru-RU',
    });
    const page = await context.newPage();
    page.setDefaultTimeout(15000);
    const tapAt = (p) => (phone ? page.touchscreen.tap(p.x, p.y) : page.mouse.click(p.x, p.y));
    const frame = () =>
      page.evaluate(
        () =>
          new Promise((resolve) =>
            window.requestAnimationFrame(() => window.requestAnimationFrame(resolve)),
          ),
      );
    const shot = async (name) => {
      if (!shots) return;
      await frame();
      await page.waitForTimeout(250);
      await page.screenshot({ path: `${shots}/${tag}-${name}.png` });
    };
    await withDiagnostics(page, `spy-map-${tag}`, async () => {
      await page.goto(site.url + '/');
      await enterSkirmish(page, { tap: phone });
      await page.waitForFunction(() => window.__spyMapTest.prepared());
      await page.evaluate(() => window.__spyMapTest.prepare());
      await page.waitForFunction(() => window.__spyMapTest.hits().length > 0);
      await frame();
      const hits = await page.evaluate(() => window.__spyMapTest.hits());
      const flight = hits.find((h) => h.ids.length === 1 && h.ids[0] === 1);
      assert.ok(flight, 'шпион 1 в пути — корабль на карте');
      await shot('1-v-puti');
      await tapAt(flight);
      await frame();
      assert.ok(
        await page.locator('#spywin').isVisible(),
        'тап по кораблю открывает окно шпионажа',
      );
      await shot('2-okno');
    });
    await context.close();
  }
  console.log('spy map OK');
} finally {
  await browser.close();
  await site.close();
}
