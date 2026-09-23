import type { GameState, Planet, PlanetId, PlanetRoads, RoadPoint, RoadTrail } from './gameState';
import type { MosaicBorderSegment } from './mosaic';
import { shareImmutable } from '../util/clone';

/**
 * Roads inside provinces (ROADS-1, `docs/roads-roadmap.md` §0.3).
 *
 * A lane used to be the straight line between two province centres, and everything that
 * happens "on the road" — travel time, where a ship is, where two fleets meet — was
 * measured on that line. The owner's model is a road NETWORK: a world sends out a few
 * trails, a trail forks towards the neighbours it serves, and a fork is the place where
 * roads diverge — a point on a road, never a province of its own. This module derives
 * that network. It moves nothing (that is ROADS-2); it only answers "where are the roads".
 *
 * What it derives, per province:
 *
 * - a CROSSING per lane: where the road passes the shared border — the point of the
 *   shared edge closest to the midpoint between the two centres. Where the edge covers
 *   the straight line, the road crosses exactly where the line did.
 * - TRAILS: how many roads leave the world is terrain data (`corridors`; absent = one per
 *   neighbour, as in open space). Neighbours are grouped by direction: the circle around
 *   the world is cut at the widest angular gaps between exits, so exits on one side share
 *   a trail.
 * - a FORK per trail that serves several neighbours, on the way from the world to the
 *   mean of the trail's crossings: at most {@link FORK_AT} of it, and no farther than
 *   keeps each branch within {@link FORK_DETOUR} of the straight way. The world and that
 *   mean lie in the (convex) power cell, so the fork does too — by construction.
 *
 * Why there is no `Math.atan2` here: the network lives in the state and must come out
 * bit-identical on every machine, and `atan2` is not specified to the last bit. Angles are
 * ordered with half-planes and cross products, gap sizes with a monotonic function of the
 * cosine — `+ − × /` and `Math.sqrt` only, all IEEE-754-exact (the rule `mosaic.ts`
 * follows for the same reason).
 */

/** Where a trail forks: this share of the way from the world to the mean of its
 *  crossings. Halfway keeps the trunk long enough to read as a trunk and the branches
 *  long enough to read as branches. */
export const FORK_AT = 0.5;

/**
 * The most a fork may lengthen a road: the way from the world through the fork to a
 * crossing is at most this much longer than the straight way to it. Without a cap a fork
 * halfway out, serving exits spread wide, made one road of the first chapter half again
 * as long as the line — and travel time is the game's pace. The fork moves closer to the
 * world instead, exactly as far as the cap needs.
 *
 * The cap is a trade, measured on the shipped maps: at 10% half the forks sat within a
 * quarter of the way from their world (the nearest at 3%) — a fork on top of the planet,
 * where a road "from a road" reads as a road from the world. At 20% the median fork is
 * 39% of the way out and roads run 3.6% longer on average (the longest 10.3%).
 */
export const FORK_DETOUR = 0.2;

/**
 * When a trail's exits pull apart, their mean lands near the world and a "fork" would sit
 * on top of the planet — a fork in name only. Below this share of the exits' mean distance
 * the trail runs THROUGH the world instead (fork = null). For two exits at equal distance
 * that is an angle of about 106° between them: wider than that, the two roads meet at the
 * world, not at a place of their own.
 */
export const THROUGH_WORLD = 0.6;

/** What the derivation reads: centres and terrain, the lanes, the shared edges. */
export interface RoadInput {
  sectors: Readonly<Record<PlanetId, { x: number; y: number; terrain?: string }>>;
  /** The lanes — each pair once, in any order. */
  lanes: ReadonlyArray<readonly [PlanetId, PlanetId]>;
  /** The mosaic's shared edges. A lane with no edge here (an authored `paths` map, where
   *  a lane need not follow a border) crosses at the midpoint between the centres. */
  borders: readonly MosaicBorderSegment[];
  /** Trails a world of this terrain sends out; undefined = one per neighbour. */
  corridorsOf: (terrain: string | undefined) => number | undefined;
}

