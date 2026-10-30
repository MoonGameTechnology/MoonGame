import { describe, expect, it } from 'vitest';
import {
  defaultAppearance,
  medalGrade,
  parseAppearance,
} from '../packages/protocol/src/playerProfile';
import { parsePlayerProfile, placeProfileMedal, tunicFit } from './playerProfile';

describe('profile customization decisions', () => {
  it('keeps the premium frame only when the server says exactly true', () => {
    const base = { ...defaultAppearance(), login: 'Alice', xp: 0, progress: {} };
    expect(parsePlayerProfile({ ...base, premium: true })?.premium).toBe(true);
    for (const premium of [false, 'true', 1, undefined])
      expect(parsePlayerProfile({ ...base, premium })).not.toHaveProperty('premium');
  });
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
  it('hangs the medal rack on the left breast, about a third of the portrait wide', () => {
    // Owner, 2026-10-30: the medals on the chest must be large enough to tell apart.
    for (let portrait = 1; portrait <= 40; portrait++) {
      const fit = /left:([\d.]+)%;top:([\d.]+)%;width:([\d.]+)%/.exec(tunicFit(portrait))!;
      const [left, top, width] = [Number(fit[1]), Number(fit[2]), Number(fit[3])];
      expect(width).toBeGreaterThanOrEqual(29.5);
      expect(left).toBeGreaterThanOrEqual(50);
      expect(left + width).toBeLessThanOrEqual(85);
      expect(top).toBeGreaterThanOrEqual(57);
      expect(top).toBeLessThanOrEqual(59);
    }
  });
  it('retains the bot marker and only public fields of completed-match history', () => {
    const match = {
      matchId: 'm-finished',
      mapId: 'nexus',
      endedAt: 1_800_000_000_000,
      outcome: 'win',
      xp: 245,
      place: 1,
    };
    const raw = {
      ...defaultAppearance(),
      login: '~Orion',
      kind: 'bot',
      xp: 245,
      progress: { matches: 1, wins: 1 },
      recentMatches: [{ ...match, botId: 'bot-001', playerId: 'p3' }],
    };
    expect(parsePlayerProfile(raw)).toEqual({ ...raw, recentMatches: [match] });
    expect(parsePlayerProfile({ ...raw, recentMatches: [] })?.recentMatches).toEqual([]);
    expect(parsePlayerProfile({ ...raw, recentMatches: undefined })?.kind).toBe('bot');
    expect(
      parsePlayerProfile({ ...raw, kind: undefined, recentMatches: undefined }),
    ).not.toHaveProperty('kind');
  });
  it('rejects malformed, unbounded or URL-based bot history', () => {
    const match = {
      matchId: 'm-finished',
      mapId: 'nexus',
      endedAt: 1_800_000_000_000,
      outcome: 'win',
      xp: 245,
      place: 1,
    };
    const raw = {
      ...defaultAppearance(),
      login: '~Orion',
      kind: 'bot',
      xp: 245,
      progress: { matches: 1, wins: 1 },
      recentMatches: [match],
    };
    for (const patch of [
      { kind: 'human' },
      { kind: undefined },
      { xp: 1.5 },
      { recentMatches: {} },
      { recentMatches: Array.from({ length: 11 }, (_, i) => ({ ...match, matchId: `m-${i}` })) },
      ...[
        { matchId: '' },
        { matchId: 'x'.repeat(129) },
        { matchId: 'https://evil.test/match' },
        { mapId: '../nexus' },
        { endedAt: -1 },
        { endedAt: Number.MAX_SAFE_INTEGER },
        { xp: -1 },
        { xp: 1.5 },
        { place: 0 },
        { place: 1.5 },
        { outcome: 'ongoing' },
      ].map((bad) => ({ recentMatches: [{ ...match, ...bad }] })),
    ])
      expect(parsePlayerProfile({ ...raw, ...patch })).toBeNull();
    expect(
      parsePlayerProfile({ ...raw, recentMatches: [{ ...match, outcome: 'draw', place: null }] })
        ?.recentMatches?.[0]?.place,
    ).toBeNull();
    expect(
      parsePlayerProfile({
        ...raw,
        recentMatches: Array.from({ length: 10 }, (_, i) => ({ ...match, matchId: `m-${i}` })),
      })?.recentMatches,
    ).toHaveLength(10);
  });
});
