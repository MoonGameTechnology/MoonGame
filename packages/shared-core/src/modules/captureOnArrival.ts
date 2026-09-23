import type { GameModule, HandlerContext } from '../kernel/module';
import { getStance } from '../state/diplomacy';
import { isCapturable } from '../state/sectorKind';
import { fleetNodeAt } from '../state/fleetPosition';

/**
 * Capture-on-arrival (map-roadmap.md M2.2). A fleet that reaches an undefended,
 * uncontested **capturable** sector it doesn't own takes it on the spot — the
 * "walk-in" capture. This was a client-only convenience in the prototype
 * (`seizeSector`), so it never happened in multiplayer; as a kernel rule it now
 * runs server-side and applies identically in single-player and online.
 *
 * Skipped (these need a real assault — the combat module — or can't be owned):
 *   - defended: the sector has a live garrison (≥1 unit → assault only);
 *   - contested: an enemy fleet with units is also present;
 *   - not capturable: empty space (sector kind `capturable: false`);
 *   - owned by a non-hostile player: an ally's / at-peace world can't be seized
 *     for free — that needs a declared war first (same `war`-only gate combat's
 *     `isHostile` uses). Only a NEUTRAL (unowned) or an at-WAR world walks in.
 *
 * BAL-4 (owner decision, 2026-08-29) required a live landing force in the hold —
 * the "empty hold doesn't take a province" rule. REVERSED by the owner
 * (2026-09-06): the rule was counter-intuitive for players ("my fleet sits on an
 * empty planet and it's still not mine — why?"). The new rule is simple and
 * Iron-Order-like: an EMPTY province (no garrison) is taken by ANY arriving
 * fleet, no landing force needed; a province with ≥1 garrison unit is assault-
 * only. The garrison check above is the gate — it already rejects defended
 * worlds, so removing the landing-force check makes empty worlds walk-in.
 *
 * Ordered AFTER combat in the module list, so a contested arrival starts its
 * battle first and the guards below then decline to capture.
 *
 * ROADS (owner decision, `roads-roadmap.md` §0.2): a fleet going round a world by a side
 * road — through the fork of its trail — does NOT take the province (no `fleet.transit`
 * fires there). What takes it is going through the world, arriving at it, or STOPPING in
 * the province: a fleet that parks on its roads (at the fork, say) holds the ground as
 * surely as one at the world. That stop is contested by any other fleet standing in the
 * province — at the world or parked on its roads.
 */

/** `via`: how the fleet came to hold the province — `arrival` (at the world, or passing
 *  through it) or `stop` (parked on the province's roads). */
function tryCapture(
  h: HandlerContext,
  payload: unknown,
  via: 'arrival' | 'stop' = 'arrival',
): void {
  const { fleetId, at } = (payload ?? {}) as { fleetId?: string; at?: string };
  if (typeof fleetId !== 'string' || typeof at !== 'string') return;
  const fleet = h.state.fleets[fleetId];
  const planet = h.state.planets[at];
  if (!fleet || !planet || planet.owner === fleet.owner) return;
  if (!isCapturable(h.ctx.data, planet)) return;
  if (planet.owner !== null && getStance(h.state, fleet.owner, planet.owner) !== 'war') return;
  if (planet.garrison.some((s) => s.count > 0)) return; // ≥1 garrison unit → assault only
  const contested = Object.values(h.state.fleets).some(
    (g) =>
      g.owner !== fleet.owner &&
      g.units.some((u) => u.count > 0) &&
      (g.location === at ||
        (via === 'stop' && g.edge != null && fleetNodeAt(h.state, g, h.ctx.now) === at)),
  );
  if (contested) return;
  planet.owner = fleet.owner;
  h.emit('planet.captured', { planetId: at, owner: fleet.owner, via });
}

export const captureOnArrivalModule: GameModule = {
  id: 'capture-on-arrival',
  version: '0.2.0',
  setup(api) {
    api.on('fleet.arrived', (event, h) => tryCapture(h, event.payload));
    api.on('fleet.transit', (event, h) => tryCapture(h, event.payload));
    api.on('fleet.parked', (event, h) => {
      const { fleetId } = (event.payload ?? {}) as { fleetId?: string };
      const fleet = typeof fleetId === 'string' ? h.state.fleets[fleetId] : undefined;
      if (!fleet || fleet.battleId || !fleet.edge) return;
      const at = fleetNodeAt(h.state, fleet, h.ctx.now);
      if (at !== null) tryCapture(h, { fleetId, at }, 'stop');
    });
  },
};
