/**
 * Слой карты под движущейся камерой: показать уже испечённую картинку сдвинутой и
 * растянутой — или перепечь.
 *
 * Политическая карта (стекло, заливки провинций, рельеф, дороги, контур галактики) —
 * самая дорогая часть кадра: на карте Фронтира это 831 многоугольник. Пока камера
 * стояла, её рисовали раз и дальше копировали. Но стоило камере сдвинуться, и карта
 * рисовалась заново КАЖДЫЙ кадр — ровно тогда, когда игрок смотрит на плавность: при
 * панораме 20 кадров в секунду вместо 60, при зуме кадры по 80–120 мс. Этот модуль
 * решает, когда старая выпечка ещё годится.
 *
 * 1. **Карта — плоская картинка в мировых координатах.** Проекция карты на экран —
 *    масштаб и сдвиг (`экран = a·p + (x, y)`), поэтому любую выпечку можно показать
 *    при другой камере одним преобразованием `экран = k·(точка выпечки) + t`
 *    ({@link layerTransform}). Панорама — это только `t`, зум — ещё и `k`.
 * 2. **Выпечка шире экрана.** Со всех сторон печётся запас ({@link overscanFor}), и
 *    панорама в его пределах не открывает пустого края. Запас ограничен бюджетом
 *    пикселей: на телефоне с плотным экраном он меньше, чем на ПК.
 * 3. **Перепечь, когда картинка перестала покрывать экран** (панорама ушла за запас,
 *    отдаление сжало выпечку) или растянута больше {@link MAX_STRETCH} раз — тогда она
 *    заметно мыльная. Иначе во время движения показывается старая выпечка.
 * 4. **Остановилась камера — картинка должна быть чёткой.** Через {@link SETTLE_MS}
 *    без движения (и не посреди щипка) выпечка остаётся, только если она ложится
 *    пиксель в пиксель: тот же масштаб и целый сдвиг в физических пикселях. Иначе —
 *    перепечь на текущей камере. Поэтому обычная панорама мышью или пальцем в покое не
 *    стоит ничего, а зум перепекается один раз, когда закончился.
 * 5. **Панорама сдвигает картинку на целые пиксели.** Пока камера едет, выпечка того же
 *    масштаба ставится со сдвигом, округлённым до физического пикселя ({@link onPixelGrid}):
 *    это копия, а не пересэмплирование всего экрана (без GPU — десятки миллисекунд на
 *    кадр). Расхождение с настоящей камерой — меньше полупикселя и только в движении:
 *    в покое правило 4 требует точной выпечки.
 * 6. **Содержимое важнее камеры.** Сменился владелец провинции, туман открыл новую,
 *    повернулся экран — выпечка устарела и перепекается сразу, где бы ни была камера
 *    (правило подписи — `staticLayerCache.ts`). Показать старую политическую карту
 *    хоть на кадр значит выдать то, что туман скрывает, или соврать о захвате.
 *
 * Модуль не рисует и не знает про холсты: рисует хозяин экрана, здесь только числа.
 */

/** Проекция карты на экран: экранная точка = `a·p + (x, y)` для точки карты `p`. */
export interface MapProjection {
  readonly a: number;
  readonly x: number;
  readonly y: number;
}

/** Как показать выпечку в кадре: `экран = k·(точка выпечки) + (tx, ty)`. */
export interface LayerTransform {
  readonly k: number;
  readonly tx: number;
  readonly ty: number;
}

/** Запас выпечки за каждым краем экрана, в CSS-пикселях. */
export interface Overscan {
  readonly x: number;
  readonly y: number;
}

/** Камера стоит дольше этого — картинка обязана стать чёткой (правило 4). Меньше
 *  промежутка между событиями колеса и пальцев, но больше одного-двух кадров. */
export const SETTLE_MS = 160;

/** Растянутая сильнее этого (или сжатая) выпечка перепекается и посреди жеста (правило 3). */
export const MAX_STRETCH = 2;

/** Желаемый запас с каждой стороны — доля стороны экрана (правило 2). */
export const OVERSCAN_SHARE = 0.25;

/** Бюджет выпечки в физических пикселях: 8 Мп — 32 МБ RGBA. */
export const MAX_BAKE_PIXELS = 8 * 1024 * 1024;

/** Правило 1: преобразование из экрана выпечки в экран текущего кадра. */
export function layerTransform(from: MapProjection, to: MapProjection): LayerTransform {
  const k = to.a / from.a;
  return { k, tx: to.x - k * from.x, ty: to.y - k * from.y };
}

