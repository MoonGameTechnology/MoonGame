import type { GameData } from '../data/schemas';
import type { GameState, PlayerId } from './gameState';

/** Legacy/campaign ceiling; main-game command research opens the extra two places. */
export const HERO_ACTIVE_CAP = 3;

export function heroActiveCap(state: GameState, owner: PlayerId, data: GameData): number {
  if (state.techRules?.ruleset !== 'main' || state.players[owner]?.npc) return HERO_ACTIVE_CAP;
  let slots = 1;
  for (const id of new Set(state.players[owner]?.technologies?.completed ?? [])) {
    const def = data.technologies[id];
    if (def?.ruleset === 'main') slots += def.effects.heroSlots ?? 0;
  }
  return Math.min(HERO_ACTIVE_CAP, slots);
}

/** Preparations reserve a place immediately, so concurrent requests cannot overbook it. */
export function activeHeroCount(state: GameState, owner: PlayerId): number {
  return Object.values(state.heroes ?? {}).filter(
    (hero) =>
      hero.owner === owner &&
      (hero.mobilization !== undefined ||
        (hero.alive !== false &&
          hero.fleetId !== undefined &&
          state.fleets[hero.fleetId] !== undefined)),
  ).length;
}
