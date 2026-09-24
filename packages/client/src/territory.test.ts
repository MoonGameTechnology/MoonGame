import { describe, it, expect } from 'vitest';
import {
  BOUNDARY,
  classifyBorders,
  clipHalfPlane,
  clipHalfPlaneTagged,
  clampPowerWeights,
  computePowerCells,
  computePowerCell,
  type TerritorySeed,
} from './territory';

// The unit square, CCW — the reusable clip fixture for the half-plane primitives.
const SQUARE: Array<[number, number]> = [
  [0, 0],
  [1, 0],
  [1, 1],
  [0, 1],
];

describe('territory — clipHalfPlane (Sutherland–Hodgman)', () => {
  it('clips the unit square to x ≤ 0.5 (keeps the left half)', () => {
    // a*x + b*y + c ≤ 0  →  x ≤ 0.5  with a=1, b=0, c=-0.5
    const out = clipHalfPlane(SQUARE, 1, 0, -0.5);
    expect(out).toEqual([
      [0, 0],
      [0.5, 0],
      [0.5, 1],
      [0, 1],
    ]);
  });

  it('drops the polygon entirely when the whole square is outside the half-plane', () => {
    // x ≤ -1 : every vertex has d > 0, nothing survives
    expect(clipHalfPlane(SQUARE, 1, 0, 1)).toEqual([]);
  });
});

describe('territory — clipHalfPlaneTagged (border provenance)', () => {
  it('tags the newly-cut edge with clipTag and keeps original edges as their tag', () => {
    const tags = SQUARE.map(() => BOUNDARY);
    const { poly, tags: outT } = clipHalfPlaneTagged(SQUARE, tags, 1, 0, -0.5, 7);
    expect(poly).toEqual([
      [0, 0],
      [0.5, 0],
      [0.5, 1],
      [0, 1],
    ]);
    // Only the cut edge (0.5,0)→(0.5,1) — poly[1]→poly[2] — belongs to neighbour 7;
    // the surviving original edges stay on the map boundary.
    expect(outT).toEqual([BOUNDARY, 7, BOUNDARY, BOUNDARY]);
  });
});

describe('territory — clampPowerWeights', () => {
  it('is a no-op for fewer than two seeds', () => {
    const one = [{ x: 0, y: 0, w: 99 }];
    clampPowerWeights(one);
    expect(one[0]!.w).toBe(99);
  });

  it('caps a close, lopsided pair below the swallow threshold while keeping order', () => {
    const seeds = [
      { x: 0, y: 0, w: 1 },
      { x: 30, y: 0, w: 9000 }, // close + huge disparity → would swallow seed 0
    ];
    clampPowerWeights(seeds);
    expect(seeds[1]!.w).toBeGreaterThan(seeds[0]!.w); // bigger world still claims more
    expect(seeds[1]!.w - seeds[0]!.w).toBeLessThanOrEqual(30 * 30); // ≤ d² → no swallow
  });
});

describe('territory — computePowerCells', () => {
  const clip: Array<[number, number]> = [
    [-100, -100],
    [100, -100],
    [100, 100],
    [-100, 100],
  ];

  it('splits two equal-weight seeds at the perpendicular bisector', () => {
    const seeds: TerritorySeed[] = [
      { x: 0, y: 0, w: 500, owner: 'p1', kind: 'planet' },
      { x: 10, y: 0, w: 500, owner: 'p2', kind: 'planet' },
    ];
    const cells = computePowerCells(seeds, clip);
    expect(cells).toHaveLength(2);
    const left = cells.find((c) => c.idx === 0)!;
    const right = cells.find((c) => c.idx === 1)!;
    // Equal weights ⇒ the border is the bisector at x = 5.
    for (const [x] of left.poly) expect(x).toBeLessThanOrEqual(5 + 1e-9);
    for (const [x] of right.poly) expect(x).toBeGreaterThanOrEqual(5 - 1e-9);
    // The shared edge of the left cell is tagged with its neighbour (seed 1).
    expect(left.tags).toContain(1);
    expect(left.owner).toBe('p1');
    expect(right.owner).toBe('p2');
  });

  it('keeps every seed a non-empty cell even with a heavy, close neighbour (no swallow)', () => {
    const seeds: TerritorySeed[] = [
      { x: 0, y: 0, w: 1, owner: 'p1', kind: 'planet' },
      { x: 12, y: 0, w: 9000, owner: 'p2', kind: 'nebula' }, // would swallow seed 0 unclamped
      { x: 0, y: 12, w: 4000, owner: null, kind: 'asteroid' },
    ];
    const cells = computePowerCells(seeds, clip);
    expect(cells).toHaveLength(3); // clamp keeps all three cells non-degenerate
    for (const c of cells) expect(c.poly.length).toBeGreaterThanOrEqual(3);
  });

  it('does not mutate the caller’s seed weights (pure)', () => {
    const seeds: TerritorySeed[] = [
      { x: 0, y: 0, w: 1, owner: 'p1', kind: 'planet' },
      { x: 12, y: 0, w: 9000, owner: 'p2', kind: 'planet' },
    ];
    computePowerCells(seeds, clip);
    expect(seeds[0]!.w).toBe(1);
    expect(seeds[1]!.w).toBe(9000);
  });
});

