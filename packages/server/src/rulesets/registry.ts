import type { GameData, GameState, Kernel, MatchConfig } from '@void/shared-core';
import { freezeTree, jsonClone } from './canonical';
import { bundleId, MAX_RULESET_BYTES, RULESET_ID, RulesetSigner } from './signing';
import { RulesetError, type LegacyRulesOrigin, type MatchRulesetBinding, type RulesetDescriptor, type RulesetRuntime, type RulesetStore } from './types';

type Importer = (bytes: Uint8Array) => Promise<unknown>;
const importVerified: Importer = (bytes) => import(`data:text/javascript;base64,${Buffer.from(bytes).toString('base64')}`);
const HASH = /^[a-f0-9]{12,128}$/;
const NAME = /^[a-zA-Z0-9_.:-]{1,128}$/;

interface Capsule {
  formatVersion: 1;
  sourceRevision: string;
  manifestVersion: string;
  dataHash: string;
  data: GameData;
  kernel: Kernel;
  actions: string[];
  drivers: import('./types').RulesetDrivers;
  projection: import('./projection').RulesetProjection;
  view?: RulesetDescriptor['view'];
  configFor(state: Pick<GameState, 'mapId' | 'modeId'>): MatchConfig;
}

function capsule(value: unknown): Capsule {
  const m = value as Capsule | null;
  if (!m || m.formatVersion !== 1 || typeof m.configFor !== 'function' ||
      typeof m.sourceRevision !== 'string' || !/^(?:[a-f0-9]{40}|local)$/.test(m.sourceRevision) ||
      typeof m.manifestVersion !== 'string' || !NAME.test(m.manifestVersion) ||
      typeof m.data?.version !== 'string' || !m.data.version || !HASH.test(m.dataHash) ||
      !Array.isArray(m.kernel?.manifest?.modules) || m.kernel.manifest.modules.length > 256 ||
      !['applyAction', 'advanceTo', 'canApplyAll'].every((key) => typeof (m.kernel as unknown as Record<string, unknown>)[key] === 'function') ||
      !Array.isArray(m.actions) || m.actions.length > 1024 || !m.actions.every((a) => typeof a === 'string' && NAME.test(a)))
    throw new RulesetError('E_RULESET_UNSUPPORTED');
  for (const item of m.kernel.manifest.modules)
    if (!NAME.test(item.id) || typeof item.version !== 'string' || !NAME.test(item.version))
      throw new RulesetError('E_RULESET_UNSUPPORTED');
  if (!m.drivers || !['ai', 'bot', 'slices', 'pve', 'standing', 'canonicalStanding'].every(key =>
    typeof (m.drivers as unknown as Record<string, unknown>)[key] === 'function'))
    throw new RulesetError('E_RULESET_UNSUPPORTED');
  if (!m.projection || !['hostFog', 'coalitionWallNow', 'effectiveVictoryRules', 'flashBattles', 'getStance', 'identifiedNodes', 'inVisionBloc', 'visibleView']
    .every(key => typeof (m.projection as unknown as Record<string, unknown>)[key] === 'function'))
    throw new RulesetError('E_RULESET_UNSUPPORTED');
  return m;
}

function describe(id: string, m: Capsule): RulesetDescriptor {
  return { format: 1, id, source: m.sourceRevision === 'local' ? `local:${id}` : m.sourceRevision,
    data: { version: m.data.version, hash: m.dataHash }, manifest: m.manifestVersion,
    modules: m.kernel.manifest.modules.map(({ id, version }) => ({ id, version })),
    actions: [...new Set(m.actions)].sort(), ...(m.view ? { view: jsonClone(m.view) } : {}) };
}

/** The current deployment is a default for NEW matches, never a restore fallback. */
export class RulesetRegistry {
  private readonly loaded = new Map<string, Promise<RulesetRuntime>>();
  constructor(private readonly store: RulesetStore, private readonly signer: RulesetSigner,
    private readonly importer: Importer = importVerified) {}

  private runtime(id: string, value: unknown, expected?: RulesetDescriptor): RulesetRuntime {
    const m = capsule(value);
    const descriptor = describe(id, m);
    if (expected && JSON.stringify(jsonClone(descriptor)) !== JSON.stringify(jsonClone(expected)))
      throw new RulesetError('E_RULESET_INTEGRITY');
    freezeTree(m.kernel.manifest);
    return { descriptor: freezeTree(descriptor), data: freezeTree(m.data), kernel: m.kernel, drivers: m.drivers, projection: m.projection,
      configFor: (state) => freezeTree(jsonClone(m.configFor(state))) };
  }

  private async importCapsule(bytes: Uint8Array): Promise<unknown> {
    try { return await this.importer(bytes); }
    catch { throw new RulesetError('E_RULESET_UNSUPPORTED'); }
  }

  /** Only a read-only local image bundle or an explicitly attested operator import. */
  async registerTrusted(bytes: Uint8Array, expectedId: string): Promise<RulesetRuntime> {
    const id = bundleId(bytes);
    if (!bytes.length || bytes.length > MAX_RULESET_BYTES || !RULESET_ID.test(expectedId) || id !== expectedId)
      throw new RulesetError('E_RULESET_INTEGRITY');
    const runtime = this.runtime(id, await this.importCapsule(bytes));
    await this.store.put(this.signer.artifact(runtime.descriptor, bytes));
    this.loaded.set(id, Promise.resolve(runtime));
    return runtime;
  }

  async get(id: string): Promise<RulesetRuntime> {
    if (!RULESET_ID.test(id)) throw new RulesetError('E_RULESET_INVALID');
    const old = this.loaded.get(id);
    if (old) return old;
    const pending = (async () => {
      const record = await this.store.get(id);
      if (!record) throw new RulesetError('E_RULESET_MISSING');
      // This must precede import: PostgreSQL is not a trusted executable-code source.
      this.signer.verifyArtifact(record);
      if (record.descriptor.id !== id) throw new RulesetError('E_RULESET_INTEGRITY');
      if (record.descriptor.format !== 1) throw new RulesetError('E_RULESET_UNSUPPORTED');
      return this.runtime(id, await this.importCapsule(record.bundle), record.descriptor);
    })();
    this.loaded.set(id, pending);
    try { return await pending; } catch (error) { this.loaded.delete(id); throw error; }
  }

  bind(matchId: string, runtime: RulesetRuntime, config: MatchConfig, origin?: LegacyRulesOrigin): MatchRulesetBinding {
    return freezeTree(this.signer.binding(matchId, runtime.descriptor, config, origin));
  }

  async resolve(matchId: string, binding: MatchRulesetBinding): Promise<RulesetRuntime> {
    this.signer.verifyBinding(matchId, binding);
    const runtime = await this.get(binding.id);
    if (binding.version.data !== runtime.descriptor.data.version || binding.version.dataHash !== runtime.descriptor.data.hash)
      throw new RulesetError('E_RULESET_INTEGRITY');
    return runtime;
  }
}
