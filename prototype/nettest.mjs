#!/usr/bin/env node
/* global document, getComputedStyle, window -- эти имена живут внутри page.evaluate */
/**
 * REFM-204 — сетевая партия настоящим браузером: вход, приказ, обрыв, выход.
 *
 * Зачем. Этапы распила `main.ts` (REFM-205 и дальше) двигают сетевую секцию: в какой
 * партии игрок, его сокет, переподключение, выход в хаб. Решения этой секции покрыты
 * юнит-тестами (`joinGate`, `socketFate`, `reconnectCycle`, `orderRoute`), а ПРОВОДКА —
 * ничем: что ⌂ правда закрывает сокет, что обрыв правда ведёт к дозвону, что приказ
 * правда уходит на сервер. Первый же прогон нашёл на этом пути четыре поломки (разбор —
 * REFM-204 в `docs/backlog.md`): вход по позывному падал целиком, новичку на сервере без
 * аккаунтов раскрывалось поле пароля, ‹ в партии «закрывал» невидимый экран настройки
 * вместо выхода, а обрыв выкидывал на карточку входа (и ⌂ вёл туда же вместо хаба).
 *
 * Как устроен:
 *  1. прото-сервер на свободном порту — в позе прод-образа (гейт действий и замок мест
 *     включены), но без базы и без аккаунтов: вход позывным, мир каждый раз новый;
 *  2. игроцкий клиент `/` — та же сборка и тот же документ с той же CSP, что у игрока;
 *  3. сокеты страницы идут через `page.routeWebSocket`: смоук видит каждое соединение и
 *     каждое сообщение, а обрыв устраивает сам, не трогая сервер;
 *  4. позывной → хаб → обозреватель партий → свой мир → «В бой»: место принято, мир пришёл;
 *  5. приказ из интерфейса (исследование) — сервер принял, ответ вернулся на экран;
 *  6. обрыв посреди партии: игрок остаётся на карте, приказ без связи ложится в очередь,
 *     клиент дозванивается в своё место по билету, и приказ доходит по новому соединению;
 *  7. выход через ‹ (тот же выход, что ⌂ на телефоне) — игрок в хабе, сокет закрыт,
 *     сервер видит уход, нового дозвона нет. Без `netSock.close()` в выходе смоук падает.
 *
 * CSP. Документ отдаётся с настоящей политикой, поэтому смоук видит и её нарушения. Два
 * вида известны и терпятся, остальные валят прогон: атрибуты `style` (политика по хешам
 * их режет — решение о починке за владельцем, смоук печатает их число) и проба `eval`,
 * которой zod выясняет, можно ли ему компилировать схемы (ловит отказ и работает дальше).
 *
 *   node prototype/nettest.mjs     # или pnpm run smoke:net
 */
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';

import { launchBrowser, waitForApp, withDiagnostics } from './harnessKit.mjs';

const NICK = 'SmokeNet';
/** Первая попытка дозвона — через секунду (`reconnectCycle.ts`); ждём втрое дольше. */
const NO_REDIAL_MS = 3000;

// Всегда свежая сборка: смоук стережёт правки `main.ts`, а старая `dist/` проверила бы
// не их. Сборка занимает секунды.
const built = spawnSync(process.execPath, ['prototype/build.mjs'], { stdio: 'inherit' });
if (built.status !== 0) process.exit(built.status ?? 1);