/** The point of segment p→q closest to (x, y). */
function closestOnSegment(
  x: number,
  y: number,
  p: [number, number],
  q: [number, number],
): RoadPoint {
  const dx = q[0] - p[0];
  const dy = q[1] - p[1];
  const len2 = dx * dx + dy * dy;
  if (len2 <= 0) return { x: p[0], y: p[1] };
  let t = ((x - p[0]) * dx + (y - p[1]) * dy) / len2;
  if (t < 0) t = 0;
  else if (t > 1) t = 1;
  return { x: p[0] + dx * t, y: p[1] + dy * t };
}

/** 0 for a direction in [0, π), 1 for [π, 2π) — the half-plane half of an angle order. */
function half(v: RoadPoint): number {
  return v.y > 0 || (v.y === 0 && v.x > 0) ? 0 : 1;
}

/**
 * The counter-clockwise angle from `u` to `v`, as a number that grows with the angle
 * over the whole turn: `1 − cos` on [0, π] (0 … 2), `3 + cos` beyond (2 … 4). Only the
 * ORDER of gaps matters for cutting trails, so a monotonic stand-in for the angle is as
 * good as the angle and, unlike `atan2`, exact.
 */
function ccwGap(u: RoadPoint, v: RoadPoint): number {
  const nu = Math.sqrt(u.x * u.x + u.y * u.y);
  const nv = Math.sqrt(v.x * v.x + v.y * v.y);
  if (nu === 0 || nv === 0) return 0;
  const cos = (u.x * v.x + u.y * v.y) / (nu * nv);
  const cross = u.x * v.y - u.y * v.x;
  return cross >= 0 ? 1 - cos : 3 + cos;
}

/** The trails of one world, given its exits' crossings. */
function trailsOf(
  centre: RoadPoint,
  exits: ReadonlyArray<{ id: PlanetId; at: RoadPoint }>,
  corridors: number | undefined,
): RoadTrail[] {
  const dir = (e: { at: RoadPoint }): RoadPoint => ({ x: e.at.x - centre.x, y: e.at.y - centre.y });
  // Angular order, exact: half-plane first, then the cross product, then the id — so two
  // exits in precisely the same direction still order the same way everywhere.
  const sorted = [...exits].sort((a, b) => {
    const va = dir(a);
    const vb = dir(b);
    const h = half(va) - half(vb);
    if (h !== 0) return h;
    const cross = va.x * vb.y - va.y * vb.x;
    if (cross !== 0) return cross > 0 ? -1 : 1;
    return a.id < b.id ? -1 : 1;
  });
  const n = sorted.length;
  if (corridors === undefined || n <= corridors) {
    return sorted.map((e) => ({ exits: [e.id], fork: null }));
  }
  // Cut the circle at the `corridors` widest gaps; gap i runs from exit i to exit i+1.
  const gaps = sorted.map((e, i) => ({ i, g: ccwGap(dir(e), dir(sorted[(i + 1) % n]!)) }));
  const cuts = new Set(
    [...gaps]
      .sort((a, b) => (b.g !== a.g ? b.g - a.g : a.i - b.i))
      .slice(0, corridors)
      .map((c) => c.i),
  );
  const first = Math.min(...cuts);
  const groups: Array<Array<{ id: PlanetId; at: RoadPoint }>> = [];
  let current: Array<{ id: PlanetId; at: RoadPoint }> = [];
  for (let s = 1; s <= n; s++) {
    const i = (first + s) % n;
    current.push(sorted[i]!);
    if (cuts.has(i)) {
      groups.push(current);
      current = [];
    }
  }
  return groups.map((group) => {
    if (group.length === 1) return { exits: [group[0]!.id], fork: null };
    let mx = 0;
    let my = 0;
    let reach = 0;
    for (const e of group) {
      const v = dir(e);
      mx += v.x;
      my += v.y;
      reach += Math.sqrt(v.x * v.x + v.y * v.y);
    }
    mx /= group.length;
    my /= group.length;
    reach /= group.length;
    const pull = Math.sqrt(mx * mx + my * my);
    if (pull < THROUGH_WORLD * reach) return { exits: group.map((e) => e.id), fork: null };
    // Along the trail's direction, no farther than FORK_AT of the way to the mean and no
    // farther than keeps every branch within FORK_DETOUR. For an exit at distance d and
    // angle θ off the trail, the way through a fork at distance s is
    // s + √(d² + s² − 2sd·cosθ); setting it to (1 + FORK_DETOUR)·d and solving for s gives
    // s = d·((1 + c)² − 1) / (2·((1 + c) − cosθ)) — closed form, no search.
    const ux = mx / pull;
    const uy = my / pull;
    const c1 = 1 + FORK_DETOUR;
    let s = FORK_AT * pull;
    for (const e of group) {
      const v = dir(e);
      const d = Math.sqrt(v.x * v.x + v.y * v.y);
      if (d === 0) continue;
      const cos = (ux * v.x + uy * v.y) / d;
      const cap = (d * (c1 * c1 - 1)) / (2 * (c1 - cos));
      if (cap < s) s = cap;
    }
    return { exits: group.map((e) => e.id), fork: { x: centre.x + ux * s, y: centre.y + uy * s } };
  });
}

