import { buildingLevel, type BuildingDef, type GameData } from '../data/schemas';
import type { Planet } from './gameState';

/**
 * Planet development ("развитость", owner request 2026-11-02): a world's built-up-ness,
 * summed from the structures standing on it. It is a derived reading, not stored state —
 * every client and the server get the same number from the same `(buildings, data)`.
 *
 * A structure is worth what it took to raise: each level it went through adds
 * `Σcost / COST_PER_POINT + buildTimeHours`, rounded. A pricier, longer-to-build level gives
 * more, and an upgraded building carries all of its levels (a level-3 shipyard is worth its
 * construction plus both upgrades). Resources count at face value — there is no exchange
 * rate in the data to weigh them by.
 *
 * Unlike `scoreValue` (victory points, hand-set per building), this is computed from the
 * data, so a new building gets its development worth without a new field.
 */

/** How many resource units of cost make one point (time counts one point per hour). */
export const DEVELOPMENT_COST_PER_POINT = 20;

/** Development points of ONE level of a building: the price and build time of that step. */
export function developmentOfLevel(def: BuildingDef, level: number): number {
  const lv = buildingLevel(def, level);
  let cost = 0;
  for (const amount of Object.values(lv.cost)) cost += amount ?? 0;
  return Math.round(cost / DEVELOPMENT_COST_PER_POINT + lv.buildTimeHours);
}

/** Development points of a building at `level`: levels 1..level summed. */
export function buildingDevelopment(def: BuildingDef, level: number): number {
  let total = 0;
  for (let l = 1; l <= level; l++) total += developmentOfLevel(def, l);
  return total;
}

/** A world's development: the sum over its structures. Unknown building ids count 0. */
export function planetDevelopment(data: GameData, planet: Pick<Planet, 'buildings'>): number {
  let total = 0;
  for (const b of planet.buildings) {
    const def = data.buildings[b.type];
    if (def) total += buildingDevelopment(def, b.level);
  }
  return total;
}
