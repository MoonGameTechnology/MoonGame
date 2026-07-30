/**
 * Void Dominion — playable prototype, game setup.
 *
 * This file is pure game wiring (no DOM): it builds the data-driven content,
 * the map and the kernel out of the REAL `@void/shared-core` simulation, so the
 * browser UI and a Node smoke-test drive exactly the same deterministic core.
 */
import {
  stewardActive,
  STEWARD_POSTURES,
  STEWARD_LOSS_LIMIT,
  MAX_STEWARD_HOLD_POINTS,
  scanNodeThreats,
  previewBattle,
  hullPool,
  journeyDestination,
  planRoute,
  routeDistance,
  estimateTravelHours,
  getStance,
  identifiedNodes,
  type DiplomaticStance,
  type GameData,
  type GameModule,
  type GameState,
  type ResourceBag,
  type Hero,
  type Fleet,
  type UnitStack,
  type Player,
  type StewardLogEntry,
  type Action,
  type Battle,
} from '../../packages/shared-core/src/index';
import { GROUND_ROSTER } from './groundcombat';
import { DEFAULT_HEROES, type HeroLoadout } from './heroes';

export const HOUR = 3_600_000;
export const DAY = 24 * HOUR;

// --- data-driven content -----------------------------------------------------
// REFP-1: the inline `parseGameData({...})` catalogue moved to `prototypeData.ts`
// (it had no internal deps on the rest of game.ts). Imported here for internal use
// AND re-exported so the public API of `game.ts` stays unchanged for `main.ts` /
// `netserver.ts` / the tests.
import { data } from './prototypeData';
export { data };

// --- sectors -----------------------------------------------------------------
// REFP-2: the sector-type registry and the generated match map moved to `map.ts`
// (depended only on `data` + the core `sectorKind` helpers). Imported here for
// internal use AND re-exported so the public API of `game.ts` stays unchanged for
// `main.ts` / `netserver.ts` / the tests.
import { SECTOR_TYPES, MAP, START_CANDIDATES, type SectorType, type MapNode } from './map';
export { SECTOR_TYPES, MAP, START_CANDIDATES, type SectorType, type MapNode };
// Shared stance vocabulary — main.ts routes propose-vs-declare by the same ranks
// the core module enforces (one table, no drift).
export { STANCE_RANK } from '../../packages/shared-core/src/index';

// REFP-3: the stack-list helpers (loadout signature, pro-rata split, loadout-aware
// merge) moved to `fleetStacks.ts` — pure functions over `UnitStack[]`, no other
// game.ts deps. Imported here for the fleet launch/merge/split modules.
import { loadoutKey, takeFromStacks, mergeStacks } from './fleetStacks';
// --- taxes: inhabited worlds collect credits --------------------------------
// REFP-4: civic tax (constants + isInhabited/civicTax/inhabitedWorldCount + taxModule)
// moved to `tax.ts` — depended only on `data` + core sectorKind helpers, hooks
// `economy.production`. Re-exported for main.ts / tests (`taxModule` is assembled in
// `protoKernel.ts`).
import {
  TAX_PER_HOUR,
  TAX_OFFICE_BONUS,
  TAX_DIMINISH,
  isInhabited,
  civicTax,
  inhabitedWorldCount,
} from './tax';
export { TAX_PER_HOUR, TAX_OFFICE_BONUS, TAX_DIMINISH, isInhabited, civicTax, inhabitedWorldCount };

// REFP-9: hunger module (HUNGER_MULT + hungerModule) moved to `hunger.ts` — a single
// combat.damage hook, no other game.ts deps. Imported here for MODULES and re-exported.
import { HUNGER_MULT, hungerModule } from './hunger';
export { HUNGER_MULT, hungerModule };

// REFP-10: fleet.launch/merge/split/engage (fleetLaunchModule + the monotonic
// fleet-id counter) moved to `fleetLaunch.ts` — depends on `divisionsOf`
// (`division.ts` since REFP-13). `game.ts` imports `fleetLaunchModule` for `MODULES`.
import { fleetLaunchModule } from './fleetLaunch';
export { fleetLaunchModule };