/**
 * The road network of a map: per province with at least one lane, its crossings and its
 * trails. Pure and deterministic — the same input yields the same network, key for key,
 * whatever order the sectors and lanes arrive in.
 */
export function deriveRoads(input: RoadInput): Record<PlanetId, PlanetRoads> {
  const edgeOf = new Map<string, MosaicBorderSegment>();
  for (const b of input.borders) edgeOf.set(`${b.a}|${b.b}`, b);
  const crossings = new Map<PlanetId, Array<{ id: PlanetId; at: RoadPoint }>>();
  const lanes = input.lanes
    .map(([a, b]) => (a < b ? [a, b] : [b, a]) as [PlanetId, PlanetId])
    .sort((p, q) => (p[0] === q[0] ? (p[1] < q[1] ? -1 : 1) : p[0] < q[0] ? -1 : 1));
  let prev = '';
  for (const [a, b] of lanes) {
    const key = `${a}|${b}`;
    if (key === prev) continue; // a lane listed twice is still one road
    prev = key;
    const A = input.sectors[a];
    const B = input.sectors[b];
    if (!A || !B) continue;
    const mx = (A.x + B.x) / 2;
    const my = (A.y + B.y) / 2;
    const edge = edgeOf.get(key);
    const at = edge ? closestOnSegment(mx, my, edge.p, edge.q) : { x: mx, y: my };
    if (!crossings.has(a)) crossings.set(a, []);
    if (!crossings.has(b)) crossings.set(b, []);
    crossings.get(a)!.push({ id: b, at: { x: at.x, y: at.y } });
    crossings.get(b)!.push({ id: a, at: { x: at.x, y: at.y } });
  }
  const out: Record<PlanetId, PlanetRoads> = {};
  for (const id of [...crossings.keys()].sort()) {
    const sec = input.sectors[id]!;
    const exits = crossings.get(id)!;
    const byId: Record<PlanetId, RoadPoint> = {};
    for (const e of [...exits].sort((p, q) => (p.id < q.id ? -1 : 1))) byId[e.id] = e.at;
    out[id] = {
      crossings: byId,
      trails: trailsOf({ x: sec.x, y: sec.y }, exits, input.corridorsOf(sec.terrain)),
    };
  }
  return out;
}

// ── Reading the network (ROADS-2): what movement, routing and positions ask of it ──

/** The fork of `at`'s trail that serves `toward`; null when that trail runs straight or
 *  through the world, or `at` has no roads. */
export function forkToward(state: GameState, at: PlanetId, toward: PlanetId): RoadPoint | null {
  const trail = state.planets[at]?.roads?.trails.find((t) => t.exits.includes(toward));
  return trail?.fork ?? null;
}

/**
 * The fork a fleet takes when it goes through `at` from `from` to `to` WITHOUT visiting
 * the world: both neighbours hang off the same trail and that trail forks. Null = the way
 * through `at` leads past its planet (owner's rule, `roads-roadmap.md` §0.2: only that way
 * meets the fleets stationed there and takes an empty province).
 */
export function bypassFork(
  state: GameState,
  at: PlanetId,
  from: PlanetId,
  to: PlanetId,
): RoadPoint | null {
  if (from === to) return null;
  const trail = state.planets[at]?.roads?.trails.find((t) => t.exits.includes(from));
  return trail?.fork && trail.exits.includes(to) ? trail.fork : null;
}

/**
 * The road of a lane, world to world: `[world, fork?, crossing, fork?, world]`. A lane
 * with no road on either side — a state built before roads, a hero's temporary lane —
 * is the straight line, exactly the pre-road rule, so such a match plays on unchanged.
 */
