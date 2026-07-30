/**
 * Void Dominion — playable prototype, game setup.
 *
 * This file is pure game wiring (no DOM): it builds the data-driven content,
 * the map and the kernel out of the REAL `@void/shared-core` simulation, so the
 * browser UI and a Node smoke-test drive exactly the same deterministic core.
 */
import {
  hasOrbit,
  allowedBuildings,
  isBuildable,
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
  clearOffers,
  setStance,
  identifiedNodes,
  hoursToMs,
  effectiveStats,
  type DiplomaticStance,
  type GameData,
  type GameModule,
  type GameState,
  type ResourceBag,
  type Hero,
  type Planet,
  type Fleet,
  type UnitStack,
  type Player,
  type StewardLogEntry,
  type Action,
  type Battle,
  type StewardPosture,
} from '../../packages/shared-core/src/index';
import { provinceScore } from '../../packages/shared-core/src/state/sectorKind';
import { findHealthyStack } from '../../packages/shared-core/src/util/stacks';
import { garrisonUnderAssault } from '../../packages/shared-core/src/util/fleet';
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

/** Toggle the CC-2 auto-storm stance on an owned fleet (authoritative standing order). */
export const orderAuto = (playerId: string, fleetId: string, on: boolean) =>
  act(playerId, 'order.auto', { fleetId, on });
/** Stand (or stand down) a CC-4 reactive patrol on an owned squadron fleet — the server
 *  computes the patrol itself (center / radius / fresh sortie). */
export const orderScramble = (playerId: string, fleetId: string, on: boolean) =>
  act(playerId, 'order.scramble', { fleetId, on });
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
export const marketList = (
  playerId: string,
  side: MarketSide,
  resource: string,
  amount: number,
  price: number,
) => act(playerId, 'market.list', { side, resource, amount, price });
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

/** A garrison unit the evacuation can actually lift: the same gate `army.load`
 *  enforces (ground cargo only, fixed emplacements stay). */
const liftable = (unit: string): boolean => {
  const def = data.units[unit];
  return !!def && def.domain === 'ground' && !def.traits.includes('immobile');
};

/** Anti-shuttle cooldown (ST-3.4), game-hours: after the Steward evacuates X→Y,
 *  the REVERSE trip Y→X is off the haven list for this long — an enemy poking
 *  two nodes alternately must not make the wing челночить between them forever
 *  (each leg it defends nothing and a lane camper can catch it in the open).
 *  With no other haven the wing STANDS instead — a fight beats eternal transit. */
const EVAC_RETURN_COOLDOWN_H = 12;

/**
 * One guard-duty tick of the Steward for a delegated seat (posture «Оборона»,
 * ST-3.2 / steward-roadmap §ST-3): for every owned world a VISIBLE hostile
 * bears on, forecast the stand (`previewBattle`: every bearing force strikes,
 * the node's whole defense — docked fleets + garrison — answers). Forecast own
 * losses at/over `STEWARD_LOSS_LIMIT` mean the fight is a bad trade, so the
 * wing is pulled out to the nearest SAFE own world: self-moving fleets fly out
 * (lifting what garrison fits their holds on the way), and for the rest the
 * nearest idle transport with a free hold is summoned — only if it can arrive
 * with a tick to spare BEFORE the threat lands, because `army.load` locks the
 * moment the assault starts (`E_UNDER_ASSAULT`). Evacuation is loss-avoidance:
 * the autopilot saves what it cannot profitably defend, it never fights better
 * than the player would. Pure builder like `aiOrders`: returns actions only.
 * The forecast is the base model (no `combat.damage` hooks) over one combined
 * engagement — a retreat heuristic, not an oracle (ONB-6 semantics).
 */
