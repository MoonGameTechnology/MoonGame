/**
 * Кому предлагать «Скачать APK» — кнопка в шапке хаба, рядом со знаком игры.
 *
 * Заказ владельца 2026-10-25: кнопка жила карточкой с QR только в ПК-браузере, а нужна и
 * в мобильных — с телефона её и качают; в самом APK она не нужна. Как кнопка выглядит
 * (QR по наведению мыши на ПК, плотная строка на телефоне) — решает разметка хаба, здесь
 * только «показывать ли вообще».
 *
 * 1. **Внутри APK — нет.** Игра уже установлена, новые версии приносит баннер обновления
 *    (`apkUpdate.ts`): вторая кнопка звала бы ставить приложение поверх самого себя.
 * 2. **iPhone и iPad — нет.** iOS не ставит APK, кнопка вела бы к файлу, который нечем
 *    открыть. iPadOS с 13-й версии представляется Mac'ом — его выдаёт сенсорный экран:
 *    у настоящего Mac `maxTouchPoints` равен нулю.
 * 3. **Всем остальным — да.** Android качает файл прямо на телефон, ПК — на компьютер и
 *    показывает QR для телефона. Незнакомую систему не прячем: лишняя кнопка дешевле, чем
 *    Android, который не узнали по строке браузера.
 */

export interface ApkOfferEnv {
  /** Страница открыта внутри установленного APK (`currentBuild()` не пуст). */
  insideApk: boolean;
  /** `navigator.userAgent`. */
  userAgent: string;
  /** `navigator.maxTouchPoints` — отличает iPad от Mac (правило 2). */
  maxTouchPoints: number;
}

/** iPhone, iPod или iPad — в том числе iPad, который назвался Mac'ом (правило 2). */
export function isAppleMobile(userAgent: string, maxTouchPoints: number): boolean {
  return /iPhone|iPad|iPod/i.test(userAgent) || (/Macintosh/i.test(userAgent) && maxTouchPoints > 1);
}

/** Показывать ли кнопку «Скачать APK». */
export function apkOfferShown({ insideApk, userAgent, maxTouchPoints }: ApkOfferEnv): boolean {
  if (insideApk) return false;
  return !isAppleMobile(userAgent, maxTouchPoints);
}
