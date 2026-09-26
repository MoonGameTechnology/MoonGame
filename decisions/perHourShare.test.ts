import { describe, expect, it } from 'vitest';
import { isPerHourShare, perHourPercent } from './perHourShare';

describe('per-hour share stats', () => {
  it('marks shield regen and hull repair as shares per hour, nothing else', () => {
    expect(isPerHourShare('shieldRegen')).toBe(true);
    expect(isPerHourShare('hullRepair')).toBe(true);
    expect(isPerHourShare('hp')).toBe(false);
    expect(isPerHourShare('cargoCapacity')).toBe(false);
  });

  it('shows a share as percent per hour, rounded to tenths', () => {
    expect(perHourPercent(0.05)).toBe(5);
    expect(perHourPercent(0.02)).toBe(2);
    expect(perHourPercent(0.019)).toBe(1.9);
    expect(perHourPercent(0)).toBe(0);
  });
});
