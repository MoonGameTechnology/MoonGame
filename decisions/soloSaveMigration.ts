import { parseSoloSave, type SoloSave } from './soloSave';

/** One audited pair of releases: a save written under `fromRules` reads under `toRules`. */
export interface SoloMigration {
  readonly fromRules: string;
  readonly fromData: string;
  readonly fromDataHash: string;
  readonly toRules: string;
  readonly toData: string;
  readonly toDataHash: string;
}

/** Exact release pair, measured from shipped data + prototype kernel manifests.
 *  Source: main 8093c358, catalogue 0.1.66, construction 1.5.0.
 *  The successor only retires new extractor orders: legacy definitions, costs,
 *  income and already accepted work are retained; ship prices remain match-pinned.
 *  Do not extend this allowlist to arbitrary versions or to remote-balance flags. */
export const MINING_SOLO_MIGRATION = {
  fromRules: '1e052bee8a880d',
  fromData: '0.1.66',
  fromDataHash: '1e4661c8e0ed4a',
  toRules: '17d695a32e4aae',
  toData: '0.1.67',
  toDataHash: '04ecdea8782a0c',
} as const;

/** Exact release pair after the mining one, measured the same way. Catalogue 0.1.68 only
 *  adds the fixed-side modes `team_6v6`…`team_10v10` of corporations battles (CORP-8): no
 *  solo game plays them, so a saved world, its costs and its rules are untouched. */
export const CORP_FORMATS_SOLO_MIGRATION = {
  fromRules: MINING_SOLO_MIGRATION.toRules,
  fromData: MINING_SOLO_MIGRATION.toData,
  fromDataHash: MINING_SOLO_MIGRATION.toDataHash,
  toRules: '010d340c2984dc',
  toData: '0.1.68',
  toDataHash: '1a42ba1318c5a5',
} as const;

/** Commander power trees and their six hidden technologies are retired. Existing
 *  worlds keep their accepted orders, resources and council; no old profile grant
 *  is reapplied. Removed technology definitions no longer contribute their bonuses. */
export const COMMANDER_CAREER_SOLO_MIGRATION = {
  fromRules: CORP_FORMATS_SOLO_MIGRATION.toRules,
  fromData: CORP_FORMATS_SOLO_MIGRATION.toData,
  fromDataHash: CORP_FORMATS_SOLO_MIGRATION.toDataHash,
  toRules: '181a9f99b3928d',
  toData: '0.1.69',
  toDataHash: '0acb4059848b47',
} as const;

/** Rules-only pair: movement 1.6.0 / visibility 2.4.0 halt a fleet at a closed border only
 *  after discovering it. The catalogue is unchanged and saved orders keep their shape, so a
 *  saved world reads as is. */
export const RECON_HALT_SOLO_MIGRATION = {
  fromRules: COMMANDER_CAREER_SOLO_MIGRATION.toRules,
  fromData: COMMANDER_CAREER_SOLO_MIGRATION.toData,
  fromDataHash: COMMANDER_CAREER_SOLO_MIGRATION.toDataHash,
  toRules: '1b5d17a2f208b4',
  toData: COMMANDER_CAREER_SOLO_MIGRATION.toData,
  toDataHash: COMMANDER_CAREER_SOLO_MIGRATION.toDataHash,
} as const;

/** Rules-only pair: espionage 1.5.0 prices each operation on its own (SPY-12). The
 *  catalogue and the saved world are unchanged; only fees paid from now on differ. */
export const SPY_PRICES_SOLO_MIGRATION = {
  fromRules: RECON_HALT_SOLO_MIGRATION.toRules,
  fromData: RECON_HALT_SOLO_MIGRATION.toData,
  fromDataHash: RECON_HALT_SOLO_MIGRATION.toDataHash,
  toRules: '18baac692899a2',
  toData: RECON_HALT_SOLO_MIGRATION.toData,
  toDataHash: RECON_HALT_SOLO_MIGRATION.toDataHash,
} as const;

/** Rules-only pair: construction 1.7.0 / espionage 1.6.0 add the queue sabotage
 *  (SPY-14). The catalogue and the saved world are unchanged. */
export const SPY_DELAY_SOLO_MIGRATION = {
  fromRules: SPY_PRICES_SOLO_MIGRATION.toRules,
  fromData: SPY_PRICES_SOLO_MIGRATION.toData,
  fromDataHash: SPY_PRICES_SOLO_MIGRATION.toDataHash,
  toRules: '082413a8db2fa1',
  toData: SPY_PRICES_SOLO_MIGRATION.toData,
  toDataHash: SPY_PRICES_SOLO_MIGRATION.toDataHash,
} as const;

