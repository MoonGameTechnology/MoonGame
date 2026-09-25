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

/** «☰ Ещё» есть только на телефоне: на ПК и планшете инструменты — постоянная колонка
 *  иконок слева (заказ владельца 2026-09-25), открывать нечего. */
/** Выход из партии путём игрока: на телефоне — «Выход» в «☰», на ПК и планшете — «‹» в углу
 *  (дубль «Выхода» из колонки инструментов убран, заказ владельца 2026-09-25). «‹» сначала
 *  закрывает открытое окно, поэтому жмём, пока партия не закроется. */
async function exitMatch() {
  const exit = page.locator('#rail-exit');
  if (await exit.isVisible()) return exit.click();
  const back = page.locator('#holo-back');
  // «‹» есть и вне партии — жмём, пока не открылся хаб или меню Sector Zero.
  const out = async () => (await page.locator('#hub').isVisible()) || (await page.locator('#sector-zero').isVisible());
  for (let i = 0; i < 6 && !(await out()); i++) {
    await back.click();
    await page.waitForTimeout(150);
  }
}

async function toggleTools() {
  const toggle = page.locator('#railtoggle');
  if (await toggle.isVisible()) await toggle.click();
}

const hooks = `window.__szTest = {
  run: () => isSectorZeroRun(),
  home: () => Object.values(s.planets).find(p => p.owner === ME && p.kind === 'planet')?.id ?? null,
  // Id всех узлов карты — для проверки, что игрок их не видит (SZ-map-ids).
  places: () => Object.keys(s.planets),
  // Дом на экране и подсказка первого боя (YAG-7.2): закрывает ли одно другое.
  homeOnScreen: () => { const h = pickHome(Object.values(s.planets), ME); return h ? world(h.position) : null; },
  // Выбор мира так же, как его делает \`jumpTo\` (переход по ссылке): сама карточка —
  // предмет проверки, а не попадание мышью по карте, где камера у Sector Zero близко к дому.
  select: id => { selPlanet = id; selFleet = null; selFleets = new Set(); lastPanelHtml = ''; renderPanel(); },
  selected: () => selPlanet,
  // Вкладка карточки мира — как тап по ней; живые наземные части гарнизона мира.
  tab: (x) => { planetTab = x; lastPanelHtml = ''; renderPanel(); },
  ground: (id) => s.planets[id].garrison.filter((st) => st.count > 0 && data.units[st.unit]?.domain === 'ground').length,
  // Открыт ли слой, который закроет Escape/Back.
  layerOpen: () => topLayerOpen(),
  // Подготовка карты закончилась: пока она идёт, Escape — это «уйти, пока карта готовится».
  prepared: () => inMatch() && mapWasEntered && !mapPreparation.active,
  // Захват Роем провинции игрока — тем же путём событий, что в игре (handleEvents).
  farthestWorld: () => {
    const home = Object.values(s.planets).find((p) => p.owner === ME && p.kind === 'planet');
    const far = Object.values(s.planets)
      .filter((p) => p.kind === 'planet' && p.id !== home?.id)
      .sort((a, b) => Math.hypot(b.position.x - home.position.x, b.position.y - home.position.y) - Math.hypot(a.position.x - home.position.x, a.position.y - home.position.y))[0];
    return far?.id ?? null;
  },
  give: (id) => { s.planets[id].owner = ME; },
  capture: (id) => {
    const owner = s.pve.npcPlayerId;
    s.planets[id].owner = owner;
    handleEvents([{ type: 'planet.captured', payload: { planetId: id, owner } }]);
    return owner;
  },
  knownOwner: (id) => knownOwner(id),
  identified: (id) => known(id),
  // Меню каста флагмана и что герой носит — меню обязано быть из надетого.
  casts: () => chainAbilitiesFor(['sector-zero:flagship']).map((a) => a.id),
  worn: () => Object.values(s.heroes ?? {}).find((h) => h.owner === ME)?.equipped ?? null,
  // Бой с пиратами до конца — промоткой часов, как их двигает игра (apply(advance)).
  pirateFight: () => playerOrder(moveFleet(ME, 'p1_1', 'pirate_den')),
  skip: (min) => { apply(advance(s, s.time + min * 60000)); },
  battles: () => Object.keys(s.battles).length,
  // Карточка корабля флота Роя: портрет — форма Роя с листа владельца, а не корпус людей.
  swarmCard: (unit) => {
    const f = JSON.parse(JSON.stringify(Object.values(s.fleets).find((x) => x.owner === ME)));
    s.fleets.__swarm = { ...f, id: '__swarm', owner: s.pve.npcPlayerId, units: [{ unit, count: 1 }], movement: null };
    openShipCard('__swarm', 0);
    delete s.fleets.__swarm;
    const img = document.querySelector('#codex .ship-art img');
    return { art: document.querySelector('#codex .ship-art')?.getAttribute('data-ship-art') ?? null, loaded: !!img && img.complete && img.naturalWidth > 0 };
  },
  // PVR-6.24: набор корабля героя на флагмане экспедиции.
  flagship: () => s.fleets['sector-zero:flagship']?.units?.[0]?.modules ?? null,
  // YAG-7.3: с кем я в войне, строки ленты о смене стойки с ними и реплики от них в треде.
  atWar: () => Object.keys(s.players).filter((id) => id !== ME && getStance(s, ME, id) === 'war'),
  warLines: () => {
    const foes = Object.keys(s.players).filter((id) => id !== ME && getStance(s, ME, id) === 'war');
    return eventLog.map((e) => e.text).filter((text) => foes.some((id) => text.startsWith(\`\${NAME[id]} → \`)));
  },
  warReplies: () => {
    const foes = Object.keys(s.players).filter((id) => id !== ME && getStance(s, ME, id) === 'war');
    return sessionMessages.filter((m) => m.sys && foes.includes(m.from)).length;
  },
  // Конец забега победой — как его ставит модуль победы ядра.
  end: () => { s.pve.waveNumber = s.pve.totalWaves; s.match.status = 'ended'; s.match.winner = 'p1'; s.match.winners = ['p1']; s.match.endedAt = s.time; },
  // Счёт уничтоженных игроком (PveState.tally, PVR-6.20) — чтобы итоги показали их плату.
  kills: (n) => { s.pve.tally = { ...(s.pve.tally ?? {}), p1: { lost: s.pve.tally?.p1?.lost ?? 0, destroyed: n } }; },
  // Комиксы глав: арт владельца ещё не приехал — робот подкладывает свой реестр.
  comics: registry => { comicArt.registry = registry; },
  comicsSeen: () => sectorProgress.comicsSeen,
  // Суверены на профиле и казна матча — для покупки пакета снабжения.
  sov: n => saveSectorProgress({ ...sectorProgress, sovereigns: n }),
  res: r => s.players[ME]?.resources?.[r] ?? 0,
  // Журнал аналитики веб-площадки (YAG-5.1): что игра отдала бы приёмнику.
  events: () => platform.events ?? [],
  // Весь флот игрока погиб — флоты уходят из мира, как после проигранного боя.
  sink: () => { for (const f of Object.values(s.fleets)) if (f.owner === ME) delete s.fleets[f.id]; selFleet = null; selFleets = new Set(); },
  ended: () => s.match.status === 'ended',
  // Учебный полигон (TRN): какая карта открыта и выведен ли герой игрока.
  mapId: () => s.mapId ?? null,
  heroAlive: () => Object.values(s.heroes ?? {}).some((h) => h.owner === ME && h.alive),
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
// Технологии на ПК — вкладка сверху (`holo-tech`), дубль в колонке убран.
const KEPT = ['rail-diplo', 'holo-tech', 'rail-help'];

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
  // Экран подготовки появляется кадром ПОЗЖЕ входа: «#maploading скрыт» бывает правдой ещё до
  // него, и Escape из проверки ниже попадал в «уйти, пока карта готовится».
  await page.waitForFunction(() => window.__szTest.prepared());
  await page.locator('#maploading').waitFor({ state: 'hidden' });
  // ▶▶▶ — только дев-забега: ни в обычном забеге, ни в схватке её нет.
  assert.equal(await page.locator('#spd-dev').isVisible(), false, `${label}: ▶▶▶ нет`);

  await toggleTools();
  for (const id of ABSENT)
    assert.equal(await page.locator('#' + id).isVisible(), !run, `${label}: #${id}`);
  for (const id of KEPT)
    assert(await page.locator('#' + id).isVisible(), `${label}: #${id} на месте`);
  await toggleTools();
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
    // Гарнизон — плитками, как состав флота (заказ владельца 2026-09-25): у каждой наземной
    // части подпись, полоска и числа корпуса «осталось/всего».
    await page.evaluate(() => window.__szTest.tab('ground'));
    const ground = await page.evaluate((id) => window.__szTest.ground(id), home);
    assert(ground > 0, `${label}: на домашнем мире есть наземный гарнизон`);
    const hp = await page.locator('#side .ptile .pt-hpn').allTextContents();
    assert.equal(hp.length, ground, `${label}: плитка с числами на каждую наземную часть`);
    for (const x of hp) assert.match(x, /^[\d.]+k?\/[\d.]+k?$/, `${label}: числа корпуса на плитке`);
    assert.equal(await page.locator('#side .ptile .pt-n').count(), ground, `${label}: подпись наземной плитки`);
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
  // Escape закрывает открытое — а если открытого нет, выводит из партии. На старте схватки
  // выбор успевает сброситься установкой матча; прежде это маскировали клики по «☰ Ещё»,
  // которого на ПК больше нет (заказ владельца 2026-09-25), — жмём, только если есть что закрыть.
  if (await page.evaluate(() => window.__szTest.layerOpen())) await page.keyboard.press('Escape');

  await page.locator('#purse [data-res="metal"]').click();
  assert.equal(
    await page.locator('.rc-market').count(),
    run ? 0 : 1,
    `${label}: рынок из карточки`,
  );
  await page.locator('.rc-close').click();
}

