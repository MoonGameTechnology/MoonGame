#!/usr/bin/env node
/* global localStorage, requestAnimationFrame -- эти имена живут внутри page.evaluate */
/**
 * Снимок любого экрана игры одной командой — чтобы проверить правку ГЛАЗАМИ, не заводя
 * под это харнес (BRWH-3).
 *
 *   pnpm run ui:shot                                   # матч, десктоп, ru → $TMPDIR/void-shot.png
 *   pnpm run ui:shot -- --screen hub --phone --locale en --out hub.png
 *   pnpm run ui:shot -- --player --screen welcome
 *
 * `--screen`: `welcome` | `hub` | `setup` | `match` (партия на паузе, чтобы кадр был
 * воспроизводим). `--phone` — 390×844 с тачем, иначе 1280×800. `--player` — сборка
 * игрока вместо дев-сборки.
 *
 * Кроме PNG печатает сводку экрана: открытые диалоги, видимые кнопки `[data-cmd]`, фокус и
 * ошибки консоли. Агенту это ответ «что на экране» ещё до того, как он откроет картинку;
 * ошибки консоли делают выход ненулевым — снимок сломанного экрана не выдаётся за
 * нормальный.
 */
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseArgs } from 'node:util';

import {
  builtPage,
  enterSkirmish,
  launchBrowser,
  screenReport,
  serve,
  waitForApp,
} from './harnessKit.mjs';

const SCREENS = ['welcome', 'hub', 'setup', 'match'];
const { values: opts } = parseArgs({
  // pnpm передаёт разделитель `--` скрипту как есть — он не аргумент.
  args: process.argv.slice(2).filter((arg) => arg !== '--'),
  options: {
    screen: { type: 'string', default: 'match' },
    phone: { type: 'boolean', default: false },
    player: { type: 'boolean', default: false },
    locale: { type: 'string', default: 'ru' },
    out: { type: 'string', default: join(tmpdir(), 'void-shot.png') },
  },
});
if (!SCREENS.includes(opts.screen)) {
  console.error(`--screen: одно из ${SCREENS.join(', ')}`);
  process.exit(2);
}

const html = builtPage(opts.player ? 'void-dominion-player.html' : 'void-dominion.html');
const site = await serve({ '/': html });
const browser = await launchBrowser();
const errors = [];
try {
  const page = await browser.newPage(
    opts.phone
      ? {
          viewport: { width: 390, height: 844 },
          isMobile: true,
          hasTouch: true,
          deviceScaleFactor: 2,
        }
      : { viewport: { width: 1280, height: 800 } },
  );
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`);
  });
  await page.addInitScript((locale) => localStorage.setItem('vd.locale', locale), opts.locale);
  await page.goto(site.url + '/');
  await waitForApp(page);

  const press = (id) => (opts.phone ? page.locator(id).tap() : page.locator(id).click());
  if (opts.screen === 'hub' || opts.screen === 'setup') {
    await press('#cnew');
    await page.locator('#hub-solo').waitFor({ state: 'visible' });
    if (opts.screen === 'setup') {
      await press('#hub-solo');
      await press('#sp-go');
      await page.locator('#setupgo').waitFor({ state: 'visible' });
    }
  } else if (opts.screen === 'match') {
    await enterSkirmish(page, { tap: opts.phone });
    await page.locator('#maploading').waitFor({ state: 'hidden' });
    await press('#spd-pause');
  }
  // Два кадра — чтобы на снимок попал уже отрисованный, а не промежуточный экран.
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
  await page.screenshot({ path: opts.out });
  const report = await screenReport(page);
  console.log(JSON.stringify({ ...opts, ...report, errors }, null, 2));
  console.log(`\n✓ снимок: ${opts.out}`);
} finally {
  await browser.close();
  await site.close();
}
if (errors.length) process.exit(1);