/** Rules-only pair: espionage 1.7.0 makes recon accumulate layers on a posted agent
 *  (SPY-13). Windows already open in a save stay plain windows of the first layer. */
export const RECON_LAYERS_SOLO_MIGRATION = {
  fromRules: SPY_DELAY_SOLO_MIGRATION.toRules,
  fromData: SPY_DELAY_SOLO_MIGRATION.toData,
  fromDataHash: SPY_DELAY_SOLO_MIGRATION.toDataHash,
  toRules: '1b9e0236a92655',
  toData: SPY_DELAY_SOLO_MIGRATION.toData,
  toDataHash: SPY_DELAY_SOLO_MIGRATION.toDataHash,
} as const;

/** Rules-only pair: espionage 1.8.0 adds the economic sabotage (SPY-15). The catalogue
 *  and the saved world are unchanged. */
export const SPY_DISRUPT_SOLO_MIGRATION = {
  fromRules: RECON_LAYERS_SOLO_MIGRATION.toRules,
  fromData: RECON_LAYERS_SOLO_MIGRATION.toData,
  fromDataHash: RECON_LAYERS_SOLO_MIGRATION.toDataHash,
  toRules: '0d9d7ad0709aec',
  toData: RECON_LAYERS_SOLO_MIGRATION.toData,
  toDataHash: RECON_LAYERS_SOLO_MIGRATION.toDataHash,
} as const;

/** Rules-only pair: espionage 1.9.0 makes an exposed spy public news (SPY-16). The
 *  catalogue and the saved world are unchanged. */
export const SPY_EXPOSED_SOLO_MIGRATION = {
  fromRules: SPY_DISRUPT_SOLO_MIGRATION.toRules,
  fromData: SPY_DISRUPT_SOLO_MIGRATION.toData,
  fromDataHash: SPY_DISRUPT_SOLO_MIGRATION.toDataHash,
  toRules: '0782d8ad5af68e',
  toData: SPY_DISRUPT_SOLO_MIGRATION.toData,
  toDataHash: SPY_DISRUPT_SOLO_MIGRATION.toDataHash,
} as const;

/** Rules-only pair: espionage 1.10.0 caps agents per world and lets a wave add up
 *  (SPY-17). The catalogue and the saved world are unchanged. */
export const SPY_CREW_SOLO_MIGRATION = {
  fromRules: SPY_EXPOSED_SOLO_MIGRATION.toRules,
  fromData: SPY_EXPOSED_SOLO_MIGRATION.toData,
  fromDataHash: SPY_EXPOSED_SOLO_MIGRATION.toDataHash,
  toRules: '10f3fce9942023',
  toData: SPY_EXPOSED_SOLO_MIGRATION.toData,
  toDataHash: SPY_EXPOSED_SOLO_MIGRATION.toDataHash,
} as const;

/** Turned agents (SPY-18): catalogue 0.1.70 gives the counter-intelligence bureau's third
 *  level `spyTurnChance` 0.3 and espionage 1.11.0 turns the agent such a bureau kills.
 *  A saved world has no turned agents and no pending catch, so it reads as is. */
export const SPY_TURN_SOLO_MIGRATION = {
  fromRules: SPY_CREW_SOLO_MIGRATION.toRules,
  fromData: SPY_CREW_SOLO_MIGRATION.toData,
  fromDataHash: SPY_CREW_SOLO_MIGRATION.toDataHash,
  toRules: '0141cf0a3d8524',
  toData: '0.1.70',
  toDataHash: '0388c4d23f1e3f',
} as const;

/** Rules-only pair: combat 3.9.0 / movement 1.7.0 / fleet-ops 1.14.0 let a fleet mid-landing
 *  take a course, which cancels the landing with its troops still aboard (CMD-VIS-4). The
 *  catalogue is unchanged and a saved landing keeps its shape, so a saved world reads as is. */
export const LANDING_CANCEL_SOLO_MIGRATION = {
  fromRules: SPY_TURN_SOLO_MIGRATION.toRules,
  fromData: SPY_TURN_SOLO_MIGRATION.toData,
  fromDataHash: SPY_TURN_SOLO_MIGRATION.toDataHash,
  toRules: '0b1362eaffe70f',
  toData: SPY_TURN_SOLO_MIGRATION.toData,
  toDataHash: SPY_TURN_SOLO_MIGRATION.toDataHash,
} as const;

