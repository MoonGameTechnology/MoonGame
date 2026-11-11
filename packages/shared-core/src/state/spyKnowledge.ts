import type { GameState, PlanetId, PlayerId, Spy } from './gameState';
import { coalitionOf } from './coalition';
import { spyPath } from './spyTravel';

/**
 * What a player knows of who holds a world, for spy orders (SPY-24, owner's report
 * 2026-11-11). Fog of war decides what an order may be checked against: an order to a world
 * the player cannot see, accepted or refused by its hidden owner, would tell them that owner
 * — «sabotage was taken, so the world is someone's». So an order is checked against what the
 * player knows, and the truth is met by the spy on arrival.
 *
 * The player knows a world (owner's resolution 2026-11-11):
 *   - their own, and one held by a member of their coalition — there is no fog inside a
 *     coalition;
 *   - one they identify now (sight, a live recon window, a scan — `identified`);
 *   - one their spy stands on now (waiting or at work), live;
 *   - one a spy of theirs has been to (`scouted`): a spy learns whose a world is the moment
 *     it gets there, on its way to an order as much as at its end, recon or not. Out of
 *     sight such a world reads as the player last saw it: the fog memory's snapshot when it
 *     is the fresher one, else what the spy found.
 *
 * Pure: the espionage module checks orders with it, a client may grey out its buttons with it.
 */

/** Whose `viewerId` takes `planetId` to be; `undefined` — the player does not know. */
export function spyKnownOwner(
  state: Pick<GameState, 'planets' | 'fog' | 'scouted' | 'spies' | 'coalitions'>,
  viewerId: PlayerId,
  planetId: PlanetId,
  identified: ReadonlySet<PlanetId>,
): { owner: PlayerId | null } | undefined {
  const planet = state.planets[planetId];
  if (!planet) return undefined;
  const live = { owner: planet.owner };
  if (planet.owner === viewerId || identified.has(planetId)) return live;
  if (
    planet.owner !== null &&
    coalitionOf(state as GameState, viewerId)?.members.includes(planet.owner)
  )
    return live;
  const standing = (state.spies?.[viewerId] ?? []).some(
    (s) => s.location === planetId && (s.state === 'wait' || s.state === 'work'),
  );
  if (standing) return live;
  const found = state.scouted?.[viewerId]?.[planetId];
  if (!found) return undefined;
  const seen = state.fog?.[viewerId]?.[planetId];
  return { owner: seen && seen.at >= found.at ? seen.owner : found.owner };
}

/** Record that `viewerId`'s spy found `planetId` held by whoever holds it at `now`. Their own
 *  worlds are known anyway and take no record. */
export function noteScouted(
  state: GameState,
  viewerId: PlayerId,
  planetId: PlanetId,
  now: number,
): void {
  const planet = state.planets[planetId];
  if (!planet || planet.owner === viewerId) return;
  ((state.scouted ??= {})[viewerId] ??= {})[planetId] = { owner: planet.owner, at: now };
}

/** A spy learns whose every world on its way is, the one it came to included — recon or not
 *  (owner's resolution 2026-11-11). The way is the spy's route as the lanes run now, each
 *  world noted as it is held at the end of the journey (`now`). */
export function noteJourney(state: GameState, owner: PlayerId, spy: Spy, now: number): void {
  const route =
    spy.from === undefined ? [] : (spyPath(state, owner, spy.from, spy.location)?.route ?? []);
  for (const id of new Set([...route, spy.location])) noteScouted(state, owner, id, now);
}

/** Nobody can catch a spy on a world held by `target`: unclaimed, or its owner is out of the
 *  game — recon there needs no rolls. */
export function unguardedBy(state: Pick<GameState, 'players'>, target: PlayerId | null): boolean {
  return target === null || state.players[target]?.status !== 'active';
}
