/**
 * Хост площадки (`YAG-1.1b`) — единственное место, где решается, НА ЧЁМ мы запущены.
 *
 * Почему это отдельный модуль, а не пара строк в `main.ts`. Адаптеров уже два, и выбор
 * между ними — не «какая площадка», а «поднялся ли её лоадер». Разница существенная:
 * проверка по имени площадки ломается на второй и врёт на первой же, где возможность
 * выключена настройкой (шапка {@link ./types}). Поэтому здесь нет ни одного сравнения
 * с именем — есть только вопрос «дал ли нам кто-то работающий `ysdk`».
 *
 * ## SDK приезжает из РАЗМЕТКИ, а не из графа импортов
 *
 * Требование площадки 1.19.1: лоадер подключается тегом `<script async src="/sdk.js">`
 * строго так, как указано в документации, и модерация отдельно смотрит его версию на
 * debug-панели (`IT` — верный, `IF` — старый). Импорт npm-пакета вместо тега — это другой
 * лоадер и прямой отказ. Поэтому тег живёт в `prototype/build.mjs`, а сюда приходит уже
 * поднятый глобальный объект; тест-сторож рядом падает, если в этом файле появится импорт
 * SDK. Побочная выгода: хост тестируется без сети и без браузера.
 *
 * ## Любой сбой чужого SDK = веб-адаптер, а не сломанная загрузка
 *
 * `init()` может отклониться, бросить синхронно, вернуть мусор или вовсе отсутствовать.
 * Ни один из этих случаев не должен стоить игроку запуска игры: во всех мы отдаём
 * `createWebPlatform`, у которого реклама и покупки честно `unavailable`. Это тот же
 * fail-secure, что в ядре: ошибка → отказ в возможности, никогда не молчаливый проход.
 */
import { createWebPlatform } from './web';
import { createYandexPlatform, type YandexSdk } from './yandex';
import type { GamePlatform } from './types';

/**
 * Разметка жизненного цикла — то, чего нет у веб-фолбэка.
 *
 * Объявлена ЗДЕСЬ, а не импортируется из `yandex.ts`, ради той же границы, что держат
 * capability-флаги: игровому коду незачем знать имя площадки даже в типах. Методы
 * опциональны на стороне вызывающего (`host.ready?.()`), поэтому «площадки нет» — это
 * не ветка `if`, а просто отсутствие метода.
 */
export interface PlatformHost {
  /** Игрок может начать играть. Ровно один раз за сессию (требование 1.19). */
  ready(): void;
  gameplayStart(): void;
  gameplayStop(): void;
  onPlatformPause(listener: (paused: boolean) => void): () => void;
  /** Кнопка «назад» площадки (`YAG-6.4`). */
  onHistoryBack(listener: () => void): () => void;
  /** Игрок выходит из игры (`YAG-6.4`). */
  onExit(listener: () => void): () => void;
}

/** Глобальный объект, который кладёт тег лоадера. Своё описание, а не зависимость. */
export interface YaGamesGlobal {
  init?: (opts?: { signed?: boolean }) => Promise<unknown>;
}

export interface PlatformHostOptions {
  /** Дев-сборка поднимает управляемую симуляцию рекламы и покупок (см. `web.ts`). */
  simulate: boolean;
  /** Лоадер. В браузере — `window.YaGames`; в тестах подставляется руками. */
  yaGames?: YaGamesGlobal;
  /** Куда сообщать о сбоях чужого SDK. Молчать нельзя, падать — тем более. */
  onSdkError?: (where: string, error: unknown) => void;
}

/**
 * Поднять площадку. Всегда резолвится — отказ площадки это тоже рабочий исход.
 */
export async function createPlatform(options: PlatformHostOptions): Promise<GamePlatform> {
  const fallback = (): GamePlatform => createWebPlatform({ simulate: options.simulate });
  const loader = options.yaGames;
  // Нет тега, старый лоадер без `init`, чужая страница — всё это не ошибка, а просто
  // «мы не на площадке». Сообщать хозяину не о чем, поэтому и не сообщаем.
  if (typeof loader?.init !== 'function') return fallback();
  try {
    const sdk = (await loader.init()) as YandexSdk | null;
    if (!sdk || typeof sdk !== 'object') return fallback();
    return createYandexPlatform(sdk, { onSdkError: options.onSdkError });
  } catch (error) {
    options.onSdkError?.('init', error);
    return fallback();
  }
}

/**
 * Шов между хостом и игрой.
 *
 * `main.ts` — модуль верхнего уровня без top-level await (сборка идёт в `iife`/es2020,
 * где его попросту нет), поэтому площадку нельзя «дождаться» внутри игры. Вместо этого
 * её поднимает `bootstrap.ts` ДО динамического импорта игры и кладёт сюда. Значение по
 * умолчанию — рабочий веб-адаптер, а не `null`: даже если подстановки не случилось (тест,
 * прямой импорт модуля), игра получает площадку, которая всё умеет отвечать `unavailable`.
 */
let current: GamePlatform = createWebPlatform({ simulate: false });

export function setPlatform(platform: GamePlatform): void {
  current = platform;
}

export function getPlatform(): GamePlatform {
  return current;
}