/** Slower aviation: catalogue 0.1.71 halves the flight speed of every shuttle (interceptor
 *  92 → 46, strikers 62 → 31 and 44 → 22, landing shuttle 54 → 27) and shrinks the patrol
 *  circle 90 → 60. Stats only, so a saved world reads as is: a leg already scheduled keeps
 *  its arrival, while a running chase and every leg started from now on fly at the new speed. */
export const SLOW_AVIATION_SOLO_MIGRATION = {
  fromRules: LANDING_CANCEL_SOLO_MIGRATION.toRules,
  fromData: LANDING_CANCEL_SOLO_MIGRATION.toData,
  fromDataHash: LANDING_CANCEL_SOLO_MIGRATION.toDataHash,
  toRules: '03dbbe112f1a35',
  toData: '0.1.71',
  toDataHash: '1bfa23d5e23583',
} as const;

/** Rules-only pair: technology 1.5.0 adds the research queue (RQ-1). A saved world has no
 *  `technologies.queue` and the field is optional, so it reads as is; the catalogue is
 *  unchanged. */
export const RESEARCH_QUEUE_SOLO_MIGRATION = {
  fromRules: SLOW_AVIATION_SOLO_MIGRATION.toRules,
  fromData: SLOW_AVIATION_SOLO_MIGRATION.toData,
  fromDataHash: SLOW_AVIATION_SOLO_MIGRATION.toDataHash,
  toRules: '112685af289f05',
  toData: SLOW_AVIATION_SOLO_MIGRATION.toData,
  toDataHash: SLOW_AVIATION_SOLO_MIGRATION.toDataHash,
} as const;

/** Rules-only pair: `fleet-repair` leaves the module graph (no metal top-up at a dock),
 *  combat 3.10.0 lets ground survivors keep their wounds and construction 1.8.0 merges a
 *  stack the hospital heals back into its whole kind (BAL-18). The catalogue is unchanged
 *  and the metal repair kept nothing in the world, so a saved world reads as is. */
export const HOSPITAL_WOUNDS_SOLO_MIGRATION = {
  fromRules: RESEARCH_QUEUE_SOLO_MIGRATION.toRules,
  fromData: RESEARCH_QUEUE_SOLO_MIGRATION.toData,
  fromDataHash: RESEARCH_QUEUE_SOLO_MIGRATION.toDataHash,
  toRules: '07155440325710',
  toData: RESEARCH_QUEUE_SOLO_MIGRATION.toData,
  toDataHash: RESEARCH_QUEUE_SOLO_MIGRATION.toDataHash,
} as const;

/** Rules-only pair: construction 1.9.0 gives every production building its own queue
 *  (BLD-2.1). A saved world keeps its shape: its one shared unit queue is split by the
 *  unit's building the next time one of those queues wakes, so it reads as is. */
export const PRODUCTION_LANES_SOLO_MIGRATION = {
  fromRules: HOSPITAL_WOUNDS_SOLO_MIGRATION.toRules,
  fromData: HOSPITAL_WOUNDS_SOLO_MIGRATION.toData,
  fromDataHash: HOSPITAL_WOUNDS_SOLO_MIGRATION.toDataHash,
  toRules: '03372b68cf3a45',
  toData: HOSPITAL_WOUNDS_SOLO_MIGRATION.toData,
  toDataHash: HOSPITAL_WOUNDS_SOLO_MIGRATION.toDataHash,
} as const;

/** Rules-only pair: army 1.2.0 lifts and lands wounded ground stacks too, carrying their
 *  wounds, loadout and merit along. The catalogue is unchanged and a saved world keeps its
 *  shape (a pending lift is the same claim), so it reads as is. */
export const WOUNDED_TRANSPORT_SOLO_MIGRATION = {
  fromRules: PRODUCTION_LANES_SOLO_MIGRATION.toRules,
  fromData: PRODUCTION_LANES_SOLO_MIGRATION.toData,
  fromDataHash: PRODUCTION_LANES_SOLO_MIGRATION.toDataHash,
  toRules: '0dc73742d3b68e',
  toData: PRODUCTION_LANES_SOLO_MIGRATION.toData,
  toDataHash: PRODUCTION_LANES_SOLO_MIGRATION.toDataHash,
} as const;

/** Rules-only pair: combat 3.11.0 and auto-rally 1.2.0 send a fleet that stands up at a
 *  world without arriving (a ship off the yard, a launched garrison, a split, a hero) into
 *  battle with the enemy already there. A saved world keeps its shape, so it reads as is. */