/**
 * Marks every province's road network shareable ({@link shareImmutable}): the network never
 * changes for the whole match, so the kernel's per-step clone need not copy it (ROADS-7 —
 * on the 831-province map that copy made each step ~55% slower). Both state builders call
 * it; a host calls it again for a state that came through JSON — a save, the network — since
 * a round trip drops the mark. Returns the same record.
 */
export function shareRoadNetwork(planets: Record<PlanetId, Planet>): Record<PlanetId, Planet> {
  for (const planet of Object.values(planets)) {
    if (planet.roads) shareImmutable(planet.roads);
  }
  return planets;
}

export function laneRoad(state: GameState, from: PlanetId, to: PlanetId): RoadPoint[] | null {
  const a = state.planets[from];
  const b = state.planets[to];
  if (!a || !b) return null;
  const x = a.roads?.crossings[to];
  if (!x || !b.roads?.crossings[from]) return [a.position, b.position];
  const pts: RoadPoint[] = [a.position];
  const fa = forkToward(state, from, to);
  if (fa) pts.push(fa);
  pts.push(x);
  const fb = forkToward(state, to, from);
  if (fb) pts.push(fb);
  pts.push(b.position);
  return pts;
}

/** Length of a polyline. */
export function polylineLength(pts: readonly RoadPoint[]): number {
  let total = 0;
  for (let i = 1; i < pts.length; i++) {
    const dx = pts[i]!.x - pts[i - 1]!.x;
    const dy = pts[i]!.y - pts[i - 1]!.y;
    total += Math.sqrt(dx * dx + dy * dy);
  }
  return total;
}

/** The point at arc-length fraction `t` ∈ [0,1] of a polyline (clamped). */
export function pointAlong(pts: readonly RoadPoint[], t: number): RoadPoint {
  if (pts.length === 1 || t <= 0) return { x: pts[0]!.x, y: pts[0]!.y };
  const total = polylineLength(pts);
  if (t >= 1 || total <= 0) {
    const last = pts[pts.length - 1]!;
    return { x: last.x, y: last.y };
  }
  let left = total * t;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!;
    const b = pts[i]!;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const seg = Math.sqrt(dx * dx + dy * dy);
    if (left <= seg && seg > 0) {
      const k = left / seg;
      return { x: a.x + dx * k, y: a.y + dy * k };
    }
    left -= seg;
  }
  const last = pts[pts.length - 1]!;
  return { x: last.x, y: last.y };
}

/** Length of the lane's road (the straight line where the lane has no road). */
export function laneRoadLength(state: GameState, from: PlanetId, to: PlanetId): number {
  const road = laneRoad(state, from, to);
  return road ? polylineLength(road) : 0;
}

/** Arc fraction, along the road `from`→`to`, of its vertex `index` (0 = `from`'s world). */
function vertexT(road: readonly RoadPoint[], index: number): number {
  const total = polylineLength(road);
  return total > 0 ? polylineLength(road.slice(0, index + 1)) / total : 0;
}

/** Where along the road `from`→`to` it crosses the border — the province line on the lane.
 *  0.5 on a straight lane, which is where the midpoint rule always put it. */
export function crossingT(state: GameState, from: PlanetId, to: PlanetId): number {
  const road = laneRoad(state, from, to);
  if (!road || road.length === 2) return 0.5;
  return vertexT(road, forkToward(state, from, to) ? 2 : 1);
}

/** Where along the road `from`→`to` it reaches `to`'s fork (serving `from`); 1 when `to`
 *  has no fork on that trail — the road runs on to the world. */
export function forkTAtEnd(state: GameState, from: PlanetId, to: PlanetId): number {
  const road = laneRoad(state, from, to);
  if (!road || road.length === 2 || !forkToward(state, to, from)) return 1;
  return vertexT(road, road.length - 2);
}

/** Where along the road `from`→`to` it leaves `from`'s fork (serving `to`); 0 when `from`
 *  has no fork on that trail — the road starts at the world. */
export function forkTAtStart(state: GameState, from: PlanetId, to: PlanetId): number {
  const road = laneRoad(state, from, to);
  if (!road || road.length === 2 || !forkToward(state, from, to)) return 0;
  return vertexT(road, 1);
}

