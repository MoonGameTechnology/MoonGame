import type { Fleet, GameState, PlanetId } from './gameState';
import type { GameData } from '../data/schemas';
import type { Context } from '../action/types';
import { hoursToMs } from '../action/types';
import { effectiveStats } from '../util/loadout';

/**
 * Routing + travel-time over the lane graph (map-roadmap.md). The single source
 * of truth for "what route does a fleet take and how long is it": longer routes
 * take proportionally longer, since a leg's time is its Euclidean length over the
 * fleet's speed. Pure and deterministic — used by the movement module
 * (authoritative) and by the client for a move-preview ETA.
 */

/** Euclidean distance between two map positions. */
export function distance(a: { x: number; y: number }, b: { x: number; y: number }): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Fleet speed = the slowest SHIP in it (data-driven), 0 if it cannot move. Ground
 * troops ride in `landing`, never `units`, so they never affect speed. A badly
 * damaged hull drags: at/above 30% HP a ship runs at full speed; below 30% its
 * speed scales down with the remaining hull (floored so a crippled ship still limps
 * rather than freezing). `stack.hp` is set only during combat — full health
 * otherwise (gameState.ts §30-32) — so the penalty bites once a ship carries hull
 * damage outside a battle.
 */
export function fleetBaseSpeed(fleet: Fleet, data: GameData): number {
  let speed = Infinity;
  for (const stack of fleet.units) {
    const def = data.units[stack.unit];
    if (!def) continue;
    const eff = effectiveStats(def, stack, data);
    let s = eff.speed ?? 0;
    const maxHp = stack.count * (eff.hp ?? 0);
    if (stack.hp !== undefined && maxHp > 0) {
      const frac = stack.hp / maxHp;
      if (frac < 0.3) s *= Math.max(0.2, frac / 0.3); // limp below 30% hull
    }
    speed = Math.min(speed, s);
  }
  return Number.isFinite(speed) ? speed : 0;
}

/**
 * Dijkstra over the lane graph (planets + `links`, weighted by distance).
 * Returns the hops after `fromId` up to and including `toId`, or null if there
 * is no route. Deterministic: ties broken by planet id.
 *
 * **Transit (MAP-TRANSIT).** A sector that declares `transit` is not a full
 * interchange: only the neighbour pairs it lists connect THROUGH it, so two lanes
 * can cross the same province without meeting. The search therefore walks states of
 * (sector, lane it was entered by), not bare sectors — otherwise a route could
 * silently hop between two lanes that never touch. The state space only widens where
 * `transit` is actually declared: everywhere else the arrival lane cannot change the
 * answer, so those sectors keep exactly one state and big maps pay nothing.
 *
 * Departing from `fromId` is never constrained: the fleet is parked there, not in
 * transit. That is the honest cost of the rule — a fleet CAN switch lanes at a
 * transit sector by stopping in it and issuing a second order, paying the arrival
 * time for the privilege.
 */
