import { describe, expect, it } from 'vitest';
import { splitCorporateMatches } from './corporateMatches';

describe('corporate matches tab', () => {
  it('separates battles while preserving membership and archive actions', () => {
    const lists = {
      available: [{ matchId: '48219370' }, { matchId: 'ava-join' }],
      active: [{ matchId: 'ava-live' }, { matchId: '48219371' }],
      archived: [{ matchId: 'ava-done' }, { matchId: '48219372' }],
    };
    expect(splitCorporateMatches(lists)).toEqual({
      available: [{ matchId: '48219370' }],
      active: [{ matchId: '48219371' }],
      archived: [{ matchId: '48219372' }],
      corporate: [
        { match: { matchId: 'ava-live' }, source: 'active' },
        { match: { matchId: 'ava-join' }, source: 'available' },
        { match: { matchId: 'ava-done' }, source: 'archived' },
      ],
    });
    expect(lists.active).toHaveLength(2);
  });
  it('keeps an unavailable feed unknown and deduplicates overlapping battle entries', () => {
    expect(splitCorporateMatches(null)).toBeNull();
    const one = { matchId: 'ava-live' };
    expect(splitCorporateMatches({ active: [one], available: [one] })!.corporate).toEqual([
      { match: one, source: 'active' },
    ]);
  });
});
