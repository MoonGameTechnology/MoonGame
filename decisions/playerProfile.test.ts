import { describe, expect, it } from 'vitest';
import {
  defaultAppearance,
  medalGrade,
  parseAppearance,
} from '../packages/protocol/src/playerProfile';
import { parsePlayerProfile, placeProfileMedal, tunicFit } from './playerProfile';

describe('profile customization decisions', () => {
  it('moves one medal instead of duplicating it; removing preserves other slots', () => {
    const original = defaultAppearance();
    original.slots[1] = 'first';
    original.slots[14] = 'service';
    const moved = placeProfileMedal(original, 7, 'first');
    expect(moved.slots[1]).toBeNull();
    expect(moved.slots[7]).toBe('first');
    expect(moved.slots[14]).toBe('service');
    expect(original.slots[1]).toBe('first');
    expect(placeProfileMedal(moved, 7, null).slots[7]).toBeNull();
  });
  it('replaces every lower grade automatically at the exact thresholds', () => {
    expect([0, 1, 9, 10, 49, 50, 100].map((wins) => medalGrade('first', { wins }))).toEqual([
      null,
      3,
      3,
      2,
      2,
      1,
      1,
    ]);
  });
  it('bounds every asset index, sanitizes network slots and refuses invalid counters', () => {
    for (let portrait = 1; portrait <= 40; portrait++) {
      expect(parseAppearance({ ...defaultAppearance(), portrait })?.portrait).toBe(portrait);
      expect(tunicFit(portrait)).not.toMatch(/undefined|NaN/);
    }
    const look = defaultAppearance();
    look.slots[0] = 'first';
    const raw = { ...look, login: '<img onerror=alert(1)>', xp: 0, progress: {} };
    expect(parsePlayerProfile(raw)?.slots[0]).toBeNull();
    expect(parsePlayerProfile({ ...raw, progress: { wins: -1 } })).toBeNull();
    expect(parseAppearance({ ...look, portrait: '../evil' })).toBeNull();
  });
});
