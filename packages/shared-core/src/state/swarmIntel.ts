import type { GameState, SwarmContact } from './gameState';
import { fleetNodeAt } from './fleetPosition';

/** Only resolved visual contacts teach composition. Radar blips, hidden fleets,
 * cargo and future orders never enter the observer's dossier. */
export function observedSwarm(
  state: GameState, viewer: string, identified: ReadonlySet<string>, now = state.time,
  swarm: readonly string[] = swarmFleetIds(state),
): Record<string, SwarmContact> {
  const contacts: Record<string, SwarmContact> = {};
  for (const id of swarm) {
    const fleet = state.fleets[id]!;
    if (fleet.owner === viewer) continue;
    const location = fleetNodeAt(state, fleet, state.time);
    if (location === null || !identified.has(location)) continue;
    const counts: Record<string, number> = {};
    for (const stack of fleet.units) {
      if (stack.count > 0) counts[stack.unit] = (counts[stack.unit] ?? 0) + stack.count;
    }
    if (!Object.keys(counts).length) continue;
    contacts[id] = { owner: fleet.owner, location, at: now,
      units: Object.keys(counts).sort().map(unit => ({ unit, count: counts[unit]! })) };
  }
  return contacts;
}

/** The Swarm's fleet ids, sorted. Fog memory asks {@link observedSwarm} for every player
 *  on every time span, so it builds this once per refresh instead of once per player:
 *  filtering before sorting yields the same order as sorting first. */
export function swarmFleetIds(state: GameState): string[] {
  return Object.keys(state.fleets)
    .filter((id) => state.players[state.fleets[id]!.owner]?.faction === 'swarm')
    .sort();
}
