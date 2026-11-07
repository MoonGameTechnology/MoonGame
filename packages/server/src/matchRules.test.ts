import { describe, expect, it, vi } from 'vitest';
import { type GameVersion } from '@void/shared-core';
import { createDevMatch, loadShippedData } from './scenario';
import { snapshotOf } from './persistence';
import { MemoryMatchStore, type MatchSnapshot } from './store';
import {
  LEGACY_MATCH_RULES,
  loadCompatibleSnapshot,
  MatchRulesMismatch,
  skipIncompatibleMatch,
} from './matchRules';

const seed = snapshotOf(createDevMatch(loadShippedData(), { now: () => 1000, time: 1000 }));
const expected = { ...LEGACY_MATCH_RULES };
const snapshot = (version: GameVersion = expected): MatchSnapshot => ({
  ...seed,
  matchId: 'persisted',
  seq: 17,
  dataVersion: version.data,
  state: { ...seed.state, version },
  createdAt: 1000,
  clock: { wallTime: 2000, gameTime: 1000, timeScale: 5, running: true },
  economyActivity: { commander: ['a', 'b'] },
});

describe('match rules at the durable resume boundary', () => {
  it('distinguishes a missing snapshot from an incompatible existing match', async () => {
    const store = new MemoryMatchStore();
    expect(await loadCompatibleSnapshot(store, 'missing', expected)).toBeNull();
    await store.save(snapshot({ ...expected, dataHash: 'changed' }));
    await expect(loadCompatibleSnapshot(store, 'persisted', expected)).rejects.toBeInstanceOf(
      MatchRulesMismatch,
    );
  });

  it('does not rewrite a compatible snapshot', async () => {
    const store = new MemoryMatchStore();
    await store.save(snapshot());
    const save = vi.spyOn(store, 'save');
    expect(await loadCompatibleSnapshot(store, 'persisted', expected)).toEqual(snapshot());
    expect(save).not.toHaveBeenCalled();
  });

  it.each([
    { data: '0.1.0', manifest: '1' },
    { data: expected.data, manifest: expected.manifest },
    { ...expected, manifest: '1' },
  ])(
    'pins supported legacy metadata once, preserving the world, clock and sequence: %j',
    async (version) => {
      const store = new MemoryMatchStore();
      const old = snapshot(version);
      await store.save(old);
      const save = vi.spyOn(store, 'save');
      const resumed = await loadCompatibleSnapshot(store, 'persisted', expected);
      const pinned = {
        ...old,
        dataVersion: expected.data,
        state: { ...old.state, version: expected },
      };
      expect(resumed).toEqual(pinned);
      expect(await store.load('persisted')).toEqual(pinned);
      expect(await loadCompatibleSnapshot(store, 'persisted', expected)).toEqual(pinned);
      expect(save).toHaveBeenCalledTimes(1);
    },
  );

  it.each([
    { ...expected, manifest: 'older' },
    { ...expected, data: 'wrong' },
    { ...expected, dataHash: 'wrong' },
    { ...expected, dataHash: '' },
    { data: '0.1.0', manifest: '1', dataHash: 'wrong' },
    { ...expected, manifest: '1', dataHash: 'wrong' },
    { data: expected.data, manifest: undefined } as unknown as GameVersion,
    undefined as unknown as GameVersion,
  ])('rejects mismatches/corruption without changing the stored snapshot: %j', async (version) => {
    const store = new MemoryMatchStore();
    const bad = { ...snapshot(), state: { ...seed.state, version } };
    await store.save(bad);
    const before = await store.load('persisted');
    await expect(loadCompatibleSnapshot(store, 'persisted', expected)).rejects.toThrow(
      'E_MATCH_RULES_MISMATCH',
    );
    expect(await store.load('persisted')).toEqual(before);
  });

  it.each(['data', 'manifest', 'dataHash'] as const)(
    'never moves the legacy baseline when deployed %s changes',
    async (key) => {
      const store = new MemoryMatchStore();
      await store.save(snapshot({ data: '0.1.0', manifest: '1' }));
      await expect(
        loadCompatibleSnapshot(store, 'persisted', { ...expected, [key]: 'next' }),
      ).rejects.toBeInstanceOf(MatchRulesMismatch);
      await store.save(snapshot({ ...expected, manifest: '1' }));
      await expect(
        loadCompatibleSnapshot(store, 'persisted', { ...expected, [key]: 'next' }),
      ).rejects.toBeInstanceOf(MatchRulesMismatch);
    },
  );

  it('rejects an inconsistent outer data version', async () => {
    const store = new MemoryMatchStore();
    await store.save({ ...snapshot(), dataVersion: 'wrong' });
    await expect(loadCompatibleSnapshot(store, 'persisted', expected)).rejects.toThrow(
      'E_MATCH_RULES_MISMATCH',
    );
    await store.save({ ...snapshot({ data: '0.1.0', manifest: '1' }), dataVersion: 'wrong' });
    await expect(loadCompatibleSnapshot(store, 'persisted', expected)).rejects.toThrow(
      'E_MATCH_RULES_MISMATCH',
    );
  });

  it('never resumes if the legacy pin could not be committed', async () => {
    const store = new MemoryMatchStore();
    await store.save(snapshot({ data: '0.1.0', manifest: '1' }));
    const before = await store.load('persisted');
    vi.spyOn(store, 'save').mockRejectedValueOnce(new Error('E_STORAGE'));
    await expect(
      skipIncompatibleMatch(() => loadCompatibleSnapshot(store, 'persisted', expected)),
    ).rejects.toThrow('E_STORAGE');
    expect(await store.load('persisted')).toEqual(before);
  });

  it('isolates only rule mismatches and still raises healthy rooms', async () => {
    const store = new MemoryMatchStore();
    await store.save(snapshot({ ...expected, manifest: 'old' }));
    await store.save({ ...snapshot(), matchId: 'healthy' });
    const failures = vi.fn();
    expect(
      await skipIncompatibleMatch(
        () => loadCompatibleSnapshot(store, 'persisted', expected),
        failures,
      ),
    ).toBeNull();
    expect(failures).toHaveBeenCalledWith('persisted');
    expect(
      await skipIncompatibleMatch(() => loadCompatibleSnapshot(store, 'healthy', expected)),
    ).not.toBeNull();
    await expect(
      skipIncompatibleMatch(() => Promise.reject(new Error('programming error'))),
    ).rejects.toThrow('programming error');
  });
});
