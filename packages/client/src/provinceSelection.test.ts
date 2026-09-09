import { describe, expect, it } from 'vitest';
import { computePowerCells } from './territory';
import { insideProvince, selectionPulse } from './provinceSelection';

describe('province selection uses the painted map', () => {
  const cells = computePowerCells(
    [
      { x: 20, y: 30, w: 40, owner: null, kind: 'planet' },
      { x: 80, y: 60, w: 90, owner: 'p1', kind: 'nebula' },
    ],
    [
      [0, 0],
      [100, 0],
      [100, 100],
      [0, 100],
    ],
  );

  it('selects the actual weighted province away from its node, but never outside the map', () => {
    expect(cells.filter((c) => insideProvince(c.poly, 5, 90)).map((c) => c.idx)).toEqual([0]);
    expect(cells.filter((c) => insideProvince(c.poly, 95, 10)).map((c) => c.idx)).toEqual([1]);
    for (const c of cells) expect(insideProvince(c.poly, -1, 50)).toBe(false);
  });

  it('follows the same outline after pan/zoom and accepts both polygon windings', () => {
    const poly = cells[0]!.poly.map(([x, y]): [number, number] => [x * 2 - 30, y * 2 + 15]);
    expect(insideProvince(poly, 5 * 2 - 30, 90 * 2 + 15)).toBe(true);
    expect(insideProvince([...poly].reverse(), 5 * 2 - 30, 90 * 2 + 15)).toBe(true);
    expect(insideProvince(poly, poly[0]![0], poly[0]![1])).toBe(true);
    expect(insideProvince([], 0, 0)).toBe(false);
  });

  it('settles after one short pulse and remains static with reduced motion', () => {
    expect(selectionPulse(0, true)).toBe(1);
    expect(selectionPulse(325, true)).toBeGreaterThan(0);
    expect(selectionPulse(650, true)).toBe(0);
    expect(selectionPulse(0, false)).toBe(0);
    expect(selectionPulse(1e9, true)).toBe(0);
  });
});
