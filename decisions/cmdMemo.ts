/**
 * Памятка плитки приказа на телефоне (заказ владельца 2026-11-17): плитки ряда команд —
 * только иконки, без подписи, а удержание плитки показывает окно с названием и описанием
 * приказа поверх листа.
 *
 * Почему так:
 * - Подпись под иконкой делала плитки разной ширины, и ряд переносился неровно. Без
 *   подписи плитки одинаковые, а что за приказ — скажет удержание.
 * - Окно стоит НАД рядом, во всю его ширину, а не над пальцем: палец закрывает плитку и
 *   всё, что прямо над ней. Стрелка окна показывает, о какой плитке речь.
 * - Окно лежит поверх листа и ничего не раздвигает: ряд не прыгает, пока палец держит.
 * - Удержание короче полсекунды не отличить от обычного нажатия, длиннее — уже ожидание.
 *   Сдвиг пальца больше чем на 10 px — это прокрутка листа, а не удержание.
 */

/** Прямоугольник в координатах окна, px. */
export interface Box {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/** Где стоит окно памятки: `left` и `width` — по окну браузера, `bottom` — отступ от его
 *  нижнего края, `arrowX` — центр стрелки от левого края окна памятки. */
export interface MemoPlacement {
  left: number;
  width: number;
  bottom: number;
  arrowX: number;
}

/** Сколько держать плитку, чтобы вместо приказа показалась памятка, мс. */
export const CMD_MEMO_HOLD_MS = 400;
/** Насколько можно сдвинуть палец, не превратив удержание в прокрутку, px. */
export const CMD_MEMO_SLOP_PX = 10;

/** Окно памятки над рядом `row` для плитки `tile`. Ширина — ряд, но не шире экрана за
 *  вычетом полей `margin`; стрелка — над центром плитки, не ближе 16 px к краям окна
 *  (там скругление). `gap` — зазор между окном и рядом. */
export function cmdMemoPlacement(
  tile: Box,
  row: Box,
  viewportW: number,
  viewportH: number,
  margin = 8,
  gap = 10,
): MemoPlacement {
  const left = Math.max(margin, row.left);
  const right = Math.min(viewportW - margin, row.right);
  const width = Math.max(0, right - left);
  const centre = (tile.left + tile.right) / 2 - left;
  const arrowX = Math.min(Math.max(centre, 16), Math.max(16, width - 16));
  return { left, width, bottom: viewportH - row.top + gap, arrowX };
}
