// Entry labels must not depend on game/map initialization reaching the welcome
// handlers. esbuild keeps this dynamic import inside the self-contained bundle;
// no network request is needed to start the game, including in the APK.
import { localizeStaticDom, LOCALE, LOCALE_LABEL } from '../../localization/runtime';
import { currentBuild } from './updater';
import {
  createPlatform,
  getPlatform,
  setPlatform,
  type PlatformHost,
  type YaGamesGlobal,
} from './platform/host';

/** Сборка игрока (esbuild define). Дев-сборке нужна симуляция рекламы и покупок. */
declare const __PLAYER_BUILD__: boolean;

document.body.classList.add('app-starting');
localizeStaticDom();
const language = document.getElementById('clang');
if (language) language.textContent = LOCALE_LABEL[LOCALE] + ' ▾';

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
  .then(setPlatform)
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
