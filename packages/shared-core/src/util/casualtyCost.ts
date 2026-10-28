import type { GameData, ResourceBag } from '../data/schemas';
import type { GameState, UnitStack } from '../state/gameState';
import { matchCost, matchUnitCost } from './pricing';
import { loadoutCost } from './loadout';

/** Capture composition before damage mutates the stacks. Replacement value uses
 * the match's pinned prices; upkeep, repair, stars and sunk research are excluded. */
export function captureCasualtyCost(
  state: GameState,
  units: UnitStack[],
  data: GameData,
): () => Record<string, ResourceBag> {
  const before = units.map((stack) => ({
    stack,
    count: stack.count,
    parts: [
      matchUnitCost(state, data.units[stack.unit]),
      matchCost(state, loadoutCost(stack.modules ?? [], data)),
    ],
  }));
  return () => {
    const out: Record<string, ResourceBag> = {};
    for (const { stack, count, parts } of before) {
      const lost = count - stack.count;
      if (lost <= 0) continue;
      const cost = (out[stack.unit] ??= {});
      for (const part of parts)
        for (const [resource, amount] of Object.entries(part ?? {}))
          cost[resource] = (cost[resource] ?? 0) + amount * lost;
    }
    return out;
  };
}
