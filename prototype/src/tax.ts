/**
 * Civic tax — every inhabited world levies a flat credits/hour that diminishes
 * sub-linearly with empire size, plus a Tax Office building boost. Extracted from
 * `game.ts` (REFP-4): the block depended only on `data` + the core `sectorKind`
 * helpers and hooks `economy.production`. `game.ts` imports `taxModule` for `MODULES`
 * and re-exports the public surface for `main.ts` / `tax.test.ts`.
 */
import type {
  GameModule,
  GameState,
  Planet,
  ResourceBag,
} from '../../packages/shared-core/src/index';
import { allowedBuildings, hasOrbit, creditsBonusOf } from '../../packages/shared-core/src/index';
import { data } from './prototypeData';

export const TAX_PER_HOUR = 20; // base credits/h from the FIRST inhabited owned world
export const TAX_DIMINISH = 0.06; // civic tax per world tapers as an empire grows

/** An inhabited world — a normal colonisable planet/cloud with an orbital layer
 *  and the general build roster. Asteroid junctions (no orbit), dead worlds
 *  (salvage-only roster) and empty space are NOT inhabited and pay no tax. */
export function isInhabited(planet: Planet): boolean {
  return hasOrbit(data, planet) && allowedBuildings(data, planet) === undefined;
}

/** Civic credits/hour from ONE inhabited world when its owner holds `n` of them.
 *  Flat TAX_PER_HOUR for a lone world, diminishing as `n` climbs, so total civic
 *  income `n × civicTax(n)` still rises with territory but SUB-linearly — curbing
 *  the runaway snowball where every world paid a flat 100 forever (1→100, 5→~403,
 *  10→~649, 20→~934, 42→~1214 vs the old 100/500/1000/2000/4200). Tune TAX_DIMINISH. */
export function civicTax(n: number): number {
  return TAX_PER_HOUR / (1 + TAX_DIMINISH * Math.max(0, n - 1));
}

/** Count of inhabited worlds a player owns — the `n` fed to {@link civicTax}. */
export function inhabitedWorldCount(state: GameState, owner: string | null): number {
  if (owner === null) return 0;
  let n = 0;
  for (const p of Object.values(state.planets)) if (p.owner === owner && isInhabited(p)) n += 1;
  return n;
}

export const taxModule: GameModule = {
  id: 'tax',
  version: '0.1.0',
  setup(api) {
    // Runs in the `economy.production` pipeline AFTER planetType (see MODULES order),
    // so the civic tax isn't scaled by world richness, while the Tax Office multiplies
    // the world's whole credit take (refinery output + the tax). The per-world tax
    // diminishes with the owner's empire size (civicTax) so income scales sub-linearly.
    api.hook<ResourceBag>('economy.production', (bag, args, h) => {
      const planetId = (args as { planetId?: string }).planetId;
      const planet = planetId ? h.state.planets[planetId] : undefined;
      if (!planet || !isInhabited(planet)) return bag;
      const out: Record<string, number> = { ...bag };
      out.credits = (out.credits ?? 0) + civicTax(inhabitedWorldCount(h.state, planet.owner));
      // RULES-2: бонус объявляет само здание (data), а не константа с его именем —
      // одно правило на ядро, налоговый модуль прототипа и его экономику.
      const bonus = creditsBonusOf(data, planet);
      if (bonus !== 0) out.credits *= 1 + bonus;
      return out;
    });
  },
};