import type { PlanetId, PlanetRoads, RoadPoint, RoadTrail } from './gameState';
import type { MosaicBorderSegment } from './mosaic';

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
 * world instead, exactly as far as the cap needs; the trunk gets shorter, the road does
 * not get slower than this.
 */
export const FORK_DETOUR = 0.1;

/**
 * When a trail's exits pull in opposite directions, their mean lands near the world and
 * a "fork" would sit on top of the planet — a fork in name only. Below this share of the
 * exits' mean distance the trail runs THROUGH the world instead (fork = null). For two
 * exits at equal distance that is an angle of about 139° between them.
 */
export const THROUGH_WORLD = 0.35;

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
