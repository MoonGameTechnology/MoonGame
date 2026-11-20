/**
 * Куда сдвинуть карту, чтобы выделенный объект был виден рядом с листом выделения телефона.
 *
 * Лист меняет высоту (свёрнут, раскрыт кнопкой «i», сменилась вкладка), и камера подвигает
 * карту так, чтобы объект остался в свободном окне между верхней панелью и листом. Два
 * правила, оба из аудита интерфейса 2026-11-20:
 *
 *  1. **Нет окна — нет сдвига.** Раскрытый лист занимает почти весь экран, и окна над ним
 *     не остаётся. Раньше объект всё равно прижимали к верху — под строку статуса, а после
 *     сворачивания листа карта так и стояла: полэкрана пустоты за краем карты, а тап по
 *     своему флоту попадал в «▶ Продолжить» и снимал партию с паузы. Объект под раскрытым
 *     листом и так не виден; камера просто ждёт, пока окно появится снова.
 *  2. **Верх окна — низ ВСЕГО, что висит сверху**, включая плавающую строку статуса (часы,
 *     планеты, «Продолжить»), а не только полосу ресурсов.
 */

/** Свободное окно карты в пикселях экрана. */
export interface RevealWindow {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

/** Окно ниже этой высоты считаем закрытым: объект в нём не разглядеть и не нажать. */
export const MIN_REVEAL_GAP = 56;

/**
 * Сдвиг карты (`dx`, `dy`), который приводит `anchor` в окно, или `null`, если окна нет
 * (тогда камера не двигается).
 */
export function sheetRevealPan(
  anchor: { x: number; y: number },
  win: RevealWindow,
): { dx: number; dy: number } | null {
  if (win.bottom - win.top < MIN_REVEAL_GAP || win.right - win.left < MIN_REVEAL_GAP) return null;
  const clamp = (v: number, lo: number, hi: number): number => Math.min(Math.max(v, lo), hi);
  return {
    dx: clamp(anchor.x, win.left, win.right) - anchor.x,
    dy: clamp(anchor.y, win.top, win.bottom) - anchor.y,
  };
}

/** Прямоугольник окна на экране. */
export interface RevealBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Окно выбора на ПК открылось поверх своего объекта (аудит интерфейса 2026-11-20, 1920 px:
 * широкое окно планеты встаёт по центру внизу и закрывает саму планету и её флот). Окно
 * остаётся там, где его ставят всегда (или где его поставил игрок), а камера один раз
 * подвигает карту, чтобы объект встал рядом с окном. То же правило, что у листа телефона:
 * двигается карта, а не окно.
 *
 * Свободных мест четыре: над окном, под ним, слева и справа (до краёв экрана, сверху — до
 * низа панели `top`). Берётся то, куда объект доезжает кратчайшим сдвигом. Объект не под
 * окном (с запасом `margin`) — `null`, камера стоит. Ни одно место не годится — тоже `null`.
 */
export function windowRevealPan(
  anchor: { x: number; y: number },
  box: RevealBox,
  viewport: { width: number; height: number },
  top: number,
  margin = 32,
): { dx: number; dy: number } | null {
  const covered =
    anchor.x >= box.x - margin &&
    anchor.x <= box.x + box.width + margin &&
    anchor.y >= box.y - margin &&
    anchor.y <= box.y + box.height + margin;
  if (!covered) return null;
  const left = margin;
  const right = viewport.width - margin;
  const high = top + margin;
  const low = viewport.height - margin;
  const spots: RevealWindow[] = [
    { top: high, bottom: box.y - margin, left, right },
    { top: box.y + box.height + margin, bottom: low, left, right },
    { top: high, bottom: low, left, right: box.x - margin },
    { top: high, bottom: low, left: box.x + box.width + margin, right },
  ];
  let best: { dx: number; dy: number } | null = null;
  for (const spot of spots) {
    const pan = sheetRevealPan(anchor, spot);
    if (pan && (!best || Math.hypot(pan.dx, pan.dy) < Math.hypot(best.dx, best.dy))) best = pan;
  }
  return best;
}
