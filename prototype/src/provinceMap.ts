/**
 * Политическая карта: из чего складывается мозаика провинций (REFM-61).
 *
 * Каждый сектор — клетка взвешенной мозаики (power diagram) по центрам секторов:
 * клетки делят карту без зазоров, поэтому больший `size` отъедает территорию у соседей.
 * Отсюда правила, которые легко нарушить незаметно.
 *
 * 1. **Пустой узел — НЕ провинция.** Путевые точки в пустоте ничьи, и семя от них
 *    отъело бы территорию у настоящих соседей: в мозаике каждая клетка чья-то, лишнее
 *    семя искажает границы всех вокруг, а не только своего места.
 * 2. **Узел без мира пропускается.** Карта не обязана быть согласованной, чтобы
 *    рисоваться: ссылка на мир, которого нет в состоянии, — не повод падать.
 * 3. **Вес растёт КВАДРАТИЧНО по масштабу.** Вес меряется в экранных пикселях², а
 *    размер мира — в мировых единицах. Без квадрата доли территорий менялись бы при
 *    зуме, и карта «перекраивалась» бы на приближении — границы ползли бы сами собой.
 * 4. **Клетки обрезаются по границе КАРТЫ, а не по экрану.** Иначе крайние провинции
 *    растягиваются до края окна и у карты просто нет края.
 * 5. **Отступ рамки не меньше пола.** Он берётся долей от ширины карты, но на узкой
 *    карте эта доля выродилась бы почти в ноль и внешние клетки прижались бы к рамке.
 *
 * Владелец в семя кладётся тот, что игроку ИЗВЕСТЕН (см. `staticLayerCache.ts`,
 * REFM-60): скрытый захват не должен перекрашивать карту.
 */

/** Множитель веса: `size` мира → площадь в экранных пикселях². */
export const SEED_WEIGHT = 9000;

/** Доля ширины карты, уходящая в отступ рамки. */
export const CLIP_PAD_RATIO = 0.05;

/** Пол отступа рамки в мировых единицах (правило 5). */
export const CLIP_PAD_MIN = 40;

/** Узел карты в том виде, в каком его различает политическая заливка. */
export interface ProvinceNode {
  id: string;
  /** Тип сектора; `'empty'` — путевая точка, а не провинция. */
  sector: string;
}

/** Семя мозаики: центр, вес, известный владелец и тип сектора. */
export interface ProvinceSeed {
  x: number;
  y: number;
  w: number;
  owner: string | null;
  kind: string;
}

/** Является ли узел провинцией (правило 1). */
export function isProvince(sector: string): boolean {
  return sector !== 'empty';
}

/** Вес семени: размер мира в экранных пикселях² при данном масштабе (правило 3). */
export function seedWeight(size: number, scale: number): number {
  return size * SEED_WEIGHT * scale * scale;
}

/** Что нужно знать про узел, чтобы сделать из него семя. */
export interface SeedSource {
  /** Размер мира; `null`/`undefined` — мира нет, узел пропускается (правило 2). */
  size: number | null | undefined;
  /** Экранные координаты центра. */
  at: { x: number; y: number };
  /** Владелец, каким его знает игрок. */
  owner: string | null;
}

/**
 * Собрать семена мозаики. `sourceOf` возвращает `null` для узла, которого нет в
 * состоянии; пустые узлы отсеиваются до вызова.
 */
export function provinceSeeds<T extends ProvinceNode>(
  nodes: readonly T[],
  scale: number,
  sourceOf: (node: T) => SeedSource | null,
): ProvinceSeed[] {
  const seeds: ProvinceSeed[] = [];
  for (const n of nodes) {
    if (!isProvince(n.sector)) continue; // правило 1
    const src = sourceOf(n);
    if (!src || src.size == null) continue; // правило 2
    seeds.push({
      x: src.at.x,
      y: src.at.y,
      w: seedWeight(src.size, scale),
      owner: src.owner,
      kind: n.sector,
    });
  }
  return seeds;
}

/** Границы карты в мировых единицах. */
export interface MapBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

/** Отступ рамки в мировых единицах: доля ширины, но не меньше пола (правило 5). */
export function clipPad(bounds: MapBounds): number {
  return Math.max(CLIP_PAD_MIN, (bounds.maxX - bounds.minX) * CLIP_PAD_RATIO);
}

/**
 * Прямоугольник обрезки в МИРОВЫХ единицах: границы карты плюс отступ (правило 4).
 * Проецирует его вызывающий — так рамка едет и масштабируется вместе с камерой.
 */
export function clipRect(bounds: MapBounds): {
  topLeft: { x: number; y: number };
  bottomRight: { x: number; y: number };
} {
  const pad = clipPad(bounds);
  return {
    topLeft: { x: bounds.minX - pad, y: bounds.minY - pad },
    bottomRight: { x: bounds.maxX + pad, y: bounds.maxY + pad },
  };
}

/** Четыре угла обрезки по часовой стрелке — в том виде, какой ждёт заливка. */
export function clipPolygon(
  topLeft: { x: number; y: number },
  bottomRight: { x: number; y: number },
): Array<[number, number]> {
  return [
    [topLeft.x, topLeft.y],
    [bottomRight.x, topLeft.y],
    [bottomRight.x, bottomRight.y],
    [topLeft.x, bottomRight.y],
  ];
}
