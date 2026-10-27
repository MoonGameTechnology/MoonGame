import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAvaSweeps, type AvaSweepDeps } from './avaSweeps';
import { MemoryAvaResultStore, type AvaSessionStore } from './store';

// CORP-5 — the AvA loop both hosts share: an ended battle is delivered until its result
// is recorded, the sweeps run in their fixed order, a cancelled battle's handouts come
// back after the roster and session sweeps, and maintenance holds every write to the
// corporations state.

function harness(pending: Array<{ matchId: string; matchupId: string; winner: string | null }> = []) {
  const calls: string[] = [];
  const results = new MemoryAvaResultStore();
  let maintenance = false;
  const sessionStore = {
    pendingResults: async () => pending,
    markResultDelivered: async (id: string) => void calls.push(`delivered ${id}`),
    markResultRetry: async (id: string) => void calls.push(`retry ${id}`),
  } as unknown as AvaSessionStore;
  const deps: AvaSweepDeps = {
    sessionStore,
    resultStore: results,
    ava: {
      sweepExpired: async () => (calls.push('expiry'), 0),
      sweepRosters: async () => (calls.push('rosters'), { locked: 0, cancelled: 0 }),
    },
    orchestrator: {
      sweep: async () => (calls.push('sessions'), { raised: 0, cancelled: 0 }),
      sweepWar: async () => (calls.push('war'), { declared: 0 }),
      onMatchEnded: async (matchId: string, winner: string | null) => {
        calls.push(`settle ${matchId} ${winner}`);
        const match = pending.find((p) => p.matchId === matchId)!;
        await results.record({ matchupId: match.matchupId, challengerCorp: 'a', targetCorp: 'b', winnerCorp: null, at: 1 });
      },
    },
    corpArsenal: {
      returnWar: async (matchupId: string) => (calls.push(`return ${matchupId}`), 0),
      returnCancelled: async () => (calls.push('cancelled'), 0),
    },
    maintenance: () => maintenance,
    log: (message) => calls.push(`log ${message}`),
  };
  return { calls, deps, setMaintenance: (on: boolean) => (maintenance = on) };
}

describe('createAvaSweeps', () => {
  afterEach(() => vi.useRealTimers());

  it('delivers an ended battle: handouts back, settled, marked delivered', async () => {
    const h = harness([{ matchId: 'ava-m1', matchupId: 'm1', winner: 'slot_a' }]);
    await createAvaSweeps(h.deps).deliverResults();
    expect(h.calls).toEqual(['return m1', 'settle ava-m1 slot_a', 'delivered ava-m1']);
  });

  it('keeps a battle pending while its result is not recorded', async () => {
    const h = harness([{ matchId: 'ava-m1', matchupId: 'm1', winner: null }]);
    h.deps.orchestrator.onMatchEnded = async () => undefined; // settlement did not land
    await createAvaSweeps(h.deps).deliverResults();
    expect(h.calls).toEqual(['return m1', 'retry ava-m1', 'log ava result ava-m1 pending: E_AVA_RESULT_PENDING']);
  });

  it('runs one delivery at a time', async () => {
    const h = harness([{ matchId: 'ava-m1', matchupId: 'm1', winner: null }]);
    const sweeps = createAvaSweeps(h.deps);
    await Promise.all([sweeps.deliverResults(), sweeps.deliverResults()]);
    expect(h.calls.filter((c) => c.startsWith('return'))).toEqual(['return m1']);
  });

  it('returns cancelled handouts after the roster and session sweeps, even when they fail', async () => {
    const h = harness();
    await createAvaSweeps(h.deps).tick();
    expect(h.calls.indexOf('cancelled')).toBeGreaterThan(h.calls.indexOf('sessions'));
    expect(h.calls).toEqual(expect.arrayContaining(['war', 'expiry', 'rosters', 'sessions', 'cancelled']));

    const failing = harness();
    failing.deps.ava.sweepRosters = async () => Promise.reject(Error('outage'));
    await createAvaSweeps(failing.deps).tick();
    expect(failing.calls).toContain('log ava roster/session sweep failed: outage');
    expect(failing.calls).toContain('cancelled');
    expect(failing.calls).not.toContain('sessions');
  });

  it('runs one pass at a time, so a slow pass never raises a battle twice', async () => {
    const h = harness();
    let release!: () => void;
    h.deps.orchestrator.sweep = () =>
      new Promise((resolve) => {
        h.calls.push('sessions');
        release = () => resolve({ raised: 0, cancelled: 0 });
      });
    const sweeps = createAvaSweeps(h.deps);
    const first = sweeps.tick();
    await vi.waitFor(() => expect(h.calls).toContain('sessions'));
    await sweeps.tick(); // the previous pass is still waiting on its sessions
    release();
    await first;
    expect(h.calls.filter((c) => c === 'sessions')).toHaveLength(1);
    expect(h.calls.filter((c) => c === 'war')).toHaveLength(1);
  });

  it('maintenance holds every write to the corporations state; the war clock keeps running', async () => {
    const h = harness([{ matchId: 'ava-m1', matchupId: 'm1', winner: 'slot_a' }]);
    h.setMaintenance(true);
    await createAvaSweeps(h.deps).tick();
    expect(h.calls).toEqual(['war']);
  });

  it('start runs a pass on every interval until stopped', async () => {
    vi.useFakeTimers();
    const h = harness();
    const stop = createAvaSweeps(h.deps).start(1_000);
    await vi.advanceTimersByTimeAsync(2_000);
    stop();
    await vi.advanceTimersByTimeAsync(2_000);
    expect(h.calls.filter((c) => c === 'war')).toHaveLength(2);
  });
});
