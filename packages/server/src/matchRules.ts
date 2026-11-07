import { hashGameDataBundle, type GameData, type GameVersion } from '@void/shared-core';
import type { MatchSnapshot, MatchStore } from './store/types';

/** Rules used by the unversioned production host at main@85f8f222. Never move this
 * baseline forward: an unmigrated match cannot silently adopt a future ruleset. */
export const LEGACY_MATCH_RULES: Readonly<Required<GameVersion>> = Object.freeze({
  data: '0.1.82',
  manifest: '104',
  dataHash: '0f70af91e21327',
});

export function matchRules(data: GameData, manifest: string): Required<GameVersion> {
  return { data: data.version, manifest, dataHash: hashGameDataBundle(data) };
}

export class MatchRulesMismatch extends Error {
  constructor(
    readonly matchId: string,
    readonly reason: 'data' | 'manifest' | 'dataHash',
  ) {
    super('E_MATCH_RULES_MISMATCH');
  }
}

/** Check before creating a room, loading receipts or advancing its clock. A legacy
 * pin is committed first, preserving all other snapshot fields and sequence. */
export async function loadCompatibleSnapshot(
  store: MatchStore,
  matchId: string,
  expected: Required<GameVersion>,
): Promise<MatchSnapshot | null> {
  const snapshot = await store.load(matchId);
  if (!snapshot) return null;
  const version = snapshot.state.version;
  const atLegacyBaseline =
    expected.data === LEGACY_MATCH_RULES.data &&
    expected.manifest === LEGACY_MATCH_RULES.manifest &&
    expected.dataHash === LEGACY_MATCH_RULES.dataHash;
  const legacyPrototype = version?.data === '0.1.0' && version.manifest === '1';
  const legacyCanonical = version?.data === expected.data && version.manifest === expected.manifest;
  // Authored maps (ordinary and AvA) already pinned data, but the old host passed
  // manifest "1". Accept that exact old shape only with the baseline's real hash.
  const legacyMap =
    version?.data === LEGACY_MATCH_RULES.data &&
    version.manifest === '1' &&
    version.dataHash === LEGACY_MATCH_RULES.dataHash;
  const unpinnedLegacy = version?.dataHash === undefined && (legacyPrototype || legacyCanonical);
  if (
    atLegacyBaseline &&
    version &&
    snapshot.dataVersion === version.data &&
    (legacyMap || unpinnedLegacy)
  ) {
    const pinned = {
      ...snapshot,
      dataVersion: expected.data,
      state: { ...snapshot.state, version: { ...expected } },
    };
    await store.save(pinned);
    return pinned;
  }
  for (const key of ['manifest', 'data', 'dataHash'] as const) {
    if (version?.[key] !== expected[key]) throw new MatchRulesMismatch(matchId, key);
  }
  if (snapshot.dataVersion !== expected.data) throw new MatchRulesMismatch(matchId, 'data');
  return snapshot;
}

/** Only incompatible rules are isolated. Storage/programming errors still surface;
 * returning null here must never be interpreted as permission to seed a new match. */
export async function skipIncompatibleMatch<T>(
  resume: () => Promise<T>,
  onFailure?: (matchId: string) => void,
): Promise<T | null> {
  try {
    return await resume();
  } catch (error) {
    if (!(error instanceof MatchRulesMismatch)) throw error;
    onFailure?.(error.matchId);
    process.stderr.write(
      `match ${error.matchId}: ${error.message} (${error.reason}); snapshot retained, resume refused.\n`,
    );
    return null;
  }
}
