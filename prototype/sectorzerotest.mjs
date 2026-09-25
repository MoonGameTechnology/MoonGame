#!/usr/bin/env node
/* global window, document, getComputedStyle, localStorage -- эти имена живут внутри page.evaluate */
/**
 * PVR-6.1 — в забеге Sector Zero нет инструментов мультиплеера, а в остальной игре они на месте.
 *
 * Правило (`decisions/sectorZeroTools.ts`) покрыто юнит-тестом, но тот отвечает лишь за
 * список. Здесь вопрос другой — «что игрок видит»: кнопки рельса, «Пинг» в карточке мира и
 * ссылка на рынок из карточки ресурса. Каждая проверка идёт ПАРОЙ: в обычной схватке то же
 * самое обязано быть видно — иначе «кнопки нет» прошло бы и тогда, когда селектор просто
 * устарел. Третий прогон — выход из забега в обычную партию на той же странице: кнопки
 * обязаны вернуться. Попутно — PVR-6.8: меню и кольцо цели на карте главы анимированы, а при
 * reduced motion замирают;
 * PVR-6.9: маршрут глав выбирает главу, а закрытый узел — нет.
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
import { SECTOR_ZERO_ABSENT_HUD, SECTOR_ZERO_ABSENT_TOOLS } from '../decisions/sectorZeroTools.ts';

const hooks = `window.__szTest = {
  run: () => isSectorZeroRun(),
  home: () => Object.values(s.planets).find(p => p.owner === ME && p.kind === 'planet')?.id ?? null,
  // Id всех узлов карты — для проверки, что игрок их не видит (SZ-map-ids).
  places: () => Object.keys(s.planets),
  // Выбор мира так же, как его делает \`jumpTo\` (переход по ссылке): сама карточка —
  // предмет проверки, а не попадание мышью по карте, где камера у Sector Zero близко к дому.
  select: id => { selPlanet = id; selFleet = null; selFleets = new Set(); lastPanelHtml = ''; renderPanel(); },
  selected: () => selPlanet,
  // Конец забега победой — как его ставит модуль победы ядра.
  end: () => { s.pve.waveNumber = s.pve.totalWaves; s.match.status = 'ended'; s.match.winner = 'p1'; s.match.winners = ['p1']; s.match.endedAt = s.time; },
  // Комиксы глав: арт владельца ещё не приехал — робот подкладывает свой реестр.
  comics: registry => { comicArt.registry = registry; },
  comicsSeen: () => sectorProgress.comicsSeen,
  // Суверены на профиле и казна матча — для покупки пакета снабжения.
  sov: n => saveSectorProgress({ ...sectorProgress, sovereigns: n }),
  res: r => s.players[ME]?.resources?.[r] ?? 0,
  // Журнал аналитики веб-площадки (YAG-5.1): что игра отдала бы приёмнику.
  events: () => platform.events ?? [],
};`;

/** Панель тестового комикса и заведомо битая картинка (панель без арта). */
const PANEL =
  'data:image/svg+xml,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1200"><rect width="1600" height="1200" fill="#0b1d27"/><circle cx="800" cy="600" r="320" fill="#1c6f78"/></svg>',
  );
const BROKEN = 'data:image/webp;base64,AAAA';

const ABSENT = Object.values(SECTOR_ZERO_ABSENT_TOOLS);
/** Поля шапки, которых в забеге нет: эмблема с названием и местом, очки победы, день. */
const ABSENT_HUD = Object.values(SECTOR_ZERO_ABSENT_HUD);
const KEPT = ['rail-diplo', 'rail-tech', 'rail-help'];

// Страница Sector Zero — со своим бандлом и симуляцией рекламы, как настоящая дев-сборка:
// без неё ×2 на итогах не появился бы вовсе.
const sz = await instrumentedGame(hooks, { page: 'sector-zero-dev.html', simulate: true });
const site = await serve({
  ...(await instrumentedGame(hooks)),
  '/sz': sz['/'].replace('<script src="/app.js">', '<script src="/sz-app.js">'),
  '/sz-app.js': sz['/app.js'],
});
const browser = await launchBrowser();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.setDefaultTimeout(15000);

