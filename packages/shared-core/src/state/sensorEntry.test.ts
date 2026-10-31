import { expect, it } from 'vitest';
import { sensorEntry } from './sensorEntry';
it('uses arc length on a bent road, rather than the straight chord', () => {
  expect(
    sensorEntry(
      [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 10 },
      ],
      { x: 10, y: 10 },
      2,
    ),
  ).toBeCloseTo(0.9);
  expect(
    sensorEntry(
      [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
      ],
      { x: 5, y: 10 },
      1,
    ),
  ).toBeNull();
  expect(
    sensorEntry(
      [
        { x: 0, y: 0 },
        { x: 0, y: 0 },
        { x: 10, y: 0 },
      ],
      { x: 0, y: 0 },
      1,
    ),
  ).toBe(0);
});
