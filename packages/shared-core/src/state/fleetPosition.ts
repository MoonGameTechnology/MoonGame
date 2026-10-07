import type { Fleet, FleetFlight, GameState, PlanetId, RoadPoint } from './gameState';
import { crossingT, laneRoad, pointAlong } from './roads';

/** The interpolation parameter along a leg at `now`: how far the fleet sits
 *  within the lane's [0,1] span, honoring the leg's own [startT, endT]
 *  sub-segment and clamping outside the travel window. THE one copy of the
 *  progress math — movement (fleet.stop), visibility (sensor reach / radar
 *  anchor) all read it from here, so the
 *  interpolation semantics cannot silently fork. */
export function legT(mv: NonNullable<Fleet['movement']>, now: number): number {
  const span = mv.arrivesAt - mv.departedAt;
  const progress = span > 0 ? Math.min(1, Math.max(0, (now - mv.departedAt) / span)) : 1;
  const startT = mv.startT ?? 0;
  return startT + ((mv.endT ?? 1) - startT) * progress;
}

/** Where a straight flight (SM-3.7b) is at `now`: evenly along the line, clamped to
 *  its ends outside the flight window. */
export function flightPointAt(fl: FleetFlight, now: number): RoadPoint {
  const span = fl.arrivesAt - fl.departedAt;
  const t = span > 0 ? Math.min(1, Math.max(0, (now - fl.departedAt) / span)) : 1;
  return { x: fl.from.x + (fl.to.x - fl.from.x) * t, y: fl.from.y + (fl.to.y - fl.from.y) * t };
}

/** A fleet's CONTINUOUS map position at `now`: its node, its interpolated spot
 *  mid-leg (a moving fleet), or its parked lane point — so range and sensor
 *  checks track the SHIP, not its destination. `null` when no position resolves
 *  (nodes missing from the map). */
export function fleetPositionAt(
  state: GameState,
  fleet: Fleet,
  now: number,
): { x: number; y: number } | null {
  if (fleet.location !== null) {
    return state.planets[fleet.location]?.position ?? null;
  }
  // A missile flies straight, off the lanes (SM-3.7b).
  if (fleet.flight) return flightPointAt(fleet.flight, now);
  // Along the lane's ROAD (ROADS-2): `t` is the share of the road's length, so the ship
  // sits where it would be had it flown the forks and the crossing — the point range,
  // sensors and the drawing all read. A lane without a road is the straight line.
  const lerp = (from: PlanetId, to: PlanetId, t: number): { x: number; y: number } | null => {
    const road = laneRoad(state, from, to);
    return road ? pointAlong(road, t) : null;
  };
  const mv = fleet.movement;
  if (mv) return lerp(mv.from, mv.to, legT(mv, now));
  const e = fleet.edge;
  if (e) return lerp(e.from, e.to, e.t);
  return null;
}

/** The node a fleet is NEAREST to at `now` — its anchor for graph-hop identify
 *  and for where its radar contact blips. Tracks the ship along its leg, not
 *  pinned to the destination. */
export function fleetNodeAt(state: GameState, fleet: Fleet, now: number): PlanetId | null {
  if (fleet.location) return fleet.location;
  // A missile is on no lane: its node is the world nearest to where it is (SM-3.7b), the
  // lower id on a tie — a fixed order (invariant #1).
  if (fleet.flight) {
    const at = flightPointAt(fleet.flight, now);
    let best: PlanetId | null = null;
    let bestD = Infinity;
    for (const id of Object.keys(state.planets).sort()) {
      const p = state.planets[id]!.position;
      const d = (p.x - at.x) ** 2 + (p.y - at.y) ** 2;
      if (d < bestD) {
        best = id;
        bestD = d;
      }
    }
    return best;
  }
  const mv = fleet.movement;
  // Which province the ship is in: the border crossing splits the lane (ROADS-2). On a
  // straight lane that is the midpoint, the rule this used before roads.
  if (mv) return legT(mv, now) <= crossingT(state, mv.from, mv.to) ? mv.from : mv.to;
  if (fleet.edge) {
    const e = fleet.edge;
    return e.t <= crossingT(state, e.from, e.to) ? e.from : e.to;
  }
  return null;
}
