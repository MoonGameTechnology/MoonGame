import type { GameState } from './gameState';

/** Seat bots can be taken over by humans. Map inhabitants cannot. */
export function playablePlayerIds(state: Pick<GameState, 'players'>): string[] {
  return Object.keys(state.players).filter((id) => !state.players[id]!.npc);
}
