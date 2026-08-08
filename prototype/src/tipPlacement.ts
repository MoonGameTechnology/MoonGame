/**
 * Где встаёт всплывающая подсказка и что считать удержанием (REFM-75).
 *
 * Подсказок две: досье под курсором на ПК и «пузырь» имени по долгому нажатию на
 * телефоне. Обе обязаны попадать в экран и не мешать тому, что объясняют.
 *
 * 1. **Подсказка ОТСТУПАЕТ от курсора, а не садится под него** — иначе указатель
 *    закрывает первую строку ровно того текста, ради которого её и открыли.
 * 2. **У края экрана она переворачивается на другую сторону курсора**, а не выезжает
 *    за границу: обрезанное досье бесполезно.
 * 3. **Даже перевёрнутая не прижимается вплотную к краю** — остаётся поле, иначе она
 *    сливается с рамкой окна.
 * 4. **Пузырь удержания центрируется НАД плиткой** и зажимается по ширине экрана: он
 *    объясняет плитку, поэтому не должен её же и закрывать.
 * 5. **Движущийся палец — это скролл, а не удержание.** Без допуска прокрутка панели
 *    засыпала бы экран подсказками, которых игрок не просил.
 */

/** Отступ подсказки от курсора. */
export const TIP_PAD = 14;

/** Минимальное поле между подсказкой и краем экрана. */
export const TIP_EDGE = 8;

export interface Size {
  width: number;
  height: number;
}

export interface Point {
  x: number;
  y: number;
}

/** Позиция подсказки у курсора: с отступом, с переворотом у края (правила 1–3). */
export function cursorTipPos(cursor: Point, tip: Size, viewport: Size): Point {
  let x = cursor.x + TIP_PAD;
  let y = cursor.y + TIP_PAD;
  if (x + tip.width > viewport.width - TIP_EDGE) x = cursor.x - tip.width - TIP_PAD;
  if (y + tip.height > viewport.height - TIP_EDGE) y = cursor.y - tip.height - TIP_PAD;
  return { x: Math.max(TIP_EDGE, x), y: Math.max(TIP_EDGE, y) };
}

/** Сколько палец должен пролежать на месте, чтобы это стало удержанием. */
export const HOLD_TIP_MS = 400;

/** Допуск сдвига: дальше — это уже скролл (правило 5). */
export const HOLD_SLOP_PX = 12;

/** Поле пузыря удержания от края экрана и зазор до самой плитки. */
export const HOLD_EDGE = 6;
export const HOLD_GAP = 8;

/** Прямоугольник плитки на экране. */
export interface Rect {
  left: number;
  top: number;
  width: number;
}

/** Позиция пузыря: по центру над плиткой, зажатая по экрану (правило 4). */
export function holdTipPos(tile: Rect, tip: Size, viewportW: number): Point {
  const centred = tile.left + tile.width / 2 - tip.width / 2;
  return {
    x: Math.max(HOLD_EDGE, Math.min(viewportW - tip.width - HOLD_EDGE, centred)),
    y: Math.max(HOLD_EDGE, tile.top - tip.height - HOLD_GAP),
  };
}

/** Уехал ли палец настолько, что это уже прокрутка, а не удержание (правило 5). */
export function movedTooFar(from: Point, to: Point): boolean {
  return Math.hypot(to.x - from.x, to.y - from.y) > HOLD_SLOP_PX;
}
