import { expect, it } from 'vitest';
import { sensorEntry, sensorExit } from './sensorEntry';
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

it('sensorExit: the first arc-length fraction where the road leaves the circle after being in it', () => {
  const road = [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 200, y: 0 },
  ];
  // Starts inside (centre at the start): leaves at 40 of 200.
  expect(sensorExit(road, { x: 0, y: 0 }, 40)).toBeCloseTo(0.2);
  // Enters at 60 and leaves at 140 — on the second segment.
  expect(sensorExit(road, { x: 100, y: 0 }, 40)).toBeCloseTo(0.7);
  // Still inside at the end: no exit.
  expect(sensorExit(road, { x: 190, y: 0 }, 40)).toBeNull();
  // Never inside: no exit.
  expect(sensorExit(road, { x: 100, y: 100 }, 40)).toBeNull();
  // A bend: in on the first leg, out on the second (arc length, not the chord).
  expect(
    sensorExit(
      [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 10 },
      ],
      { x: 10, y: 0 },
      2,
    ),
  ).toBeCloseTo(0.6);
});

it('sensorExit: a zero-length first leg still counts the start as inside', () => {
  expect(
    sensorExit(
      [
        { x: 0, y: 0 },
        { x: 0, y: 0 },
        { x: 10, y: 0 },
      ],
      { x: 0, y: 0 },
      2,
    ),
  ).toBeCloseTo(0.2);
});
