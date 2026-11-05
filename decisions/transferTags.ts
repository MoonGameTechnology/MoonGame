/**
 * Плашки перевозок у мира на карте: погрузка, выгрузка, штурмовая высадка (заказ владельца
 * 2026-11-05: «надпись как-нибудь переделать, а то сейчас так себе»). Что в строках —
 * `troopTransferTimers.ts`; здесь размер плашки и её место.
 *
 * Прежняя плашка была одной строкой «▼ Штурмовая высадка · 2 флота · 1:29:00» шириной в
 * треть экрана телефона и висела в сотне с лишним точек над миром при любом зуме: на общем
 * плане она ложилась на соседние миры и чужие плашки, и было не понять, чья она.
 *
 * 1. **Главное в плашке — время.** Оно крупное и светлое; вид операции говорят знак и цвет,
 *    а подпись вида — мелкая строка над временем.
 * 2. **На общем плане подписи нет.** Подпись проявляется вместе с детализацией карты
 *    ({@link tagTitleAlpha}), и плашка растёт плавно, без скачка на пороге зума.
 * 3. **Плашка держится у своего мира.** Над миром она стоит выше кольца орбиты и плашек
 *    флотов, но только когда те есть: на общем плане плашки флотов уходят под корабли, и
 *    плашка опускается к самому миру ({@link tagClearance}).
 * 4. **Не влезла сверху — встаёт снизу.** Мир у верхнего края экрана не загоняет плашку на
 *    сам мир: она переходит под него, а прижимается к краю, только если не влезает нигде.
 * 5. **Выноска всегда доходит до мира.** Плашку, прижатую к боку экрана, с миром соединяет
 *    наклонная линия от ближайшей точки её края — висящей в пустоте черты больше нет.
 */

/** Размеры плашки, px. Подпись и время начинаются с одной вертикали. */
export const TAG = {
  /** Полоса цвета операции слева, как у плашки флота. */
  accent: 3,
  /** Центр знака операции по горизонтали. */
  iconX: 15,
  /** Начало подписи и времени. */
  textX: 27,
  /** Поле справа. */
  padR: 8,
  /** Высота без подписи (общий план) и с подписью. */
  compactH: 22,
  fullH: 34,
  /** Зазор между плашками одного мира. */
  gap: 4,
  /** Отступ плашки от краёв свободной части экрана. */
  margin: 6,
} as const;

const clamp01 = (n: number): number => Math.max(0, Math.min(1, n));

/** Непрозрачность подписи вида при этой детализации карты (правило 2). */
export function tagTitleAlpha(detail: number): number {
  return clamp01((detail - 0.4) / 0.4);
}

/** Высота плашки при такой непрозрачности подписи. */
export function tagRowHeight(titleAlpha: number): number {
  return TAG.compactH + (TAG.fullH - TAG.compactH) * clamp01(titleAlpha);
}

/** Ширина плашки по ширинам её текстов: времени, счёта флотов (0 — один флот) и подписи. */
export function tagRowWidth(
  time: number,
  fleets: number,
  title: number,
  titleAlpha: number,
): number {
  const line = time + fleets;
  const text = line + Math.max(0, title - line) * clamp01(titleAlpha);
  return Math.ceil(TAG.textX + text + TAG.padR);
}

/**
 * От центра мира до ближнего края стопки плашек, px (правило 3). При полной детализации —
 * прежнее правило: над кольцом орбиты и вынесенными наружу плашками флотов, не ближе 76.
 * На общем плане — сразу над кораблями на кольце.
 */
export function tagClearance(orbitR: number, sphereR: number, detail: number): number {
  const d = clamp01(detail);
  return Math.max(sphereR + 8 + (76 - sphereR - 8) * d, orbitR + 16 + 66 * d);
}

interface Point {
  x: number;
  y: number;
}
/** Свободная часть экрана: без шапки и нижней панели. */
export interface TagView {
  left: number;
  top: number;
  right: number;
  bottom: number;
}
export interface TagStack {
  left: number;
  top: number;
  /** Стопка стоит под миром (правило 4). */
  below: boolean;
  /** Выноска от края стопки к краю мира; `null` — стопка у самого мира. */
  leader: { x1: number; y1: number; x2: number; y2: number } | null;
}

/**
 * Место стопки плашек мира `c` размером `width × height`. `clearance` — от центра мира до
 * ближнего края стопки, `reach` — где у мира кончается выноска.
 */
export function placeTagStack(
  c: Point,
  width: number,
  height: number,
  clearance: number,
  reach: number,
  view: TagView,
): TagStack {
  const m = TAG.margin;
  const left = Math.round(
    Math.max(view.left + m, Math.min(view.right - m - width, c.x - width / 2)),
  );
  const above = c.y - clearance - height;
  const under = c.y + clearance;
  const fitsAbove = above >= view.top + m;
  const fitsUnder = under + height <= view.bottom - m;
  let top: number;
  let below = false;
  if (fitsAbove) top = above;
  else if (fitsUnder) {
    top = under;
    below = true;
  } else {
    // Не влезает нигде — к краю той стороны, где места больше.
    below = view.bottom - c.y > c.y - view.top;
    top = below
      ? Math.max(view.top + m, Math.min(under, view.bottom - m - height))
      : Math.max(view.top + m, above);
  }
  top = Math.round(top);
  const ax = Math.max(left + 8, Math.min(left + width - 8, c.x));
  const ay = below ? top : top + height;
  const dx = ax - c.x;
  const dy = ay - c.y;
  const d = Math.hypot(dx, dy);
  // Внутрь мира выноска не нужна: стопка налезла на него или стоит вплотную.
  if (d <= reach + 3 || (below ? ay < c.y : ay > c.y)) return { left, top, below, leader: null };
  return {
    left,
    top,
    below,
    leader: { x1: ax, y1: ay, x2: c.x + (dx / d) * reach, y2: c.y + (dy / d) * reach },
  };
}