export const STAND_UP_SOLO_MIGRATION = {
  fromRules: WOUNDED_TRANSPORT_SOLO_MIGRATION.toRules,
  fromData: WOUNDED_TRANSPORT_SOLO_MIGRATION.toData,
  fromDataHash: WOUNDED_TRANSPORT_SOLO_MIGRATION.toDataHash,
  toRules: '001c2831afafba',
  toData: WOUNDED_TRANSPORT_SOLO_MIGRATION.toData,
  toDataHash: WOUNDED_TRANSPORT_SOLO_MIGRATION.toDataHash,
} as const;

/** Rules-only pair: orbital 1.6.0 lands bombardment as one volley per game hour on the
 *  fleet's own clock (`bombardNextAt`). A saved bombarding fleet has no clock yet and
 *  starts one at its first world step, so the world reads as is. */
export const BOMBARD_VOLLEY_SOLO_MIGRATION = {
  fromRules: STAND_UP_SOLO_MIGRATION.toRules,
  fromData: STAND_UP_SOLO_MIGRATION.toData,
  fromDataHash: STAND_UP_SOLO_MIGRATION.toDataHash,
  toRules: '062f4475b44061',
  toData: STAND_UP_SOLO_MIGRATION.toData,
  toDataHash: STAND_UP_SOLO_MIGRATION.toDataHash,
} as const;

/** Lighter ship modules: catalogue 0.1.72 halves the combat and defence numbers of nine
 *  modules (their base and every rarity line) and the side rarity lines of the radar, cargo,
 *  siege and mine modules; tractor beam, debris collector and repair tender fit only a hero's
 *  flagship. Stats and fitting rules only, so a saved world reads as is: a ship already built
 *  keeps its modules and simply reads the new numbers. */
export const HALF_MODULES_SOLO_MIGRATION = {
  fromRules: BOMBARD_VOLLEY_SOLO_MIGRATION.toRules,
  fromData: BOMBARD_VOLLEY_SOLO_MIGRATION.toData,
  fromDataHash: BOMBARD_VOLLEY_SOLO_MIGRATION.toDataHash,
  toRules: '0eb5ffa544097a',
  toData: '0.1.72',
  toDataHash: '17cb1050daa7a3',
} as const;

/** Separate player-built fortresses and manual repairs. Existing sites and paid
 *  work retain their legacy shape; new deployments use station_site. The old
 *  catalogue definitions remain, so migration only advances the audited pins. */
export const FORTRESS_MODEL_SOLO_MIGRATION = {
  fromRules: HALF_MODULES_SOLO_MIGRATION.toRules,
  fromData: HALF_MODULES_SOLO_MIGRATION.toData,
  fromDataHash: HALF_MODULES_SOLO_MIGRATION.toDataHash,
  toRules: '016783459c4258',
  toData: '0.1.73',
  toDataHash: '0b767cf7a4b647',
} as const;

/** Rules-only pair: army 1.3.0 lets a lift order say whether wounded or whole stacks board
 *  first (an optional `first` on the claim). A saved claim without it boards in garrison
 *  order as before, so a saved world reads as is. */
export const LOAD_FIRST_SOLO_MIGRATION = {
  fromRules: FORTRESS_MODEL_SOLO_MIGRATION.toRules,
  fromData: FORTRESS_MODEL_SOLO_MIGRATION.toData,
  fromDataHash: FORTRESS_MODEL_SOLO_MIGRATION.toDataHash,
  toRules: '1ce24e9a208610',
  toData: FORTRESS_MODEL_SOLO_MIGRATION.toData,
  toDataHash: FORTRESS_MODEL_SOLO_MIGRATION.toDataHash,
} as const;

/** Optional mobilization state and additive main-only research. Existing ships,
 *  accepted orders and campaign deployments survive; future main deployments use the timer. */
export const HERO_MOBILIZATION_SOLO_MIGRATION = {
  fromRules: LOAD_FIRST_SOLO_MIGRATION.toRules,
  fromData: LOAD_FIRST_SOLO_MIGRATION.toData,
  fromDataHash: LOAD_FIRST_SOLO_MIGRATION.toDataHash,
  toRules: '0876d80977cf6d',
  toData: '0.1.74',
  toDataHash: '023cd15f09ee90',
} as const;

/** Combat echelons and post-loss replies retain the save's state shape. Existing
 * hull/shield pools, orders, clocks and RNG survive; later volleys use the new rules. */
export const ECHELONS_SOLO_MIGRATION = {
  fromRules: HERO_MOBILIZATION_SOLO_MIGRATION.toRules,
  fromData: HERO_MOBILIZATION_SOLO_MIGRATION.toData,
  fromDataHash: HERO_MOBILIZATION_SOLO_MIGRATION.toDataHash,
  toRules: '08554ff861af98',
  toData: '0.1.75',
  toDataHash: '0afbb7f3739821',
} as const;

