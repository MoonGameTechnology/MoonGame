/**
 * Живые границы провинций своим слоем: в покое он обновляется полосой за кадр, в движении едет
 * с камерой.
 *
 * Граница провинций колышется (M2.11, `packages/client/src/livingBorder.ts`), поэтому
 * выпечка карты её не держит, и кадр обводил все границы заново. На обзоре карты из 1675
 * провинций, поделённой между 124 империями, это 14752 отрезка фронтира: на телефоне без
 * видеокарты границы стоили около 45 мс из 62–70 мс растра кадра. Двигается же граница медленно:
 * размах колыхания не больше пикселя, а точка смещается не быстрее 2,3 размаха в секунду
 * по каждой оси. Перерисовывать все границы на каждом кадре незачем.
 *
 * 1. **Границы лежат в своём слое.** Слой — холст размером с экран, границы в нём нарисованы
 *    только в пределах стекла карты ({@link glassPixels}) при той проекции карты на экран, при
 *    которой рисовались, а кадр кладёт эту часть одним блитом. Слой рисуется теми же вызовами,
 *    с той же обрезкой стеклом, что и кадр, поэтому пиксели те же. Слой привязан к проекции
 *    карты, а не к выпечке: новая выпечка при той же камере его не портит. Холст живёт всю
 *    партию: остановка камеры не просит у браузера новой памяти.
 * 2. **Слой обновляется полосой за кадр.** Он поделён на {@link LIVING_BANDS} полос поровну
 *    по работе, то есть по числу отрезков ({@link bandEdges}): у галактики середина гуще
 *    краёв. Кадр перерисовывает одну полосу на текущий момент часов, поэтому цена кадра —
 *    шестая часть прежней. Полоса отстаёт от часов не больше чем на пять кадров: при 30
 *    кадрах в секунду и размахе в пиксель это до 0,4 пикселя, на обзоре телефона до 0,25.
 *    Соседние полосы обновляются соседними кадрами, и шов между ними — около десятой
 *    пикселя.
 * 3. **В движении слой едет с камерой, как выпечка карты** (`mapLayerView.ts`, правила 1, 3
 *    и 5). Камера сдвинулась на целые физические пиксели — пиксели слоя переезжают копией, а
 *    рисуется только открывшаяся полоса ({@link layerShift}, {@link uncoveredRects}). Зум —
 *    слой показывается растянутым, как растянута под ним выпечка, а края, которые открыло
 *    отдаление, кадр обводит сам. Раньше кадр жеста обводил все границы заново: на поделённой
 *    карте телефон шёл 26 кадров в секунду в панораме и 14 в щипке, а без границ шёл бы 57
 *    и 46. Полосы обновляются и в движении: граница живая всегда, и после жеста слою нечего
 *    догонять.
 * 4. **Слой рисуется целиком, когда старый не годится** ({@link borderLayerAction}). Сменились
 *    границы (захват, туман), цвета владельцев (война, союз) или экран — сразу, и посреди
 *    жеста: старых границ слой не показывает. Растянут больше {@link MAX_STRETCH} раз (заметно
 *    мылен) или сжат меньше {@link SHRINK_LIMIT} (открыл бы почти половину стекла) — на
 *    текущей камере, как перепекается выпечка. Камера встала на новом масштабе или между
 *    пикселями — когда выпечка под ней чёткая: после зума слой ждёт её растянутым. Детальность
 *    провинций (тонкие границы ничьих провинций проступают с приближением) меняется плавно:
 *    в движении слой держит свою, и перерисовывается под неё в покое. Слой и выпечку делали
 *    при одной камере, поэтому растяжение у них одно, и перерисоваться обоим выпало бы на
 *    один кадр: на телефоне это 80–90 мс. Поэтому годный слой в кадре, где перепеклась карта,
 *    ждёт следующего кадра, показываясь растянутым; ждёт он один кадр, не больше, и только если
 *    растянут не дальше шага жеста ({@link WAIT_SLACK}).
 * 5. **Мало границ — кадр рисует их сам.** Меньше {@link MIN_LAYER_SEGMENTS} отрезков в стекле
 *    бывает вблизи, где граница видна крупно и размах колыхания упирается в потолок. Слой
 *    сберёг бы там около миллисекунды (у дома на 1675 провинциях на телефоне без видеокарты
 *    кадр 54,6 мс против 53,3), и граница остаётся без отставания.
 * 6. **Часы стоят — полосы не нужны.** Часы голограммы стоят на паузе одиночной партии и
 *    под reduced motion, и нарисованный слой только кладётся: свежая полоса не нужна ни
 *    одна ({@link staleBand}).
 *
 * Модуль не рисует и не знает про холсты: рисует хозяин экрана, здесь только числа.
 */
import { MAX_STRETCH, type LayerTransform, type PixelRect } from './mapLayerView';

