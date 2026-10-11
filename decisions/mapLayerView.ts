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
 *    это 22–29 выпечек по ~40 мс за четыре свайпа. Зум перепекается один раз, когда
 *    закончился, — в фоне, по правилу 7.
 * 5. **Панорама сдвигает картинку на целые пиксели.** Пока камера едет, выпечка того же
 *    масштаба ставится со сдвигом, округлённым до физического пикселя ({@link onPixelGrid}):
 *    это копия, а не пересэмплирование всего экрана (без GPU — десятки миллисекунд на
 *    кадр). Расхождение с настоящей камерой — меньше полупикселя и только в движении:
 *    в покое правило 4 требует точной выпечки.
 * 6. **Содержимое важнее камеры.** Сменился владелец провинции, туман открыл новую,
 *    повернулся экран — выпечка устарела и перепекается сразу, где бы ни была камера
 *    (правило подписи — `staticLayerCache.ts`). Показать старую политическую карту
 *    хоть на кадр значит выдать то, что туман скрывает, или соврать о захвате.
 * 7. **Выпечка ради чёткости печётся в фоне.** Пока старая выпечка покрывает экран и
 *    растянута не больше {@link MAX_STRETCH}, новая ей нужна только ради чёткости: камера
 *    встала после зума или до края выпечки осталось меньше {@link RESERVE_SHARE} экрана.
 *    Такая выпечка рисуется во втором холсте полосами, по одной за кадр в бюджете кадра
 *    ({@link bakeBudgetMs}), а кадр всё это время показывает старую; готова — холсты
 *    меняются местами. Раньше она шла одним куском посреди кадра. Полоса меряется не
 *    строками, а работой провинций, которые она режет ({@link bakeWork}, {@link bandRows}):
 *    пустой край карты вдесятеро дешевле её середины. Сразу
 *    печётся только то, что ждать не может: новое содержимое (правило 6), выпечка,
 *    переставшая покрывать экран или растянутая больше {@link MAX_STRETCH}. Если фоновая
 *    выпечка к этому кадру годится, дописываются только её оставшиеся полосы
 *    ({@link bakeJobFate}).
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

/** Во время зума новая выпечка начинается в фоне, когда старая уже не покрыла бы экран,
 *  выросший на эту долю стороны с каждого края (правило 7): отдаление дойдёт до её края
 *  не сразу. */
export const RESERVE_SHARE = 0.1;

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
 *  экран `width × height` — выросший на долю `reserve` стороны с каждого края (правило 7). */
