/**
 * Окно боя «для взрослых детей» (заказ владельца 2026-09-23): что показать ГЛАЗАМ, а не
 * строкой цифр.
 *
 * 1. **Полоса прочности — доли того, что у сторон осталось СЕЙЧАС** (корпус + щит), а не
 *    прогноз. Окно боя прогнозов не даёт (`battleScreen.ts`, правило 3): у многосторонней
 *    свалки исход не определён, пока выживших может быть несколько. Остаток прочности —
 *    факт, и он читается одним взглядом: чья полоса длиннее, у того больше осталось.
 * 2. **Нечего делить — полосы нет.** Нулевая сумма (все стороны без корпуса или модели
 *    без данных) даёт пустой список, а не деление на ноль или «0% / 0%».
 * 3. **Тон корпуса — три ступени**, как у светофора: цел, потрёпан, на грани. Пороги —
 *    те же доли, что у порогов авто-отхода (30–50%), чтобы «жёлтый» совпадал с моментом,
 *    когда игрок думает об отходе.
 */

export type HullTone = 'ok' | 'hurt' | 'low';

/** Выше этой доли корпус «цел». */
export const HULL_OK = 0.6;
/** Выше этой доли — «потрёпан», ниже или ровно — «на грани». */
export const HULL_LOW = 0.3;

/** Доля заполнения шкалы в [0, 1]; мусор и пустой максимум — 0. */
export function meterShare(current: number, max: number): number {
  if (!(max > 0) || !Number.isFinite(current)) return 0;
  return Math.min(1, Math.max(0, current / max));
}

/** Тон шкалы корпуса: цел / потрёпан / на грани (правило 3). */
export function hullTone(current: number, max: number): HullTone {
  const share = meterShare(current, max);
  return share > HULL_OK ? 'ok' : share > HULL_LOW ? 'hurt' : 'low';
}

interface Meter {
  current: number;
}

/** Доли прочности сторон (правила 1–2), в порядке сторон; сумма = 1 или список пуст. */
export function powerShares(sides: ReadonlyArray<{ hull?: Meter; shield?: Meter }>): number[] {
  const left = sides.map(
    (s) => Math.max(0, s.hull?.current ?? 0) + Math.max(0, s.shield?.current ?? 0),
  );
  const total = left.reduce((a, b) => a + b, 0);
  return total > 0 ? left.map((v) => v / total) : [];
}
