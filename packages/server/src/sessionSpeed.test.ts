import { describe, expect, it } from 'vitest';
import { createInitialState, createKernel, parseGameData } from '@void/shared-core';
import { MatchRoom } from './matchRoom';
import { snapshotOf } from './persistence';
import { sessionSpeed } from './sessionSpeed';

describe('persistent per-session speed', () => {
  it('seeds a requested speed and keeps the server default for ordinary creation', () => {
    expect(sessionSpeed(undefined, 24, 2)).toBe(2);
    expect(sessionSpeed(undefined, 24)).toBe(24);
  });
  it.each([NaN, Infinity, 0, -1])('refuses a broken saved clock instead of changing its rules (%s)', (timeScale) => {
    expect(() => sessionSpeed({ timeScale, wallTime: 0, gameTime: 0, running: true }, 24)).toThrow('E_BAD_MATCH_CLOCK');
  });
  it('restores x2 despite a x24 host default and continues at two game milliseconds per real millisecond', () => {
    let wall = 100_000;
    const data = parseGameData({ version: 't', resources: ['credits'], units: {}, factions: {}, buildings: {}, events: {}, sectors: {}, planetTypes: {} });
    const state = createInitialState({ seed: 'speed', version: { data: 't', manifest: 't' } });
    const first = new MatchRoom({ id: 'x2', kernel: createKernel([]), data, initialState: state,
      now: () => wall, initiallyStarted: true, timeScale: sessionSpeed(undefined, 24, 2) });
    wall += 1000;
    const saved = snapshotOf(first);
    wall += 5000;
    const restored = new MatchRoom({ id: 'x2', kernel: createKernel([]), data, initialState: saved.state,
      now: () => wall, initiallyStarted: true, initialClock: saved.clock,
      timeScale: sessionSpeed(saved.clock, 24) });
    expect(restored.clockScale).toBe(2);
    expect(snapshotOf(restored).clock?.gameTime).toBe(12_000);
    wall += 1000;
    expect(snapshotOf(restored).clock?.gameTime).toBe(14_000);
    expect(sessionSpeed({ ...saved.clock!, timeScale: 24 }, 2)).toBe(24);
  });
});
