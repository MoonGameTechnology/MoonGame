import { describe, expect, it } from 'vitest';
import { shelfAt } from './auctionShelf';

describe('auction shelf', () => {
  const rule = { base: 6, unlockXp: [6750, 3850] };

  it('opens the base slots and lists the closed ones by threshold', () => {
    expect(shelfAt(rule, 0)).toEqual({ open: 6, lockedXp: [3850, 6750] });
  });

  it('opens one slot per reached threshold', () => {
    expect(shelfAt(rule, 3850)).toEqual({ open: 7, lockedXp: [6750] });
    expect(shelfAt(rule, 10_000)).toEqual({ open: 8, lockedXp: [] });
  });
});
