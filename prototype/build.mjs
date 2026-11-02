// Bundles the prototype into self-contained HTML files you can open straight
// from disk (no server). Run: node prototype/build.mjs
// Two artifacts from one source (the `__PLAYER_BUILD__` define, see main.ts):
//   dist/void-dominion.html        — dev client, today's full behavior;
//   dist/void-dominion-player.html — player client: test mode, single-player skirmish
//     and time-acceleration controls are compiled out of the JS, and the matching
//     markup (fenced with <!--dev-only--> … <!--/dev-only--> below) is stripped.
import { build } from 'esbuild';
import QRCode from 'qrcode';
import { createHash } from 'node:crypto';
import { writeFileSync, mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { basename } from 'node:path';
import { platformBuildOptions, platformLocaleFiles } from './platformBuild.mjs';
import { cursorCss, heatPointers } from './cursors.mjs';
import { GAME_SHEETS, gameSheet } from './gameSheets.mjs';

// One persistent site link for the hub's download button and its offline-rendered QR.
const androidDistribution = JSON.parse(readFileSync(new URL('../mobile/distribution.json', import.meta.url), 'utf8'));
const androidDownloadUrl = `${androidDistribution.origin}${androidDistribution.basePath}/player/latest.apk`;
const androidQr = (await QRCode.toString(androidDownloadUrl, { type: 'svg', errorCorrectionLevel: 'M', margin: 4 }))
  .replace('<svg ', '<svg aria-hidden="true" focusable="false" ');

// A native button keeps keyboard activation and never submits the password form.
const passwordToggle = (
  id,
) => `<button id="${id}-visibility" class="cpass-toggle" type="button" aria-controls="${id}" data-i18n-aria="auth.password.show" data-i18n-title="auth.password.show">
  <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/><path class="cpass-slash" d="m3 3 18 18"/></svg>
</button>`;

const holographicCss = readFileSync(new URL('./holographic.css', import.meta.url), 'utf8');
const bridgeShellCss = readFileSync(new URL('./bridge-shell.css', import.meta.url), 'utf8');
const mobileConsoleCss = readFileSync(new URL('./mobile-console.css', import.meta.url), 'utf8');
const heroCardsCss = readFileSync(new URL('./hero-cards.css', import.meta.url), 'utf8');
const shipArtCss = readFileSync(new URL('./ship-art.css', import.meta.url), 'utf8');
const mobileStrategyCss = readFileSync(new URL('./mobile-strategy.css', import.meta.url), 'utf8');
const sectorZeroCss = readFileSync(new URL('./sector-zero.css', import.meta.url), 'utf8');
const corpFacilitiesCss = readFileSync(new URL('./corp-facilities.css', import.meta.url), 'utf8');
const profileCss = readFileSync(new URL('./profile.css', import.meta.url), 'utf8');
const corpBattlesCss = readFileSync(new URL('./corp-battles.css', import.meta.url), 'utf8');

/** Отдельный поток расчёта соло-мира (`simWorker.ts`) — свой файл рядом со страницей: политика
 *  CSP сервера и сайта пускает только поток со своего origin (`decisions/simWorker.ts`). Имя
 *  несёт хеш содержимого: страница и поток одной сборки не разъедутся, а сервер держит файл в
 *  кэше год (`/assets/`). Однофайловая дев-сборка несёт ещё и исходник строкой — её
 *  открывают с диска, а с `file://` поток из файла не поднимается. */
const simWorkerSource = (
  await build({
    entryPoints: ['prototype/src/simWorker.ts'],
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: 'es2020',
    minify: true,
    legalComments: 'none',
    write: false,
    define: { __PLAYER_BUILD__: 'false', __SECTOR_ZERO_ONLY__: 'false' },
  })
).outputFiles[0].text;

const simWorkerFile = `sim-worker-${createHash('sha256').update(simWorkerSource).digest('hex').slice(0, 10)}.js`;

/** `workerUrl` — адрес файла потока для этой страницы; `inlineWorker` — нести и исходник. */
const bundleOptions = (playerBuild, workerUrl = simWorkerFile, inlineWorker = !playerBuild) => ({
  entryPoints: ['prototype/src/bootstrap.ts'],
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: 'es2020',
  loader: { '.webp': 'dataurl', '.svg': 'dataurl' },
  minify: true,
  legalComments: 'none',
  write: false,
  define: {
    __PLAYER_BUILD__: String(playerBuild),
    __SECTOR_ZERO_ONLY__: 'false',
    __SIM_WORKER_URL__: JSON.stringify(workerUrl),
    ...(inlineWorker ? { __SIM_WORKER_SRC__: JSON.stringify(simWorkerSource) } : {}),
  },
});

const bundle = async (playerBuild) => (await build(bundleOptions(playerBuild))).outputFiles[0].text;

/**
 * Клиент для СЕРВЕРА (`dist/served/`): тот же бандл, но картинки — отдельными файлами в
 * `assets/` с хешем в имени, а не base64 внутри HTML. Однофайловый документ сервер отдаёт
 * с `no-store`, и игрок перекачивал 16 МБ арта при каждом открытии; файл с хешем в имени
 * браузер держит год (`/assets/:file` в `wsServer.ts`). Путь АБСОЛЮТНЫЙ: тот же документ
 * открывается и на `/game/<id>`, где относительный `assets/…` ушёл бы в `/game/assets/…`.
 * Поток расчёта лежит там же (`assets/sim-worker-…js`), исходника строкой документ не несёт.
 * Однофайловые сборки остаются как были: их открывают с диска и кладут в APK.
 */
const bundleServed = async (playerBuild) => {
  const res = await build({
    ...bundleOptions(playerBuild, `/assets/${simWorkerFile}`, false),
    loader: { '.webp': 'file', '.svg': 'file' },
    assetNames: 'assets/[name]-[hash]',
    entryNames: playerBuild ? 'player' : 'dev',
    outdir: 'prototype/dist/served',
    publicPath: '/',
  });
  const js = res.outputFiles.find((f) => f.path.endsWith('.js'));
  const assets = res.outputFiles.filter((f) => f !== js);
  return { js: js.text, assets };
};

/** Платформенная цель (`YAG-1.1b`, `YAG-1.1c`): настройки — в `platformBuild.mjs`, общие со
 *  сторожем описи архива. */
const bundlePlatform = async () => (await build(platformBuildOptions)).outputFiles;

/** Пульт администратора (ADM-1) — свой вход, без `__PLAYER_BUILD__`: этой странице
 *  нечего вырезать, она и так не знает про игру ничего. */
const bundleAdmin = async () => {
  const res = await build({
    entryPoints: ['prototype/src/admin.ts'],
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: 'es2020',
    minify: true,
    legalComments: 'none',
    write: false,
  });
  return res.outputFiles[0].text;
};

// --- Tactical command-console chrome (DEFCON vibe): vector/wireframe, neon
// --- glow, minimalist HUD on near-black, text in one sans font. Responsive.
/** Стили игры (SLIM-2): листы `prototype/styles/` в порядке каскада, его задаёт номер в имени.
 *  Профиль и два листа корпорации встают перед арсеналом, где стояли всегда. */
const rootSheets = `${profileCss}\n${corpBattlesCss}\n${corpFacilitiesCss}\n`;
const css = `\n${GAME_SHEETS.map(
  (name) => (name === '07-arsenal-shop-corp.css' ? rootSheets : '') + gameSheet(name),
).join('')}`;

/** Все листы одной строкой: платформенная цель пишет их файлом, остальные — инлайном. */
const allCss = () =>
  `${cursorCss()}\n${heatPointers(
    `${css}\n${holographicCss}\n${bridgeShellCss}\n${mobileConsoleCss}\n${shipArtCss}\n${heroCardsCss}\n${mobileStrategyCss}\n${sectorZeroCss}`,
  )}`;

/**
 * Лоадер SDK площадки — ДОСЛОВНО как в документации (требование 1.19.1).
 *
 * Путь ОТНОСИТЕЛЬНЫЙ: это вариант «архив загружен через Консоль разработчика», который
 * площадка и рекомендует; абсолютный `https://sdk.games.s3.yandex.net/sdk.js` нужен
 * только при интеграции через свой домен. Модерация смотрит версию лоадера индикатором
 * на debug-панели: `IT` — верно, `IF` — старый. Поэтому тег не «примерно такой», а
 * ровно такой, и сторож `buildTarget.test.mjs` сверяет его по готовому артефакту.
 *
 * `initSDK()` намеренно ничего не инициализирует: и `YaGames.init()`, и фолбэк, и
 * обработка отказа живут в `bootstrap.ts` (`platform/host.ts`). Тег лишь будит хост,
 * если тот уже ждёт, — `<script async>` может доехать и позже игры.
 */
const SDK_LOADER = `<!-- Yandex Games SDK -->
<script async src="/sdk.js" onload="initSDK()"></script>
<script>function initSDK(){window.dispatchEvent(new Event('ya-sdk-ready'));}</script>`;

const page = (js, entry = 'void-dominion', external = false) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<style>html{background:#02080e}</style>
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<link rel="icon" href="data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="6" fill="#061318"/><rect x="9" y="9" width="14" height="14" rx="2" transform="rotate(45 16 16)" fill="none" stroke="#35d6e6" stroke-width="2.5"/></svg>')}">
<title>${entry === 'sector-zero' ? 'Sector Zero' : 'Void Dominion — Sector Command'}</title>${external ? `${SDK_LOADER}\n<link rel="stylesheet" href="assets/app.css">` : `<style>${allCss()}</style>`}</head>
<body data-entry="${entry}" class="app-booting">
<section id="startup-error" hidden role="alert" aria-labelledby="startup-title">
  <h1 id="startup-title" data-i18n="startup.failed.title"></h1>
  <p data-i18n="startup.failed.body"></p>
  <code id="startup-code"></code>
  <button id="startup-retry" type="button" data-i18n="startup.retry"></button>
</section>
<div id="dev-badge" data-i18n="dev-notice.badge"></div>
<dialog id="dev-notice" aria-labelledby="dev-notice-title" aria-describedby="dev-notice-body">
  <h2 id="dev-notice-title" data-i18n="dev-notice.title"></h2>
  <p id="dev-notice-body" data-i18n="dev-notice.body"></p>
  <button id="dev-notice-ack" type="button" data-i18n="dev-notice.ack"></button>
</dialog>
<canvas id="map" tabindex="-1"></canvas>
<section id="comic" role="dialog" aria-modal="true" tabindex="-1" data-i18n-aria="sector-zero.comic.title">
  <button id="comic-skip" type="button" data-i18n="sector-zero.comic.skip"></button>
  <figure class="comic-panel">
    <img id="comic-img" alt="" decoding="async">
    <figcaption id="comic-caption" aria-live="polite"></figcaption>
  </figure>
  <div class="comic-foot"><span id="comic-count" aria-hidden="true"></span><button id="comic-next" type="button"></button></div>
</section>
<section id="maploading" role="dialog" aria-modal="true" aria-labelledby="maploading-title">
  <div class="ml-content">
    <h1 id="maploading-title" data-i18n="map-loading.title"></h1>
    <blockquote id="maploading-quote"></blockquote>
    <div class="ml-work">
      <div class="ml-status"><span id="maploading-status" role="status" aria-live="polite"></span><span id="maploading-percent" aria-hidden="true"></span></div>
      <progress id="maploading-progress" max="1" value="0" aria-labelledby="maploading-title maploading-status"></progress>
      <button id="maploading-cancel" data-i18n="map-loading.cancel"></button>
    </div>
  </div>
</section>
<button id="holo-back" class="holo-back" type="button" data-i18n-title="hud.main-menu" data-i18n-aria="hud.main-menu">‹</button>
<header id="top">
  <div class="tbar">
    <button id="topback" data-i18n-title="hud.back.title" type="button">‹</button>
    <div class="crest" id="tbcrest">
      <button id="crestmark" data-i18n-title="hud.crest.title" type="button">◆</button>
      <div class="who"><b id="tbname"></b><span id="tbplace"></span></div>
    </div>
    <span id="tbscore" class="dstat"></span>
    <div id="tbwallet" class="tbwallet" hidden></div>
    <div id="daycard"><b id="tbday"></b><span id="tbeta"></span><span id="tbetacap" data-i18n="hud.next-day.cap"></span></div>
  </div>
  <div id="purse"></div>
</header>
<nav class="holo-nav" data-i18n-aria="hud.map"><button id="holo-tech" type="button" data-i18n="rail.tech.title"></button><button id="holo-constructor" type="button" data-i18n="rail.constructor.label"></button></nav>
<div id="devline"><span id="devline-head"></span><span id="devline-status"></span></div>
<!-- панель задач забега: открывается чипом «Задачи» на строке статуса (missionView.ts) -->
<div id="missionpanel" role="dialog" data-i18n-aria="hud.missions.title" hidden></div>
<!-- slim left rail: only the wired tools (each opens its window). More icons land here as
     features get wired. -->
<div id="solo-replace" role="dialog" aria-modal="true" aria-labelledby="solo-replace-title">
  <div class="solo-box"><h2 id="solo-replace-title" data-i18n="solo.save.replace.title"></h2>
  <p data-i18n="solo.save.replace.body"></p>
  <button id="solo-replace-cancel" type="button" data-i18n="solo.save.replace.cancel"></button>
  <button id="solo-replace-confirm" type="button" data-i18n="solo.save.replace.confirm"></button></div>
</div>
<nav id="rail">
  <div id="railtools">
    <!-- Досье Роя — там, где на телефоне у панели нет места в строке статуса (заказ владельца
         2026-09-24); показывается в PvE-партии, пока досье не приколото справа -->
    <button id="rail-dossier" type="button" style="display:none">☣<span class="rlbl" data-i18n="swarm.intel.title"></span></button>
    <button id="rail-diplo">⬡<span class="rlbl" data-i18n="rail.diplo.title"></span></button>
    <button id="rail-msgs">✉<span class="rlbl" data-i18n="rail.msgs.title"></span><b id="msgbadge" class="railbadge" style="display:none"></b></button>
    <button id="rail-coal">⛨<span class="rlbl" data-i18n="rail.coal.title"></span></button>
    <button id="rail-pings" data-i18n-title="rail.pings.title">📍<span class="rlbl" data-i18n="rail.pings.label"></span></button>
    <button id="rail-tech" data-i18n-title="rail.tech.title">⚛<span class="rlbl" data-i18n="rail.tech.label"></span></button>
    <button id="rail-constructor" data-i18n-title="rail.constructor.title">⚒<span class="rlbl" data-i18n="rail.constructor.label"></span></button>
    <button id="rail-steward" data-i18n-title="rail.steward.title">😴<span class="rlbl" data-i18n="steward.name"></span></button>
    <button id="rail-market">⇄<span class="rlbl" data-i18n="rail.market.label"></span></button>
    <!-- Торговец экспедиции («живой курс»): только в забеге с торговцем, видимость — кадр main.ts -->
    <button id="rail-trader" type="button" data-i18n-title="rail.trader.title" style="display:none">⚖<span class="rlbl" data-i18n="rail.trader.label"></span></button>
    <button id="rail-chat" class="desk-only">🗨<span class="rlbl" data-i18n="rail.chat.label"></span></button>
    <button id="rail-log">≡<span class="rlbl" data-i18n="rail.log.label"></span><span class="badge" id="alertbadge" style="display:none">0</span></button>
    <button id="rail-help">?<span class="rlbl" data-i18n="rail.help.title"></span></button>
    <button id="rail-settings">⚙<span class="rlbl" data-i18n="rail.settings.label"></span></button>
    <!-- «Завершить экспедицию» (PVR-6.29): только пока идёт забег, видимость — кадр main.ts -->
    <button id="rail-abandon" type="button" style="display:none">⚑<span class="rlbl" data-i18n="rail.abandon.title"></span></button>
    <button id="rail-exit" data-i18n-title="rail.exit.title">⌂<span class="rlbl" data-i18n="speed.exit"></span></button>
  </div>
  <button id="railtoggle" data-i18n-title="rail.toggle.title" type="button" aria-expanded="false"><span id="railglyph">☰</span><span class="holo-more" data-i18n="hud.tools"></span><span class="badge" id="railalert" style="display:none">0</span></button>
</nav>
<!-- floating chat window (desktop only) — content rendered by renderChat() in main.ts -->
<div id="chatwin" class="desk-only"></div>
<div id="logwin"><div class="lwbox"><div class="lw-head"><b data-i18n="win.log.title"></b><button class="lw-recap" id="lw-recap" type="button" data-i18n-title="win.log.recap">🛰</button><button class="lw-close btn-x">✕</button></div><div id="log-pending"></div><div id="log"></div></div></div>
<!-- technologies window — content rendered by renderTech() in main.ts -->
<div id="tech"><div class="twbox"><div class="lw-head"><b data-i18n="win.tech.title"></b><button class="tw-close btn-x" data-i18n-aria="card.close">✕</button></div><div id="techbody"></div></div></div>
<div id="buildwin"><div class="twbox"><div class="lw-head"><b data-i18n="win.build.title"></b><button class="tw-close btn-x" data-i18n-aria="card.close">✕</button></div><div id="buildwinbody"></div></div></div>
<!-- steward («Хранитель») window — content rendered by renderSteward() in main.ts -->
<div id="steward"><div class="twbox"><div class="lw-head"><b data-i18n="win.steward.title"></b><button class="tw-close btn-x" data-i18n-aria="card.close">✕</button></div><div id="stewardbody"></div></div></div>
<!-- окно боя: открывается тапом по значку боя на карте (battleScreen.ts) -->
<div id="battlewin"><div class="twbox"><div class="lw-head"><div id="battlewinhead" class="bw-hd"><b data-i18n="battle.win.head"></b></div><button class="tw-close btn-x" data-i18n-aria="card.close">✕</button></div><div id="battlewinbody"></div></div></div>
<!-- heroes: the roster/штаб now lives INSIDE the «Производство» screen (Герои pane) -->
<!-- scientist council picker (setup-time, before the start-point) — rendered by renderSciPick() -->
<div id="scipick"><div class="twbox"><div class="lw-head"><b data-i18n="win.scipick.title"></b><button class="sp-cancel" type="button" data-i18n="win.scipick.close"></button></div><div id="scipickbody"></div></div></div>
<!-- усиление между волнами (PVR-1.4) — рендерится renderBoonPick() в main.ts -->
<!-- язычок досье Роя у правого края: панель выезжает справа, язычок — её ручка (заказ владельца 2026-09-24) -->
<button id="swarm-tab" type="button" data-i18n-title="swarm.intel.title" data-i18n-aria="swarm.intel.title" hidden><i aria-hidden="true">☣</i><span data-i18n="swarm.intel.tab"></span></button>
<div id="swarm-dossier" role="dialog" aria-modal="true" aria-labelledby="swarm-dossier-title"><div class="twbox"><div class="lw-head"><button id="swarm-dossier-fold" class="sd-fold" type="button" aria-expanded="true" aria-controls="swarm-dossier-body"><b id="swarm-dossier-title" data-i18n="swarm.intel.title"></b><span id="swarm-dossier-badge" class="sd-badge"></span><span class="sd-chev" aria-hidden="true"></span></button><span class="swarm-sync" aria-hidden="true" data-i18n="swarm.intel.updated"></span><button id="swarm-dossier-close" class="sp-cancel" type="button" data-i18n="swarm.intel.close"></button></div><div id="swarm-dossier-body"></div></div></div>
<!-- division template designer (H4, Stellaris-style) — rendered by renderDivDesign() -->
<!-- session market — whole box rendered by renderMarket() in main.ts -->
<div id="market"></div>
<div id="trader"></div>
<!-- Связь с союзником главы IV (PVR-7.5): окно открывает чип «⬡ Союзник» строки статуса -->
<div id="ally"></div>
<!-- constructor («Производство») — unified order screen; whole box rendered by renderConstructor() -->
<div id="constructor"></div>
<aside id="side"></aside>
<div id="toasts"></div>
<div id="speedbar" class="spd">
  <!-- time controls. PC: shown only via the developer «speed control» toggle (whole
       bar hidden otherwise); ⌂/▶▶ are PC-hidden (exit lives in the rail). Mobile is
       frozen: keeps ⌂/▶▶ and the legacy ×1/×10/×50/×100 chips; PC swaps in ×1/×1800/×3600/×7200
       (data-mult = real wall-clock multiplier: 1800=½h·s, 3600=1h·s, 7200=2h·s). One notation
       «×N» everywhere, N = the real multiplier (UIX-5.2): the PC chips used to read 30×/60×/120×,
       which looked close to the phone's ×100 while running 18–72 times faster. -->
  <span id="spd-ctl"><button id="spd-pause" data-speed="0" data-i18n-title="hud.run.pause" data-i18n-aria="hud.run.pause">‖</button><button id="spd-play" data-speed="1" class="on">▶</button><button id="spd-fast" class="spd-pc-hide" data-speed="3">▶▶</button><!--dev-only--><button id="spd-dev" type="button" data-speed="0" hidden>▶▶▶</button><!--/dev-only--><span class="spddiv"></span><button id="spd-lesson" class="spdmini" data-mult="300" data-i18n-title="speed.mult.lesson" style="display:none">×300</button><span class="spd-mult-legacy"><button class="spdmini" data-mult="1" data-i18n-title="speed.mult.real">×1</button><button class="spdmini" data-mult="10">×10</button><button class="spdmini" data-mult="50">×50</button><button class="spdmini" data-mult="100">×100</button></span><span class="spd-mult-pc"><button class="spdmini" data-mult="1" data-i18n-title="speed.mult.real">×1</button><button class="spdmini" data-mult="1800" data-i18n-title="speed.mult.half-hour">×1800</button><button class="spdmini" data-mult="3600" data-i18n-title="speed.mult.hour">×3600</button><button class="spdmini" data-mult="7200" data-i18n-title="speed.mult.two-hours">×7200</button></span><span class="sep"></span></span>
  <!--dev-only--><span class="sep" id="restart-sep" style="display:none"></span><button id="restart" data-i18n-title="speed.restart" style="display:none">⟳</button><span class="sep"></span><!--/dev-only--><button id="tomenu" class="spd-pc-hide" data-i18n-title="speed.exit">⌂</button>
</div>
<div id="cmdbar"></div>
<div id="codex"></div>
<div id="codexhub"></div>
<div id="intro"></div>
<div id="recap"></div>
<div id="goals"></div>
<aside id="pirate-intro" hidden>
  <b class="pe-title" data-i18n="pve.pirates.title"></b>
  <button type="button" id="pirate-close" class="pe-close btn-x" data-i18n-aria="pve.pirates.hide">×</button>
  <p id="pirate-copy" class="pe-copy" aria-live="polite"></p>
  <button type="button" id="pirate-action" class="pe-action"></button>
</aside>
<div id="playercard"></div>
<div id="rescard"></div>
<div id="profile"></div>
<div id="settings"></div>
<div id="warprompt"></div>
<!-- «Флот потерян» / «Завершить экспедицию?» (PVR-6.29) / «Выйти из экспедиции?» (⌂): заголовок,
     текст и подписи зависят от повода и ставятся из main.ts; правая всегда сдаёт забег, средняя
     («В меню») видна только у ⌂ -->
<div id="abandon" role="dialog" aria-modal="true" aria-labelledby="abandon-title"><div class="wpbox">
  <div class="wp-head" id="abandon-title"></div>
  <div class="wp-body" id="abandon-text"></div>
  <div class="wp-reward" id="abandon-reward" hidden></div>
  <div class="wp-actions"><button type="button" id="abandon-stay" class="wp-no"></button><button type="button" id="abandon-menu" class="wp-no" data-i18n="run.exit.menu" hidden></button><button type="button" id="abandon-go" class="wp-yes" data-i18n="run.abandon.go"></button></div>
</div></div>
<!-- Вопрос о push-уведомлениях (UIX-4.4, pushSetup.ts): после первой спокойной своей новости в сетевой партии -->
<div id="pushask" role="dialog" aria-modal="true" aria-labelledby="pushask-title"><div class="wpbox">
  <div class="wp-head" id="pushask-title" data-i18n="push.ask.title"></div>
  <div class="wp-body" data-i18n="push.ask.text"></div>
  <div class="wp-actions"><button type="button" id="pushask-no" class="wp-no" data-i18n="push.ask.no"></button><button type="button" id="pushask-yes" class="wp-yes" data-i18n="push.ask.yes"></button></div>
</div></div>
<div id="diplo"></div>
<div id="coalwin" role="dialog" data-i18n-aria="coal.win.title"></div>
<div id="pingpop"></div>
<!-- Всплывашка надбавок параметра флота: тап по «Атаке», «Корпусу»… (fleetCard.ts, renderStatPop) -->
<div id="statpop" role="dialog" aria-live="polite"></div>
  <div id="pingpanel"></div>
<div id="tgted"></div>
<div id="objtip"></div>
<div id="splitdlg"></div>
<div id="pingmenu"></div>
<div id="fps"></div>
<div id="banner"></div>
<!-- Отсчёт объявленной контратаки учебного полигона (TRN-3, trainingScenario.ts) -->
<div id="trnraid" role="timer" hidden></div>
<div id="endscreen"></div>
<div id="connect">
  <div class="cwrap">
    <button id="clang" class="clang" type="button"></button>
    <div class="cbox">
      <div id="cwelcome">
        <div class="ccrest">
          <div class="ring"><span class="dia"></span></div>
          <div class="wm">VOID DOMINION</div>
          <div class="wtag" data-i18n="welcome.tagline"></div>
        </div>
        <p class="csub" data-i18n="welcome.sub"></p>
        <button id="cnew" class="cnew btn-main" type="button" data-i18n="welcome.new"></button>
        <div class="cdiv" data-i18n="welcome.divider"></div>
        <div class="csocial">
          <button id="cgoogle" class="csoc" type="button" data-i18n-title="welcome.google" data-i18n-aria="welcome.google">G</button>
          <button id="capple" class="csoc" type="button" data-i18n-title="welcome.apple" data-i18n-aria="welcome.apple"><svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor"><path d="M16.4 12.9c0-2.3 1.9-3.4 2-3.4-1.1-1.6-2.8-1.8-3.4-1.8-1.5-.1-2.8.8-3.5.8s-1.8-.8-3-.8c-1.5 0-2.9.9-3.7 2.3-1.6 2.7-.4 6.8 1.1 9 .7 1.1 1.6 2.3 2.8 2.2 1.1 0 1.5-.7 2.9-.7s1.7.7 2.9.7c1.2 0 2-1.1 2.7-2.1.8-1.2 1.2-2.4 1.2-2.4s-2.3-.9-2.3-3zM14.3 6.3c.6-.8 1-1.8.9-2.9-.9 0-2 .6-2.6 1.3-.6.7-1.1 1.7-.9 2.7 1 .1 2-.5 2.6-1.1z"/></svg></button>
        </div>
        <!-- No single-player entry here: the welcome card is the pre-auth screen, and
             an unauthenticated visitor must not be able to start matches from it. The
             skirmish setup lives behind the login, in the hub. -->
        <div class="cstack">
          <button id="clogin" class="cbtn btn-second" type="button" data-i18n="welcome.login"></button>
        </div>
        <form class="authform" onsubmit="return false">
          <div id="cwlogin" class="cwlogin" style="display:none">
            <input id="cwnick" type="text" autocapitalize="off" autocomplete="username" spellcheck="false" maxlength="24" data-i18n-ph="welcome.nick.ph">
            <button id="cwgo" class="cbtn btn-second" type="button" data-i18n="welcome.go"></button>
          </div>
          <div id="cwpassrow" class="cwlogin password-field" style="display:none">
            <input id="cwpass" type="password" autocomplete="current-password" maxlength="128" data-i18n-ph="welcome.pass.ph">
            ${passwordToggle('cwpass')}
          </div>
        </form>
        <button id="cwrecover" class="clink btn-quiet" type="button" style="display:none" data-i18n="welcome.recover.link"></button>
      </div>
      <div id="cregister" style="display:none">
        <button id="crback" class="cback btn-quiet" type="button" data-i18n="welcome.back"></button>
        <div class="ctitle"><span class="dia"></span><b data-i18n="welcome.register.title"></b></div>
        <p class="csub" data-i18n="welcome.register.sub"></p>
        <form class="authform" onsubmit="return false">
          <label class="cfield"><span data-i18n="welcome.register.nick"></span>
            <input id="crnick" type="text" autocapitalize="off" autocomplete="username" spellcheck="false" maxlength="24" data-i18n-ph="welcome.nick.ph">
          </label>
          <label class="cfield"><span data-i18n="welcome.register.mail"></span>
            <input id="crmail" type="email" autocapitalize="off" autocomplete="email" spellcheck="false" maxlength="254" placeholder="you@mail.com">
            <small data-i18n="auth.email.attachment"></small>
          </label>
          <div class="cfield"><label for="crpass" data-i18n="welcome.register.pass"></label>
            <div class="password-field">
            <input id="crpass" type="password" autocomplete="new-password" minlength="12" maxlength="128" aria-describedby="crpassrule" data-i18n-ph="welcome.pass.min.ph">
              ${passwordToggle('crpass')}
            </div>
          </div>
          <p id="crpassrule" class="csub" data-i18n="acc.pass.rule"></p>
          <div class="cfield"><label for="crpass2" data-i18n="welcome.register.pass2"></label>
            <div class="password-field">
            <input id="crpass2" type="password" autocomplete="new-password" maxlength="128" data-i18n-ph="welcome.pass.again.ph">
              ${passwordToggle('crpass2')}
            </div>
          </div>
        </form>
        <div class="crow">
          <button id="crgo" class="cbtn btn-main" type="button" data-i18n="welcome.register.go"></button>
        </div>
      </div>
      <div id="crecover" style="display:none">
        <button id="crecback" class="cback btn-quiet" type="button" data-i18n="welcome.back"></button>
        <div class="ctitle"><span class="dia"></span><b data-i18n="welcome.recover.title"></b></div>
        <p class="csub" data-i18n="welcome.recover.sub"></p>
        <label class="cfield"><span data-i18n="welcome.recover.mail"></span>
          <input id="crecmail" type="email" autocapitalize="off" autocomplete="email" spellcheck="false" maxlength="254" placeholder="you@mail.com">
        </label>
        <div class="crow">
          <button id="crecgo" class="cbtn btn-main" type="button" data-i18n="welcome.recover.go"></button>
        </div>
      </div>
      <div id="creset" style="display:none">
        <div class="ctitle"><span class="dia"></span><b data-i18n="welcome.reset.title"></b></div>
        <p class="csub" data-i18n="welcome.reset.sub"></p>
        <form class="authform" onsubmit="return false">
          <!-- Hidden username: a password form without one leaves the manager unable to
               tell WHICH account the new password belongs to (Chrome: «Password forms
               should have (optionally hidden) username fields»). Filled from the saved
               callsign at reset time; never submitted anywhere. -->
          <input id="cresetuser" type="text" autocomplete="username" hidden aria-hidden="true" tabindex="-1">
          <div class="cfield"><label for="cresetpass" data-i18n="welcome.reset.pass"></label>
            <div class="password-field">
            <input id="cresetpass" type="password" autocomplete="new-password" minlength="12" maxlength="128" aria-describedby="cresetpassrule" data-i18n-ph="welcome.pass.min.ph">
              ${passwordToggle('cresetpass')}
            </div>
          </div>
          <p id="cresetpassrule" class="csub" data-i18n="acc.pass.rule"></p>
          <div class="cfield"><label for="cresetpass2" data-i18n="welcome.reset.pass2"></label>
            <div class="password-field">
            <input id="cresetpass2" type="password" autocomplete="new-password" maxlength="128" data-i18n-ph="welcome.pass.again.ph">
              ${passwordToggle('cresetpass2')}
            </div>
          </div>
        </form>
        <div class="crow">
          <button id="cresetgo" class="cbtn btn-main" type="button" data-i18n="welcome.reset.go"></button>
        </div>
      </div>
      <div id="cbrowse" style="display:none">
        <div class="mhead">
          <button id="cback" class="cback btn-quiet" type="button" data-i18n="welcome.back"></button>
          <div class="ctitle"><span class="dia"></span><b data-i18n="welcome.browse.title"></b></div>
        </div>
        <!-- Позывной приходит со входа, а не со страницы (UIX-17.1): поле — спрятанный носитель
             состояния, его читают разбор адреса и вход в партию. Пароль спрашивает только карточка входа. -->
        <form class="mcarry" hidden onsubmit="return false">
          <input id="cnick" type="text" autocomplete="off" maxlength="24">
        </form>
        <div class="mtabs">
          <button class="mtab active" type="button" data-tab="available"><span data-i18n="welcome.browse.tab.available"></span><i class="mcount"></i></button>
          <button class="mtab" type="button" data-tab="active"><span data-i18n="welcome.browse.tab.active"></span><i class="mcount"></i></button>
          <button class="mtab" type="button" data-tab="archived"><span data-i18n="welcome.browse.tab.archived"></span><i class="mcount"></i></button>
        </div>
        <div class="mbody">
          <!-- Адрес сервера виден, только когда сервер не ответил (browserFallback.ts, правило 4). -->
          <div id="msrv" class="msrv" style="display:none">
            <b data-i18n="browser.server-down"></b>
            <label class="cfield"><span data-i18n="browser.server-addr"></span>
              <input id="csrv" type="text" inputmode="url" autocapitalize="off" autocomplete="off" spellcheck="false" placeholder="wss://… or ws://host:8788">
            </label>
            <button id="cgo" class="cbtn btn-second" type="button" data-i18n="browser.server-retry"></button>
          </div>
          <div id="mfilter" class="mfilter" style="display:none">
            <div class="mfseg" id="mf-mode" role="group" data-i18n-aria="browser.filter.mode">
              <button class="mfbtn active" type="button" data-mode="all" data-i18n="browser.filter.all"></button>
              <button class="mfbtn" type="button" data-mode="pvp" data-i18n="browser.mode.pvp"></button>
              <button class="mfbtn" type="button" data-mode="pve" data-i18n="browser.mode.pve"></button>
            </div>
            <div class="mfdrop" id="mf-mapbox">
              <button class="mfbtn mfwide" type="button" id="mf-map"></button>
              <div class="mfmenu" id="mf-maps" style="display:none"></div>
            </div>
            <div class="mfplayers" id="mf-players">
              <span class="mflabel" data-i18n="browser.filter.players"></span>
              <span class="mfval" id="mf-range"></span>
              <div class="mfdual" id="mf-dual">
                <input id="mf-min" class="mfrange" type="range" min="0" max="0" value="0" data-i18n-aria="browser.filter.min">
                <input id="mf-max" class="mfrange" type="range" min="0" max="0" value="0" data-i18n-aria="browser.filter.max">
              </div>
            </div>
          </div>
          <!-- Вход по номеру партии (плейтест 2026-10-17): номер диктуют и копируют вместо адреса. -->
          <form id="mnum" class="mnum" style="display:none" onsubmit="return false">
            <input id="mnum-in" type="text" inputmode="numeric" autocomplete="off" spellcheck="false" maxlength="80" data-i18n-ph="browser.number.ph" data-i18n-aria="browser.number.ph">
            <button id="mnum-go" class="mbtn btn-second" type="submit" data-i18n="browser.join"></button>
          </form>
          <div id="mlist" class="mlist"></div>
        </div>
        <div id="match-create" class="mcreate" style="display:none">
          <label for="match-create-map" data-i18n="browser.create"></label>
          <select id="match-create-map" class="inp">
            <option value="duel-1" data-i18n="setup.map.duel-1"></option>
            <option value="ffa-4" data-i18n="setup.map.ffa-4"></option>
            <option value="team-2v2" data-i18n="setup.map.team-2v2"></option>
            <option value="team-3v3" data-i18n="setup.map.team-3v3"></option>
            <option value="ffa-20" data-i18n="setup.map.ffa-20"></option>
            <option value="ffa-50" data-i18n="setup.map.ffa-50"></option>
          </select>
          <button id="match-create-go" type="button" class="mbtn btn-main" data-i18n="browser.create.go"></button>
        </div>
      </div>
      <div id="cstatus" class="cstat" role="status" aria-live="polite" aria-atomic="true"></div>
    </div>
    <button id="cupd" class="cupd" type="button" style="display:none" data-i18n="welcome.update-check"></button>
    <div id="cver" class="cver"></div>
    <!-- DEV TEST MODE — remove this button (and the #testmode block + CSS + main.ts hook) to cut the feature -->
    <!--dev-only--><button id="ctest" class="cbtn tm-open" data-i18n="welcome.testmode"></button><!--/dev-only-->
    <!-- /DEV TEST MODE -->
    <div class="cfoot">
      <a id="cl-imprint" data-i18n="welcome.imprint"></a>
      <a id="cl-terms" data-i18n="welcome.terms"></a>
      <a id="cl-privacy" data-i18n="welcome.privacy"></a>
      <a id="cl-support" data-i18n="welcome.support"></a>
    </div>
  </div>
</div>
<!-- in-app APK update (APK only; dormant in the browser — driven by updater.ts).
     A GLOBAL fixed banner so it is seen from ANY screen — welcome, hub, or mid-match:
     the returning-player path lands in the hub and never visits #connect, which is
     where this used to live (and why players never saw their updates). -->
<div id="updbar" role="region" aria-live="polite">
  <div class="ub-t" data-i18n="upd.available"></div>
  <p id="ub-status"></p>
  <div class="ub-row">
    <a id="ub-go" class="ub-go" href="#" rel="noopener" data-i18n="upd.go"></a>
    <button id="ub-later" class="ub-later" type="button" data-i18n="upd.later"></button>
  </div>
</div>
<section id="sector-zero" aria-labelledby="sz-title"${entry === 'sector-zero' ? ' style="display:flex"' : ''}>
  <div class="sz-shell">
    <div class="sz-topline"><span class="sz-mark" data-i18n="sector-zero.title"></span><div class="sz-topactions"><button id="sz-lang" class="sz-lang" type="button"></button><button id="sz-settings" class="sz-gear" type="button"><span class="sz-gear-ic" aria-hidden="true">⚙</span><span data-i18n="hub.tile.settings"></span></button></div></div>
    <div class="sz-main" id="sz-home">
      <div class="sz-content">
        <p class="sz-eyebrow" data-i18n="sector-zero.offline"></p>
        <h1 id="sz-title" data-i18n="sector-zero.title"></h1>
        <p class="sz-intro" data-i18n="sector-zero.intro"></p>
        <div class="sz-run"><div id="sz-save-label" data-i18n="sector-zero.saved" hidden></div><p id="sz-summary" role="status" aria-live="polite" data-i18n="sector-zero.loading"></p></div>
        <div id="sz-actions">
          <div class="sz-actions">
            <button id="sz-continue" class="sz-action sz-primary" type="button" hidden disabled data-i18n="sector-zero.continue"></button>
            <button id="sz-new" class="sz-action sz-primary" type="button" disabled data-i18n="sector-zero.new"></button>
            <button id="sz-training" class="sz-action" type="button" disabled data-i18n="sector-zero.training" data-i18n-title="sector-zero.training.hint"></button>
            <!--dev-only--><button id="sz-dev" class="sz-action" type="button" disabled data-i18n="sector-zero.dev.start" data-i18n-title="sector-zero.dev.hint"></button><!--/dev-only-->
            <button id="sz-prep" class="sz-action" type="button" disabled data-i18n="sector-zero.prep"></button>
            <button id="sz-codex" class="sz-action" type="button" data-i18n="sector-zero.codex.open"></button>
            <button id="sz-album" class="sz-action" type="button" data-i18n="sector-zero.album.open"></button>
          </div>
          <p id="sz-signin-row" class="sz-signin" hidden><button id="sz-signin" type="button" data-i18n="sector-zero.signin"></button><span data-i18n="sector-zero.signin.why"></span></p>
          <fieldset class="sz-difficulty sz-route-box">
            <legend data-i18n="sector-zero.mission"></legend>
            <div id="sz-route" class="sz-route"></div>
            <div class="sz-route-ends" aria-hidden="true"><span data-i18n="sector-zero.route.edge"></span><span data-i18n="sector-zero.route.core"></span></div>
            <div class="sz-chapter" role="status" aria-live="polite"><b id="sz-chapter-name"></b><p id="sz-chapter-brief"></p><p id="sz-chapter-stats"></p><ul id="sz-chapter-tasks" class="sz-chapter-tasks" hidden></ul><p id="sz-chapter-hero" class="sz-chapter-hero" hidden></p></div>
          </fieldset>
          <fieldset class="sz-difficulty">
            <legend data-i18n="sector-zero.difficulty"></legend>
            <div class="sz-options">
              <button id="sz-weak" type="button" data-difficulty="weak" aria-pressed="true" data-i18n="setup.pve.difficulty.weak"></button>
              <button id="sz-strong" type="button" data-difficulty="strong" aria-pressed="false" data-i18n="setup.pve.difficulty.strong"></button>
            </div>
            <p id="sz-difficulty-about" aria-live="polite"><span id="sz-difficulty-what"></span> <span data-i18n="sector-zero.difficulty.same"></span></p>
            <p id="sz-difficulty-hint" hidden data-i18n="sector-zero.difficulty.hint"></p>
          </fieldset>
        </div>
        <div id="sz-confirm" hidden role="group" aria-labelledby="sz-confirm-title">
          <h2 id="sz-confirm-title" data-i18n="sector-zero.confirm.title"></h2>
          <p data-i18n="sector-zero.confirm.body"></p>
          <button id="sz-cancel" class="sz-action" type="button" data-i18n="sector-zero.cancel"></button>
          <button id="sz-replace" class="sz-action sz-primary" type="button" data-i18n="sector-zero.confirm"></button>
        </div>
        <div id="sz-cloud-choice" hidden role="group" aria-labelledby="sz-cloud-title">
          <h2 id="sz-cloud-title" data-i18n="sector-zero.cloud.choice.title"></h2>
          <p data-i18n="sector-zero.cloud.choice.body"></p>
          <div class="sz-cloud-side"><b data-i18n="sector-zero.cloud.here"></b><p id="sz-cloud-here"></p><button id="sz-keep-here" class="sz-action" type="button" data-i18n="sector-zero.cloud.keep-here"></button></div>
          <div class="sz-cloud-side"><b data-i18n="sector-zero.cloud.cloud"></b><p id="sz-cloud-cloud"></p><button id="sz-take-cloud" class="sz-action" type="button" data-i18n="sector-zero.cloud.take-cloud"></button></div>
        </div>
        <div id="sz-reset-confirm" hidden role="group" aria-labelledby="sz-reset-title">
          <h2 id="sz-reset-title" data-i18n="sector-zero.reset.title"></h2>
          <p data-i18n="sector-zero.reset.body"></p>
          <button id="sz-reset-cancel" class="sz-action" type="button" data-i18n="sector-zero.reset.cancel"></button>
          <button id="sz-reset-yes" class="sz-action sz-primary" type="button" data-i18n="sector-zero.reset.confirm"></button>
        </div>
        <div class="sz-tools"><button id="sz-back" type="button" data-i18n="sector-zero.back"></button><button id="sz-reset" type="button" data-i18n="sector-zero.reset"></button></div>
      </div>
      <div class="sz-projection" aria-hidden="true">
        <svg viewBox="0 0 500 500" fill="none" xmlns="http://www.w3.org/2000/svg">
          <g class="sz-spin sz-spin-slow" stroke="currentColor" stroke-width=".65" opacity=".32">
            <circle cx="250" cy="250" r="220" stroke-dasharray="2 9"/><circle cx="250" cy="250" r="190"/>
            <path d="M250 15v64m0 342v64M15 250h64m342 0h64M94 94l37 37m238 238 37 37M94 406l37-37m238-238 37-37"/>
            <ellipse cx="250" cy="250" rx="208" ry="75" transform="rotate(-28 250 250)"/>
            <ellipse cx="250" cy="250" rx="170" ry="48" transform="rotate(55 250 250)"/>
          </g>
          <circle cx="250" cy="250" r="131" stroke="currentColor" stroke-width="1.3" opacity=".7"/>
          <path class="sz-spin sz-spin-scan" d="M142 324a131 131 0 0 1 215-149" stroke="#bdede4" stroke-width="3"/>
          <ellipse cx="250" cy="250" rx="65" ry="131" stroke="currentColor" opacity=".15"/>
          <ellipse cx="250" cy="250" rx="131" ry="44" stroke="currentColor" opacity=".22"/>
          <path class="sz-core" d="M223 196h54v108h-54z" stroke="currentColor" stroke-width="2" opacity=".8"/>
          <path d="m223 304 54-108" stroke="currentColor" opacity=".4"/>
          <g class="sz-spin sz-spin-back" fill="#b3e8df"><circle cx="69" cy="332" r="4"/><circle cx="391" cy="132" r="3"/></g>
          <circle cx="332" cy="397" r="5" fill="#e6b777"/><circle class="sz-ping" cx="332" cy="397" r="12" stroke="#e6b777" opacity=".5"/>
          <path d="M332 397h82l30 30" stroke="#e6b777" opacity=".45"/>
        </svg>
      </div>
      <aside id="sz-map-panel" class="sz-map-panel" hidden aria-labelledby="sz-map-title">
        <div class="sz-map-head"><span class="sz-map-eyebrow" data-i18n="sector-zero.map.title"></span><b id="sz-map-title"></b><button id="sz-map-close" class="sz-panel-x btn-x" type="button" data-i18n-aria="sector-zero.map.close" data-i18n-title="sector-zero.map.close"><svg viewBox="0 0 12 12" aria-hidden="true" focusable="false"><path d="M2.5 2.5l7 7M9.5 2.5l-7 7"/></svg></button></div>
        <div id="sz-map-body" class="sz-map-body"></div>
        <div id="sz-map-task" class="sz-map-task" role="status" aria-live="polite"></div>
        <div id="sz-map-foot" class="sz-map-foot"></div>
      </aside>
    </div>
    <div id="sz-workshop" hidden></div>
    <!-- Досье Роя — своё окно, как «Подготовка» (заказ владельца 2026-09-24): всё, что игрок
         узнал о Рое за прошлые экспедиции (swarmCodex.ts) -->
    <div id="sz-codex-screen" hidden></div>
    <!-- Альбом комиксов — своё окно, как досье (заказ владельца 2026-10-12): страницы, которые
         игрок уже видел (decisions/comicAlbum.ts) -->
    <div id="sz-album-screen" hidden></div>
    <div class="sz-bottomline"><span data-i18n="sector-zero.title"></span><span aria-hidden="true">00 / ∞</span></div>
  </div>
</section>
<div id="hub">
  <div class="hub-banner">
    <div class="hub-crest"><span class="dia"></span></div>
    <div class="hub-bt">VOID DOMINION</div>
    ${external ? '' : `<div class="hub-apk" id="hub-android">
      <a id="hub-android-download" class="hub-apk-btn" href="${androidDownloadUrl}" data-i18n-aria="hub.android.download">
        <svg class="hub-apk-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M12 3.5v11"/><path d="m7 10 5 5 5-5"/><path d="M5 20h14"/></svg>
        <span class="hub-apk-lbl" data-i18n="hub.android.download"></span>
        <span class="hub-apk-glint" aria-hidden="true"></span>
      </a>
      <a id="hub-android-qr" class="hub-apk-qr" href="${androidDownloadUrl}" data-i18n-aria="hub.android.qr"><b data-i18n="hub.android.title"></b>${androidQr}<span data-i18n="hub.android.scan"></span></a>
    </div>`}
  </div>
  <div class="hub-id">
    <button type="button" class="hub-av" id="hubav" data-i18n-title="hub.avatar.title" data-i18n-aria="hub.avatar.title">◆</button>
    <div class="hub-who">
      <div class="hub-name" id="hub-name">Командир</div>
      <div class="hub-st" data-i18n="hub.status.online"></div>
    </div>
    <div class="hub-wallet" id="hubwallet"></div>
    <button class="hub-lang" id="hub-lang" type="button"></button>
    <button class="hub-gear" id="hub-gear" type="button" data-i18n-aria="hub.tile.settings"><span class="hg-ic" aria-hidden="true">⚙</span><span class="hg-lbl" data-i18n="hub.tile.settings"></span></button>
    <button class="hub-msg" id="hub-msg" type="button" data-i18n-aria="hub.msgs.aria">✉</button>
  </div>
  <div class="hub-body">
    <div class="hub-panel" id="hp-home">
      <!-- CORP-2: на широком экране лента новостей — колонкой справа, на узком — превью под
           дверью (newsScreen.ts). Раскладку решает ширина панели, а не экрана. -->
      <div class="home-grid">
      <div class="home-main">
      <!-- UIX-10.1: одна главная дверь — «Продолжить» или, новичку, «Начать обучение»
           (какая из двух — decisions/hubDoor.ts); под ней режимы, у каждого строка отличия. -->
      <button id="hub-solo-continue" class="hub-door" type="button" hidden><b data-i18n="solo.save.continue"></b><span id="hub-continue-sub"></span></button>
      <p id="solo-save-status" role="status"></p>
      <!-- ONB-0 first-run offer: shown only to a not-yet-onboarded commander -->
      <div class="hub-tutor" id="onboard-nudge" style="display:none">
        <button id="ob-start" class="hub-door" type="button"><b data-i18n="hub.onboard.start"></b><span data-i18n="hub.onboard.sub"></span></button>
        <button id="ob-skip" class="ob-later" type="button" data-i18n="hub.onboard.skip"></button>
      </div>
      <section class="nw-teaser" id="news-teaser" data-i18n-aria="news.title"></section>
      <div class="hub-sec" data-i18n="hub.modes"></div>
      <button id="hub-solo" class="hub-mode" type="button"><b data-i18n="hub.solo"></b><span data-i18n="hub.solo.desc"></span></button>
      <button id="hub-play" class="hub-mode" type="button"><b data-i18n="hub.play"></b><span data-i18n="hub.play.desc"></span></button>
      <button id="hub-sector-zero" class="hub-mode" type="button"><b data-i18n="sector-zero.enter"></b><span data-i18n="hub.sector-zero.desc"></span></button>
      <!-- M2.15: полигон основной игры — все области и весь каталог, старт песочницей -->
      <button id="hub-proving-ground" hidden style="display:none" class="hub-mode" type="button"><b data-i18n="hub.proving-ground"></b><span data-i18n="hub.proving-ground.desc"></span></button>
      <!-- ADDR-4: свои партии — главный экран, а не вкладка обозревателя. -->
      <div class="hub-sec" id="hub-mine-sec" data-i18n="hub.mine.section"></div>
      <div class="hm-list" id="hub-mine"></div>
      </div>
      <aside class="nw-col" id="news-col" data-i18n-aria="news.title"></aside>
      </div>
    </div>
    <div class="hub-panel" id="hp-arsenal" style="display:none"></div>
    <div class="hub-panel" id="hp-supply" style="display:none"></div>
    <div class="hub-panel" id="hp-shop" style="display:none"></div>
    <div class="hub-panel" id="hp-auction" style="display:none"></div>
    <div class="hub-panel" id="hp-rank" style="display:none"></div>
    <div class="hub-panel" id="hp-friends" style="display:none"></div>
    <!-- CORP-3: вкладка «Корпорация» — база, состав, казна, битвы; рисует corpScreen.ts -->
    <div class="hub-panel" id="hp-corp" style="display:none"></div>
    <div class="hub-panel" id="hp-more" style="display:none">
      <div class="hub-grid">
        <!-- UIX-10.1: рейтинг и друзья — из нижней панели сюда, вкладок пять вместо семи -->
        <button class="hub-tile" id="hub-shop" type="button"><span class="ht-ic">◈</span><span data-i18n="hub.tile.shop"></span></button>
        <button class="hub-tile" id="hub-rank" type="button"><span class="ht-ic">▤</span><span data-i18n="hub.nav.rank"></span></button>
        <button class="hub-tile" id="hub-friends" type="button"><span class="ht-ic">☍</span><span data-i18n="hub.nav.friends"></span></button>
        <button class="hub-tile" id="hub-supply" type="button"><span class="ht-ic">⚒</span><span data-i18n="hub.tile.supply"></span></button>
        <button class="hub-tile" id="hub-auction" type="button"><span class="ht-ic">⌖</span><span data-i18n="hub.tile.auction"></span></button>
        <button class="hub-tile" id="hub-tutorial" type="button"><span class="ht-ic">◎</span><span data-i18n="hub.tile.tutorial"></span></button>
        <button class="hub-tile" id="hub-help" type="button"><span class="ht-ic">?</span><span data-i18n="hub.tile.help"></span></button>
        <button class="hub-tile" id="hub-settings" type="button"><span class="ht-ic">⚙</span><span data-i18n="hub.tile.settings"></span></button>
        <button class="hub-tile" id="hub-upd" type="button" style="display:none"><span class="ht-ic">⟳</span><span data-i18n="hub.tile.updates"></span></button>
        <button class="hub-tile" id="hub-delete-account" hidden type="button"><span class="ht-ic">◉</span><span data-i18n="account.delete.title"></span></button>
        <button class="hub-tile" ${external ? 'data-more="Сообщество"' : 'id="hub-community"'} type="button"><span class="ht-ic">◍</span><span data-i18n="hub.tile.community"></span></button>
        <button class="hub-tile" data-more="Поддержка" type="button"><span class="ht-ic">⚠</span><span data-i18n="hub.tile.support"></span></button>
        <button class="hub-tile" data-more="Уведомления" type="button"><span class="ht-ic">◔</span><span data-i18n="hub.tile.notifications"></span></button>
        <button class="hub-tile" data-more="Чат" type="button"><span class="ht-ic">▭</span><span data-i18n="hub.tile.chat"></span></button>
        <a class="hub-tile" id="hub-privacy" data-i18n="welcome.privacy"></a>
        <button class="hub-tile wide" id="hub-logout" type="button"><span class="ht-ic">↩</span><span data-i18n="hub.tile.logout"></span></button>
      </div>
    </div>
    <div class="hub-panel" id="hp-community" style="display:none">
      <div class="hub-sec" data-i18n="hub.tile.community"></div>
      ${external ? '' : `
      <div class="hub-grid">
        <a class="hub-tile hub-discord" id="hub-discord" href="https://discord.gg/DywYCufkK" target="_blank" rel="noopener noreferrer" data-i18n-title="hub.discord.desc"><svg class="ht-ic" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M20.32 4.37A19.8 19.8 0 0 0 15.4 2.85a13.7 13.7 0 0 0-.63 1.3 18.4 18.4 0 0 0-5.5 0 13 13 0 0 0-.64-1.3 19.7 19.7 0 0 0-4.93 1.52C.6 9.05-.25 13.6.18 18.1a19.9 19.9 0 0 0 6.04 3.05c.49-.66.92-1.36 1.3-2.1a12.9 12.9 0 0 1-2.04-.98l.5-.39a14.2 14.2 0 0 0 12.07 0l.5.39c-.65.39-1.33.71-2.05.98.38.74.81 1.44 1.3 2.1a19.8 19.8 0 0 0 6.04-3.05c.5-5.2-.86-9.71-3.52-13.73ZM8.02 15.33c-1.18 0-2.16-1.08-2.16-2.42 0-1.33.95-2.42 2.16-2.42s2.18 1.1 2.16 2.42c0 1.34-.96 2.42-2.16 2.42Zm7.97 0c-1.18 0-2.15-1.08-2.15-2.42 0-1.33.95-2.42 2.15-2.42 1.22 0 2.18 1.1 2.16 2.42 0 1.34-.94 2.42-2.16 2.42Z"/></svg><span data-i18n="hub.discord"></span></a>
      </div>`}
    </div>
  </div>
  <div class="hub-note" id="hub-note"></div>
  <nav class="hub-nav">
    <button class="hub-tab active" data-hub="home" type="button"><span class="hn-ic">⌂</span><span data-i18n="hub.nav.home"></span></button>
    <button class="hub-tab" data-hub="games" type="button"><span class="hn-ic">▶</span><span data-i18n="hub.nav.games"></span></button>
    <button class="hub-tab" data-hub="arsenal" type="button"><span class="hn-ic">⚔</span><span data-i18n="hub.nav.arsenal"></span></button>
    <button class="hub-tab" data-hub="corp" type="button"><span class="hn-ic">⬢</span><span data-i18n="hub.nav.corp"></span></button>
    <button class="hub-tab" data-hub="more" type="button"><span class="hn-ic">≡</span><span data-i18n="hub.nav.more"></span></button>
  </nav>
  <!-- Шторки арсенала, магазина, ленты новостей и корпорации: вне тела хаба, чтобы его стекло не держало fixed-потомка -->
  <div id="arsenal-sheet"></div>
  <div id="shop-sheet"></div>
  <div id="news-sheet"></div>
  <div id="corp-sheet"></div>
  <!-- Штриховка «идёт стройка» для голограмм зданий корпорации: одна на документ, спрайты ссылаются по id -->
  <svg width="0" height="0" style="position:absolute" aria-hidden="true" focusable="false"><defs><pattern id="corpHatch" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="7" height="7" fill="rgba(255,180,58,.07)"/><rect width="2.2" height="7" fill="rgba(255,180,58,.5)"/></pattern><filter id="corpGhost" color-interpolation-filters="sRGB"><feColorMatrix type="matrix" values=".09 .3 .03 0 .08 .2 .66 .07 0 .3 .2 .69 .07 0 .34 0 0 0 .6 0"/></filter><filter id="corpScaf" color-interpolation-filters="sRGB"><feColorMatrix type="matrix" values=".19 .64 .07 0 .35 .13 .44 .05 0 .22 .04 .14 .01 0 .05 0 0 0 .7 0"/></filter><filter id="corpShade" color-interpolation-filters="sRGB"><feColorMatrix type="matrix" values=".06 .2 .02 0 .07 .07 .24 .03 0 .11 .08 .28 .04 0 .16 0 0 0 .85 0"/></filter></defs></svg>
</div>
<div id="emblempick">
  <div class="ep-box">
    <div class="ep-head"><b data-i18n="hub.emblem.title"></b><button id="ep-close" class="btn-x" type="button" data-i18n-aria="hub.emblem.close">✕</button></div>
    <div class="ep-grid" id="ep-grid"></div>
  </div>
</div>
<div id="corp">
  <div class="corpbox">
    <div id="corphd" class="corphd"></div>
    <div id="corptabs" class="corptabs"></div>
    <div id="corpbody" class="corpbody"></div>
  </div>
</div>
<div id="setup">
  <div class="sbox">
    <!-- Один экран на оба входа (UIX-16.1): одиночная схватка и сетевая партия. Сетевой режим
         ставит экрану класс «net»: он прячет решения, которые в сетевом матче принимает
         сервер (.solo-only), и показывает шапку партии (.net-only). -->
    <div class="stitle"><span class="dia"></span><b class="solo-only" data-i18n="setup.title"></b><b class="net-only" data-i18n="seatpick.title"></b></div>
    <p id="setup-sub" class="ssub net-only"></p>
    <div id="setup-start" class="spane">
      <div class="scol smatch">
        <div id="setupmaps" class="smaps solo-only" role="group" data-i18n-aria="setup.map"></div>
        <p class="smaphint sinfo solo-only" id="setup-map-info"></p>
        <svg id="setupmap" class="smap" preserveAspectRatio="xMidYMid meet" role="group" data-i18n-aria="setup.map.aria"></svg>
        <div id="setuplegend" class="slegend"></div>
        <p class="smaphint shint" id="setuphint" data-i18n="setup.map-hint"></p>
        <div class="sspeedsec solo-only">
          <div class="sspeedlabel" data-i18n="setup.speed.label"></div>
          <p class="sspeedhint" data-i18n="setup.speed.hint"></p>
          <div id="setupspeed" class="sspeed">
            <button class="spdchip" type="button" data-spd="1">×1</button>
            <button class="spdchip" type="button" data-spd="2">×2</button>
            <button class="spdchip" type="button" data-spd="5">×5</button>
            <button class="spdchip" type="button" data-spd="10">×10</button>
            <button class="spdchip" type="button" data-spd="50">×50</button>
            <button class="spdchip" type="button" data-spd="100">×100</button>
          </div>
        </div>
        <button id="setup-network-create" class="snetnew btn-second solo-only" type="button" data-i18n="setup.network.create"></button>
      </div>
      <div class="scol sside">
        <div id="setupfactions" class="sfactions"></div>
        <div id="setupcouncil" class="scouncilrow"></div>
        <div id="setupslots" class="sslots solo-only"></div>
        <!-- SANDBOX — setup checkbox; delete this fenced block + the #sandbox markup to cut it -->
        <!--dev-only--><label class="sbx-check solo-only"><input id="setupsandbox" type="checkbox"><span data-i18n="setup.sandbox"></span></label><!--/dev-only-->
      </div>
    </div>
    <div class="sfoot">
      <button id="setupcancel" class="scancel btn-quiet" type="button" data-i18n="setup.cancel"></button>
      <button id="setupgo" class="sgo btn-main" type="button" disabled data-i18n="setup.go"></button>
    </div>
  </div>
</div>
<!-- REL-7: заставка входа в сетевую партию — пока сервер отдаёт места; на отказ — «Повторить».
     Сам выбор места и дома — на экране настройки (ENTRY-2). -->
<div id="seatpick" style="display:none">
  <div class="sbox">
    <div class="stitle"><span class="dia"></span><b data-i18n="seatpick.title"></b></div>
    <div id="seatpick-list" class="sstatus"></div>
    <div class="sfoot">
      <button id="seatpick-cancel" class="scancel btn-quiet" type="button" data-i18n="seatpick.cancel"></button>
      <button id="seatpick-retry" class="sgo btn-main" type="button" style="display:none" data-i18n="seatpick.retry"></button>
    </div>
  </div>
</div>
<!-- hero fitting: the module "on the cursor" — follows the pointer (heroes setup tab) -->
<!-- DEV TEST MODE — content rendered by testmode.ts; delete this one line to cut the markup -->
<!--dev-only--><div id="testmode"></div><!--/dev-only-->
<!-- SANDBOX — floating opener + overlay (content rendered by sandbox.ts); delete to cut the markup -->
<!--dev-only--><button id="sandboxbtn" data-i18n-title="hub.sandbox.title" style="display:none">🧪</button><div id="sandbox"></div><!--/dev-only-->
${external ? '<script src="assets/app.js"></script>' : `<script>${js}</script>`}
</body></html>`;

// Player artifact: drop every <!--dev-only--> … <!--/dev-only--> fence. The matching
// JS is already compiled out by the define, so no handler is left pointing at a hole.
const stripDevMarkup = (html) => html.replace(/<!--dev-only-->[\s\S]*?<!--\/dev-only-->/g, '');

// --- ADM-1: пульт администратора — ОТДЕЛЬНАЯ страница -----------------------
// Отдельный артефакт, а не вкладка в игре: то, что раздаётся игрокам, не должно
// возить в себе админскую разметку. Оформление намеренно спартанское — это
// инструмент того, кто ведёт плейтест, а не витрина.
const adminCss = `\n${readFileSync(new URL('./admin.css', import.meta.url), 'utf8')}`;
const adminPage = (js) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="icon" href="data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="6" fill="#061318"/><rect x="9" y="9" width="14" height="14" rx="2" transform="rotate(45 16 16)" fill="none" stroke="#35d6e6" stroke-width="2.5"/></svg>')}">
<title>Void Dominion — Admin</title><style>${adminCss}</style></head>
<body>
<h1 data-i18n="admin.title"></h1>
<p class="sub" data-i18n="admin.subtitle"></p>
<!-- Учётные поля живут в <form>: иначе браузер не считает их парой «логин+пароль»,
     менеджер паролей их не предлагает, а Enter в поле пароля ничего не отправляет. -->
<form id="a-gate">
  <div class="row">
    <label for="a-server" data-i18n="admin.server"></label>
    <input id="a-server" data-i18n-ph="admin.server.ph" autocomplete="off">
  </div>
  <div class="row">
    <input id="a-login" data-i18n-ph="admin.login.ph" autocomplete="username">
    <input id="a-pass" type="password" data-i18n-ph="admin.pass.ph" autocomplete="current-password">
    <button id="a-signin" type="submit" data-i18n="admin.signin"></button>
  </div>
</form>
<div id="a-panel" style="display:none">
  <div class="row">
    <span id="a-who"></span>
    <label for="a-match" data-i18n="admin.match"></label>
    <select id="a-match"></select>
    <button id="a-refresh" type="button" data-i18n="admin.refresh"></button>
    <button id="a-signout" type="button" data-i18n="admin.signout"></button>
  </div>
  <div id="a-meta"></div>
  <div id="a-roster"></div>
  <!-- CORP-2: объявления ленты новостей. Текст пишется сразу на двух языках: сервер
       не знает языка читателя и прозы не сочиняет. -->
  <h2 data-i18n="admin.news.title"></h2>
  <form id="a-news-form">
    <div class="row">
      <label for="a-news-kind" data-i18n="admin.news.kind"></label>
      <select id="a-news-kind">
        <option value="tech" data-i18n="news.kind.tech"></option>
        <option value="update" data-i18n="news.kind.update"></option>
        <option value="event" data-i18n="news.kind.event"></option>
      </select>
      <label><input id="a-news-pin" type="checkbox"> <span data-i18n="admin.news.pin"></span></label>
      <label for="a-news-until" data-i18n="admin.news.until"></label>
      <input id="a-news-until" type="datetime-local">
    </div>
    <div class="row">
      <input id="a-news-title-ru" maxlength="120" data-i18n-ph="admin.news.title-ru" data-i18n-aria="admin.news.title-ru">
      <input id="a-news-title-en" maxlength="120" data-i18n-ph="admin.news.title-en" data-i18n-aria="admin.news.title-en">
    </div>
    <div class="row">
      <textarea id="a-news-body-ru" maxlength="600" rows="3" data-i18n-ph="admin.news.body-ru" data-i18n-aria="admin.news.body-ru"></textarea>
      <textarea id="a-news-body-en" maxlength="600" rows="3" data-i18n-ph="admin.news.body-en" data-i18n-aria="admin.news.body-en"></textarea>
    </div>
    <div class="row"><button id="a-news-publish" type="submit" data-i18n="admin.news.publish"></button></div>
  </form>
  <div id="a-news-list"></div>
</div>
<div id="a-status"></div>
<script>${js}</script>
</body></html>`;

mkdirSync('prototype/dist', { recursive: true });
const devJs = await bundle(false);
const devHtml = page(devJs);
writeFileSync('prototype/dist/sector-zero-dev.html', page(devJs, 'sector-zero'));
const playerJs = await bundle(true);
const playerHtml = stripDevMarkup(page(playerJs));
// A direct menu entry for review and offline play, still using the shared client.
// It keeps the full player bundle: only the platform archive is cut to Sector Zero (YAG-1.1c).
const sectorZeroHtml = stripDevMarkup(page(playerJs, 'sector-zero'));
writeFileSync('prototype/dist/void-dominion.html', devHtml);
writeFileSync('prototype/dist/void-dominion-player.html', playerHtml);
writeFileSync('prototype/dist/sector-zero.html', sectorZeroHtml);
// Файл потока — рядом с однофайловыми страницами: его забирают сайт (`stage-site.mjs`),
// GitHub Pages и APK. Поток прошлой сборки удаляется: страница его уже не позовёт.
for (const name of readdirSync('prototype/dist')) {
  if (/^sim-worker-[0-9a-f]+\.js$/.test(name)) rmSync(`prototype/dist/${name}`);
}
writeFileSync(`prototype/dist/${simWorkerFile}`, simWorkerSource);
console.log(
  `wrote prototype/dist/${simWorkerFile} (` + (simWorkerSource.length / 1024).toFixed(0) + ' KB)',
);
console.log(
  'wrote prototype/dist/sector-zero.html (' + (sectorZeroHtml.length / 1024).toFixed(0) + ' KB)',
);
console.log(
  'wrote prototype/dist/void-dominion.html (' + (devHtml.length / 1024).toFixed(0) + ' KB)',
);
console.log(
  'wrote prototype/dist/void-dominion-player.html (' +
    (playerHtml.length / 1024).toFixed(0) +
    ' KB)',
);
// --- Клиент для сервера: документ + картинки файлами (см. `bundleServed`) ----------
// Каталог пересоздаётся: картинка, которой больше нет в игре, не должна ехать в образ.
rmSync('prototype/dist/served', { recursive: true, force: true });
mkdirSync('prototype/dist/served/assets', { recursive: true });
const writeServedAssets = (files) => {
  for (const file of files)
    writeFileSync(`prototype/dist/served/assets/${basename(file.path)}`, file.contents);
};
const servedDev = await bundleServed(false);
const servedPlayer = await bundleServed(true);
writeServedAssets(servedDev.assets);
writeServedAssets(servedPlayer.assets);
writeFileSync(`prototype/dist/served/assets/${simWorkerFile}`, simWorkerSource);
const servedPlayerHtml = stripDevMarkup(page(servedPlayer.js));
writeFileSync('prototype/dist/served/dev.html', page(servedDev.js));
writeFileSync('prototype/dist/served/player.html', servedPlayerHtml);
console.log(
  'wrote prototype/dist/served/ (player.html ' +
    (servedPlayerHtml.length / 1024).toFixed(0) +
    ' KB + ' +
    servedPlayer.assets.length +
    ' картинок в assets/)',
);
// --- Платформенная цель (`YAG-1.1b`): index.html в корне + assets/ рядом ---------
// Требование 1.22: `index.html` именно в КОРНЕ архива, а имена файлов и папок — без
// пробелов и кириллицы. Требование 1.21: всё вместе не больше 100 МБ в распакованном
// виде. Сторож `prototype/buildTarget.test.mjs` проверяет это по готовым файлам.
const platformFiles = await bundlePlatform();
mkdirSync('prototype/dist/yandex/assets', { recursive: true });
let platformBytes = 0;
for (const file of platformFiles) {
  // esbuild отдаёт абсолютные пути; кладём их под dist/yandex, сохраняя assets/.
  const rel = file.path.slice(file.path.indexOf('dist/yandex/') + 'dist/yandex/'.length);
  const out = `prototype/dist/yandex/${rel}`;
  mkdirSync(out.slice(0, out.lastIndexOf('/')), { recursive: true });
  writeFileSync(out, file.contents);
  platformBytes += file.contents.byteLength;
}
// YAG-1.1d: тексты — по файлу на язык; игрок скачивает только свой.
for (const locale of await platformLocaleFiles()) {
  writeFileSync(`prototype/dist/yandex/${locale.path}`, locale.contents);
  platformBytes += Buffer.byteLength(locale.contents);
}
const platformCss = allCss();
writeFileSync('prototype/dist/yandex/assets/app.css', platformCss);
platformBytes += Buffer.byteLength(platformCss);
const platformIndex = stripDevMarkup(page('', 'sector-zero', true));
writeFileSync('prototype/dist/yandex/index.html', platformIndex);
platformBytes += Buffer.byteLength(platformIndex);
console.log(
  'wrote prototype/dist/yandex/ (index.html + assets, ' +
    (platformBytes / 1024).toFixed(0) +
    ' KB распакованных)',
);

const adminHtml = adminPage(await bundleAdmin());
writeFileSync('prototype/dist/void-dominion-admin.html', adminHtml);
console.log(
  'wrote prototype/dist/void-dominion-admin.html (' + (adminHtml.length / 1024).toFixed(0) + ' KB)',
);

// Service worker push-уведомлений (UIX-4.4): отдельный файл, его отдаёт сервер по `/sw.js`
// (`wsServer.ts`, опция `serviceWorker`). Worker'у нужен свой адрес на том же origin, что и
// страница, поэтому строкой в документ его не положить.
const pushWorker = (
  await build({
    entryPoints: ['prototype/src/pushWorker.ts'],
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: 'es2020',
    minify: true,
    legalComments: 'none',
    write: false,
  })
).outputFiles[0].text;
writeFileSync('prototype/dist/sw.js', pushWorker);
console.log('wrote prototype/dist/sw.js (' + (pushWorker.length / 1024).toFixed(1) + ' KB)');