// --- assembling the match ----------------------------------------------------
// REFP-20: SeatConfig/SetupConfig/DEFAULT_SETUP/NetworkMatchMode/
// parseNetworkMatchMode/networkSeats/newGame (+ its private player/fleet/
// ARCHETYPE_OF_GRADE helpers) moved to `matchSetup.ts` — depended only on
// already-extracted files (map/formations/botFavour/heroes/ships/economy) +
// prototypeData + shared-core. Imported here for internal use and re-exported
// for main.ts / netserver.ts / tests.
import {
  type SeatConfig,
  type SetupConfig,
  DEFAULT_SETUP,
  type NetworkMatchMode,
  parseNetworkMatchMode,
  networkSeats,
  newGame,
} from './matchSetup';
export {
  type SeatConfig,
  type SetupConfig,
  DEFAULT_SETUP,
  type NetworkMatchMode,
  parseNetworkMatchMode,
  networkSeats,
  newGame,
};

// REFP-5: ground division templates (FORMATION_*, FormationTemplate/OfficerTemplate,
// DEFAULT_TEMPLATES/OFFICER_TEMPLATES, formationStats) moved to `formations.ts` —
// depended only on `data` + GROUND_ROSTER. Imported here for internal use (newGame,
// templatesOf) AND re-exported for main.ts / tests.
import {
  FORMATION_UNITS,
  FORMATION_SLOTS,
  FORMATION_TEMPLATE_COUNT,
  DEFAULT_TEMPLATES,
  OFFICER_TEMPLATES,
  formationStats,
  type FormationUnit,
  type FormationTemplate,
  type OfficerTemplate,
  type FormationSynergy,
  type FormationStats,
} from './formations';
export {
  FORMATION_UNITS,
  FORMATION_SLOTS,
  FORMATION_TEMPLATE_COUNT,
  DEFAULT_TEMPLATES,
  OFFICER_TEMPLATES,
  formationStats,
  type FormationUnit,
  type FormationTemplate,
  type OfficerTemplate,
  type FormationSynergy,
  type FormationStats,
};

// REFP-6: bot favour (approval) scale — FAVOUR_* constants + botFavour/botEmbargoes
// moved to `botFavour.ts` (pure reads of the prototype's `approval` state extension).
// Imported here for newGame/botDiplomacy/market and re-exported for main.ts / tests.
import {
  FAVOUR_BASE,
  FAVOUR_EMBARGO,
  FAVOUR_WAR,
  FAVOUR_PEACE_ACCEPT,
  FAVOUR_PACT_ACCEPT,
  FAVOUR_WAR_DECLARED_HIT,
  FAVOUR_SPY_CAUGHT_HIT,
  FAVOUR_WAR_DECAY_PER_DAY,
  FAVOUR_HEAL_PER_DAY,
  botFavour,
  botEmbargoes,
} from './botFavour';
export {
  FAVOUR_BASE,
  FAVOUR_EMBARGO,
  FAVOUR_WAR,
  FAVOUR_PEACE_ACCEPT,
  FAVOUR_PACT_ACCEPT,
  FAVOUR_WAR_DECLARED_HIT,
  FAVOUR_SPY_CAUGHT_HIT,
  FAVOUR_WAR_DECAY_PER_DAY,
  FAVOUR_HEAL_PER_DAY,
  botFavour,
  botEmbargoes,
};

// REFP-19: economySnapshot/netIncome/hpOfLevel (the HUD/observation-pipeline
// economy readouts) moved to `economy.ts` — depended only on `data` + shared-core
// utils + `tax.ts` (REFP-4). Imported here for `newGame` (hpOfLevel) and AI use
// (netIncome), and re-exported for `main.ts` / `netserver.ts` / tests.
import { economySnapshot, netIncome, hpOfLevel } from './economy';
export { economySnapshot, netIncome, hpOfLevel };