export function planRoute(
  state: GameState,
  fromId: PlanetId,
  toId: PlanetId,
  // Optional node veto for diplomacy-aware planning (D2 right of way): a vetoed
  // node is not ENTERED, so the route detours around it. The DESTINATION is exempt
  // on purpose — "move onto a peace-locked world" must still produce a route so the
  // movement gate can reject it with E_NO_RIGHT_OF_WAY (and the client can offer a
  // war declaration) instead of a misleading E_NO_ROUTE. `fromId` needs no exemption:
  // routes never re-enter their origin. Pure and deterministic: the predicate is a
  // function of (state, player), never of wall-clock or randomness.
  blocked?: (id: PlanetId) => boolean,
  // HERO-CORRIDOR: вето по РЕБРУ — тем же механизмом, что и вето по узлу выше, а не
  // вторым маршрутизатором. Нужно для ЛИЧНОГО коридора: ребро физически есть в графе
  // (иначе не посчитать геометрию), но пройти по нему может не всякий. Предикат
  // спрашивается на каждом шаге релаксации, поэтому маршрут ОБХОДИТ закрытое ребро,
  // а не упирается в него. Чист и детерминирован, как и `blocked`.
  blockedEdge?: (from: PlanetId, to: PlanetId) => boolean,
): PlanetId[] | null {
  if (fromId === toId) {
    return [];
  }
  // A search state is a sector PLUS the lane it was entered by, but only where that
  // can change the answer — i.e. where the sector declares `transit`. Elsewhere one
  // state per sector, exactly as before.
  const gated = (id: PlanetId): boolean => (state.planets[id]?.transit?.length ?? 0) > 0;
  const keyOf = (node: PlanetId, from: PlanetId | null): string =>
    gated(node) ? `${node}\u0000${from ?? ''}` : node;
  const nodeOf = new Map<string, PlanetId>();
  const fromOf = new Map<string, PlanetId | null>();
  const remember = (node: PlanetId, from: PlanetId | null): string => {
    const k = keyOf(node, from);
    nodeOf.set(k, node);
    fromOf.set(k, from);
    return k;
  };
  /** May a fleet that entered `node` from `from` carry on to `to`? */
  const passable = (node: PlanetId, from: PlanetId | null, to: PlanetId): boolean => {
    const pairs = state.planets[node]?.transit;
    if (pairs === undefined || pairs.length === 0) return true; // full interchange
    if (from === null) return true; // departing from where we are parked, not passing through
    return pairs.some(([a, b]) => (a === from && b === to) || (b === from && a === to));
  };

  const dist = new Map<string, number>();
  const prev = new Map<string, string>();
  const visited = new Set<string>();
  dist.set(remember(fromId, null), 0);

  let reached: string | null = null;
  for (;;) {
    let u: string | null = null;
    let best = Infinity;
    for (const [k, d] of dist) {
      if (visited.has(k)) {
        continue;
      }
      if (u === null || d < best || (d === best && k < u)) {
        best = d;
        u = k;
      }
    }
    if (u === null) {
      break;
    }
    const uNode = nodeOf.get(u)!;
    if (uNode === toId) {
      reached = u;
      break;
    }
    visited.add(u);
    const planet = state.planets[uNode];
    if (!planet) {
      continue;
    }
    const uFrom = fromOf.get(u) ?? null;
    for (const v of [...(planet.links ?? [])].sort()) {
      const vp = state.planets[v];
      if (!vp) {
        continue;
      }
      if (!passable(uNode, uFrom, v)) {
        continue; // MAP-TRANSIT: these two lanes cross here, they do not meet
      }
      const vk = remember(v, uNode);
      if (visited.has(vk)) {
        continue;
      }
      if (blocked !== undefined && v !== toId && blocked(v)) {
        continue; // diplomacy veto: don't enter, detour around
      }
      if (blockedEdge !== undefined && blockedEdge(uNode, v)) {
        continue; // HERO-CORRIDOR: чужой личный коридор — ребра для нас нет
      }
      const nd = best + distance(planet.position, vp.position);
      const cur = dist.get(vk);
      if (cur === undefined || nd < cur) {
        dist.set(vk, nd);
        prev.set(vk, u);
      }
    }
  }

  if (reached === null) {
    return null;
  }
  const path: PlanetId[] = [];
  let cur: string | undefined = reached;
  const originKey = keyOf(fromId, null);
  while (cur !== undefined && cur !== originKey) {
    path.unshift(nodeOf.get(cur)!);
    cur = prev.get(cur);
  }
  return cur === originKey ? path : null;
}

/** Total lane distance of a route (the hops after `fromId`, in order). */
export function routeDistance(state: GameState, fromId: PlanetId, route: readonly PlanetId[]): number {
  let total = 0;
  let cur = state.planets[fromId];
  for (const hop of route) {
    const next = state.planets[hop];
    if (cur && next) {
      total += distance(cur.position, next.position);
    }
    cur = next;
  }
  return total;
}

/**
 * Estimated travel time in game-hours from `fromId` to `toId` along the shortest
 * lane route, at the fleet's base speed (the slowest unit). The client-side
 * preview estimate; the authoritative duration the server schedules additionally
 * runs each leg's speed through the `fleet.speed` hook (terrain), so the real
 * time can differ slightly. null if there is no route, or the fleet can't move.
 */
export function estimateTravelHours(
  state: GameState,
  data: GameData,
  fromId: PlanetId,
  toId: PlanetId,
  fleet: Fleet,
): number | null {
  const route = planRoute(state, fromId, toId);
  if (!route || route.length === 0) {
    return null;
  }
  const speed = fleetBaseSpeed(fleet, data);
  if (speed <= 0) {
    return null;
  }
  return routeDistance(state, fromId, route) / speed;
}

/** The node a fleet's CURRENT journey ends at — the one reading of
 *  `FleetMovement`'s journey fields (the movement module always stamps
 *  `destination`; the `path`-tail and `to` fallbacks keep hand-built or legacy
 *  records reading sanely). A `parkT`/`endT` short-stop still names this node:
 *  the journey ends on a lane at its doorstep. */
export function journeyDestination(mv: NonNullable<Fleet['movement']>): PlanetId {
  if (mv.destination !== undefined) return mv.destination;
  if (mv.path && mv.path.length > 0) return mv.path[mv.path.length - 1]!;
  return mv.to;
}

/** ETA (absolute ms) of a moving fleet at its journey's end: the current leg is
 *  authoritative (`arrivesAt`); remaining hops are estimated over the COMMITTED
 *  `path` at the fleet's base speed ÷ timeScale (the authoritative legs
 *  additionally run the `fleet.speed` hook, so the estimate can drift a
 *  little). No estimate possible (zero speed / broken map) → the current leg's
 *  arrival, the earliest plausible bound (fail-safe: callers react sooner,
 *  never later). */
export function journeyEtaMs(
  state: GameState,
  fleet: Fleet,
  mv: NonNullable<Fleet['movement']>,
  ctx: Context,
): number {
  if (!mv.path || mv.path.length === 0) return mv.arrivesAt;
  const speed = fleetBaseSpeed(fleet, ctx.data);
  if (speed <= 0) return mv.arrivesAt;
  return mv.arrivesAt + hoursToMs(ctx, routeDistance(state, mv.to, mv.path) / speed);
}
