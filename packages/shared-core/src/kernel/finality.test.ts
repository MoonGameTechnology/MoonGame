import { describe, expect, it } from 'vitest';
import { createKernel } from './kernel';
import type { GameModule } from './module';
import { createInitialState } from '../state/gameState';
import { parseGameData } from '../data/schemas';
import { deepFreeze } from '../util/clone';

const data = parseGameData({
  version: 'test',
  resources: ['metal'],
  units: {},
  factions: {},
  buildings: {},
  events: {},
});
const terminal: GameModule = {
  id: 'terminal-test',
  version: '1',
  setup(api) {
    api.on('finish', (_e, h) => {
      h.state.match.status = 'ended';
      h.state.match.endedAt = h.ctx.now;
      h.state.match.rewards = { p1: { place: 1, xp: 200 } };
      h.emit('match.ended', {});
    });
    api.on('pulse', (_e, h) => {
      h.state.scheduleSeq += 100;
    });
    api.on('broken', (_e, h) => h.reject('E_TEST'));
  },
};

function initial() {
  return createInitialState({ seed: 'finality', version: { data: 'test', manifest: 'test' } });
}
const event = (at: number, seq: number, type: string) => ({
  id: `e${seq}`,
  at,
  seq,
  type,
  payload: null,
});

describe('terminal world boundary', () => {
  it('leaves an already ended snapshot unchanged, including overdue events and RNG', () => {
    const state = initial();
    state.time = 20;
    state.match.status = 'ended';
    state.match.endedAt = 10; // historical snapshot that advanced after its result
    state.scheduled = [event(5, 2, 'pulse'), event(1, 1, 'broken')];
    deepFreeze(state);
    expect(createKernel([terminal]).advanceTo(state, { now: 1000, data })).toEqual({
      ok: true,
      state,
      events: [],
      failures: [],
    });
  });

  it.each([false, true])('stops at the finishing step, including fallback=%s', (fallback) => {
    const state = initial();
    state.scheduled = [
      ...(fallback ? [event(5, 0, 'broken')] : []),
      event(10, 1, 'finish'),
      event(10, 2, 'pulse'),
      event(20, 3, 'pulse'),
    ];
    const kernel = createKernel([terminal]);
    const result = kernel.advanceTo(state, { now: 1000, data });
    if (!result.ok) throw new Error(result.code);
    expect(result.state.time).toBe(10);
    expect(result.state.match.endedAt).toBe(10);
    expect(result.state.scheduleSeq).toBe(0);
    expect(result.state.scheduled.map((e) => e.type)).toEqual(['pulse', 'pulse']);
    expect(result.events.filter((e) => e.type === 'match.ended')).toHaveLength(1);
    expect(result.failures).toHaveLength(fallback ? 1 : 0);
    expect(kernel.advanceTo(result.state, { now: 2000, data })).toEqual({
      ok: true,
      state: result.state,
      events: [],
      failures: [],
    });
    expect(state.match.status).not.toBe('ended');
  });

  it('does not dispatch a queued event after continuous time ends the match', () => {
    const deadline: GameModule = {
      id: 'deadline',
      version: '1',
      setup(api) {
        api.on('time.advanced', (_e, h) => h.emit('finish', {}));
      },
    };
    const state = initial();
    state.scheduled = [event(10, 1, 'pulse')];
    const result = createKernel([terminal, deadline]).advanceTo(state, { now: 1000, data });
    if (!result.ok) throw new Error(result.code);
    expect(result.state.time).toBe(10);
    expect(result.state.scheduleSeq).toBe(0);
    expect(result.state.scheduled).toEqual(state.scheduled);
    expect(result.events.map((e) => e.type)).toEqual(['time.advanced', 'finish', 'match.ended']);
  });
});
