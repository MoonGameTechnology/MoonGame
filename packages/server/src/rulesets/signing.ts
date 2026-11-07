import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import type { MatchConfig } from '@void/shared-core';
import { canonical, jsonClone } from './canonical';
import { RulesetError, type LegacyRulesOrigin, type MatchRulesetBinding, type RulesetArtifact, type RulesetDescriptor } from './types';

export const RULESET_ID = /^[a-f0-9]{64}$/;
export const MAX_RULESET_BYTES = 16 * 1024 * 1024;
export const bundleId = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

/** A DB-only compromise must not turn stored rule capsules into executable code. */
export class RulesetSigner {
  private readonly key: Buffer;
  constructor(key: Uint8Array) {
    if (key.length !== 32) throw new RulesetError('E_RULESET_KEY');
    this.key = Buffer.from(key);
  }
  private sign(scope: string, value: unknown): string {
    return createHmac('sha256', this.key).update(`void-${scope}:v1\0`).update(canonical(value)).digest('hex');
  }
  private same(actual: string, expected: string): boolean {
    return RULESET_ID.test(actual) && timingSafeEqual(Buffer.from(actual, 'hex'), Buffer.from(expected, 'hex'));
  }
  artifact(descriptor: RulesetDescriptor, bundle: Uint8Array): RulesetArtifact {
    if (!bundle.length || bundle.length > MAX_RULESET_BYTES || descriptor.id !== bundleId(bundle))
      throw new RulesetError('E_RULESET_INTEGRITY');
    return { descriptor: jsonClone(descriptor), bundle: Buffer.from(bundle),
      signature: this.sign('ruleset-artifact', descriptor) };
  }
  verifyArtifact(record: RulesetArtifact): void {
    try {
      if (!RULESET_ID.test(record.descriptor.id) || !record.bundle.length || record.bundle.length > MAX_RULESET_BYTES ||
          bundleId(record.bundle) !== record.descriptor.id ||
          !this.same(record.signature, this.sign('ruleset-artifact', record.descriptor)))
        throw new RulesetError('E_RULESET_INTEGRITY');
    } catch { throw new RulesetError('E_RULESET_INTEGRITY'); }
  }
  binding(matchId: string, descriptor: RulesetDescriptor, config: MatchConfig, origin?: LegacyRulesOrigin): MatchRulesetBinding {
    const value = { id: descriptor.id,
      version: { data: descriptor.data.version, dataHash: descriptor.data.hash, manifest: `ruleset:${descriptor.id}` },
      config: jsonClone(config), ...(origin ? { origin: jsonClone(origin) } : {}) };
    return { ...value, signature: this.sign('match-ruleset', { matchId, ...value }) };
  }
  verifyBinding(matchId: string, binding: MatchRulesetBinding): void {
    try {
      const { signature, ...value } = binding;
      if (!RULESET_ID.test(binding.id) || binding.version.manifest !== `ruleset:${binding.id}` ||
          !this.same(signature, this.sign('match-ruleset', { matchId, ...value })))
        throw new RulesetError('E_RULESET_INTEGRITY');
    } catch { throw new RulesetError('E_RULESET_INTEGRITY'); }
  }
}
