/* global document, location, getComputedStyle -- эти имена живут внутри page.evaluate */
/**
 * Общая база браузерных харнесов (BRWH-3).
 *
 * Зачем она, а не ещё одна копия в каждом файле. Четыре харнеса сгнили ОДНИМ способом
 * (BRWH-2): каждый держал свою копию пути «вход → хаб → сетап → запуск», и когда в игру
 * пришли диалог «Заменить сохранённую партию?» и честное ожидание старта, копии тихо
 * разошлись с игрой. Здесь этот путь описан один раз — и знает оба факта:
 *
 *  1. **Игра готова не тогда, когда видна разметка.** Карточка входа статична и видна
 *     сразу, а обработчики появляются, только когда `bootstrap.ts` снимет
 *     `body.app-starting`. Тап раньше — тап в пустоту. {@link waitForApp} ждёт именно
 *     этот сигнал, а при сбое запуска падает сразу с кодом экрана ошибки, не таймаутом.
 *  2. **Второй запуск соло спрашивает про сохранение.** {@link enterSkirmish}
 *     подтверждает диалог, если он пришёл, и не ждёт его, если его нет.
 *
 * И третье, чего не хватало всем: при падении {@link withDiagnostics} кладёт рядом
 * снимок экрана и сводку «что было на экране» — открытые диалоги, видимые кнопки
 * `[data-cmd]`, классы `body`, ошибки консоли. Раньше падение давало только строку
 * Playwright «locator resolved to hidden» — и диагноз снимался заново руками.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { resolveChromium } from '../scripts/chromium.mjs';

const require = createRequire(import.meta.url);
const { chromium } = createRequire(require.resolve('@playwright/mcp/package.json'))(
  'playwright-core',
);

/** Chromium тех же флагов, что у всех харнесов: предустановленный, если он есть. */
export function launchBrowser(options = {}) {
  const executablePath = resolveChromium();
  return chromium.launch({
    headless: true,
    ...(executablePath ? { executablePath } : {}),
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
    ...options,
  });
}

/** Собранная страница из `prototype/dist/` — с понятной ошибкой, если сборки нет. */
export function builtPage(name = 'void-dominion.html') {
  try {
    return readFileSync(`prototype/dist/${name}`);
  } catch {
    throw new Error(`нет prototype/dist/${name} — сначала pnpm run prototype`);
  }
}

/**
 * Игра с харнесовыми хуками: `main.ts` собирается заново с дописанным `hooks` (код в
 * области видимости игры — видит `s`, выделение, камеру) и встаёт в слот инлайнового
 * бандла собранной страницы. Так тест читает состояние, не заводя ради него экспортов в
 * проде. Возвращает маршруты для {@link serve}: страницу и её `/app.js`.
 */
export async function instrumentedGame(hooks, { page = 'void-dominion.html' } = {}) {
  const { build } = await import('esbuild');
  const bundle = await build({
    stdin: {
      contents: readFileSync('prototype/src/main.ts', 'utf8') + hooks,
      resolveDir: process.cwd() + '/prototype/src',
      loader: 'ts',
    },
    bundle: true,
    write: false,
    format: 'iife',
    platform: 'browser',
    loader: { '.webp': 'dataurl' },
    define: { __PLAYER_BUILD__: 'false', __SECTOR_ZERO_ONLY__: 'false' },
  });
  const built = builtPage(page).toString('utf8');
  // build.mjs кладёт ровно один известный инлайновый бандл в конец доверенной сборки —
  // меняется именно этот слот; это не санитайзер HTML.
  const start = built.lastIndexOf('<script>');
  const end = built.lastIndexOf('</script>');
  if (start < 0 || end < start) throw new Error(`в ${page} нет инлайнового бандла`);
  return {
    '/': built.slice(0, start) + '<script src="/app.js"></script>' + built.slice(end + 9),
    '/app.js': { type: 'text/javascript', body: bundle.outputFiles[0].text },
  };
}

/**
 * Локальный сервер для страниц игры. `routes` — путь → тело (строка/Buffer) или
 * `{ type, body }`; неизвестный путь отдаёт `fallback` (по умолчанию первый маршрут).
 * `/auth/status` всегда отвечает «аккаунтов нет»: без этого стартовый экран ждёт пробы
 * сервера, а харнесу нужен режим позывных.
 */