/** The road inside `at` from its world to the border with `toward` (via the trail's fork).
 *  Without a road: half the straight lane, the share the midpoint rule gave each side. */
export function halfRoadLength(state: GameState, at: PlanetId, toward: PlanetId): number {
  const road = laneRoad(state, at, toward);
  if (!road) return 0;
  if (road.length === 2) return polylineLength(road) / 2;
  return polylineLength(road.slice(0, forkToward(state, at, toward) ? 3 : 2));
}

/** The road inside `at` for a fleet entering from `from` and leaving to `to`: through the
 *  fork when the two share a forked trail, otherwise in to the world and out again. */
export function passRoadLength(
  state: GameState,
  at: PlanetId,
  from: PlanetId,
  to: PlanetId,
): number {
  const fork = bypassFork(state, at, from, to);
  const xin = state.planets[at]?.roads?.crossings[from];
  const xout = state.planets[at]?.roads?.crossings[to];
  if (fork && xin && xout) return polylineLength([xin, fork, xout]);
  return halfRoadLength(state, at, from) + halfRoadLength(state, at, to);
}

/**
 * Where a leg `from`→`to` ends when the journey goes on to `after` (ROADS-2): at `to`'s
 * fork if the way on shares its trail — unless the leg starts past that fork (a fleet
 * parked on the trunk goes on to the world rather than turn back) — else at the world.
 * The last leg (`after` undefined) ends at `parkT`. ONE rule for movement and for the
 * route line, so the line cannot promise a way the fleet will not fly.
 */
export function legEndT(
  state: GameState,
  from: PlanetId,
  to: PlanetId,
  after: PlanetId | undefined,
  startT: number,
  parkT = 1,
): number {
  if (after === undefined) return parkT;
  if (bypassFork(state, to, from, after)) {
    const atFork = forkTAtEnd(state, from, to);
    if (atFork > startT) return atFork;
  }
  return 1;
}

/** The part of a polyline between arc fractions `t0` ≤ `t1`: the point at `t0`, the
 *  vertices strictly between, the point at `t1`. */
export function subPolyline(pts: readonly RoadPoint[], t0: number, t1: number): RoadPoint[] {
  const total = polylineLength(pts);
  const out: RoadPoint[] = [pointAlong(pts, t0)];
  if (total > 0) {
    let run = 0;
    for (let i = 1; i < pts.length - 1; i++) {
      const dx = pts[i]!.x - pts[i - 1]!.x;
      const dy = pts[i]!.y - pts[i - 1]!.y;
      run += Math.sqrt(dx * dx + dy * dy);
      const t = run / total;
      if (t > t0 && t < t1) out.push({ x: pts[i]!.x, y: pts[i]!.y });
    }
  }
  out.push(pointAlong(pts, t1));
  return out;
}

/**
 * The road a journey still has to fly, from arc fraction `t` of its current leg: that leg
 * to its end, then every leg after it — through a fork where the fleet will go round a
 * world, exactly as `movement` will fly it. What a route line draws.
 */
export function roadAhead(
  state: GameState,
  mv: { from: PlanetId; to: PlanetId; path?: PlanetId[]; endT?: number; parkT?: number },
  t: number,
): RoadPoint[] {
  const out: RoadPoint[] = [];
  const path = mv.path ?? [];
  let from = mv.from;
  let to = mv.to;
  let startT = t;
  let endT = mv.endT ?? 1;
  for (let i = 0; ; i++) {
    const road = laneRoad(state, from, to);
    if (!road) break;
    for (const p of subPolyline(road, startT, endT)) {
      const last = out[out.length - 1];
      if (!last || last.x !== p.x || last.y !== p.y) out.push(p);
    }
    const next = path[i];
    if (next === undefined) break;
    // A leg that stopped short of the world stopped at its fork: the next one sets off
    // from that fork (the same point, seen from the lane ahead).
    startT = endT < 1 ? forkTAtStart(state, to, next) : 0;
    endT = legEndT(state, to, next, path[i + 1], startT, mv.parkT ?? 1);
    from = to;
    to = next;
  }
  return out;
}

// ── Shared stretches (ROADS-3): where fleets of different lanes meet ──

/**
 * A TRUNK — the stretch from a world to its trail's fork, shared by every road on that
 * trail. It is the one place where fleets bound for DIFFERENT neighbours ride the same
 * road, and its end is the fork, which every bypass touches. Positions on it are counted
 * from the world (`u`, world units).
 */
