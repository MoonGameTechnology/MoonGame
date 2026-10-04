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
 * 3. **Панорама за край запаса сдвигает выпечку, а не перепекает её.** Окно выпечки
 *    едет за камерой на целые физические пиксели ({@link recentredScroll}): готовые
 *    пиксели переезжают копией, а рисуется только открывшаяся полоса ({@link exposedStrips})
 *    по той же геометрии провинций. Раньше свайп, ушедший за запас, перепекал карту
 *    целиком посреди жеста: на 1675 провинциях — раз на свайп. Перепекается выпечка,
 *    когда при зуме она перестала покрывать экран (отдаление сжало её), когда она
 *    растянута больше {@link MAX_STRETCH} раз (тогда она заметно мыльная) или когда сдвиг
 *    не оставил бы от неё ни пикселя. Иначе во время движения показывается старая выпечка.
 * 4. **Остановилась камера — картинка должна быть чёткой.** Через {@link SETTLE_MS}
 *    без движения (и не посреди щипка) выпечка остаётся, только если она ложится
 *    пиксель в пиксель: тот же масштаб и целый сдвиг в физических пикселях. Панорама,
 *    вставшая между пикселями, не перепекает карту: камера сама встаёт на сетку выпечки
 *    ({@link gridNudge}), меньше чем на полпикселя, и глазу это не видно. Палец на
 *    телефоне двигает камеру на дробные пиксели (у экрана свой масштаб, а холст держит
 *    не больше двух пикселей на CSS-пиксель), поэтому без этого карта перепекалась после
 *    каждого свайпа, а на медленном телефоне и посреди него: между событиями пальца камера
 *    стоит дольше {@link SETTLE_MS}. На 1675 провинциях в тумане при ЦП вчетверо медленнее
 *    это 22–29 выпечек по ~40 мс за четыре свайпа. Зум перепекается один раз, когда закончился.
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

/** Насколько окно выпечки уехало от места, где её испекли (правило 3): CSS-пиксели
 *  выпечки, всегда на целый физический пиксель. */
export interface LayerScroll {
  readonly x: number;
  readonly y: number;
}

/** Окно свежей выпечки стоит там, где её испекли. */
export const NO_SCROLL: LayerScroll = { x: 0, y: 0 };

/** Правило 3: закрывает ли выпечка с запасом `margin`, окно которой сдвинуто на `scroll`,
 *  экран `width × height`. */
export function coversScreen(
  tr: LayerTransform,
  width: number,
  height: number,
  margin: Overscan,
  scroll: LayerScroll = NO_SCROLL,
): boolean {
  const eps = 1e-6;
  return (
    tr.k * (scroll.x - margin.x) + tr.tx <= eps &&
    tr.k * (scroll.y - margin.y) + tr.ty <= eps &&
    tr.k * (scroll.x + width + margin.x) + tr.tx >= width - eps &&
    tr.k * (scroll.y + height + margin.y) + tr.ty >= height - eps
  );
}

/**
 * Правило 3: куда поставить окно выпечки, чтобы экран снова встал в его середину, —
 * для панорамы (масштаб 1). Окно ездит только на целые физические пиксели: тогда копия
 * старых пикселей ложится точно туда, куда их положила бы новая выпечка.
 */
export function recentredScroll(tr: LayerTransform, dpr: number): LayerScroll {
  // `|| 0` — без минус нуля: окно на месте записывается как место.
  return { x: (-Math.round(tr.tx * dpr) || 0) / dpr, y: (-Math.round(tr.ty * dpr) || 0) / dpr };
}

/** Прямоугольник холста в физических пикселях. */
export interface PixelRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/**
 * Правило 3: что осталось без картинки на холсте `width × height`, когда окно уехало на
 * (`dx`, `dy`) физических пикселей, а старые пиксели — на столько же в обратную сторону.
 * Не больше двух полос, и они не перекрываются: вертикальная во всю высоту,
 * горизонтальная — в оставшуюся ширину.
 */
export function exposedStrips(width: number, height: number, dx: number, dy: number): PixelRect[] {
  const w = Math.min(Math.abs(dx), width);
  const h = Math.min(Math.abs(dy), height);
  const strips: PixelRect[] = [];
  // Окно уехало вправо — картинка влево, новым стал правый край (и так же по вертикали).
  if (w > 0) strips.push({ x: dx > 0 ? width - w : 0, y: 0, width: w, height });
  if (h > 0 && w < width)
    strips.push({ x: dx > 0 ? 0 : w, y: dy > 0 ? height - h : 0, width: width - w, height: h });
  return strips;
}

/**
 * Правило 4: на сколько CSS-пикселей сдвинуть проекцию кадра, чтобы панорама встала на
 * сетку своей выпечки. Меньше половины физического пикселя по каждой оси. Камера
 * сдвигается на столько же: её сдвиг входит в проекцию слагаемым.
 */
export function gridNudge(tr: LayerTransform, dpr: number): { x: number; y: number } {
  return { x: Math.round(tr.tx * dpr) / dpr - tr.tx, y: Math.round(tr.ty * dpr) / dpr - tr.ty };
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
  /** Насколько окно выпечки уехало с тех пор (правило 3). */
  readonly scroll: LayerScroll;
  /** Камера не двигалась {@link SETTLE_MS} и не держится жестом (правило 4). */
  readonly settled: boolean;
}

/**
 * `show` — показать имеющуюся выпечку преобразованием; `scroll` — сдвинуть её окно в
 * {@link recentredScroll} и дорисовать {@link exposedStrips} (правило 3); `snap` — сдвинуть
 * камеру на {@link gridNudge} и решить заново (правило 4); `rebake` — испечь на текущей камере.
 */
export type MapLayerAction = 'show' | 'scroll' | 'snap' | 'rebake';

export function mapLayerAction(f: MapLayerFrame): MapLayerAction {
  if (!f.fresh) return 'rebake'; // правило 6
  const { k } = f.transform;
  if (!(k > 0) || k > MAX_STRETCH || k < 1 / MAX_STRETCH) return 'rebake'; // правило 3
  // Тот же масштаб: выпечку можно сдвигать и копировать, не пересэмплируя.
  const pan = k === 1;
  if (f.settled && !exactOffset(f.transform, f.dpr)) return pan ? 'snap' : 'rebake'; // правило 4
  // Покрытие судится по тому, что покажут: в движении панорама стоит на целом пикселе.
  const shown = onPixelGrid(f.transform, f.dpr);
  if (coversScreen(shown, f.width, f.height, f.margin, f.scroll)) return 'show';
  if (!pan) return 'rebake'; // правило 3: отдаление сжало выпечку
  const to = recentredScroll(f.transform, f.dpr);
  const keeps =
    Math.abs(to.x - f.scroll.x) < f.width + 2 * f.margin.x &&
    Math.abs(to.y - f.scroll.y) < f.height + 2 * f.margin.y;
  return keeps ? 'scroll' : 'rebake';
}
