/**
 * Игровой выпадающий список вместо системного (заказ владельца 2026-11-19: «при смене
 * планеты интерфейс не игровой»). Нативный `<select>` на телефоне открывает окно Android —
 * серое, чужим шрифтом, с радиокнопками, — а на ПК окно системы. Список игры встаёт у
 * самого поля, в стекле и шрифте игры. Здесь только решение, где он встаёт.
 *
 * Почему так:
 * - Под полем, если там хватает места на весь список или хотя бы больше, чем над ним: так
 *   палец и глаз остаются у поля. Иначе — над полем.
 * - Ширина — не уже поля и не уже 200 px (короткое поле «×5» иначе дало бы список, в
 *   который не попасть), но не шире экрана за вычетом полей.
 * - Строка — 48 px: цель пальца на телефоне от 44 px (UIX-1.3).
 */

/** Прямоугольник в координатах окна, px. */
export interface Rect {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/** Где стоит список: `left`/`width` — по окну браузера; `top` (под полем) или `bottom`
 *  (над полем, отступ от нижнего края окна); `maxHeight` — дальше список листается. */
export interface PopupPlacement {
  left: number;
  width: number;
  top?: number;
  bottom?: number;
  maxHeight: number;
}

/** Высота строки списка, px. */
export const SELECT_ROW_PX = 48;
/** Самая узкая ширина списка, px. */
export const SELECT_MIN_WIDTH_PX = 200;
/** Внутренние поля списка сверху и снизу вместе, px. */
const PAD_PX = 8;
/** Зазор между полем и списком, px. */
const GAP_PX = 4;

/** Список из `rows` строк у поля `anchor` в окне `viewportW × viewportH`, с полями `margin`. */
export function selectPopupPlacement(
  anchor: Rect,
  rows: number,
  viewportW: number,
  viewportH: number,
  margin = 8,
): PopupPlacement {
  const room = Math.max(0, viewportW - 2 * margin);
  const width = Math.min(room, Math.max(anchor.right - anchor.left, SELECT_MIN_WIDTH_PX));
  const left = Math.min(Math.max(anchor.left, margin), viewportW - margin - width);
  const wanted = Math.max(1, rows) * SELECT_ROW_PX + PAD_PX;
  const below = viewportH - margin - anchor.bottom - GAP_PX;
  const above = anchor.top - margin - GAP_PX;
  if (below >= wanted || below >= above) {
    return { left, width, top: anchor.bottom + GAP_PX, maxHeight: Math.max(0, Math.min(wanted, below)) };
  }
  return { left, width, bottom: viewportH - anchor.top + GAP_PX, maxHeight: Math.max(0, Math.min(wanted, above)) };
}
