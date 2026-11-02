import type { GameData, UnitDef } from '../data/schemas';
import type { UnitStack } from '../state/gameState';

export type Tier = 'front' | 'mid' | 'rear';
/** The lines bow to stern (GDD §7.2). Not a damage ORDER any more — every line
 *  present in the fight is hit in the same volley; the order decides only which
 *  line rounds UP when an absent line's share is split (see {@link lineShares}).
 *
 *  ROS-2.1 dropped a fourth line that a since-removed trait carried; every hull
 *  now states its own line and there is no exception to it. */
export const TIER_ORDER: readonly Tier[] = ['front', 'mid', 'rear'];

/** Share of an incoming volley each line takes, in whole percent (sums to 100).
 *  A line with no live ship takes nothing and its share is split across the lines
 *  that ARE present. Balance constants (like COMBAT_UNIT_CAP) — data after shakeout.
 *
 *  50/30/20 since ROS-2.1: the old 40/30/20/10 only summed to 100 together with a
 *  fourth line, so dropping that line had to redistribute its ten percent. */
export const LINE_SHARE: Readonly<Record<Tier, number>> = {
  front: 50,
  mid: 30,
  rear: 20,
};

/** Formation is declared by unit data for ships and ground troops alike. */
export function unitTier(def: UnitDef): Tier {
  return def.line;
}

/**
 * How a volley splits across the lines that are actually in the fight, in whole
 * percent summing to exactly 100 (GDD §7.2).
 *
 * Base split is {@link LINE_SHARE}; an ABSENT line takes nothing and its percent
 * is divided EVENLY among the present ones. When that division is not whole, the
 * odd percent goes to the more forward lines (bow rounds up, stern rounds down) —
 * so an even split of a missing line's 20% is 60/40, never 61/39.
 * One line alone therefore always takes 100%.
 *
 * `present` need not be sorted: the result is read off {@link TIER_ORDER}, so the
 * split is a pure function of WHICH lines are in the fight, never of stack order.
 */
export function lineShares(present: readonly Tier[]): Record<Tier, number> {
  const out: Record<Tier, number> = { front: 0, mid: 0, rear: 0 };
  const lines = TIER_ORDER.filter((tier) => present.includes(tier));
  if (lines.length === 0) {
    return out;
  }
  let orphaned = 100;
  for (const tier of lines) {
    orphaned -= LINE_SHARE[tier];
  }
  const each = Math.floor(orphaned / lines.length);
  let odd = orphaned - each * lines.length;
  for (const tier of lines) {
    out[tier] = LINE_SHARE[tier] + each + (odd > 0 ? 1 : 0);
    if (odd > 0) {
      odd -= 1;
    }
  }
  return out;
}

/** One equal share per living unit inside each line; hull HP never sets a share. */
export function formationShares(units: readonly UnitStack[], data: GameData): number[] {
  const counts: Record<Tier, number> = { front: 0, mid: 0, rear: 0 };
  for (const stack of units) {
    const def = data.units[stack.unit];
    if (def && stack.count > 0) counts[unitTier(def)] += stack.count;
  }
  const shares = lineShares(TIER_ORDER.filter((tier) => counts[tier] > 0));
  return units.map((stack) => {
    const def = data.units[stack.unit];
    if (!def || stack.count <= 0) return 0;
    const tier = unitTier(def);
    return ((shares[tier] / 100) * stack.count) / counts[tier];
  });
}