// Поза прод-образа (`deploy/docker-compose.yml`): гейт и замок мест включены. База и
// аккаунты — нет: у CI в окружении стоит `DATABASE_URL` для тестов хранилища, и сервер
// поднял бы на ней прошлые партии, а секрет JWT включил бы вход по паролю.
const env = { ...process.env, PORT: '0', HOST: '127.0.0.1', GATE: '1', SEAT_LOCK: '1' };
delete env.DATABASE_URL;
delete env.AUTH_JWT_SECRET;
const server = spawn(process.execPath, ['prototype/netserver.mjs'], {
  env,
  stdio: ['ignore', 'pipe', 'pipe'],
});
let serverLog = '';
const base = await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error(`сервер не поднялся:\n${serverLog}`)), 60_000);
  const read = (chunk) => {
    serverLog = (serverLog + chunk).slice(-20_000);
    const m = /game\s*:\s*(http:\/\/[^\s/]+)\//.exec(serverLog);
    if (m) {
      clearTimeout(timer);
      resolve(m[1]);
    }
  };
  server.stdout.on('data', read);
  server.stderr.on('data', read);
  server.on('exit', (code) => reject(new Error(`сервер вышел с кодом ${code}:\n${serverLog}`)));
});
const stopServer = () => server.exitCode === null && server.kill();
process.on('exit', stopServer);

const json = async (path) => (await fetch(base + path)).json();
const health = () => json('/metrics/health');

/** Ждать условия (в том числе асинхронного) — с понятной ошибкой вместо таймаута. */
async function until(what, check, timeout = 15_000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`не дождался: ${what}`);
}

const browser = await launchBrowser();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.setDefaultTimeout(20_000);
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(e.message));
// Отчёты CSP браузер пишет в консоль как ошибки; разбираем их по событиям нарушения
// (там есть директива), а в консоли оставляем всё остальное. Отчёт узнаём по имени
// политики, а не по началу фразы: она меняется от версии к версии Chromium
// («Refused to apply…» у одной, «Applying inline style violates…» у той, что стоит в CI).
const consoleErrors = [];
page.on('console', (m) => {
  if (m.type() === 'error' && !m.text().includes('Content Security Policy'))
    consoleErrors.push(m.text());
});
/** Нарушения CSP за весь прогон, через все документы (вход в партию — навигация). */
const cspSeen = [];
await page.exposeFunction('__cspReport', (v) => cspSeen.push(v));
await page.addInitScript(() => {
  document.addEventListener('securitypolicyviolation', (e) =>
    window.__cspReport(`${e.effectiveDirective} ${e.blockedURI}`),
  );
});

/**
 * Каждое соединение страницы с сервером: адрес, что ушло, что пришло, кто закрыл.
 * `hold` — «сервер недоступен»: новое соединение закрывается, не доходя до сервера.
 */
const links = [];
let hold = false;
const parse = (m) => {
  try {
    return JSON.parse(String(m));
  } catch {
    return { type: '?' };
  }
};
await page.routeWebSocket(/\/matches\//, (ws) => {
  const link = { url: ws.url(), sent: [], got: [], closedByPage: false, ws, server: null };
  links.push(link);
  if (hold) {
    link.refused = true;
    ws.close({ code: 1013, reason: 'smoke: сервер недоступен' });
    return;
  }
  const server = (link.server = ws.connectToServer());
  ws.onMessage((m) => {
    link.sent.push(parse(m));
    server.send(m);
  });
  server.onMessage((m) => {
    link.got.push(parse(m));
    ws.send(m);
  });
  ws.onClose((code, reason) => {
    link.closedByPage = true;
    server.close({ code, reason });
  });
  server.onClose((code, reason) => ws.close({ code, reason }));
});
const live = () => links.filter((l) => !l.refused);
const welcomeOf = (link) => link?.got.find((m) => m.type === 'welcome');
const envelopes = (link) => link.sent.filter((m) => m.type === 'action.v1');
// Отказ приходит только тому, чей приказ отвергнут, — счётчики сервера для этого не годятся:
// в них и приказы ботов, которые занимают свободные места партии.
const rejections = () => links.flatMap((l) => l.got.filter((m) => m.type === 'rejection'));
/** Как показан экран подключения (он же карточка входа и обозреватель партий). */
const overlay = () =>
  page.evaluate(() => getComputedStyle(document.getElementById('connect')).display);

