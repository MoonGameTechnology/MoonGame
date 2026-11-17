/**
 * Здоровье стека на плитке состава (заказ владельца 2026-09-25: «гарнизон наземный и все
 * юниты наземные тоже плиткой, и чтоб видеть, сколько HP, — полоску и цифры»). Полоска
 * у плитки была и раньше; числа «осталось/всего» — новое, и у них одно неочевидное
 * правило: ЖИВОЙ стек никогда не показывает «0/…». Остаток меньше единицы округляется
 * вверх, иначе раненый, но живой отряд читался бы погибшим.
 *
 * Здесь же строка модулей плитки корабля — {@link tileModuleRow}.
 */
import {
  loadoutBays,
  withBonusSlots,
  type GameData,
  type SlotCounts,
  type UnitStack,
} from '../packages/shared-core/src/index';

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

/** Сколько мест у строки модулей на плитке корабля: шире плитка телефона не держит
 *  (четыре плитки в ряд, заказ владельца 2026-11-17). */
export const TILE_MODULE_MARKS = 4;

/** Строка модулей под силуэтом корабля. */
export interface TileModuleRow {
  /** Надетые модули в порядке отсеков корпуса (оружие → защита → системы). */
  modules: string[];
  /** Сколько точек «отсек свободен» стоит после них. */
  free: number;
  /** Модули, которым не хватило места: «+N» на последнем месте, имена — в его подсказке.
   *  Пусто — влезли все. */
  more: string[];
}

/**
 * Строка модулей на плитке стека (заказ владельца 2026-11-17: «красивые плитки с лёгкими
 * маленькими иконками модулей»). Плитка — взгляд мельком, полная раскладка отсеков живёт в
 * карточке корабля (`shipCard.ts`), поэтому правила здесь другие:
 *
 * 1. **Надетое — первым.** Значки идут подряд, точки свободных отсеков — после них: «два из
 *    четырёх занято» читается сразу, без поиска значка между точками.
 * 2. **Строка не шире {@link TILE_MODULE_MARKS} мест.** Модулей больше — последнее место
 *    отдаётся «+N»: модуль не пропадает молча. Свободные отсеки, которым не хватило места,
 *    просто не рисуются — они не надеты, и сказать о них нечего.
 * 3. **Раскладка — та же, что у ядра** (`loadoutBays`): модуль сверх ёмкости корпуса — тоже
 *    модуль (правило 2 карточки корабля), прибавка слотов `bonus` — тоже отсеки.
 */
export function tileModuleRow(
  stack: Pick<UnitStack, 'unit' | 'modules'>,
  data: GameData,
  bonus?: Partial<SlotCounts>,
): TileModuleRow {
  const def = data.units[stack.unit];
  if (!def) return { modules: [], free: 0, more: [] };
  const bays = loadoutBays(withBonusSlots(def, bonus).slots, stack.modules ?? [], data);
  const modules = bays.flatMap((b) => (b.module ? [b.module] : []));
  if (modules.length > TILE_MODULE_MARKS) {
    const shown = TILE_MODULE_MARKS - 1;
    return { modules: modules.slice(0, shown), free: 0, more: modules.slice(shown) };
  }
  const free = Math.min(bays.length - modules.length, TILE_MODULE_MARKS - modules.length);
  return { modules, free, more: [] };
}
