#!/usr/bin/env node
/* global window -- имя живёт внутри page.evaluate, то есть в браузере */
/**
 * Эскадра на стоянке — на карте (концепт «Управление эскадрой», заказ владельца 2026-11-08),
 * проверенная настоящим браузером на ПК и телефоне.
 *
 * Правила значка и строки состояния покрыты в `decisions/hangarBadge.test.ts`, выбор — в
 * `interaction.test.ts`. Здесь вопрос другой — «игрок находит эскадру на карте и командует
 * ей»: у своей базы с эскадрами нарисован значок «◇ N», тап по нему выделяет эскадру (на
 * телефоне при двух — через короткий список), открывается её карточка, перегрузка на
 * носитель у причала и обратно держит выбор на той же эскадре, а после взлёта выбор едет
 * за ней на её вылет.
 *
 *   node prototype/hangartest.mjs                    # или pnpm run smoke:hangar
 *   HANGAR_SHOTS=каталог node prototype/hangartest.mjs   # плюс снимки
 *   HANGAR_LOCALE=ru-RU …                                 # язык браузера для снимков
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
import { hangarHits as __hangarHits } from './mapHangars';
window.__hangarTest = {
  prepared: () => inMatch() && __mapWasEntered && !mapPreparation.active,
  // Свой мир с портом, в ангаре две эскадры перехватчиков, у причала пустой носитель.
  // Выбора нет, мир в центре экрана.
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
    f.hangar = [];
    delete f.sortie;
    f.location = home.id;
    f.movement = null;
    f.battleId = null;
    clearSelection();
    invalidatePanel();
    renderPanel();
    centerOn(home.position, Math.max(cam.scale, 2.2));
    return { home: home.id, carrier: f.id, a: 'sq:' + ME + ':a', b: 'sq:' + ME + ':b' };
  },
  hits: () => {
    const r = canvas.getBoundingClientRect();
    return __hangarHits().map((h) => ({ x: r.left + h.x, y: r.top + h.y, ids: h.squadronIds }));
  },
  sel: () => ({ squadron: selSquadron, strike: selStrike, choices: mobileChoices.length }),
  strikeOf: (sq) => (s.strikes ?? []).find((st) => st.squadronId === sq)?.id ?? null,
  where: (sq) => {
    for (const p of Object.values(s.planets)) if ((p.hangar ?? []).some((q) => q.id === sq)) return 'port';
    for (const f of Object.values(s.fleets)) if ((f.hangar ?? []).some((q) => q.id === sq)) return 'hold';
    return null;
  },
  // Точка страницы восточнее мира: внутри круга патруля перехватчика.
  near: (id, dx) => {
    const p = s.planets[id].position;
    return toScreen(world({ x: p.x + dx, y: p.y }), canvas.getBoundingClientRect(), VW, VH);
  },
};`;

const shots = process.env.HANGAR_SHOTS;
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
      ...(process.env.HANGAR_LOCALE ? { locale: process.env.HANGAR_LOCALE } : {}),
    });
    const page = await context.newPage();
    page.setDefaultTimeout(15000);
    const press = (locator) => (phone ? locator.tap() : locator.click());
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
    const sel = () => page.evaluate(() => window.__hangarTest.sel());
    await withDiagnostics(page, `hangar-${tag}`, async () => {
      await page.goto(site.url + '/');
      await enterSkirmish(page, { tap: phone });
      await page.waitForFunction(() => window.__hangarTest.prepared());
      const ids = await page.evaluate(() => window.__hangarTest.prepare());
      await page.waitForFunction(() => window.__hangarTest.hits().length > 0);
      const [badge] = await page.evaluate(() => window.__hangarTest.hits());
      assert.deepEqual(badge.ids, [ids.a, ids.b], 'один значок на базу, эскадры в порядке ангара');
      await shot('1-znachok');

      // Тап по значку: ПК берёт первую эскадру, телефон показывает список из двух.
      await tapAt(badge);
      await frame();
      if (phone) {
        assert.equal((await sel()).choices, 2, 'телефон: список эскадр под значком');
        await shot('2-spisok');
        await page.locator('#mobile-sheet [data-mobile="choose"]').first().tap();
      }
      await frame();
      assert.equal((await sel()).squadron, ids.a, 'выделена первая эскадра');
      await shot('3-kartochka');
      if (phone) {
        await page.locator('#mobile-sheet .mobile-info').tap();
        await shot('4-kartochka-podrobno');
      } else {
        // Окно ПК встаёт рядом с выбором и закрывает значок: соседку выбирают по имени.
        await press(page.locator(`[data-act="sqpick"][data-arg="${ids.b}"]`));
        await frame();
        assert.equal((await sel()).squadron, ids.b, 'имя соседки в карточке выделяет её');
        await press(page.locator(`[data-act="sqpick"][data-arg="${ids.a}"]`));
        await frame();
        assert.equal((await sel()).squadron, ids.a);
      }

      // Кнопки — только те, что ядро примет сейчас.
      for (const act of ['wingstrike', 'wingpatrol', 'sqload', 'wingsplit', 'wingmerge']) {
        assert.equal(
          await page.locator(`#side [data-act="${act}"][data-arg="${ids.a}"]`).count(),
          1,
          `кнопка ${act}`,
        );
      }

      // На борт носителя и обратно — выбор держится на той же эскадре.
      await press(page.locator(`#side [data-act="sqload"][data-arg="${ids.a}"]`));
      await frame();
      assert.equal(await page.evaluate((q) => window.__hangarTest.where(q), ids.a), 'hold');
      assert.equal((await sel()).squadron, ids.a, 'выбор пережил погрузку');
      await shot('5-na-bortu');
      await press(page.locator(`#side [data-act="squnload"][data-arg="${ids.a}"]`));
      await frame();
      assert.equal(await page.evaluate((q) => window.__hangarTest.where(q), ids.a), 'port');
      assert.equal((await sel()).squadron, ids.a, 'выбор пережил выгрузку');

      // Патруль: после взлёта выбор едет за эскадрой на её вылет.
      await press(page.locator(`#side [data-act="wingpatrol"][data-arg="${ids.a}"]`));
      await frame();
      const point = await page.evaluate((h) => window.__hangarTest.near(h, 20), ids.home);
      await tapAt(point);
      await frame();
      const flight = await page.evaluate((q) => window.__hangarTest.strikeOf(q), ids.a);
      assert.ok(flight, 'эскадра взлетела');
      assert.deepEqual(await sel(), { squadron: null, strike: flight, choices: 0 });
      await shot('6-v-polyote');
    });
    console.log(`Hangar badge ${tag} passed.`);
    await context.close();
  }
  console.log(
    'Hangar badge smoke passed: badge, pick, list on the phone, card, load and unload, launch follow — desktop and phone.',
  );
} finally {
  await browser.close();
  await site.close();
}
