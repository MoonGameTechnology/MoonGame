// Entry labels must not depend on game/map initialization reaching the welcome
// handlers. esbuild keeps this dynamic import inside the self-contained bundle;
// no network request is needed to start the game, including in the APK.
import {
  localizeStaticDom,
  LOCALE,
  LOCALE_LABEL,
  registerMessages,
  suggestLocale,
} from '../../localization/runtime';
import { platformLocale } from '../../decisions/platformLocale';
import { currentBuild } from './updater';
import {
  createPlatform,
  getPlatform,
  setPlatform,
  type PlatformHost,
  type YaGamesGlobal,
} from './platform/host';
import { sdkLoaderPresent } from './platform/sdkWait';
import { loadLocaleAsset } from './platform/localeAsset';

/** Сборка игрока (esbuild define). Дев-сборке нужна симуляция рекламы и покупок. */
declare const __PLAYER_BUILD__: boolean;
/** Архив площадки (esbuild define, см. `main.ts`). Здесь он решает одно: тексты едут
 *  файлом одного языка (`YAG-1.1d`), а не лежат в бандле. */
declare const __SECTOR_ZERO_ONLY__: boolean;

/** Статическая разметка и подпись переключателя — на текущем языке рантайма. */
function labelStaticDom(): void {
  localizeStaticDom();
  const language = document.getElementById('clang');
  if (language) language.textContent = LOCALE_LABEL[LOCALE] + ' ▾';
}

/** Архив площадки: скачать тексты языка, на котором игра запустится, и подписать ими
 *  разметку. До этого текстов нет вовсе — подпись раньше показала бы игроку ключи. */
async function loadActiveLocale(): Promise<void> {
  registerMessages(LOCALE, await loadLocaleAsset(LOCALE));
  labelStaticDom();
}

document.body.classList.add('app-starting');
if (!__SECTOR_ZERO_ONLY__) labelStaticDom();

/**
 * Площадка поднимается ДО игры (`YAG-1.1b`).
 *
 * Причина техническая, а не вкусовая: `main.ts` собирается в `iife`/es2020, где нет
 * top-level await, поэтому дождаться `YaGames.init()` внутри игры невозможно. Здесь же
 * ждать можно — игра импортируется динамически, и до её импорта площадка уже известна.
 *
 * Лоадер `<script async src="/sdk.js">` может доехать и ПОЗЖЕ этого кода, поэтому ждём
 * либо уже готовый `window.YaGames`, либо событие `ya-sdk-ready`, которое шлёт `onload`
 * тега (см. `SDK_LOADER` в `prototype/build.mjs`). Ждём недолго и с потолком: игра
 * обязана стартовать и там, где площадки нет вовсе, — тогда это обычный браузер.
 */
const SDK_WAIT_MS = 3000;

function loaderReady(): Promise<YaGamesGlobal | undefined> {
  const at = () => (window as unknown as { YaGames?: YaGamesGlobal }).YaGames;
  if (at()) return Promise.resolve(at());
  // Без тега лоадера `ya-sdk-ready` не придёт никогда — не держать игру весь потолок.
  if (!sdkLoaderPresent(document)) return Promise.resolve(undefined);
  return new Promise((resolve) => {
    const done = (): void => {
      window.removeEventListener('ya-sdk-ready', done);
      clearTimeout(timer);
      resolve(at());
    };
    const timer = setTimeout(done, SDK_WAIT_MS);
    window.addEventListener('ya-sdk-ready', done, { once: true });
  });
}

loaderReady()
  .then((yaGames) =>
    createPlatform({
      simulate: !__PLAYER_BUILD__,
      yaGames,
      // Сбой чужого SDK — в лог разработчика, а не на экран игроку: сообщение или стек
      // могут нести URL и данные. Игра при этом продолжает запускаться.
      onSdkError: (where, error) => console.error('E_PLATFORM_SDK', where, error),
    }),
  )
  .then((platform) => {
    setPlatform(platform);
    // Язык площадки (`YAG-1.3`, требование 2.14) — ДО импорта игры: её рендереры строятся
    // один раз и на том языке, что стоит в момент импорта, а переключение языка в игре
    // вообще перезагружает страницу. Статика выше уже отрисована на языке браузера —
    // сменился язык, перерисовываем её. Явный выбор игрока подсказка не перебивает.
    const locale = platformLocale(platform.language);
    // YAG-1.1d: в архиве тексты ещё не скачаны — подписывать нечем; язык качается
    // следующим шагом, уже ПОСЛЕ подсказки площадки: ровно тот, на котором игра запустится.
    if (__SECTOR_ZERO_ONLY__) {
      if (locale) suggestLocale(locale);
    } else if (locale && suggestLocale(locale)) labelStaticDom();
  })
  .then(() => (__SECTOR_ZERO_ONLY__ ? loadActiveLocale() : undefined))
  .then(() => import('./main'))
  .then(
    () => {
      document.body.classList.remove('app-starting');
      // `LoadingAPI.ready()` — РОВНО здесь, и это не стилистика. Модерация смотрит
      // debug-панель покадрово и в двух сценариях (загрузочный экран площадки скрыт
      // тапом и исчез сам), поэтому привязка ко времени провалила бы один из них.
      // Момент «игра загрузилась и отвечает на нажатия» знает только хост — вот он.
      (getPlatform() as Partial<PlatformHost>).ready?.();
    },
    (error: unknown) => {
      // Raw errors belong in developer logs, not in the player's UI: a message or
      // stack may contain a URL or stored data. The screen reports only safe codes.
      console.error('E_CLIENT_STARTUP', error);
      document.body.classList.add('app-startup-failed');
      const panel = document.getElementById('startup-error');
      if (panel) panel.hidden = false;
      const kinds = ['TypeError', 'ReferenceError', 'RangeError', 'SyntaxError', 'SecurityError'];
      const kind = error instanceof Error && kinds.includes(error.name) ? error.name : 'Error';
      const sha = currentBuild()?.sha ?? '';
      const build = /^[0-9a-f]{7,40}$/i.test(sha) ? sha : 'web';
      const engine = /(?:Chrome|Chromium)\/(\d+)/.exec(navigator.userAgent)?.[1] ?? '?';
      const code = document.getElementById('startup-code');
      if (code) code.textContent = `E_CLIENT_STARTUP / ${kind} / ${build} / Chromium-${engine}`;
      // No retry timer and no storage clearing. Only the player's explicit action
      // reloads the document, so persistent failures stay readable and stable.
      document.getElementById('startup-retry')?.addEventListener('click', () => location.reload());
    },
  );
