import type { Fleet, Planet } from '../state/gameState';
import { buildingLevel, type GameData } from '../data/schemas';
import { sumUnitStat } from './stacks';

/** Default PD engagement range (map units) when the unit's `pointDefenseRange` is 0. */
export const PD_RANGE = 120;
/** PD cooldown after a volley (game-minutes). Reducible by module upgrades + tech. */
export const PD_COOLDOWN_MINUTES = 20;

/** Total point-defense (anti-shuttle/anti-missile) firepower of a fleet —
 *  Σ the `pointDefense` stat of its live units (via effectiveStats, so modules
 *  are included). 0 = no point defense. */
export function fleetPointDefense(fleet: Fleet, data: GameData): number {
  return sumUnitStat(fleet.units, data, 'pointDefense');
}

/** Σ the `pointDefense` of a planet's standing buildings — ЗОНАЛЬНОЕ ПВО мира
 *  (ROS-2.2). Считается ровно как ПКО в `orbital.ts` (`aaOrbitalAt`): по уровню
 *  постройки, без гарнизона. Гарнизон сюда не входит намеренно — по заказу владельца
 *  зональное ПВО это ЗДАНИЕ и модуль корабля, а не свойство наземных войск. */
export function planetPointDefense(planet: Planet, data: GameData): number {
  let total = 0;
  for (const b of planet.buildings) {
    const def = data.buildings[b.type];
    if (def) total += buildingLevel(def, b.level).pointDefense;
  }
  return total;
}

/** PD range for a fleet — from its units' `pointDefenseRange` stat, or the default. */
export function fleetPDRange(fleet: Fleet, data: GameData): number {
  let r = 0;
  for (const s of fleet.units) {
    if (s.count <= 0) continue;
    const def = data.units[s.unit];
    if (def) r = Math.max(r, (def.stats as Record<string, number>).pointDefenseRange ?? 0);
  }
  return r > 0 ? r : PD_RANGE;
}
