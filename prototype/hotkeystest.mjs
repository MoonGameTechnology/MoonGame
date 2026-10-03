#!/usr/bin/env node
/* global window, document, getComputedStyle, localStorage -- эти имена живут внутри page.evaluate */
/**
 * UIX-9.1 и UIX-9.4 — горячие клавиши и подписи колонки инструментов ПК в настоящем браузере.
 *
 * Правила клавиш держит юнит-тест (`decisions/hotkeys.test.ts`), но он не видит того, что
 * видит игрок: открылось ли окно, встала ли пауза, куда ушли камера и фокус. Здесь — схватка
 * на ПК 1366×768: памятка, значки клавиш, каждая клавиша и места, где клавиши обязаны
 * молчать (поле чата, окно настроек); колонка инструментов, которая раскрывается подписями под
 * курсором и при фокусе с клавиатуры; и игроцкая сборка, где управления временем на ПК нет.
 * Забег (почты и «Производства» нет, пробел — пауза забега) проверяет `sectorzerotest.mjs`.
 *
 *   node prototype/hotkeystest.mjs      # или pnpm run smoke:hotkeys
 */
import assert from 'node:assert/strict';

import {
  builtPage,
  enterSkirmish,
  instrumentedGame,
  launchBrowser,
  serve,
  waitForApp,
  withDiagnostics,
} from './harnessKit.mjs';

const hooks = `window.__keysTest = {
  speed: () => speed,
  layers: () => BACK_LAYERS.filter((l) => l.isOpen()).map((l) => l.id),
  selected: () => selFleet,
  mine: () => Object.values(s.fleets).filter((f) => f.owner === ME).map((f) => f.id),
  // Где на экране мир столицы и флот, и где середина поля карты (insets() — края поля,
  // а не отступы).
  capitalAt: () => world(s.planets[capitalOf(s, ME)].position),
  fleetAt: (id) => fleetAnchor(s.fleets[id]),
  middle: () => { const i = insets(); return { x: (i.left + i.right) / 2, y: (i.top + i.bottom) / 2 }; },
  say: (key) => t(key),
};`;

const site = await serve({
  ...(await instrumentedGame(hooks)),
  '/player': builtPage('void-dominion-player.html'),
});
const browser = await launchBrowser();
const VIEW = { width: 1366, height: 768 };

/** Прямоугольник узла на экране или `null`. */
const rectOf = (page, sel) =>
  page.evaluate((sel) => {
    const r = document.querySelector(sel)?.getBoundingClientRect();
    return r && r.width ? { l: r.left, t: r.top, r: r.right, b: r.bottom } : null;
  }, sel);
const overlap = (a, b) => a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b;
/** Ошибки страниц: чистый прогон обязан оставить консоль пустой. */
const errors = [];
const watch = (page) => page.on('pageerror', (e) => errors.push(e.message));
const memoKeys = (page) => page.locator('#key-memo kbd').allTextContents();
const memoShown = (page) => page.locator('#key-memo').isVisible();

