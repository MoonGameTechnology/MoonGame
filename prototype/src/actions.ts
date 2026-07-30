/**
 * Player-order action builders — thin `Action` envelope constructors the UI
 * calls to issue orders (`main.ts`), plus `canTraverse` (fog/diplomacy gate for
 * pathing). Extracted from `game.ts` (REFP-22/27): pure, no other `game.ts`
 * deps beyond shared-core types + `getStance`. `game.ts` imports both for
 * internal AI use and re-exports for `main.ts` / `netserver.ts` / tests.
 */
import {
  getStance,
  type Action,
  type DiplomaticStance,
  type GameState,
  type StewardPosture,
} from '../../packages/shared-core/src/index';

let seqCounter = 0;
/** Exported for `game.ts`'s remaining, not-yet-extracted action builders (market/
 *  division/hero/chain orders) — keeps ONE shared `seqCounter` namespace across
 *  both files rather than forking the id sequence. Not part of the public
 *  `./game` façade re-export; internal use only. */
export const act = (playerId: string, type: string, payload: unknown): Action => ({
  id: `ui:${playerId}:${seqCounter++}`,
  type,
  playerId,
  payload,
  issuedAt: 0,
});

export const moveFleet = (playerId: string, fleetId: string, to: string) =>
  act(playerId, 'fleet.move', { fleetId, to });
/** March to a continuous point ON a lane (Bytro-style): the army routes to the
 *  road and parks at fraction `t` along (`from`,`to`) instead of at a node. */
export const moveFleetEdge = (
  playerId: string,
  fleetId: string,
  edge: { from: string; to: string; t: number },
) => act(playerId, 'fleet.move', { fleetId, toEdge: edge });
export const stopFleet = (playerId: string, fleetId: string) =>
  act(playerId, 'fleet.stop', { fleetId });
// A single orbit (GDD §7.4): the only value is 'near' — "enter orbit".
export const orbitFleet = (playerId: string, fleetId: string, orbit: 'near' = 'near') =>
  act(playerId, 'fleet.orbit', { fleetId, orbit });
export const assaultFleet = (playerId: string, fleetId: string) =>
  act(playerId, 'fleet.assault', { fleetId });
export const retreatFleet = (playerId: string, fleetId: string) =>
  act(playerId, 'fleet.retreat', { fleetId });
export const bombardFleet = (playerId: string, fleetId: string, on: boolean) =>
  act(playerId, 'fleet.bombard', { fleetId, on });
/** Focus an artillery fleet's standoff fire on one enemy fleet (targetId), or
 *  clear (targetId null) to auto-target the nearest hostile in range. */
export const barrageFleet = (playerId: string, fleetId: string, targetId: string | null) =>
  act(playerId, 'fleet.barrage', { fleetId, targetId });
/** Set an artillery fleet's rules of engagement (passive/return/standard/aggressive). */
export const barrageModeFleet = (playerId: string, fleetId: string, mode: string) =>
  act(playerId, 'fleet.barrageMode', { fleetId, mode });
export const loadArmy = (playerId: string, fleetId: string, unit: string, count = 1) =>
  act(playerId, 'army.load', { fleetId, unit, count });
export const unloadArmy = (playerId: string, fleetId: string, unit: string, count = 1) =>
  act(playerId, 'army.unload', { fleetId, unit, count });
export const launchFleet = (playerId: string, planetId: string) =>
  act(playerId, 'fleet.launch', { planetId });
export const mergeFleet = (playerId: string, from: string, into: string) =>
  act(playerId, 'fleet.merge', { from, into });
export const splitFleet = (
  playerId: string,
  fleetId: string,
  take: Array<{ unit: string; count: number }>,
) => act(playerId, 'fleet.split', { fleetId, take });
export const buildBuilding = (playerId: string, planetId: string, building: string) =>
  act(playerId, 'building.construct', { planetId, building });
export const upgradeBuilding = (playerId: string, planetId: string, building: string) =>
  act(playerId, 'building.upgrade', { planetId, building });
export const buildUnit = (playerId: string, planetId: string, unit: string, count = 1) =>
  act(playerId, 'unit.build', { planetId, unit, count });
