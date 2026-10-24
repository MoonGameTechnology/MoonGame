import { describe, expect, it } from 'vitest';
import {
  coalitionOf, createInitialState, createKernel, deepClone, diplomacyModule,
  hashState, parseGameData, runReplay, setStance,
  type GameModule, type ReplayStep,
} from '@void/shared-core';
import { MatchRoom } from './matchRoom';
import { snapshotOf } from './persistence';
import type { MatchSnapshot } from './store';

const HOUR = 3_600_000;
const START = 1_700_000_000_000;
const data = parseGameData({
  version: 'coalition-transitions', resources: ['credits'], units: {}, factions: {},
  buildings: {}, events: {}, sectors: {}, planetTypes: {},
});
const witness: GameModule = {
  id: 'departure-clock-witness', version: '1',
  setup(api) {
    api.on('coalition.left', (_, h) => { h.state.players.a!.resources.credits = h.ctx.now; });
  },
};
const modules = [diplomacyModule, witness];
function initial() {
  const state = createInitialState({ seed: 'transitions', version: { data: data.version, manifest: 'test' } });
  for (const id of ['a', 'b']) {
    state.players[id] = { id, name: id, faction: 'x', status: 'active', resources: { credits: 0 } };
  }
  state.coalitions = { c1: { id: 'c1', founder: 'a', members: ['a', 'b'], emblem: 'star', description: '' } };
  setStance(state, 'a', 'b', 'alliance');
  return state;
}
const saved = (room: MatchRoom): MatchSnapshot => JSON.parse(JSON.stringify(snapshotOf(room)));

describe('unapplied coalition clock transitions', () => {
  it.each([23, 30])('retains a restart saved at hour %s before its first catch-up, then restores at another rate', (saveHour) => {
    let wall = START;
    const steps: ReplayStep[] = [];
    const make = (snapshot?: MatchSnapshot, scale = 24) => new MatchRoom({
      id: 'transitions', initialState: snapshot?.state ?? initial(), initialClock: snapshot?.clock,
      initialSeq: snapshot?.seq, kernel: createKernel(modules), data,
      initiallyStarted: true, timeScale: scale, now: () => wall,
      record: (step) => steps.push(step),
    });
    const first = make();
    const start = deepClone(first.state);
    expect(first.submitAction('b', {
      id: 'leave', playerId: 'b', type: 'coalition.leave', issuedAt: 0, payload: {},
    }).ok).toBe(true);
    const original = saved(first);
    wall = START + 23 * HOUR;
    const second = make(original, 2);
    wall = START + saveHour * HOUR;
    const intermediate = saved(second); // No tick: the core still uses the original ×24 mapping.
    expect(intermediate.state.time).toBe(0);
    expect(intermediate.clock?.coalitionTransitions).toEqual([
      { wallTime: START + 23 * HOUR, gameTime: 23 * 24 * HOUR, timeScale: 2 },
    ]);
    wall = START + 31 * HOUR;
    const third = make(intermediate, 48);
    expect(saved(third).clock?.coalitionTransitions).toHaveLength(2);
    expect(third.msUntilNextEvent()).toBe(0);
    third.tick();
    expect(coalitionOf(third.state, 'b')).toBeNull();
    // Departure was at hour 24, after one real hour at ×2, before the ×48 restart.
    expect(third.state.players.a!.resources.credits).toBe((23 * 24 + 2) * HOUR);
    expect(third.state.coalitionJoinAfter?.b).toBe(START + 72 * HOUR);
    expect(saved(third).clock?.coalitionTransitions).toBeUndefined();
    const replayed = runReplay(createKernel(modules), data, JSON.parse(JSON.stringify({
      dataVersion: data.version, initial: start, steps,
    })));
    expect(replayed.rejected).toEqual([]);
    expect(replayed.failures).toEqual([]);
    expect(replayed.hash).toBe(hashState(third.state));
  });

  it('rejects malformed or out-of-order persisted transition boundaries', () => {
    const state = initial();
    const clock = { wallTime: START, gameTime: 100, timeScale: 24, running: true };
    for (const coalitionTransitions of [
      [{ wallTime: START, gameTime: 101, timeScale: 2 }],
      [{ wallTime: START, gameTime: 0, timeScale: 0 }],
      [{ wallTime: START, gameTime: 50, timeScale: 2 }, { wallTime: START, gameTime: 40, timeScale: 48 }],
    ]) {
      expect(() => new MatchRoom({
        id: 'invalid', initialState: state, kernel: createKernel(modules), data,
        initialClock: { ...clock, coalitionTransitions }, now: () => START,
      })).toThrow('E_CLOCK_SNAPSHOT');
    }
  });
});
