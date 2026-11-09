#!/usr/bin/env node
/* global window, document -- эти имена живут внутри page.evaluate, то есть в браузере */
/**
 * Список «◇ Авиация» (UIX-10.15, концепт «Управление эскадрой», заказ владельца 2026-11-08),
 * проверенный настоящим браузером на ПК и телефоне.
 *
 * Группы и порядок покрыты в `decisions/aviationList.test.ts`. Здесь вопрос другой — «игрок
 * находит все свои эскадры одним списком»: на ПК чип «◇ Авиация N» в строке статуса
 * открывает панель справа, тап по строке выделяет эскадру, а панель остаётся рядом с её
 * карточкой; взлетевшая эскадра переезжает в группу «В полёте» и выделяется оттуда своим
 * вылетом. На телефоне — плавающая кнопка, пока ничего не выделено, лист на 56% экрана, и
 * тап по строке закрывает лист и открывает карточку, а её приказы стоят плитками, как у флота:
 * две первые и «Ещё».
 *
 *   node prototype/aviationtest.mjs                    # или pnpm run smoke:aviation
 *   AVIA_SHOTS=каталог node prototype/aviationtest.mjs   # плюс снимки
 *   AVIA_LOCALE=ru-RU …                                  # язык браузера для снимков
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
import { hpOfLevel as __hpOfLevel } from './game';
window.__aviaTest = {
  prepared: () => inMatch() && __mapWasEntered && !mapPreparation.active,
  // Свой мир с портом и двумя эскадрами, у причала свой носитель с третьей в трюме.
  prepare: () => {
    speed = 0;
    s = structuredClone(s);
    const home = Object.values(s.planets).find((p) => p.owner === ME);
    home.buildings = home.buildings.filter((b) => b.type !== 'spaceport');
    home.buildings.push({ type: 'spaceport', level: 1, hp: __hpOfLevel('spaceport', 1) });
    home.hangar = [
      { id: 'sq:' + ME + ':a', units: [{ unit: 'interceptor', count: 2 }] },
      { id: 'sq:' + ME + ':b', units: [{ unit: 'interceptor', count: 1 }] },
    ];
    delete home.sortie;
    const f = Object.values(s.fleets).find((x) => x.owner === ME && x.location);
    f.units = [{ unit: 'shuttle_carrier', count: 1 }];
    f.hangar = [{ id: 'sq:' + ME + ':c', units: [{ unit: 'interceptor', count: 3 }] }];
    delete f.sortie;
    f.location = home.id;
    f.movement = null;
    f.battleId = null;
    clearSelection();
    invalidatePanel();
    renderPanel();
    centerOn(home.position, Math.max(cam.scale, 2.2));
    return { home: home.id, a: 'sq:' + ME + ':a', b: 'sq:' + ME + ':b', c: 'sq:' + ME + ':c' };
  },
  clear: () => {
    clearSelection();
    invalidatePanel();
    renderPanel();
  },
  sel: () => ({ squadron: selSquadron, strike: selStrike }),
  strikeOf: (sq) => (s.strikes ?? []).find((st) => st.squadronId === sq)?.id ?? null,
  near: (id, dx) => {
    const p = s.planets[id].position;
    return toScreen(world({ x: p.x + dx, y: p.y }), canvas.getBoundingClientRect(), VW, VH);
  },
  // Группы открытого списка: заголовок и адреса строк.
  groups: () =>
    [...document.querySelectorAll('#aviapanel .av-group')].map((g) => ({
      title: g.querySelector('.av-gh').textContent,
      rows: [...g.querySelectorAll('[data-avia]')].map((r) => r.dataset.avia),
    })),
};`;

const shots = process.env.AVIA_SHOTS;
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
      ...(process.env.AVIA_LOCALE ? { locale: process.env.AVIA_LOCALE } : {}),
    });
    const page = await context.newPage();
    page.setDefaultTimeout(15000);
    const press = (locator) => (phone ? locator.tap() : locator.click());
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
    const sel = () => page.evaluate(() => window.__aviaTest.sel());
    const groups = () => page.evaluate(() => window.__aviaTest.groups());
    const panel = page.locator('#aviapanel');
    await withDiagnostics(page, `avia-${tag}`, async () => {
      await page.goto(site.url + '/');
      await enterSkirmish(page, { tap: phone });
      await page.waitForFunction(() => window.__aviaTest.prepared());
      const ids = await page.evaluate(() => window.__aviaTest.prepare());
      await frame();

      // Вход: на ПК чип строки статуса, на телефоне плавающая кнопка, пока ничего не выделено.
      const entry = phone ? page.locator('#avia-fab') : page.locator('#devline [data-avia-open]');
      await entry.waitFor({ state: 'visible' });
      assert.match(await entry.innerText(), /3/, 'на входе число эскадр');
      if (phone)
        assert.equal(await page.locator('[data-avia-open]').count(), 0, 'чипа на телефоне нет');
      await shot('1-vhod');
      await press(entry);
      await panel.waitFor({ state: 'visible' });
      assert.deepEqual(await groups(), [
        { title: (await groups())[0].title, rows: [`sq:${ids.a}`, `sq:${ids.b}`, `sq:${ids.c}`] },
      ]);
      if (phone) {
        const box = await panel.boundingBox();
        assert.ok(
          Math.abs(box.height - viewport.height * 0.56) < 4,
          `лист на 56% экрана (${box.height})`,
        );
      }
      await shot('2-spisok');

      // Тап по строке — эскадра выделена. ПК держит список рядом с карточкой, телефон закрывает.
      await press(page.locator(`#aviapanel [data-avia="sq:${ids.c}"]`));
      await frame();
      assert.equal((await sel()).squadron, ids.c, 'строка выделила эскадру в трюме');
      if (phone) {
        assert.equal(await panel.isVisible(), false, 'лист закрылся');
        assert.equal(await page.locator('#avia-fab').isVisible(), false, 'кнопка уступила листу');
      } else {
        assert.equal(await panel.isVisible(), true, 'панель осталась рядом с карточкой');
      }
      await shot('3-vybrana');
      if (phone) {
        // Приказы плитками, как у флота: на свёрнутом листе две первые и «Ещё», остальные —
        // по «Ещё» на том же месте.
        const extra = page.locator('#mobile-sheet .wing-orders > .extra').first();
        assert.equal(await extra.isVisible(), false, 'лишние плитки под «Ещё»');
        await press(page.locator('#mobile-sheet [data-act="wingmore"]'));
        await extra.waitFor({ state: 'visible' });
        await shot('3b-eshche');
      }

      // Взлёт: эскадра «a» уходит в патруль и переезжает в группу «В полёте».
      if (!phone) await press(page.locator(`#aviapanel [data-avia="sq:${ids.a}"]`));
      else {
        await page.evaluate(() => window.__aviaTest.prepare());
        await frame();
        await press(page.locator('#avia-fab'));
        await press(page.locator(`#aviapanel [data-avia="sq:${ids.a}"]`));
        await frame();
        if (!(await page.locator('#side [data-act="wingpatrol"]').isVisible()))
          await page.locator('#mobile-sheet .mobile-info').tap();
      }
      await frame();
      await press(page.locator(`#side [data-act="wingpatrol"][data-arg="${ids.a}"]`));
      await frame();
      const point = await page.evaluate((h) => window.__aviaTest.near(h, 20), ids.home);
      if (phone) await page.touchscreen.tap(point.x, point.y);
      else await page.mouse.click(point.x, point.y);
      await frame();
      const flight = await page.evaluate((q) => window.__aviaTest.strikeOf(q), ids.a);
      assert.ok(flight, 'эскадра взлетела');
      if (phone) {
        await page.evaluate(() => window.__aviaTest.clear());
        await frame();
        await press(page.locator('#avia-fab'));
      }
      await panel.waitFor({ state: 'visible' });
      await page.waitForFunction(
        (f) => document.querySelector(`#aviapanel [data-avia="strike:${f}"]`) !== null,
        flight,
      );
      const after = await groups();
      assert.deepEqual(after[0].rows, [`strike:${flight}`], 'вылет — в первой группе');
      assert.ok(!after.flatMap((g) => g.rows).includes(`sq:${ids.a}`), 'на стоянке её больше нет');
      await shot('4-v-polyote');
      await press(page.locator(`#aviapanel [data-avia="strike:${flight}"]`));
      await frame();
      assert.deepEqual(
        await sel(),
        { squadron: null, strike: flight },
        'строка вылета выделяет его',
      );
    });
    console.log(`Aviation list ${tag} passed.`);
    await context.close();
  }
  console.log(
    'Aviation list smoke passed: entry with count, groups, pick from the list, airborne group, phone sheet and button — desktop and phone.',
  );
} finally {
  await browser.close();
  await site.close();
}
