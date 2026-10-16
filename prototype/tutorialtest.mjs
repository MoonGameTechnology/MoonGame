#!/usr/bin/env node
/* global window, document, getComputedStyle -- эти имена живут внутри page.evaluate */
/**
 * Обучение основной игры в настоящем браузере — на ПК (1366×768, мышь) и на телефоне
 * (390×844, касания). Заказ владельца 2026-10-16: подсветка золотом каждого места, куда
 * надо нажать; пока не нажал — ничего другого нельзя; обучение быстрое; соперник
 * подыгрывает, и игрок побеждает в любом случае.
 *
 * Робот ведёт себя как самый послушный новичок: жмёт ТОЛЬКО то, что подсвечено (или
 * «Далее»/кнопку карточки, когда шаг ждёт её), и проверяет по дороге:
 *
 * 1. Шаг, где есть что нажать, заперт: кольцо золотое, а нажатие мимо цели не меняет
 *    ни шаг, ни выбор на карте.
 * 2. Обучение доходит до конца без «Пропустить» и кончается ПОБЕДОЙ над соперником.
 * 3. Укладывается в разумное время (см. `BUDGET_S`): часы мира ускорены.
 *
 *   node prototype/tutorialtest.mjs      # или pnpm run smoke:tutorial (после pnpm run prototype)
 */
import assert from 'node:assert/strict';

import { instrumentedGame, launchBrowser, serve, waitForApp } from './harnessKit.mjs';

/** Потолок реального времени на всё обучение, секунд (живой прогон — около полутора минут). */
const BUDGET_S = 240;

const hooks = `window.__tutorialTest = {
  start: () => beginOnboarding(),
  step: () => (activeTour?.active ? activeTour.stepId : null),
  picked: () => selPlanet ?? selFleet ?? null,
  result: () => ({ status: s.match.status, winner: s.match.winner, me: ME }),
};`;

const site = await serve(await instrumentedGame(hooks));
const browser = await launchBrowser();
const errors = [];

/** Что на экране у подсказки сейчас. */
const view = (page) =>
  page.evaluate(() => {
    const root = document.getElementById('spotlight');
    const ring = root?.querySelector('.sl-ring');
    const shown = ring && getComputedStyle(ring).display !== 'none';
    const r = shown ? ring.getBoundingClientRect() : null;
    const next = root?.querySelector('.sl-next');
    return {
      step: window.__tutorialTest.step(),
      gate: root?.classList.contains('sl-gate') ?? false,
      ring: r && { x: r.left + r.width / 2, y: r.top + r.height / 2 },
      ringColor: shown ? getComputedStyle(ring).borderTopColor : null,
      next: !!next && getComputedStyle(next).display !== 'none',
      card: document.getElementById('codex')?.classList.contains('show') ?? false,
    };
  });

async function walk(label, contextOptions) {
  const context = await browser.newContext(contextOptions);
  const page = await context.newPage();
  const touch = !!contextOptions.hasTouch;
  page.on('pageerror', (e) => errors.push(`${label}: ${e.message}`));
  const press = (x, y) => (touch ? page.touchscreen.tap(x, y) : page.mouse.click(x, y));
  const pressLocator = (loc) => (touch ? loc.tap() : loc.click());

  await page.goto(site.url);
  await waitForApp(page);
  await pressLocator(page.locator('#cnew'));
  await page.evaluate(() => window.__tutorialTest.start());
  await page.waitForFunction(() => window.__tutorialTest.step() !== null, undefined, {
    timeout: 20000,
  });

  const started = Date.now();
  const seen = [];
  const gated = new Set();
  let probed = false;
  let last = null;
  let idle = 0;
  while (Date.now() - started < BUDGET_S * 1000) {
    const v = await view(page);
    if (v.step === null) break;
    if (v.step !== last) {
      seen.push(v.step);
      last = v.step;
      idle = 0;
    }
    if (v.card) {
      // Улучшение — в карточке постройки: шаг ждёт её главную кнопку.
      const go = page
        .locator('#codex button:not([disabled])', { hasText: /Upgrade|Улучш/ })
        .first();
      if (await go.count()) await pressLocator(go);
    } else if (v.next) {
      await pressLocator(page.locator('#spotlight .sl-next'));
    } else if (v.gate && v.ring) {
      gated.add(v.step);
      assert.equal(v.ringColor, 'rgb(255, 212, 92)', `${label}: кольцо шага ${v.step} золотое`);
      if (!probed && v.step === 'home') {
        // Правило 1: нажатие мимо цели заперто — ни шага, ни выбора.
        probed = true;
        const off = { x: contextOptions.viewport.width - 30, y: 160 };
        await press(off.x, off.y);
        await page.waitForTimeout(300);
        const after = await view(page);
        assert.equal(after.step, 'home', `${label}: нажатие мимо цели не двигает шаг`);
        assert.equal(
          await page.evaluate(() => window.__tutorialTest.picked()),
          null,
          `${label}: и ничего не выбирает`,
        );
      }
      await press(v.ring.x, v.ring.y);
      idle++;
      assert(idle < 40, `${label}: цель шага ${v.step} не принимает нажатие`);
    }
    await page.waitForTimeout(350);
  }
  const seconds = (Date.now() - started) / 1000;
  const result = await page.evaluate(() => window.__tutorialTest.result());
  console.log(`${label}: ${seen.length} шагов за ${seconds.toFixed(0)} с — ${seen.join(' → ')}`);
  assert(seconds < BUDGET_S, `${label}: обучение не уложилось в ${BUDGET_S} с`);
  assert.deepEqual(
    { status: result.status, winner: result.winner },
    { status: 'ended', winner: result.me },
    `${label}: обучение кончается победой игрока`,
  );
  for (const step of [
    'home',
    'mine',
    'tech-open',
    'tech-research',
    'ship',
    'fort',
    'spy',
    'pick-fleet',
    'course',
  ])
    assert(gated.has(step), `${label}: шаг ${step} был заперт на цели`);
  await context.close();
}

try {
  await walk('ПК', { viewport: { width: 1366, height: 768 } });
  await walk('телефон', { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  assert.deepEqual(errors, [], 'ошибок страницы нет');
  console.log('✓ обучение основной игры: ПК и телефон');
} finally {
  await browser.close();
  await site.close();
}