/** Optional snapshots pin paid orders and hero loadouts before the next arsenal sync.
 * Old snapshots remain readable; the existing lazy pinning preserves their values. */
export const MODULE_PROGRESSION_SOLO_MIGRATION = {
  fromRules: ECHELONS_SOLO_MIGRATION.toRules,
  fromData: ECHELONS_SOLO_MIGRATION.toData,
  fromDataHash: ECHELONS_SOLO_MIGRATION.toDataHash,
  toRules: '049dc3b8692491',
  toData: ECHELONS_SOLO_MIGRATION.toData,
  toDataHash: ECHELONS_SOLO_MIGRATION.toDataHash,
} as const;

/** Army 1.4.0 adds optional formation identities and claim sources. Older claims
 * retain their completion semantics and are pinned before a new explicit selection. */
export const ARMY_SELECTION_SOLO_MIGRATION = {
  fromRules: MODULE_PROGRESSION_SOLO_MIGRATION.toRules,
  fromData: MODULE_PROGRESSION_SOLO_MIGRATION.toData,
  fromDataHash: MODULE_PROGRESSION_SOLO_MIGRATION.toDataHash,
  toRules: '13fa26ace0540a',
  toData: MODULE_PROGRESSION_SOLO_MIGRATION.toData,
  toDataHash: MODULE_PROGRESSION_SOLO_MIGRATION.toDataHash,
} as const;

/** Capital modes apply to new worlds only. Existing saves keep their mode and the
 * absent building divisor (legacy 1); only the audited catalogue/rules pins change. */
export const CAPITAL_VICTORY_SOLO_MIGRATION = {
  fromRules: ARMY_SELECTION_SOLO_MIGRATION.toRules,
  fromData: ARMY_SELECTION_SOLO_MIGRATION.toData,
  fromDataHash: ARMY_SELECTION_SOLO_MIGRATION.toDataHash,
  toRules: '179935bf1c1e95',
  toData: '0.1.76',
  toDataHash: '10b0717c0fb8c5',
} as const;

/** Rules-only pair: espionage 1.13.0 makes a theft likelier and richer from a world developed
 *  against its own civilisation (SPY-21). The odds are drawn at resolution from the world as
 *  it stands, so a saved world, its agents and their pending missions read as is. */
export const SPY_DEVELOPMENT_SOLO_MIGRATION = {
  fromRules: CAPITAL_VICTORY_SOLO_MIGRATION.toRules,
  fromData: CAPITAL_VICTORY_SOLO_MIGRATION.toData,
  fromDataHash: CAPITAL_VICTORY_SOLO_MIGRATION.toDataHash,
  toRules: '02b82a3f466aab',
  toData: CAPITAL_VICTORY_SOLO_MIGRATION.toData,
  toDataHash: CAPITAL_VICTORY_SOLO_MIGRATION.toDataHash,
} as const;

/** Catalogue pair: the intercept turret (SM-4.2) is a new weapon module for the interceptor.
 *  No saved ship carries it, so a save of the previous release reads as is. */
export const INTERCEPT_TURRET_SOLO_MIGRATION = {
  fromRules: SPY_DEVELOPMENT_SOLO_MIGRATION.toRules,
  fromData: SPY_DEVELOPMENT_SOLO_MIGRATION.toData,
  fromDataHash: SPY_DEVELOPMENT_SOLO_MIGRATION.toDataHash,
  toRules: '0238007e6ef542',
  toData: '0.1.77',
  toDataHash: '032a24eea7e673',
} as const;

/** Catalogue + rules pair: the cloak field (SM-4.3) is a new legendary module for the hero
 *  flagship, and the kernel gains the `cloak-field` module that marks when a cloaked fleet
 *  gives itself away (`Fleet.cloakBrokenUntil`). No saved ship carries the field, and the mark
 *  is optional, so a save of the previous release reads as is. */
export const CLOAK_FIELD_SOLO_MIGRATION = {
  fromRules: INTERCEPT_TURRET_SOLO_MIGRATION.toRules,
  fromData: INTERCEPT_TURRET_SOLO_MIGRATION.toData,
  fromDataHash: INTERCEPT_TURRET_SOLO_MIGRATION.toDataHash,
  toRules: '1714d25eaa57a3',
  toData: '0.1.78',
  toDataHash: '0f9abfa796f0e3',
} as const;

