import { describe, expect, it, vi } from 'vitest';
import { createInitialState } from '@void/shared-core';
import { MemoryMatchStore, MemoryReceiptStore } from '../store/memory';
import type { MatchSnapshot } from '../store/types';
import { createMatchLoader } from '../serverWiring';
import { engine } from './fixtureEngine';
import { MemoryRulesetStore } from './memory';
import { RulesetRegistry } from './registry';
import { bundleId, RulesetSigner } from './signing';
import { MatchRulesets } from './service';
import { planLegacyBinding } from './legacy';

async function setup() {
  const artifacts = new MemoryRulesetStore(), signer = new RulesetSigner(Buffer.alloc(32, 8));
  const registry = new RulesetRegistry(artifacts, signer);
  const first = engine(1), second = engine(2);
  const old = await registry.registerTrusted(first, bundleId(first));
  const latest = await registry.registerTrusted(second, bundleId(second));
  const state = createInitialState({ seed: 'saved', version: { data: old.data.version, dataHash: old.descriptor.data.hash, manifest: '1' } });
  state.players.p1 = { id: 'p1', name: 'p1', faction: 'test', status: 'active', resources: { credits: 100 } };
  const snapshot: MatchSnapshot = { matchId: 'm', state, dataVersion: state.version.data, seq: 0, status: 'ongoing',
    createdAt: 100, clock: { wallTime: 100, gameTime: 0, timeScale: 12, running: false } };
  return { artifacts, signer, registry, old, latest, snapshot };
}

describe('per-match durable rule selection', () => {
  it('restores an old room under a newer host, preserves its clock, and deduplicates its commands across restart', async () => {
    const { artifacts, signer, registry, old, latest, snapshot } = await setup();
    const rules = new MatchRulesets(registry, old);
    Object.assign(snapshot.state, { approval: { bot: { p1: 11, p2: 77 } } });
    const pinned = rules.newSnapshot(snapshot);
    const store = new MemoryMatchStore(), receiptStore = new MemoryReceiptStore();
    await store.save(pinned);
    const reboot = new MatchRulesets(new RulesetRegistry(artifacts, signer), latest);
    const load = createMatchLoader({ stores: { store, receiptStore }, data: latest.data, rulesets: reboot, now: () => 100 });
    const first = (await load('m'))!;
    expect(first.room.clockScale).toBe(12);
    expect(first.room.createdAt).toBe(100);
    const messages: string[] = [];
    first.room.addPeer('p1', { send: raw => { messages.push(raw); } });
    expect(JSON.parse(messages[0]!).state.players.p1.name).toBe('view-1');
    expect(JSON.parse(messages[0]!).state.approval).toEqual({ bot: { p1: 11 } });
    expect(first.room.state.players.p1!.name).toBe('p1');
    const action = { id: 'spend', type: 'fixture.spend', playerId: 'p1', issuedAt: 0, payload: {} };
    expect((await first.room.submitServerAction('p1', action)).ok).toBe(true);
    expect(first.room.state.players.p1!.resources.credits).toBe(99);
    await first.dispose();
    const second = (await load('m'))!;
    expect((await second.room.submitServerAction('p1', action)).ok).toBe(true);
    expect(second.room.state.players.p1!.resources.credits).toBe(99);
    expect(second.room.ruleset).toEqual(pinned.ruleset);
    expect(second.room.state.version).toEqual(pinned.state.version);
    await second.dispose();
    const fresh = new MatchRulesets(registry, latest).newSnapshot({ ...snapshot, matchId: 'new' });
    expect(fresh.ruleset!.id).toBe(latest.descriptor.id);
    expect(fresh.ruleset!.config.victory?.scoreLimit).toBe(200);
  });

  it('quarantines an unbound legacy world without changing or replacing it', async () => {
    const { registry, latest, snapshot } = await setup();
    const store = new MemoryMatchStore();
    await store.save(snapshot);
    const saved = await store.load('m');
    const save = vi.spyOn(store, 'save');
    const load = createMatchLoader({ stores: { store, receiptStore: new MemoryReceiptStore() }, data: latest.data,
      rulesets: new MatchRulesets(registry, latest), now: () => 100 });
    expect(await load('m')).toBeNull();
    expect(save).not.toHaveBeenCalled();
    expect(await store.load('m')).toEqual(saved);
  });

  it('retains an omitted pin and refuses replacement or a conflicting world version', async () => {
    const { registry, old, latest, snapshot } = await setup();
    const store = new MemoryMatchStore();
    const pinned = new MatchRulesets(registry, old).newSnapshot(snapshot);
    await store.save(pinned);
    const { ruleset: _pin, ...omitted } = pinned;
    await store.save({ ...omitted, seq: 1 });
    expect((await store.load('m'))!.ruleset).toEqual(pinned.ruleset);
    const changed = new MatchRulesets(registry, latest).newSnapshot(snapshot);
    expect(() => store.save({ ...changed, seq: 2 })).toThrow('E_RULESET_PIN_CONFLICT');
    expect(() => store.save({ ...omitted, seq: 2, state: snapshot.state })).toThrow('E_RULESET_PIN_CONFLICT');
    expect((await store.load('m'))!.seq).toBe(1);
  });

  it('requires exact launch evidence for a legacy import, preserving world, sequence and clock', async () => {
    const { registry, old, latest, snapshot } = await setup();
    const rules = new MatchRulesets(registry, latest);
    const witness = { matchId: 'm', createdAt: 100, deployedAt: 99, nextDeployedAt: 101,
      source: old.descriptor.source, nativeManifest: old.descriptor.manifest,
      version: snapshot.state.version, config: old.configFor(snapshot.state) };
    const pinned = await planLegacyBinding(rules, snapshot, old.descriptor.id, witness);
    const { version: _before, ...before } = snapshot.state;
    const { version: _after, ...after } = pinned.state;
    expect(after).toEqual(before);
    expect(pinned.clock).toEqual(snapshot.clock);
    expect(pinned.seq).toBe(snapshot.seq);
    expect(pinned.state.version.dataHash).toBe(snapshot.state.version.dataHash);
    expect(pinned.ruleset!.origin!.version).toEqual(snapshot.state.version);
    await expect(planLegacyBinding(rules, snapshot, old.descriptor.id, { ...witness, nextDeployedAt: 100 })).rejects.toThrow();
    await expect(planLegacyBinding(rules, snapshot, latest.descriptor.id, witness)).rejects.toThrow();
  });
});
