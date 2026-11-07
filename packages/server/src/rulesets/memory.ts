import { canonical, jsonClone } from './canonical';
import { RulesetError, type RulesetArtifact, type RulesetStore } from './types';

const copy = (a: RulesetArtifact): RulesetArtifact => ({
  descriptor: jsonClone(a.descriptor), signature: a.signature, bundle: Buffer.from(a.bundle),
});

export class MemoryRulesetStore implements RulesetStore {
  private readonly entries = new Map<string, RulesetArtifact>();
  async hasAny(): Promise<boolean> { return this.entries.size > 0; }
  async get(id: string): Promise<RulesetArtifact | null> {
    const record = this.entries.get(id);
    return record ? copy(record) : null;
  }
  async put(record: RulesetArtifact): Promise<void> {
    const old = this.entries.get(record.descriptor.id);
    if (old && (canonical(old.descriptor) !== canonical(record.descriptor) || old.signature !== record.signature ||
        !Buffer.from(old.bundle).equals(Buffer.from(record.bundle)))) throw new RulesetError('E_RULESET_PIN_CONFLICT');
    if (!old) this.entries.set(record.descriptor.id, copy(record));
  }
}
