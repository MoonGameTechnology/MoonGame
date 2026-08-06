/**
 * Во что попал палец: пороги тапа, ближайшая цель, щипок и рамка выделения (REFM-33).
 *
 * Здесь чистая геометрия ввода — та часть управления камерой, которую иначе проверить
 * нечем: она живёт в обработчиках указателя, а те требуют настоящих событий браузера.
 *
 * Правила, которые стоит проверять тестом, а не глазами:
 *
 *  · **палец дрожит сильнее мыши.** Порог «это уже протяжка, а не тап» на касании
 *    шире: иначе каждый тап пальцем считался бы панорамой и приказ пропадал бы.
 *  · **выбирается БЛИЖАЙШАЯ цель, а не первая попавшаяся.** Объекты перекрываются
 *    (кольцо флотов на орбите одного мира), и обход по порядку отдал бы игроку не то,
 *    во что он целился.
 *  · **щипок не только масштабирует, но и ВЕЗЁТ камеру.** Одним пальцем на телефоне
 *    целятся, поэтому без переноса середины щипка камера при вооружённом приказе была
 *    заперта, а цель за краем экрана — недостижима.
 *  · **пустая рамка с модификатором не трогает группу.** Shift-рамка «добирает»
 *    флоты; промах по пустому месту не должен стирать уже собранное.
 */

/** Порог «протяжка, а не тап», в пикселях карты. */
export function tapSlop(touch: boolean): number {
  return touch ? 11 : 6;
}

/** Радиус попадания по флоту: под палец он шире (правило цели в 44 px). */
export function pickRadius(touch: boolean): number {
  return touch ? 24 : 16;
}

/** Сдвинулся ли указатель настолько, что это уже протяжка. */
export function movedBeyondSlop(
  from: { x: number; y: number } | null,
  to: { x: number; y: number },
  touch: boolean,
): boolean {
  if (!from) return false;
  return Math.hypot(to.x - from.x, to.y - from.y) > tapSlop(touch);
}

/**
 * Ближайший кандидат в радиусе `r` — НЕ первый по порядку обхода. Перекрывающиеся
 * объекты так разрешаются в тот, во который игрок целился.
 */
export function nearestHit<T>(
  items: Iterable<T>,
  pos: (t: T) => { x: number; y: number } | null,
  mx: number,
  my: number,
  r: number,
): T | null {
  let best: T | null = null;
  let bd = r;
  for (const it of items) {
    const c = pos(it);
    if (!c) continue;
    const d = Math.hypot(mx - c.x, my - c.y);
    if (d < bd) {
      bd = d;
      best = it;
    }
  }
  return best;
}

/** Шаг щипка: во сколько раз изменился масштаб и куда уехала середина между пальцами. */
export interface PinchStep {
  scale: number;
  dx: number;
  dy: number;
}

/** Расстояние и середина между двумя пальцами. */
export function pinchOf(
  a: { x: number; y: number },
  b: { x: number; y: number },
): { dist: number; mid: { x: number; y: number } } {
  return {
    dist: Math.hypot(a.x - b.x, a.y - b.y),
    mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
  };
}

/**
 * Насколько щипок изменился с прошлого кадра. Прошлого расстояния не было (палец
 * только лёг) — масштаб не трогаем: `scale = 1`. Перенос середины идёт ОТДЕЛЬНО от
 * масштаба и не мешает ему: масштабирование уже удержало точку под пальцами.
 */
export function pinchStep(
  prev: { dist: number; mid: { x: number; y: number } } | null,
  cur: { dist: number; mid: { x: number; y: number } },
): PinchStep {
  if (!prev || prev.dist <= 0) return { scale: 1, dx: 0, dy: 0 };
  return {
    scale: cur.dist / prev.dist,
    dx: cur.mid.x - prev.mid.x,
    dy: cur.mid.y - prev.mid.y,
  };
}

/** Прямоугольник выделения по двум углам, в любом порядке. */
export interface Box {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/** Привести рамку к виду «левый верхний → правый нижний»: тянуть можно в любую сторону. */
export function normalizeBox(box: Box): Box {
  return {
    x1: Math.min(box.x1, box.x2),
    y1: Math.min(box.y1, box.y2),
    x2: Math.max(box.x1, box.x2),
    y2: Math.max(box.y1, box.y2),
  };
}

/** Точка внутри рамки (границы включительно — объект на краю считается пойманным). */
export function insideBox(box: Box, p: { x: number; y: number }): boolean {
  const n = normalizeBox(box);
  return p.x >= n.x1 && p.x <= n.x2 && p.y >= n.y1 && p.y <= n.y2;
}

/**
 * Новое выделение после рамки. С модификатором рамка ДОБИРАЕТ (Shift-сбор
 * накопительный), без него — заменяет. Пустая рамка с модификатором не трогает группу:
 * промах по пустому месту не должен стирать уже собранное.
 */
export function boxSelection(
  current: readonly string[],
  picked: readonly string[],
  additive: boolean,
): string[] {
  if (picked.length === 0) return additive ? [...current] : [];
  if (!additive) return [...picked];
  return [...new Set([...current, ...picked])];
}
