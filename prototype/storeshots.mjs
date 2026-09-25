#!/usr/bin/env node
/* global window, document, localStorage -- эти имена живут внутри page.evaluate */
/**
 * YAG-5.2 — медиа карточки Яндекс Игр (`docs/yandex-games-card.md` §2).
 *
 * 1. PNG иконки и обложки из векторных черновиков `prototype/art/store/*.svg`.
 * 2. Скриншоты СОБРАННОГО архива площадки (`prototype/dist/yandex/`), а не дев-страницы:
 *    в игроцкой сборке нет дев-кнопок, и в кадр они не попадут. Архив поднимается так же,
 *    как в роботе `yandextest.mjs`: файлы как есть и поддельный `/sdk.js` площадки.
 *
 * Кадры — меню, глава на маршруте, магазин подготовки и забег на карте; языки — русский и
 * английский; ориентации — альбомная 1920×1080 и портретная 1080×1920 (телефон 360×640 ×3).
 * Всё складывается в `prototype/dist/store/`.
 *
 *   pnpm run prototype && node prototype/storeshots.mjs
 */
import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

import { launchBrowser, profileSeal, waitForApp } from './harnessKit.mjs';

const ROOT = fileURLToPath(new URL('./dist/yandex/', import.meta.url));
/** Печать профиля — та же, что у игры: кошелёк кадров кладётся запечатанным. */
const seal = await profileSeal();
const ART = fileURLToPath(new URL('./art/store/', import.meta.url));
const OUT = fileURLToPath(new URL('./dist/store/', import.meta.url));

if (!existsSync(join(ROOT, 'index.html'))) {
  console.error('нет prototype/dist/yandex/index.html — сначала pnpm run prototype');
  process.exit(1);
}
mkdirSync(OUT, { recursive: true });

/** Поддельный SDK: гость, язык из `__yaLang`, ролики досматриваются сами. */
const FAKE_SDK = `window.YaGames = {
  init: () => Promise.resolve({
    getPlayer: async () => ({
      getUniqueID: () => 'shots',
      isAuthorized: () => false,
      setData: async () => {},
      getData: async () => ({}),
    }),
    environment: { i18n: { lang: window.__yaLang || 'ru' } },
    features: { LoadingAPI: { ready() {} }, GameplayAPI: { start() {}, stop() {} } },
    adv: { showRewardedVideo({ callbacks }) { callbacks.onClose && callbacks.onClose(); } },
    onEvent: () => () => {},
    auth: { openAuthDialog: async () => {} },
  }),
};`;

