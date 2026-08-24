/**
 * Capital — a designatable home world, the hero respawn anchor (`heroModule`
 * already falls back to `[hero.home, hero.location]` on respawn, but nothing
 * let a player CHANGE `hero.home` after match seed). Was a port of the prototype's
 * `capitalModule` (REFP-14's extraction); since CONV-4 it is the ONLY implementation —
 * the prototype deleted its copy and drives this module through `protoKernel`.
 *
 * Reimplements the tiny `isInhabited` check inline (`hasOrbit` + no building
 * restriction) rather than importing it from `modules/tax.ts` — modules don't
 * import each other (invariant #3); `hasOrbit`/`allowedBuildings` themselves
 * are `state/sectorKind.ts` utilities, not a module, so importing THOSE is fine.
 */
import type { GameModule } from '../kernel/module';
import type { GameData } from '../data/schemas';
import type { GameState, Planet } from '../state/gameState';
import { hasOrbit, allowedBuildings } from '../state/sectorKind';

function isInhabited(data: GameData, planet: Pick<Planet, 'kind'>): boolean {
  return hasOrbit(data, planet) && allowedBuildings(data, planet) === undefined;
}

/** The capital map (playerId → planetId); lazily initialised. */
export function capitalsOf(state: GameState): Record<string, string> {
  return (state.capital ??= {});
}
/** A player's current capital planet id, or undefined if unset. */
export function capitalOf(state: GameState, playerId: string): string | undefined {
  return state.capital?.[playerId];
}

/** "Назначаемая столица": a player's capital defaults to their homeworld (seeded
 *  at match start) and can be moved to any owned inhabited world — e.g. if the old
 *  one is lost. Heroes respawn here (`heroModule`'s `[home, location]` fallback). */
export const capitalModule: GameModule = {
  id: 'capital',
  version: '1.0.0',
  setup(api) {
    api.onAction('capital.designate', (action, h) => {
      const p = action.payload as { planetId?: string };
      if (typeof p?.planetId !== 'string') return h.reject('E_BAD_PAYLOAD');
      const planet = h.state.planets[p.planetId];
      if (!planet) return h.reject('E_NO_PLANET');
      if (planet.owner !== action.playerId) return h.reject('E_FORBIDDEN');
      if (!isInhabited(h.ctx.data, planet)) return h.reject('E_NOT_INHABITED');
      capitalsOf(h.state)[action.playerId] = p.planetId;
      // The capital is the hero respawn anchor: repoint this player's heroes' `home`.
      for (const hero of Object.values(h.state.heroes ?? {})) {
        if (hero.owner === action.playerId) hero.home = p.planetId;
      }
      h.emit('capital.designated', { owner: action.playerId, planetId: p.planetId });
    });
  },
};
