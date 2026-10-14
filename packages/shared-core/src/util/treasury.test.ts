import { describe, it, expect } from 'vitest';
import { canAfford } from './treasury';

describe('canAfford', () => {
  it('covers every line, a missing line counts as zero', () => {
    expect(canAfford({ metal: 10, energy: 5 }, { metal: 10 })).toBe(true);
    expect(canAfford({ metal: 9 }, { metal: 10 })).toBe(false);
    expect(canAfford({}, { metal: 0 })).toBe(true);
  });

  it('a non-numeric line on either side is "cannot afford"', () => {
    expect(canAfford({ credits: Number.NaN }, { credits: 100 })).toBe(false);
    expect(canAfford({ credits: 100 }, { credits: Number.NaN })).toBe(false);
  });
});
