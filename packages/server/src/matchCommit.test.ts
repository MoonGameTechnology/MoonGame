import { describe, expect, it } from 'vitest';
import { commitMatch } from './matchCommit';
import { createDevMatch, loadShippedData } from './scenario';
import { MemoryMatchStore, MemoryReceiptStore, type MatchSnapshot, type MatchStore } from './store';

const data = loadShippedData();
function snapshot(seq = 1): MatchSnapshot {
  return { matchId: 'commit-test', dataVersion: data.version, seq, status: 'ongoing',
    state: createDevMatch(data).state };
}
const receipt = { actionId: 'commit:green:1', playerId: 'green', seq: 1, ok: true };

describe('atomic match commit boundary', () => {
  it('publishes detached memory snapshot and receipt together', async () => {
    const matches = new MemoryMatchStore(); const receipts = new MemoryReceiptStore();
    const next = snapshot(); const accepted = { ...receipt };
    await commitMatch(matches, receipts, next, accepted);
    next.seq = 99; accepted.ok = false;
    expect((await matches.load(next.matchId))?.seq).toBe(1);
    expect(await receipts.loadAll(next.matchId)).toEqual([receipt]);
  });

  it('refuses unsupported adapter pairs without attempting separate writes', async () => {
    let wrote = false;
    const matches: MatchStore = { load: async () => null, ongoingMatchIds: async () => [],
      save: async () => { wrote = true; } };
    await expect(commitMatch(matches, new MemoryReceiptStore(), snapshot(), receipt))
      .rejects.toThrow('E_MATCH_COMMIT_BACKEND');
    expect(wrote).toBe(false);
  });

  it('refuses a mismatched receipt backend before changing the snapshot', async () => {
    const matches = new MemoryMatchStore();
    await expect(commitMatch(matches, { loadAll: async () => [], save: async () => {} }, snapshot(), receipt))
      .rejects.toThrow('E_MATCH_COMMIT_BACKEND');
    expect(await matches.load('commit-test')).toBeNull();
  });

  it('refuses a stale command without publishing its receipt', async () => {
    const matches = new MemoryMatchStore(); const receipts = new MemoryReceiptStore();
    await matches.save(snapshot(3));
    await expect(commitMatch(matches, receipts, snapshot(1), receipt)).rejects.toThrow('E_MATCH_COMMIT_STALE');
    expect((await matches.load('commit-test'))?.seq).toBe(3);
    expect(await receipts.loadAll('commit-test')).toEqual([]);
  });
});