const TYPES = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
};
const server = createServer((req, res) => {
  const path = decodeURIComponent(req.url.split('?')[0]);
  if (path === '/sdk.js') {
    res.setHeader('content-type', 'text/javascript');
    return res.end(FAKE_SDK);
  }
  const file = normalize(join(ROOT, path === '/' ? 'index.html' : path));
  if (!file.startsWith(ROOT) || !existsSync(file) || !statSync(file).isFile()) {
    res.statusCode = 404;
    return res.end();
  }
  res.setHeader('content-type', TYPES[extname(file)] ?? 'application/octet-stream');
  res.end(readFileSync(file));
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;

const ORIENTATIONS = [
  { name: 'landscape', viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1.5 },
  {
    name: 'portrait',
    viewport: { width: 360, height: 640 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
  },
];
const LANGS = [
  { id: 'ru', locale: 'ru-RU' },
  { id: 'en', locale: 'en-US' },
];

const browser = await launchBrowser();
const saved = [];
try {
  // 1. Иконка и обложка: SVG → PNG ровно нужного размера.
  for (const [svg, width, height, name] of [
    ['icon.svg', 512, 512, 'icon-512.png'],
    ['cover.svg', 800, 470, 'cover-800x470.png'],
  ]) {
    const page = await browser.newPage({ viewport: { width, height } });
    await page.setContent(
      `<html><body style="margin:0;background:#000">${readFileSync(join(ART, svg), 'utf8')}</body></html>`,
    );
    await page.screenshot({ path: join(OUT, name), clip: { x: 0, y: 0, width, height } });
    saved.push(name);
    await page.close();
  }

  // 2. Скриншоты архива.
  for (const lang of LANGS) {
    for (const o of ORIENTATIONS) {
      const context = await browser.newContext({ locale: lang.locale, ...o });
      await context.addInitScript((id) => {
        window.__yaLang = id;
      }, lang.id);
      const page = await context.newPage();
      page.setDefaultTimeout(30000);
      const shot = async (n, scene) => {
        const name = `${lang.id}-${o.name}-${n}-${scene}.png`;
        await page.screenshot({ path: join(OUT, name) });
        saved.push(name);
      };
      /** Прокручивает не окно, а контейнеры экранов — сброс всем, у кого сдвиг. */
      const scrollTop = () =>
        page.evaluate(() => {
          for (const el of document.querySelectorAll('*')) if (el.scrollTop > 0) el.scrollTop = 0;
        });

      await page.goto(origin + '/');
      await waitForApp(page);
      await page.locator('#sz-new').waitFor({ state: 'visible' });
      // Кошелёк середины игры, а не нулевой: у свежего профиля все цены магазина погашены.
      // Свежий профиль ещё не записан — его пишет сверка дня витрины при входе в подготовку.
      // Дальше меняются только числа валют; остальное игра нормализует сама при чтении.
      await page.locator('#sz-prep').click();
      await page.locator('[data-prep="back"]').click();
      // Кошелёк ложится запечатанным (`YAG-4.4`): правленый без печати игра не возьмёт и
      // вернёт теневую копию.
      const key = 'sector-zero.progress.v1';
      const current = await page.evaluate((k) => localStorage.getItem(k) ?? '{"v":1}', key);
      const wallet = seal.sealProgress(
        { ...JSON.parse(current), research: 640, warrants: 24, sovereigns: 35 },
        seal.LOCAL_SEAL,
      );
      await page.evaluate(([k, raw]) => localStorage.setItem(k, raw), [key, wallet]);
      await page.reload();
      await waitForApp(page);
      await page.locator('#sz-new').waitFor({ state: 'visible' });
      await page.waitForTimeout(1500); // меню анимировано — дать ему встать в кадр
      await shot(1, 'menu');

      await page.locator('#sz-mission-0').click();
      await page.locator('#sz-map-panel').waitFor({ state: 'visible' });
      if (o.isMobile) await page.locator('#sz-map-panel').scrollIntoViewIfNeeded();
      else await scrollTop();
      await page.waitForTimeout(600);
      await shot(2, 'chapter');
      await page.locator('#sz-map-close').click();

      await page.locator('#sz-prep').click();
      await page.locator('[data-prep="tab"][data-id="shop"]').click();
      await scrollTop();
      await page.waitForTimeout(600);
      await shot(3, 'shop');
      await page.locator('[data-prep="back"]').click();

      await page.locator('#sz-new').click();
      await page.locator('#maploading').waitFor({ state: 'hidden' });
      await page.locator('#pirate-close').click(); // подсказка первого боя закрывает полкарты
      // Камера забега стоит у самого дома — отдалить, чтобы в кадр вошёл сектор.
      const box = await page.locator('canvas').first().boundingBox();
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      for (let i = 0; i < 4; i++) {
        await page.mouse.wheel(0, 240);
        await page.waitForTimeout(150);
      }
      await page.locator('#spd-fast').click();
      // Первая волна Роя — через 2:11 на ▶, то есть ~87 с на ▶▶: снять её на подходе.
      await page.waitForTimeout(95000);
      await shot(4, 'run');
      await context.close();
    }
  }
} finally {
  await browser.close();
  server.close();
}
console.log(
  `✓ медиа карточки: ${saved.length} файлов в prototype/dist/store/\n  ${saved.join('\n  ')}`,
);