/** Всё, что игрок может увидеть, в одном прогоне; `run` — ждём ли мы забег Sector Zero. */
async function check(label, run) {
  // Флаг забега ставится после установки матча — ждём его, а не читаем наперегонки.
  await page.waitForFunction((want) => window.__szTest.run() === want, run);
  await page.locator('#maploading').waitFor({ state: 'hidden' });
  // ▶▶▶ — только дев-забега: ни в обычном забеге, ни в схватке её нет.
  assert.equal(await page.locator('#spd-dev').isVisible(), false, `${label}: ▶▶▶ нет`);

  await page.locator('#railtoggle').click();
  for (const id of ABSENT)
    assert.equal(await page.locator('#' + id).isVisible(), !run, `${label}: #${id}`);
  for (const id of KEPT)
    assert(await page.locator('#' + id).isVisible(), `${label}: #${id} на месте`);
  await page.locator('#railtoggle').click();
  for (const id of ABSENT_HUD)
    assert.equal(await page.locator('#' + id).isVisible(), !run, `${label}: шапка #${id}`);
  assert.equal(await page.locator('#tbwallet').isVisible(), run, `${label}: кошелёк профиля в шапке`);
  // Часы забега (решение владельца 2026-09-24): приток — в минуту, отсчёт волны — «м:сс»
  // реального времени; в схватке — прежние игровые часы.
  const flow = await page.locator('#purse [data-res="metal"] em').first().textContent();
  assert.match(flow, run ? /\/(мин|min)$/ : /\/(ч|h)$/, `${label}: единица притока`);
  if (run) {
    const wave = await page.locator('.dl-wave').first().textContent();
    assert.match(wave, /\d:\d\d/, `${label}: отсчёт волны есть`);
    assert.doesNotMatch(wave, /\d:\d\d:\d\d/, `${label}: отсчёт волны — минуты, а не часы мира`);
  }

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
  if (run) {
    // SZ-map-ids: карточка мира, её сводка (тап по имени), журнал и панели называют места
    // именами провинций. Id узлов глав — английские слова (`home_a`, `drift`): на русском
    // экране забега их быть не должно.
    await page.locator('#side [data-act="planetinfo"]').first().click();
    const raw = await page.evaluate(() => {
      const words = new Set(document.body.innerText.split(/[^\w-]+/));
      return window.__szTest.places().filter((id) => words.has(id));
    });
    assert.deepEqual(raw, [], `${label}: сырые id мест на экране`);
  }
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
    // PVR-6.9: маршрут глав — шесть узлов до эпицентра; закрытый узел показывает карточку,
    // но главу не меняет, играбельный — выбирает.
    assert.equal(await page.locator('#sz-route .sz-node').count(), 6, 'путь во всю кампанию');
    await page.locator('#sz-route [data-lost]').first().click({ force: true });
    assert.equal(await page.locator('#sz-route [aria-pressed="true"]').getAttribute('data-mission'), '0');
    assert.notEqual(await page.locator('#sz-chapter-stats').textContent(), null);
    await page.locator('#sz-mission-1').click();
    assert.equal(await page.locator('#sz-mission-1').getAttribute('aria-pressed'), 'true');
    // Выбор главы открывает её карту справа: клетка на каждый из 24 секторов главы II,
    // до первого забега известен только старт.
    await page.locator('#sz-map-panel').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#sz-map-body polygon').count(), 24, 'мозаика главы II');
    // Активная цель задачи живёт (волна-сонар и бегущий пунктир) и замирает при reduced motion.
    const ringMotion = () =>
      page.evaluate(() =>
        ['.target.active', '.target-ping'].map(
          (sel) => getComputedStyle(document.querySelector(`#sz-map-body ${sel}`)).animationName,
        ),
      );
    assert.deepEqual(
      await ringMotion(),
      ['sz-target-run, sz-target-pulse', 'sz-target-ping'],
      'цель задачи анимирована',
    );
    await page.emulateMedia({ reducedMotion: 'reduce' });
    assert.deepEqual(await ringMotion(), ['none', 'none'], 'reduced motion — цель в покое');
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    const scoutedBefore = await page.locator('#sz-map-body polygon.known').count();
    assert.match(await page.locator('#sz-chapter-stats').textContent(), /3/, 'задачи главы II');
    // Герой-награда главы виден ДО забега: силуэт «?» и имя того, кто придёт за победу.
    const reward = page.locator('#sz-chapter-hero');
    assert.equal(await reward.isVisible(), true, 'у главы II есть герой-награда');
    assert.equal(await reward.locator('.sz-hero-sil').textContent(), '?', 'герой ещё не пришёл');
    // Меню без повторов (замечание владельца 2026-09-24): «Одиночная игра» — один раз, в
    // надзаголовке; подписи сохранения без сохранённого забега нет.
    // Считается ТЕКСТ, который видит игрок, а не ключи разметки: подпись могла бы
    // получить те же слова и из кода.
    const singlePlayer = () =>
      page.evaluate(
        () =>
          [...document.querySelectorAll('#sector-zero *')].filter(
            (e) =>
              e.children.length === 0 &&
              e.getClientRects().length > 0 &&
              /^(Одиночная игра|Single player)$/i.test((e.textContent ?? '').trim()),
          ).length,
      );
    assert.equal(await singlePlayer(), 1, '«Одиночная игра» в меню — один раз');
    // Академия: у каждого героя живое лицо, а не битая картинка. Портрет вне атласа
    // (черновик Учёного, PVR-6.16) однофайловая сборка встраивает data-URL'ом с кавычками
    // SVG, и неэкранированная кавычка обрывала `src` — строковые проверки этого не видят.
    await page.locator('#sz-prep').click();
    await page.locator('[data-prep="tab"][data-id="heroes"]').click();
    const faces = '#sz-workshop .hero-portrait img';
    await page.waitForFunction((sel) => [...document.querySelectorAll(sel)].every((i) => i.complete), faces);
    const broken = await page.evaluate(
      (sel) =>
        [...document.querySelectorAll(sel)]
          .filter((i) => i.naturalWidth === 0)
          .map((i) => i.closest('[data-id]')?.getAttribute('data-id') ?? '?'),
      faces,
    );
    assert.deepEqual(broken, [], 'портреты героев в Академии загрузились');
    assert.ok((await page.locator(faces).count()) >= 5, 'пять героев в ростере');
    await page.locator('[data-prep="back"]').click();
    await page.locator('#sz-mission-0').click();
    // Комикс главы (решение владельца 2026-09-24): перед первым забегом главы, один раз.
    // Вторая панель — битая картинка: подписи остаются на тёмном фоне, игра не встаёт.
    await page.evaluate(
      (r) => window.__szTest.comics(r),
      {
        'pve-1': {
          intro: [
            { image: PANEL, captions: ['pve.pirates.approach'] },
            { image: BROKEN, captions: ['pve.pirates.travel'] },
            { image: PANEL },
          ],
        },
      },
    );
    await page.locator('#sz-new').click();
    await page.locator('#comic').waitFor({ state: 'visible' });
    assert.equal(await page.evaluate(() => window.__szTest.run()), false, 'комикс идёт ДО забега');
    assert.equal(await page.locator('#comic-count').textContent(), '1 / 3');
    assert.notEqual((await page.locator('#comic-caption').textContent()).trim(), '', 'подпись — текст локали');
    await page.locator('#comic-next').click();
    await page.waitForFunction(() => document.getElementById('comic').classList.contains('no-art'));
    assert.notEqual((await page.locator('#comic-caption').textContent()).trim(), '', 'без арта подпись на месте');
    await page.locator('#comic-next').click();
    assert.match(await page.locator('#comic-next').textContent(), /В бой|To battle/, 'последняя панель ведёт в бой');
    await page.locator('#comic-next').click();
    await page.locator('#comic').waitFor({ state: 'hidden' });
    assert.deepEqual(await page.evaluate(() => window.__szTest.comicsSeen()), ['pve-1:intro']);
    await check('Sector Zero', true);
    // Воронка обучения (YAG-5.1): бой с пиратами главы I — первый шаг уходит на старте.
    await page.waitForFunction(() =>
      window.__szTest.events().some((e) => e.event === 'onboarding_step' && e.props.step === 'approach'),
    );

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
    assert.equal(await page.locator('#sz-save-label').isVisible(), true, 'сохранённый забег подписан');
    assert.equal(await singlePlayer(), 1, '«Одиночная игра» — один раз и при сохранённом забеге');
    await page.locator('#sz-continue').click();
    await check('Sector Zero из хаба (продолжение)', true);
    // Вкладка полосы навигации — подписью кнопки, а не заголовком окна заглавными.
    assert.match((await page.locator('#holo-tech').textContent())?.trim() ?? '', /^(Технологии|Technologies)$/);
    await leave(); // выход из забега ведёт в меню Sector Zero, оттуда — в хаб
    await page.locator('#sz-back').click();
    await enterSkirmish(page, { fromWelcome: false });
    await check('схватка после забега', false);

    // 4. PVR-5.3/5.4: обычный конец забега засчитывает главу С её задачами и показывает
    // разбивку, а выигранная глава получает отметку на маршруте.
    await page.goto(site.url + '/sz');
    await waitForApp(page);
    await page.waitForFunction(() => !document.getElementById('sz-new').disabled);
    await page.locator('#sz-mission-1').click();
    await page.evaluate(
      (r) => window.__szTest.comics(r),
      { 'pve-2': { intro: [{ image: PANEL }], outro: [{ image: PANEL, captions: ['pve.pirates.won'] }, { image: PANEL }] } },
    );
    await page.locator('#sz-new').click();
    if (await page.locator('#sz-replace').isVisible()) await page.locator('#sz-replace').click();
    // «назад» и Escape закрывают комикс, как «Пропустить», — и забег стартует.
    await page.locator('#comic').waitFor({ state: 'visible' });
    await page.keyboard.press('Escape');
    await page.locator('#comic').waitFor({ state: 'hidden' });
    await page.waitForFunction(() => window.__szTest.run() === true);
    await page.locator('#maploading').waitFor({ state: 'hidden' });
    // «+» у Суверенов в шапке забега (`run.sovereigns`, решение владельца 2026-09-24): сам
    // «+» ролик не зовёт, он раскрывает кнопку, на которой сказано, что будет реклама и что
    // придёт; ролик — по ней. Дев-сборка симулирует рекламу, порция приходит сразу.
    const progress = () => page.evaluate(() => JSON.parse(localStorage.getItem('sector-zero.progress.v1')));
    const beforeAd = await progress();
    await page.locator('#tbwallet [data-wallet="more"]').click();
    assert.equal((await progress()).sovereigns, beforeAd.sovereigns, '«+» сам ролик не зовёт');
    await page.locator('#tbwallet [data-wallet="watch"]').click();
    await page.waitForFunction(
      (before) => JSON.parse(localStorage.getItem('sector-zero.progress.v1')).sovereigns === before.sovereigns + 2,
      beforeAd,
    );
    await page.locator('#tbwallet .tw-sovereigns', { hasText: String(beforeAd.sovereigns + 2) }).waitFor();
    // Пакет снабжения за 5 ◆ (решение владельца 2026-09-24) — из карточки ресурса: пакет
    // приходит в казну матча, цена списывается с профиля, остаток покупок убывает.
    await page.evaluate(() => window.__szTest.sov(10));
    const metalBefore = await page.evaluate(() => window.__szTest.res('metal'));
    await page.locator('#purse [data-res="metal"]').click();
    await page.locator('#rescard [data-rc-supply]').click();
    await page.waitForFunction((b) => window.__szTest.res('metal') >= b + 150, metalBefore);
    assert.equal((await progress()).sovereigns, 5, 'пакет стоит 5 ◆');
    assert.match(await page.locator('#rescard .rc-note').textContent(), /2/, 'осталось 2 из 3');
    await page.locator('#rescard .rc-close').click();
    await page.evaluate(() => window.__szTest.end());
    await page.locator('#endscreen .es-run').waitFor({ state: 'visible' });
    // Победа — комикс главы поверх итогов, в первый раз; «Пропустить» открывает итоги.
    await page.locator('#comic').waitFor({ state: 'visible' });
    assert.match(await page.locator('#comic-next').textContent(), /Дальше|Next/);
    await page.locator('#comic-skip').click();
    await page.locator('#comic').waitFor({ state: 'hidden' });
    assert.deepEqual(await page.evaluate(() => window.__szTest.comicsSeen()), ['pve-1:intro', 'pve-2:intro', 'pve-2:outro']);
    assert.equal(await page.locator('#endscreen .es-run li.task').count(), 3, 'три задачи главы II');
    // ×2 к награде за ролик — прямо на итогах (YAG-3.2, решение владельца 2026-09-24).
    // Дев-сборка симулирует рекламу: ролик «досмотрен», удвоение приходит сразу.
    const beforeDouble = await page.evaluate(() => JSON.parse(localStorage.getItem('sector-zero.progress.v1')));
    await page.locator('#endscreen [data-es="double"]').click();
    await page.locator('#endscreen .es-note').waitFor({ state: 'visible' });
    await page.waitForFunction(
      (before) => JSON.parse(localStorage.getItem('sector-zero.progress.v1')).research === before.research + before.lastReward,
      beforeDouble,
    );
    assert.equal(await page.locator('#endscreen [data-es="double"]').count(), 0, 'удвоение одно на забег — кнопка ушла');
    // «Сыграть главу снова» запускает новую попытку ТОЙ ЖЕ главы — её родной мир `landing`.
    const attempt = await page.evaluate(() => JSON.parse(localStorage.getItem('sector-zero.progress.v1')).nextAttempt);
    await page.locator('#endscreen [data-es="replay"]').click();
    await page.waitForFunction(
      (before) =>
        window.__szTest.run() === true &&
        window.__szTest.home() === 'landing' &&
        JSON.parse(localStorage.getItem('sector-zero.progress.v1')).nextAttempt === before + 1,
      attempt,
    );
    await page.locator('#maploading').waitFor({ state: 'hidden' });
    assert.equal(await page.locator('#comic').isVisible(), false, 'комикс главы — один раз на профиль');
    // Аналитика забега (YAG-5.1) на этой загрузке страницы: одна сессия, по старту на
    // попытку, исход ровно один (конец забега tickRunSave видит каждый кадр), открытие
    // главы, реклама из шапки и с итогов — через одну дверь.
    const events = await page.evaluate(() => window.__szTest.events());
    const named = (name) => events.filter((e) => e.event === name);
    assert.deepEqual(named('session_started').map((e) => e.props), [{ entry: 'sector-zero' }]);
    assert.deepEqual(named('pve_started').map((e) => e.props.chapter), ['pve-2', 'pve-2'], 'новый забег и повтор');
    assert.equal(named('pve_completed').length, 1, 'исход попытки — один раз');
    assert.equal(named('pve_completed')[0].props.chapter, 'pve-2');
    assert.equal(named('pve_failed').length, 0);
    assert(named('meta_unlock').some((e) => e.props.kind === 'chapter' && e.props.id === 'pve-2'), 'глава открыта');
    assert.deepEqual(
      named('rewarded_ad_completed').map((e) => e.props.placement),
      ['run.sovereigns', 'run.double'],
    );
    await leave();
    await page.waitForFunction(() => document.getElementById('sz-mission-1').classList.contains('sz-passed'));
    // Засчитанный забег добавил разведку главы: на её карте опознанного стало больше.
    await page.locator('#sz-mission-1').click();
    await page.locator('#sz-map-panel').waitFor({ state: 'visible' });
    assert(
      (await page.locator('#sz-map-body polygon.known').count()) > scoutedBefore,
      'разведка забега попала на карту главы',
    );

    // 5. Дев-забег (заказ владельца 2026-09-24): в полосе скорости есть ▶▶▶, и она включается.
    await page.locator('#sz-map-close').click();
    await page.locator('#sz-dev').click();
    await page.waitForFunction(() => window.__szTest.run() === true);
    await page.locator('#maploading').waitFor({ state: 'hidden' });
    await page.locator('#spd-dev').click();
    assert(await page.locator('#spd-dev.on').isVisible(), 'дев-забег: ▶▶▶ включает свой темп');
    assert(await page.locator('#spd-pause').isVisible(), 'пауза — в полосе скорости');
    // Дев-забег не пишет профиль — и попыткой для аналитики он тоже не считается.
    const devEvents = await page.evaluate(() => window.__szTest.events());
    assert.equal(devEvents.filter((e) => e.event === 'pve_started').length, 2, 'дев-забег — не попытка');
  });
  console.log(
    '\n✓ Sector Zero: чат, почта, маркеры, корпорация, рынок и «Сон» спрятаны; в схватке — на месте;' +
      ' комиксы глав — до первого забега и после победы, один раз, с пропуском; портреты Академии загружены;' +
      ' аналитика забега — сессия, старт, один исход, открытия, шаг обучения;' +
      ' «+» у Суверенов даёт ролик прямо в забеге; пакет снабжения за 5 ◆ — из карточки ресурса; итог забега — по частям, ×2 за ролик прямо на итогах, глава повторяется с итогов и отмечена пройденной;' +
      ' карта главы показывает накопленную разведку; в дев-забеге есть ▶▶▶; время забега — реальные минуты\n',
  );
} finally {
  await browser.close();
  await site.close();
}
