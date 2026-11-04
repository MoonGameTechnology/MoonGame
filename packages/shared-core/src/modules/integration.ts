import type { GameData, ResourceBag } from '../data/schemas';
import type { GameModule } from '../kernel/module';
import type { GameState, Planet } from '../state/gameState';
import { hoursToMs } from '../action/types';
import { allowedBuildings, hasOrbit } from '../state/sectorKind';

/**
 * BAL-19 step 2 · Integration of a captured planet («освоение», owner decision 2026-11-04,
 * the «лимит и освоение» package). A planet taken from another side does not work for its
 * taker at once: for INTEGRATION_HOURS of game time its output ramps linearly from
 * INTEGRATION_START_OUTPUT to full (`economy.production`), and it builds no units
 * (`construction.requirement` → `E_INTEGRATING`); buildings are allowed.
 *
 * The side it was taken from keeps a claim meanwhile (`Planet.integration.claim`): retaking
 * the planet before integration ends gives it back at full output at once. A third side
 * taking it restarts integration and keeps the same claim. When integration ends the planet
 * is its holder's in full, and the claim is gone.
 *
 * A planet taken from nobody (settlement) is its taker's at once: peaceful growth is not
 * slowed. Planets only, the ones `control` counts (an orbit and the general build roster).
 * With the control limit the two shares multiply: an integrating planet beyond the limit
 * ramps up to its 50%.
 *
 * The ramp is exact over any span: the economy names the span it settles (`from`, `to`),
 * and a linear ramp's mean over a span is the mean of its two ends. The end of integration
 * is a scheduled event, so no span runs across it.
 *
 * Inert in a PvE match (Sector Zero and the online waves keep their own economy).
 */

/** Game hours a planet taken from another side takes to integrate. */
export const INTEGRATION_HOURS = 72;
/** Share of its output a planet yields the moment it is taken. */
export const INTEGRATION_START_OUTPUT = 0.25;

type PlanetIntegration = NonNullable<Planet['integration']>;

interface ConstructionRequirement {
  allowed: boolean;
  code?: string;
}

/** An inhabited world: the same test as `control` and `tax` use (modules do not import each
 *  other, invariant #3; the two accessors are state utilities, not a module). */
function isPlanet(data: GameData, planet: Pick<Planet, 'kind'>): boolean {
  return hasOrbit(data, planet) && allowedBuildings(data, planet) === undefined;
}

/** Not in PvE: the same test as `control` (`controlApplies`). */
function integrationApplies(state: GameState, data: GameData, modeId: string | undefined): boolean {
  if (state.pve !== undefined) return false;
  return modeId === undefined || data.modes[modeId]?.pve === undefined;
}

/** Whether `planet` is still integrating at world time `t`. The field outlives its end only
 *  until the end event fires at that very instant. */
export function isIntegrating(planet: Pick<Planet, 'integration'>, t: number): boolean {
  return planet.integration !== undefined && planet.integration.until > t;
}

/** Share of its output an integrating planet yields at world time `t`: the start share at
 *  capture, rising linearly to full at `until`. */
export function integrationShare(integration: PlanetIntegration, t: number): number {
  const { since, until } = integration;
  if (!(until > since) || t >= until) return 1;
  const done = Math.max(0, (t - since) / (until - since));
  return INTEGRATION_START_OUTPUT + (1 - INTEGRATION_START_OUTPUT) * done;
}

export const integrationModule: GameModule = {
  id: 'integration',
  version: '1.0.0',
  setup(api) {
    api.on('planet.captured', (event, h) => {
      const { planetId, owner, from } = (event.payload ?? {}) as {
        planetId?: unknown;
        owner?: unknown;
        from?: unknown;
      };
      const planet = typeof planetId === 'string' ? h.state.planets[planetId] : undefined;
      if (!planet || typeof owner !== 'string') return;
      const held = isIntegrating(planet, h.ctx.now) ? planet.integration : undefined;
      delete planet.integration;
      // Settled from nobody, or retaken by the side it was taken from: the holder has it in
      // full at once.
      if (typeof from !== 'string' || from === owner || held?.claim === owner) return;
      if (!isPlanet(h.ctx.data, planet)) return;
      if (!integrationApplies(h.state, h.ctx.data, h.ctx.config?.modeId)) return;
      const until = h.ctx.now + hoursToMs(h.ctx, INTEGRATION_HOURS);
      planet.integration = { claim: held?.claim ?? from, since: h.ctx.now, until };
      // The end timer names its world under `world`, which routes it to nobody: no client
      // needs it (the field's removal reaches the holder with the state), and a `planetId`
      // would deliver it to every side that sees the world, dating a capture a third side
      // was never told about (`MatchRoom.eventVisibleTo`).
      h.schedule(until, 'integration.complete', { world: planet.id });
    });

    api.on('integration.complete', (event, h) => {
      const { world } = (event.payload ?? {}) as { world?: unknown };
      const planet = typeof world === 'string' ? h.state.planets[world] : undefined;
      // A capture since then restarted integration: that one ends at its own event.
      if (planet?.integration !== undefined && planet.integration.until <= h.ctx.now)
        delete planet.integration;
    });

    // An annihilated world is nobody's dead world: nothing is left to integrate or retake.
    api.on('planet.destroyed', (event, h) => {
      const { planetId } = (event.payload ?? {}) as { planetId?: unknown };
      const planet = typeof planetId === 'string' ? h.state.planets[planetId] : undefined;
      if (planet) delete planet.integration;
    });

    api.hook<ResourceBag>('economy.production', (bag, args, h) => {
      const { planetId, from, to } = (args ?? {}) as {
        planetId?: string;
        from?: number;
        to?: number;
      };
      const integration = planetId ? h.state.planets[planetId]?.integration : undefined;
      if (!integration) return bag;
      const end = typeof to === 'number' ? to : h.ctx.now;
      const start = typeof from === 'number' ? from : end;
      const share = (integrationShare(integration, start) + integrationShare(integration, end)) / 2;
      if (share >= 1) return bag;
      const out: Record<string, number> = {};
      for (const res of Object.keys(bag)) out[res] = (bag[res] ?? 0) * share;
      return out;
    });

    api.hook<ConstructionRequirement>('construction.requirement', (current, args, h) => {
      if (!current.allowed) return current;
      const { kind, planetId } = (args ?? {}) as { kind?: string; planetId?: string };
      if (kind !== 'unit' || planetId === undefined) return current;
      const planet = h.state.planets[planetId];
      return planet && isIntegrating(planet, h.ctx.now)
        ? { allowed: false, code: 'E_INTEGRATING' }
        : current;
    });
  },
};
