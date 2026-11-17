import { describe, expect, it } from 'vitest';
import { STAR_CLASSES, starClassAt } from './starClass';

describe('starClassAt — the star at the heart of a solar-flare zone', () => {
  it('is the same star for the same place, on every call', () => {
    expect(starClassAt(1234, -567)).toBe(starClassAt(1234, -567));
    expect(starClassAt(1234.2, -566.8)).toBe(starClassAt(1234, -567));
  });

  it('reaches every class over a map, with no class taking more than half of the places', () => {
    const seen = new Map<string, number>();
    for (let x = -2000; x <= 2000; x += 137) {
      for (let y = -2000; y <= 2000; y += 151) {
        const c = starClassAt(x, y);
        seen.set(c, (seen.get(c) ?? 0) + 1);
      }
    }
    expect([...seen.keys()].sort()).toEqual([...STAR_CLASSES].sort());
    const total = [...seen.values()].reduce((a, b) => a + b, 0);
    for (const n of seen.values()) expect(n / total).toBeLessThan(0.5);
  });
});
