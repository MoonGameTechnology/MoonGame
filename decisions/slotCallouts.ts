/**
 * Слоты-выноски на арте корпуса в окне производства (переделка окна, шаг 2; решение
 * владельца 2026-10-10 — форма «Выноска»): точка на корпусе, рядом плитка слота, их
 * соединяет линия. Арт кораблём не перекрывается. Рисует выноски хозяин окна; здесь —
 * где стоит точка и плитка каждого отсека.
 *
 * 1. **Точки принадлежат картинке, а не корпусу.** Ключ таблицы — имя арта
 *    (`data-ship-art`: `cruiser`, `heavyCruiser`…), потому что один арт могут делить
 *    несколько корпусов, а у другой фракции у того же корпуса другая картинка.
 * 2. **Координаты — проценты картинки 3:2**, а не окна: хозяин кладёт слой выносок ровно
 *    на картинку, и точка остаётся на той же детали корабля при любом размере окна.
 * 3. **Отсек занимает точку своего типа** (оружие — у башни, защита — у брони), по порядку
 *    отсеков ядра (`loadoutBays`). Отсеку, которому своей точки не хватило, достаётся
 *    свободная точка любого типа: арт, общий с корпусом другой раскладки, выноски не теряет.
 * 4. **Точек меньше, чем отсеков, — выносок нет вовсе** (`null`), а не часть на картинке и
 *    часть в списке. Отсеки остаются списком под артом, как на арте без точек (рой, пираты).
 */

/** Тип отсека — как в данных корпуса (`slots`). */
export type SlotType = 'weapon' | 'defense' | 'utility' | 'universal';

/** Точка `a` на корпусе и место `t` плитки рядом, в процентах картинки [x, y]. */
export interface SlotAnchor {
  readonly type: SlotType;
  readonly a: readonly [number, number];
  readonly t: readonly [number, number];
}

/** Выноска отсека: та же пара точек, без предпочтённого типа. */
export interface SlotCallout {
  readonly a: readonly [number, number];
  readonly t: readonly [number, number];
}

/**
 * Точки на артах корпусов, которые строит окно производства. Сняты по сетке поверх самих
 * картинок (768×512) при сборке макета окна, 2026-10-10. Новый арт без строки здесь
 * показывает отсеки списком — правило 4.
 */
export const SLOT_ANCHORS: Readonly<Record<string, readonly SlotAnchor[]>> = {
  cruiser: [
    { type: 'weapon', a: [72, 21], t: [55, 9] },
    { type: 'defense', a: [47, 74], t: [72, 87] },
    { type: 'utility', a: [42, 31], t: [17, 19] },
  ],
  heavyCruiser: [
    { type: 'universal', a: [45, 31], t: [14, 15] },
    { type: 'universal', a: [69, 23], t: [33, 8] },
    { type: 'universal', a: [52, 66], t: [71, 88] },
    { type: 'universal', a: [87, 14], t: [91, 72] },
  ],
  frigate: [
    { type: 'defense', a: [34, 73], t: [60, 86] },
    { type: 'utility', a: [52, 32], t: [30, 12] },
    { type: 'utility', a: [81, 20], t: [86, 55] },
    { type: 'utility', a: [17, 56], t: [9, 31] },
  ],
  scout: [{ type: 'utility', a: [60, 30], t: [30, 14] }],
  picketFrigate: [
    { type: 'defense', a: [34, 74], t: [60, 87] },
    { type: 'utility', a: [38, 22], t: [11, 14] },
    { type: 'utility', a: [75, 49], t: [87, 73] },
  ],
  transport: [
    { type: 'defense', a: [42, 30], t: [15, 16] },
    { type: 'defense', a: [60, 62], t: [79, 85] },
    { type: 'utility', a: [24, 72], t: [11, 89] },
  ],
  fighter: [{ type: 'weapon', a: [84, 12], t: [88, 42] }],
  strikeCraft: [{ type: 'weapon', a: [38, 64], t: [20, 90] }],
  heavyStriker: [{ type: 'weapon', a: [35, 63], t: [19, 90] }],
};

/**
 * Выноски для отсеков корпуса на арте `art`, по одной на отсек в его порядке; `null` —
 * рисовать их не на чем (арта нет, у арта нет точек или точек меньше, чем отсеков).
 */
export function slotCallouts(
  art: string | undefined,
  bays: readonly { readonly type: string }[],
): SlotCallout[] | null {
  const anchors = art === undefined ? undefined : SLOT_ANCHORS[art];
  if (!anchors || bays.length === 0 || bays.length > anchors.length) return null;
  const free = anchors.map(() => true);
  const take = (i: number): SlotCallout => {
    free[i] = false;
    return { a: anchors[i]!.a, t: anchors[i]!.t };
  };
  // Сначала каждый отсек ищет точку своего типа; оставшимся — первая свободная (правило 3).
  const picked: (SlotCallout | null)[] = bays.map((b) => {
    const i = anchors.findIndex((p, k) => free[k] && p.type === b.type);
    return i < 0 ? null : take(i);
  });
  return picked.map((c) => c ?? take(free.indexOf(true)));
}
