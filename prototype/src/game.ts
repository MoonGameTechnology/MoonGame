/**
 * Void Dominion — the prototype's public API facade (REFP-28).
 *
 * Once a 5289-line god-file, `game.ts` is now a PURE re-export barrel: every
 * mechanic lives in its own module (the REFP block extracted them one brick at a
 * time), and this file only preserves the historical import surface for
 * `main.ts` / `netserver.ts` / the tests. It contains NO logic, NO state and NO
 * constants of its own, and nothing imports back from it (zero reverse edges).
 * New code should import from the source modules directly; consumers migrate off
 * this barrel opportunistically, file by file.
 */

// --- content + map -----------------------------------------------------------
export { data } from './prototypeData';
export { SECTOR_TYPES, MAP, START_CANDIDATES, type SectorType, type MapNode } from './map';

// --- wall-clock units of game time -------------------------------------------
export { HOUR, DAY } from './time';

// --- shared-core names the UI/hosts historically took from here --------------
// Stance vocabulary (main.ts routes propose-vs-declare by the same ranks the core
// module enforces — one table, no drift) + the Steward reads.
export {
  STANCE_RANK,
  hasMapShare,
  hasMapShareOffer,
  stewardActive,
  STEWARD_POSTURES,
  MAX_STEWARD_HOLD_POINTS,
} from '../../packages/shared-core/src/index';

// --- assembling the match ----------------------------------------------------
export {
  type SeatConfig,
  type SetupConfig,
  DEFAULT_SETUP,
  type NetworkMatchMode,
  parseNetworkMatchMode,
  networkSeats,
  newGame,
} from './matchSetup';

// --- the kernel assembly point (module ORDER = determinism contract) ---------
export {
  MODULES,
  kernel,
  SCORE_LIMIT,
  ctx,
  advance,
  order,
  canOrder,
  canOrderAll,
  type StepOut,
} from './protoKernel';

// --- economy family ----------------------------------------------------------
export {
  TAX_PER_HOUR,
  TAX_DIMINISH,
  isInhabited,
  civicTax,
  inhabitedWorldCount,
} from '../../packages/shared-core/src/index';
export { HUNGER_MULT, hungerModule } from './hunger';
export { economySnapshot, netIncome, hpOfLevel } from './economy';
// BAL-5: разложение счёта на слагаемые — читает харнес замера (`selfplay.mjs`).
export { scoreParts, type ScoreParts } from './scoreParts';
// AI-BAL-10: диагноз мёртвого контента для харнеса замера. Чистая функция (исходник бота
// приходит строкой), поэтому фасад её реэкспортирует, а `node:fs` остаётся у вызывающего.
export { splitDeadContent, type DeadContentSplit } from './deadContent';
export {
  MARKET_COMMISSION,
  isTradable,
  type MarketSide,
  type MarketOrder,
} from '../../packages/shared-core/src/index';
export {
  REPAIR_HP_PER_METAL,
  dockRepairCost,
  fleetAtOwnDock,
  fleetRepairModule,
} from '../../packages/shared-core/src/index';
export {
  INSTANT_REPAIR_CREDITS_PER_HP,
  missingHull,
  instantRepairCost,
  instantRepairModule,
} from '../../packages/shared-core/src/index';

// --- fleets, squadrons, standing orders --------------------------------------
export { fleetOpsModule, autoRallyModule } from '../../packages/shared-core/src/index';
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
} from '../../packages/shared-core/src/index';
// Предикаты «действующего крыла» — сторона КЛИЕНТА, а не правило мира, поэтому они
// не в ядре, а в общем пакете решений, откуда их видит и `packages/client` (CONV-5).
export { isWing, wingCanAct, wingCanReturn, type WingFleet } from '../../decisions/wingOrders';
export {
  fleetIdle,
  validateChainSteps,
  MAX_CHAIN_STEPS,
  MAX_CHAIN_WAIT_HOURS,
  type ChainStep,
  type FleetChain,
} from '../../packages/shared-core/src/index';
export { patrolTarget, scrambleOrder, type Patrol } from './patrol';
export { standingOrdersModule } from '../../packages/shared-core/src/index';
export {
  FORCED_MARCH_MULT,
  FORCED_MARCH_WEAR,
  forcedMarchModule,
} from '../../packages/shared-core/src/index';
export { serverAutoAssaultActions, serverChainActions, serverPatrolActions } from './serverDrivers';

// --- ground war --------------------------------------------------------------

// --- diplomacy + bots --------------------------------------------------------
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
} from './botFavour';

// --- heroes + capital --------------------------------------------------------
export { heroRosterOf } from './heroes';
export { capitalOf } from '../../packages/shared-core/src/index';

// --- the player-order action builders ----------------------------------------
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
  shareMap,
  spyOn,
  canTraverse,
  castHeroAbility,
  orderAuto,
  orderScramble,
  patrolStamp,
  orderChain,
  forceMarchFleet,
  instantRepairFleet,
  repairFleet,
  chainStamp,
  marketList,
  marketTake,
  marketCancel,
  designateCapital,
  spawnHero,
  unlockHeroSkill,
  fitHero,
} from './actions';

// --- server-side seat AIs ----------------------------------------------------
export { stewardGuardOrders } from './stewardGuard';
export { seatAiDecision, aiOrders, type SeatAiKind, type SeatAiDecision } from './ai';
