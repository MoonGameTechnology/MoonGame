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

/** The audited pairs, oldest first; each starts where the one before it ends, so a save
 *  of any listed release reaches a later one pair by pair. Nothing else is migrated. */
export const SOLO_MIGRATIONS: readonly SoloMigration[] = [
  MINING_SOLO_MIGRATION,
  CORP_FORMATS_SOLO_MIGRATION,
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
