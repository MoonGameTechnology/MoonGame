import { describe, it, expect } from 'vitest';
import { accountLevel, parseCareer } from './playerCareer';
import { parsePlayerProfile } from './playerProfile';
import { defaultAppearance } from '../packages/protocol/src/playerProfile';
const career = {
  matches: 2,
  wins: 1,
  since: 100,
  pvp: { destroyed: 4, lost: 2, destroyedCost: { metal: 80 }, lostCost: { metal: 40 } },
  modes: { duel: { matches: 2, wins: 1 } },
};
describe('account career read boundary', () => {
  it('derives the established progression without looping over all levels', () => {
    expect(accountLevel(0)).toEqual({ level: 1, earned: 0, needed: 100 });
    expect(accountLevel(100)).toEqual({ level: 2, earned: 0, needed: 150 });
    expect(accountLevel(249)).toEqual({ level: 2, earned: 149, needed: 150 });
    expect(accountLevel(250).level).toBe(3);
    expect(accountLevel(Number.MAX_SAFE_INTEGER).level).toBeGreaterThan(1);
  });
  it('accepts only bounded nonnegative counters, costs and dates', () => {
    expect(parseCareer(career)).toEqual(career);
    expect(parseCareer({ ...career, wins: 3 })).toBeNull();
    expect(parseCareer({ ...career, since: Infinity })).toBeNull();
    expect(parseCareer({ ...career, pvp: { ...career.pvp, lost: -1 } })).toBeNull();
    expect(parseCareer({ ...career, pvp: { ...career.pvp, lostCost: { metal: NaN } } })).toBeNull();
  });
  it('preserves legacy absence, distinguishes no corporation and validates current membership', () => {
    const profile = { ...defaultAppearance(), login: 'Alice', xp: 25, progress: {} };
    expect(parsePlayerProfile(profile)?.career).toBeUndefined();
    expect(
      parsePlayerProfile({ ...profile, career: null, corporation: null })?.corporation,
    ).toBeNull();
    expect(
      parsePlayerProfile({
        ...profile,
        career,
        statistics: { matches: 2, wins: 1 },
        corporation: { id: 'corp-1', name: 'Example' },
      })?.career,
    ).toEqual(career);
    expect(
      parsePlayerProfile({ ...profile, corporation: { id: '../wrong', name: 'Example' } }),
    ).toBeNull();
    expect(parsePlayerProfile({ ...profile, career: { ...career, wins: 9 } })).toBeNull();
    expect(parsePlayerProfile({ ...profile, xp: 1e308 })).toBeNull();
  });
});