describe('territory — computePowerCell (single cell, capture flash)', () => {
  const clip: Array<[number, number]> = [
    [-100, -100],
    [100, -100],
    [100, 100],
    [-100, 100],
  ];
  const seeds: TerritorySeed[] = [
    { x: 0, y: 0, w: 1, owner: 'p1', kind: 'planet' },
    { x: 12, y: 0, w: 9000, owner: 'p2', kind: 'nebula' },
    { x: 0, y: 12, w: 4000, owner: null, kind: 'asteroid' },
  ];

  it('matches the same-index cell from computePowerCells exactly (identical clamp/math)', () => {
    const all = computePowerCells(seeds, clip);
    for (let i = 0; i < seeds.length; i++) {
      const one = computePowerCell(seeds, clip, i)!;
      const full = all.find((c) => c.idx === i)!;
      expect(one.poly).toEqual(full.poly); // pixel-for-pixel: the flash lines up with the fill
      expect(one.tags).toEqual(full.tags);
      expect(one.owner).toBe(full.owner);
    }
  });

  it('returns null for an out-of-range index and never mutates seeds', () => {
    expect(computePowerCell(seeds, clip, -1)).toBeNull();
    expect(computePowerCell(seeds, clip, 3)).toBeNull();
    expect(seeds[1]!.w).toBe(9000); // pure
  });
});

describe('territory — classifyBorders (political border logic, no canvas)', () => {
  const clip: Array<[number, number]> = [
    [-100, -100],
    [100, -100],
    [100, 100],
    [-100, 100],
  ];

  it('same-owner edges are INNER hairlines drawn once; owner-vs-other is a two-sided frontier', () => {
    // p1 | p1 | p2 in a row: p1's pair shares an inner edge; p1|p2 is a frontier.
    const seeds: TerritorySeed[] = [
      { x: -50, y: 0, w: 0, owner: 'p1', kind: 'planet' },
      { x: 0, y: 0, w: 0, owner: 'p1', kind: 'planet' },
      { x: 50, y: 0, w: 0, owner: 'p2', kind: 'planet' },
    ];
    const { ownedFront, ownedInner, neutralEdge } = classifyBorders(
      computePowerCells(seeds, clip),
      seeds,
    );
    // The p1↔p1 edge appears ONCE (idx < t dedup), keyed by owner.
    expect(ownedInner.get('p1')).toHaveLength(1);
    expect(ownedInner.has('p2')).toBe(false);
    // The p1↔p2 border glows from BOTH sides — one frontier segment per owner, and ONLY
    // that one: the map edge is the map's line, not a frontier (owner, 2026-09-24).
    expect(ownedFront.get('p1')).toHaveLength(1);
    expect(ownedFront.get('p2')).toHaveLength(1);
    expect(neutralEdge).toHaveLength(0); // nothing neutral on this map
  });

  it('neutral-vs-neutral divisions are deduped; the map edge is not a division', () => {
    const seeds: TerritorySeed[] = [
      { x: -50, y: 0, w: 0, owner: null, kind: 'planet' },
      { x: 50, y: 0, w: 0, owner: null, kind: 'planet' },
    ];
    const cells = computePowerCells(seeds, clip);
    const { ownedFront, ownedInner, neutralEdge } = classifyBorders(cells, seeds);
    expect(ownedFront.size).toBe(0);
    expect(ownedInner.size).toBe(0);
    // The one shared division (deduped by idx < t); each cell's 3 map-edge sides are not.
    expect(cells.flatMap((c) => c.tags).filter((t) => t === BOUNDARY)).toHaveLength(6);
    expect(neutralEdge).toHaveLength(1);
  });
});

describe('classifyBorders — край карты не граница провинции (владелец 2026-09-24)', () => {
  // «У провинций у края карты не должно быть своих волнистых краёв»: край рисует сама
  // карта — рамка голограммы или контур доски, — и обводка провинции по нему легла бы
  // второй линией, которая движется отдельно от рамки.
  const clip: Array<[number, number]> = [
    [-200, -200],
    [200, -200],
    [200, 200],
    [-200, 200],
  ];
  const onClip = (x: number, y: number): boolean =>
    Math.abs(Math.abs(x) - 200) < 1e-9 || Math.abs(Math.abs(y) - 200) < 1e-9;

  it('провинция на всю карту — ни одной обводки: весь её край и есть край карты', () => {
    const seeds: TerritorySeed[] = [{ x: 0, y: 0, w: 0, owner: 'p1', kind: 'planet' }];
    const { ownedFront, ownedInner, neutralEdge } = classifyBorders(computePowerCells(seeds, clip), seeds);
    expect(ownedFront.size).toBe(0);
    expect(ownedInner.size).toBe(0);
    expect(neutralEdge).toHaveLength(0);
  });

  it('ни одна обводка не лежит на краю — ни фронтир, ни граница своих, ни нейтральная', () => {
    const seeds: TerritorySeed[] = [
      { x: -100, y: -100, w: 0, owner: 'p1', kind: 'planet' },
      { x: 100, y: -100, w: 0, owner: 'p1', kind: 'planet' },
      { x: -100, y: 100, w: 0, owner: 'p2', kind: 'planet' },
      { x: 100, y: 100, w: 0, owner: null, kind: 'planet' },
    ];
    const { ownedFront, ownedInner, neutralEdge } = classifyBorders(computePowerCells(seeds, clip), seeds);
    const all = [...[...ownedFront.values()].flat(), ...[...ownedInner.values()].flat(), ...neutralEdge];
    expect(all.length).toBeGreaterThan(0); // внутренние границы на месте
    for (const [x0, y0, x1, y1] of all) {
      // отрезок, у которого ОБА конца на одной стороне рамки, лёг бы вдоль края
      const alongX = Math.abs(x0 - x1) < 1e-9 && Math.abs(Math.abs(x0) - 200) < 1e-9;
      const alongY = Math.abs(y0 - y1) < 1e-9 && Math.abs(Math.abs(y0) - 200) < 1e-9;
      expect(alongX || alongY).toBe(false);
      expect(onClip((x0 + x1) / 2, (y0 + y1) / 2)).toBe(false);
    }
  });
});
