import type { GameState, PlanetId, PlayerId } from './gameState';

/**
 * What a player knows of who holds a world, for spy orders (SPY-24, owner's report
 * 2026-11-11). Fog of war decides what an order may be checked against: an order to a world
 * the player cannot see, accepted or refused by its hidden owner, would tell them that owner
 * — «sabotage was taken, so the world is someone's». So an order is checked against what the
 * player knows, and the truth is met by the spy on arrival.
 *
 * The player knows a world that is their own, that they identify now (sight, a live recon
 * window, a scan — `identified`), or that one of their spies has reconnoitred (`scouted`).
 * Out of sight, a reconnoitred world reads as the player last saw it: the fog memory's
 * snapshot when there is one (it is at least as fresh — it is written while the world is in
 * sight), else what the spy found.
 *
 * Pure: the espionage module checks orders with it, a client may grey out its buttons with it.
 */

/** Whose `viewerId` takes `planetId` to be; `undefined` — the player does not know. */
export function spyKnownOwner(
  state: Pick<GameState, 'planets' | 'fog' | 'scouted'>,
  viewerId: PlayerId,
  planetId: PlanetId,
  identified: ReadonlySet<PlanetId>,
): { owner: PlayerId | null } | undefined {
  const planet = state.planets[planetId];
  if (!planet) return undefined;
  if (planet.owner === viewerId || identified.has(planetId)) return { owner: planet.owner };
  const found = state.scouted?.[viewerId]?.[planetId];
  if (!found) return undefined;
  const seen = state.fog?.[viewerId]?.[planetId];
  return { owner: seen && seen.at >= found.at ? seen.owner : found.owner };
}

/** Record that `viewerId`'s spy found `planetId` held by whoever holds it at `now`. */
export function noteScouted(
  state: GameState,
  viewerId: PlayerId,
  planetId: PlanetId,
  now: number,
): void {
  const planet = state.planets[planetId];
  if (!planet) return;
  ((state.scouted ??= {})[viewerId] ??= {})[planetId] = { owner: planet.owner, at: now };
}
