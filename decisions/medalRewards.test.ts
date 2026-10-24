import { describe, expect, it } from 'vitest';
import { medalRewardTotals, parseMedalRewards } from './medalRewards';

const row = { medalId: 'first', grade: 3, sovereigns: 10, warrants: 20, xp: 50 };

describe('parseMedalRewards', () => {
  it('takes a known grant list, an empty one included', () => {
    expect(parseMedalRewards([row])).toEqual([row]);
    expect(parseMedalRewards([])).toEqual([]);
  });

  it('rejects the whole answer for one unknown or malformed row', () => {
    expect(parseMedalRewards(null)).toBeNull();
    expect(parseMedalRewards({ granted: [row] })).toBeNull();
    expect(parseMedalRewards([row, { ...row, medalId: 'nonexistent' }])).toBeNull();
    expect(parseMedalRewards([{ ...row, grade: 4 }])).toBeNull();
    // The tutorial medal has one degree only: class II does not exist.
    expect(parseMedalRewards([{ ...row, medalId: 'tutorial', grade: 2 }])).toBeNull();
    expect(parseMedalRewards([{ ...row, sovereigns: -1 }])).toBeNull();
    expect(parseMedalRewards([{ ...row, xp: 1.5 }])).toBeNull();
    expect(parseMedalRewards([{ ...row, warrants: '20' }])).toBeNull();
  });

  it('the total is the sum of the rows the server paid', () => {
    expect(
      medalRewardTotals([
        row,
        { ...row, medalId: 'tutorial', sovereigns: 10, warrants: 0, xp: 0 },
      ] as never),
    ).toEqual({ sovereigns: 20, warrants: 20, xp: 50 });
  });
});
