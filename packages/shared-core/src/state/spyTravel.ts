import type { Context } from '../action/types';
import { hoursToMs, travelSpeedFactorOf } from '../action/types';
import { coalitionOf } from './coalition';
import { getStance } from './diplomacy';
import type { GameState, PlanetId, PlayerId, Spy, SpyWayPoint } from './gameState';
import { halfRoadLength } from './roads';

/**
 * Spy travel (SPY-23, owner's resolution 2026-11-10): before it works, a spy has to get to
 * the world. It flies the lanes like a fleet — the quickest way, transit rules included —
 * at `SPY_SPEED`, slowed by whose territory it crosses: full speed over its own and its
 * allies' worlds, `SPY_NEUTRAL_FACTOR` over unclaimed worlds and civilisations it is not at
 * war with, `SPY_ENEMY_FACTOR` over the worlds of those at war with it. Each lane is split
 * at its border: the half inside a province is flown at that province's pace.
 *
 * Pure and deterministic: the espionage module schedules with it, the client previews with
 * it ({@link spyTravelMs}).
 */

/** Ten times a scout (speed 64): the owner's starting point, to be tuned by feel. */
export const SPY_SPEED = 640;
export const SPY_NEUTRAL_FACTOR = 0.75;
export const SPY_ENEMY_FACTOR = 0.5;

/** The pace a spy of `playerId` keeps inside `planetId`'s province, as a share of its speed. */
export function spyTerritoryFactor(
  state: GameState,
  playerId: PlayerId,
  planetId: PlanetId,
): number {
  const owner = state.planets[planetId]?.owner ?? null;
  if (owner === null) return SPY_NEUTRAL_FACTOR;
  if (owner === playerId) return 1;
  const stance = getStance(state, playerId, owner);
  if (stance === 'alliance' || coalitionOf(state, playerId)?.members.includes(owner)) return 1;
  return stance === 'war' ? SPY_ENEMY_FACTOR : SPY_NEUTRAL_FACTOR;
}

/** The lane `a → b` as a spy of `playerId` flies it: each half at the pace of the province it
 *  lies in (map units at full speed). */
function spyLegLength(state: GameState, playerId: PlayerId, a: PlanetId, b: PlanetId): number {
  return (
    halfRoadLength(state, a, b) / spyTerritoryFactor(state, playerId, a) +
    halfRoadLength(state, b, a) / spyTerritoryFactor(state, playerId, b)
  );
}

/**
 * The quickest lane route for a spy of `playerId` from `fromId` to `toId`: the hops after
 * `fromId` and the route's length weighted by territory (map units at full speed). Dijkstra
 * over (world, lane it was entered by) where a world declares `transit` — two lanes that
 * only cross there do not meet — and over bare worlds elsewhere; ties broken by key, so the
 * answer is deterministic. `null` — no route. Standing at the target is an empty route.
 */
export function spyPath(
  state: GameState,
  playerId: PlayerId,
  fromId: PlanetId,
  toId: PlanetId,
): { route: PlanetId[]; length: number } | null {
  if (!state.planets[fromId] || !state.planets[toId]) return null;
  if (fromId === toId) return { route: [], length: 0 };
  const gated = (id: PlanetId): boolean => (state.planets[id]?.transit?.length ?? 0) > 0;
  const keyOf = (node: PlanetId, from: PlanetId | null): string =>
    gated(node) && from !== null ? `${node}\u0000${from}` : node;
  const node = new Map<string, { at: PlanetId; from: PlanetId | null }>();
  const dist = new Map<string, number>();
  const prev = new Map<string, string>();
  const done = new Set<string>();
  const start = keyOf(fromId, null);
  node.set(start, { at: fromId, from: null });
  dist.set(start, 0);
  for (;;) {
    let u: string | null = null;
    let best = Infinity;
    for (const [k, d] of dist) {
      if (done.has(k)) continue;
      if (u === null || d < best || (d === best && k < u)) {
        u = k;
        best = d;
      }
    }
    if (u === null) return null;
    done.add(u);
    const { at, from } = node.get(u)!;
    if (at === toId) {
      const route: PlanetId[] = [];
      for (let k: string | undefined = u; k !== undefined && k !== start; k = prev.get(k)) {
        route.unshift(node.get(k)!.at);
      }
      return { route, length: best };
    }
    const pairs = state.planets[at]?.transit;
    for (const next of [...(state.planets[at]?.links ?? [])].sort()) {
      if (!state.planets[next]) continue;
      if (from !== null && pairs && pairs.length > 0) {
        const through = pairs.some(
          ([a, b]) => (a === from && b === next) || (b === from && a === next),
        );
        if (!through) continue; // MAP-TRANSIT: these lanes cross here, they do not meet
      }
      const k = keyOf(next, at);
      if (done.has(k)) continue;
      const leg = spyLegLength(state, playerId, at, next);
      const nd = best + leg;
      const cur = dist.get(k);
      if (cur === undefined || nd < cur) {
        node.set(k, { at: next, from: at });
        dist.set(k, nd);
        prev.set(k, u);
      }
    }
  }
}

