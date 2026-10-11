#!/usr/bin/env node
/* global window, document -- эти имена живут внутри page.evaluate, то есть в браузере */
/**
 * SHU-6.14 — эскадра В ВОЗДУХЕ в интерфейсе, проверенная настоящим браузером.
 *
 * Заказ владельца 2026-10-11: «их почему-то выделить нельзя, хотя они такие же космические
 * юниты: выделив, их можно разделить и изменить приказ». Правила приказов покрыты в ядре
 * (`shuttleAloft.test.ts`), карточка и выбор — в `decisions/aloftCard.test.ts`,
 * `decisions/tapCycle.test.ts`. Здесь вопрос из приёмки кирпича: тап по значку летящей
 * эскадры выделяет её, карточка делит её по борту, переносит точку патруля, даёт новую цель
 * удара и возвращает домой, а севшая эскадра с выбора снимается.
 *
 * Экраны оба: ПК и телефон. На телефоне под пальцем обычно несколько объектов, и эскадра
 * выбирается из списка «что под пальцем».
 *
 *   node prototype/alofttest.mjs      # или pnpm run smoke:aloft
 *   ALOFT_SHOTS=каталог node prototype/alofttest.mjs   # плюс снимки карточки
 *   ALOFT_LOCALE=ru-RU …                                # язык браузера для снимков
 */
import assert from 'node:assert/strict';
import {
  enterSkirmish,
  instrumentedGame,
  launchBrowser,
  serve,
  withDiagnostics,
} from './harnessKit.mjs';

const hooks = `import { patrolShuttle as __patrolShuttle } from '../../decisions/actions';
window.__aloftTest = {
  prepared: () => inMatch() && mapWasEntered && !mapPreparation.active,
  // Свой мир с целым портом и эскадрой из трёх перехватчиков. Эскадра уходит в патруль к
  // точке восточнее мира и останавливается на полпути: она в воздухе, выбора нет, карта
  // смотрит на её значок.
  prepare: () => {
    speed = 0;
    s = structuredClone(s);
    const home = Object.values(s.planets).find((p) => p.owner === ME);
    home.buildings = home.buildings.filter((b) => b.type !== 'spaceport');
    home.buildings.push({ type: 'spaceport', level: 1, hp: hpOfLevel('spaceport', 1) });
    const sq = 'sq:' + ME + ':aloft';
    home.hangar = [{ id: sq, units: [{ unit: 'interceptor', count: 3 }] }];
    delete home.sortie;
    const ok = playerOrder(
      __patrolShuttle(ME, { planetId: home.id }, sq, { x: home.position.x + 140, y: home.position.y }),
    );
    if (!ok) return null;
    const st = s.strikes.find((x) => x.squadronId === sq);
    apply(advance(s, st.departedAt + (st.arrivesAt - st.departedAt) / 2));
    clearSelection();
    lastPanelHtml = '';
    renderPanel();
    centerOn(strikeWorldPos(st.id), cam.scale);
    return { strikeId: st.id, home: home.id };
  },
  // Где значок вылета на странице.
  at: (id) => {
    const p = strikeWorldPos(id);
    return p ? toScreen(world(p), canvas.getBoundingClientRect(), VW, VH) : null;
  },
  // Точка страницы в (dx, dy) мировых единиц от мира.
  near: (planetId, dx, dy) => {
    const p = s.planets[planetId].position;
    return toScreen(world({ x: p.x + dx, y: p.y + dy }), canvas.getBoundingClientRect(), VW, VH);
  },
  // Ничейный мир в радиусе удара от дома — цель нового удара, и где он на странице.
  target: (planetId) => {
    const home = s.planets[planetId];
    const sq = (s.strikes ?? []).find((x) => x.owner === ME);
    const reach = squadronReach(sq, data);
    const gap = (p) => Math.hypot(p.position.x - home.position.x, p.position.y - home.position.y);
    const p = Object.values(s.planets)
      .filter((x) => x.owner === null && gap(x) <= reach * 0.9)
      .sort((a, b) => gap(a) - gap(b) || (a.id < b.id ? -1 : 1))[0];
    if (!p) return null;
    centerOn(p.position, cam.scale);
    return { id: p.id, at: toScreen(world(p.position), canvas.getBoundingClientRect(), VW, VH) };
  },
  picked: () => selStrike,
  armed: () => strikeAim,
  flights: () =>
    (s.strikes ?? [])
      .filter((x) => x.owner === ME)
      .map((x) => ({
        id: x.id,
        leg: x.leg,
        target: x.target,
        to: x.to,
        machines: x.units.reduce((n, u) => n + u.count, 0),
      })),
  // Мир в мировых координатах под точкой страницы — куда ляжет патруль.
  worldAt: (p) => {
    const r = canvas.getBoundingClientRect();
    return unworld({ x: ((p.x - r.left) * VW) / r.width, y: ((p.y - r.top) * VH) / r.height });
  },
  // Мир доходит до посадки этого вылета.
  land: (id) => {
    const st = s.strikes.find((x) => x.id === id);
    apply(advance(s, st.arrivesAt));
    lastPanelHtml = '';
    renderPanel();
  },
  focus: (id) => centerOn(strikeWorldPos(id), cam.scale),
};`;

