import { engine } from './fixtureEngine';
import { describe, expect, it, vi } from 'vitest';
import { createInitialState } from '@void/shared-core';
import { MemoryRulesetStore } from './memory';
import { RulesetRegistry } from './registry';
import { bundleId, RulesetSigner } from './signing';
import type { RulesetArtifact, RulesetStore } from './types';

const key = Buffer.alloc(32, 7); // Test-only key; never used by a running host.

const first = engine(1), second = engine(2);
const current = () => {
  const store = new MemoryRulesetStore();
  const signer = new RulesetSigner(key);
  return { store, signer, registry: new RulesetRegistry(store, signer) };
};

describe('immutable match rules', () => {
  it('restores the old engine and configuration after a new engine ships with the SAME data and manifest pins', async () => {
    const { store, signer, registry } = current();
    const old = await registry.registerTrusted(first, bundleId(first));
    const pin = registry.bind('old-match', old, old.configFor({}));
    const latest = await registry.registerTrusted(second, bundleId(second));
    expect(old.descriptor.data).toEqual(latest.descriptor.data);
    expect(old.descriptor.manifest).toBe(latest.descriptor.manifest);
    expect(old.descriptor.modules).toEqual(latest.descriptor.modules);
    expect(old.descriptor.id).not.toBe(latest.descriptor.id);
    const restarted = new RulesetRegistry(store, signer);
    const restored = await restarted.resolve('old-match', JSON.parse(JSON.stringify(pin)));
    const s = createInitialState({ seed: 'rule-lock', version: pin.version });
    s.players.p1 = { id: 'p1', name: 'p1', faction: 'test', status: 'active', resources: { credits: 100 } };
    const action = { id: 'spend', type: 'fixture.spend', playerId: 'p1', issuedAt: 0, payload: {} };
    const before = restored.kernel.applyAction(s, action, { now: 0, data: restored.data, config: pin.config });
    const after = latest.kernel.applyAction(s, action, { now: 0, data: latest.data, config: latest.configFor(s) });
    expect(before.ok && before.state.players.p1!.resources.credits).toBe(99);
    expect(after.ok && after.state.players.p1!.resources.credits).toBe(98);
    expect(pin.config.victory?.scoreLimit).toBe(100);
    expect(latest.configFor(s).victory?.scoreLimit).toBe(200);
    expect(s.players.p1.resources.credits).toBe(100);
    expect(restored.descriptor.actions).toEqual(['fixture.spend']);
  });

  it('does not fall back to the latest engine when the pinned artifact is missing', async () => {
    const { registry } = current();
    await registry.registerTrusted(second, bundleId(second));
    await expect(registry.get('0'.repeat(64))).rejects.toMatchObject({ code: 'E_RULESET_MISSING' });
  });

  it('authenticates stored bytes BEFORE executing any imported code', async () => {
    const { registry, store } = current();
    const runtime = await registry.registerTrusted(first, bundleId(first));
    const record = (await store.get(runtime.descriptor.id))!;
    const malicious = Buffer.from('globalThis.rulesetInjected = true; throw Error("executed");');
    const forged: RulesetArtifact = { ...record, bundle: malicious,
      descriptor: { ...record.descriptor, id: bundleId(malicious) } };
    const broken: RulesetStore = { hasAny: async () => true, get: async () => forged, put: async () => {} };
    const importer = vi.fn(async () => { throw new Error('code must not execute'); });
    const restarted = new RulesetRegistry(broken, new RulesetSigner(key), importer);
    await expect(restarted.get(forged.descriptor.id)).rejects.toMatchObject({ code: 'E_RULESET_INTEGRITY' });
    expect(importer).not.toHaveBeenCalled();
  });

  it('normalizes an unsupported runtime without exposing import errors or selecting a replacement engine', async () => {
    const { registry, store, signer } = current();
    const runtime = await registry.registerTrusted(first, bundleId(first));
    const importer = vi.fn(async () => { throw new Error('private runtime detail'); });
    await expect(new RulesetRegistry(store, signer, importer).get(runtime.descriptor.id))
      .rejects.toMatchObject({ code: 'E_RULESET_UNSUPPORTED', message: 'E_RULESET_UNSUPPORTED' });
    expect(importer).toHaveBeenCalledOnce();
  });

  it('binds both match identity and configuration; JSONB key order does not affect the signature', async () => {
    const { registry } = current();
    const runtime = await registry.registerTrusted(first, bundleId(first));
    const pin = registry.bind('m', runtime, { timeScale: 1, victory: { scoreLimit: 100 } });
    const reordered = { ...pin, config: { victory: { scoreLimit: 100 }, timeScale: 1 } };
    await expect(registry.resolve('m', reordered)).resolves.toBe(runtime);
    await expect(registry.resolve('other', pin)).rejects.toMatchObject({ code: 'E_RULESET_INTEGRITY' });
    await expect(registry.resolve('m', { ...pin, config: { timeScale: 24 } }))
      .rejects.toMatchObject({ code: 'E_RULESET_INTEGRITY' });
    expect(() => { pin.config.timeScale = 24; }).toThrow();
    expect(() => { runtime.data.version = 'new-data'; }).toThrow();
  });

  it('never overwrites an existing executable artifact with different bytes or metadata', async () => {
    const { registry, store } = current();
    const runtime = await registry.registerTrusted(first, bundleId(first));
    const record = (await store.get(runtime.descriptor.id))!;
    await expect(store.put({ ...record, signature: '0'.repeat(64) }))
      .rejects.toMatchObject({ code: 'E_RULESET_PIN_CONFLICT' });
    record.descriptor.source = 'b'.repeat(40);
    expect((await store.get(runtime.descriptor.id))!.descriptor.source).toBe('a'.repeat(40));
  });
});
