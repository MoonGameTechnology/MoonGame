/**
 * Fleet hull-repair math — shared by `modules/instantRepair.ts` (paid-in-credits,
 * anywhere) and `modules/fleetRepair.ts` (paid-in-metal, at an owned dock). A pure
 * utility (not a `GameModule`) so both action modules can share it without
 * importing each other (invariant #3). Was ported from the prototype's
 * `instantRepair.ts` (`missingHull`/`instantRepairCost`, REFP-17) and
 * `econScrews.ts` (`dockRepairCost`/`fleetAtOwnDock`, REFP-18); since CONV-1/CONV-2
 * those files are gone and this is the only copy of the math.
 */
import type { Fleet, GameState } from '../state/gameState';
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

/** Price of an instant (credits) repair — 0 = nothing to repair. One formula for
 *  both the server gate and the client's price display. */
export function instantRepairCost(f: Fleet, data: GameData): number {
  return Math.ceil(missingHull(f, data) * INSTANT_REPAIR_CREDITS_PER_HP);
}

/** Price of a dock (metal) repair — 0 = nothing to repair. */
export function dockRepairCost(f: Fleet, data: GameData): number {
  return Math.ceil(missingHull(f, data) / REPAIR_HP_PER_METAL);
}

/** Does this fleet have its own dock: parked (not in transit) over its OWNER's
 *  world, under a live building with `shipRepair > 0` (spaceport/shipyard)? */
export function fleetAtOwnDock(f: Fleet, state: GameState, data: GameData): boolean {
  if (f.movement || !f.location) return false;
  const planet = state.planets[f.location];
  if (!planet || planet.owner !== f.owner) return false;
  return planet.buildings.some((b) => {
    if (b.hp <= 0) return false;
    const def = data.buildings[b.type];
    return !!def && buildingLevel(def, b.level).shipRepair > 0;
  });
}
