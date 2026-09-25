/**
 * Здоровье стека на плитке состава (заказ владельца 2026-09-25: «гарнизон наземный и все
 * юниты наземные тоже плиткой, и чтоб видеть, сколько HP, — полоску и цифры»). Полоска
 * у плитки была и раньше; числа «осталось/всего» — новое, и у них одно неочевидное
 * правило: ЖИВОЙ стек никогда не показывает «0/…». Остаток меньше единицы округляется
 * вверх, иначе раненый, но живой отряд читался бы погибшим.
 */

/** Что рисует плитка: доля для полоски и два числа корпуса стека. */
export interface TileHp {
  /** 0..100 — ширина полоски. Нечему ломаться (`max` 0) — целый, как и раньше. */
  pct: number;
  cur: number;
  max: number;
  /** Полоска красная. */
  low: boolean;
}

/** Ниже этой доли полоска красная — тот же порог, с которого корабль хромает
 *  (`LIMP_PCT` в `prototype/src/fleetSummary.ts`). */
export const TILE_HP_LOW_PCT = 30;

/** Плитка по пулу корпуса стека (`stackPools(...).hull`): остаток зажат в `0..max`. */
export function tileHp(hull: { cur: number; max: number }): TileHp {
  const max = Math.max(0, hull.max);
  const cur = Math.min(Math.max(0, hull.cur), max);
  const pct = max > 0 ? Math.round((cur / max) * 100) : 100;
  const maxShown = Math.round(max);
  const curShown = cur > 0 ? Math.min(maxShown, Math.max(1, Math.round(cur))) : 0;
  return { pct, cur: curShown, max: maxShown, low: pct < TILE_HP_LOW_PCT };
}
