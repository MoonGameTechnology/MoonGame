import { parseSoloSave, type SoloSave } from './soloSave';
import {
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
  FORTRESS_PRICE_SOLO_MIGRATION,
  LONG_RANGE_OPTICS_SOLO_MIGRATION,
  PRODUCTION_WORKBENCH_SOLO_MIGRATION,
  BUILD_PRODUCTION_TIMES_SOLO_MIGRATION,
  PACE_RELIEF_SOLO_MIGRATION,
  FLEET_CLOCKS_SOLO_MIGRATION,
  MISSILES_SOLO_MIGRATION,
  ANNIHILATE_PEACE_SOLO_MIGRATION,
  PAUSED_SLOTS_SOLO_MIGRATION,
  PAUSED_UPKEEP_SOLO_MIGRATION,
  ACCRETION_DISK_SOLO_MIGRATION,
  SPY_TRAVEL_SOLO_MIGRATION,
  SPY_LEVELS_SOLO_MIGRATION,
  SPY_SALARY_SOLO_MIGRATION,
  SPY_FOG_SOLO_MIGRATION,
  FORCED_MARCH_PACE_SOLO_MIGRATION,
  BROOD_HOLD_SOLO_MIGRATION,
  SCHEDULE_ORDER_SOLO_MIGRATION,
  RALLY_ANY_WORLD_SOLO_MIGRATION,
  SPY_DEFECTOR_SOLO_MIGRATION,
  CAPTIVE_CARRIER_SOLO_MIGRATION,
  SQUADRON_REFUEL_SOLO_MIGRATION,
  ORBITAL_TIME_ORDER_SOLO_MIGRATION,
  PATROL_DIVE_SOLO_MIGRATION,
} from './soloSaveMigrationArchive';

/** The older pairs live in the archive; their names stay importable from here. */
export * from './soloSaveMigrationArchive';

/** One audited pair of releases: a save written under `fromRules` reads under `toRules`. */
export interface SoloMigration {
  readonly fromRules: string;
  readonly fromData: string;
  readonly fromDataHash: string;
  readonly toRules: string;
  readonly toData: string;
  readonly toDataHash: string;
}

/** Data 0.1.88: a new province kind, the star, and its six classes (owner 2026-11-17: a
 *  star stands in its own province with a ring its class makes). A saved world keeps its map
 *  and provinces: stars only appear in new matches. */
export const STAR_PROVINCE_SOLO_MIGRATION = {
  fromRules: PATROL_DIVE_SOLO_MIGRATION.toRules,
  fromData: PATROL_DIVE_SOLO_MIGRATION.toData,
  fromDataHash: PATROL_DIVE_SOLO_MIGRATION.toDataHash,
  toRules: '092a2fe87e2178',
  toData: '0.1.88',
  toDataHash: '1dc3f007dd5f9e',
} as const;

/** Rules-only pair: combat 4.1.0 — what a volley leaves unspent on a fallen side goes to the
 *  shooter's living enemies, and a fleet keeps what found no target as a charge for five game
 *  minutes (`Fleet.overcharge`, MSB-10). The catalogue is unchanged; a saved world has no
 *  charge and reads as is. */
export const VOLLEY_OVERFLOW_SOLO_MIGRATION = {
  fromRules: STAR_PROVINCE_SOLO_MIGRATION.toRules,
  fromData: STAR_PROVINCE_SOLO_MIGRATION.toData,
  fromDataHash: STAR_PROVINCE_SOLO_MIGRATION.toDataHash,
  toRules: '1bea1871c0f6b4',
  toData: STAR_PROVINCE_SOLO_MIGRATION.toData,
  toDataHash: STAR_PROVINCE_SOLO_MIGRATION.toDataHash,
} as const;

/** Rules-only pair: combat 4.2.0 — one battle line per power: N in `min(1, L/N)` counts every
 *  living unit the owner has in the battle, not one fleet's (MSB-11). The catalogue and the
 *  saved shape are unchanged. */
export const LINE_PER_POWER_SOLO_MIGRATION = {
  fromRules: VOLLEY_OVERFLOW_SOLO_MIGRATION.toRules,
  fromData: VOLLEY_OVERFLOW_SOLO_MIGRATION.toData,
  fromDataHash: VOLLEY_OVERFLOW_SOLO_MIGRATION.toDataHash,
  toRules: '0ed98354e9290d',
  toData: VOLLEY_OVERFLOW_SOLO_MIGRATION.toData,
  toDataHash: VOLLEY_OVERFLOW_SOLO_MIGRATION.toDataHash,
} as const;

/** Rules-only pair: economy 1.6.0 — a power falls into arrears at the instant its treasury
 *  runs dry, not at the end of the advanced span, so one long span equals many short ones
 *  (PE-2.2). The catalogue and the saved shape are unchanged. */
export const ARREARS_INSTANT_SOLO_MIGRATION = {
  fromRules: LINE_PER_POWER_SOLO_MIGRATION.toRules,
  fromData: LINE_PER_POWER_SOLO_MIGRATION.toData,
  fromDataHash: LINE_PER_POWER_SOLO_MIGRATION.toDataHash,
  toRules: '126c8ad2a73c74',
  toData: LINE_PER_POWER_SOLO_MIGRATION.toData,
  toDataHash: LINE_PER_POWER_SOLO_MIGRATION.toDataHash,
} as const;

