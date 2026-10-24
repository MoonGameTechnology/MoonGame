import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { FIRST_GOALS, goalsComplete, mergeDone, metGoals, type GoalSignals } from './firstGoals';

const NONE = Object.fromEntries(FIRST_GOALS.map((g) => [g.id, false])) as GoalSignals;
const ALL = Object.fromEntries(FIRST_GOALS.map((g) => [g.id, true])) as GoalSignals;

describe('FIRST_GOALS — one goal per lesson chapter (ONB-15)', () => {
  it('follows the chapters in the order the lesson teaches them', () => {
    expect(FIRST_GOALS.map((g) => g.id)).toEqual([
      'mine',
      'research',
      'fleet',
      'capture',
      'market',
      'hero',
      'ground',
      'aviation',
      'landing',
      'assault',
    ]);
  });

  it('labels every goal with its own locale key', () => {
    for (const g of FIRST_GOALS) expect(g.labelKey).toBe(`onb.goal.${g.id}`);
  });
});

describe('metGoals — each goal closes on its own signal', () => {
  it('is empty with no progress', () => {
    expect(metGoals(NONE).size).toBe(0);
  });

  it.each(FIRST_GOALS.map((g) => g.id))('closes only "%s" on its signal', (id) => {
    expect(metGoals({ ...NONE, [id]: true })).toEqual(new Set([id]));
  });
});

describe('mergeDone — monotonic', () => {
  it('adds newly-met goals in canonical order', () => {
    let done = mergeDone([], metGoals({ ...NONE, mine: true }));
    expect(done).toEqual(['mine']);
    done = mergeDone(done, metGoals({ ...NONE, capture: true }));
    expect(done).toEqual(['mine', 'capture']); // order follows FIRST_GOALS
  });

  it('never un-ticks a goal even if its signal drops', () => {
    // The bomber leaves the hold for the strike: the aviation goal stays done.
    const done = mergeDone(['aviation'], metGoals(NONE));
    expect(done).toEqual(['aviation']);
  });

  it('does not duplicate an already-done goal', () => {
    expect(mergeDone(['fleet'], new Set(['fleet']))).toEqual(['fleet']);
  });
});

describe('goalsComplete', () => {
  it('is true only when every goal is done', () => {
    expect(goalsComplete([])).toBe(false);
    expect(goalsComplete(['mine', 'research', 'fleet', 'capture'])).toBe(false);
    const all = FIRST_GOALS.map((g) => g.id);
    expect(goalsComplete(all)).toBe(true);
  });

  it('is reached by folding the full-progress signals', () => {
    expect(goalsComplete(mergeDone([], metGoals(ALL)))).toBe(true);
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