/** World-time (ms) a journey of territory-weighted `length` takes: `SPY_SPEED` × the match's
 *  travel factor × `speedFactor` (the `espionage.speed` pipeline on the server), compressed
 *  by the match timeScale. Rounded to whole ms. A broken speed → `null`. */
export function spyJourneyMs(
  rules: Pick<Context, 'data' | 'config'>,
  length: number,
  speedFactor = 1,
): number | null {
  const speed = SPY_SPEED * travelSpeedFactorOf(rules) * speedFactor;
  if (!Number.isFinite(speed) || speed <= 0) return null;
  return Math.round(hoursToMs({ ...rules, now: 0 }, length / speed));
}

/**
 * The timed way of a journey (SPM-1, `Spy.way`): the quickest route `from` → `to` with the
 * world-time the spy reaches each world, spread over `departedAt`…`arrivesAt` in proportion to
 * the territory-weighted length of each lane — the spy's pace is the same all the way, only the
 * territory slows it. `lead` is a way already owed before it (a spy turning back,
 * {@link spyTurnBack}): it ends at `from`, and the route starts from its last time. No route →
 * straight from the start to `to`.
 */
export function spyWay(
  state: GameState,
  playerId: PlayerId,
  from: PlanetId,
  to: PlanetId,
  departedAt: number,
  arrivesAt: number,
  lead?: readonly SpyWayPoint[],
): SpyWayPoint[] {
  const way: SpyWayPoint[] = lead?.length
    ? lead.map((p) => ({ ...p }))
    : [{ at: from, t: departedAt }];
  const start = way[way.length - 1]!.t;
  const path = spyPath(state, playerId, from, to);
  if (!path || path.route.length === 0) {
    if (way[way.length - 1]!.at !== to) way.push({ at: to, t: arrivesAt });
    else way[way.length - 1]!.t = arrivesAt;
    return way;
  }
  let prev = from;
  let flown = 0;
  for (const id of path.route) {
    flown += spyLegLength(state, playerId, prev, id);
    const share = path.length > 0 ? flown / path.length : 1;
    way.push({
      at: id,
      t: id === to ? arrivesAt : start + Math.round((arrivesAt - start) * share),
    });
    prev = id;
  }
  return way;
}

/**
 * The way back of a spy called off mid-journey at `now` (SPM-1): it retraces the lanes it has
 * flown, as fast as it came, to the world it set out from — reached `now − departedAt` later.
 * The first point is the world just ahead of it, timed in the past, so that `now` falls on the
 * very lane point where it turned. `undefined` — no way, or the journey is not under way.
 */
export function spyTurnBack(
  way: readonly SpyWayPoint[] | undefined,
  now: number,
): SpyWayPoint[] | undefined {
  if (!way?.length || way[0]!.t > now) return undefined;
  const ahead = way.findIndex((p) => p.t > now);
  if (ahead < 0) return undefined;
  const out: SpyWayPoint[] = [];
  for (let i = ahead; i >= 0; i--) out.push({ at: way[i]!.at, t: 2 * now - way[i]!.t });
  return out;
}

