import type { GameState, Minefield, RoadPoint } from './gameState';
import { fleetPositionAt } from './fleetPosition';
import { laneRoad, polylineLength } from './roads';
import { deepClone } from '../util/clone';

export const MINE_SIGNATURE = 0.1;
export const MINE_DETECTION_RANGE = 24;
export const MINE_INSTALL_HOURS = 0.25;

export function visibleMinefields(state: GameState, viewer: string): GameState['minefields'] {
  if (!state.minefields) return undefined;
  const view = deepClone(state.minefields);
  for (const [key, owners] of Object.entries(view.fields)) {
    for (const [owner, field] of Object.entries(owners)) {
      if (!fieldVisible(state, key, owner, field, viewer)) delete owners[owner];
    }
    if (!Object.keys(owners).length) delete view.fields[key];
  }
  for (const id of Object.keys(view.readyAt))
    if (state.fleets[id]?.owner !== viewer) delete view.readyAt[id];
  for (const owner of Object.keys(view.ownerReadyAt ?? {}))
    if (owner !== viewer) delete view.ownerReadyAt![owner];
  for (const [id, job] of Object.entries(view.installations ?? {}))
    if (job.owner !== viewer) delete view.installations![id];
  return Object.keys(view.fields).length ||
    Object.keys(view.readyAt).length ||
    Object.keys(view.ownerReadyAt ?? {}).length ||
    Object.keys(view.installations ?? {}).length
    ? view
    : undefined;
}

export function fieldPosition(state: GameState, key: string, field: Minefield): RoadPoint | null {
  return field.position ?? state.planets[key]?.position ?? null;
}
export function fieldVisible(
  state: GameState,
  key: string,
  owner: string,
  field: Minefield,
  viewer: string,
): boolean {
  if (owner === viewer) return true;
  const at = fieldPosition(state, key, field);
  return (
    !!at &&
    Object.values(state.fleets).some((f) => {
      const pos =
        f.owner === viewer &&
        f.units.some((u) => u.count > 0) &&
        fleetPositionAt(state, f, state.time);
      return pos && (pos.x - at.x) ** 2 + (pos.y - at.y) ** 2 <= MINE_DETECTION_RANGE ** 2;
    })
  );
}
/** Arc-length share of a point on the road, including a shared trunk of another lane. */
export function fieldRoadT(
  state: GameState,
  from: string,
  to: string,
  at: RoadPoint,
): number | null {
  const road = laneRoad(state, from, to);
  if (!road) return null;
  const length = polylineLength(road);
  if (!(length > 0)) return null;
  let walked = 0;
  for (let i = 1; i < road.length; i++) {
    const a = road[i - 1]!,
      b = road[i]!;
    const dx = b.x - a.x,
      dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;
    const len = Math.sqrt(len2);
    const t = len2 > 0 ? ((at.x - a.x) * dx + (at.y - a.y) * dy) / len2 : -1;
    if (t >= 0 && t <= 1 && (a.x + dx * t - at.x) ** 2 + (a.y + dy * t - at.y) ** 2 < 1e-8) {
      return (walked + t * len) / length;
    }
    walked += len;
  }
  return null;
}