/** Catalogue pair: a gentler star ladder (SM-4.4) — two sure stars instead of three, and a
 *  star multiplies a module's contribution by ×1.05…×1.6 instead of ×1.1…×2.5. A saved ship
 *  keeps its stars; only what they are worth is read from the new catalogue. */
export const STAR_LADDER_SOLO_MIGRATION = {
  fromRules: CLOAK_FIELD_SOLO_MIGRATION.toRules,
  fromData: CLOAK_FIELD_SOLO_MIGRATION.toData,
  fromDataHash: CLOAK_FIELD_SOLO_MIGRATION.toDataHash,
  toRules: '173486d5cc6c30',
  toData: '0.1.79',
  toDataHash: '1c1df8bf2931ed',
} as const;

/** Rules-only patch: combat 4.0.1 preserves continuing attackers' reload clocks and
 * explicit attack overrides. Pending events and saved battles retain their exact state. */
export const COMBAT_CONTINUITY_SOLO_MIGRATION = {
  fromRules: STAR_LADDER_SOLO_MIGRATION.toRules,
  fromData: STAR_LADDER_SOLO_MIGRATION.toData,
  fromDataHash: STAR_LADDER_SOLO_MIGRATION.toDataHash,
  toRules: '1fb69c7580fdd9',
  toData: STAR_LADDER_SOLO_MIGRATION.toData,
  toDataHash: STAR_LADDER_SOLO_MIGRATION.toDataHash,
} as const;

/** Rules-only pair: espionage 1.14.0 no longer declares war when a spy is exposed (owner's
 *  resolution 2026-11-04). A war an exposure already declared stays a war like any other,
 *  so a saved world reads as is. */
export const SPY_NO_WAR_SOLO_MIGRATION = {
  fromRules: COMBAT_CONTINUITY_SOLO_MIGRATION.toRules,
  fromData: COMBAT_CONTINUITY_SOLO_MIGRATION.toData,
  fromDataHash: COMBAT_CONTINUITY_SOLO_MIGRATION.toDataHash,
  toRules: '193ffd52a9ecab',
  toData: COMBAT_CONTINUITY_SOLO_MIGRATION.toData,
  toDataHash: COMBAT_CONTINUITY_SOLO_MIGRATION.toDataHash,
} as const;

/** Rules-only pair: `sprawl` leaves the module graph and `control` 1.0.0 takes its place
 *  (BAL-19) — the five planets nearest the capital work in full, the rest yield half and
 *  build no units; construction 1.13.0 names the order's world to its requirement hook. The
 *  rule is computed from the world as it stands and keeps nothing in it, and the catalogue is
 *  unchanged, so a saved world reads as is. */
export const CONTROL_LIMIT_SOLO_MIGRATION = {
  fromRules: SPY_NO_WAR_SOLO_MIGRATION.toRules,
  fromData: SPY_NO_WAR_SOLO_MIGRATION.toData,
  fromDataHash: SPY_NO_WAR_SOLO_MIGRATION.toDataHash,
  toRules: '1afd3d6ad0215b',
  toData: SPY_NO_WAR_SOLO_MIGRATION.toData,
  toDataHash: SPY_NO_WAR_SOLO_MIGRATION.toDataHash,
} as const;

/** Rules-only pair: `control` 1.1.0 announces `control.changed` when a new capital or a
 *  captured planet moves control, `construction` 1.14.0 parks a running unit whose world left
 *  control and re-asks the requirement on resume, and `hero` 4.11.0 hands a closing corridor's
 *  edge to a corridor still on it (BAL-19). Nothing new is stored, and the catalogue is
 *  unchanged, so a saved world reads as is. */
export const CONTROL_RECHECK_SOLO_MIGRATION = {
  fromRules: CONTROL_LIMIT_SOLO_MIGRATION.toRules,
  fromData: CONTROL_LIMIT_SOLO_MIGRATION.toData,
  fromDataHash: CONTROL_LIMIT_SOLO_MIGRATION.toDataHash,
  toRules: '1973d52fbb435c',
  toData: CONTROL_LIMIT_SOLO_MIGRATION.toData,
  toDataHash: CONTROL_LIMIT_SOLO_MIGRATION.toDataHash,
} as const;

/** Rules-only pair: the new `integration` module (BAL-19) makes a planet taken from another
 *  side integrate for 3 game days, and `economy` 1.2.0 names the span it settles to its
 *  production hook. A saved world has no integrating planet, and the catalogue is unchanged,
 *  so it reads as is. */
