/**
 * Сводная граница видимости: как множество радарных кругов становится ОДНОЙ границей
 * и чем внешний слой отличается от внутреннего (REFM-120).
 *
 * Радаров у игрока много, и их круги перекрываются. Рисовать их по одному нельзя: на
 * карте получалась бы паутина из колец, по которой невозможно прочесть главное — где
 * кончается обзор. Поэтому круги сводятся в одну область: общая заливка плюс один
 * контур по ВНЕШНЕМУ краю. Вся эта сборка стояла в кадре голыми числами, и из неё не
 * читалось ни почему круги идут раздельными подпутями, ни почему тиров ровно два.
 *
 * 1. **Каждый круг — свой подпуть.** Дуги в общем пути соединяются прямыми: без
 *    `moveTo` перед каждой из них два разнесённых радара стянуло бы хордой, и вместо
 *    границы обзора игрок увидел бы натянутые между радарами верёвки.
 * 2. **Контур — это заливка МИНУС её сжатая копия.** Так контур обводит только внешний
 *    край объединения: круг, целиком лежащий внутри другого, не даёт своего кольца —
 *    «граница видимости» ровно одна, а не по кольцу на источник. `drawSightFrontier`
 *    пересекает обратные клипы внутренних кругов и рисует контур прямо на карте;
 *    полноэкранная оффскрин-канва больше не нужна.
 * 3. **Сжатие не может съесть круг целиком.** Круг тоньше линии контура при сжатии
 *    ушёл бы в неположительный радиус; такая дуга не исчезает, а выворачивается и
 *    выедает дыру в уже собранной заливке — дыра посреди зоны обзора читалась бы как
 *    слепое пятно, которого нет.
 * 4. **Пустой набор — в отрисовку не заходим.** Это не защита от невозможного: игрок
 *    без единого радара — обычное начало партии, а этап контура требует отдельных
 *    клипов; пустой набор не должен создавать их каждый кадр.
 * 5. **Внутренний тир читается СИЛЬНЕЕ внешнего по ВСЕМ трём признакам** — заливка,
 *    контур, толщина линии. Внешний край — дальность засечки (там контакт виден
 *    пятном), внутренний — дальность опознания (там видно, ЧТО это). Сравняй их — и
 *    граница опознания растворится во внешней, а именно она отвечает на вопрос
 *    «долетит ли мой разведчик до места, где я разгляжу флот».
 * 6. **У ВЫБРАННОГО источника внешнее кольцо ПУНКТИРНОЕ, внутреннее — сплошное и
 *    ярче.** Это та же пара «засечка / опознание», но одного объекта поверх сводной
 *    границы; пунктир и здесь означает «тут только засечка». Сплошным внешним кольцом
 *    оно бы обещало опознание по всей дальности.
 * 7. **Кольцо неположительного экранного радиуса не рисуется** — при сильном отдалении
 *    радиус схлопывается в ноль, и `arc` отрицательного радиуса бросает.
 * 8. **Видимость тира держит СБОРКА, а не кадр** (REFM-120.1). Раньше в отрисовке стояли
 *    гейты «прозрачность > 0» и «толщина > 0», недостижимые по построению: числа тира
 *    приходят только отсюда, и все они положительны. Гейты сняты — они сторожили не
 *    падение, а работу впустую (нулевая прозрачность — законная заливка «ничем», нулевая
 *    толщина — пустое кольцо), причём в конфигурации, которой не бывает. Сравни с
 *    правилом 4: там проверка ОСТАЁТСЯ, потому что пустой набор радаров — обычное начало
 *    партии, а не невозможность. Инвариант «тир видим» теперь заперт тестом по
 *    `SIGHT_TIERS`: он падает на сборке, тогда как гейт молчал бы в кадре вечно. Отсюда и
 *    перечень тиров — третий тир попадёт под проверку сам, а гейт пропустил бы его молча.
 * 9. **Обратные клипы — плитками вдоль кромки, а не во весь экран.** Холст строит маску
 *    каждого клипа на всю его площадь, и полноэкранный прямоугольник без диска обходился
 *    в маску экрана на каждый круг: 24 мира на телефоне стоили около 10 мс растра на
 *    обзоре и около 24 мс у дома. Поэтому контур рисуется плитками
 *    ({@link frontierTiles}): каждая вычитает только задевшие её диски и заливает только
 *    задевшие её круги, а плитка без кругов или целиком внутри одного диска пропускается.
 *    Края плиток стоят на целых физических пикселях, так что каждый пиксель рисуется
 *    ровно один раз и швов нет. Объединение целиком за экраном — рисовать нечего.
 */

