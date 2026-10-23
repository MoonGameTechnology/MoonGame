import { coalitionOf, hasFixedSides, type GameState } from '../packages/shared-core/src/index';

/** The server validates the intent again; this only controls the session button. */
export function canCreateCoalition(state: GameState, playerId: string): boolean {
  const player = state.players[playerId];
  return (
    !!player &&
    player.status === 'active' &&
    !player.ai &&
    !player.npc &&
    !hasFixedSides(state.modeId) &&
    !coalitionOf(state, playerId)
  );
}
