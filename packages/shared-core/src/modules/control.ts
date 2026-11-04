import type { GameData, ResourceBag } from '../data/schemas';
import type { GameModule, HandlerContext } from '../kernel/module';
import type { GameState, Planet, PlanetId } from '../state/gameState';
import { isCorridorEdge } from '../state/corridor';
import { allowedBuildings, hasOrbit } from '../state/sectorKind';
import { recordValues } from '../util/records';

/**
 * BAL-19 · Control limit («лимит управления», owner decision 2026-11-04). It replaces the
 * BAL-10 growth tax (`sprawl`), whose fixed 35-province threshold was tuned on a two-seat
 * map: on FFA-20 and FFA-50 a seat's fair share is 16 provinces, so a leader grew to 2.2
 * shares at full income, and every world it took brought its buildings and one more
 * build lane to the army that took the next one.
 *
 * The rule counts PLANETS only (an inhabited world: an orbit and the general build roster);
 * asteroids, dead worlds, nebulae, bases and fortresses are neither counted nor touched. A
 * player controls the `limit` planets nearest to their capital, by jumps along the map's
 * lanes (a hero's temporary corridor is not a lane), ties broken by straight-line distance
 * and then by id. Each other planet of theirs:
 *   - yields UNCONTROLLED_OUTPUT of its production (`economy.production`), the civic tax
 *     included, so the module sits AFTER `tax`, where `sprawl` was;
 *   - builds no units (`construction.requirement` → `E_NOT_CONTROLLED`); buildings are
 *     still allowed. A unit already building there when control moves away is parked
 *     (`control.changed`) and resumes only under control again.
 * The limit is CONTROL_LIMIT run through the `control.limit` hook (args `{ playerId }`), the
 * seam technologies raise it through. Designating another capital moves control with it.
 *
 * Inert in a PvE match (Sector Zero and the online waves keep their own economy) and for a
 * seat with no capital on record (scenarios, NPC sides): no anchor means no limit.
 */

/** Planets a player controls before the rest fall beyond the limit. */
export const CONTROL_LIMIT = 5;
/** Share of its production a planet beyond the limit still yields. */
export const UNCONTROLLED_OUTPUT = 0.5;

interface ConstructionRequirement {
  allowed: boolean;
  code?: string;
}
interface ConstructionRequirementArgs {
  playerId: string;
  kind: 'unit' | 'building';
  id: string;
  /** The world the order is placed on; absent for gates that are not about one world. */
  planetId?: string;
}

/** An inhabited world — the same test as `tax` and `capital` use (modules do not import
 *  each other, invariant #3; the two accessors are state utilities, not a module). */
function isPlanet(data: GameData, planet: Pick<Planet, 'kind'>): boolean {
  return hasOrbit(data, planet) && allowedBuildings(data, planet) === undefined;
}

/** Whether the limit binds this match at all: not in PvE. `modeId` is the match mode —
 *  `ctx.config.modeId` in the kernel, the pinned `state.modeId` in a host. */
export function controlApplies(
  state: GameState,
  data: GameData,
  modeId: string | undefined,
): boolean {
  if (state.pve !== undefined) return false;
  return modeId === undefined || data.modes[modeId]?.pve === undefined;
}

/**
 * The first `limit` planets of `owner` in control order (see the module doc). With `until`
 * the walk stops as soon as it is known whether that planet is among them, so a build order
 * reads the worlds around the capital rather than the whole map (an order's draft copies
 * every world it reads). `null`: the owner has no capital on record, and the limit does not
 * bind them.
 */
export function controlledPlanets(
  state: GameState,
  data: GameData,
  owner: string,
  limit: number,
  until?: PlanetId,
): Set<PlanetId> | null {
  const capital = state.capital?.[owner];
  const origin = capital === undefined ? undefined : state.planets[capital];
  if (capital === undefined || !origin) return null;
  const out = new Set<PlanetId>();
  if (!(limit > 0)) return out;
  const { x, y } = origin.position;
  const d2 = (p: Planet): number => (p.position.x - x) ** 2 + (p.position.y - y) ** 2;
  const nearer = (a: Planet, b: Planet): number =>
    d2(a) - d2(b) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  /** Places one ring of planets; true once the walk has its answer. */
  const place = (ring: Planet[]): boolean => {
    ring.sort(nearer);
    for (const p of ring) {
      out.add(p.id);
      if (p.id === until || out.size >= limit) return true;
    }
    return false;
  };
  const corridors = (state.tempLanes?.length ?? 0) > 0;
  const seen = new Set<PlanetId>([capital]);
  let frontier: PlanetId[] = [capital];
  while (frontier.length > 0) {
    const ring: Planet[] = [];
    const next: PlanetId[] = [];
    for (const id of frontier) {
      const p = state.planets[id];
      if (!p) continue;
      if (p.owner === owner && isPlanet(data, p)) ring.push(p);
      for (const nb of p.links ?? []) {
        if (seen.has(nb) || (corridors && isCorridorEdge(state, id, nb))) continue;
        seen.add(nb);
        next.push(nb);
      }
    }
    if (place(ring)) return out;
    frontier = next;
  }
  // Planets the lanes do not join to the capital follow by straight-line distance.
  const rest: Planet[] = [];
  for (const id of Object.keys(state.planets)) {
    if (seen.has(id)) continue;
    const p = state.planets[id]!;
    if (p.owner === owner && isPlanet(data, p)) rest.push(p);
  }
  place(rest);
  return out;
}

