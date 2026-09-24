import {
  RARITIES,
  type GameData,
  type ModuleDef,
  type ShipSlotType,
  type UnitDef,
  type ResourceBag,
} from '../data/schemas';
import type { UnitStack } from '../state/gameState';
import { canInstall, validateInstalled, type FittingSpec, type InstallFailure } from './fitting';

/**
 * Ship-module (loadout) helpers. Pure & deterministic — no Date/random, fixed
 * iteration order (the `modules[]` array order). The single source of truth for
 * how installed modules change a hull's numbers is {@link effectiveStats}; every
 * consumer that must see module-modified stats routes through it rather than
 * reading raw `def.stats` (ship-modules-roadmap.md invariant).
 *
 * The loadout is chosen at build time and locked onto the built stack — there is
 * no refit action — so these helpers are read-only queries over a fixed loadout.
 */

/** Slot occupancy per category (a concrete shape, not a `Record`, so callers can
 *  index by a `ShipSlotType` variable without an undefined check). */
export interface SlotCounts {
  weapon: number;
  defense: number;
  utility: number;
}

/** Множитель вклада модуля на звезде `star` (SZE-1.1): `1 + Σ bonus` первых `star`
 *  ступеней лестницы `data.sectorZeroStars`. Звёзды сверх лестницы дальше не растут —
 *  потолок держат данные, а не вызывающий.
 *
 *  Пустая лестница (обычный матч, где `sectorZeroStars` — дефолт схемы) даёт ровно `1`,
 *  то есть ось выключается ДАННЫМИ, без флага в коде. Сложение идёт в фиксированном
 *  порядке массива, поэтому результат детерминирован. */
export function moduleStarMultiplier(star: number, data: GameData): number {
  const steps = data.sectorZeroStars.steps;
  const upTo = Math.min(Math.max(0, Math.floor(star)), steps.length);
  let mult = 1;
  for (let i = 0; i < upTo; i++) mult += steps[i]!.bonus;
  return mult;
}

/** Effective per-ship stats = base `def.stats` + Σ flat additive deltas from each
 *  installed module. Unknown module ids are skipped (base-default, never crash),
 *  exactly as `sumUnitStat` skips unknown units. No modules (undefined/empty) →
 *  a fresh copy of `def.stats`, byte-for-byte the base.
 *
 *  Звёздность модуля (`stack.moduleStars`, SZE-1.1) множит ВКЛАД САМОГО МОДУЛЯ, а не
 *  характеристику корпуса: ★ на пушке усиливает пушку, а голый корабль остаётся голым.
 *  ★0 / отсутствующая карта звёзд → прежняя сумма байт-в-байт. */
export function effectiveStats(
  def: UnitDef,
  stack: Pick<UnitStack, 'modules' | 'moduleStars' | 'moduleRarity'>,
  data: GameData,
): Record<string, number> {
  const out: Record<string, number> = { ...def.stats };
  const mods = stack.modules;
  if (!mods) return out;
  const stars = stack.moduleStars;
  for (const id of mods) {
    const m = data.modules[id];
    if (!m) continue;
    const star = stars?.[id] ?? 0;
    const mult = star > 0 ? moduleStarMultiplier(star, data) : 1;
    for (const [k, v] of Object.entries(m.effects.stats)) {
      out[k] = (out[k] ?? 0) + v * mult;
    }
    // Параметры редкости (SZE-5.1) — такой же вклад модуля, поэтому и звезда их множит:
    // «редкость даёт параметр, звёздность усиливает параметры».
    const rarity = stack.moduleRarity?.[id];
    if (rarity !== undefined)
      for (const [k, v] of Object.entries(moduleRarityBonus(m, rarity))) {
        out[k] = (out[k] ?? 0) + v * mult;
      }
  }
  return out;
}

/** Прибавка редкости модуля на ступени `rarity` (SZE-5.1): сумма `rarityBonus` всех
 *  ступеней выше базовой и не выше `rarity`, в порядке лестницы — детерминированно.
 *  Ступень не выше базовой, неизвестная ступень или модуль без таблицы — пустая прибавка. */