/**
 * Слои обзора, ПЕРЕЧНЕМ, а не типом: тип из него выводится, а не наоборот (правило 8).
 * Внешний — дальность засечки, внутренний — дальность опознания.
 */
export const SIGHT_TIERS = ['signature', 'reveal'] as const;

/** Слой обзора: внешний — дальность засечки, внутренний — дальность опознания. */
export type SightTier = (typeof SIGHT_TIERS)[number];

/** Круг обзора на экране. */
export interface ScreenCircle {
  x: number;
  y: number;
  r: number;
}

/** Как выглядит сводная граница тира (правило 5). */
export interface FrontierLook {
  /** Толщина контура; она же — сжатие вычитаемой копии (правило 2). */
  lineWidth: number;
  /** Прозрачность общей заливки. */
  fillAlpha: number;
  /** Прозрачность контура. */
  strokeAlpha: number;
}

const FRONTIER: Record<SightTier, FrontierLook> = {
  // Внешний край: почти прозрачная дымка — она отвечает лишь «сюда добивает засечка».
  signature: { lineWidth: 0.8, fillAlpha: 0.012, strokeAlpha: 0.14 },
  // Внутренний: заметно плотнее и толще — это рабочая граница, по ней ведут разведку.
  reveal: { lineWidth: 1, fillAlpha: 0.02, strokeAlpha: 0.26 },
};

/** Вид сводной границы — одной записью, чтобы тиры не сползлись друг к другу. */
export function frontierLook(tier: SightTier): FrontierLook {
  return FRONTIER[tier];
}

/** Как выглядит собственное кольцо выбранного источника (правило 6). */
export interface OwnRingLook {
  /** Пунктир; пустой массив — сплошная линия. */
  dash: readonly number[];
  alpha: number;
}

const OWN_RING: Record<SightTier, OwnRingLook> = {
  // «Здесь только засечка» — пунктиром, как и всё неточное на этой карте.
  signature: { dash: [3, 6], alpha: 0.32 },
  // «Здесь опознание» — сплошной и ярче.
  reveal: { dash: [], alpha: 0.5 },
};

/** Вид собственного кольца выбранного источника (правило 6). */
export function ownRingLook(tier: SightTier): OwnRingLook {
  return OWN_RING[tier];
}

/**
 * Круги, участвующие в пути при сжатии на `inset`, уже со сжатым радиусом
 * (правила 1, 3). Сжатие `0` даёт саму заливку.
 */
export function unionArcs(circles: readonly ScreenCircle[], inset: number): ScreenCircle[] {
  const out: ScreenCircle[] = [];
  for (const c of circles) {
    const r = c.r - inset;
    if (r > 0) out.push({ x: c.x, y: c.y, r }); // правило 3
  }
  return out;
}

/** Поле коробки за краем кругов (правило 9): сглаживание края при любой плотности экрана. */
const FRONTIER_MARGIN = 4;

/** Сторона плитки контура в физических пикселях (правило 9). */
const FRONTIER_TILE = 64;

/**
 * Коробка объединения (правило 9): круги `circles` с полем {@link FRONTIER_MARGIN}, в целых
 * единицах, обрезанная по экрану `width × height` с запасом в единицу.
 * `null` — ни один круг не заходит на экран.
 */