export const INTEGRATION_SOLO_MIGRATION = {
  fromRules: CONTROL_RECHECK_SOLO_MIGRATION.toRules,
  fromData: CONTROL_RECHECK_SOLO_MIGRATION.toData,
  fromDataHash: CONTROL_RECHECK_SOLO_MIGRATION.toDataHash,
  toRules: '04f2a4ed5816e2',
  toData: CONTROL_RECHECK_SOLO_MIGRATION.toData,
  toDataHash: CONTROL_RECHECK_SOLO_MIGRATION.toDataHash,
} as const;

/** Rules-only pair: `economy` 1.3.0 settles a construction past its 50% mark by Simpson's
 *  rule, so a share that changes with time (integration, BAL-19) multiplies it exactly. Nothing
 *  new is stored, and the catalogue is unchanged, so a saved world reads as is. */
export const RAMP_SETTLEMENT_SOLO_MIGRATION = {
  fromRules: INTEGRATION_SOLO_MIGRATION.toRules,
  fromData: INTEGRATION_SOLO_MIGRATION.toData,
  fromDataHash: INTEGRATION_SOLO_MIGRATION.toDataHash,
  toRules: '1d3e18bfd60ee1',
  toData: INTEGRATION_SOLO_MIGRATION.toData,
  toDataHash: INTEGRATION_SOLO_MIGRATION.toDataHash,
} as const;

/** Catalogue + rules pair: three command nodes of the main game (BAL-19) raise the control limit
 *  5 → 6 → 8 → 10, and `technology` 1.6.0 adds their `controlLimit` through the `control.limit`
 *  hook. No saved player has researched them, and nothing new is stored, so a save of the
 *  previous release reads as is. */
export const CONTROL_TECH_SOLO_MIGRATION = {
  fromRules: RAMP_SETTLEMENT_SOLO_MIGRATION.toRules,
  fromData: RAMP_SETTLEMENT_SOLO_MIGRATION.toData,
  fromDataHash: RAMP_SETTLEMENT_SOLO_MIGRATION.toDataHash,
  toRules: '1cbc175afb6980',
  toData: '0.1.80',
  toDataHash: '075726b65dbf6c',
} as const;

/** Catalogue + rules pair: the viceroy (BAL-19), a branchless scientist whose own line of three
 *  main-game nodes raises the control limit 10 → 12 → 14 → 16 at +10% army upkeep each.
 *  `economy` 1.4.0 multiplies unit upkeep through the `economy.unitUpkeep` hook, `technology`
 *  1.7.0 adds `armyUpkeep` to it and knows a scientist by id in `has_scientist`. No saved
 *  council holds the viceroy, and nothing new is stored, so a save of the previous release
 *  reads as is. */
export const VICEROY_SOLO_MIGRATION = {
  fromRules: CONTROL_TECH_SOLO_MIGRATION.toRules,
  fromData: CONTROL_TECH_SOLO_MIGRATION.toData,
  fromDataHash: CONTROL_TECH_SOLO_MIGRATION.toDataHash,
  toRules: '0294e673859e48',
  toData: '0.1.81',
  toDataHash: '086a8a70acb1f4',
} as const;

/** Research catalogue prices ×10. Keep the world, treasury, host price multipliers,
 *  already-paid research and its completion time; new starts use the new catalogue. */
export const TECHNOLOGY_PRICES_SOLO_MIGRATION = {
  fromRules: VICEROY_SOLO_MIGRATION.toRules,
  fromData: VICEROY_SOLO_MIGRATION.toData,
  fromDataHash: VICEROY_SOLO_MIGRATION.toDataHash,
  toRules: '0a6f76b86a4d0a',
  toData: '0.1.82',
  toDataHash: '0f70af91e21327',
} as const;

/** Rules-only patch: fleet-ops 1.14.1 and auto-merge 1.0.1 preserve enabled
 * bombardment/auto-assault on fusion. Saved fleets, cargo and clocks retain their
 * shape; only future merges use the new inheritance rule. */
export const FLEET_MERGE_ORDERS_SOLO_MIGRATION = {
  fromRules: TECHNOLOGY_PRICES_SOLO_MIGRATION.toRules,
  fromData: TECHNOLOGY_PRICES_SOLO_MIGRATION.toData,
  fromDataHash: TECHNOLOGY_PRICES_SOLO_MIGRATION.toDataHash,
  toRules: '08565a49533ff1',
  toData: TECHNOLOGY_PRICES_SOLO_MIGRATION.toData,
  toDataHash: TECHNOLOGY_PRICES_SOLO_MIGRATION.toDataHash,
} as const;

