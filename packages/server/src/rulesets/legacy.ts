import type { GameVersion, MatchConfig } from '@void/shared-core';
import type { MatchSnapshot } from '../store/types';
import { canonical } from './canonical';
import type { MatchRulesets } from './service';
import { RulesetError } from './types';

/** Operator attestation from deployment history + the actual launch source.
 * No public API accepts this document, and a data-version match alone is insufficient. */
export interface LegacyRulesWitness {
  matchId: string;
  createdAt: number;
  source: string;
  deployedAt: number;
  nextDeployedAt: number;
  version: GameVersion;
  nativeManifest: string;
  config: MatchConfig;
}

export async function planLegacyBinding(rules: MatchRulesets, snapshot: MatchSnapshot, id: string,
  witness: LegacyRulesWitness): Promise<MatchSnapshot> {
  const runtime = await rules.registry.get(id);
  const { descriptor } = runtime;
  const createdAt = snapshot.createdAt;
  if (!/^[a-f0-9]{40}$/.test(witness.source) || snapshot.ruleset || snapshot.matchId !== witness.matchId || createdAt === undefined ||
      createdAt !== witness.createdAt || !Number.isSafeInteger(witness.deployedAt) ||
      !Number.isSafeInteger(witness.nextDeployedAt) || witness.deployedAt > createdAt ||
      witness.nextDeployedAt <= createdAt || descriptor.source !== witness.source ||
      descriptor.manifest !== witness.nativeManifest || canonical(snapshot.state.version) !== canonical(witness.version) ||
      snapshot.dataVersion !== snapshot.state.version.data || descriptor.data.version !== snapshot.state.version.data ||
      descriptor.data.hash !== snapshot.state.version.dataHash ||
      canonical(runtime.configFor(snapshot.state)) !== canonical(witness.config))
    throw new RulesetError('E_RULESET_PIN_CONFLICT');
  const ruleset = rules.registry.bind(snapshot.matchId, runtime, witness.config, {
    version: snapshot.state.version, source: witness.source,
    deployedAt: witness.deployedAt, nextDeployedAt: witness.nextDeployedAt,
  });
  // Only the engine identity becomes explicit. World, sequence, pricing, clock and
  // original data version/hash remain byte-for-byte identical.
  return { ...snapshot, ruleset, state: { ...snapshot.state, version: { ...ruleset.version } } };
}
