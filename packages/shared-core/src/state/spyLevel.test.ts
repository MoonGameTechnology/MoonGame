import { describe, expect, it } from 'vitest';
import { SPY_LEVEL_THRESHOLDS, spyLevel, spyLevelBonus, splitGuardXp } from './spyLevel';

describe('spyLevel', () => {
  it('needs new points per level: totals 1 / 3 / 7', () => {
    expect(SPY_LEVEL_THRESHOLDS).toEqual([1, 3, 7]);
    expect([0, 0.75, 1, 2.75, 3, 6.75, 7, 50].map(spyLevel)).toEqual([0, 0, 1, 1, 2, 2, 3, 3]);
  });

  it('reads broken input as a recruit', () => {
    expect(spyLevel(undefined)).toBe(0);
    expect(spyLevel(Number.NaN)).toBe(0);
    expect(spyLevel(-1)).toBe(0);
  });
});

describe('spyLevelBonus', () => {
  it('grows by level and stops at 3', () => {
    expect(spyLevelBonus('chance', 0)).toBe(0);
    expect(spyLevelBonus('chance', 3)).toBeCloseTo(0.15);
    expect(spyLevelBonus('speed', 2)).toBeCloseTo(0.2);
    expect(spyLevelBonus('quality', 9)).toBeCloseTo(0.3);
  });
});

describe('splitGuardXp', () => {
  it('gives a lone guard everything', () => {
    expect(splitGuardXp(1.25, [0])).toEqual([1.25]);
  });

  it('weighs by experience, rounds down to 0.25, rest to the veteran', () => {
    expect(splitGuardXp(1, [5, 0])).toEqual([0.75, 0.25]);
    expect(splitGuardXp(1, [0, 5, 2])).toEqual([0, 0.75, 0.25]);
    expect(splitGuardXp(0.5, [0, 3])).toEqual([0, 0.5]);
    expect(splitGuardXp(1.25, [1, 4])).toEqual([0.25, 1]);
    expect(splitGuardXp(1.25, [7, 3, 1])).toEqual([1, 0.25, 0]);
  });

  it('never loses or invents points, and breaks ties by input order', () => {
    for (let n = 1; n <= 6; n++) {
      const split = splitGuardXp(1.25, new Array<number>(n).fill(2));
      expect(split.reduce((a, b) => a + b, 0)).toBe(1.25);
      expect(split[0]).toBe(Math.max(...split));
    }
  });
});