export function coversScreen(
  tr: LayerTransform,
  width: number,
  height: number,
  margin: Overscan,
  scroll: LayerScroll = NO_SCROLL,
  reserve = 0,
): boolean {
  const eps = 1e-6;
  const rx = reserve * width;
  const ry = reserve * height;
  return (
    tr.k * (scroll.x - margin.x) + tr.tx <= eps - rx &&
    tr.k * (scroll.y - margin.y) + tr.ty <= eps - ry &&
    tr.k * (scroll.x + width + margin.x) + tr.tx >= width + rx - eps &&
    tr.k * (scroll.y + height + margin.y) + tr.ty >= height + ry - eps
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
 * камеру на {@link gridNudge} и решить заново (правило 4); `refresh` — показать имеющуюся, а
 * новую на текущей камере печь в фоне (правило 7); `rebake` — испечь на текущей камере сейчас.
 */
export type MapLayerAction = 'show' | 'scroll' | 'snap' | 'refresh' | 'rebake';

export function mapLayerAction(f: MapLayerFrame): MapLayerAction {
  if (!f.fresh) return 'rebake'; // правило 6
  const { k } = f.transform;
  if (!(k > 0) || k > MAX_STRETCH || k < 1 / MAX_STRETCH) return 'rebake'; // правило 3
  // Покрытие судится по тому, что покажут: в движении панорама стоит на целом пикселе.
  const shown = onPixelGrid(f.transform, f.dpr);
  if (k !== 1) {
    // Правило 3: отдаление сжало выпечку — край открылся бы уже в этом кадре.
    if (!coversScreen(shown, f.width, f.height, f.margin, f.scroll)) return 'rebake';
    // Правило 7: выпечка ещё годится, но нужна новая — на остановке (правило 4) или впрок,
    // пока до её края не дошло. Растяжение до MAX_STRETCH впрок не печётся: на зуме
    // приближения выпечка, начатая на полпути, мешала бы самому жесту, а покрывает экран и так.
    if (f.settled || !coversScreen(shown, f.width, f.height, f.margin, f.scroll, RESERVE_SHARE))
      return 'refresh';
    return 'show';
  }
  // Тот же масштаб: выпечку можно сдвигать и копировать, не пересэмплируя.
  if (f.settled && !exactOffset(f.transform, f.dpr)) return 'snap'; // правило 4
  if (coversScreen(shown, f.width, f.height, f.margin, f.scroll)) return 'show';
  const to = recentredScroll(f.transform, f.dpr);
  const keeps =
    Math.abs(to.x - f.scroll.x) < f.width + 2 * f.margin.x &&
    Math.abs(to.y - f.scroll.y) < f.height + 2 * f.margin.y;
  return keeps ? 'scroll' : 'rebake';
}

/** Фоновая выпечка (правило 7) глазами текущего кадра. */
export interface BakeJobFrame {
  /** Она печёт текущее содержимое (правило 6). */
  readonly fresh: boolean;
  /** Из её выпечки в текущий кадр. Её окно не сдвигается: она ещё не на экране. */
  readonly transform: LayerTransform;
  /** Запас, с которым она печётся. */
  readonly margin: Overscan;
  /** Она печётся на масштабе показанной ради чёткого рельефа, а не догоняет зум. */
  readonly final: boolean;
}

/** `keep` — печь дальше, по полосе за кадр; `finish` — дописать сейчас и показать в этом же
 *  кадре; `drop` — бросить. */
export type BakeJobFate = 'keep' | 'finish' | 'drop';

/**
 * Правило 7: что делать с фоновой выпечкой в этом кадре. `layer` — показанная выпечка,
 * `action` — что о ней решено ({@link mapLayerAction}). Фоновая нужна, только пока её можно
 * показать (правила 3 и 6) и пока она не дальше от камеры, чем показанная. Когда показанную
 * пришлось бы перепечь сразу, а фоновая годится, дописать её оставшиеся полосы дешевле, чем
 * печь всё заново.
 */
export function bakeJobFate(
  layer: MapLayerFrame,
  action: MapLayerAction,
  job: BakeJobFrame,
): BakeJobFate {
  if (!job.fresh) return 'drop';
  const { k } = job.transform;
  const usable =
    k > 0 &&
    k <= MAX_STRETCH &&
    k >= 1 / MAX_STRETCH &&
    coversScreen(onPixelGrid(job.transform, layer.dpr), layer.width, layer.height, job.margin);
  if (!usable) return 'drop';
  if (action === 'rebake') return 'finish';
  // Выпечка ради рельефа печётся на масштабе показанной: зум сделал её такой же неточной.
  if (k !== 1 && job.final) return 'drop';
  // Ближе к камере, чем показанная, — лучше её, и на остановке, где ляжет не точно: бросать
  // её там значило бы, что медленное устройство, пока зум идёт штрихами, не допечёт ни одной.
  return Math.abs(Math.log(k)) > Math.abs(Math.log(layer.transform.k)) ? 'drop' : 'keep';
}

/** Бюджет фоновой выпечки на кадр (правило 7): половина кадра при нынешней частоте, в этих
 *  пределах. Медленному кадру достаётся больше: иначе выпечка тянулась бы десятки кадров. */
export const MIN_BAKE_BUDGET_MS = 6;
export const MAX_BAKE_BUDGET_MS = 24;

export function bakeBudgetMs(fps: number): number {
  if (!(fps > 0)) return MIN_BAKE_BUDGET_MS;
  return Math.min(MAX_BAKE_BUDGET_MS, Math.max(MIN_BAKE_BUDGET_MS, 500 / fps));
}

/** Работа полосы в пикселях провинций (правило 7): провинция стоит полосе, как столько её
 *  пикселей, — её путь обводится целиком, где бы полоса её ни резала; пиксель вне
 *  провинций (стекло, очистка, растр полосы) — эту долю пикселя внутри. На 1675 провинциях
 *  цена полосы по такой работе ошибается до ~1,5 раза (p95), по числу строк — в 6–11 раз:
 *  пустой край карты вдесятеро дешевле её середины. */
export const CELL_WORK = 1500;
export const EMPTY_WORK = 0.1;

/**
 * Правило 7: работа выпечки `width × height` пикселей холста нарастающим итогом — `work[r]`
 * для её строк `[0, r)`. `boxes` — рамки провинций (x0, y0, x1, y1 подряд) в координатах
 * выпечки, точка `p` которых лежит в пикселе холста `p · scale + offset`. Пиксели провинции —
 * пиксели её рамки, её {@link CELL_WORK} размазана по её строкам.
 */
export function bakeWork(
  boxes: ArrayLike<number>,
  width: number,
  height: number,
  scale: number,
  offset: { readonly x: number; readonly y: number },
): Float64Array {
  const step = new Float64Array(height + 1);
  for (let i = 0; i + 3 < boxes.length; i += 4) {
    const x0 = Math.max(0, boxes[i]! * scale + offset.x);
    const x1 = Math.min(width, boxes[i + 2]! * scale + offset.x);
    const y0 = Math.max(0, Math.floor(boxes[i + 1]! * scale + offset.y));
    const y1 = Math.min(height, Math.ceil(boxes[i + 3]! * scale + offset.y));
    if (x1 <= x0 || y1 <= y0) continue;
    const perRow = x1 - x0 + CELL_WORK / (y1 - y0);
    step[y0] = step[y0]! + perRow;
    step[y1] = step[y1]! - perRow;
  }
  const work = new Float64Array(height + 1);
  let row = 0;
  for (let r = 0; r < height; r++) {
    row += step[r]!;
    work[r + 1] = work[r]! + Math.max(0, row) + EMPTY_WORK * width;
  }
  return work;
}

/** Первая полоса — эта доля работы выпечки: цены работы ещё никто не знает. */
export const FIRST_BAND_SHARE = 1 / 16;

/** Самая узкая полоса — столько строк или эта доля выпечки, что больше: выпечка кончается
 *  за ограниченное число кадров, какой бы дорогой ни была строка. */
export const MIN_BAND_ROWS = 32;
export const MIN_BAND_SHARE = 1 / 32;

/** Меньше этого полоса не стоит, что бы ни показали часы: браузер огрубляет их до 0,1–1 мс,
 *  и дешёвая полоса, измеренная в ноль, пообещала бы, что всё остальное бесплатно. */
export const MIN_BAND_MS = 1;

/** Что известно о фоновой выпечке, чтобы отмерить ей следующую полосу. */
export interface BandPlan {
  /** Работа её строк нарастающим итогом ({@link bakeWork}). */
  readonly work: ArrayLike<number>;
  /** Уже нарисовано сверху. */
  readonly done: number;
  /** Сколько стоили нарисованные полосы вместе, мс. */
  readonly paintedMs: number;
  /** Строк в прошлой полосе и сколько она стоила, мс. */
  readonly lastRows: number;
  readonly lastMs: number;
  readonly budgetMs: number;
  /** Сколько выпечка уже потратила в этом кадре до полосы (своё начало), мс. */
  readonly spentMs: number;
}

/**
 * Правило 7: сколько строк нарисовать в этом кадре. Строки неравны, поэтому полоса меряется
 * работой ({@link bakeWork}), а цена работы — средняя по нарисованным полосам или прошлой
 * полосы, что дороже: прошлая ближе всех к следующей. Остаток уже самой узкой полосы
 * дописывается вместе с ней. `0` — в этом кадре полосы нет: начало выпечки уже съело
 * полбюджета.
 */
export function bandRows(p: BandPlan): number {
  const w = p.work;
  const total = w.length - 1;
  const left = total - p.done;
  if (left <= 0) return 0;
  const narrowest = Math.max(MIN_BAND_ROWS, Math.ceil(total * MIN_BAND_SHARE));
  let reach: number;
  if (p.done === 0) {
    if (p.spentMs >= p.budgetMs / 2) return 0;
    reach = w[total]! * FIRST_BAND_SHARE;
  } else {
    const rate = Math.max(
      p.paintedMs / (w[p.done]! - w[0]!),
      Math.max(p.lastMs, MIN_BAND_MS) / (w[p.done]! - w[p.done - p.lastRows]!),
    );
    reach = w[p.done]! + (p.budgetMs - p.spentMs) / rate;
  }
  // Последняя строка, чей нарастающий итог не дальше `reach`.
  let lo = p.done;
  let hi = total;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (w[mid]! <= reach) lo = mid;
    else hi = mid - 1;
  }
  const rows = Math.max(narrowest, lo - p.done);
  return left - rows < narrowest ? left : rows;
}