/** The audited pairs, oldest first; each starts where the one before it ends, so a save
 *  of any listed release reaches a later one pair by pair. Nothing else is migrated. */
export const SOLO_MIGRATIONS: readonly SoloMigration[] = [
  MINING_SOLO_MIGRATION,
  CORP_FORMATS_SOLO_MIGRATION,
  COMMANDER_CAREER_SOLO_MIGRATION,
  RECON_HALT_SOLO_MIGRATION,
  SPY_PRICES_SOLO_MIGRATION,
  SPY_DELAY_SOLO_MIGRATION,
  RECON_LAYERS_SOLO_MIGRATION,
  SPY_DISRUPT_SOLO_MIGRATION,
  SPY_EXPOSED_SOLO_MIGRATION,
  SPY_CREW_SOLO_MIGRATION,
  SPY_TURN_SOLO_MIGRATION,
  LANDING_CANCEL_SOLO_MIGRATION,
  SLOW_AVIATION_SOLO_MIGRATION,
  RESEARCH_QUEUE_SOLO_MIGRATION,
  HOSPITAL_WOUNDS_SOLO_MIGRATION,
  PRODUCTION_LANES_SOLO_MIGRATION,
  WOUNDED_TRANSPORT_SOLO_MIGRATION,
  STAND_UP_SOLO_MIGRATION,
  BOMBARD_VOLLEY_SOLO_MIGRATION,
  HALF_MODULES_SOLO_MIGRATION,
  FORTRESS_MODEL_SOLO_MIGRATION,
  LOAD_FIRST_SOLO_MIGRATION,
  HERO_MOBILIZATION_SOLO_MIGRATION,
  ECHELONS_SOLO_MIGRATION,
  MODULE_PROGRESSION_SOLO_MIGRATION,
  ARMY_SELECTION_SOLO_MIGRATION,
  CAPITAL_VICTORY_SOLO_MIGRATION,
  SPY_DEVELOPMENT_SOLO_MIGRATION,
  INTERCEPT_TURRET_SOLO_MIGRATION,
  CLOAK_FIELD_SOLO_MIGRATION,
  STAR_LADDER_SOLO_MIGRATION,
  COMBAT_CONTINUITY_SOLO_MIGRATION,
  SPY_NO_WAR_SOLO_MIGRATION,
  CONTROL_LIMIT_SOLO_MIGRATION,
  CONTROL_RECHECK_SOLO_MIGRATION,
  INTEGRATION_SOLO_MIGRATION,
  RAMP_SETTLEMENT_SOLO_MIGRATION,
  CONTROL_TECH_SOLO_MIGRATION,
  VICEROY_SOLO_MIGRATION,
  TECHNOLOGY_PRICES_SOLO_MIGRATION,
  FLEET_MERGE_ORDERS_SOLO_MIGRATION,
];

/** Read current saves strictly, or migrate an audited predecessor without
 *  modifying its world, costs, accepted orders, clock, RNG, or saved host policies.
 *  Unknown releases and corrupted envelopes still fail closed. Reading does not
 *  overwrite storage; the ordinary successful save writes the upgraded envelope. */
export function parseCompatibleSoloSave(raw: string | null, rules: string): SoloSave | null {
  const current = parseSoloSave(raw, rules);
  if (current) return current;
  const end = SOLO_MIGRATIONS.findIndex((migration) => migration.toRules === rules);
  for (let start = 0; start <= end; start++) {
    const previous = parseSoloSave(raw, SOLO_MIGRATIONS[start]!.fromRules);
    if (!previous) continue;
    let save: SoloSave | null = previous;
    for (const migration of SOLO_MIGRATIONS.slice(start, end + 1))
      save = save && migrateVersion(save, migration);
    return save;
  }
  return null;
}

/** One pair: the save's own pins must name the pair's predecessor, and only they change. */
function migrateVersion(previous: SoloSave, migration: SoloMigration): SoloSave | null {
  const version = previous.state.version;
  // The generated maps use the unpinned prototype version even though
  // their outer save envelope pins the complete catalogue and module graph.
  const generated =
    ['nexus', 'frontier-50', 'frontier-100'].includes(previous.state.mapId ?? '') &&
    version.data === '0.1.0';
  if (
    version.manifest !== '1' ||
    (!generated && version.data !== migration.fromData) ||
    (version.dataHash !== undefined && version.dataHash !== migration.fromDataHash)
  )
    return null;
  return {
    ...previous,
    state: {
      ...previous.state,
      version: { ...version, data: migration.toData, dataHash: migration.toDataHash },
    },
  };
}
