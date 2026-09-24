#!/usr/bin/env node
/* global window, document, localStorage -- эти имена живут внутри page.evaluate */
/**
 * YAG-1.1c — робот играет в СОБРАННЫЙ архив площадки (`prototype/dist/yandex/`).
 *
 * Остальные проверки архива смотрят на него снаружи: `buildTarget.test.ts` — раскладку,
 * имена и тег SDK, `productCut.test.ts` — опись сборщика. Запускать его до этого файла
 * не запускал никто: браузерный смоук CI открывает `void-dominion.html`. А архив собран с
 * `__SECTOR_ZERO_ONLY__`, и его код отличается от любой другой сборки — ошибку, которая
 * живёт только в нём, первым увидел бы модератор площадки.
 *
 * Сервер отдаёт файлы архива как есть и ПОДДЕЛЬНЫЙ `/sdk.js` по тому же адресу, что и
 * настоящий: тег-лоадер из разметки срабатывает честно, а игра видит SDK площадки.
 * Что проверяется:
 *
 * 1. запуск без единой ошибки страницы и консоли; сразу Sector Zero, без хаба и входа;
 * 2. забег стартует, площадке сообщается начало геймплея;
 * 3. выход в меню и перезагрузка — «Продолжить» возвращает тот же забег;
 * 4. ролик за Суверены: досмотренный кладёт порцию в кошелёк;
 * 5. двери по ссылке закрыты: `?join=…` и `?reset=…` открывают тот же Sector Zero;
 * 6. игра не просит ничего, кроме файлов архива и SDK, — ни нашего сервера, ни чужого;
 * 7. язык (`YAG-1.1d`): игрок скачивает файл только своего языка, и разметка подписана
 *    текстом, а не ключами, — и для русского, и для англоязычного игрока.
 *
 *   node prototype/yandextest.mjs            # или pnpm run smoke:yandex (собирает сам)
 *   node prototype/yandextest.mjs --no-build # проверить уже собранный архив
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

import { launchBrowser, waitForApp, withDiagnostics } from './harnessKit.mjs';

const ROOT = fileURLToPath(new URL('./dist/yandex/', import.meta.url));

if (!process.argv.includes('--no-build')) {
  // Всегда свежая сборка: робот, проверивший вчерашний архив, хуже никакого.
  const built = spawnSync(
    process.execPath,
    [fileURLToPath(new URL('./build.mjs', import.meta.url))],
    {
      stdio: 'inherit',
    },
  );
  if (built.status !== 0) process.exit(built.status ?? 1);
}
if (!existsSync(join(ROOT, 'index.html'))) {
  console.error('нет prototype/dist/yandex/index.html — сначала pnpm run prototype');
  process.exit(1);
}

/** Поддельный SDK: ровно то, что зовёт адаптер, и журнал вызовов для проверок. */
const FAKE_SDK = `window.__ya = { log: [] };
window.YaGames = {
  init: () => Promise.resolve({
    environment: { i18n: { lang: window.__yaLang || 'ru' } },
    features: {
      LoadingAPI: { ready: () => window.__ya.log.push('ready') },
      GameplayAPI: {
        start: () => window.__ya.log.push('start'),
        stop: () => window.__ya.log.push('stop'),
      },
    },
    adv: {
      showRewardedVideo({ callbacks }) {
        window.__ya.log.push('rewarded');
        for (const [i, name] of ['onOpen', 'onRewarded', 'onClose'].entries())
          setTimeout(() => callbacks[name] && callbacks[name](), 30 * (i + 1));
      },
    },
  }),
};`;

