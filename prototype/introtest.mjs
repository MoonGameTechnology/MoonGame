#!/usr/bin/env node
/* global window, document, getComputedStyle -- эти имена живут внутри page.evaluate */
/**
 * UIX-8.1 — вводная «впервые» в настоящем браузере: подсказка одной строкой у низа экрана, а не
 * окно поверх того, что она объясняет.
 *
 * Когда вводная положена и что она один раз, решает `intros.ts` с его юнит-тестом; здесь то,
 * чего он не видит. Где подсказка встала: на ПК над нижним рядом и мимо колонки инструментов
 * (1366×768, 1024×700 и 1920×1080 под зумом), на телефоне над нижней панелью (390×844 и
 * боком). Проходят ли нажатия мимо неё: ✕ окна закрывает окно, а вкладка телефона
 * переключается — раньше то и другое ловил затемнённый фон. И что её убирает: щелчок мимо и
 * щелчок по ней самой, клавиша (и срабатывает: пробел ставит паузу), Escape и «Назад» — её
 * одну, окно остаётся. Повтор зажатой клавиши подсказку не убирает. Памятка клавиш ПК на это
 * время гаснет.
 *
 *   node prototype/introtest.mjs      # или pnpm run smoke:intro
 */
import assert from 'node:assert/strict';

import {
  enterSkirmish,
  instrumentedGame,
  launchBrowser,
  serve,
  withDiagnostics,
} from './harnessKit.mjs';

const hooks = `window.__introTest = {
  speed: () => speed,
  layers: () => BACK_LAYERS.filter((l) => l.isOpen()).map((l) => l.id),
};`;

const site = await serve(await instrumentedGame(hooks));
const browser = await launchBrowser();

/** Прямоугольник узла на экране или `null`. */
const rectOf = (page, sel) =>
  page.evaluate((sel) => {
    const r = document.querySelector(sel)?.getBoundingClientRect();
    return r && r.width ? { l: r.left, t: r.top, r: r.right, b: r.bottom } : null;
  }, sel);
const overlap = (a, b) => a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b;
/** Ошибки страниц: чистый прогон обязан оставить консоль пустой. */
const errors = [];
const hintShown = (page) => page.locator('#intro.show').isVisible();
const layers = (page) => page.evaluate(() => window.__introTest.layers());

/**
 * Подсказка как её видит игрок: заголовок и одна строка, шрифты не мельче 14 px, «Понятно» —
 * в палец (44 px), без затемнения, и мышь ловит только коробка, а не весь экран.
 */
async function checkHint(page, label) {
  const hint = await page.evaluate(() => {
    const el = document.getElementById('intro');
    const box = el.querySelector('.inbox');
    return {
      title: box.querySelector('.in-text b')?.textContent ?? '',
      line: box.querySelector('.in-text span')?.textContent ?? '',
      sizes: [...box.querySelectorAll('.in-text b, .in-text span, .in-ok')].map((n) =>
        parseFloat(getComputedStyle(n).fontSize),
      ),
      ok: box.querySelector('.in-ok').getBoundingClientRect().height,
      through: getComputedStyle(el).pointerEvents,
      catches: getComputedStyle(box).pointerEvents,
      backdrop: getComputedStyle(el).backgroundColor,
    };
  });
  assert(hint.title && hint.line, `${label}: заголовок и строка`);
  assert.equal(hint.sizes.length, 3, `${label}: заголовок, строка и «Понятно»`);
  assert(
    hint.sizes.every((s) => s >= 14),
    `${label}: шрифты от 14 px (${hint.sizes})`,
  );
  assert(hint.ok >= 44, `${label}: «Понятно» ${hint.ok} px — меньше пальца`);
  assert.deepEqual(
    [hint.through, hint.catches],
    ['none', 'auto'],
    `${label}: мышь ловит только коробка`,
  );
  assert.equal(hint.backdrop, 'rgba(0, 0, 0, 0)', `${label}: экран не затемнён`);
}

/** Коробка подсказки на экране и мимо `clear` (узлы, которые она не должна закрывать). */
async function checkPlace(page, size, clear, label) {
  await page.setViewportSize(size);
  await page.waitForTimeout(150);
  const box = await rectOf(page, '#intro .inbox');
  assert(box, `${label}: подсказка на экране`);
  assert(
    box.l >= 0 && box.t >= 0 && box.r <= size.width && box.b <= size.height,
    `${label}: подсказка в пределах экрана`,
  );
  for (const sel of clear) {
    const other = await rectOf(page, sel);
    assert(other, `${label}: ${sel} на месте`);
    assert(!overlap(box, other), `${label}: подсказка закрыла ${sel}`);
  }
  return box;
}