/** Точка экрана кадра → та же точка в координатах выпечки (для попадания по провинции). */
export function toBake(tr: LayerTransform, x: number, y: number): { x: number; y: number } {
  return { x: (x - tr.tx) / tr.k, y: (y - tr.ty) / tr.k };
}

/** Прямоугольник экрана кадра в координатах выпечки: что из выпечки сейчас видно. */
export function visibleInBake(
  tr: LayerTransform,
  width: number,
  height: number,
): { x: number; y: number; width: number; height: number } {
  return { x: -tr.tx / tr.k, y: -tr.ty / tr.k, width: width / tr.k, height: height / tr.k };
}

/**
 * Правило 2: запас по краям. Желаемый — {@link OVERSCAN_SHARE} стороны экрана; не
 * влезает в бюджет — запас сжимается одинаково по обеим осям, вплоть до нуля (экран
 * печётся всегда, даже если он один больше бюджета). Запас кратен физическому пикселю:
 * тогда выпечка в покое ложится на экран без пересэмплирования.
 */
export function overscanFor(
  width: number,
  height: number,
  dpr: number,
  maxPixels = MAX_BAKE_PIXELS,
): Overscan {
  const screen = width * height * dpr * dpr;
  // (1 + 2s)² · экран ≤ бюджет — при равной доле s по обеим осям.
  const fit = screen > 0 ? (Math.sqrt(maxPixels / screen) - 1) / 2 : 0;
  const share = Math.max(0, Math.min(OVERSCAN_SHARE, fit));
  const snap = (side: number): number => Math.floor(side * share * dpr) / dpr;
  return { x: snap(width), y: snap(height) };
}

/** Сдвиг в физических пикселях, если выпечка ложится пиксель в пиксель, иначе `null`. */
export function exactOffset(tr: LayerTransform, dpr: number): { x: number; y: number } | null {
  if (tr.k !== 1) return null;
  const x = tr.tx * dpr;
  const y = tr.ty * dpr;
  const rx = Math.round(x);
  const ry = Math.round(y);
  // Разность двух проекций теряет последние биты мантиссы: сдвиг «ровно 37» приходит как
  // 36.99999999999999. Порог на порядки ниже всего, что видно глазу.
  return Math.abs(x - rx) < 1e-6 && Math.abs(y - ry) < 1e-6 ? { x: rx, y: ry } : null;
}

/** Правило 5: преобразование для показа в движении — сдвиг того же масштаба ложится на
 *  сетку физических пикселей. Зум остаётся как есть: его без пересэмплирования не показать. */
export function onPixelGrid(tr: LayerTransform, dpr: number): LayerTransform {
  if (tr.k !== 1) return tr;
  return { k: 1, tx: Math.round(tr.tx * dpr) / dpr, ty: Math.round(tr.ty * dpr) / dpr };
}

/** Правило 3: закрывает ли выпечка с запасом `margin` экран `width × height`. */
export function coversScreen(
  tr: LayerTransform,
  width: number,
  height: number,
  margin: Overscan,
): boolean {
  const eps = 1e-6;
  return (
    tr.k * -margin.x + tr.tx <= eps &&
    tr.k * -margin.y + tr.ty <= eps &&
    tr.k * (width + margin.x) + tr.tx >= width - eps &&
    tr.k * (height + margin.y) + tr.ty >= height - eps
  );
}

/** Что известно о кадре, чтобы решить судьбу выпечки. */
export interface MapLayerFrame {
  /** Выпечка есть, и её содержимое совпадает с текущим (правило 5). */
  readonly fresh: boolean;
  /** Из выпечки в текущий кадр. */
  readonly transform: LayerTransform;
  readonly width: number;
  readonly height: number;
  readonly dpr: number;
  /** Запас, с которым выпечка испечена. */
  readonly margin: Overscan;
  /** Камера не двигалась {@link SETTLE_MS} и не держится жестом (правило 4). */
  readonly settled: boolean;
}

/** `show` — показать имеющуюся выпечку преобразованием; `rebake` — испечь на текущей камере. */
export type MapLayerAction = 'show' | 'rebake';

export function mapLayerAction(f: MapLayerFrame): MapLayerAction {
  if (!f.fresh) return 'rebake'; // правило 6
  const { k } = f.transform;
  if (!(k > 0) || k > MAX_STRETCH || k < 1 / MAX_STRETCH) return 'rebake'; // правило 3
  if (!coversScreen(f.transform, f.width, f.height, f.margin)) return 'rebake';
  if (f.settled && !exactOffset(f.transform, f.dpr)) return 'rebake'; // правило 4
  return 'show';
}
