import { describe, expect, it } from 'vitest';
import { parseGameData, type Fleet } from '../packages/shared-core/src/index';
import { fleetHolds, holdBadgePosition } from './fleetHolds';

const data = parseGameData({
  version: '0.1.0',
  resources: ['metal'],
  factions: {},
  buildings: {},
  events: {},
  units: {
    carrier: {
      faction: 'x',
      domain: 'space',
      stats: { attack: 0, defense: 0, speed: 1, hp: 100, cargoCapacity: 10, shuttleBay: 6 },
    },
    scout: { faction: 'x', domain: 'space', stats: { attack: 0, defense: 0, speed: 1, hp: 10 } },
    tank: {
      faction: 'x',
      domain: 'ground',
      stats: { attack: 0, defense: 0, speed: 1, hp: 40, cargoSize: 3 },
    },
    infantry: {
      faction: 'x',
      domain: 'ground',
      stats: { attack: 0, defense: 0, speed: 1, hp: 10, cargoSize: 1 },
    },
    bomber: {
      faction: 'x',
      domain: 'space',
      traits: ['shuttle'],
      stats: { attack: 0, defense: 0, speed: 1, hp: 10 },
    },
  },
});

describe('hold badge placement', () => {
  it('keeps the entire horizontal badge outside a narrow orbit in every quadrant', () => {
    const width = 80,
      height = 36,
      radius = 15.5;
    for (let i = 0; i < 24; i++) {
      const angle = (i * Math.PI) / 12;
      const nx = Math.cos(angle),
        ny = Math.sin(angle);
      const ship = { x: nx * radius, y: ny * radius };
      const box = holdBadgePosition(ship, { x: 0, y: 0 }, width, height);
      for (const x of [box.x, box.x + width])
        for (const y of [box.y, box.y + height])
          expect((x - ship.x) * nx + (y - ship.y) * ny).toBeGreaterThanOrEqual(18 - 1e-9);
    }
  });

  it('keeps an in-flight reading below the ship and handles coincident anchors', () => {
    const ship = { x: 40, y: 50 };
    expect(holdBadgePosition(ship, null, 60, 30)).toEqual({ x: 10, y: 68 });
    expect(holdBadgePosition(ship, ship, 60, 30)).toEqual({ x: 10, y: 68 });
  });
});
const fleet = (over: Partial<Fleet> = {}): Fleet => ({
  id: 'f',
  owner: 'p',
  location: 'home',
  movement: null,
  traits: [],
  units: [{ unit: 'carrier', count: 1 }],
  ...over,
});
const claim = { unit: 'tank', count: 2, from: 'home', startAt: 0, doneAt: 100 };

describe('fleet hold occupancy', () => {
  it('counts ground volume and hangar machines independently', () => {
    const meters = fleetHolds(
      fleet({
        landing: [{ unit: 'tank', count: 2 }],
        hangar: [
          { id: 's1', units: [{ unit: 'bomber', count: 3 }] },
          { id: 's2', units: [{ unit: 'bomber', count: 1 }] },
        ],
      }),
      data,
      0,
    );
    expect(meters).toMatchObject([
      { kind: 'troops', used: 6, capacity: 10, free: 4, reserved: 0 },
      { kind: 'hangar', used: 4, capacity: 6, free: 2 },
    ]);
  });

  it('shows an empty hold but omits a fleet with no transport space', () => {
    expect(fleetHolds(fleet(), data, 0)).toMatchObject([
      { kind: 'troops', used: 0, capacity: 10, free: 10 },
      { kind: 'hangar', used: 0, capacity: 6, free: 6 },
    ]);
    expect(fleetHolds(fleet({ units: [{ unit: 'scout', count: 1 }] }), data, 0)).toEqual([]);
  });

  it('reserves the entire load before arrival and does not pretend it is aboard', () => {
    const f = fleet({ landing: [{ unit: 'infantry', count: 1 }], loading: [claim] });
    const before = structuredClone(f);
    expect(fleetHolds(f, data, 25)[0]).toMatchObject({
      used: 1,
      reserved: 6,
      free: 3,
      usedFraction: 0.1,
      reservedFraction: 0.6,
      loadingProgress: 0.25,
    });
    // The snapshot, not the local animation clock, transfers custody.
    expect(fleetHolds(f, data, 200)[0]).toMatchObject({ used: 1, reserved: 6, loadingProgress: 1 });
    expect(f).toEqual(before);
    expect(fleetHolds({ ...f, loading: [] }, data, 25)[0]).toMatchObject({ reserved: 0, free: 9 });
    expect(
      fleetHolds(
        {
          ...f,
          loading: [],
          landing: [
            { unit: 'tank', count: 2 },
            { unit: 'infantry', count: 1 },
          ],
        },
        data,
        100,
      )[0],
    ).toMatchObject({ used: 7, reserved: 0, free: 3 });
  });

  it('bounds the bar after capacity loss without hiding the excess in its numbers', () => {
    const meter = fleetHolds(
      fleet({ landing: [{ unit: 'tank', count: 4 }], loading: [claim] }),
      data,
      50,
    )[0]!;
    expect(meter).toMatchObject({
      used: 12,
      capacity: 10,
      reserved: 6,
      free: 0,
      over: 8,
      usedFraction: 1,
      reservedFraction: 0,
    });
  });

  it('zero-length and not-yet-started loading windows never produce invalid progress', () => {
    expect(
      fleetHolds(fleet({ loading: [{ ...claim, doneAt: 0 }] }), data, 0)[0]!.loadingProgress,
    ).toBe(1);
    expect(fleetHolds(fleet({ loading: [claim] }), data, -20)[0]!.loadingProgress).toBe(0);
  });
});
