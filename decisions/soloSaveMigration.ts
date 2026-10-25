import { parseSoloSave, type SoloSave } from './soloSave';

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

/** Read current saves strictly, or migrate this one audited predecessor without
 *  modifying its world, costs, accepted orders, clock, RNG, or saved host policies.
 *  Unknown releases and corrupted envelopes still fail closed. Reading does not
 *  overwrite storage; the ordinary successful save writes the upgraded envelope. */
export function parseCompatibleSoloSave(raw: string | null, rules: string): SoloSave | null {
  const current = parseSoloSave(raw, rules);
  if (current) return current;
  const migration = MINING_SOLO_MIGRATION;
  if (rules !== migration.toRules) return null;
  const previous = parseSoloSave(raw, migration.fromRules);
  if (!previous) return null;
  const version = previous.state.version;
  // The old generated maps used the unpinned prototype version even though
  // its outer save envelope pinned the complete 0.1.66 catalogue and module graph.
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