/** Build a hull with a chosen module loadout (the «Оснащение корабля» constructor).
 *  The modules ride in the `unit.build` payload; the core stamps them onto the built
 *  stack (validated + priced by `loadout.ts`), locked for good — no refit. */
export const buildShip = (
  playerId: string,
  planetId: string,
  unit: string,
  count: number,
  modules: string[],
) => act(playerId, 'unit.build', { planetId, unit, count, modules });
/** Cancel an ACTIVE (already paid) building/upgrade/unit order: refunds the unbuilt
 *  share of its cost and parks it as a resumable paused site — `seq` is the order's
 *  `construction.complete` scheduled-event seq (already read off `s.scheduled`, e.g.
 *  by `activeConstruction()`). */
export const cancelConstruction = (playerId: string, planetId: string, seq: number) =>
  act(playerId, 'construction.cancel', { planetId, seq });
/** Resume a paused site: pays exactly what was refunded, continues from the same
 *  progress. `id` is the `PausedConstructionSite.id` (= the original order's `seq`). */
export const resumeConstruction = (playerId: string, planetId: string, id: number) =>
  act(playerId, 'construction.resume', { planetId, id });
export const engageFleet = (playerId: string, fleetId: string, targetId: string) =>
  act(playerId, 'fleet.engage', { fleetId, targetId });
/** Begin researching a session technology (one active at a time — technologyModule). */
export const researchTech = (playerId: string, technology: string) =>
  act(playerId, 'technology.research', { technology });
/** «Хранитель»: hand this seat to the AI until game-time `until`, running `posture` —
 *  'defend' («Оборона», the safe default) or 'active_defend' («Активная оборона»,
 *  ST-3.3: + forecast-gated counterstrike and squadron fire-watch on own soil).
 *  Rejected (E_STEWARD_LOCKED) until the Steward tech is researched. */
export const delegateSteward = (
  playerId: string,
  until: number,
  posture: StewardPosture = 'defend',
) => act(playerId, 'steward.delegate', { posture, until });
/** Take the seat back early (a safe no-op if nothing was delegated). */
export const recallSteward = (playerId: string) => act(playerId, 'steward.recall', {});
/** Mark (or unmark) an OWN world as a hold point (ST-2.1) — a standing order the
 *  Steward honors under any posture: never auto-evacuated, reinforced under threat. */
export const setHoldPoint = (playerId: string, planetId: string, on: boolean) =>
  act(playerId, 'steward.holdpoint', { planetId, on });
/** Declare war on (or otherwise re-stance) another commander. */
export const declareWar = (playerId: string, target: string, stance: DiplomaticStance = 'war') =>
  act(playerId, 'diplomacy.declare', { target, stance });
/** Steal a time-boxed intel window on another commander (SPY-1 core module):
 *  `treasury` / `fleets` spy on the player; `planet` needs the world's id too. */
export const spyOn = (
  playerId: string,
  target: string,
  kind: 'treasury' | 'planet' | 'fleets',
  planetId?: string,
) => act(playerId, 'espionage.spy', { target, kind, ...(planetId ? { planetId } : {}) });
/** Cast a hero ability (HERO-4 dispatcher); `target` — planet id for ranged casts.
 *  Pulled ahead of the rest of the "hero engine" builder cluster (REFP-22's deferred
 *  remainder) because REFP-24's `serverChainActions` (CC-1 chain driver) needs it for
 *  its `ability`-step branch — a leaf builder, no state entanglement of its own. */
export const castHeroAbility = (
  playerId: string,
  heroId: string,
  abilityId: string,
  target?: string,
) =>
  act(playerId, 'hero.ability', { heroId, abilityId, ...(target !== undefined ? { target } : {}) });

/** Can `mover`'s fleets enter/traverse a province owned by `owner`? Neutral, your own,
 *  and players you're at war / pact / alliance with are passable; a player you're at
 *  PEACE with is blocked (you'd have to declare war first). */
export function canTraverse(state: GameState, mover: string, owner: string | null): boolean {
  if (owner == null || owner === mover) return true;
  return getStance(state, mover, owner) !== 'peace';
}