/** Rules-only pair: visibility 2.7.0 — fog memory of a fleet is taken at the instant it leaves
 *  sight and a province survey is stamped at the instant the border is crossed, not at the end
 *  of the advanced span. The catalogue and the saved shape are unchanged. */
export const FOG_INSTANT_SOLO_MIGRATION = {
  fromRules: ARREARS_INSTANT_SOLO_MIGRATION.toRules,
  fromData: ARREARS_INSTANT_SOLO_MIGRATION.toData,
  fromDataHash: ARREARS_INSTANT_SOLO_MIGRATION.toDataHash,
  toRules: '1bc313c4745206',
  toData: ARREARS_INSTANT_SOLO_MIGRATION.toData,
  toDataHash: ARREARS_INSTANT_SOLO_MIGRATION.toDataHash,
} as const;

/** Rules-only pair: bot-diplomacy 0.3.0 — favour thresholds allow 1e-9 of float dust, and a
 *  bot that a caught spy sinks under the war line declares war at once, checked again at a
 *  span's start before healing. How time is cut no longer decides it (PE-2.2). */
export const BOT_FAVOUR_LINE_SOLO_MIGRATION = {
  fromRules: FOG_INSTANT_SOLO_MIGRATION.toRules,
  fromData: FOG_INSTANT_SOLO_MIGRATION.toData,
  fromDataHash: FOG_INSTANT_SOLO_MIGRATION.toDataHash,
  toRules: '1b05ec284f4729',
  toData: FOG_INSTANT_SOLO_MIGRATION.toData,
  toDataHash: FOG_INSTANT_SOLO_MIGRATION.toDataHash,
} as const;

/** Rules-only pair: orbital 1.9.0 — every flak and bombardment volley is a world step of
 *  its own (`time.stop` → `time.stopped`), landing after the span before it has been
 *  accrued, repairs included. The catalogue and the saved shape are unchanged. */
export const VOLLEY_STEP_SOLO_MIGRATION = {
  fromRules: BOT_FAVOUR_LINE_SOLO_MIGRATION.toRules,
  fromData: BOT_FAVOUR_LINE_SOLO_MIGRATION.toData,
  fromDataHash: BOT_FAVOUR_LINE_SOLO_MIGRATION.toDataHash,
  toRules: '0884e1e2622619',
  toData: BOT_FAVOUR_LINE_SOLO_MIGRATION.toData,
  toDataHash: BOT_FAVOUR_LINE_SOLO_MIGRATION.toDataHash,
} as const;

/** Data 0.1.89 + shuttle 2.3.0, missiles 1.1.0: the closed sky (owner 2026-11-19). A province
 *  kind with `overflight: false` — the star, the black hole, the accretion disk — closes the
 *  sky above it: no strike, patrol, ferry or missile flies over it (`E_SKY_CLOSED`). The saved
 *  shape is unchanged; a flight already in the air flies on, only new orders are checked. */
export const CLOSED_SKY_SOLO_MIGRATION = {
  fromRules: VOLLEY_STEP_SOLO_MIGRATION.toRules,
  fromData: VOLLEY_STEP_SOLO_MIGRATION.toData,
  fromDataHash: VOLLEY_STEP_SOLO_MIGRATION.toDataHash,
  toRules: '0d4a851dd60b88',
  toData: '0.1.89',
  toDataHash: '0c94b5782dc447',
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
  FORTRESS_PRICE_SOLO_MIGRATION,
  LONG_RANGE_OPTICS_SOLO_MIGRATION,
  PRODUCTION_WORKBENCH_SOLO_MIGRATION,
  BUILD_PRODUCTION_TIMES_SOLO_MIGRATION,
  PACE_RELIEF_SOLO_MIGRATION,
  FLEET_CLOCKS_SOLO_MIGRATION,
  MISSILES_SOLO_MIGRATION,
  ANNIHILATE_PEACE_SOLO_MIGRATION,
  PAUSED_SLOTS_SOLO_MIGRATION,
  PAUSED_UPKEEP_SOLO_MIGRATION,
  ACCRETION_DISK_SOLO_MIGRATION,
  SPY_TRAVEL_SOLO_MIGRATION,
  SPY_LEVELS_SOLO_MIGRATION,
  SPY_SALARY_SOLO_MIGRATION,
  SPY_FOG_SOLO_MIGRATION,
  FORCED_MARCH_PACE_SOLO_MIGRATION,
  BROOD_HOLD_SOLO_MIGRATION,
  SCHEDULE_ORDER_SOLO_MIGRATION,
  RALLY_ANY_WORLD_SOLO_MIGRATION,
  SPY_DEFECTOR_SOLO_MIGRATION,
  CAPTIVE_CARRIER_SOLO_MIGRATION,
  SQUADRON_REFUEL_SOLO_MIGRATION,
  ORBITAL_TIME_ORDER_SOLO_MIGRATION,
  PATROL_DIVE_SOLO_MIGRATION,
  STAR_PROVINCE_SOLO_MIGRATION,
  VOLLEY_OVERFLOW_SOLO_MIGRATION,
  LINE_PER_POWER_SOLO_MIGRATION,
  ARREARS_INSTANT_SOLO_MIGRATION,
  FOG_INSTANT_SOLO_MIGRATION,
  BOT_FAVOUR_LINE_SOLO_MIGRATION,
  VOLLEY_STEP_SOLO_MIGRATION,
  CLOSED_SKY_SOLO_MIGRATION,
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