export function frontierBox(
  circles: readonly ScreenCircle[],
  width: number,
  height: number,
): { x: number; y: number; width: number; height: number } | null {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const c of circles) {
    if (c.r <= 0) continue;
    x0 = Math.min(x0, c.x - c.r);
    y0 = Math.min(y0, c.y - c.r);
    x1 = Math.max(x1, c.x + c.r);
    y1 = Math.max(y1, c.y + c.r);
  }
  const left = Math.max(-1, Math.floor(x0) - FRONTIER_MARGIN);
  const top = Math.max(-1, Math.floor(y0) - FRONTIER_MARGIN);
  const right = Math.min(width + 1, Math.ceil(x1) + FRONTIER_MARGIN);
  const bottom = Math.min(height + 1, Math.ceil(y1) + FRONTIER_MARGIN);
  if (right <= left || bottom <= top) return null;
  return { x: left, y: top, width: right - left, height: bottom - top };
}

/** Плитка контура (правило 9) в единицах экрана. */
export interface FrontierTile {
  x: number;
  y: number;
  width: number;
  height: number;
  /** Номера внешних кругов, задевших плитку: плитка заливает их объединение. */
  fill: number[];
  /** Номера внутренних кругов, задевших плитку: плитка вычитает их диски. */
  cut: number[];
}

/** Задевает ли круг прямоугольник, считая поле `margin` под сглаживание. */
function touches(
  c: ScreenCircle,
  x: number,
  y: number,
  w: number,
  h: number,
  margin: number,
): boolean {
  const dx = Math.max(x - c.x, 0, c.x - x - w);
  const dy = Math.max(y - c.y, 0, c.y - y - h);
  return dx * dx + dy * dy < (c.r + margin) ** 2;
}

/** Лежит ли прямоугольник внутри круга целиком, с полем `margin` от его края. */
function inside(
  c: ScreenCircle,
  x: number,
  y: number,
  w: number,
  h: number,
  margin: number,
): boolean {
  const dx = Math.max(Math.abs(x - c.x), Math.abs(x + w - c.x));
  const dy = Math.max(Math.abs(y - c.y), Math.abs(y + h - c.y));
  return c.r > margin && dx * dx + dy * dy <= (c.r - margin) ** 2;
}

/**
 * Плитки контура (правило 9): сетка со стороной {@link FRONTIER_TILE} физических пикселей
 * по коробке внешних кругов `outer`, без плиток, которых не задел ни один внешний круг или
 * которые целиком лежат в одном из внутренних `inner`. Плотность экрана `dpr` ставит края
 * плиток на целые физические пиксели. Номера в `fill` и `cut` — по порядку `outer` и `inner`.
 */
export function frontierTiles(
  outer: readonly ScreenCircle[],
  inner: readonly ScreenCircle[],
  width: number,
  height: number,
  dpr: number,
): FrontierTile[] {
  const box = frontierBox(outer, width, height);
  if (!box) return [];
  const margin = Math.max(1, 1 / dpr); // сглаживание края — не уже физического пикселя
  const left = Math.max(0, Math.floor(box.x * dpr));
  const top = Math.max(0, Math.floor(box.y * dpr));
  const right = Math.ceil((box.x + box.width) * dpr);
  const bottom = Math.ceil((box.y + box.height) * dpr);
  const tiles: FrontierTile[] = [];
  for (let ty = top; ty < bottom; ty += FRONTIER_TILE) {
    for (let tx = left; tx < right; tx += FRONTIER_TILE) {
      const x = tx / dpr;
      const y = ty / dpr;
      const w = Math.min(tx + FRONTIER_TILE, right) / dpr - x;
      const h = Math.min(ty + FRONTIER_TILE, bottom) / dpr - y;
      const fill: number[] = [];
      outer.forEach((c, i) => {
        if (touches(c, x, y, w, h, margin)) fill.push(i);
      });
      if (!fill.length || inner.some((c) => inside(c, x, y, w, h, margin))) continue;
      const cut: number[] = [];
      inner.forEach((c, i) => {
        if (touches(c, x, y, w, h, margin)) cut.push(i);
      });
      tiles.push({ x, y, width: w, height: h, fill, cut });
    }
  }
  return tiles;
}

/** Есть ли что рисовать в тире (правило 4). */
export function frontierShown(circles: readonly ScreenCircle[]): boolean {
  return unionArcs(circles, 0).length > 0;
}

/** Рисовать ли собственное кольцо такого экранного радиуса (правило 7). */
export function ownRingShown(radius: number): boolean {
  return radius > 0;
}
