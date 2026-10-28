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

/** One volley may publish several rows for the same hull (loadouts, lines or
 * class pools). Partition its captured total instead of repeating it per row.
 * The last row receives the exact remainder, so integer rounding cannot mint
 * or discard replacement value. This changes telemetry only, never casualties. */
export function partitionCasualtyCost(
  deaths: readonly { unit: string; count: number }[],
  costs: Record<string, ResourceBag>,
): ResourceBag[] {
  const counts: Record<string, number> = {};
  for (const death of deaths) counts[death.unit] = (counts[death.unit] ?? 0) + death.count;
  const remaining = Object.fromEntries(
    Object.entries(costs).map(([unit, cost]) => [unit, { ...cost }]),
  );
  return deaths.map((death) => {
    const out: ResourceBag = {};
    const cost = remaining[death.unit] ?? {};
    const count = counts[death.unit]!;
    for (const [resource, amount] of Object.entries(cost)) {
      const part = death.count === count ? amount : Math.floor((amount * death.count) / count);
      out[resource] = part;
      cost[resource] = amount - part;
    }
    counts[death.unit] = count - death.count;
    return out;
  });
}