/** Правило 2: на сколько полос делится слой, то есть за сколько кадров он обновляется весь. */
export const LIVING_BANDS = 6;

/** Правило 5: с какого числа отрезков в стекле границы идут через слой. */
export const MIN_LAYER_SEGMENTS = 1000;

/**
 * Правило 1: стекло карты на холсте `width × height` в целых физических пикселях — та часть
 * слоя, которую рисуют и кладут. `frame` — рамка стекла в координатах выпечки, `tr` —
 * выпечка → экран кадра. `null` — стекло целиком за краем холста.
 */
export function glassPixels(
  frame: { x: number; y: number; width: number; height: number },
  tr: LayerTransform,
  dpr: number,
  width: number,
  height: number,
): PixelRect | null {
  const s = tr.k * dpr;
  const x0 = Math.max(0, Math.floor(frame.x * s + tr.tx * dpr));
  const y0 = Math.max(0, Math.floor(frame.y * s + tr.ty * dpr));
  const x1 = Math.min(width, Math.ceil((frame.x + frame.width) * s + tr.tx * dpr));
  const y1 = Math.min(height, Math.ceil((frame.y + frame.height) * s + tr.ty * dpr));
  return x1 > x0 && y1 > y0 ? { x: x0, y: y0, width: x1 - x0, height: y1 - y0 } : null;
}

/**
 * Правило 2: где кончаются полосы. `work` — работа каждой строки слоя (сколько отрезков
 * на ней), ответ — `count + 1` строк от 0 до `work.length`: полоса `i` — строки
 * [`edges[i]`, `edges[i + 1]`). Каждая полоса несёт свою долю работы, насколько позволяют
 * строки, и ни одна не пуста; строк меньше, чем полос, — полос столько же, сколько строк.
 * Без работы полосы равны по высоте.
 */
export function bandEdges(work: ArrayLike<number>, count: number): number[] {
  const rows = work.length;
  const n = Math.max(1, Math.min(Math.floor(count), rows));
  // Нарастающий итог: `sum[r]` — работа строк до `r`.
  const sum = new Float64Array(rows + 1);
  for (let r = 0; r < rows; r++) sum[r + 1] = sum[r]! + Math.max(0, work[r]!);
  const total = sum[rows]!;
  const edges = [0];
  for (let b = 1; b < n; b++) {
    let edge: number;
    if (total > 0) {
      const target = (total * b) / n;
      // Первая строка, до которой набралась доля, или предыдущая, если та ближе.
      let lo = 0;
      let hi = rows;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (sum[mid]! < target) lo = mid + 1;
        else hi = mid;
      }
      edge = lo > 0 && target - sum[lo - 1]! < sum[lo]! - target ? lo - 1 : lo;
    } else {
      edge = Math.round((rows * b) / n);
    }
    // Ни одной пустой полосы: ни этой, ни тех, что ещё впереди.
    edges.push(Math.min(rows - (n - b), Math.max(edges[b - 1]! + 1, edge)));
  }
  edges.push(rows);
  return edges;
}

/**
 * Правила 2 и 6: какую полосу перерисовать в этом кадре. Полосы идут по кругу с `from`;
 * полоса, уже нарисованная на момент `clock`, пропускается. `-1` — все полосы на этом
 * моменте: часы стоят, и слой только кладётся.
 */
export function staleBand(clocks: readonly number[], from: number, clock: number): number {
  const n = clocks.length;
  for (let i = 0; i < n; i++) {
    const band = (((from + i) % n) + n) % n;
    if (clocks[band] !== clock) return band;
  }
  return -1;
}

/** Правило 4: сжатый сильнее этого слой рисуется заново — отдаление открыло бы
 *  1 − 0,75² ≈ 44% стекла, и кадр обводил бы их сам. */
export const SHRINK_LIMIT = 0.75;

/** Правило 4: во сколько раз дальше {@link MAX_STRETCH} и {@link SHRINK_LIMIT} может
 *  показаться слой в кадре, где он ждёт выпечку. Шаг жеста за кадр меньше, а прыжок камеры
 *  (к дому, к флоту) больше: там показать нечего, и слой рисуется сразу. */
export const WAIT_SLACK = 1.5;

/**
 * Правило 3: на сколько целых физических пикселей сдвинуть слой, чтобы он лёг под камеру.
 * `tr` — из слоя в кадр. `null` — масштаб другой: слой не сдвинуть, только растянуть.
 */
export function layerShift(tr: LayerTransform, dpr: number): { x: number; y: number } | null {
  if (!(Math.abs(tr.k - 1) <= 1e-9)) return null;
  // `|| 0` — без минус нуля: слой на месте записывается как место.
  return { x: Math.round(tr.tx * dpr) || 0, y: Math.round(tr.ty * dpr) || 0 };
}

