import { describe, it, expect } from 'vitest';
import { SPY_SHIP_SHAPES, spyShipOf } from './spyShipShapes';

describe('SPM-1 — корабль шпиона', () => {
  it('один и тот же шпион всегда на одном корабле', () => {
    expect(spyShipOf('p1', 2, 1)).toBe(spyShipOf('p1', 2, 1));
  });

  it('выпадают все три силуэта', () => {
    const seen = new Set<string>();
    for (let id = 1; id <= 8; id++)
      for (let gen = 1; gen <= 4; gen++) seen.add(spyShipOf('p1', id, gen));
    expect([...seen].sort()).toEqual(Object.keys(SPY_SHIP_SHAPES).sort());
  });

  it('силуэты в сетке 24×24', () => {
    for (const shape of Object.values(SPY_SHIP_SHAPES)) {
      const nums = shape.hull.match(/-?\d+(\.\d+)?/g)!.map(Number);
      expect(Math.min(...nums)).toBeGreaterThanOrEqual(0);
      expect(Math.max(...nums)).toBeLessThanOrEqual(24);
    }
  });
});
