import { parseSoloSave, type SoloSave } from './soloSave';
import { SOLO_MIGRATIONS } from './soloSaveMigrationPairs';

export * from './soloSaveMigrationPairs';

/** One audited pair of releases: a save written under `fromRules` reads under `toRules`. */
export interface SoloMigration {
  readonly fromRules: string;
  readonly fromData: string;
  readonly fromDataHash: string;
  readonly toRules: string;
  readonly toData: string;
  readonly toDataHash: string;
}

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
