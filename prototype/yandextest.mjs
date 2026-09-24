#!/usr/bin/env node
/* global window, document, localStorage, Event -- эти имена живут внутри page.evaluate */
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
 * 3. выход в меню (вторым «назад» площадки, `YAG-6.4`; первое — подсказка) и перезагрузка —
 *    «Продолжить» возвращает тот же забег; выход площадки ставит мир на паузу;
 * 4. ролик за Суверены: досмотренный кладёт порцию в кошелёк;
 * 5. двери по ссылке закрыты: `?join=…` и `?reset=…` открывают тот же Sector Zero;
 * 6. игра не просит ничего, кроме файлов архива и SDK, — ни нашего сервера, ни чужого;
 * 7. пауза забега (`YAG-6.2`, «‖» полосы скорости): кнопка и уход со страницы
 *    замораживают мир, на возврате он ждёт кнопки, а площадка слышит «геймплей встал /
 *    пошёл» — в том числе в меню;
 * 8. облако вошедшего игрока (`YAG-2.2`): пустое получает профиль, а облачный прогресс на
 *    пустом устройстве берётся молча; гость входит кнопкой «Войти», и если прогресс есть
 *    и здесь, и в облаке, профиль выбирает игрок — любой из двух (`YAG-1.4`).
 *    Забег на другом устройстве продолжается ТЕМ ЖЕ миром из облака, а не пересобранным
 *    с карты главы (`AUD-24`): иначе вход со второго устройства стирал поражение.
 * 9. язык (`YAG-1.1d`): игрок скачивает файл только своего языка, и разметка подписана
 *    текстом, а не ключами, — и для русского, и для англоязычного игрока;
 * 10. темп забега (`matchExits.ts`, правило 6): полоса скорости несёт ‖ ▶ ▶▶ — и на ПК, и
 *    на телефоне, — а множителей ×1…×100 в забеге нет.
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
const FAKE_SDK = `window.__ya = { log: [], writes: [] };
// «Назад» и выход площадки (YAG-6.4): тест шлёт их сам — \`__yaFire('HISTORY_BACK')\`.
const events = {};
window.__yaFire = (name) => (events[name] || []).forEach((listener) => listener());
// Облако вошедшего игрока (YAG-2.2): стартовое содержимое задаёт тест (\`__cloudInit\`).
const cloud = Object.assign({}, window.__cloudInit || {});
window.YaGames = {
  init: () => Promise.resolve({
    getPlayer: async () => ({
      getUniqueID: () => 'u-1',
      isAuthorized: () => !window.__guest,
      setData: async (data, flush) => {
        window.__ya.writes.push({ data, flush });
        Object.assign(cloud, data);
      },
      getData: async () => cloud,
    }),
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
    onEvent: (name, listener) => {
      (events[name] = events[name] || []).push(listener);
      return () => {
        events[name] = (events[name] || []).filter((l) => l !== listener);
      };
    },
    // Вход (YAG-1.4): гость (\`__guest\`) после окна становится вошедшим.
    auth: {
      openAuthDialog: async () => {
        window.__ya.log.push('auth');
        window.__guest = false;
      },
    },
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
/** Полоса скорости в забеге: пауза и его темп — ‖ ▶ ▶▶, без множителей; ▶▶▶ — только в
 *  дев-забеге, а архив — игроцкая сборка, где её нет вовсе. */
async function runTempoOnly(p, label) {
  await p.locator('#spd-fast').waitFor({ state: 'visible' });
  assert.ok(await p.locator('#spd-play').isVisible(), `${label}: ▶ на месте`);
  assert.equal(
    await p.locator('#speedbar [data-mult]:visible').count(),
    0,
    `${label}: множителей нет`,
  );
  assert.ok(await p.locator('#spd-pause').isVisible(), `${label}: пауза — в полосе скорости`);
  assert.equal(await p.locator('#spd-dev').count(), 0, `${label}: ▶▶▶ в архиве нет`);
  assert.equal(await p.locator('#runpause').count(), 0, `${label}: второй паузы нет`);
}
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
    // YAG-2.2: облако пустое — профиль вошедшего игрока уходит туда сразу.
    await page.waitForFunction(() => window.__ya.writes.length > 0);

    // 2. Новый забег.
    await page.waitForFunction(() => !document.getElementById('sz-new').disabled);
    await page.locator('#sz-new').click();
    await wave().waitFor({ state: 'visible' });
    await page.locator('#maploading').waitFor({ state: 'hidden' });
    assert.ok((await log()).includes('start'), 'площадке сообщено начало геймплея');
    await runTempoOnly(page, 'ПК');
    await page.locator('#spd-fast').click();
    assert.ok(await page.locator('#spd-fast.on').isVisible(), 'ПК: ▶▶ включает ускорение');
    await page.locator('#spd-play').click();

    // 2а. Пауза забега (YAG-6.2; «‖» полосы скорости с 2026-09-24): кнопка замораживает
    // отсчёт волны, уход со страницы — тоже, и на возврате мир ждёт кнопки; площадка
    // слышит «геймплей встал / пошёл».
    const countdown = async () => (await wave().textContent()) ?? '';
    const frozenFor = async (ms) => {
      const before = await countdown();
      await page.waitForTimeout(ms);
      return before === (await countdown());
    };
    const lastMark = async () => (await log()).filter((c) => c === 'start' || c === 'stop').at(-1);
    assert.equal(await frozenFor(1200), false, 'мир идёт');
    await page.locator('#spd-pause').click();
    assert.equal(await frozenFor(1200), true, 'пауза кнопкой замораживает мир');
    assert.equal(await lastMark(), 'stop', 'на паузе площадке сообщено «геймплей встал»');
    await page.locator('#spd-pause').click();
    assert.equal(await frozenFor(1200), false, 'кнопка продолжает мир');
    assert.equal(await lastMark(), 'start', 'после паузы — «геймплей пошёл»');
    const setVisibility = (state) =>
      page.evaluate((value) => {
        Object.defineProperty(document, 'visibilityState', { value, configurable: true });
        document.dispatchEvent(new Event('visibilitychange'));
      }, state);
    await setVisibility('hidden');
    await setVisibility('visible');
    assert.equal(await frozenFor(1200), true, 'после ухода со страницы мир ждёт игрока');
    await page.locator('#spd-pause').click();
    assert.equal(await frozenFor(1200), false, 'и продолжает по кнопке');
    // Шапка забега: ни эмблемы с названием и местом, ни очков победы, ни дня (решение
    // владельца 2026-09-24) — в забеге они ничего не значат.
    for (const id of ['tbcrest', 'tbscore', 'daycard'])
      assert.equal(await page.locator('#' + id).isVisible(), false, `шапка забега: #${id}`);
    // Вместо них — кошелёк профиля настоящим балансом, а плашки-заглушки в строке статуса нет.
    const sov = (await progress())?.sovereigns ?? 0;
    assert.equal(
      (await page.locator('#tbwallet .tw-sovereigns').textContent())?.replace(/\D/g, ''),
      String(sov),
      'шапка забега: Суверены — баланс профиля',
    );
    assert.equal(await page.locator('#devline .dl-donate').count(), 0, 'Суверены не дублируются');

    // 2б. Выход площадки (YAG-6.4) ставит мир на паузу — сохранение идёт тем же путём, что
    // уход со страницы. «Назад» площадки: первое — подсказка, второе — выход в меню.
    await page.evaluate(() => window.__yaFire('EXIT'));
    assert.equal(await frozenFor(1200), true, 'выход площадки ставит мир на паузу');
    await page.evaluate(() => window.__yaFire('HISTORY_BACK'));
    assert.equal(await page.locator('#sz-new').isVisible(), false, 'первое «назад» — подсказка');
    await page.evaluate(() => window.__yaFire('HISTORY_BACK'));

    // 3. Выход в меню (вторым «назад» площадки), перезагрузка, «Продолжить».
    await onSectorZeroMenu('выход из забега');
    // В меню геймплея нет — индикатор площадки не должен остаться зелёным (YAG-6.2).
    await page.waitForFunction(
      () => window.__ya.log.filter((c) => c === 'start' || c === 'stop').at(-1) === 'stop',
    );
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
    const shown = async () => (await log()).filter((c) => c === 'rewarded').length;
    const shownBefore = await shown();
    await page.locator('[data-prep="ad-sovereigns"]:not([disabled])').waitFor();
    // Двойной тап в одном такте (AUD-25): пока ролик идёт, второе нажатие не зовёт второй.
    await page.evaluate(() => {
      const button = document.querySelector('[data-prep="ad-sovereigns"]:not([disabled])');
      button.click();
      button.click();
    });
    await page.waitForFunction(
      (n) => (JSON.parse(localStorage.getItem('sector-zero.progress.v1')).sovereigns ?? 0) > n,
      before,
    );
    await page.waitForTimeout(300);
    assert.equal((await shown()) - shownBefore, 1, 'двойной тап — один ролик');

    // 5. Двери по ссылке ведут в тот же Sector Zero.
    for (const tail of ['/?join=abc123', '/?reset=token123']) {
      await page.goto(origin + tail);
      await onSectorZeroMenu(tail);
    }
  });
  // 8а. Развилка (YAG-1.4): гость с прогрессом входит, а в облаке — другой профиль.
  // Игрок видит числа обоих и выбирает; выбранный становится единственным.
  for (const pick of ['take-cloud', 'keep-here']) {
    const fork = await browser.newContext({ locale: 'ru-RU' });
    const forkPage = await fork.newPage();
    forkPage.on('pageerror', (error) => errors.push(`pageerror (${pick}): ${error.message}`));
    await forkPage.addInitScript(() => {
      window.__guest = true;
      window.__cloudInit = {
        meta: JSON.stringify({
          v: 1,
          seed: 'account',
          rev: 12,
          progress: JSON.stringify({ v: 1, seed: 'account', research: 50, nextAttempt: 41 }),
        }),
      };
      if (!localStorage.getItem('sector-zero.progress.v1'))
        localStorage.setItem(
          'sector-zero.progress.v1',
          JSON.stringify({ v: 1, seed: 'device', research: 9, nextAttempt: 13 }),
        );
    });
    await forkPage.goto(origin + '/');
    await waitForApp(forkPage);
    // Гость: облака нет, пока он не войдёт, — и вход только по кнопке.
    await forkPage.locator('#sz-signin').waitFor({ state: 'visible' });
    assert.equal(
      await forkPage.evaluate(() => window.__ya.writes.length),
      0,
      `${pick}: гость в облако не пишет`,
    );
    await forkPage.locator('#sz-signin').click();
    await forkPage.locator('#sz-cloud-choice').waitFor({ state: 'visible' });
    assert.equal(
      await forkPage.locator('#sz-new').isVisible(),
      false,
      `${pick}: до выбора не играют`,
    );
    assert.match(
      await forkPage.locator('#sz-cloud-here').textContent(),
      /12/,
      'числа этого профиля',
    );
    assert.match(await forkPage.locator('#sz-cloud-cloud').textContent(), /40/, 'числа облачного');
    await forkPage.locator(`#sz-${pick}`).click();
    await forkPage.locator('#sz-new').waitFor({ state: 'visible' });
    assert.equal(await forkPage.locator('#sz-cloud-choice').isVisible(), false);
    assert.equal(await forkPage.locator('#sz-signin').isVisible(), false, 'вошедшему «Войти» нет');
    const kept = pick === 'keep-here' ? 'device' : 'account';
    assert.equal(
      await forkPage.evaluate(
        () => JSON.parse(localStorage.getItem('sector-zero.progress.v1')).seed,
      ),
      kept,
      `${pick}: на устройстве выбранный профиль`,
    );
    if (pick === 'keep-here') {
      // Облако заменено этим профилем, и номер правки ушёл ВПЕРЁД облачного.
      const meta = await forkPage.waitForFunction(() => {
        const last = window.__ya.writes.at(-1)?.data;
        return last && JSON.parse(Object.values(last)[0]);
      });
      const written = await meta.jsonValue();
      assert.equal(written.seed, 'device', 'в облаке — выбранный профиль');
      assert.ok(written.rev > 12, 'номер правки впереди облачного');
    }
    await fork.close();
  }
  // 8. Облако (YAG-2.2): здесь пусто, в облаке прогресс — он берётся молча и сразу.
  const other = await browser.newContext({ locale: 'ru-RU' });
  const otherPage = await other.newPage();
  otherPage.on('pageerror', (error) => errors.push(`pageerror (cloud): ${error.message}`));
  const cloudProfile = {
    v: 1,
    seed: 'account',
    research: 50,
    warrants: 30,
    sovereigns: 7,
    nextAttempt: 4,
    settledThrough: 3,
  };
  await otherPage.addInitScript((progress) => {
    window.__cloudInit = {
      meta: JSON.stringify({ v: 1, seed: 'account', rev: 12, progress: JSON.stringify(progress) }),
    };
  }, cloudProfile);
  await otherPage.goto(origin + '/');
  await waitForApp(otherPage);
  await otherPage.waitForFunction(
    () => JSON.parse(localStorage.getItem('sector-zero.progress.v1') ?? '{}').seed === 'account',
  );
  const adopted = await otherPage.evaluate(() =>
    JSON.parse(localStorage.getItem('sector-zero.progress.v1')),
  );
  assert.equal(adopted.sovereigns, 7, 'облачный прогресс взят');
  assert.equal(adopted.nextAttempt, 4, 'и счёт попыток с ним');
  await other.close();

  // 8б. Забег на другом устройстве (AUD-24): облако везёт ТОЧНЫЙ мир, а не только номер
  // волны. Раньше в облако уезжал один дескриптор, второе устройство пересобирало мир с
  // карты главы — и «Продолжить» там было перемоткой поражения: дом цел, наступление Роя
  // стёрто. Признак пересборки — часы мира: новый мир начинается с начала карты.
  const envelope = await page
    .waitForFunction(() => {
      const metas = window.__ya.writes.map((w) => w.data.meta).filter(Boolean);
      const last = metas.at(-1);
      return last && JSON.parse(last).state ? last : null;
    })
    .then((handle) => handle.jsonValue());
  const cloudRun = JSON.parse(JSON.parse(envelope).state);
  assert.ok(cloudRun.state.time > 0, 'в облаке — мир забега, который уже шёл');
  const second = await browser.newContext({ locale: 'ru-RU' });
  const secondPage = await second.newPage();
  secondPage.setDefaultTimeout(20000);
  secondPage.on('pageerror', (error) => errors.push(`pageerror (2-е устройство): ${error.message}`));
  await secondPage.addInitScript((meta) => {
    window.__cloudInit = { meta };
  }, envelope);
  await secondPage.goto(origin + '/');
  await waitForApp(secondPage);
  await secondPage.waitForFunction(() => !document.getElementById('sz-continue').disabled);
  await secondPage.locator('#sz-continue').click();
  await secondPage.locator('.dl-wave').first().waitFor({ state: 'visible' });
  const resumed = await secondPage.evaluate(() => JSON.parse(localStorage.getItem('void.run.v1')));
  assert.ok(
    resumed.state.time >= cloudRun.state.time,
    `2-е устройство продолжает тот же мир (${resumed.state.time} ≥ ${cloudRun.state.time}), а не новый`,
  );
  assert.equal(resumed.sectorZeroAttempt, cloudRun.sectorZeroAttempt, 'та же попытка');
  await second.close();

  // 9. Площадка говорит `en`, а браузер — по-русски: язык берётся у площадки (требование
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

  // 10. Телефон: та же полоса в забеге — ▶ и ▶▶, выход ⌂ на месте, множителей нет.
  const phone = await browser.newContext({
    locale: 'ru-RU',
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  const phonePage = await phone.newPage();
  phonePage.on('pageerror', (error) => errors.push(`pageerror (телефон): ${error.message}`));
  await phonePage.goto(origin + '/');
  await waitForApp(phonePage);
  await phonePage.waitForFunction(() => !document.getElementById('sz-new').disabled);
  await phonePage.locator('#sz-new').tap();
  await phonePage.locator('.dl-wave').first().waitFor({ state: 'visible' });
  await runTempoOnly(phonePage, 'телефон');
  assert.ok(await phonePage.locator('#tomenu').isVisible(), 'телефон: выход ⌂ на полосе');
  await phone.close();

  // 6. Ни ошибок, ни запросов мимо архива.
  assert.deepEqual(errors, [], 'ошибки страницы и консоли');
  assert.deepEqual(stray, [], 'запросы мимо файлов архива и SDK');
  console.log(
    '\n✓ архив площадки: запуск, забег, пауза, «Продолжить», ролик, закрытые двери, облако, тот же забег на другом устройстве, вход и выбор профиля, один язык, темп забега — без ошибок\n',
  );
} finally {
  await browser.close();
  server.close();
}
