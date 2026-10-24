import { describe, expect, it } from 'vitest';
import { earnedMedalGrades } from './playerProfile';

describe('earnedMedalGrades', () => {
  it('lists every reached degree, lower classes included, in medal order', () => {
    expect(earnedMedalGrades({})).toEqual([]);
    // 10 wins jump straight to class II of «first»: class III is reached too.
    expect(earnedMedalGrades({ wins: 10, tutorial: 1 })).toEqual([
      { medalId: 'first', grade: 3 },
      { medalId: 'first', grade: 2 },
      { medalId: 'tutorial', grade: 3 },
    ]);
    // Two medals read the same counter: 100 wins is «first» I and «legend» III.
    expect(earnedMedalGrades({ wins: 100 }).map((g) => `${g.medalId}:${g.grade}`)).toEqual([
      'first:3',
      'first:2',
      'first:1',
      'legend:3',
    ]);
  });
});