export async function serve(routes, { fallback } = {}) {
  const table = new Map(Object.entries(routes));
  const fallbackBody = fallback ?? [...table.values()][0];
  const server = createServer((req, res) => {
    if (req.url === '/auth/status') {
      res.setHeader('content-type', 'application/json');
      return res.end('{"enabled":false}');
    }
    const hit = table.get(req.url.split('?')[0]) ?? fallbackBody;
    const { type = 'text/html', body } =
      typeof hit === 'string' || Buffer.isBuffer(hit) ? { body: hit } : hit;
    res.setHeader('content-type', type);
    res.end(body);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  return { url, server, close: () => new Promise((resolve) => server.close(resolve)) };
}

/**
 * Дождаться, пока игра РЕАЛЬНО готова отвечать на нажатия: `bootstrap.ts` снимает
 * `app-starting` после импорта игры. Сбой запуска — сразу ошибка с кодом экрана.
 */
export async function waitForApp(page, { timeout = 15000 } = {}) {
  const state = await page.waitForFunction(
    () => {
      const body = document.body;
      if (!body) return false;
      if (body.classList.contains('app-startup-failed'))
        return { failed: document.getElementById('startup-code')?.textContent ?? '?' };
      return body.classList.contains('app-starting') ? false : { failed: null };
    },
    undefined,
    { timeout },
  );
  const { failed } = await state.jsonValue();
  if (failed !== null) throw new Error(`игра не запустилась: ${failed}`);
}

/**
 * Хаб → сетап → запуск соло-партии, с подтверждением «Заменить сохранённую партию?».
 * `fromWelcome` — начать с карточки входа («Новый командир»). `tap` — сенсорный ввод.
 */
export async function enterSkirmish(page, { tap = false, fromWelcome = true } = {}) {
  const press = (id) => (tap ? page.locator('#' + id).tap() : page.locator('#' + id).click());
  await waitForApp(page);
  for (const id of [...(fromWelcome ? ['cnew'] : []), 'hub-solo', 'sp-go', 'setupgo'])
    await press(id);
  // Диалог приходит, только если сохранение уже есть; ждём одного из двух исходов.
  await page.waitForFunction(
    () =>
      getComputedStyle(document.getElementById('solo-replace')).display !== 'none' ||
      document.getElementById('setup').style.display === 'none',
  );
  if (await page.locator('#solo-replace').isVisible()) await press('solo-replace-confirm');
}

/** Что было на экране в момент падения: то, что иначе приходится выяснять руками. */
export function screenReport(page) {
  return page.evaluate(() => {
    const shown = (el) =>
      !!el && getComputedStyle(el).display !== 'none' && el.offsetParent !== null;
    return {
      url: location.href,
      body: document.body.className,
      dialogs: [...document.querySelectorAll('[role="dialog"]')]
        .filter((el) => getComputedStyle(el).display !== 'none' && !el.hidden)
        .map((el) => el.id || el.className),
      commands: [...document.querySelectorAll('[data-cmd]')]
        .filter(shown)
        .map((el) => el.dataset.cmd + (el.disabled ? '(disabled)' : '')),
      focused: document.activeElement?.id || document.activeElement?.tagName,
    };
  });
}

/**
 * Прогнать шаг харнеса; при падении положить снимок и отчёт в `HARNESS_OUT`
 * (по умолчанию `$TMPDIR/void-harness`) и дописать пути к сообщению ошибки.
 * Ошибки страницы (`pageerror`, `console.error`) копятся с момента вызова.
 */
export async function withDiagnostics(page, label, run) {
  const errors = [];
  const onPageError = (error) => errors.push(`pageerror: ${error.message}`);
  const onConsole = (message) => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`);
  };
  page.on('pageerror', onPageError);
  page.on('console', onConsole);
  try {
    return await run();
  } catch (error) {
    const dir = process.env.HARNESS_OUT ?? join(tmpdir(), 'void-harness');
    mkdirSync(dir, { recursive: true });
    const base = join(dir, label.replace(/[^\w.-]+/g, '_'));
    const report = { label, error: error.message.split('\n')[0], errors };
    try {
      Object.assign(report, await screenReport(page));
      await page.screenshot({ path: `${base}.png` });
      report.screenshot = `${base}.png`;
    } catch (reportError) {
      report.reportError = reportError.message; // страница уже закрыта или упала
    }
    writeFileSync(`${base}.json`, JSON.stringify(report, null, 2));
    error.message += `\n  ↳ диагностика: ${base}.json${report.screenshot ? ` + ${base}.png` : ''}`;
    throw error;
  } finally {
    page.off('pageerror', onPageError);
    page.off('console', onConsole);
  }
}
