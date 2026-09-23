#!/usr/bin/env node
/* global window, document, getComputedStyle -- эти имена живут внутри page.evaluate */
/**
 * PVR-6.1 — в забеге Sector Zero нет инструментов мультиплеера, а в остальной игре они на месте.
 *
 * Правило (`decisions/sectorZeroTools.ts`) покрыто юнит-тестом, но тот отвечает лишь за
 * список. Здесь вопрос другой — «что игрок видит»: кнопки рельса, «Пинг» в карточке мира и
 * ссылка на рынок из карточки ресурса. Каждая проверка идёт ПАРОЙ: в обычной схватке то же
 * самое обязано быть видно — иначе «кнопки нет» прошло бы и тогда, когда селектор просто
 * устарел. Третий прогон — выход из забега в обычную партию на той же странице: кнопки
 * обязаны вернуться. Попутно — PVR-6.8: меню анимировано, а при reduced motion замирает.
 *
 *   node prototype/sectorzerotest.mjs      # или pnpm run smoke:sector-zero
 */
import assert from 'node:assert/strict';

import {
  enterSkirmish,
  instrumentedGame,
  launchBrowser,
  serve,
  waitForApp,
  withDiagnostics,
} from './harnessKit.mjs';
import { SECTOR_ZERO_ABSENT_TOOLS } from '../decisions/sectorZeroTools.ts';

const hooks = `window.__szTest = {
  run: () => isSectorZeroRun(),
  home: () => Object.values(s.planets).find(p => p.owner === ME && p.kind === 'planet')?.id ?? null,
  // Выбор мира так же, как его делает \`jumpTo\` (переход по ссылке): сама карточка —
  // предмет проверки, а не попадание мышью по карте, где камера у Sector Zero близко к дому.
  select: id => { selPlanet = id; selFleet = null; selFleets = new Set(); lastPanelHtml = ''; renderPanel(); },
  selected: () => selPlanet,
};`;

const ABSENT = Object.values(SECTOR_ZERO_ABSENT_TOOLS);
const KEPT = ['rail-diplo', 'rail-tech', 'rail-help'];

const site = await serve({
  ...(await instrumentedGame(hooks)),
  '/sz': (await instrumentedGame(hooks, { page: 'sector-zero-dev.html' }))['/'],
});
const browser = await launchBrowser();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.setDefaultTimeout(15000);

/** Всё, что игрок может увидеть, в одном прогоне; `run` — ждём ли мы забег Sector Zero. */
async function check(label, run) {
  // Флаг забега ставится после установки матча — ждём его, а не читаем наперегонки.
  await page.waitForFunction((want) => window.__szTest.run() === want, run);
  await page.locator('#maploading').waitFor({ state: 'hidden' });

  await page.locator('#railtoggle').click();
  for (const id of ABSENT)
    assert.equal(await page.locator('#' + id).isVisible(), !run, `${label}: #${id}`);
  for (const id of KEPT)
    assert(await page.locator('#' + id).isVisible(), `${label}: #${id} на месте`);
  await page.locator('#railtoggle').click();

  const home = await page.evaluate(() => window.__szTest.home());
  assert(home, `${label}: у игрока есть домашний мир`);
  await page.evaluate((id) => window.__szTest.select(id), home);
  // Хук перерисовывает карточку сразу (`renderPanel`, как кадр игры): иначе на той же
  // странице до следующего кадра в `#side` лежала карточка ПРОШЛОЙ партии, и счёт «Пинга»
  // плавал — 2 падения из 10, оба с числом от предыдущей фазы.
  await page.locator('#side [data-act="planetinfo"]').first().waitFor({ state: 'attached' });
  assert.equal(
    await page.locator('#side [data-act="ping"]').count(),
    run ? 0 : 1,
    `${label}: «Пинг»`,
  );
  await page.keyboard.press('Escape');

  await page.locator('#purse [data-res="metal"]').click();
  assert.equal(
    await page.locator('.rc-market').count(),
    run ? 0 : 1,
    `${label}: рынок из карточки`,
  );
  await page.locator('.rc-close').click();
}

/** Выход в меню путём игрока на десктопе: «☰ Ещё» → «Выход». */
async function leave() {
  await page.locator('#railtoggle').click();
  await page.locator('#rail-exit').click();
}

try {
  await withDiagnostics(page, 'sectorzerotest', async () => {
    // 1. Отдельная страница Sector Zero.
    await page.goto(site.url + '/sz');
    await waitForApp(page);
    await page.waitForFunction(() => !document.getElementById('sz-new').disabled);
    // PVR-6.8: проекция меню живёт — и замирает, когда игрок просит меньше движения.
    const motion = () =>
      page.evaluate(() =>
        ['.sz-spin-scan', '.sz-core', '.sz-ping'].map(
          (sel) => getComputedStyle(document.querySelector(sel)).animationName,
        ),
      );
    assert.deepEqual(await motion(), ['sz-spin', 'sz-breathe', 'sz-ping'], 'меню анимировано');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    assert.deepEqual(await motion(), ['none', 'none', 'none'], 'reduced motion — покой');
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.locator('#sz-new').click();
    await check('Sector Zero', true);

    // 2. Обычная схватка на основной странице — те же кнопки на месте.
    await page.goto(site.url + '/');
    await enterSkirmish(page);
    await check('схватка', false);

    // 3. Забег из хаба той же страницы, затем снова схватка: кнопки вернулись.
    await leave();
    // Забег из шага 1 сохранён — «Продолжить» идёт ДРУГИМ путём кода (восстановление
    // снимка), и флаг забега там ставится в своём месте: его тоже надо поймать.
    await page.locator('#hub-sector-zero').click();
    await page.waitForFunction(() => !document.getElementById('sz-continue').disabled);
    await page.locator('#sz-continue').click();
    await check('Sector Zero из хаба (продолжение)', true);
    await leave(); // выход из забега ведёт в меню Sector Zero, оттуда — в хаб
    await page.locator('#sz-back').click();
    await enterSkirmish(page, { fromWelcome: false });
    await check('схватка после забега', false);
  });
  console.log(
    '\n✓ Sector Zero: чат, почта, маркеры, корпорация, рынок и «Сон» спрятаны; в схватке — на месте\n',
  );
} finally {
  await browser.close();
  await site.close();
}