export function moduleRarityBonus(m: ModuleDef, rarity: string): Record<string, number> {
  const out: Record<string, number> = {};
  const base = RARITIES.indexOf(m.rarity ?? 'simple');
  const top = RARITIES.indexOf(rarity as (typeof RARITIES)[number]);
  if (!m.rarityBonus || top <= base) return out;
  for (let i = base + 1; i <= top; i++) {
    const step = RARITIES[i]!;
    if (step === 'simple') continue;
    for (const [k, v] of Object.entries(m.rarityBonus[step] ?? {})) out[k] = (out[k] ?? 0) + v;
  }
  return out;
}

/** How many slots of each category a loadout occupies (one module = one slot of
 *  its own category). Unknown module ids are skipped. */
export function slotUsage(modules: readonly string[], data: GameData): SlotCounts {
  const use: SlotCounts = { weapon: 0, defense: 0, utility: 0 };
  for (const id of modules) {
    const m = data.modules[id];
    if (m) use[m.slot] += 1;
  }
  return use;
}

/** Does hull `def` (unit id `unit`) satisfy a module's `allowed` predicate? All
 *  present fields must hold (domain match, ALL required traits, id in the list). */
export function moduleAllowed(unit: string, def: UnitDef, m: ModuleDef): boolean {
  const a = m.allowed;
  if (!a) return true;
  if (a.domain && def.domain !== a.domain) return false;
  if (a.traits.length > 0 && !a.traits.every((t) => def.traits.includes(t))) return false;
  if (a.units.length > 0 && !a.units.includes(unit)) return false;
  return true;
}

/** The ship-module fitting system expressed on the generic gate (`util/fitting.ts`):
 *  catalog = `data.modules`, category = the module's typed slot, capacity = the
 *  hull's BASE `slots` (a module can't expand its own capacity), `allowed` predicate. */
function shipSpec(unit: string, def: UnitDef, data: GameData): FittingSpec<ModuleDef> {
  return {
    item: (id) => data.modules[id],
    category: (m) => m.slot,
    capacity: (category) => def.slots[category as ShipSlotType],
    allowed: (m) => moduleAllowed(unit, def, m),
  };
}
/** Generic refusal → the ship loadout's stable codes (the public error surface). */
const SHIP_CODES: Record<InstallFailure, string> = {
  unknown: 'E_UNKNOWN_MODULE',
  duplicate: 'E_DUP_MODULE',
  not_allowed: 'E_NOT_ALLOWED',
  no_slot: 'E_NO_SLOT',
};

/** Whether `moduleId` can be added to the `current` loadout of hull `def`: the
 *  module exists, isn't already installed (one instance per id per stack), the
 *  hull has a free slot of the module's category, and `allowed` holds. Fail-secure
 *  stable codes. */
export function canEquip(
  unit: string,
  def: UnitDef,
  current: readonly string[],
  moduleId: string,
  data: GameData,
): { ok: true } | { ok: false; code: string } {
  const check = canInstall(shipSpec(unit, def, data), current, moduleId);
  return check.ok ? check : { ok: false, code: SHIP_CODES[check.reason] };
}

/** Validate a whole loadout for a hull: every module installs legally on top of
 *  the ones before it (existence, no duplicate, a free slot of its category, and
 *  the `allowed` predicate). Returns the first failure's stable code — the same
 *  gate the build action uses so a client and the server agree on legality. */
export function validateLoadout(
  unit: string,
  def: UnitDef,
  modules: readonly string[],
  data: GameData,
): { ok: true } | { ok: false; code: string } {
  const check = validateInstalled(shipSpec(unit, def, data), modules);
  return check.ok ? check : { ok: false, code: SHIP_CODES[check.reason] };
}

/** Total resource cost of a loadout (Σ module costs). Unknown ids are skipped. */
export function loadoutCost(modules: readonly string[], data: GameData): ResourceBag {
  const bag: ResourceBag = {};
  for (const id of modules) {
    const m = data.modules[id];
    if (!m) continue;
    for (const [res, amt] of Object.entries(m.cost)) {
      bag[res] = (bag[res] ?? 0) + amt;
    }
  }
  return bag;
}

/** Slot categories a hull actually offers (count > 0), in a fixed order. */
export function hullSlotTypes(def: UnitDef): ShipSlotType[] {
  const types: ShipSlotType[] = [];
  if (def.slots.weapon > 0) types.push('weapon');
  if (def.slots.defense > 0) types.push('defense');
  if (def.slots.utility > 0) types.push('utility');
  return types;
}
