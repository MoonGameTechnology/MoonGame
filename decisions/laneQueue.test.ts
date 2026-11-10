import { describe, expect, it } from 'vitest';
import { laneCanResume, laneReadyTimes, laneVisibleRows } from './laneQueue';

describe('lane queue', () => {
  it('a waiting order is ready after everything ahead of it', () => {
    expect(laneReadyTimes(100, [{ at: 130 }, { duration: 20 }, { duration: 5 }])).toEqual([130, 150, 155]);
  });

  it('an idle lane starts the first waiting order now', () => {
    expect(laneReadyTimes(100, [{ duration: 20 }])).toEqual([120]);
  });

  it('an unknown duration hides every later time instead of guessing', () => {
    expect(laneReadyTimes(0, [{ at: 10 }, {}, { duration: 5 }])).toEqual([10, undefined, undefined]);
  });

  it('folds to the running row only when there are more than two rows', () => {
    expect(laneVisibleRows(2, false)).toBe(2);
    expect(laneVisibleRows(6, false)).toBe(1);
    expect(laneVisibleRows(6, true)).toBe(6);
  });

  it('resume is offered only when nothing runs in the lane', () => {
    expect(laneCanResume([{ duration: 5 }])).toBe(true);
    expect(laneCanResume([{ at: 10 }, { duration: 5 }])).toBe(false);
  });
});