try {
  // --- ПК ---------------------------------------------------------------------------------
  const PC = { width: 1366, height: 768 };
  const pc = await browser.newPage({ viewport: PC });
  pc.setDefaultTimeout(10000);
  pc.on('pageerror', (e) => errors.push(e.message));
  await withDiagnostics(pc, 'introtest:pc', async () => {
    const speed = () => pc.evaluate(() => window.__introTest.speed());
    await pc.goto(site.url);
    await enterSkirmish(pc);
    await pc.locator('#key-memo').waitFor();

    // 1. Щелчок по «Технологиям» — окно и подсказка у низа, над полосой скорости и мимо
    //    колонки инструментов; памятка клавиш на это время гаснет.
    await pc.locator('#holo-tech').click();
    await pc.locator('#intro.show').waitFor();
    assert.deepEqual(await layers(pc), ['intro', 'tech']);
    await checkHint(pc, 'ПК');
    assert.equal(await pc.locator('#key-memo').isVisible(), false, 'памятка гаснет под подсказкой');
    // 1920×1080 — под зумом интерфейса 1,25 (UIX-2.1): отступ растёт вместе с нижним рядом.
    for (const size of [{ width: 1024, height: 700 }, { width: 1920, height: 1080 }, PC])
      await checkPlace(pc, size, ['#speedbar', '#railtools'], `ПК ${size.width}×${size.height}`);

    // 2. Нажатие мимо проходит насквозь: ✕ закрывает окно (раньше щелчок ловил фон, и
    //    закрывалась одна вводная), и тот же щелчок убрал подсказку. Памятка вернулась.
    await pc.locator('#tech .tw-close').click();
    assert.equal(await hintShown(pc), false, 'щелчок мимо убрал подсказку');
    assert.deepEqual(await layers(pc), [], 'и закрыл окно');
    assert(await pc.locator('#key-memo').isVisible(), 'памятка вернулась');

    // 3. Второй раз окно открывается без подсказки.
    await pc.locator('#holo-tech').click();
    await pc.locator('#tech.show').waitFor();
    await pc.waitForTimeout(200);
    assert.equal(await hintShown(pc), false, 'вводная — один раз');
    await pc.locator('#tech .tw-close').click();

    // 4. Клавиатура. Зажатая B открыла «Производство» с вводной, и повтор той же клавиши
    //    подсказку не гасит. Пробел — гасит и ставит паузу: подсказка клавиш не глушит.
    await pc.mouse.click(1200, 420);
    await pc.keyboard.down('KeyB');
    await pc.locator('#intro.show').waitFor();
    await pc.keyboard.down('KeyB');
    await pc.keyboard.up('KeyB');
    assert(await hintShown(pc), 'повтор зажатой клавиши — ещё не действие');
    const pace = await speed();
    assert(pace > 0, 'партия идёт');
    await pc.keyboard.press('Space');
    assert.equal(await hintShown(pc), false, 'клавиша убрала подсказку');
    assert.equal(await speed(), 0, 'и сработала: пауза');
    assert.deepEqual(await layers(pc), ['constructor'], 'окно осталось');
    await pc.keyboard.press('Space');
    await pc.keyboard.press('Escape');

    // 5. Escape закрывает подсказку, и только её: «Хранитель» остаётся открытым.
    await pc.locator('#rail-steward').click();
    await pc.locator('#intro.show').waitFor();
    await pc.keyboard.press('Escape');
    assert.equal(await hintShown(pc), false, 'Escape закрыл подсказку');
    assert.deepEqual(await layers(pc), ['steward'], 'окно Escape не тронул');
    await pc.keyboard.press('Escape');

    // 6. Щелчок по самой подсказке убирает только её: рынок остаётся открытым.
    await pc.locator('#rail-market').click();
    await pc.locator('#intro.show').waitFor();
    await pc.locator('#intro .in-text').click();
    assert.equal(await hintShown(pc), false, 'щелчок по подсказке убрал её');
    assert.deepEqual(await layers(pc), ['market'], 'и только её');
  });
  await pc.close();

  // --- Телефон ----------------------------------------------------------------------------
  const PHONE = { width: 390, height: 844 };
  const phone = await browser.newPage({
    viewport: PHONE,
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 2,
  });
  phone.setDefaultTimeout(10000);
  phone.on('pageerror', (e) => errors.push(e.message));
  await withDiagnostics(phone, 'introtest:phone', async () => {
    const tab = (id) => phone.locator(`#phone-nav [data-phone-tab="${id}"]`);
    await phone.goto(site.url);
    await enterSkirmish(phone, { tap: true });
    await phone.locator('#maploading').waitFor({ state: 'hidden' });

    // 7. «Наука» — окно и подсказка над нижней панелью, и боком тоже.
    await tab('science').tap();
    await phone.locator('#intro.show').waitFor();
    await checkHint(phone, 'телефон');
    for (const size of [{ width: 844, height: 390 }, PHONE]) {
      const box = await checkPlace(
        phone,
        size,
        ['#phone-nav'],
        `телефон ${size.width}×${size.height}`,
      );
      const nav = await rectOf(phone, '#phone-nav');
      assert(box.b <= nav.t, `телефон ${size.width}×${size.height}: подсказка над панелью`);
    }

    // 8. «Назад» закрывает подсказку, и только её — окно остаётся.
    await phone.evaluate(() => window.history.back());
    await phone.waitForFunction(() => !document.getElementById('intro').classList.contains('show'));
    assert.deepEqual(await layers(phone), ['tech'], '«Назад» окна не тронул');

    // 9. «Производство» — своя вводная; касание по подсказке убирает её одну.
    await tab('production').tap();
    await phone.locator('#intro.show').waitFor();
    await phone.locator('#intro .in-text').tap();
    assert.equal(await hintShown(phone), false, 'касание по подсказке убрало её');
    assert.deepEqual(await layers(phone), ['constructor'], 'окно осталось');

    // 10. Рынок из «Ещё» — своя вводная; касание по «Карте» проходит в панель: подсказка ушла,
    //     окно закрыто (раньше касание ловил фон вводной).
    await tab('more').tap();
    await phone.locator('#phone-more [data-phone-more="market"]').tap();
    await phone.locator('#intro.show').waitFor();
    await tab('map').tap();
    assert.equal(await hintShown(phone), false, 'касание мимо убрало подсказку');
    assert.deepEqual(await layers(phone), [], 'и дошло до панели');
  });
  await phone.close();

  assert.deepEqual(errors, [], 'ошибки страницы');
  console.log(
    'PASS first-time intro hint: bottom of the screen on PC and phone, clicks and taps pass through, ' +
      'a click, a tap, a key, Escape or Back dismisses it, key repeat does not, shown once',
  );
} finally {
  await browser.close();
  await site.close();
}