export interface TrunkSpan {
  /** `province#trail` — the same key from every lane of the trail. */
  key: string;
  /** The province whose trail it is — where a meeting on it is fought. */
  province: PlanetId;
  /** Trunk length: world → fork. */
  length: number;
  /** The lane-fraction interval of the road `from`→`to` that runs on this trunk. */
  t0: number;
  t1: number;
  /** Distance from the world at lane fraction `t` (linear on the interval). */
  uAt: (t: number) => number;
}

function trailIndex(state: GameState, at: PlanetId, toward: PlanetId): number {
  return state.planets[at]?.roads?.trails.findIndex((t) => t.exits.includes(toward)) ?? -1;
}

/** Two fractions of one lane this close are one point: the rounding between a fraction and
 *  its mirror `1 − t`, seen from the other end of the lane. */
export const T_EPS = 1e-9;

/** The fork a lane point stands ON — `from`'s (serving `to`) or `to`'s (serving `from`) —
 *  with its trail's exits; null when the point is not a fork. */
export function forkAt(
  state: GameState,
  from: PlanetId,
  to: PlanetId,
  t: number,
): { province: PlanetId; exits: PlanetId[] } | null {
  const exitsOf = (at: PlanetId, toward: PlanetId): PlanetId[] =>
    state.planets[at]?.roads?.trails.find((tr) => tr.exits.includes(toward))?.exits ?? [];
  if (forkToward(state, from, to) && Math.abs(t - forkTAtStart(state, from, to)) <= T_EPS) {
    return { province: from, exits: [...exitsOf(from, to)] };
  }
  if (forkToward(state, to, from) && Math.abs(t - forkTAtEnd(state, from, to)) <= T_EPS) {
    return { province: to, exits: [...exitsOf(to, from)] };
  }
  return null;
}

/**
 * How near a fork a stop snaps onto it: this share of the shorter road piece the fork joins
 * (its trunk, or the branch to the border). The fork is the one point that sees every road
 * of its trail (ROADS-3), a stop a hair short of it sees one road only, and a finger on a
 * phone cannot tell the two apart. On the shipped maps that is 6 … 32 units each way
 * (median 11.5); the shorter piece is the trunk at 41 of the 43 branches.
 */
export const FORK_SNAP = 0.25;

/** A stop at fraction `t` of the road `from`→`to`, moved onto a fork it is near
 *  ({@link FORK_SNAP}); unchanged otherwise, and on a lane without forks. */
export function snapToFork(state: GameState, from: PlanetId, to: PlanetId, t: number): number {
  const road = laneRoad(state, from, to);
  if (!road || road.length === 2) return t;
  const x = crossingT(state, from, to);
  if (forkToward(state, from, to)) {
    const f = forkTAtStart(state, from, to);
    if (Math.abs(t - f) <= FORK_SNAP * Math.min(f, x - f)) return f;
  }
  if (forkToward(state, to, from)) {
    const f = forkTAtEnd(state, from, to);
    if (Math.abs(t - f) <= FORK_SNAP * Math.min(1 - f, f - x)) return f;
  }
  return t;
}

/** The trunks the road `from`→`to` runs on: `from`'s (at its start) and `to`'s (at its
 *  end), each only when that side's trail forks. */
export function laneTrunks(state: GameState, from: PlanetId, to: PlanetId): TrunkSpan[] {
  const road = laneRoad(state, from, to);
  if (!road || road.length === 2) return [];
  const total = polylineLength(road);
  if (!(total > 0)) return [];
  const out: TrunkSpan[] = [];
  const fa = forkToward(state, from, to);
  if (fa) {
    const t1 = forkTAtStart(state, from, to);
    out.push({
      key: `${from}#${trailIndex(state, from, to)}`,
      province: from,
      length: t1 * total,
      t0: 0,
      t1,
      uAt: (t) => t * total,
    });
  }
  const fb = forkToward(state, to, from);
  if (fb) {
    const t0 = forkTAtEnd(state, from, to);
    out.push({
      key: `${to}#${trailIndex(state, to, from)}`,
      province: to,
      length: (1 - t0) * total,
      t0,
      t1: 1,
      uAt: (t) => (1 - t) * total,
    });
  }
  return out;
}
