import {
  hasFixedSides,
  isCapturable,
  isForkSite,
  type GameData,
  type GameState,
} from '../packages/shared-core/src/index';

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

/** The viewer's side's share of the capturable provinces, 0…1 — the same count the core's
 *  domination reads (`endOnDomination` in `victory.ts`): capturable kinds only, fortress
 *  sites out. Own and allied worlds are always known, so fog cannot skew the numerator. */
export function provinceShare(state: GameState, viewer: string, data: GameData): number {
  const team = hasFixedSides(state.modeId) ? state.players[viewer]?.team : undefined;
  let total = 0;
  let mine = 0;
  for (const p of Object.values(state.planets)) {
    if (!isCapturable(data, p) || isForkSite(p)) continue;
    total += 1;
    const owner = p.owner;
    if (owner !== null && (owner === viewer || (team !== undefined && state.players[owner]?.team === team)))
      mine += 1;
  }
  return total > 0 ? mine / total : 0;
}
