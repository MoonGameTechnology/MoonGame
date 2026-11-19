#!/usr/bin/env node
/* global window, document -- имена живут внутри page.evaluate, то есть в браузере */
/**
 * Кнопка «Закончить» у идущей стройки (TEC-3.2), проверенная настоящим браузером на ПК и
 * телефоне, в схватке без сервера.
 *
 * Правила ядра (бесплатны последние 5 игровых минут) — `modules/speedup.test.ts`, предложение —
 * `decisions/speedupOffer.test.ts`, запрос за ◆ — `speedupClient.test.ts`. Здесь вопрос «игрок
 * видит и жмёт»: пока до конца стройки больше 5 минут, у строки нет ни «Закончить», ни
 * платной кнопки (в схватке нет кошелька); в последние минуты появляется «Закончить», нажатие
 * достраивает здание сразу.
 *
 *   node prototype/speedupfinishtest.mjs
 */
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { enterSkirmish, instrumentedGame, launchBrowser, serve, withDiagnostics } from './harnessKit.mjs';

const hooks = `import { mapWasEntered as __mapWasEntered } from './mapLoading';
import { canOrder as __canOrder, kernel as __kernel } from './protoKernel';
import { pickWorld as __pickWorld } from './interaction';
import { buildBuilding as __build } from '../../decisions/actions';
window.__speedTest = {
  prepared: () => inMatch() && __mapWasEntered && !mapPreparation.active,
  order: () => {
    const home = Object.values(s.planets).find((p) => p.owner === ME && p.buildings.some((b) => b.type === 'shipyard'));
    s.players[ME].resources = { ...s.players[ME].resources, metal: 5000, credits: 5000 };
    const why = {};
    let order = null;
    for (const b of ['fabricator', 'fort', 'power_plant', 'tax_office', 'radar', 'farm']) {
      const a = __build(ME, home.id, b);
      why[b] = __canOrder(s, a);
      if (why[b] === null || why[b] === undefined || why[b] === true) { order = a; window.__speedBuilt = b; break; }
    }
    if (order) playerOrder(order);
    __pickWorld(home.id);
    invalidatePanel();
    renderPanel();
    const e = s.scheduled.find((x) => x.type === 'construction.complete' && x.payload.playerId === ME);
    return { home: home.id, why: JSON.stringify(why), buildings: home.buildings.map((b) => b.type), left: e ? (e.at - s.time) / 3600000 : null };
  },
  runTo: (minutesLeft) => {
    const e = s.scheduled.find((x) => x.type === 'construction.complete' && x.payload.playerId === ME);
    const r = __kernel.advanceTo(s, { now: e.at - minutesLeft * 60000, data });
    if (r.ok) s = r.state;
    invalidatePanel();
    renderPanel();
    return r.ok;
  },
  built: (id) => s.planets[id].buildings.some((b) => b.type === window.__speedBuilt),
};`;

mkdirSync('.playwright-mcp', { recursive: true });
const site = await serve(await instrumentedGame(hooks));
const browser = await launchBrowser();
try {
  for (const viewport of [
    { width: 1280, height: 800 },
    { width: 390, height: 844 },
  ]) {
    const phone = viewport.width < 600;
    const tag = phone ? 'phone' : 'pc';
    const context = await browser.newContext({ viewport, isMobile: phone, hasTouch: phone });
    const page = await context.newPage();
    page.setDefaultTimeout(15000);
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const t = (fn, arg) => page.evaluate(([f, a]) => window.__speedTest[f](a), [fn, arg]);
    await withDiagnostics(page, `speedup-${tag}`, async () => {
      await page.goto(site.url + '/');
      await enterSkirmish(page, { tap: phone });
      await page.waitForFunction(() => window.__speedTest.prepared());
      const { home, left, why, buildings } = await t('order');
      assert.ok(left > 1, `стройка идёт дольше часа: ${left} ${why} ${buildings}`);
      // Стройкой управляют в окне «Производство»: линия зданий, строка идущего заказа.
      await page.evaluate(() => document.getElementById('spd-pause').click());
      await page.evaluate(() => document.getElementById('rail-constructor').click());
      await page.locator('#constructor.show').waitFor();
      const back = page.locator('#constructor .pw-lane-back');
      if ((await back.count()) && (await back.isVisible())) await back.click();
      await page.locator('#constructor [data-pw-lane="buildings"]').click();
      await page.locator('#constructor .pw-job.run').first().waitFor();
      assert.equal(await page.locator('#constructor .pw-speed').count(), 0, 'в схватке без кошелька и до последних минут кнопки нет');
      await t('runTo', 4);
      const finish = page.locator('#constructor .pw-speed[data-pw-speed="finishbuild"]').first();
      await finish.waitFor();
      assert.equal(await page.locator('#constructor .pw-speed[data-pw-speed="speedbuild"]').count(), 0, 'платной кнопки в схватке нет');
      await page.screenshot({ path: `.playwright-mcp/speedup-finish-${tag}.png` });
      await (phone ? finish.tap() : finish.click());
      // Срок заказа сдвинут на «сейчас»; здание встаёт с ходом мира — снимаем паузу.
      await page.evaluate(() => document.getElementById('spd-play').click());
      await page.waitForFunction((id) => window.__speedTest.built(id), home);
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1),
        false,
        'нет горизонтальной прокрутки',
      );
      assert.deepEqual(errors, []);
      console.log(`PASS speedup ${tag}: no button before the last minutes → «Закончить» → built at once`);
    });
    await context.close();
  }
} finally {
  await browser.close();
  await site.close();
}