try {
  const page = await browser.newPage({ viewport: VIEW });
  page.setDefaultTimeout(10000);
  watch(page);
  await withDiagnostics(page, 'hotkeystest', async () => {
    const t = (name, arg) => page.evaluate(([name, arg]) => window.__keysTest[name](arg), [name, arg]);
    const active = () => page.evaluate(() => document.activeElement?.id || document.activeElement?.tagName);
    const chips = () =>
      page.evaluate(() =>
        [...document.querySelectorAll('#speedbar .spd-mult-pc .spdmini')].map((c) => (c.classList.contains('on') ? 1 : 0)).join(''),
      );
    /** Убрать открытое и вернуть фокус карте — как игрок, щелчком по пустому месту. */
    const clear = async () => {
      for (let i = 0; i < 6 && (await t('layers')).length; i++) await page.keyboard.press('Escape');
      await page.mouse.click(1200, 420);
    };
    /** Увести камеру прочь перетаскиванием карты. */
    const dragAway = async () => {
      await page.mouse.move(900, 500);
      await page.mouse.down();
      await page.mouse.move(300, 200, { steps: 6 });
      await page.mouse.up();
    };
    /** Точка в середине поля карты (с допуском в четверть экрана)? */
    const centred = async (p) => {
      const mid = await t('middle');
      return !!p && Math.abs(p.x - mid.x) < VIEW.width / 4 && Math.abs(p.y - mid.y) < VIEW.height / 4;
    };

    await page.goto(site.url);
    await enterSkirmish(page);

    // 1. Памятка встаёт, когда карта готова (Escape на заставке увёл бы из партии): пять
    //    клавиш, внизу, не на колонке инструментов и не на полосе скорости — и на низком окне,
    //    где колонка опускается до низа; мышь не ловит.
    await page.locator('#key-memo').waitFor();
    assert.equal(await page.locator('#maploading').isVisible(), false, 'памятка — после заставки карты');
    assert.deepEqual(await memoKeys(page), ['T', 'B', 'L', 'H', 'Tab'], 'клавиши памятки');
    for (const size of [{ width: 1024, height: 700 }, VIEW]) {
      await page.setViewportSize(size);
      await page.waitForTimeout(100);
      const memo = await rectOf(page, '#key-memo');
      assert(memo.l >= 0 && memo.b <= size.height && memo.r <= size.width, `памятка на экране ${size.width}×${size.height}`);
      for (const sel of ['#speedbar', '#railtools'])
        assert(!overlap(memo, await rectOf(page, sel)), `памятка не закрывает ${sel} на ${size.width}×${size.height}`);
    }
    assert.equal(await page.evaluate(() => getComputedStyle(document.getElementById('key-memo')).pointerEvents), 'none');
    assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('#key-memo button')).pointerEvents), 'auto');

    // 2. Клавиша видна на кнопке: значком на вкладках и в колонке инструментов, а у «‖» и
    //    кнопок скорости — в подсказке.
    assert.deepEqual(
      await page.evaluate(() =>
        ['holo-tech', 'holo-constructor', 'rail-log', 'rail-msgs', 'rail-help'].map((id) => document.getElementById(id).dataset.kbd),
      ),
      ['T', 'B', 'L', 'M', 'F1'],
    );
    assert.match(await page.locator('#spd-pause').getAttribute('title'), / \((Space|Пробел)\)$/, 'подсказка «‖»');
    const chipTitles = await page.evaluate(() => [...document.querySelectorAll('#speedbar .spd-mult-pc .spdmini')].map((c) => c.title));
    chipTitles.forEach((title, i) => assert.match(title, new RegExp(` \\(${i + 1}\\)$`), `подсказка «${title}»`));

    // 3. Окна: T, B, L, M, F1 — те же окна, что у кнопок рельсы. Первая клавиша гасит памятку.
    for (const [code, layer] of [['KeyT', 'tech'], ['KeyB', 'constructor'], ['KeyL', 'logwin'], ['KeyM', 'diplo'], ['F1', 'codexhub']]) {
      await clear();
      await page.keyboard.press(code);
      await page.waitForFunction((layer) => window.__keysTest.layers().includes(layer), layer);
    }
    assert.equal(await memoShown(page), false, 'нажатая клавиша гасит памятку');
    assert.equal(await page.evaluate(() => localStorage.getItem('void.keys.learned')), '1');
    await clear();

    // 4. Пробел — пауза и продолжение с тем же темпом; 1–4 — кнопки скорости.
    const pace = await t('speed');
    assert(pace > 0, 'партия идёт');
    await page.keyboard.press('Space');
    assert.equal(await t('speed'), 0, 'пробел ставит паузу');
    await page.keyboard.press('Space');
    assert.equal(await t('speed'), pace, 'пробел продолжает с тем же темпом');
    for (const [code, on] of [['Digit2', '0100'], ['Numpad4', '0001'], ['Digit1', '1000']]) {
      await page.keyboard.press(code);
      assert.equal(await chips(), on, `${code}: кнопка скорости`);
    }

    // 5. Фокус после мыши — случайный: пробел ставит паузу, а не жмёт кнопку, и фокус снят.
    //    Shift+Tab остаётся браузеру, и дальше Tab ведёт по кнопкам, а не по флотам.
    await page.locator('#spd-play').click();
    assert.equal(await active(), 'spd-play');
    await page.keyboard.press('Space');
    assert.equal(await t('speed'), 0, 'пробел после щелчка по ▶ — пауза');
    assert.equal(await active(), 'BODY', 'клавиша сняла случайный фокус');
    await page.keyboard.press('Space');
    await page.keyboard.press('Shift+Tab');
    const reached = await active();
    assert.notEqual(reached, 'BODY', 'Shift+Tab ведёт в навигацию');
    await page.keyboard.press('Tab');
    assert.notEqual(await active(), reached, 'Tab после Shift+Tab — навигация');
    assert.equal(await t('selected'), null, 'и флот не выбран');
    await clear();

    // 6. Tab — свой флот, выбран и в середине поля; H — к столице. Перед клавишей камера
    //    уведена прочь: в середину их приводит сама клавиша.
    const mine = await t('mine');
    assert(mine.length, 'у игрока есть флот');
    await dragAway();
    for (const id of mine) assert.equal(await centred(await t('fleetAt', id)), false, 'до Tab флоты не в середине');
    await page.keyboard.press('Tab');
    const picked = await t('selected');
    assert(mine.includes(picked), 'Tab выбирает свой флот');
    assert(await centred(await t('fleetAt', picked)), 'Tab показывает флот');
    await clear();
    await dragAway();
    assert.equal(await centred(await t('capitalAt')), false, 'до H столица не в середине');
    await page.keyboard.press('KeyH');
    assert(await centred(await t('capitalAt')), 'H ведёт к столице');

    // 7. Клавиши молчат: в поле чата буква — это буква, над настройками — ничего.
    await page.locator('#rail-chat').click();
    const input = page.locator('#chatwin input').first();
    await input.click();
    await page.keyboard.type('tb1 ');
    assert.equal(await input.inputValue(), 'tb1 ', 'буквы ушли в поле');
    assert.deepEqual(await t('layers'), ['chatwin'], 'окна не открылись');
    assert(await t('speed') > 0, 'пробел в поле — не пауза');
    await input.fill('');
    await clear();
    await page.locator('#rail-settings').click();
    await page.keyboard.press('KeyT');
    assert.deepEqual(await t('layers'), ['settings'], 'над настройками T молчит');
    await clear();

    // 8. Колонка инструментов (UIX-9.4). Свёрнутая — значки по 44 px, подпись есть только для
    //    диктора. Под мышью — подписи полными словами и значки клавиш, а значки кнопок стоят на
    //    месте; колонка над карточками и на экране. Мышь ушла — свернулась. Подсказка осталась
    //    только там, где говорит больше подписи.
    const rail = () =>
      page.evaluate(() =>
        [...document.querySelectorAll('#railtools > button')]
          .filter((b) => b.getClientRects().length)
          .map((b) => {
            const box = b.getBoundingClientRect();
            const label = b.querySelector('.rlbl');
            const l = label.getBoundingClientRect();
            return {
              id: b.id,
              width: box.width,
              icon: b.querySelector('.holo-icon').getBoundingClientRect().left,
              text: label.textContent,
              folded: l.width <= 1 && l.height <= 1,
              shown: l.width > 20 && l.height > 8 && l.left >= box.left && l.right <= box.right,
              size: parseFloat(getComputedStyle(label).fontSize),
              kbd: getComputedStyle(b, '::after').content,
              title: b.title,
            };
          }),
      );
    const columnWidth = () => page.evaluate(() => document.getElementById('railtools').getBoundingClientRect().width);
    const folded = await rail();
    assert(folded.length >= 8, 'колонка инструментов на месте');
    for (const b of folded) {
      assert.equal(b.width, 44, `${b.id}: свёрнутая кнопка — только значок`);
      assert(b.folded && b.text, `${b.id}: подпись свёрнута, но есть для диктора`);
    }
    assert.equal(folded.find((b) => b.id === 'rail-log').kbd, 'none', 'у свёрнутой кнопки значка клавиши нет');
    await page.locator('#rail-diplo').hover();
    const open = await rail();
    open.forEach((b, i) => {
      assert(b.shown && b.size >= 13, `${b.id}: подпись видна в кнопке и не мельче 13 px`);
      assert(Math.abs(b.icon - folded[i].icon) < 1, `${b.id}: значок кнопки не сдвинулся`);
    });
    const button = (id) => open.find((b) => b.id === id);
    assert.equal(button('rail-diplo').text, await t('say', 'rail.diplo.title'), 'подпись — полное имя');
    assert.deepEqual(['rail-log', 'rail-msgs', 'rail-help'].map((id) => button(id).kbd), ['"L"', '"M"', '"F1"'], 'значки клавиш');
    assert.deepEqual([button('rail-diplo').title, button('rail-log').title], ['', ''], 'подсказка не повторяет подпись');
    const steward = await page.evaluate(() => [
      document.getElementById('rail-steward').title,
      document.querySelector('#rail-steward .rlbl').textContent,
    ]);
    assert(steward[0] && steward[0] !== steward[1], 'у «Хранителя» подсказка говорит больше подписи');
    assert.equal(await page.evaluate(() => getComputedStyle(document.getElementById('rail')).zIndex), '33');
    const column = await rectOf(page, '#railtools');
    assert(column.r - column.l > 100 && column.r <= VIEW.width && column.b <= VIEW.height, 'раскрытая колонка на экране');
    await page.mouse.move(1200, 420);
    assert(await columnWidth() < 70, 'мышь ушла — колонка свернулась');

    // 9. Колонку раскрывает фокус с клавиатуры, а не фокус после мыши: щелчок по «Событиям»,
    //    мышь прочь, Escape закрыл окно — фокус остался на кнопке, а колонка свёрнута. Shift+Tab —
    //    до колонки дошли с клавиатуры, она раскрыта; щелчок по карте — свёрнута.
    await page.locator('#rail-log').click();
    await page.mouse.move(1200, 420);
    await page.keyboard.press('Escape');
    assert.deepEqual(await t('layers'), [], 'Escape закрыл окно');
    assert.equal(await active(), 'rail-log');
    assert(await columnWidth() < 70, 'фокус после мыши колонку не раскрывает');
    await page.keyboard.press('Shift+Tab');
    assert(await page.evaluate(() => !!document.activeElement.closest('#railtools')), 'Shift+Tab ведёт по колонке');
    assert(await columnWidth() > 100, 'фокус с клавиатуры раскрывает колонку');
    await page.mouse.click(1200, 420);
    assert(await columnWidth() < 70, 'щелчок по карте свернул колонку');
  });
  await page.close();

  // 10. Игроцкая сборка: управления временем на ПК нет — нет и пробела; ✕ гасит памятку навсегда.
  const player = await browser.newPage({ viewport: VIEW });
  player.setDefaultTimeout(10000);
  watch(player);
  await withDiagnostics(player, 'hotkeystest:player', async () => {
    await player.goto(site.url + '/player');
    await enterSkirmish(player);
    await player.locator('#key-memo').waitFor();
    await player.mouse.click(1200, 420);
    assert.equal(await player.locator('#spd-ctl').isVisible(), false, 'у игрока на ПК нет управления временем');
    await player.keyboard.press('Space');
    assert.equal(await player.locator('#spd-pause.on').count(), 0, 'пробел без кнопки паузы молчит');
    assert(await memoShown(player), 'пробел без кнопки — не нажатая клавиша');
    await player.locator('#key-memo button').click();
    assert.equal(await memoShown(player), false, '✕ гасит памятку');
    await player.reload();
    await waitForApp(player);
    await enterSkirmish(player, { fromWelcome: await player.locator('#cnew').isVisible() });
    await player.waitForFunction(() => document.getElementById('maploading').style.display === 'flex');
    await player.locator('#maploading').waitFor({ state: 'hidden' });
    await player.waitForTimeout(300);
    assert.equal(await memoShown(player), false, 'после ✕ памятка больше не встаёт');
    await player.keyboard.press('KeyT');
    await player.locator('#tech.show').waitFor();
  });
  assert.deepEqual(errors, [], 'ошибки страницы');
  console.log(
    'PASS PC hotkeys: memo, key badges and hints, T/B/L/M/F1 windows, Space and 1–4, focus, Tab and H, silent in chat and settings, ' +
      'rail labels on hover and keyboard focus, player build',
  );
} finally {
  await browser.close();
  await site.close();
}