/**
 * `owner`'s planets beyond the limit: each yields UNCONTROLLED_OUTPUT and builds no units.
 * Empty when the limit does not bind them. For hosts reading a settled state (the HUD, the
 * bots); the kernel asks the same {@link controlledPlanets}.
 */
export function uncontrolledPlanets(
  state: GameState,
  data: GameData,
  owner: string,
  modeId: string | undefined,
  limit: number = CONTROL_LIMIT,
): Set<PlanetId> {
  const out = new Set<PlanetId>();
  if (!controlApplies(state, data, modeId)) return out;
  const mine = recordValues(state.planets).filter((p) => p.owner === owner && isPlanet(data, p));
  // Within the limit everything is controlled; the walk is only for a seat past it, and
  // then it stops at the limit-th planet instead of crossing the whole map.
  const controlled = mine.length > limit ? controlledPlanets(state, data, owner, limit) : null;
  if (controlled === null) return out;
  for (const p of mine) if (!controlled.has(p.id)) out.add(p.id);
  return out;
}

function limitOf(h: HandlerContext, playerId: string): number {
  return h.hook<number>('control.limit', CONTROL_LIMIT, { playerId });
}

/**
 * Controlled planets of every owner for ONE kernel step. The production hook is asked once
 * per world in the economy's settlement loop, and owners do not change inside it, so the
 * planets are counted in one pass and each owner past the limit is walked once per step:
 * the key is the step's context `h` (as in `tax`). `null` — every planet of that owner is
 * controlled.
 */
interface StepControl {
  counts: Map<string, number>;
  sets: Map<string, ReadonlySet<PlanetId> | null>;
}
const ofStep = new WeakMap<object, StepControl>();
function controlledOf(h: HandlerContext, owner: string): ReadonlySet<PlanetId> | null {
  let step = ofStep.get(h);
  if (!step) {
    const counts = new Map<string, number>();
    if (controlApplies(h.state, h.ctx.data, h.ctx.config?.modeId))
      for (const p of recordValues(h.state.planets))
        if (p.owner !== null && isPlanet(h.ctx.data, p))
          counts.set(p.owner, (counts.get(p.owner) ?? 0) + 1);
    step = { counts, sets: new Map() };
    ofStep.set(h, step);
  }
  let set = step.sets.get(owner);
  if (set === undefined) {
    const limit = limitOf(h, owner);
    set =
      (step.counts.get(owner) ?? 0) > limit
        ? controlledPlanets(h.state, h.ctx.data, owner, limit)
        : null;
    step.sets.set(owner, set);
  }
  return set;
}

export const controlModule: GameModule = {
  id: 'control',
  // 1.1.0: a new capital or a captured planet announces `control.changed` to running builds.
  version: '1.1.0',
  setup(api) {
    // Control follows the capital and the owner's planets. When either moves, the owner's
    // running builds re-ask `construction.requirement`, so a unit started under control
    // does not finish on a world that has left it. Losing a planet only brings others in.
    for (const type of ['capital.designated', 'planet.captured']) {
      api.on(type, (event, h) => {
        const { owner, planetId } = (event.payload ?? {}) as { owner?: unknown; planetId?: unknown };
        const planet = typeof planetId === 'string' ? h.state.planets[planetId] : undefined;
        if (typeof owner !== 'string' || !planet || !isPlanet(h.ctx.data, planet)) return;
        if (controlApplies(h.state, h.ctx.data, h.ctx.config?.modeId))
          h.emit('control.changed', { owner });
      });
    }

    api.hook<ResourceBag>('economy.production', (bag, args, h) => {
      const planetId = (args as { planetId?: string }).planetId;
      const planet = planetId ? h.state.planets[planetId] : undefined;
      if (!planet || planet.owner === null || !isPlanet(h.ctx.data, planet)) return bag;
      const controlled = controlledOf(h, planet.owner);
      if (controlled === null || controlled.has(planet.id)) return bag;
      const out: Record<string, number> = {};
      for (const res of Object.keys(bag)) out[res] = (bag[res] ?? 0) * UNCONTROLLED_OUTPUT;
      return out;
    });

    api.hook<ConstructionRequirement>('construction.requirement', (current, args, h) => {
      if (!current.allowed) return current;
      const { playerId, kind, planetId } = args as ConstructionRequirementArgs;
      if (kind !== 'unit' || planetId === undefined) return current;
      const planet = h.state.planets[planetId];
      if (!planet || planet.owner !== playerId || !isPlanet(h.ctx.data, planet)) return current;
      if (!controlApplies(h.state, h.ctx.data, h.ctx.config?.modeId)) return current;
      const controlled = controlledPlanets(
        h.state,
        h.ctx.data,
        playerId,
        limitOf(h, playerId),
        planetId,
      );
      return controlled === null || controlled.has(planetId)
        ? current
        : { allowed: false, code: 'E_NOT_CONTROLLED' };
    });
  },
};