/** Первое доступное исследование в окне технологий — с обходом вкладок. */
async function pickResearch() {
  const tabs = await page.$$eval('.tt-tab[data-ttab]', (els) => els.map((e) => e.dataset.ttab));
  for (const tab of [null, ...tabs]) {
    if (tab) await page.click(`.tt-tab[data-ttab="${tab}"]`);
    const take = page.locator('.tt-take:not([disabled])').first();
    if (await take.count()) return { take, tech: await take.getAttribute('data-go') };
  }
  throw new Error('в окне технологий нечего исследовать — стартовых ресурсов не хватает');
}
/** Исследование идёт на экране — значит, ответ сервера вернулся в клиент. */
const researching = (tech) =>
  page.locator(`.tt-item.st-res[data-tech="${tech}"]`).waitFor({ state: 'attached' });

try {
  await withDiagnostics(page, 'nettest', async () => {
    // --- вход позывным и заход в партию -------------------------------------------------
    await page.goto(base + '/');
    await waitForApp(page);
    if (!(await page.locator('#cwnick').isVisible())) await page.click('#clogin');
    await page.fill('#cwnick', NICK);
    await page.click('#cwgo');
    await page.locator('#hub').waitFor({ state: 'visible' });
    // Сервер без аккаунтов: пароль новичку не раскрывают. Смотрим, что поставил клиент, а не
    // что видно: видно сейчас и лишнее — CSP режет статичные `style="display:none"`.
    assert.notEqual(
      await page.$eval('#cwpassrow', (e) => e.style.display),
      'flex',
      'в режиме позывных поле пароля не раскрыто',
    );
    await page.click('#hub-play');
    await page.locator('#mlist .mrow .mbtn').first().click();
    await page.locator('#setup').waitFor({ state: 'visible' });
    // Совет учёных открывается сам и уже собран по умолчанию — подтверждаем как есть.
    if (await page.locator('#scipick.show').isVisible()) await page.click('#sp-go');
    const free = await page.$$eval('#setup-home-id option', (os) =>
      os.filter((o) => o.value && !o.disabled).map((o) => o.value),
    );
    assert(free.length > 0, 'в партии есть свободный мир');
    if (await page.locator('#setup-home-id').isVisible())
      await page.selectOption('#setup-home-id', free[0]);
    else await page.locator(`[data-cand="${free[0]}"]`).first().click();
    await Promise.all([page.waitForURL(/\/game\//), page.click('#setupgo')]);
    await until('впуск в партию', async () => (await overlay()) === 'none');

    const first = live()[0];
    const welcome = welcomeOf(first);
    assert(welcome, 'сервер прислал приветственный снимок');
    assert.equal(welcome.gated, true, 'гейт включён — клиент обязан слать конверты');
    assert(welcome.seatTicket, 'первый вход под замком мест выдаёт билет');
    const mine = Object.values(welcome.state.planets).filter((p) => p.owner === welcome.playerId);
    assert(mine.length > 0, `мир пришёл: у ${welcome.playerId} есть свои узлы`);
    const seats = await json(`/matches/${welcome.matchId}/seats`);
    const seat = seats.seats.find((x) => x.playerId === welcome.playerId);
    assert(seat?.taken, `место ${welcome.playerId} занято на сервере`);
    assert.equal(await page.textContent('#tbname'), NICK, 'в шапке наш позывной');
    assert.equal((await health()).players.connected, 1, 'сервер видит одно подключение');
    console.log(`✓ вход: ${NICK} сел на ${welcome.playerId}, своих узлов ${mine.length}`);

    // --- приказ из интерфейса -----------------------------------------------------------
    await page.click('#holo-tech');
    // Первое открытие окна показывает карточку-вводную (ONB-3) поверх него — «Понятно».
    if (await page.locator('#intro.show').isVisible()) await page.click('#intro .in-ok');
    const order1 = await pickResearch();
    await order1.take.click();
    await researching(order1.tech);
    assert.equal(envelopes(first).length, 1, 'приказ ушёл одним конвертом гейта');
    assert.deepEqual(rejections(), [], 'сервер приказ не отверг');
    console.log(`✓ приказ: исследование ${order1.tech} принято сервером и идёт на экране`);

    // --- обрыв посреди партии -----------------------------------------------------------
    const before = await health();
    hold = true; // «сервер недоступен»: попытки дозвона отбиваются, пока не отпустим
    first.server.close({ code: 1001, reason: 'smoke: обрыв' });
    first.ws.close({ code: 1001, reason: 'smoke: обрыв' });
    await page.locator('#banner').waitFor({ state: 'visible' }); // «переподключаюсь…»
    assert.equal(await overlay(), 'none', 'обрыв не выкидывает из партии на экран входа');
    await until('сервер увидел обрыв', async () => (await health()).players.connected === 0);
    // Приказ без связи клиент кладёт в очередь (NETA2-5) — он обязан уйти после дозвона.
    const order2 = await pickResearch();
    await order2.take.click();
    hold = false;
    await until('клиент дозвонился', () => live().length === 2 && welcomeOf(live()[1]), 20_000);
    const second = live()[1];
    assert.match(second.url, /[?&]ticket=/, 'дозвон предъявляет билет места');
    assert.equal(welcomeOf(second).playerId, welcome.playerId, 'дозвон вернул в то же место');
    await researching(order2.tech);
    await page.locator('#banner').waitFor({ state: 'hidden' });
    assert.equal(envelopes(second).length, 1, 'отложенный приказ ушёл по новому соединению');
    const after = await health();
    assert.equal(after.players.connected, 1, 'после дозвона снова одно подключение');
    assert.equal(after.players.joins, before.players.joins + 1, 'сервер посчитал дозвон');
    console.log(
      `✓ обрыв: игрок на карте, дозвон в ${welcome.playerId} по билету, ` +
        `отложенный приказ ${order2.tech} доставлен`,
    );

    // --- выход в хаб --------------------------------------------------------------------
    // ‹ сперва закрывает открытый слой (окно технологий), следующим нажатием выходит.
    const linksBeforeExit = links.length;
    for (let i = 0; i < 4 && !(await page.locator('#hub').isVisible()); i++) {
      assert.equal(await overlay(), 'none', `после ${i} нажатий ‹ партию закрыл экран подключения`);
      await page.click('#holo-back');
      await page.waitForTimeout(200);
    }
    await page.locator('#hub').waitFor({ state: 'visible' });
    await until('страница закрыла сокет', () => second.closedByPage, 5000);
    await until('сервер увидел уход', async () => (await health()).players.connected === 0);
    await page.waitForTimeout(NO_REDIAL_MS);
    assert.equal(links.length, linksBeforeExit, 'после выхода нет попыток дозвона');
    assert(await page.locator('#hub').isVisible(), 'игрок остался в хабе');
    assert.equal(await overlay(), 'none', 'поверх хаба не легла карточка входа');
    console.log('✓ выход: игрок в хабе, сокет закрыт, сервер видит уход, дозвона нет');

    // --- чистота прогона ----------------------------------------------------------------
    assert.deepEqual(rejections(), [], 'сервер не отверг ни одного нашего приказа');
    assert.deepEqual(pageErrors, [], 'страница не выбросила исключений');
    assert.deepEqual(consoleErrors, [], 'в консоли нет ошибок');
    const styleAttrs = cspSeen.filter((v) => v === 'style-src-attr inline').length;
    const unknown = cspSeen.filter((v) => v !== 'style-src-attr inline' && v !== 'script-src eval');
    assert.deepEqual(unknown, [], 'других нарушений CSP нет');
    if (styleAttrs > 0)
      console.log(`· CSP отрезала атрибутов style: ${styleAttrs} (известно, ждёт решения)`);
  });
  console.log('\n✓ net smoke: вход позывным, приказ, обрыв с дозвоном и очередью, выход в хаб\n');
} finally {
  await browser.close();
  stopServer();
}