const TYPES = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.webp': 'image/webp',
  '.json': 'application/json',
};
/** Всё, что игра попросила у сервера, кроме файлов архива и SDK, — находка. */
const stray = [];
/** Какие файлы языков скачаны (`YAG-1.1d`): игроку положен ровно один — свой. */
const localeRequests = [];
const server = createServer((req, res) => {
  const path = decodeURIComponent(req.url.split('?')[0]);
  if (path === '/sdk.js') {
    res.setHeader('content-type', 'text/javascript');
    return res.end(FAKE_SDK);
  }
  if (/^\/assets\/locale-[a-z]+\.json$/.test(path)) localeRequests.push(path);
  const file = normalize(join(ROOT, path === '/' ? 'index.html' : path));
  if (!file.startsWith(ROOT) || !existsSync(file) || !statSync(file).isFile()) {
    stray.push(req.url);
    res.statusCode = 404;
    return res.end();
  }
  res.setHeader('content-type', TYPES[extname(file)] ?? 'application/octet-stream');
  res.end(readFileSync(file));
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;

const browser = await launchBrowser();
const context = await browser.newContext({
  locale: 'ru-RU',
  viewport: { width: 1280, height: 800 },
});
const page = await context.newPage();
page.setDefaultTimeout(20000);
const errors = [];
page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
page.on('console', (m) => m.type() === 'error' && errors.push(`console: ${m.text()}`));
// Чужие адреса — отдельно от 404 своего сервера: в архиве площадки их быть не должно.
page.on('request', (req) => {
  if (!req.url().startsWith(origin) && !req.url().startsWith('data:')) stray.push(req.url());
});

/** Меню Sector Zero открыто, а хаба и карточки входа не видно. */
async function onSectorZeroMenu(label) {
  await waitForApp(page);
  await page.locator('#sz-new').waitFor({ state: 'visible' });
  assert.equal(await page.locator('#hub').isVisible(), false, `${label}: хаб спрятан`);
  assert.equal(await page.locator('#connect').isVisible(), false, `${label}: входа нет`);
}
/** Текст ключа в собранном файле языка — им и должна быть подписана кнопка. */
const builtText = (id, key) =>
  JSON.parse(readFileSync(join(ROOT, `assets/locale-${id}.json`), 'utf8'))[key];
const wave = () => page.locator('.dl-wave').first();
const log = () => page.evaluate(() => window.__ya.log);
const progress = () =>
  page.evaluate(() => JSON.parse(localStorage.getItem('sector-zero.progress.v1') ?? 'null'));

try {
  await withDiagnostics(page, 'yandextest', async () => {
    // 1. Первый запуск.
    await page.goto(origin + '/');
    await onSectorZeroMenu('запуск');
    assert.ok((await log()).includes('ready'), 'площадке сообщено «игра загружена»');
    // YAG-1.1d: скачан только русский файл, и кнопки подписаны текстом, а не ключами.
    assert.deepEqual(localeRequests, ['/assets/locale-ru.json'], 'скачан один язык — свой');
    assert.equal(
      (await page.locator('#sz-new').textContent())?.trim(),
      builtText('ru', 'sector-zero.new'),
      'кнопка подписана по-русски',
    );

    // 2. Новый забег.
    await page.waitForFunction(() => !document.getElementById('sz-new').disabled);
    await page.locator('#sz-new').click();
    await wave().waitFor({ state: 'visible' });
    await page.locator('#maploading').waitFor({ state: 'hidden' });
    assert.ok((await log()).includes('start'), 'площадке сообщено начало геймплея');

    // 3. Выход в меню путём игрока, перезагрузка, «Продолжить».
    await page.locator('#railtoggle').click();
    await page.locator('#rail-exit').click();
    await onSectorZeroMenu('выход из забега');
    await page.reload();
    await onSectorZeroMenu('перезагрузка');
    await page.waitForFunction(() => !document.getElementById('sz-continue').disabled);
    await page.locator('#sz-continue').click();
    await wave().waitFor({ state: 'visible' });
    await page.locator('#railtoggle').click();
    await page.locator('#rail-exit').click();
    await onSectorZeroMenu('второй выход');

    // 4. Ролик за Суверены из магазина.
    await page.waitForFunction(() => !document.getElementById('sz-prep').disabled);
    await page.locator('#sz-prep').click();
    await page.locator('[data-prep="tab"][data-id="shop"]').click();
    const before = (await progress())?.sovereigns ?? 0;
    await page.locator('[data-prep="ad-sovereigns"]:not([disabled])').click();
    await page.waitForFunction(
      (n) => (JSON.parse(localStorage.getItem('sector-zero.progress.v1')).sovereigns ?? 0) > n,
      before,
    );
    assert.ok((await log()).includes('rewarded'), 'ролик показан силами площадки');

    // 5. Двери по ссылке ведут в тот же Sector Zero.
    for (const tail of ['/?join=abc123', '/?reset=token123']) {
      await page.goto(origin + tail);
      await onSectorZeroMenu(tail);
    }
  });

  // 7. Площадка говорит `en`, а браузер — по-русски: язык берётся у площадки (требование
  // 2.14), и скачан только английский файл. Браузер нарочно другой: совпади они, проверка
  // прошла бы и с игрой, которая площадку не слушает.
  const english = await browser.newContext({ locale: 'ru-RU' });
  const enPage = await english.newPage();
  enPage.on('pageerror', (error) => errors.push(`pageerror (en): ${error.message}`));
  enPage.on('console', (m) => m.type() === 'error' && errors.push(`console (en): ${m.text()}`));
  await enPage.addInitScript(() => {
    window.__yaLang = 'en';
  });
  localeRequests.length = 0;
  await enPage.goto(origin + '/');
  await waitForApp(enPage);
  await enPage.locator('#sz-new').waitFor({ state: 'visible' });
  assert.deepEqual(localeRequests, ['/assets/locale-en.json'], 'язык площадки — и только он');
  assert.equal(
    (await enPage.locator('#sz-new').textContent())?.trim(),
    builtText('en', 'sector-zero.new'),
    'кнопка подписана по-английски',
  );
  await english.close();
  // 6. Ни ошибок, ни запросов мимо архива.
  assert.deepEqual(errors, [], 'ошибки страницы и консоли');
  assert.deepEqual(stray, [], 'запросы мимо файлов архива и SDK');
  console.log(
    '\n✓ архив площадки: запуск, забег, «Продолжить», ролик, закрытые двери, один язык — без ошибок\n',
  );
} finally {
  await browser.close();
  server.close();
}