export function stewardGuardOrders(
  state: GameState,
  ai: string,
  posture: StewardPosture = 'defend',
): Action[] {
  const out: Action[] = [];
  const c = ctx(state.time);
  // SITREP (ST-2.4): every decision below is journaled and stamped as ONE
  // trailing `steward.report` — the morning report the sleeping owner reads.
  const report: StewardLogEntry[] = [];
  const frac = (x: number): number => Math.round(x * 1000) / 1000;
  // Repeat-prone facts (hold/stranded re-derive every 2h tick) are stamped once
  // per EPISODE: skipped while the node's latest journal line already says the
  // same thing. The journal lives in state, so the check survives the stateless
  // re-tick; any different entry for the node reopens the episode.
  const lastLogged = (node: string): string | undefined => {
    const log = state.players[ai]?.stewardLog;
    if (!log) return undefined;
    for (let i = log.length - 1; i >= 0; i--) {
      if (log[i]!.node === node) return log[i]!.kind;
    }
    return undefined;
  };
  const noteOnce = (entry: StewardLogEntry): void => {
    if (entry.node !== undefined && lastLogged(entry.node) === entry.kind) return;
    report.push(entry);
  };
  const identified = identifiedNodes(state, ai, data);
  const mine = Object.values(state.planets).filter((p) => p.owner === ai);
  // Threat scans are per-node; cache them — the haven search re-reads them.
  const threatCache = new Map<string, ReturnType<typeof scanNodeThreats>>();
  const threatsOf = (node: string): ReturnType<typeof scanNodeThreats> => {
    let t = threatCache.get(node);
    if (t === undefined) {
      t = scanNodeThreats(state, node, ai, c, identified);
      threatCache.set(node, t);
    }
    return t;
  };
  // Hold points (ST-2.1): player-designated standing anchors — never evacuated,
  // reinforced instead; their docked wings are not poached for other errands.
  const holdPoints = new Set(state.players[ai]?.stewardHoldPoints ?? []);
  // A fleet gets ONE task per tick (evacuate or ferry) — never two nodes' errands.
  const tasked = new Set<string>();
  const idleOwn = (f: Fleet): boolean =>
    f.owner === ai && f.location != null && !f.movement && !f.battleId && !tasked.has(f.id);
  // fleetCargoFree, not a local re-count: the hold is shared with carried DIVISIONS
  // too — a transport already ferrying a formation must not be over-filled.
  const freeHold = (f: Fleet): number => fleetCargoFree(state, f);

  for (const p of mine) {
    const threats = threatsOf(p.id);
    if (threats.length === 0) continue;
    const docked = Object.values(state.fleets).filter((f) => idleOwn(f) && f.location === p.id);
    const defenders: UnitStack[] = [...docked.flatMap((f) => f.units), ...p.garrison];
    if (!defenders.some((s) => s.count > 0)) continue; // nothing here to save
    const attackers: UnitStack[] = threats.flatMap((t) => {
      const f = state.fleets[t.fleetId];
      return f ? [...f.units, ...(f.landing ?? [])] : [];
    });
    const stand = previewBattle(attackers, defenders, data);
    // A stand the forecast says we WIN is held regardless of its price: fleeing a
    // won fight gifts the world to a cheap feint (three scouts «push» a cruiser
    // off an empty rock and walk in). The loss limit judges only losing/pyrrhic
    // stands — the wing bails when it would be wiped or ground down for nothing.
    const holds =
      stand.outcome === 'defender' || stand.defender.damageFraction < STEWARD_LOSS_LIMIT;
    if (holds) {
      // Counterstrike (ST-3.3, «Активная оборона» only): war-stance intruders
      // PARKED at our node that auto-engage didn't already lock (war declared
      // after they docked; a resolved battle's leftovers). The combat module
      // AUTO-re-engages a battle's victor into the NEXT parked hostile, so the
      // gate must price the WHOLE ladder, not the first rung: the wing has to
      // clear EVERY parked intruder, chained in scan order, with CUMULATIVE
      // hull losses under the limit — else a cheap first fight would drag the
      // damaged wing into one its forecast declined («держим, но не
      // кровоточим»). One engager, one order — the victor chain does the rest;
      // the fight happens where the wing stands: own territory only.
      const holdEntry: StewardLogEntry = {
        at: state.time,
        kind: 'hold',
        node: p.id,
        fraction: frac(stand.defender.damageFraction),
      };
      if (posture !== 'active_defend') {
        noteOnce(holdEntry);
        continue;
      }
      const ladder: Fleet[] = [];
      for (const t of threats) {
        if (t.kind !== 'present') continue;
        const tf = state.fleets[t.fleetId];
        if (tf && !tf.battleId) ladder.push(tf);
      }
      if (ladder.length === 0) {
        noteOnce(holdEntry);
        continue;
      }
      const byStrength = [...docked].sort(
        (a, b) =>
          hullPool(b.units, data) - hullPool(a.units, data) ||
          (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
      );
      let engaged = false;
      for (const f of byStrength) {
        if (tasked.has(f.id)) continue;
        let wing = f.units;
        let clears = true;
        for (const tf of ladder) {
          const rung = previewBattle(wing, tf.units, data);
          if (rung.outcome !== 'attacker') {
            clears = false;
            break;
          }
          wing = rung.attacker.survivors; // carry the hull damage into the next rung
        }
        const before = hullPool(f.units, data);
        if (!clears || before <= 0) continue;
        const ladderFraction = 1 - hullPool(wing, data) / before;
        if (ladderFraction >= STEWARD_LOSS_LIMIT) continue;
        out.push(engageFleet(ai, f.id, ladder[0]!.id));
        tasked.add(f.id);
        engaged = true;
        report.push({
          at: state.time,
          kind: 'strike',
          node: p.id,
          fleetId: f.id,
          count: ladder.length,
          fraction: frac(ladderFraction),
        });
        break;
      }
      if (!engaged) noteOnce(holdEntry);
      continue;
    }
    const earliest = threats[0]!.eta;
    // Hold point (ST-2.1): a player-designated anchor is NEVER auto-evacuated —
    // the standing order outranks the loss forecast. The Steward instead tries
    // to FLIP the forecast: summon ONE idle wing that (a) arrives with a tick
    // (2h) to spare before the earliest threat lands and (b) turns the combined
    // stand into a hold. Piecemeal feeding is refused — help that arrives late
    // or still loses would only widen the defeat; the wing then stands as
    // ordered, and the journal's bad fraction tells the owner the price.
    if (holdPoints.has(p.id)) {
      // Help already flying in (last tick's relief or the owner's own order) —
      // nothing to add; the episode is already journaled.
      const inboundHelp = Object.values(state.fleets).some(
        (f) => f.owner === ai && f.movement != null && journeyDestination(f.movement) === p.id,
      );
      if (!inboundHelp) {
        let relief: Fleet | null = null;
        let reliefEta = Infinity;
        let reliefFraction = 0;
        for (const f of Object.values(state.fleets)) {
          if (!idleOwn(f) || f.location === p.id) continue;
          if (!f.units.some((s) => s.count > 0)) continue;
          // Same no-poach rule as the ferry: a wing on another threatened node
          // (or another anchor) is needed where it stands.
          if (threatsOf(f.location!).length > 0 || holdPoints.has(f.location!)) continue;
          const hours = estimateTravelHours(state, data, f.location!, p.id, f);
          if (hours === null) continue;
          const arrives = state.time + hoursToMs(c, hours);
          if (arrives + hoursToMs(c, 2) > earliest) continue; // too late to matter
          const together = previewBattle(attackers, [...defenders, ...f.units], data);
          const flips =
            together.outcome === 'defender' ||
            together.defender.damageFraction < STEWARD_LOSS_LIMIT;
          if (!flips) continue;
          if (arrives < reliefEta) {
            reliefEta = arrives;
            relief = f;
            reliefFraction = together.defender.damageFraction;
          }
        }
        if (relief) {
          out.push(moveFleet(ai, relief.id, p.id));
          tasked.add(relief.id);
          report.push({
            at: state.time,
            kind: 'reinforce',
            node: p.id,
            fleetId: relief.id,
            fraction: frac(reliefFraction),
          });
        } else {
          noteOnce({
            at: state.time,
            kind: 'hold',
            node: p.id,
            fraction: frac(stand.defender.damageFraction),
          });
        }
      }
      continue; // a hold point never falls through to evacuation
    }
    // Bad trade — evacuate to the nearest reachable own world nothing bears on.
    // Anti-shuttle hysteresis (ST-3.4): a candidate we RECENTLY fled FROM into
    // this very node is the shuttle's return leg — journaled evacuations
    // (state-resident, so the check survives the stateless re-tick) block it
    // for EVAC_RETURN_COOLDOWN_H game-hours.
    const returnBlocked = (candidate: string): boolean => {
      const log = state.players[ai]?.stewardLog;
      if (!log) return false;
      const horizon = hoursToMs(c, EVAC_RETURN_COOLDOWN_H);
      for (let i = log.length - 1; i >= 0; i--) {
        const e = log[i]!;
        if (e.kind !== 'evac' || e.node !== candidate || e.to !== p.id) continue;
        if (state.time - e.at < horizon) return true;
      }
      return false;
    };
    let haven: string | null = null;
    let havenDist = Infinity;
    for (const q of mine) {
      if (q.id === p.id || threatsOf(q.id).length > 0 || returnBlocked(q.id)) continue;
      const route = planRoute(state, p.id, q.id);
      if (!route) continue;
      const dist = routeDistance(state, p.id, route);
      if (dist < havenDist) {
        havenDist = dist;
        haven = q.id;
      }
    }
    if (haven === null) {
      // Nowhere safer — a FORCED stand; the bad fraction in the entry tells the
      // owner why the wing stayed put.
      noteOnce({
        at: state.time,
        kind: 'hold',
        node: p.id,
        fraction: frac(stand.defender.damageFraction),
      });
      continue;
    }
    const assaulted = garrisonUnderAssault(state, p.id);
    // What the garrison still holds after the loads planned below (state is
    // read-only). Counted EXACTLY as `army.load` will resolve it — via
    // findHealthyStack: only a full-health, default-loadout stack embarks.
    // Battle-worn troops cannot be lifted (they hold the line; hospitals mend
    // them) — planning them would bounce off E_NO_ARMY and, worse, mark the
    // garrison as handled so no ferry would come for anyone.
    const left = new Map<string, number>();
    for (const s of p.garrison) {
      if (s.count <= 0 || !liftable(s.unit) || left.has(s.unit)) continue;
      const healthy = findHealthyStack(p.garrison, s.unit);
      if (healthy) left.set(s.unit, healthy.count);
    }
    // Docked fleets fly out — lifting what garrison fits their holds first
    // (load and move stack in one tick: actions apply in order while docked).
    for (const f of docked) {
      if (!assaulted) {
        let free = freeHold(f);
        for (const [unit, have] of left) {
          if (free <= 0 || have <= 0) continue;
          const size = data.units[unit]?.stats.cargoSize ?? 0;
          const n = size > 0 ? Math.min(have, Math.floor(free / size)) : have;
          if (n <= 0) continue;
          out.push(loadArmy(ai, f.id, unit, n));
          left.set(unit, have - n);
          free -= n * size;
        }
      }
      // A standing patrol flies out with its carrier: stand it down first (the
      // sortie is stashed, BF-26) so no stale patrol record points at this node.
      if ((state as DivState).patrols?.[f.id]) out.push(orderScramble(ai, f.id, false));
      out.push(moveFleet(ai, f.id, haven));
      tasked.add(f.id);
    }
    if (docked.length > 0) {
      report.push({
        at: state.time,
        kind: 'evac',
        node: p.id,
        to: haven,
        count: docked.length,
        fraction: frac(stand.defender.damageFraction),
      });
    }
    // Garrison still stranded → summon the nearest idle transport with a free
    // hold, but only when it beats the threat with one AI tick (2h) to spare —
    // a transport that would arrive into the assault is not sent at all.
    const stranded = [...left.values()].some((n) => n > 0);
    const inboundAlready = Object.values(state.fleets).some(
      (f) => f.owner === ai && f.movement != null && journeyDestination(f.movement) === p.id,
    );
    if (stranded && !inboundAlready && !assaulted) {
      let ferry: Fleet | null = null;
      let ferryEta = Infinity;
      for (const f of Object.values(state.fleets)) {
        if (!idleOwn(f) || f.location === p.id || freeHold(f) <= 0) continue;
        // Never poach a transport off ANOTHER threatened node (its own evac
        // branch tasks it) or off a hold point (the anchor keeps its wing).
        if (threatsOf(f.location!).length > 0 || holdPoints.has(f.location!)) continue;
        const hours = estimateTravelHours(state, data, f.location!, p.id, f);
        if (hours === null) continue;
        const arrives = state.time + hoursToMs(c, hours);
        if (arrives + hoursToMs(c, 2) > earliest) continue; // too late to load — don't feed it in
        if (arrives < ferryEta) {
          ferryEta = arrives;
          ferry = f;
        }
      }
      if (ferry) {
        out.push(moveFleet(ai, ferry.id, p.id));
        tasked.add(ferry.id);
        report.push({ at: state.time, kind: 'ferry', node: p.id, fleetId: ferry.id });
      } else {
        // Liftable troops remain, no help is coming this tick — the owner should
        // wake up to «гарнизон не спасти», not to silence. Once per episode.
        noteOnce({
          at: state.time,
          kind: 'stranded',
          node: p.id,
          fraction: frac(stand.defender.damageFraction),
        });
      }
    }
  }
  // Fire-watch (ST-3.3, «Активная оборона» only): stand a CC-4 reactive patrol on
  // every wing docked at an OWN world that isn't patrolling yet — the дежурный
  // вылет then answers raiders inside its radius on its own cadence (including
  // the mid-lane standoff campers `fleet.engage` can't reach). Never on foreign
  // soil; a wing the evac branch just tasked is not re-ordered.
  if (posture === 'active_defend') {
    const patrols = (state as DivState).patrols;
    for (const f of Object.values(state.fleets)) {
      if (!idleOwn(f) || !fleetHasSquadron(f) || patrols?.[f.id]) continue;
      if (state.planets[f.location!]?.owner !== ai) continue;
      out.push(orderScramble(ai, f.id, true));
      report.push({ at: state.time, kind: 'watch', node: f.location!, fleetId: f.id });
    }
  }
  // The SITREP stamp rides LAST: it narrates the orders above. Applied through
  // the same kernel path (steward.report — server-driver-only, gate refuses it
  // from the wire), so the journal lands in state and survives the night.
  if (report.length > 0) out.push(act(ai, 'steward.report', { entries: report }));
  return out;
}

/** The two server-side AIs that can play a seat, kept explicitly DISTINCT
 *  (SES-2.2). `steward` — «Хранитель»: the player's OWN autopilot, a defensive
 *  posture they turned on to cover their sleep; it runs on their chosen posture
 *  even while they are connected-but-idle, and its live delegation OUTRANKS the
 *  abandon grace. `substitute` — «заместитель»: the full expansion bot that takes
 *  over an ABANDONED chair, only after the player has been gone past the
 *  real-time grace window, and it is reclaimed the instant they return. `none` —
 *  no AI drives the seat this tick (a present player commands it, or an absent
 *  one is still inside their reconnect grace). */
export type SeatAiKind = 'steward' | 'substitute' | 'none';

/** What drives a seat this tick + the posture to hand `aiOrders`. */
export interface SeatAiDecision {
  kind: SeatAiKind;
  posture: StewardPosture | 'expand' | null; // null ⇔ kind === 'none'
}

/** Decide which server AI (if any) plays ONE seat this tick — SES-2.2. Pure:
 *  reads only the three facts the host tracks, no time source of its own.
 *  `hasHuman` — a live peer holds the chair; `posture` — the seat's active
 *  Steward delegation (`stewardActive`), null if none; `graceExpired` — the
 *  player has been absent PAST the real-time abandon window (wall-clock, the host
 *  compares `Date.now()`; always true for a chair that never opened a window).
 *  The precedence encodes the owner's intent: a delegation they set beats the
 *  automatic takeover, and a present human beats the idle bot. */
export function seatAiDecision(
  hasHuman: boolean,
  posture: StewardPosture | null,
  graceExpired: boolean,
): SeatAiDecision {
  // A live Steward delegation is the player's OWN autopilot: it plays regardless
  // of connection and never waits on the abandon grace (they asked for it).
  if (posture) return { kind: 'steward', posture };
  // No delegation → a present human commands their own chair.
  if (hasHuman) return { kind: 'none', posture: null };
  // Empty chair: wait out the grace (a drop / restart blip / a few days away)
  // before the substitute bot seizes it — reclaimed the moment they return.
  if (!graceExpired) return { kind: 'none', posture: null };
  return { kind: 'substitute', posture: 'expand' };
}

/** One decision tick's orders for an AI-driven seat, evaluated against `state`.
 *  Read-only: it builds and returns the actions; the caller applies them — the
 *  client to its local sim, the server through the authoritative room. Drives
 *  empty seats the same way in solo and multiplayer (a seat with no human). */
export function aiOrders(
  state: GameState,
  ai: string,
  posture: StewardPosture | 'expand' = 'expand',
): Action[] {
  const out: Action[] = [];
  if (!state.players[ai]) return out; // seat not in play / eliminated
  // The defensive family: both Steward postures HOLD (no expansion, no war
  // declarations); «Активная оборона» merely adds the counterstrike/fire-watch
  // inside the guard-duty tick below.
  const defensive = posture === 'defend' || posture === 'active_defend';
  // Steward guard duty (ST-3.2/3.3): a delegated defensive seat watches its worlds,
  // evacuates a wing the forecast says it would lose ≥ STEWARD_LOSS_LIMIT of, and —
  // under «Активная оборона» — counterstrikes what it beats cheaply on own soil.
  if (defensive) out.push(...stewardGuardOrders(state, ai, posture as StewardPosture));
  const isShipUnit = (u: string): boolean => !data.units[u]?.traits.includes('ground');
  const capturable = (p: Planet): boolean => SECTOR_TYPES[p.kind ?? '']?.capturable ?? false;
  const d = (a: { x: number; y: number }, b: { x: number; y: number }): number =>
    Math.hypot(a.x - b.x, a.y - b.y);
  // Send each idle AI fleet toward the nearest capturable world it can reach — only
  // neutral worlds or territory of someone it's at WAR with (peace = off-limits).
  // Steward «Оборона» (a delegated human seat, posture 'defend') HOLDS: it skips this
  // offensive sweep entirely and only builds / reinforces / trades below — repelling an
  // attacker is automatic in combat. "Autopilot keeps you alive; active play wins."
  // Named `warFooting` (not `atWar`) so the module-level pair helper stays visible.
  const warFooting = Object.keys(state.players).some(
    (pid) =>
      pid !== ai && state.players[pid]?.status === 'active' && getStance(state, ai, pid) === 'war',
  );
  // The home base (build/launch anchor, and the rally point ships pool at during war).
  const base =
    Object.values(state.planets).find((p) => p.owner === ai && p.buildings.length > 0) ??
    Object.values(state.planets).find((p) => p.owner === ai);
  const shipCount = (f: Fleet): number =>
    f.units.reduce((n, s) => n + (isShipUnit(s.unit) ? s.count : 0), 0);
  const expandFleets: Fleet[] = defensive ? [] : Object.values(state.fleets);
  // Consolidate BEFORE moving (self-play M4): two idle fleets sharing a location fuse
  // into one — without this, battle remnants and rally leftovers accumulate into a
  // hundreds-strong swarm of one-ship fleets that grinds the whole sim (and feeds
  // enemy AA one hull at a time). The merged fleet sorties on the next tick.
  const skipMove = new Set<string>();
  {
    const byLoc = new Map<string, Fleet[]>();
    for (const f of expandFleets) {
      if (f.owner !== ai || f.location == null || f.movement || f.battleId) continue;
      const group = byLoc.get(f.location);
      if (group) group.push(f);
      else byLoc.set(f.location, [f]);
    }
    for (const group of byLoc.values()) {
      if (group.length < 2) continue;
      group.sort((a, b) => shipCount(b) - shipCount(a));
      for (let k = 1; k < group.length; k++) {
        out.push(mergeFleet(ai, group[k]!.id, group[0]!.id));
        skipMove.add(group[k]!.id);
      }
      skipMove.add(group[0]!.id); // it grows this tick, sorties the next
    }
  }
  for (const f of expandFleets) {
    if (f.owner !== ai || f.location == null || f.movement || f.battleId) continue;
    if (skipMove.has(f.id)) continue;
    // Strike groups, not dribbles (self-play M4): auto-rally pools each new ship into
    // the IDLE rally fleet at its build world — but only while one is parked there.
    // Sending every single-ship fleet out at once therefore orphaned the rally point,
    // spawned a fresh one-ship fleet per build (hundreds of fleets, the sim ground to
    // a halt) and fed hulls into enemy AA one at a time. At war, ships HOLD at the
    // home rally point until a strike group has formed; peacetime keeps the old
    // race-to-claim behaviour (speed is everything, there is nothing to fight).
    if (warFooting && f.location === base?.id) {
      if (shipCount(f) < 3) continue;
      // Lift a landing party before the sortie: only ground troops can take a
      // garrisoned world (two-phase capture), so a strike group without a landing
      // can raid provinces but never resolve the war. Load, then move — same tick.
      const militia = base.garrison.find((s) => s.unit === 'militia' && s.count > 0);
      const hasLanding = (f.landing ?? []).some((s) => s.count > 0);
      if (!hasLanding && militia) {
        out.push(loadArmy(ai, f.id, 'militia', Math.min(2, militia.count)));
      }
    }
    const here = state.planets[f.location];
    if (!here) continue;
    let best: Planet | null = null;
    let bestD = Infinity;
    for (const p of Object.values(state.planets)) {
      if (p.owner === ai || !capturable(p)) continue;
      if (!canTraverse(state, ai, p.owner)) continue; // a peace-locked target — leave it be
      const dd = d(here.position, p.position);
      if (dd < bestD) {
        bestD = dd;
        best = p;
      }
    }
    if (best) out.push(moveFleet(ai, f.id, best.id));
  }
  // War when the race is being LOST (self-play M4 finding): a passive bot loses the
  // score race to whoever expands faster — every bot-vs-bot match ended as a 2-day
  // race with zero battles, and the military (and combat factions) never played. So
  // a bot falling a planet's worth (≥ 50) behind the score leader — or merely behind
  // once no capturable neutral is left — declares war on that leader; the expansion
  // loop above then targets war territory (traversable/capturable) and contested
  // provinces swing back. A bot that IS ahead stays quiet — it wins by holding.
  // Declared only from a clean 'peace' stance: pacts/alliances are never betrayed,
  // and favour-driven war (botDiplomacyModule) keeps working on top unchanged.
  if (!defensive) {
    const scoreOf = (who: string): number =>
      Object.values(state.planets).reduce(
        (s, p) => (p.owner === who ? s + provinceScore(data, p) : s),
        0,
      );
    const mine = scoreOf(ai);
    let leader: string | null = null;
    let leaderScore = -1;
    for (const pid of Object.keys(state.players)) {
      if (pid === ai || state.players[pid]?.status !== 'active') continue;
      const sc = scoreOf(pid);
      if (sc > leaderScore) {
        leaderScore = sc;
        leader = pid;
      }
    }
    const neutralLeft = Object.values(state.planets).some((p) => p.owner === null && capturable(p));
    const losingRace = leaderScore - mine >= 50 || (!neutralLeft && leaderScore >= mine);
    if (leader && losingRace && getStance(state, ai, leader) === 'peace') {
      out.push(declareWar(ai, leader));
    }
  }
  // Build + launch from this AI's home base (its first developed owned world).
  const pl = state.players[ai];
  if (base && pl) {
    // Keep the lights on first: a bot whose energy/food NET flow is negative (or already
    // in arrears) raises a plant/farm before anything else — brownouts halve its economy.
    const flow = netIncome(state, ai);
    const has = (b: string): boolean =>
      Object.values(state.planets).some(
        (p) => p.owner === ai && p.buildings.some((x) => x.type === b),
      );
    for (const [need, b] of [
      ['energy', 'power_plant'],
      ['food', 'farm'],
    ] as const) {
      if ((flow[need] ?? 0) >= 0 && !(pl.arrears ?? []).includes(need)) continue;
      if (has(b)) continue;
      const cost = data.buildings[b]?.cost ?? {};
      if (Object.keys(cost).every((r) => (pl.resources[r] ?? 0) >= (cost[r] ?? 0) + 60)) {
        out.push(buildBuilding(ai, base.id, b));
      }
    }
    // Economy chain (self-play M4: mine/refinery/tax office were DEAD content for the
    // bot — it bought all its metal on the market): raise the first missing credit
    // engine at the home base (refinery → tax office), and put a metal mine on each
    // captured PRIZE world — one link at a time, only when comfortably affordable,
    // and never over the same build already queued (no reject spam).
    const pendingBuild = (planetId: string, b: string): boolean =>
      state.scheduled.some((e) => {
        if (e.type !== 'construction.complete') return false;
        const q = e.payload as { kind?: string; planetId?: string; building?: string };
        return q.kind === 'building' && q.planetId === planetId && q.building === b;
      });
    const affordable = (b: string): boolean => {
      const cost = data.buildings[b]?.cost ?? {};
      return Object.keys(cost).every((r) => (pl.resources[r] ?? 0) >= (cost[r] ?? 0) + 60);
    };
    // ECON-7: fabricator joins the chain — microelectronics gates warships now
    // (cruiser/siege cost micro), so a bot without a fab eventually can't build a
    // fleet. Built once the credit/tax engine is up; keeps micro produced AND spent.
    for (const b of ['refinery', 'tax_office', 'fabricator'] as const) {
      if (has(b)) continue;
      if (affordable(b) && !pendingBuild(base.id, b)) out.push(buildBuilding(ai, base.id, b));
      break; // one link at a time — wait out the current one either way
    }
    for (const p of Object.values(state.planets)) {
      if (p.owner !== ai || p.kind !== 'planet' || p.id === base.id) continue;
      if (p.buildings.some((x) => x.type === 'mine') || pendingBuild(p.id, 'mine')) continue;
      if (!affordable('mine')) break;
      out.push(buildBuilding(ai, p.id, 'mine'));
      break; // spread the economy one world per tick
    }
    // Ship production is CAPPED by the fleet count (self-play M4: endless building
    // fed an ever-growing swarm — hundreds of fleets by mid-match). Enough fleets
    // out ⇒ the metal flows to economy/garrisons instead.
    const aiFleets = Object.values(state.fleets).filter((f) => f.owner === ai).length;
    if (
      aiFleets < (warFooting ? 8 : 4) &&
      (pl.resources.metal ?? 0) > 220 &&
      (pl.resources.credits ?? 0) > 120 &&
      (pl.resources.microelectronics ?? 0) >= 3 // ECON-7: warships need the hi-tech good
    ) {
      out.push(buildUnit(ai, base.id, 'cruiser', 1));
    }
    // Wartime posture (self-play M4: wars were free walk-in raids — the leader had no
    // garrisons, so whoever attacked always came back and won): at war the bot
    // (a) garrisons its undefended PRIZE worlds with militia — a garrisoned planet
    // can't be walk-in captured, it takes a ground assault; the 10-point provinces
    // stay an open raid zone by design; (b) adds fast scouts to the build mix
    // (capture runners for that raid zone); (c) fields more fleets — and a launched
    // fleet lifts home-built militia aboard as landing troops (fleet.launch), which
    // is exactly what lets it assault a garrisoned world back.
    if (warFooting) {
      let garrisonOrders = 0;
      for (const p of Object.values(state.planets)) {
        if (garrisonOrders >= 2 || (pl.resources.metal ?? 0) < 90) break;
        if (p.owner !== ai || p.kind !== 'planet') continue;
        if (p.garrison.some((s) => s.count > 0)) continue;
        out.push(buildUnit(ai, p.id, 'militia', 2));
        garrisonOrders += 1;
      }
      // A landing stock at home: strike groups lift militia on sortie (above), so
      // the base keeps a few spare beyond its seeded defenders.
      const baseMilitia = base.garrison
        .filter((s) => s.unit === 'militia')
        .reduce((n, s) => n + s.count, 0);
      if (baseMilitia < 4 && (pl.resources.metal ?? 0) > 120) {
        out.push(buildUnit(ai, base.id, 'militia', 2));
      }
      if (aiFleets < 8 && (pl.resources.metal ?? 0) > 140) {
        out.push(buildUnit(ai, base.id, 'scout', 1));
      }
    }
    // (marine retired: the AI no longer cheap-builds a ground trooper. Its home keeps its
    //  seeded infantry garrison + orbital-AA building for defence; mobile ground via divisions.)
    const baseHasShip = base.garrison.some((st) => isShipUnit(st.unit));
    if (aiFleets < (warFooting ? 4 : 2) && baseHasShip) out.push(launchFleet(ai, base.id));
  }
  // Trade on the session market: a passive bot liquidates the surplus goods it never
  // uses (food/energy/microelectronics) into the credits it always needs, and — when
  // flush — bids for the metal it burns fastest. One open lot per resource so it doesn't
  // spam. Embargo needs no check here: the book is anonymous and market.take rejects a
  // soured player from filling the bot's lots (botEmbargoes), so the bot simply won't
  // trade with anyone it has soured on.
  if (pl) {
    const lots = marketLots(state);
    const hasLot = (side: MarketSide, resource: string): boolean =>
      lots.some((l) => l.owner === ai && l.side === side && l.resource === resource);
    for (const good of ['food', 'energy', 'microelectronics']) {
      const have = pl.resources[good] ?? 0;
      const reserve = good === 'microelectronics' ? 40 : 120; // the working stock it keeps
      if (have >= reserve + 40 && !hasLot('sell', good))
        out.push(marketList(ai, 'sell', good, Math.floor((have - reserve) / 2), 2));
    }
    if (
      (pl.resources.metal ?? 0) < 80 &&
      (pl.resources.credits ?? 0) > 300 &&
      !hasLot('buy', 'metal')
    ) {
      out.push(marketList(ai, 'buy', 'metal', 30, 3));
    }
  }
  return out;
}