// --- diplomacy ---------------------------------------------------------------
// D4: the prototype now runs the CORE `diplomacyModule` (imported above) — one
// implementation of `diplomacy.declare` for the whole repo (D2 escalation, D3
// consent offers, E_BOT_ALLIANCE, offer sweep on `player.eliminated`, plus the
// `diplomacy` capability combat consults). Stances still live in `state.diplomacy`
// (D1) and newGame seeds `peace`, so nothing changes at the table. Code deltas vs
// the retired prototype module: same-stance → `E_SAME_STANCE` (was `E_ALREADY`),
// malformed target → `E_BAD_PAYLOAD` (was `E_BAD_TARGET`), and `stance` is required
// (the `declareWar` builder still defaults it to 'war').

// REFP-11: bot diplomacy module moved to `botDiplomacy.ts` — depends on botFavour
// (REFP-6) + core diplomacy helpers. Imported here for MODULES.

// REFP-12: session market (MARKET_*, MarketLot/marketLots, marketModule) moved to
// `sessionMarket.ts` — depends on canAfford/payCost + botEmbargoes. Imported for MODULES
// and re-exported for main.ts / tests.
import {
  MARKET_GOODS,
  MARKET_FEE,
  marketLots,
  type MarketSide,
  type MarketLot,
} from './sessionMarket';
export { MARKET_GOODS, MARKET_FEE, marketLots, type MarketSide, type MarketLot };

// REFP-13: ground divisions (Division/divisionsOf/templatesOf/regenDivision/
// divisionCargo/fleetCargoFree + tick-based ground battle + divisionModule) moved to
// `division.ts` — depends on formations/groundcombat/prototypeData + shared-core
// utils, wall-clock units mirrored locally (no reverse edge). Imported here for
// MODULES and re-exported for main.ts / netserver.ts / tests (until REFP-28).
import {
  divisionsOf,
  templatesOf,
  regenDivision,
  divisionCargo,
  fleetCargoFree,
  divisionModule,
  GROUND_TICK_HOURS,
  REGEN_PER_UNIT_PER_DAY,
  type Division,
} from './division';
export {
  divisionsOf,
  templatesOf,
  regenDivision,
  divisionCargo,
  fleetCargoFree,
  divisionModule,
  GROUND_TICK_HOURS,
  REGEN_PER_UNIT_PER_DAY,
  type Division,
};


/** The prototype state extensions THIS file still reads (the hero roster + the AI's
 *  patrol peek). Each extracted module types its own narrow view of the same fields
 *  (`division.ts`, `serverDrivers.ts`, `standingOrders.ts`, …) — this local view
 *  shrinks as sections move out (REFP) and dies with the facade in REFP-28. All are
 *  non-`GameState` fields, preserved by deepClone (own-key copy). */
type DivState = GameState & {
  heroRoster?: Record<string, HeroLoadout[]>;
  patrols?: Record<string, Patrol & { rearmAt?: number }>;
};

/** A player's hero roster (the loadouts composed in the menu), or the defaults. */
export function heroRosterOf(state: GameState, playerId: string): HeroLoadout[] {
  return (state as DivState).heroRoster?.[playerId] ?? DEFAULT_HEROES;
}


// REFP-14: capital module (capitalsOf/capitalOf/capitalModule) moved to `capital.ts` —
// depends on isInhabited (REFP-4) + the prototype's capital state extension.
import { capitalsOf, capitalOf } from './capital';
export { capitalOf };

// REFP-15: standing orders module (CC-2/CC-4 + chain/patrol stamps) moved to
// `standingOrders.ts`. Imported here for MODULES.
import { standingOrdersModule } from './standingOrders';
export { standingOrdersModule };

// REFP-16: forced march module (FORCED_MARCH_* + forcedMarchModule) moved to
// `forcedMarch.ts`. Imported here for MODULES and re-exported.
import { FORCED_MARCH_MULT, FORCED_MARCH_WEAR, forcedMarchModule } from './forcedMarch';
export { FORCED_MARCH_MULT, FORCED_MARCH_WEAR, forcedMarchModule };

