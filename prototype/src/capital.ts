/**
 * Capital — a designatable home world (hero respawn + module re-fit anchor).
 * Extracted from `game.ts` (REFP-14): depends on `isInhabited` (REFP-4) + the
 * prototype's `capital` state extension. `game.ts` imports `capitalModule` for
 * `MODULES` and re-exports `capitalOf` for `main.ts` / tests.
 */
import type { GameModule, GameState } from '../../packages/shared-core/src/index';
import { isInhabited } from './tax';

/** Minimal view of the prototype's state extension for the capital map. */
interface CapitalState {
  capital?: Record<string, string>;
}

/** The capital map (playerId → planetId); lazily initialised. The capital is where a
 *  hero respawns and (Phase C) re-fits modules; designatable, defaults to the homeworld. */
export function capitalsOf(state: GameState): Record<string, string> {
  const s = state as CapitalState;
  return (s.capital ??= {});
}
/** A player's current capital planet id, or undefined if unset. */
export function capitalOf(state: GameState, playerId: string): string | undefined {
  return (state as CapitalState).capital?.[playerId];
}

/** "Назначаемая столица": each player's capital defaults to their homeworld and can be
 *  moved to any owned inhabited world (e.g. if the old one is lost). Phase B/C: heroes
 *  respawn here after the death cooldown, and modules are re-fitted here. */
export const capitalModule: GameModule = {
  id: 'capital',
  version: '0.1.0',
  setup(api) {
    api.onAction('capital.designate', (action, h) => {
      const p = action.payload as { planetId?: string };
      if (typeof p?.planetId !== 'string') return h.reject('E_BAD_PAYLOAD');
      const planet = h.state.planets[p.planetId];
      if (!planet) return h.reject('E_NO_PLANET');
      if (planet.owner !== action.playerId) return h.reject('E_FORBIDDEN');
      if (!isInhabited(planet)) return h.reject('E_NOT_INHABITED'); // a capital must be a real world
      capitalsOf(h.state)[action.playerId] = p.planetId;
      // The capital is the hero respawn anchor: repoint this player's heroes' `home`.
      for (const hero of Object.values(h.state.heroes ?? {})) {
        if (hero.owner === action.playerId) hero.home = p.planetId;
      }
      h.emit('capital.designated', { owner: action.playerId, planetId: p.planetId });
    });
  },
};