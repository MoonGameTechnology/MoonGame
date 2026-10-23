import { describe, expect, it } from 'vitest';
import {
  TUTORIAL_MEDAL_SERVERS,
  claimTutorialMedal,
  earnTutorialMedal,
  parseTutorialMedal,
  tutorialMedalPending,
} from './tutorialMedal';

describe('tutorial medal on the device', () => {
  it('is earned only by the whole course, and the award window opens once', () => {
    const fresh = parseTutorialMedal(null);
    expect(earnTutorialMedal(fresh, { completed: true, assaultWon: false }).fresh).toBe(false);
    expect(earnTutorialMedal(fresh, { completed: false, assaultWon: true }).fresh).toBe(false);
    const first = earnTutorialMedal(fresh, { completed: true, assaultWon: true });
    expect(first).toEqual({ record: { earned: true, claimed: [] }, fresh: true });
    const replay = earnTutorialMedal(first.record, { completed: true, assaultWon: true });
    expect(replay).toEqual({ record: first.record, fresh: false });
  });

  it('is claimed once per server and survives a round trip through storage', () => {
    let record = earnTutorialMedal(parseTutorialMedal(null), {
      completed: true,
      assaultWon: true,
    }).record;
    expect(tutorialMedalPending(record, 'https://a')).toBe(true);
    record = claimTutorialMedal(record, 'https://a');
    expect(tutorialMedalPending(record, 'https://a')).toBe(false);
    expect(tutorialMedalPending(record, 'https://b')).toBe(true);
    expect(claimTutorialMedal(record, 'https://a')).toBe(record);
    expect(parseTutorialMedal(JSON.stringify(record))).toEqual(record);
    for (let i = 0; i < TUTORIAL_MEDAL_SERVERS + 3; i++)
      record = claimTutorialMedal(record, `https://s${i}`);
    expect(record.claimed).toHaveLength(TUTORIAL_MEDAL_SERVERS);
    expect(record.claimed.at(-1)).toBe(`https://s${TUTORIAL_MEDAL_SERVERS + 2}`);
  });

  it('nothing to claim before the medal is earned', () => {
    const fresh = parseTutorialMedal(null);
    expect(tutorialMedalPending(fresh, 'https://a')).toBe(false);
    expect(claimTutorialMedal(fresh, 'https://a')).toBe(fresh);
  });

  it('malformed storage reads as not earned', () => {
    for (const raw of ['{', '[]', 'null', '{"earned":"yes"}', '{"earned":1}'])
      expect(parseTutorialMedal(raw)).toEqual({ earned: false, claimed: [] });
    expect(parseTutorialMedal('{"earned":true,"claimed":[1,"",null,"https://a"]}')).toEqual({
      earned: true,
      claimed: ['https://a'],
    });
    expect(parseTutorialMedal('{"earned":true,"claimed":"https://a"}')).toEqual({
      earned: true,
      claimed: [],
    });
  });
});
