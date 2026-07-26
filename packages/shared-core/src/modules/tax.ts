import type { GameModule } from '../kernel/module';
import type { GameData, ResourceBag } from '../data/schemas';
import type { GameState, Planet } from '../state/gameState';
import { allowedBuildings, hasOrbit } from '../state/sectorKind';

/**
 * FND-2 (game-vision-roadmap.md) · Civic tax — port of the prototype's obcatanный
 * `taxModule` (`prototype/src/game.ts`), which already builds on shared-core's own
 * `hasOrbit`/`allowedBuildings` accessors. Armies cost credits in upkeep, but the
 * canonical path had nothing minting credits at scale (FND-1 added the passive
 * `planetType.baseOutput` faucet; this adds the second one the tuned economy
 * relies on) — every inhabited world of yours levies a flat civic tax that
 * diminishes as your empire grows, so total civic income still rises with
 * territory but sub-linearly (curbs the runaway snowball a flat-per-world tax
 * would cause). Hooks `economy.production`, so the core economy stays generic.
 */

/** Base credits/h from the FIRST inhabited owned world (ECON-7 tuning — see the
 *  prototype comment: worlds also make credits PASSIVELY via baseOutput now,
 *  so this flat capital tax is a modest bonus, not the sole income source). */
export const TAX_PER_HOUR = 20;
/** Tax Office building (FND-3): +this fraction to that world's WHOLE credit take. */
export const TAX_OFFICE_BONUS = 0.25;
/** Civic tax per world tapers as an empire grows. */
export const TAX_DIMINISH = 0.06;

/** An inhabited world — a normal colonisable planet/cloud with an orbital layer
 *  and the general build roster. Asteroid junctions (no orbit), dead worlds
 *  (salvage-only roster) and empty space are NOT inhabited and pay no tax. */
export function isInhabited(data: GameData, planet: Pick<Planet, 'kind'>): boolean {
  return hasOrbit(data, planet) && allowedBuildings(data, planet) === undefined;
}

/** Civic credits/hour from ONE inhabited world when its owner holds `n` of them.
 *  Flat TAX_PER_HOUR for a lone world, diminishing as `n` climbs, so total civic
 *  income `n × civicTax(n)` still rises with territory but SUB-linearly. */
export function civicTax(n: number): number {
  return TAX_PER_HOUR / (1 + TAX_DIMINISH * Math.max(0, n - 1));
}

/** Count of inhabited worlds a player owns — the `n` fed to {@link civicTax}. */
export function inhabitedWorldCount(
  data: GameData,
  state: GameState,
  owner: string | null,
): number {
  if (owner === null) return 0;
  let n = 0;
  for (const p of Object.values(state.planets)) {
    if (p.owner === owner && isInhabited(data, p)) n += 1;
  }
  return n;
}

export const taxModule: GameModule = {
  id: 'tax',
  version: '1.0.0',
  setup(api) {
    // Runs in the `economy.production` pipeline AFTER planetType (see DEV_MODULES
    // order in scenario.ts), so the civic tax isn't scaled by world richness, while
    // the Tax Office multiplies the world's whole credit take (produced output + the
    // tax). The per-world tax diminishes with the owner's empire size (civicTax), so
    // income scales sub-linearly.
    api.hook<ResourceBag>('economy.production', (bag, args, h) => {
      const planetId = (args as { planetId?: string }).planetId;
      const planet = planetId ? h.state.planets[planetId] : undefined;
      if (!planet || !isInhabited(h.ctx.data, planet)) return bag;
      const out: Record<string, number> = { ...bag };
      out.credits =
        (out.credits ?? 0) + civicTax(inhabitedWorldCount(h.ctx.data, h.state, planet.owner));
      if (planet.buildings.some((b) => b.type === 'tax_office')) {
        out.credits *= 1 + TAX_OFFICE_BONUS;
      }
      return out;
    });
  },
};
