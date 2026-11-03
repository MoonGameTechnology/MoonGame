import { hasFixedSides, type GameState } from '../packages/shared-core/src/index';

/** The scoreboard publishes objectives, so progress never relies on private fogged planets. */
export function capitalProgress(
  state: GameState,
  viewer: string,
): { captured: number; total: number } {
  const team = hasFixedSides(state.modeId) ? state.players[viewer]?.team : undefined;
  const sameSide = (id: string): boolean =>
    id === viewer || (team !== undefined && state.players[id]?.team === team);
  const targets = Object.entries(state.match.capitalObjectives ?? {}).filter(
    ([id]) => !sameSide(id),
  );
  if (!state.match.capitalObjectives)
    return {
      captured: 0,
      total: Object.values(state.players).filter((p) => !p.npc && !sameSide(p.id)).length,
    };
  return {
    captured: targets.filter(([, target]) => target.owner !== null && sameSide(target.owner))
      .length,
    total: targets.length,
  };
}
