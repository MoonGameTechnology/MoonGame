/**
 * Fleet hull-repair math — shared by `modules/instantRepair.ts` (paid-in-credits,
 * anywhere) and `modules/fleetRepair.ts` (paid-in-metal, at an owned dock). A pure
 * utility (not a `GameModule`) so both action modules can share it without
 * importing each other (invariant #3). Was ported from the prototype's
 * `instantRepair.ts` (`missingHull`/`instantRepairCost`, REFP-17) and
 * `econScrews.ts` (`dockRepairCost`/`fleetAtOwnDock`, REFP-18); since CONV-1/CONV-2
 * those files are gone and this is the only copy of the math.
 */
import type { Fleet, GameState, Planet } from '../state/gameState';
import type { GameData } from '../data/schemas';
import { effectiveStats } from './loadout';
import { buildingLevel } from '../data/schemas';

export const INSTANT_REPAIR_CREDITS_PER_HP = 1;
export const REPAIR_HP_PER_METAL = 2;

/** Missing hull of the fleet (ships + carried landing force), by effective (fitted)
 *  hp — a stack with `hp === undefined` is at full health and contributes nothing. */
export function missingHull(f: Fleet, data: GameData): number {
  let missing = 0;
  for (const stack of [...f.units, ...(f.landing ?? [])]) {
    if (stack.count <= 0 || stack.hp === undefined) continue;
    const def = data.units[stack.unit];
    if (!def) continue;
    const per = effectiveStats(def, stack, data).hp ?? 0;
    const full = stack.count * per;
    missing += Math.max(0, full - Math.min(stack.hp, full));
  }
  return missing;
}

/** Full hull of the fleet at its fitted stats — the denominator RETR-2 reads, because
 *  the owner's rule is «остаток от МАКСИМАЛЬНОГО HP флота». Counts ships and the landing
 *  force they carry together, exactly as {@link missingHull} counts them: a threshold
 *  measured over a different set than the damage would drift the moment a transport
 *  takes a hit. */
export function maxHull(f: Fleet, data: GameData): number {
  let full = 0;
  for (const stack of [...f.units, ...(f.landing ?? [])]) {
    if (stack.count <= 0) continue;
    const def = data.units[stack.unit];
    if (!def) continue;
    full += stack.count * (effectiveStats(def, stack, data).hp ?? 0);
  }
  return full;
}

/** Share of the fleet's hull still standing, 0..1 (RETR-2's threshold). A fleet with no
 *  hull to speak of — empty, or statless content — reads as FULL, not as zero: a
 *  threshold rule that answers «0%» there would order a permanent retreat for a fleet
 *  that was never damaged (fail-secure, and the direction that does nothing). */
export function hullFraction(f: Fleet, data: GameData): number {
  const full = maxHull(f, data);
  if (!(full > 0)) return 1;
  return Math.max(0, Math.min(1, (full - missingHull(f, data)) / full));
}

/** Price of an instant (credits) repair — 0 = nothing to repair. One formula for
 *  both the server gate and the client's price display. */
export function instantRepairCost(f: Fleet, data: GameData): number {
  return Math.ceil(missingHull(f, data) * INSTANT_REPAIR_CREDITS_PER_HP);
}

/** Price of a dock (metal) repair — 0 = nothing to repair. */
export function dockRepairCost(f: Fleet, data: GameData): number {
  return Math.ceil(missingHull(f, data) / REPAIR_HP_PER_METAL);
}

/**
 * Есть ли у флота ДОК: он припаркован (не в пути) над миром, который ему открыт, и там
 * стоит живое здание с `shipRepair > 0` (верфь или космопорт).
 *
 * «Открыт» — свой ИЛИ СОЮЗНЫЙ (FORT-5.8, из описания верфи крепости: «небольшой ремонт
 * флоту союзника или вашему»). До этого кирпича проверка была `planet.owner === f.owner`,
 * то есть союзник у вашего дока не чинился, — тот же дефект-класс, что решение 5 нашло у
 * форта: правило обещало союзников, а код спрашивал владельца.
 *
 * Союзность приходит ПАРАМЕТРОМ, а не считается здесь: у ядра она резолвится через
 * capability `diplomacy` (нужен `HandlerContext`, которого у чистой функции нет), а у
 * клиента — через стойку. Свести это внутрь значило бы завести второй дом для «кто
 * союзник»; параметр оставляет дом один. Не передали — поведение ровно прежнее.
 */
export function fleetAtOwnDock(
  f: Fleet,
  state: GameState,
  data: GameData,
  allied: (a: string, b: string) => boolean = () => false,
): boolean {
  if (f.movement || !f.location) return false;
  const planet = state.planets[f.location];
  if (!planet || planet.owner === null) return false;
  if (planet.owner !== f.owner && !allied(f.owner, planet.owner)) return false;
  return planet.buildings.some((b) => {
    if (b.hp <= 0) return false;
    const def = data.buildings[b.type];
    return !!def && buildingLevel(def, b.level).shipRepair > 0;
  });
}

/**
 * Темп ремонта корпусов у дока мира — доля полного корпуса в час: сумма `shipRepair`
 * живых построек (SHU-5.3, та же сумма, что чинит корабли в `construction`). Своё ли это
 * место и не идёт ли там бой, решает вызывающий.
 */
export function dockHullRate(planet: Planet, data: GameData): number {
  let rate = 0;
  for (const b of planet.buildings) {
    if (b.hp <= 0) continue;
    const def = data.buildings[b.type];
    if (def) rate += buildingLevel(def, b.level).shipRepair;
  }
  return rate;
}

/**
 * Темп, которым ФЛОТ чинит эскадры в своём ангаре сам, без дока (SHU-5.4): лучший
 * `hullRepair` среди его кораблей. Лучший, а не сумма — ремонтный ангар один на борт
 * шаттлов, и второй такой модуль ангар не ускоряет. Нет модуля — 0.
 */
export function fleetHangarRepairRate(f: Fleet, data: GameData): number {
  let best = 0;
  for (const st of f.units) {
    const def = data.units[st.unit];
    if (!def || st.count <= 0) continue;
    best = Math.max(best, effectiveStats(def, st, data).hullRepair ?? 0);
  }
  return best;
}