/** Выход в меню путём игрока на десктопе: «Выход» в колонке инструментов. */
async function leave() {
  await toggleTools();
  await exitMatch();
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
    // Кольцо задачи нажимается (заказ владельца 2026-09-25): под картой — сама задача.
    await page.locator('#sz-map-body .target-hit').first().click({ force: true });
    assert.ok((await page.locator('#sz-map-task .sz-map-task-row').count()) > 0, 'тап по кольцу показывает задачу');
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
    // Кошелёк прилипает к верху вместе с вкладками (замечание владельца 2026-09-25): внизу
    // длинного списка запас валют виден рядом с ценой.
    await page.evaluate(() => { const el = document.getElementById('sector-zero'); el.scrollTop = el.scrollHeight; });
    const purse = await page.locator('#sz-workshop .sz-purse').boundingBox();
    assert.ok(purse && purse.y >= 0 && purse.y + purse.height <= 800, `кошелёк на экране после прокрутки (y=${purse?.y})`);
    await page.evaluate(() => { document.getElementById('sector-zero').scrollTop = 0; });
    // Корабли (решения владельца 2026-09-25): фрегат — в первом ряду «Корабли», а у
    // выбранного корпуса нет карточек модулей, которые на него не встают.
    const firstRow = page.locator('#sz-workshop .sz-hulls').first();
    assert.equal(await firstRow.locator('[data-prep="hull"][data-id="frigate"]').count(), 1, 'фрегат в ряду «Корабли»');
    const radars = '#sz-workshop .sz-cards [data-id="radar_module"], #sz-workshop .sz-cards [data-id="compact_radar"]';
    assert.equal(await page.locator(radars).count(), 0, 'у крейсера нет радаров разведчика и дозорного фрегата');
    await page.locator('[data-prep="hull"][data-id="scout"]').click();
    assert.equal(await page.locator('#sz-workshop .sz-cards [data-id="compact_radar"]').count(), 1, 'у разведчика его радар на месте');
    // Мастерская живёт в «Кораблях» (решение владельца 2026-09-25): вкладки нет, а у открытого
    // модуля в карточке своя кнопка улучшения.
    assert.equal(await page.locator('[data-prep="tab"][data-id="workshop"]').count(), 0, 'вкладки «Мастерская» нет');
    assert.equal(await page.locator('#sz-workshop .sz-cards .sz-upgrade [data-prep="forge"][data-id="cargo_bay"]').count(), 1, 'улучшение — в карточке открытого модуля');
    // Корабль героя (PVR-6.24): своя плитка в ряду «Корабли», модуль встаёт на него.
    await page.locator('[data-prep="hero-ship"]').click();
    await page.locator('[data-prep="fit-hero"][data-id="cargo_bay"]').click();
    assert.equal(await page.locator('[data-prep="fit-hero"][data-id="cargo_bay"].selected').count(), 1, 'модуль встал на корабль героя');
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
    // YAG-7.2: первый забег открывается на 1024×576 — это 16:9 минус 20 %, методика п. 1.10.
    await page.setViewportSize({ width: 1024, height: 576 });
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
    // Воронка обучения (YAG-5.1): бой с пиратами главы I — первый шаг уходит на старте.
    await page.waitForFunction(() =>
      window.__szTest.events().some((e) => e.event === 'onboarding_step' && e.props.step === 'approach'),
    );
    // Подсказка первого боя встала слева; дом и значки его флотов — не под ней.
    await page.locator('#pirate-intro').waitFor({ state: 'visible' });
    const intro = await page.locator('#pirate-intro').boundingBox();
    const home = await page.evaluate(() => window.__szTest.homeOnScreen());
    assert.ok(
      home.x > intro.x + intro.width + 60 || home.y > intro.y + intro.height + 60,
      `YAG-7.2: дом (${Math.round(home.x)},${Math.round(home.y)}) не под подсказкой первого боя`,
    );
    await page.setViewportSize({ width: 1280, height: 800 });
    await check('Sector Zero', true);
    // YAG-7.3: Рой объявляет войну на старте штурма, а в ленте забега об этом строки нет —
    // «Экспедиция начата — Рой уже идёт» говорит то же. Реплика в треде дипломатии остаётся.
    await page.waitForFunction(() => window.__szTest.atWar().length > 0);
    assert.deepEqual(await page.evaluate(() => window.__szTest.warLines()), [], 'YAG-7.3: строки войны в ленте нет');
    assert.ok((await page.evaluate(() => window.__szTest.warReplies())) > 0, 'YAG-7.3: реплика в треде на месте');
    // Захват Роем провинции игрока (замечание владельца 2026-09-25): после вспышки мир
    // уходит в туман, и карта обязана помнить НОВОГО владельца, а не прежнего.
    const far = await page.evaluate(() => window.__szTest.farthestWorld());
    await page.evaluate((id) => window.__szTest.give(id), far);
    await page.waitForFunction((id) => window.__szTest.identified(id) && window.__szTest.knownOwner(id) === 'p1', far);
    const taker = await page.evaluate((id) => window.__szTest.capture(id), far);
    await page.waitForFunction((id) => !window.__szTest.identified(id), far);
    assert.equal(await page.evaluate((id) => window.__szTest.knownOwner(id), far), taker, 'захваченная Роем провинция — цвета Роя, а не игрока');
    // Меню приказов предлагает только надетые навыки героя (замечание владельца 2026-09-25):
    // у командира открыто четыре способности, надета одна.
    const casts = await page.evaluate(() => window.__szTest.casts());
    const worn = await page.evaluate(() => window.__szTest.worn());
    assert.ok(worn && worn.length > 0 && casts.every((id) => worn.includes(id)), `в меню каста только надетое: ${casts} ⊆ ${worn}`);
    assert.ok(casts.length < 4, 'ненадетых способностей в меню нет');
    // Лист «Рой» владельца (2026-09-25): крейсер Роя в карточке — Охотник, картинка грузится.
    const hunter = await page.evaluate(() => window.__szTest.swarmCard('cruiser'));
    await page.waitForFunction(() => document.querySelector('#codex .ship-art img')?.complete);
    assert.equal(hunter.art, 'swarmHunter', 'карточка корабля Роя — форма Роя');
    assert.ok(await page.evaluate(() => document.querySelector('#codex .ship-art img').naturalWidth > 0), 'портрет Роя загружен');
    await page.locator('#codex .cx-close').click();
    assert.deepEqual(await page.evaluate(() => window.__szTest.flagship()), ['cargo_bay'], 'PVR-6.24: флагман вышел с набором корабля героя');

    // Окно боя держит итог до закрытия (решение владельца 2026-09-25): бой у планеты при
    // осаде длится раунд-два, и окно пустело сразу после открытия.
    await page.evaluate(() => window.__szTest.pirateFight());
    for (let i = 0; i < 200 && !(await page.evaluate(() => window.__szTest.battles())); i++)
      await page.evaluate(() => window.__szTest.skip(5));
    await page.locator('#battlewin').waitFor({ state: 'visible' });
    for (let i = 0; i < 200 && (await page.evaluate(() => window.__szTest.battles())); i++)
      await page.evaluate(() => window.__szTest.skip(5));
    await page.locator('#battlewinbody .bw-ended').waitFor({ state: 'visible' });
    assert.ok(await page.locator('#battlewinbody .bw-who').count() > 0, 'после боя окно держит снимок сторон');
    await page.locator('#battlewin .tw-close').click();

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
    await page.evaluate(() => window.__szTest.kills(7));
    await page.evaluate(() => window.__szTest.end());
    await page.locator('#endscreen .es-run').waitFor({ state: 'visible' });
    // Победа — комикс главы поверх итогов, в первый раз; «Пропустить» открывает итоги.
    await page.locator('#comic').waitFor({ state: 'visible' });
    assert.match(await page.locator('#comic-next').textContent(), /Дальше|Next/);
    await page.locator('#comic-skip').click();
    await page.locator('#comic').waitFor({ state: 'hidden' });
    assert.deepEqual(await page.evaluate(() => window.__szTest.comicsSeen()), ['pve-1:intro', 'pve-2:intro', 'pve-2:outro']);
    assert.equal(await page.locator('#endscreen .es-run li.task').count(), 3, 'три задачи главы II');
    // Каждый уничтоженный враг — Варрант (решение владельца 2026-09-25), своей строкой.
    assert.match(await page.locator('#endscreen .es-run li.kills').textContent(), /7.*\+7 ⌖/, 'уничтоженные — строкой итогов');
    // ×2 к награде за ролик — прямо на итогах (YAG-3.2, решение владельца 2026-09-24).
    // Дев-сборка симулирует рекламу: ролик «досмотрен», удвоение приходит сразу.
    const beforeDouble = await page.evaluate(() => JSON.parse(localStorage.getItem('sector-zero.progress.v1')));
    await page.locator('#endscreen [data-es="double"]').click();
    await page.locator('#endscreen .es-note').waitFor({ state: 'visible' });
    await page.waitForFunction(
      (before) => JSON.parse(localStorage.getItem('sector-zero.progress.v1')).research === before.research + before.lastReward,
      beforeDouble,
    );
    // ×2 удваивает и Варранты за уничтоженных: приходит вся сумма Варрантов забега.
    assert.equal(
      (await page.evaluate(() => JSON.parse(localStorage.getItem('sector-zero.progress.v1')))).warrants,
      beforeDouble.warrants + beforeDouble.lastRun.warrants,
      '×2 — все Варранты забега, с уничтоженными',
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
    // PVR-6.29 (решение владельца 2026-09-25): кораблей не осталось — карточка «Флот потерян»
    // вместо минут у экрана, где Рой штурмует планету. «Отстроиться» оставляет забег; та же
    // карточка — кнопкой колонки в любой момент, и «Завершить» сразу ставит поражение с итогами.
    await page.evaluate(() => window.__szTest.sink());
    await page.locator('#abandon').waitFor({ state: 'visible' });
    assert.match(await page.locator('#abandon-title').textContent(), /Флот потерян|Fleet lost/);
    assert.match(await page.locator('#abandon-stay').textContent(), /Отстроиться|Rebuild/);
    await page.locator('#abandon-stay').click();
    await page.locator('#abandon').waitFor({ state: 'hidden' });
    assert.equal(await page.evaluate(() => window.__szTest.ended()), false, '«Отстроиться» — забег идёт');
    await toggleTools();
    await page.locator('#rail-abandon').click();
    assert.match(await page.locator('#abandon-title').textContent(), /Завершить экспедицию\?|End the expedition\?/);
    await page.locator('#abandon-go').click();
    await page.locator('#endscreen .es-run').waitFor({ state: 'visible' });
    const failed = (await page.evaluate(() => window.__szTest.events())).filter((e) => e.event === 'pve_failed');
    assert.equal(failed.length, 1, 'сдача — проигранная попытка');
    await page.locator('#endscreen [data-es="menu"]').click();
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

    // 6. Учебный полигон (TRN-1): кнопка «Обучение» открывает свою карту, игрок выходит с
    //    героем экспедиции, а учебный противник — враг с первой минуты (аудит механик AUDM).
    await leave();
    await page.locator('#sector-zero').waitFor({ state: 'visible' });
    await page.locator('#sz-training').click();
    await page.waitForFunction(() => window.__szTest.mapId() === 'training-1');
    await page.locator('#maploading').waitFor({ state: 'hidden' });
    assert(await page.evaluate(() => window.__szTest.heroAlive()), 'полигон: герой экспедиции выведен');
    assert.deepEqual(await page.evaluate(() => window.__szTest.atWar()), ['p2'], 'полигон: противник — враг сразу');
  });
  console.log(
    '\n✓ Sector Zero: чат, почта, маркеры, корпорация, рынок и «Сон» спрятаны; в схватке — на месте;' +
      ' комиксы глав — до первого забега и после победы, один раз, с пропуском; портреты Академии загружены;' +
      ' аналитика забега — сессия, старт, один исход, открытия, шаг обучения;' +
      ' «+» у Суверенов даёт ролик прямо в забеге; пакет снабжения за 5 ◆ — из карточки ресурса; итог забега — по частям, ×2 за ролик прямо на итогах, глава повторяется с итогов и отмечена пройденной;' +
      ' без флота — карточка «Отстроиться / Завершить экспедицию», сдача ставит поражение с итогами; гарнизон мира — плитками с подписью, полоской и числами корпуса; карта главы показывает накопленную разведку; в дев-забеге есть ▶▶▶; время забега — реальные минуты;' +
      ' «Обучение» открывает полигон с героем и объявленным противником\n',
  );
} finally {
  await browser.close();
  await site.close();
}