// REFP-17/18: instant repair + econ screws (express dock repair) moved to their
// own files. Imported here for MODULES and re-exported for main.ts / tests.
import {
  INSTANT_REPAIR_CREDITS_PER_HP,
  missingHull,
  instantRepairCost,
  instantRepairModule,
} from './instantRepair';
import {
  REPAIR_HP_PER_METAL,
  dockRepairCost,
  fleetAtOwnDock,
  econScrewsModule,
} from './econScrews';
export {
  INSTANT_REPAIR_CREDITS_PER_HP,
  missingHull,
  instantRepairCost,
  instantRepairModule,
  REPAIR_HP_PER_METAL,
  dockRepairCost,
  fleetAtOwnDock,
  econScrewsModule,
};

// REFP-21: the kernel assembly point (MODULES order = determinism contract,
// compiled kernel, SCORE_LIMIT/ctx match config, advance/order step helpers) moved
// to `protoKernel.ts`. Imported here for internal use (stewardGuardOrders' ctx) and
// re-exported for main.ts / netserver.ts / tests (until REFP-28).
import { MODULES, kernel, SCORE_LIMIT, ctx, advance, order, type StepOut } from './protoKernel';
export { MODULES, kernel, SCORE_LIMIT, ctx, advance, order, type StepOut };


// --- action builders ---------------------------------------------------------
// REFP-22/27: the player-order action builders (moveFleet..spyOn) + canTraverse
// moved to `actions.ts` — pure, no other game.ts deps beyond shared-core types +
// getStance. Imported here for internal AI use and re-exported for main.ts /
// netserver.ts / tests. (A second, scattered batch of action builders — market/
// division/hero orders further down — stays in game.ts: interleaved with state
// this file still owns, e.g. Patrol/ChainStep drivers, REFP-23.)
import {
  moveFleet,
  moveFleetEdge,
  stopFleet,
  orbitFleet,
  assaultFleet,
  retreatFleet,
  bombardFleet,
  barrageFleet,
  barrageModeFleet,
  loadArmy,
  unloadArmy,
  launchFleet,
  mergeFleet,
  splitFleet,
  buildBuilding,
  upgradeBuilding,
  buildUnit,
  buildShip,
  cancelConstruction,
  resumeConstruction,
  engageFleet,
  researchTech,
  delegateSteward,
  recallSteward,
  setHoldPoint,
  declareWar,
  spyOn,
  canTraverse,
  castHeroAbility,
  act,
} from './actions';
export {
  moveFleet,
  moveFleetEdge,
  stopFleet,
  orbitFleet,
  assaultFleet,
  retreatFleet,
  bombardFleet,
  barrageFleet,
  barrageModeFleet,
  loadArmy,
  unloadArmy,
  launchFleet,
  mergeFleet,
  splitFleet,
  buildBuilding,
  upgradeBuilding,
  buildUnit,
  buildShip,
  cancelConstruction,
  resumeConstruction,
  engageFleet,
  researchTech,
  delegateSteward,
  recallSteward,
  setHoldPoint,
  declareWar,
  spyOn,
  canTraverse,
  castHeroAbility,
};
// Re-export the Steward reads so the netserver + UI import them from the `./game` façade.
export { stewardActive, STEWARD_POSTURES, MAX_STEWARD_HOLD_POINTS };

// REFP-8: CC-1 fleet order queue (ChainStep/FleetChain/MAX_CHAIN_*/fleetIdle/
// validateChainSteps) moved to `chain.ts` — pure functions over Fleet/GameState/data.
// Imported here for the chain driver/actions and re-exported for main.ts / tests.
import {
  fleetIdle,
  validateChainSteps,
  MAX_CHAIN_STEPS,
  MAX_CHAIN_WAIT_HOURS,
  type ChainStep,
  type FleetChain,
} from './chain';
export {
  fleetIdle,
  validateChainSteps,
  MAX_CHAIN_STEPS,
  MAX_CHAIN_WAIT_HOURS,
  type ChainStep,
  type FleetChain,
};