/**
 * Where on its way a spy is at `now` (SPM-1, for the owner's map): flying the lane `a → b`,
 * `f` of it behind. Before the way starts it stands at the first world, after it ends at the
 * last (`a === b`, `f` 0). An empty way → `null`.
 */
export function spyWayAt(
  way: readonly SpyWayPoint[] | undefined,
  now: number,
): { a: PlanetId; b: PlanetId; f: number } | null {
  if (!way?.length) return null;
  const first = way[0]!;
  if (now <= first.t) return { a: first.at, b: first.at, f: 0 };
  for (let i = 1; i < way.length; i++) {
    const p = way[i - 1]!;
    const q = way[i]!;
    if (now < q.t) return { a: p.at, b: q.at, f: q.t > p.t ? (now - p.t) / (q.t - p.t) : 1 };
  }
  const last = way[way.length - 1]!;
  return { a: last.at, b: last.at, f: 0 };
}

/** Where a spy that is free for an order stands: its world when it rests, waits or works;
 *  `null` while it is on the way, being replaced or lying low. */
export function spyStandsAt(spy: Spy): PlanetId | null {
  return spy.state === 'rest' || spy.state === 'wait' || spy.state === 'work' ? spy.location : null;
}

/** The route spy `spyId` of `playerId` would fly to `planetId` from where it stands, or
 *  `null` when there is no such spy, it is not standing anywhere, or no route. */
export function spyRoute(
  state: GameState,
  playerId: PlayerId,
  spyId: number,
  planetId: PlanetId,
): PlanetId[] | null {
  const spy = spyRoster(state, playerId).find((s) => s.id === spyId);
  const at = spy ? spyStandsAt(spy) : null;
  return at === null ? null : (spyPath(state, playerId, at, planetId)?.route ?? null);
}

/** How long spy `spyId` of `playerId` would travel to `planetId` (ms), for the client's
 *  preview; `speedFactor` stands in for the server-side `espionage.speed` pipeline (a spy's
 *  level). `null` — no such free spy, or no route. */
export function spyTravelMs(
  state: GameState,
  rules: Pick<Context, 'data' | 'config'>,
  playerId: PlayerId,
  spyId: number,
  planetId: PlanetId,
  speedFactor = 1,
): number | null {
  const spy = spyRoster(state, playerId).find((s) => s.id === spyId);
  const at = spy ? spyStandsAt(spy) : null;
  const path = at === null ? null : spyPath(state, playerId, at, planetId);
  return path ? spyJourneyMs(rules, path.length, speedFactor) : null;
}

/** A player's capital, if it still stands: the designated world, while they own it. */
export function spyHome(state: GameState, playerId: PlayerId): PlanetId | null {
  const capital = state.capital?.[playerId];
  return capital !== undefined && state.planets[capital]?.owner === playerId ? capital : null;
}

/** The base size of a player's spy network (SPY-6); the `espionage.agents` pipeline may
 *  bend it on the server. */
export const BASE_SPY_AGENTS = 3;

/**
 * A player's spies: the registry once they have given an order, otherwise the base network
 * as it stands at the start — `size` spies resting in the capital, or lying low without one.
 */
export function spyRoster(state: GameState, playerId: PlayerId, size = BASE_SPY_AGENTS): Spy[] {
  const own = state.spies?.[playerId];
  if (own) return own;
  const home = spyHome(state, playerId);
  const out: Spy[] = [];
  for (let id = 1; id <= size; id++) {
    out.push({
      id,
      gen: 1,
      state: home ? 'rest' : 'hidden',
      location: home ?? lastResort(state, playerId),
    });
  }
  return out;
}

/** Where a spy with no capital to go to is said to be: the player's first world by id, or
 *  nowhere (`''`) when they hold none. */
export function lastResort(state: GameState, playerId: PlayerId): PlanetId {
  return (
    Object.keys(state.planets)
      .sort()
      .find((id) => state.planets[id]!.owner === playerId) ?? ''
  );
}