const site = await serve(await instrumentedGame(hooks));
const browser = await launchBrowser();
const shots = process.env.ALOFT_SHOTS;
try {
  for (const viewport of [
    { width: 1280, height: 800 },
    { width: 390, height: 844 },
  ]) {
    const phone = viewport.width < 600;
    const context = await browser.newContext({
      viewport,
      isMobile: phone,
      hasTouch: phone,
      ...(process.env.ALOFT_LOCALE ? { locale: process.env.ALOFT_LOCALE } : {}),
    });
    const page = await context.newPage();
    page.setDefaultTimeout(15000);
    const press = (locator) => (phone ? locator.tap() : locator.click());
    const tapAt = (p) => (phone ? page.touchscreen.tap(p.x, p.y) : page.mouse.click(p.x, p.y));
    // Ввод меняет состояние сразу, а раскладку игра применяет в своём кадре (PT-03).
    const frame = () =>
      page.evaluate(
        () =>
          new Promise((resolve) =>
            window.requestAnimationFrame(() => window.requestAnimationFrame(resolve)),
          ),
      );
    const onCanvas = async (p, what) =>
      assert.equal(
        await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.tagName, p),
        'CANVAS',
        `${what} не под панелью`,
      );
    const flights = () => page.evaluate(() => window.__aloftTest.flights());
    const shot = async (name) => {
      if (shots) await page.screenshot({ path: `${shots}/aloft-${name}-${viewport.width}.png` });
    };
    await withDiagnostics(page, `aloft-${viewport.width}`, async () => {
      await page.goto(site.url + '/');
      await enterSkirmish(page, { tap: phone });
      await page.waitForFunction(() => window.__aloftTest.prepared());
      const prep = await page.evaluate(() => window.__aloftTest.prepare());
      assert.ok(prep, 'патруль поднят');
      const { strikeId, home } = prep;
      const button = (act) => page.locator(`[data-act="${act}"][data-arg="${strikeId}"]`);
      // Кнопки карточки: на телефоне лист раскрывается по состоянию, а не по видимости.
      const act = async (name) => {
        await frame();
        if (phone && !(await page.locator('#mobile-sheet.expanded').count())) {
          await page.locator('.mobile-quick [data-mobile="details"]').tap();
          await frame();
        }
        await press(button(name));
        await frame();
      };

      // 1. Тап по значку выделяет эскадру. На телефоне под пальцем и мир — эскадра первая в
      //    списке «что под пальцем».
      const icon = await page.evaluate((id) => window.__aloftTest.at(id), strikeId);
      assert.ok(icon, 'значок эскадры на экране');
      await onCanvas(icon, 'значок эскадры');
      await tapAt(icon);
      await frame();
      if (phone && (await page.locator('[data-mobile="choose"]').count())) {
        await page.locator('[data-mobile="choose"][data-index="0"]').tap();
        await frame();
      }
      assert.equal(await page.evaluate(() => window.__aloftTest.picked()), strikeId, 'эскадра выделена');
      for (const name of ['aloftstrike', 'aloftpatrol', 'aloftsplit', 'wingkeep', 'wingrecall']) {
        assert.equal(await button(name).count(), 1, `кнопка ${name} на карточке`);
      }
      await shot('card');

      // 2. «Отделить борт»: отделённая машина летит своим вылетом с тем же приказом, выбор
      //    остаётся на этой эскадре.
      await act('aloftsplit');
      const split = await flights();
      assert.equal(split.length, 2, 'вылетов два');
      const self = split.find((f) => f.id === strikeId);
      const other = split.find((f) => f.id !== strikeId);
      assert.equal(self.machines, 2);
      assert.equal(other.machines, 1);
      assert.deepEqual(other.to, self.to, 'отделённый борт летит к той же точке');
      assert.equal(await page.evaluate(() => window.__aloftTest.picked()), strikeId);
      await shot('split');

      // 3. «Патруль»: прицел эскадры в воздухе, тап — новая точка.
      await act('aloftpatrol');
      const armed = await page.evaluate(() => window.__aloftTest.armed());
      assert.equal(armed?.strikeId, strikeId, 'прицел взведён на вылет');
      assert.equal(armed?.patrol, true);
      const spot = await page.evaluate((h) => window.__aloftTest.near(h, 60, -70), home);
      await onCanvas(spot, 'новая точка патруля');
      const want = await page.evaluate((p) => window.__aloftTest.worldAt(p), spot);
      await tapAt(spot);
      await frame();
      const moved = (await flights()).find((f) => f.id === strikeId);
      assert.equal(moved.target.kind, 'point');
      assert.equal(moved.leg, 'out');
      assert.ok(Math.hypot(moved.to.x - want.x, moved.to.y - want.y) < 3, 'точка патруля перенесена');
      assert.equal(await page.evaluate(() => window.__aloftTest.armed()), null, 'прицел погас');

      // 4. «Удар»: тап по ничейному миру в радиусе — новая цель.
      await act('aloftstrike');
      const target = await page.evaluate((h) => window.__aloftTest.target(h), home);
      assert.ok(target, 'ничейный мир в радиусе удара');
      await frame();
      const aim = await page.evaluate((h) => window.__aloftTest.target(h), home);
      await onCanvas(aim.at, 'мир-цель');
      await tapAt(aim.at);
      await frame();
      const struck = (await flights()).find((f) => f.id === strikeId);
      assert.deepEqual(struck.target, { kind: 'planet', id: aim.id }, 'новая цель — мир');

      // 5. «Вернуть»: эскадра поворачивает домой, бить снова нечем — «Удара» нет.
      await page.evaluate((id) => window.__aloftTest.focus(id), strikeId);
      await act('wingrecall');
      const back = (await flights()).find((f) => f.id === strikeId);
      assert.equal(back.leg, 'back');
      assert.equal(await button('aloftstrike').count(), 0, 'у возвращающейся удара нет');
      assert.equal(await button('wingrecall').count(), 0);
      await shot('returning');

      // 6. Села — выбор снят, карточки нет.
      await page.evaluate((id) => window.__aloftTest.land(id), strikeId);
      await frame();
      assert.equal(await page.evaluate(() => window.__aloftTest.picked()), null, 'севшая снята с выбора');
      assert.equal(await button('aloftsplit').isVisible(), false, 'карточки эскадры нет');
    });
    console.log(`Aloft UI ${viewport.width}px passed.`);
    await context.close();
  }
  console.log(
    'Aloft UI smoke passed: tap selects an airborne squadron, split, new patrol point, new strike target, recall, landing clears the pick — desktop and phone.',
  );
} finally {
  await browser.close();
  await site.close();
}
