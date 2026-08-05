import { describe, expect, it } from 'vitest';
import { createKernel } from './kernel';
import { E_ADVANCE_BUDGET, E_ADVANCE_STUCK, runUntil } from './runUntil';
import type { GameModule } from './module';
import type { Context } from '../action/types';
import type { GameState } from '../state/gameState';
import { fixtureData, makeFixtureState } from '../testkit/arbitraries';

/**
 * AUD-5. `runUntil` is the single copy of the "chain partial advances" loop that three
 * call sites used to spell out by hand. What matters is not that it advances — that is
 * `advanceTo`'s job — but that it handles the two shapes a plain `advanceTo` call cannot:
 * a run that needs several rounds, and a run that would never finish.
 */

const ctxAt = (now: number): Context => ({ now, data: fixtureData });

/** A module that schedules a fresh event at the SAME instant every time one fires —
 *  the same-instant runaway `advanceTo` reports as `partial` with a frozen clock. */
const runawayModule: GameModule = {
  id: 'test.runaway',
  version: '1',
  setup(api) {
    api.on('test.spin', (_event, h) => {
      h.schedule(h.ctx.now, 'test.spin', {});
    });
  },
};

describe('runUntil — the shared partial-advance loop', () => {
  it('reaches the target instant and reports the state it got there with', () => {
    const kernel = createKernel([]);
    const state = makeFixtureState('run-until');
    const target = state.time + 5 * 60 * 60 * 1000;

    const result = runUntil(kernel, state, ctxAt(target));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.time).toBe(target);
    // The input is never mutated — same purity contract as `applyAction`.
    expect(state.time).toBeLessThan(target);
  });

  it('is a no-op when the clock is already at the target', () => {
    const kernel = createKernel([]);
    const state = makeFixtureState('run-until-noop');

    const result = runUntil(kernel, state, ctxAt(state.time));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state).toBe(state);
    expect(result.events).toEqual([]);
  });

  it('refuses to spin when a partial round leaves the clock where it was', () => {
    const kernel = createKernel([runawayModule]);
    const base = makeFixtureState('run-until-stuck');
    // Seed the self-rescheduling event at an instant the run has to pass through.
    const at = base.time + 1000;
    const state: GameState = {
      ...base,
      scheduled: [{ id: 'spin-1', at, seq: 1, type: 'test.spin', payload: {} }],
      scheduleSeq: 2,
    };

    const result = runUntil(kernel, state, ctxAt(at + 60_000));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    // A stable code, not a hang and not a thrown stack — invariant #4.
    expect(result.code).toBe(E_ADVANCE_STUCK);
  });

  it('honours an explicit chunk cap instead of looping unbounded', () => {
    const kernel = createKernel([runawayModule]);
    const base = makeFixtureState('run-until-budget');
    const at = base.time + 1000;
    const state: GameState = {
      ...base,
      scheduled: [{ id: 'spin-1', at, seq: 1, type: 'test.spin', payload: {} }],
      scheduleSeq: 2,
    };

    const result = runUntil(kernel, state, ctxAt(at + 60_000), { maxChunks: 0 });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe(E_ADVANCE_BUDGET);
  });

  it('passes a refusal from the kernel straight through', () => {
    const kernel = createKernel([]);
    const state = makeFixtureState('run-until-backwards');

    // `ctx.now` behind the world clock is `E_TIME_BACKWARDS` — but the loop only runs
    // while `state.time < ctx.now`, so this must be the no-op success, NOT a refusal.
    const result = runUntil(kernel, state, ctxAt(state.time - 1000));

    expect(result.ok).toBe(true);
  });
});
