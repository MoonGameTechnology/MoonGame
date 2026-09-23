/**
 * Ждать ли SDK площадки перед стартом игры (`bootstrap.ts`).
 *
 * Лоадер `<script async src="/sdk.js">` кладёт в разметку ТОЛЬКО платформенная цель
 * сборки (`SDK_LOADER` в `prototype/build.mjs`). Во всех остальных — веб-файл, APK,
 * дев-сборка — тега нет, и событие `ya-sdk-ready` не придёт никогда. Раньше хост всё
 * равно ждал его весь потолок (3 с): экран входа уже нарисован, а обработчиков ещё нет,
 * и тап по «Войти» или «Новый командир» тихо пропадал. Нашёл это браузерный харнес
 * `startuptest.mjs` (BRWH-2), а не игрок, — потому и сторож стоит на самом селекторе.
 */
export const SDK_LOADER_SELECTOR = 'script[src="/sdk.js"]';

/** Положила ли сборка лоадер SDK. Нет тега — ждать нечего, игра стартует сразу. */
export function sdkLoaderPresent(doc: Pick<Document, 'querySelector'>): boolean {
  return doc.querySelector(SDK_LOADER_SELECTOR) !== null;
}
