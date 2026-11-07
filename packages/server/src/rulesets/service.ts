import { randomBytes } from 'node:crypto';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { GameState } from '@void/shared-core';
import type { MatchSnapshot, MatchStore } from '../store/types';
import { MatchRulesMismatch } from '../matchRules';
import { RulesetRegistry } from './registry';
import { RulesetSigner } from './signing';
import { FileRulesetStore, readImageRuleset } from './files';
import { loadRulesetKey } from './keyFile';
import { assertSnapshotPin } from './snapshot';
import { RulesetError, type RulesetRuntime } from './types';

export class MatchRulesets {
  constructor(readonly registry: RulesetRegistry, readonly current: RulesetRuntime) {}

  /** New worlds alone use the current default. Loading never adopts new rules. */
  newSnapshot(snapshot: MatchSnapshot): MatchSnapshot {
    if (snapshot.ruleset || snapshot.state.version.data !== this.current.descriptor.data.version ||
        snapshot.state.version.dataHash !== this.current.descriptor.data.hash)
      throw new RulesetError('E_RULESET_PIN_CONFLICT');
    const ruleset = this.registry.bind(snapshot.matchId, this.current, this.current.configFor(snapshot.state));
    return { ...snapshot, ruleset, dataVersion: ruleset.version.data,
      state: { ...snapshot.state, version: { ...ruleset.version } } };
  }

  async resolve(snapshot: MatchSnapshot): Promise<RulesetRuntime> {
    try {
      if (!snapshot.ruleset) throw new RulesetError('E_RULESET_MISSING');
      assertSnapshotPin(snapshot, snapshot.ruleset);
      return await this.registry.resolve(snapshot.matchId, snapshot.ruleset);
    } catch (error) {
      if (!(error instanceof RulesetError)) throw error;
      // Existing isolation/reporting path: no room, receipts, timers or replacement world.
      throw new MatchRulesMismatch(snapshot.matchId, 'ruleset', error.code);
    }
  }

  /** Decorate NEW snapshot creation (ordinary / AvA / admin) at the shared store seam. */
  pinNewMatches(store: MatchStore): MatchStore {
    const prepare = (snapshot: MatchSnapshot): MatchSnapshot => this.newSnapshot(snapshot);
    return new Proxy(store, { get(target, property) {
      if (property === 'save') return async (snapshot: MatchSnapshot) => {
        const existing = await target.load(snapshot.matchId);
        if (!existing && !snapshot.ruleset) snapshot = prepare(snapshot);
        await target.save(snapshot);
      };
      const value: unknown = Reflect.get(target, property, target);
      return typeof value === 'function' ? value.bind(target) : value;
    } });
  }
}

export async function createMatchRulesets(store: MatchStore, env = process.env, base = import.meta.url): Promise<MatchRulesets> {
  const production = env.PROD === '1' || env.PROD === 'true' || env.NODE_ENV === 'production';
  const persistent = !!env.DATABASE_URL;
  if (persistent && !store.hasPinnedMatches) throw new RulesetError('E_RULESET_KEY');
  const hasPins = persistent ? await store.hasPinnedMatches!() : false;
  const keyPath = env.RULESET_KEY_FILE || (persistent ? join(homedir(), '.local/share/void/ruleset-key') : undefined);
  if (production && !env.RULESET_KEY_FILE) throw new RulesetError('E_RULESET_KEY');
  const signer = new RulesetSigner(keyPath ? await loadRulesetKey(keyPath, !hasPins && env.RULESET_KEY_REQUIRED !== '1') : randomBytes(32));
  const embedded = await readImageRuleset(fileURLToPath(new URL('./current-ruleset.mjs', base)),
    fileURLToPath(new URL('./current-ruleset.json', base)), signer);
  const files = new FileRulesetStore(env.RULESET_CACHE_DIR || '/app/rulesets', signer, embedded, production);
  const registry = new RulesetRegistry(files, signer);
  const current = await registry.get(embedded.descriptor.id);
  return new MatchRulesets(registry, current);
}

/** Public data only. The HMAC, legacy evidence and server filesystem never go on wire. */
export function publicRules(runtime: RulesetRuntime, state: Pick<GameState, 'version'>, config: import('@void/shared-core').MatchConfig): import('@void/protocol').MatchRulesCatalog {
  return { id: runtime.descriptor.id, version: state.version, data: runtime.data,
    config, actions: runtime.descriptor.actions, ...(runtime.descriptor.view ? { view: runtime.descriptor.view } : {}) };
}
