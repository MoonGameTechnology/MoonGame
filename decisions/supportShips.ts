import type { GameData, UnitDef } from '../packages/shared-core/src/index';

/**
 * Корабли поддержки (ROS-SUP-1): всё, что строится не для линии боя, — разведчик с радаром,
 * дозорный фрегат, шаттл-носитель челноков. Заказ владельца 2026-09-23: такие корабли живут
 * отдельной вкладкой «Поддержка» — в Производстве и в подготовке Sector Zero. Обычный фрегат
 * ушёл в «Корабли» решением владельца 2026-09-25.
 *
 * Признак — ДАННЫЕ, а не список в коде: трейт `support` у корпуса в `data/units.json`. Новый
 * корабль поддержки попадает во вкладку правкой JSON, и забыть переложить его некуда.
 */
export const SUPPORT_TRAIT = 'support';

export function isSupportHull(def: Pick<UnitDef, 'traits'> | undefined): boolean {
  return def?.traits.includes(SUPPORT_TRAIT) ?? false;
}

/** Челнок — машина, которая базируется в ангаре и летает вылетами, а не корабль
 *  (трейт `shuttle`). В Производстве у челноков своя вкладка «Челноки». */
export function isShuttleHull(def: Pick<UnitDef, 'traits'> | undefined): boolean {
  return def?.traits.includes('shuttle') ?? false;
}

/** Разложить корпуса на линию боя, поддержку и челноки, сохранив порядок. Неизвестный id —
 *  в линию: вкладка «Корабли» остаётся местом по умолчанию. */
export function splitSupport(
  ids: readonly string[],
  data: GameData,
): { line: string[]; support: string[]; shuttles: string[] } {
  const line: string[] = [];
  const support: string[] = [];
  const shuttles: string[] = [];
  for (const id of ids) {
    const def = data.units[id];
    (isShuttleHull(def) ? shuttles : isSupportHull(def) ? support : line).push(id);
  }
  return { line, support, shuttles };
}
