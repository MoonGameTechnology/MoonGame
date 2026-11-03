import { isDeepStrictEqual } from 'node:util';
import type { Action, GameState } from '@void/shared-core';

export const meaningfulRewardOrders = new Set([
  'fleet.move',
  'fleet.bombard',
  'fleet.assault',
  'fleet.retreat',
  'battle.retreat',
  'building.construct',
  'building.upgrade',
  'building.repair',
  'unit.build',
  'technology.research',
  'station.deploy',
  'station.repair',
]);

/** Compare against the state AFTER catch-up but BEFORE the order. Repeating an
 * already selected target/toggle cannot manufacture activity from the timer's work. */
export function isMeaningfulRewardOrder(
  action: Action,
  before: GameState,
  after: GameState,
): boolean {
  if (!meaningfulRewardOrders.has(action.type)) return false;
  const player = action.playerId;
  if (!isDeepStrictEqual(before.players[player]?.resources, after.players[player]?.resources))
    return true;
  const payload = action.payload as { fleetId?: unknown; planetId?: unknown } | null;
  const fleet = payload?.fleetId;
  if (
    typeof fleet === 'string' &&
    Object.hasOwn(before.fleets, fleet) &&
    before.fleets[fleet]?.owner === player
  )
    return !isDeepStrictEqual(before.fleets[fleet], after.fleets[fleet]);
  const planet = payload?.planetId;
  if (
    typeof planet === 'string' &&
    Object.hasOwn(before.planets, planet) &&
    before.planets[planet]?.owner === player
  )
    return !isDeepStrictEqual(before.planets[planet], after.planets[planet]);
  return false;
}
