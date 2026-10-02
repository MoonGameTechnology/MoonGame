/* global window, document, localStorage, innerWidth, innerHeight, getComputedStyle -- browser */
import assert from 'node:assert/strict';

import { enterSkirmish, pressSpeed, recordPurseFloats } from './harnessKit.mjs';

/** Real phone layouts and actions through the existing controllers/reducer. */
export async function checkMobileStrategy(browser, url) {
  const page = await browser.newPage({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 2,
  });
  page.setDefaultTimeout(10000);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const enter = async (locale) => {
    await page.addInitScript((locale) => localStorage.setItem('vd.locale', locale), locale);
    await page.goto(url);
    // Вторая локаль — второй запуск: сохранение уже есть, `enterSkirmish` его заменяет.
    await enterSkirmish(page, { tap: true });
    await pressSpeed(page, '#spd-pause', { tap: true });
  };
  // На телефоне окна открывает нижняя панель (UIX-3.1): «Наука» и «Производство» — её
  // разделы, рынок и дипломатия — плитки листа «Ещё». На ПК — колонка рельсы, как раньше.
  const PHONE_PATH = {
    tech: ['science'],
    constructor: ['production'],
    market: ['more', 'market'],
    diplo: ['more', 'diplomacy'],
  };
  const open = async (id) => {
    if (await page.locator('#phone-nav').isVisible()) {
      const [tab, item] = PHONE_PATH[id];
      await page.locator(`#phone-nav [data-phone-tab="${tab}"]`).tap();
      if (item) await page.locator(`#phone-more [data-phone-more="${item}"]`).tap();
    } else {
      if (!(await page.locator('#rail-' + id).isVisible())) await page.locator('#railtoggle').tap();
      await page.locator('#rail-' + id).tap();
    }
    if (await page.locator('#intro.show').isVisible()) await page.locator('#intro .in-ok').tap();
  };
  const dismissIntro = async () => {
    if (await page.locator('#intro.show').isVisible()) await page.locator('#intro .in-ok').tap();
  };
  const fits = async (selector) => {
    const result = await page.locator(selector).evaluate((e) => {
      const r = e.getBoundingClientRect();
      return {
        x: r.x,
        y: r.y,
        right: r.right,
        bottom: r.bottom,
        width: r.width,
        height: r.height,
        viewportWidth: innerWidth,
        viewportHeight: innerHeight,
        scrollWidth: e.scrollWidth,
        clientWidth: e.clientWidth,
      };
    });
    assert(
      result.x >= -1 &&
        result.y >= -1 &&
        result.right <= result.viewportWidth + 1 &&
        result.bottom <= result.viewportHeight + 1,
      selector + ' fits the viewport: ' + JSON.stringify(result),
    );
    assert(
      result.scrollWidth <= result.clientWidth + 1,
      selector + ' has no clipped horizontal content',
    );
  };
  // Row 1 of the command bar (‹ · crest · nick + standing · ✦ chip · day card) asks for
  // more width than a phone has. It used to overflow instead of shrinking: the standing
  // slid out of `.who` and the ✦ chip painted over it. Landscape hides `.who` outright,
  // so the check runs only where the block is actually on screen.
  const topBarReadable = async () => {
    const bar = await page.evaluate(() => {
      const box = (id) => {
        const r = document.getElementById(id).getBoundingClientRect();
        return { x: r.x, right: r.right, width: r.width };
      };
      const place = document.getElementById('tbplace');
      return {
        place: box('tbplace'),
        score: box('tbscore'),
        day: box('daycard'),
        placeShown: place.textContent !== '' && place.getBoundingClientRect().width > 0,
        placeClipped: place.scrollWidth > place.clientWidth + 1,
      };
    });
    if (!bar.placeShown) return;
    assert(
      bar.place.right <= bar.score.x + 1 && bar.score.right <= bar.day.x + 1,
      'top bar row 1 does not overlap itself: ' + JSON.stringify(bar),
    );
    assert(!bar.placeClipped, 'the standing is readable in full: ' + JSON.stringify(bar));
  };
  // UIX-4.1: под запасом — доход в час, как на ПК. Значок и запас — первой строкой, доход —
  // второй; оба от 12 px, целиком и в пределах своей плашки, плашка — под палец.
  const purseChips = async () => {
    const chips = await page.locator('#purse .res').evaluateAll((els) =>
      els.map((chip) => {
        const box = chip.getBoundingClientRect();
        const part = (el) => {
          if (!el) return null;
          const r = el.getBoundingClientRect();
          return {
            text: el.textContent,
            size: parseFloat(getComputedStyle(el).fontSize),
            clipped: el.scrollWidth > el.clientWidth + 1,
            inside: r.left >= box.left - 1 && r.right <= box.right + 1,
            top: r.top,
            bottom: r.bottom,
          };
        };
        return {
          res: chip.dataset.res,
          height: box.height,
          stock: part(chip.querySelector('b')),
          flow: part(chip.querySelector('em')),
        };
      }),
    );
    assert(
      chips.some((x) => x.flow),
      'the phone prints the income under the stock: ' + JSON.stringify(chips),
    );
    for (const x of chips) {
      assert(x.height >= 43, 'a resource chip is a 44px touch target: ' + JSON.stringify(x));
      for (const part of [x.stock, x.flow].filter(Boolean))
        assert(
          part.size >= 12 && !part.clipped && part.inside,
          'a resource chip reads in full at 12px+: ' + JSON.stringify(x),
        );
      if (x.flow)
        assert(x.flow.top >= x.stock.bottom - 1, 'the income is the second line: ' + JSON.stringify(x));
    }
  };
  const touchTarget = async (selector) => {
    await page.locator(selector).tap({ trial: true });
    await fits(selector);
    const box = await page.locator(selector).boundingBox();
    assert(box.width >= 43 && box.height >= 43, selector + ' is a 44px touch target');
  };
  // UIX-3.1: внизу пять разделов с подписями от 12 px целиком, в «Ещё» — Настройки и Выход.
  // Всплывающее сообщение лежит там, где в альбомной ориентации стоят плитки «Ещё»: лист
  // обязан быть над ним, иначе сообщение закрывает плитку и ловит нажатие.
  const phoneNav = async () => {
    const tabs = await page.locator('#phone-nav button:not([hidden])').evaluateAll((els) =>
      els.map((b) => {
        const label = b.querySelector('span');
        const r = b.getBoundingClientRect();
        return {
          tab: b.dataset.phoneTab,
          size: parseFloat(getComputedStyle(label).fontSize),
          clipped: label.scrollWidth > label.clientWidth + 1,
          width: r.width,
          height: r.height,
        };
      }),
    );
    assert.deepEqual(
      tabs.map((x) => x.tab),
      ['map', 'production', 'science', 'events', 'more'],
    );
    for (const x of tabs) {
      assert(
        x.size >= 12 && !x.clipped,
        'bottom bar label is 12px+ and whole: ' + JSON.stringify(x),
      );
      assert(
        x.width >= 43 && x.height >= 43,
        'bottom bar tab is a 44px touch target: ' + JSON.stringify(x),
      );
    }
    await page.evaluate(() => {
      const toast = document.createElement('div');
      toast.className = 'toast';
      toast.dataset.probe = '1';
      toast.textContent = '✦ 1100';
      document.getElementById('toasts').appendChild(toast);
    });
    await page.locator('#phone-nav [data-phone-tab="more"]').tap();
    await fits('#phone-more .phone-more-panel');
    const tiles = await page.locator('#phone-more [data-phone-more]').evaluateAll((els) =>
      els.map((b) => {
        b.scrollIntoView({ block: 'nearest' });
        const r = b.getBoundingClientRect();
        const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        return {
          id: b.dataset.phoneMore,
          covered: !b.contains(hit),
          width: r.width,
          height: r.height,
        };
      }),
    );
    for (const id of ['settings', 'exit'])
      assert(
        tiles.some((x) => x.id === id),
        'More holds ' + id + ': ' + JSON.stringify(tiles),
      );
    for (const x of tiles) {
      assert(!x.covered, 'More tile is not covered: ' + JSON.stringify(x));
      assert(
        x.width >= 43 && x.height >= 43,
        'More tile is a 44px touch target: ' + JSON.stringify(x),
      );
    }
    await touchTarget('#phone-more [data-phone-close]');
    await page.locator('#phone-more [data-phone-close]').tap();
    assert(!(await page.locator('#phone-more').isVisible()));
    await page.evaluate(() => document.querySelector('#toasts [data-probe]')?.remove());
  };
  // UIX-3.2: скорость — одна кнопка с текущим темпом над нижней панелью. Нажатие раскрывает
  // ряд над ней; выбор, «Назад» и нажатие мимо сворачивают его. Выхода ⌂ в ряду нет — он в
  // «Ещё». Где ряд не помещается в строку, множители целиком уходят на вторую.
  const phoneSpeed = async (locale) => {
    const pill = page.locator('#phone-speed');
    const row = page.locator('#speedbar');
    const paused = new RegExp(`^‖ ${locale === 'ru' ? 'Пауза' : 'Pause'}$`);
    // Надпись кнопки обновляет кадр, а не нажатие, — её ждут, а не читают сразу.
    const pillReads = async (text, what) => {
      try {
        await pill.filter({ hasText: text }).waitFor({ timeout: 3000 });
      } catch {
        assert.fail(what + ': ' + JSON.stringify(await pill.textContent()));
      }
    };
    await pillReads(paused, 'the speed button shows the pause');
    assert(!(await row.isVisible()), 'the speed row is folded into its button');
    await touchTarget('#phone-speed');
    await pill.tap();
    await fits('#speedbar');
    assert(!(await page.locator('#tomenu').isVisible()), 'no ⌂ in the phone speed row');
    const layout = await page.evaluate(() => {
      // Стопка всплывающих сообщений (z 40) до низа экрана: раскрытый ряд обязан лежать над ней.
      const probes = Array.from({ length: 8 }, () => {
        const toast = document.createElement('div');
        toast.className = 'toast';
        toast.textContent = '✦ 1100 — флот прибыл к дальней орбите, постройка готова';
        return document.getElementById('toasts').appendChild(toast);
      });
      const buttons = [...document.querySelectorAll('#speedbar button')]
        .filter((b) => b.getBoundingClientRect().width > 0)
        .map((b) => {
          const r = b.getBoundingClientRect();
          const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
          const group = b.closest('.spd-mult-legacy') ? 'mult' : 'tempo';
          return { label: b.textContent, group, covered: !b.contains(hit), ...r.toJSON() };
        });
      for (const probe of probes) probe.remove();
      const bar = document.getElementById('speedbar');
      const style = getComputedStyle(bar);
      return {
        buttons,
        inner: bar.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight),
        rowBottom: bar.getBoundingClientRect().bottom,
        pillTop: document.getElementById('phone-speed').getBoundingClientRect().top,
      };
    });
    assert.deepEqual(
      layout.buttons.map((b) => b.label),
      ['‖', '▶', '▶▶', '×1', '×10', '×50', '×100'],
    );
    for (const b of layout.buttons) {
      assert(!b.covered, 'speed button is not covered: ' + JSON.stringify(b));
      assert(
        b.width >= 43 && b.height >= 43,
        'speed button is a 44px touch target: ' + JSON.stringify(b),
      );
    }
    for (const group of ['tempo', 'mult']) {
      const tops = layout.buttons.filter((b) => b.group === group).map((b) => Math.round(b.top));
      assert(new Set(tops).size === 1, group + ' buttons share one line: ' + JSON.stringify(tops));
    }
    // Каждая строка ряда занята кнопками от края до края — пустоты левее паузы нет.
    for (const top of new Set(layout.buttons.map((b) => Math.round(b.top)))) {
      const line = layout.buttons.filter((b) => Math.round(b.top) === top);
      const span = Math.max(...line.map((b) => b.right)) - Math.min(...line.map((b) => b.left));
      assert(span >= layout.inner - 1, 'a speed row line has no gap: ' + JSON.stringify(layout));
    }
    assert(
      layout.rowBottom <= layout.pillTop + 1,
      'the row opens above its button: ' + JSON.stringify(layout),
    );
    await page.locator('#spd-play').tap();
    assert(!(await row.isVisible()), 'choosing a speed folds the row');
    await pillReads(/^▶ ×(1|10|50|100)$/, 'the button shows the new speed');
    await pill.tap();
    await page.keyboard.press('Escape');
    assert(!(await row.isVisible()), 'Back folds the row');
    await pill.tap();
    await page.locator('#phone-nav [data-phone-tab="map"]').tap();
    assert(!(await row.isVisible()), 'a tap elsewhere folds the row');
    await pressSpeed(page, '#spd-pause', { tap: true });
    await pillReads(paused, 'the button shows the pause again');
  };
  try {
    for (const locale of ['ru', 'en']) {
      await enter(locale);
      for (const viewport of [
        { width: 320, height: 740 },
        { width: 844, height: 390 },
        { width: 390, height: 844 },
      ]) {
        await page.setViewportSize(viewport);
        console.log('STRATEGY_LAYOUT', locale, viewport.width, viewport.height);
        await topBarReadable();
        await purseChips();
        await phoneNav();
        await phoneSpeed(locale);
        for (const [id, box, close] of [
          ['tech', '.twbox', '.tw-close'],
          ['constructor', '.cnbox', '.cn-close'],
          ['market', '.mkbox', '.mk-close'],
          ['diplo', '.dpbox', '.dp-close'],
        ]) {
          await open(id);
          await fits('#' + id + ' ' + box);
          await touchTarget('#' + id + ' ' + close);
          if (id === 'tech') {
            for (const tab of ['space', 'ground', 'shuttle', 'missile', 'command']) {
              await page.locator(`[data-ttab="${tab}"]`).tap();
              await fits('#tech .tt-scroll');
            }
            await page.locator('[data-ttab="space"]').tap();
            await page.locator('#tech [data-tech] b').first().tap();
            await fits('#tech .tt-mwin');
            await touchTarget('#tech .tt-mx');
            await page.locator('#tech .tt-mbtn').scrollIntoViewIfNeeded();
            await fits('#tech .tt-mbtn');
            await page.locator('#tech .tt-mx').tap();
          } else if (id === 'constructor') {
            for (const tab of ['ships', 'squads', 'infantry', 'vehicles', 'heroes']) {
              await page.locator(`[data-ctab="${tab}"]`).tap();
              await dismissIntro();
              await fits('#constructorbody');
            }
            await page.locator('[data-ctab="ships"]').tap();
            await page.locator('.cn-build').scrollIntoViewIfNeeded();
            await touchTarget('.cn-build');
            await touchTarget('#constructor .cn-close');
          } else if (id === 'market') {
            for (const tab of ['metal', 'food', 'energy', 'microelectronics']) {
              await page.locator(`[data-mtab="${tab}"]`).tap();
              await fits('#marketbody');
            }
          } else {
            await page.locator('#diplo [data-tab="msgs"]').tap();
            await fits('#diplo .dp-convo');
            await fits('#diplo .dp-compose');
            await page.locator('#diplo [data-tab="intel"]').tap();
            await dismissIntro();
            await fits('#diplo .dpbox');
          }
          if (locale === 'ru' && viewport.width === 390)
            await page.screenshot({ path: 'prototype/dist/mobile-strategy-' + id + '.png' });
          await page.locator('#' + id + ' ' + close).tap();
          assert(!(await page.locator('#' + id).isVisible()));
        }
      }
    }
    // Real local market action, with a shortened viewport as when a keyboard opens.
    await open('market');
    await page.locator('[data-mtab="metal"]').tap();
    await page.locator('#mk-amt').fill('5');
    await page.locator('#mk-price').fill('3');
    await page.setViewportSize({ width: 390, height: 480 });
    assert.equal(await page.locator('#mk-amt').inputValue(), '5');
    assert.equal(await page.locator('#mk-price').inputValue(), '3');
    await page.locator('[data-mkgo]').scrollIntoViewIfNeeded();
    await touchTarget('[data-mkgo]');
    await page.locator('[data-mkgo]').tap();
    await page.waitForFunction(() =>
      window.__mobileTest.state().market.some((l) => l.amount === 5 && l.price === 3),
    );
    await page.locator('[data-mkcancel]').first().tap();
    await page.waitForFunction(() => window.__mobileTest.state().market.length === 0);
    await page.keyboard.press('Escape');
    assert(!(await page.locator('#market').isVisible()));
    await page.setViewportSize({ width: 390, height: 844 });
    await open('tech');
    await page.locator('[data-ttab="space"]').tap();
    // UIX-4.1: цена исследования уходит с плашек числом «-N» — ровно той суммой, что
    // заплачена, — и число гаснет само. Возврат металла при отмене продажи выше мог ещё
    // ждать, пока погаснет прежнее число (секунда), и сложился бы с ценой: запись — после.
    await page.waitForTimeout(1100);
    const floats = await recordPurseFloats(page);
    const before = await page.evaluate(() => {
      const me = window.__mobileTest.state().players.p1;
      return { active: me.technologies?.active?.length ?? 0, purse: { ...me.resources } };
    });
    await page.locator('#tech .tt-take:not(:disabled)').first().tap();
    await page.waitForFunction(
      (before) => (window.__mobileTest.state().players.p1.technologies?.active?.length ?? 0) === before + 1,
      before.active,
    );
    const after = await page.evaluate(() => ({ ...window.__mobileTest.state().players.p1.resources }));
    const byRes = (a, b) => a.res.localeCompare(b.res);
    const price = Object.keys(before.purse)
      .filter((res) => before.purse[res] - after[res] >= 1)
      .map((res) => ({ res, sign: 'dn', text: String(Math.round(after[res] - before.purse[res])) }))
      .sort(byRes);
    assert(price.length > 0, 'the research has a price: ' + JSON.stringify({ before, after }));
    const shown = (await floats.settle(price.length)).map(({ res, sign, text, motion }) => ({
      res,
      sign,
      text,
      motion,
    }));
    assert.deepEqual(
      shown.sort(byRes),
      price.map((x) => ({ ...x, motion: 'purse-float' })),
      'the price floats off its chips',
    );
    await page.waitForFunction(() => !document.querySelector('.purse-float'), null, { timeout: 3000 });
    await page.keyboard.press('Escape');
    assert(!(await page.locator('#tech').isVisible()));
    // The adapter restores desktop sizing; the same windows are not permanently stretched.
    await page.setViewportSize({ width: 1200, height: 800 });
    await open('market');
    const desktop = await page.locator('#market .mkbox').boundingBox();
    assert(desktop.width < 1000 && desktop.height < 790);
    assert.deepEqual(errors, []);
    console.log(
      'MOBILE_STRATEGY_PASS RU/EN, 320px, landscape, top bar row 1, two-line resource chips, bottom bar and More over toasts, speed button and its row, all tabs, dossiers, keyboard-size viewport, market/research actions, the price floating off its chips and desktop restoration',
    );
  } catch (error) {
    await page.screenshot({ path: 'prototype/dist/mobile-strategy-failure.png' });
    throw error;
  } finally {
    await page.close();
  }
}
