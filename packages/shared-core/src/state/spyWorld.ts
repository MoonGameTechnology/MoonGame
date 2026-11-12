import { buildingLevel, type GameData } from '../data/schemas';
import { recordValues } from '../util/records';
import { planetDevelopment } from './development';
import type { GameState } from './gameState';

// What a world and its civilisation bring to a spy's odds (SPY-7, SPY-21) — read by the
// espionage module; pure, so a client can preview the same numbers.

/** The victim's counter-intelligence: the largest `field` bonus among the buildings
 *  on the worlds they own (SPY-7). 0 without such a building. */
export function counterIntelOf(
  data: GameData,
  state: GameState,
  playerId: string,
  field: 'spyDetectBonus' | 'spyKillBonus' | 'spyTurnChance',
): number {
  let best = 0;
  for (const planet of recordValues(state.planets)) {
    if (planet.owner !== playerId) continue;
    for (const b of planet.buildings) {
      const def = data.buildings[b.type];
      if (def) best = Math.max(best, buildingLevel(def, b.level)[field]);
    }
  }
  return best;
}

/**
 * SPY-21: how developed `planetId` is against the other worlds of its owner, in [0,1] — its
 * development over the most developed one's (owner's resolution 2026-11-03). The scale is
 * the civilisation's own: a lone capital, or two equal worlds, are 1 however little is
 * built; a civilisation with nothing built at all counts every world as 1. A world without
 * an owner is 0. Counter-intelligence buildings count like any other (owner's resolution
 * 2026-11-03): a bureau protects the whole civilisation far more than it adds to a theft.
 */
export function developmentShare(data: GameData, state: GameState, planetId: string): number {
  const planet = state.planets[planetId];
  if (!planet || planet.owner === null) return 0;
  let best = 0;
  for (const p of recordValues(state.planets)) {
    if (p.owner === planet.owner) best = Math.max(best, planetDevelopment(data, p));
  }
  return best > 0 ? planetDevelopment(data, planet) / best : 1;
}