// REFP-7: squadron mechanics (squadronTake, SortieState/sortieSpec/freshSortie/
// canSortie/spendSortie/tickRearm, fleetHasSquadron, squadronStrikeRange,
// withinRange, squadronReaches) moved to `squadron.ts` — pure functions over
// Fleet + data. Imported here for the patrol/standing-order drivers and re-exported.
import {
  squadronTake,
  sortieSpec,
  freshSortie,
  canSortie,
  spendSortie,
  tickRearm,
  fleetHasSquadron,
  squadronStrikeRange,
  withinRange,
  squadronReaches,
  type SortieState,
} from './squadron';
export {
  squadronTake,
  sortieSpec,
  freshSortie,
  canSortie,
  spendSortie,
  tickRearm,
  fleetHasSquadron,
  squadronStrikeRange,
  withinRange,
  squadronReaches,
  type SortieState,
};

// REFP-23: Patrol/patrolTarget/scrambleOrder (squadrons-roadmap SQ-4.1 — the pure
// reactive-scramble decision core) moved to `patrol.ts`. Imported here for the
// server-side driver below and re-exported for `main.ts` / tests.
import { patrolTarget, scrambleOrder, type Patrol } from './patrol';
export { patrolTarget, scrambleOrder, type Patrol };

// REFP-24: serverAutoAssaultActions/serverChainActions/serverPatrolActions (the
// CC-2/CC-1/CC-4 server-side standing-order drivers) moved to `serverDrivers.ts`.
// Imported here for internal use (none currently — the drivers are consumed by
// `main.ts`'s frame loop and NET) and re-exported for `main.ts` / tests.
import { serverAutoAssaultActions, serverChainActions, serverPatrolActions } from './serverDrivers';
export { serverAutoAssaultActions, serverChainActions, serverPatrolActions };

// orderAuto/orderScramble moved to `actions.ts` (leaf builders, REFP-25 needs them
// from a file the guard can import without a reverse edge) — re-exported below.
import { orderAuto, orderScramble } from './actions';
export { orderAuto, orderScramble };
/** The patrol driver's runtime stamp: burned fuel / ticked rearm / next cadence mark. */
export const patrolStamp = (
  playerId: string,
  fleetId: string,
  sortie: SortieState,
  rearmAt?: number,
) =>
  act(
    playerId,
    'patrol.stamp',
    rearmAt === undefined ? { fleetId, sortie } : { fleetId, sortie, rearmAt },
  );
/** CC-1: set (or [] = cancel) an owned fleet's whole order chain atomically. */
export const orderChain = (playerId: string, fleetId: string, steps: ChainStep[]) =>
  act(playerId, 'order.chain', { fleetId, steps });
/** BOOST-1: toggle форс-марш on an owned fleet (+50% speed, hull wear in transit). */
export const forceMarchFleet = (playerId: string, fleetId: string, on: boolean) =>
  act(playerId, 'fleet.forcemarch', { fleetId, on });
/** Платный мгновенный ремонт корпуса всего флота (цена — `instantRepairCost`). */
export const instantRepairFleet = (playerId: string, fleetId: string) =>
  act(playerId, 'fleet.instantRepair', { fleetId });
/** ECON-3а: экспресс-ремонт за metal у своего дока (цена — `dockRepairCost`). */
export const repairFleet = (playerId: string, fleetId: string) =>
  act(playerId, 'fleet.repair', { fleetId });
/** The chain driver's runtime stamp: consumed head / armed wait deadline. */
export const chainStamp = (
  playerId: string,
  fleetId: string,
  steps: ChainStep[],
  waitUntil?: number,
) =>
  act(
    playerId,
    'chain.stamp',
    waitUntil === undefined ? { fleetId, steps } : { fleetId, steps, waitUntil },
  );

/** Place a market lot: `sell` escrows `amount` of `resource` for `price` credits/unit;
 *  `buy` escrows the credits and offers to buy that much of `resource`. */
