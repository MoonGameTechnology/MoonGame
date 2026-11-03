import type { GameState, PlayerId, PlanetId } from './gameState';
import { playablePlayerIds } from './playableSeats';
import { hasFixedSides } from '../action/matchMode';

/** Public objectives contain only the target and its current holder, never troops or resources. */
export type CapitalObjectives = Record<PlayerId, { planetId: PlanetId; owner: PlayerId | null }>;

/** Fixed teams share their objectives. Missing or duplicate capitals cannot award a win. */
export function capitalVictoryStatus(
  state: GameState,
  modeId?: string,
): {
  objectives: CapitalObjectives;
  winner: PlayerId[] | null;
} {
  const ids = playablePlayerIds(state).sort();
  const objectives: CapitalObjectives = {};
  for (const id of ids) {
    const target = state.capital?.[id];
    const planet = target === undefined ? undefined : state.planets[target];
    if (target !== undefined && planet) objectives[id] = { planetId: target, owner: planet.owner };
  }
  if (
    ids.length < 2 ||
    Object.keys(objectives).length !== ids.length ||
    new Set(Object.values(objectives).map((o) => o.planetId)).size !== ids.length
  )
    return { objectives, winner: null };
  const teams = hasFixedSides(modeId);
  if (teams && ids.some((id) => state.players[id]?.team === undefined))
    return { objectives, winner: null };
  const sides = new Map<string, PlayerId[]>();
  for (const id of ids) {
    const key = teams ? state.players[id]!.team! : id;
    const side = sides.get(key) ?? [];
    side.push(id);
    sides.set(key, side);
  }
  const qualified = [...sides.values()].filter((side) => {
    const enemies = ids.filter((id) => !side.includes(id));
    return (
      enemies.length > 0 &&
      side.some((id) => state.players[id]?.status === 'active') &&
      enemies.every((id) => {
        const owner = objectives[id]!.owner;
        return owner !== null && side.includes(owner);
      })
    );
  });
  // A restored mutually-captured position has no arbitrary first-side winner.
  return { objectives, winner: qualified.length === 1 ? qualified[0]! : null };
}
