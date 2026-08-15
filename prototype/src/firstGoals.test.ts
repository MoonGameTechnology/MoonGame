import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  FIRST_GOALS,
  goalsComplete,
  mergeDone,
  metGoals,
  SCORE_GOAL,
  type GoalSignals,
} from './firstGoals';

const NONE: GoalSignals = {
  builtMine: false,
  launchedFleet: false,
  capturedWorld: false,
  score: 0,
};

describe('metGoals — each goal closes on its own signal', () => {
  it('is empty with no progress', () => {
    expect(metGoals(NONE).size).toBe(0);
  });

  it('closes the mine goal when a mine is built', () => {
    expect(metGoals({ ...NONE, builtMine: true })).toEqual(new Set(['mine']));
  });

  it('closes the fleet goal when a fleet is launched', () => {
    expect(metGoals({ ...NONE, launchedFleet: true })).toEqual(new Set(['fleet']));
  });

  it('closes the capture goal when a world is taken', () => {
    expect(metGoals({ ...NONE, capturedWorld: true })).toEqual(new Set(['capture']));
  });

  it('closes the score goal only at the threshold', () => {
    expect(metGoals({ ...NONE, score: SCORE_GOAL - 1 }).has('score')).toBe(false);
    expect(metGoals({ ...NONE, score: SCORE_GOAL }).has('score')).toBe(true);
  });
});

describe('mergeDone — monotonic', () => {
  it('adds newly-met goals in canonical order', () => {
    let done = mergeDone([], metGoals({ ...NONE, builtMine: true }));
    expect(done).toEqual(['mine']);
    done = mergeDone(done, metGoals({ ...NONE, capturedWorld: true }));
    expect(done).toEqual(['mine', 'capture']); // order follows FIRST_GOALS
  });

  it('never un-ticks a goal even if its signal drops', () => {
    const done = mergeDone(['mine'], metGoals(NONE)); // mine signal now false
    expect(done).toEqual(['mine']); // stays done
  });

  it('does not duplicate an already-done goal', () => {
    expect(mergeDone(['fleet'], new Set(['fleet']))).toEqual(['fleet']);
  });
});

describe('goalsComplete', () => {
  it('is true only when every goal is done', () => {
    expect(goalsComplete([])).toBe(false);
    expect(goalsComplete(['mine', 'fleet', 'capture'])).toBe(false);
    const all = FIRST_GOALS.map((g) => g.id);
    expect(goalsComplete(all)).toBe(true);
  });

  it('is reached by folding the full-progress signals', () => {
    const done = mergeDone(
      [],
      metGoals({ builtMine: true, launchedFleet: true, capturedWorld: true, score: 150 }),
    );
    expect(goalsComplete(done)).toBe(true);
  });
});

// The PC placement is one CSS line in build.mjs with no other guard: the phone anchor
// (top:52px, right edge) put the box on the top bar and on the right-docked panel, and
// the left column only works while the box also clears the tool rail horizontally.
describe('CSS: the PC checklist is docked left, below the bar and clear of the rail', () => {
  const css = readFileSync(fileURLToPath(new URL('../build.mjs', import.meta.url)), 'utf8');
  const pcRule = css.split('\n').find((l) => /^\s*#goals\{.*left:/.test(l));

  it('has a PC rule at all — otherwise this test guards nothing', () => {
    expect(pcRule).toBeDefined();
  });

  it('drops the right anchor and starts below the top bar + devline', () => {
    expect(pcRule).toMatch(/right:auto/);
    expect(pcRule).toMatch(/top:calc\(var\(--tbh\)/);
  });

  it('sits right of the tool rail (left:10px + its ~50px tool list)', () => {
    const left = Number(/left:(\d+)px/.exec(pcRule ?? '')?.[1]);
    expect(left).toBeGreaterThanOrEqual(60);
  });
});
