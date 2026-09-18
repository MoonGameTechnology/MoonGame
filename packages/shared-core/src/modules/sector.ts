import type { GameModule } from '../kernel/module';
import type { ResourceBag } from '../data/schemas';

/**
 * Home-ground combat bonus: a fleet fighting in a sector its owner controls
 * deals this much more damage (the "+25% in your own sector" defensive edge).
 * A single global balance rule — not tied to sector terrain.
 */
const HOME_DAMAGE_BONUS = 0.25;

interface SpeedArgs {
  to?: string;
}
interface DamageArgs {
  location?: string;
  attacker?: string;
}
interface ProductionArgs {
  planetId?: string;
}

/**
 * Sector — an optional map module (docs/modulesystem.md). Map nodes carry a
 * `terrain` (data-driven, `data/sectors.json`); this module turns those types
 * and sector ownership into buffs/debuffs purely through hooks, so the core
 * never hard-codes terrain rules and the game runs unchanged without it.
 *
 *   - `fleet.speed`: a leg entering a sector is sped up / slowed by its terrain
 *     (empty space +15%, asteroid field −25%, …).
 *   - `combat.damage`: terrain toughness in a sector reduces incoming damage for
 *     everyone fighting there (modelling the asteroid-field +HP), and the side
 *     that owns the sector deals +25% (home-ground advantage).
 *   - `economy.production`: an owned sector yields what its terrain holds (MAP-LINK)
 *     — a dense asteroid cluster is metal-rich, which is WHY it is worth taking even
 *     though it admits a single lane and nothing can be built on it. Mirrors the
 *     planet-type twin so world nature and terrain compose instead of competing.
 */
export const sectorModule: GameModule = {
  id: 'sector',
  version: '1.0.0',
  setup(api) {
    api.hook<number>('fleet.speed', (speed, args, h) => {
      const to = (args as SpeedArgs).to;
      const type = to ? h.state.planets[to]?.terrain : undefined;
      const def = type ? h.ctx.data.sectors[type] : undefined;
      return def ? speed * (1 + def.speedBonus) : speed;
    });

    api.hook<ResourceBag>('economy.production', (bag, args, h) => {
      const planetId = (args as ProductionArgs).planetId;
      const terrain = planetId ? h.state.planets[planetId]?.terrain : undefined;
      const def = terrain ? h.ctx.data.sectors[terrain] : undefined;
      if (!def) {
        return bag;
      }
      const base = def.baseOutput;
      const byRes = def.productionByResource;
      const baseKeys = Object.keys(base);
      if (baseKeys.length === 0 && Object.keys(byRes).length === 0) {
        return bag; // terrain holds nothing — pass through untouched
      }
      const out: Record<string, number> = {};
      for (const res of new Set([...Object.keys(bag), ...baseKeys])) {
        out[res] = ((bag[res] ?? 0) + (base[res] ?? 0)) * (1 + (byRes[res] ?? 0));
      }
      return out;
    });

    api.hook<number>('combat.damage', (dmg, args, h) => {
      const { location, attacker } = args as DamageArgs;
      if (!location) {
        return dmg;
      }
      const planet = h.state.planets[location];
      if (!planet) {
        return dmg;
      }
      let result = dmg;
      // Sector toughness: everyone in the sector effectively gains HP, modelled
      // as reduced incoming damage (same survivability, no pool rescaling).
      const type = planet.terrain ? h.ctx.data.sectors[planet.terrain] : undefined;
      // Guard 1 + bonus > 0 too: a hpBonus of -1 would divide by zero (Infinity),
      // < -1 would flip the sign — mirrors the planetType.ts twin.
      if (type && type.hpBonus !== 0 && 1 + type.hpBonus > 0) {
        result /= 1 + type.hpBonus;
      }
      // Home advantage: the side owning this sector hits harder.
      if (attacker && planet.owner === attacker) {
        result *= 1 + HOME_DAMAGE_BONUS;
      }
      return result;
    });
  },
};
