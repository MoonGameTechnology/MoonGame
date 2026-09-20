import type { GameState, SwarmContact } from './gameState';
import { fleetNodeAt } from './fleetPosition';

/** Only resolved visual contacts teach composition. Radar blips, hidden fleets,
 * cargo and future orders never enter the observer's dossier. */
export function observedSwarm(
  state: GameState, viewer: string, identified: ReadonlySet<string>, now = state.time,
): Record<string, SwarmContact> {
  const contacts: Record<string, SwarmContact> = {};
  for (const id of Object.keys(state.fleets).sort()) {
    const fleet = state.fleets[id]!;
    if (fleet.owner === viewer || state.players[fleet.owner]?.faction !== 'swarm') continue;
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