/** Что известно о кадре, чтобы решить судьбу слоя. */
export interface BorderLayerFrame {
  /** В слое эти же границы, в тех же цветах и на том же экране, а в покое и с той же
   *  детальностью (правило 4); камера не в счёт. */
  readonly fresh: boolean;
  /** Из слоя в кадр. */
  readonly transform: LayerTransform;
  readonly dpr: number;
  /** Камера стоит (`mapLayerView.ts`, правило 4). */
  readonly settled: boolean;
  /** Выпечка карты под кадром не растянута. */
  readonly sharp: boolean;
  /** Карта перепеклась в этом кадре, а слой прошлый кадр не ждал (правило 4). */
  readonly baked?: boolean;
}

/**
 * `keep` — положить слой как есть, обновив полосу; `scroll` — сдвинуть его на
 * {@link layerShift} и дорисовать открывшееся; `show` — показать растянутым, а открывшиеся
 * края кадр обводит сам; `paint` — нарисовать слой целиком на текущей камере.
 */
export type BorderLayerAction = 'keep' | 'scroll' | 'show' | 'paint';

/** Правила 3 и 4: что делать со слоем в этом кадре. */
export function borderLayerAction(f: BorderLayerFrame): BorderLayerAction {
  if (!f.fresh) return 'paint';
  const action = keptLayerAction(f);
  if (action !== 'paint' || !f.baked) return action;
  const k = f.transform.k;
  return k <= MAX_STRETCH * WAIT_SLACK && k >= SHRINK_LIMIT / WAIT_SLACK ? 'show' : 'paint';
}

function keptLayerAction(f: BorderLayerFrame): BorderLayerAction {
  const rest = f.settled && f.sharp;
  const tr = f.transform;
  const shift = layerShift(tr, f.dpr);
  if (shift) {
    // В покое слой ложится пиксель в пиксель; в движении остаток меньше полупикселя, и
    // покой нарисует слой заново, если камера так между пикселями и встанет.
    const whole =
      Math.abs(tr.tx * f.dpr - shift.x) < 1e-6 && Math.abs(tr.ty * f.dpr - shift.y) < 1e-6;
    if (rest && !whole) return 'paint';
    return shift.x || shift.y ? 'scroll' : 'keep';
  }
  if (rest) return 'paint';
  return tr.k <= MAX_STRETCH && tr.k >= SHRINK_LIMIT ? 'show' : 'paint';
}

/** Общая часть двух прямоугольников; `null` — её нет. */
export function intersectRect(a: PixelRect, b: PixelRect): PixelRect | null {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const x1 = Math.min(a.x + a.width, b.x + b.width);
  const y1 = Math.min(a.y + a.height, b.y + b.height);
  return x1 > x && y1 > y ? { x, y, width: x1 - x, height: y1 - y } : null;
}

/**
 * Прямоугольник слоя `rect` (физические пиксели) в кадре при `tr` — из слоя в кадр: только
 * пиксели, которые он покрывает целиком. `null` — ни одного.
 */
export function framedRect(rect: PixelRect, tr: LayerTransform, dpr: number): PixelRect | null {
  const x0 = Math.ceil(rect.x * tr.k + tr.tx * dpr - 1e-6);
  const y0 = Math.ceil(rect.y * tr.k + tr.ty * dpr - 1e-6);
  const x1 = Math.floor((rect.x + rect.width) * tr.k + tr.tx * dpr + 1e-6);
  const y1 = Math.floor((rect.y + rect.height) * tr.k + tr.ty * dpr + 1e-6);
  return x1 > x0 && y1 > y0 ? { x: x0, y: y0, width: x1 - x0, height: y1 - y0 } : null;
}

/**
 * Правило 3: что в `outer` не покрыто `inner` — не больше четырёх прямоугольников без
 * перекрытий: сверху и снизу во всю ширину, слева и справа между ними.
 */
export function uncoveredRects(outer: PixelRect, inner: PixelRect | null): PixelRect[] {
  const cover = inner && intersectRect(outer, inner);
  if (!cover) return [outer];
  const out: PixelRect[] = [];
  const top = cover.y - outer.y;
  const bottom = outer.y + outer.height - (cover.y + cover.height);
  const left = cover.x - outer.x;
  const right = outer.x + outer.width - (cover.x + cover.width);
  if (top > 0) out.push({ x: outer.x, y: outer.y, width: outer.width, height: top });
  if (bottom > 0)
    out.push({ x: outer.x, y: cover.y + cover.height, width: outer.width, height: bottom });
  if (left > 0) out.push({ x: outer.x, y: cover.y, width: left, height: cover.height });
  if (right > 0)
    out.push({ x: cover.x + cover.width, y: cover.y, width: right, height: cover.height });
  return out;
}
