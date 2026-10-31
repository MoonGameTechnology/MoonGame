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
