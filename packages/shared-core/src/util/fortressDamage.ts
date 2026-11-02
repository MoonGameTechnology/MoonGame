import type { BuildingInstance, Planet, UnitStack } from '../state/gameState';
import type { GameData } from '../data/schemas';
import { FORTRESS_BODY, FORTRESS_CORE, FORTRESS_INTERNAL_SHARE } from '../state/fortress';
import { effectiveStats } from './loadout';

/** Pure shared damage routing for the live simulation and its preview. Shields
 *  are left for damageUnits to absorb exactly once. An internal system receives
 *  a share of overflow only; overkill on that system returns to the hull. */
export function divertFortressDamage(
  site: Planet | undefined,
  units: readonly UnitStack[],
  amount: number,
  data: GameData,
): { hullInput: number; internalDamage: number; destroyed: BuildingInstance[] } {
  const unchanged = { hullInput: amount, internalDamage: 0, destroyed: [] as BuildingInstance[] };
  if (!site?.fortress || !(amount > 0) || units.some((u) => u.count > 0 && u.unit !== FORTRESS_BODY)) return unchanged;
  let shields = 0;
  for (const body of units) {
    const def = data.units[body.unit];
    if (def && body.count > 0) shields += body.shieldHp ?? body.count * (effectiveStats(def, body, data).shield ?? 0);
  }
  const overflow = Math.max(0, amount - shields);
  const candidates = site.buildings.filter((b) => b.type !== FORTRESS_CORE && b.hp > 0)
    .sort((a, b) => {
      const left = a.uid ?? a.type;
      const right = b.uid ?? b.type;
      return left < right ? -1 : left > right ? 1 : 0;
    });
  if (!(overflow > 0) || candidates.length === 0) return unchanged;
  const cursor = site.fortress.damageCursor ?? 0;
  const target = candidates[cursor % candidates.length]!;
  site.fortress.damageCursor = cursor + 1;
  const share = data.buildings[FORTRESS_CORE]?.internalDamageShare ?? FORTRESS_INTERNAL_SHARE;
  const internalDamage = Math.min(target.hp, overflow * share);
  target.hp -= internalDamage;
  const destroyed = target.hp <= 0 ? [target] : [];
  if (destroyed.length > 0) site.buildings = site.buildings.filter((b) => b !== target);
  return { hullInput: amount - internalDamage, internalDamage, destroyed };
}