// marketList moved to `actions.ts` (leaf builder — `aiOrders`/ai.ts places lots
// without a reverse edge onto the facade); re-exported here.
import { marketList } from './actions';
export { marketList };
/** Take (fill) up to `amount` from an open lot — buy from a sell lot / sell into a buy lot. */
export const marketTake = (playerId: string, id: string, amount?: number) =>
  act(playerId, 'market.take', amount === undefined ? { id } : { id, amount });
/** Reclaim your own lot, refunding its remaining escrow. */
export const marketCancel = (playerId: string, id: string) =>
  act(playerId, 'market.cancel', { id });
/** Mobilise division template `template` (0-based) on your world `planetId`.
 *  `officer` = build from the named OFFICER_TEMPLATES roster instead (locked premades). */
export const mobilizeDivision = (
  playerId: string,
  planetId: string,
  template: number,
  officer = false,
) =>
  act(
    playerId,
    'division.mobilize',
    officer ? { planetId, template, officer: true } : { planetId, template },
  );
/** Rename your CUSTOM division template (designer menu). */
export const renameDivisionTemplate = (playerId: string, template: number, name: string) =>
  act(playerId, 'division.rename', { template, name });
/** Assemble a template: set slot `slot` of your template `template` to `unit` (null = clear). */
export const setDivisionTemplate = (
  playerId: string,
  template: number,
  slot: number,
  unit: string | null,
) => act(playerId, 'division.template', { template, slot, unit });
/** Load a garrisoning division into a co-located, idle fleet (by free hold). */
export const loadDivision = (playerId: string, divisionId: string, fleetId: string) =>
  act(playerId, 'division.load', { divisionId, fleetId });
/** Unload a carried division onto the world its carrier is docked over. */
export const unloadDivision = (playerId: string, divisionId: string) =>
  act(playerId, 'division.unload', { divisionId });
/** Designate one of your inhabited worlds as your capital (hero respawn / re-fit anchor). */
export const designateCapital = (playerId: string, planetId: string) =>
  act(playerId, 'capital.designate', { planetId });

// --- hero engine (core heroModule, HERO-3..9): the data-driven hero actions ---
// `castHeroAbility` moved to `actions.ts` (REFP-24) — imported/re-exported in the
// REFP-22 block above alongside its siblings.
/** Raise an undeployed hero's ship at an owned world (or own fleet / allied world
 *  when the hero carries the matching spawn-marker ability). */
export const spawnHero = (playerId: string, heroId: string, at: string) =>
  act(playerId, 'hero.spawn', { heroId, at });
/** Unlock a hero skill-tree node (branch/requires/cost gate the order). */
export const unlockHeroSkill = (playerId: string, heroId: string, node: string) =>
  act(playerId, 'hero.skill.unlock', { heroId, node });
/** Install a ship fitting into one of the hero archetype's slots (no refit). */
export const fitHero = (playerId: string, heroId: string, fitting: string) =>
  act(playerId, 'hero.fit', { heroId, fitting });

// --- AI ----------------------------------------------------------------------


// REFP-25: the Steward guard-duty tick (`stewardGuardOrders` + its evacuation
// helpers) moved to `stewardGuard.ts` — pure action builder over shared-core
// forecasting + `actions.ts` builders + `protoKernel.ctx`. Imported here for
// `aiOrders` and re-exported for main.ts / netserver.ts / tests (until REFP-28).
import { stewardGuardOrders } from './stewardGuard';
export { stewardGuardOrders };


// REFP-26: the seat AIs (SeatAiKind/SeatAiDecision/seatAiDecision + aiOrders) moved
// to `ai.ts` — pure builders over actions.ts/economy/botFavour/map/sessionMarket +
// stewardGuard. Re-exported for main.ts / netserver.ts / tests (until REFP-28).
import { seatAiDecision, aiOrders, type SeatAiKind, type SeatAiDecision } from './ai';
export { seatAiDecision, aiOrders, type SeatAiKind, type SeatAiDecision };
