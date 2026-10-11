import { describe, expect, it, vi } from 'vitest';

import { BOUNDARY, computePowerCells, type TerritorySeed } from './territory';
import { TerritoryGeometryCache, type ShapeCell } from './territoryGeometry';
import * as lod from './territoryLod';
import {
  BORDER_LOD_SEGMENT_PX,
  BORDER_TOLERANCE_PX,
  borderTolerance,
  borderWeights,
  simplifyBorderCells,
} from './territoryLod';
import { waveCells, type WaveConfig } from './territoryWave';

const cfg: WaveConfig = { amp: 11, wavelength: 190, segment: 26 };

/** A 6×5 field of provinces, each its own owner unless `owners` says otherwise. */
function field(owners?: (i: number) => string | null): {
  seeds: TerritorySeed[];
  clip: Array<[number, number]>;
} {
  const seeds: TerritorySeed[] = [];
  for (let y = 0; y < 5; y++)
    for (let x = 0; x < 6; x++) {
      const i = seeds.length;
      seeds.push({
        x: 130 + x * 260 + (y % 2) * 90 + ((i * 37) % 50),
        y: 130 + y * 240 + ((i * 53) % 40),
        w: 9000 + ((i * 71) % 5) * 2000,
        owner: owners ? owners(i) : `p${i}`,
        kind: 'planet',
      });
    }
  const clip: Array<[number, number]> = [
    [0, 0],
    [1700, 0],
    [1700, 1250],
    [0, 1250],
  ];
  return { seeds, clip };
}

function waved(): { cells: ShapeCell[]; seeds: TerritorySeed[] } {
  const { seeds, clip } = field();
  return { cells: waveCells(computePowerCells(seeds, clip), cfg), seeds };
}

const key = ([x, y]: readonly [number, number]): string => `${x.toFixed(6)},${y.toFixed(6)}`;

/** Distance from `p` to the segment a–b. */
function toSegment(
  p: readonly [number, number],
  a: readonly [number, number],
  b: readonly [number, number],
): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  const t =
    len2 > 0 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2)) : 0;
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
}

/** Plain Douglas–Peucker at `tolerance`: which interior points of `pts` it keeps. */
function douglasPeucker(pts: Array<[number, number]>, tolerance: number): boolean[] {
  const keep = pts.map(() => false);
  const split = (a: number, b: number): void => {
    let worst = -1;
    let far = -1;
    for (let i = a + 1; i < b; i++) {
      const d = toSegment(pts[i]!, pts[a]!, pts[b]!);
      if (d > far) {
        far = d;
        worst = i;
      }
    }
    if (worst < 0 || !(far > tolerance)) return;
    keep[worst] = true;
    split(a, worst);
    split(worst, b);
  };
  split(0, pts.length - 1);
  return keep.slice(1, -1);
}

describe('border detail by zoom: the tolerance', () => {
  it('is the largest power of two within a quarter pixel, so a zoom changes it at each doubling', () => {
    for (const ppu of [0.7, 1, 1.5, 2, 2.6, 3, 4.2]) {
      const tol = borderTolerance(ppu, 1);
      expect(Number.isInteger(Math.log2(tol))).toBe(true);
      expect(tol * ppu).toBeLessThanOrEqual(BORDER_TOLERANCE_PX);
      expect(tol * ppu).toBeGreaterThan(BORDER_TOLERANCE_PX / 2);
    }
    expect(borderTolerance(2, 1)).toBe(borderTolerance(2.9, 1) * 2);
  });

  it('keeps every point once the pieces are long enough on screen, and on nonsense input', () => {
    expect(borderTolerance(BORDER_LOD_SEGMENT_PX, 1)).toBe(0);
    expect(borderTolerance(16, 1)).toBe(0);
    expect(borderTolerance(0, 1)).toBe(0);
    expect(borderTolerance(Number.NaN, 1)).toBe(0);
    expect(borderTolerance(2, 0)).toBe(0);
  });
});

describe('border detail by zoom: the simplified cells', () => {
  it('keeps exactly what Douglas–Peucker keeps at that tolerance, edge by edge', () => {
    const { cells } = waved();
    const weights = borderWeights(cells);
    let checked = 0;
    for (const tol of [0.5, 2, 4]) {
      const out = simplifyBorderCells(cells, weights, tol);
      cells.forEach((cell, c) => {
        const n = cell.poly.length;
        const kept = new Set(out[c]!.poly.map(key));
        // Each run toward a neighbour with a lower index walks from the cell's own side.
        for (let k = 0; k < n; k++) {
          const t = cell.tags[k]!;
          if (t === BOUNDARY || cell.tags[(k + n - 1) % n] === t || !(cell.idx < t)) continue;
          const run: Array<[number, number]> = [cell.poly[k]!];
          let j = k;
          while (cell.tags[(j + 1) % n] === t) run.push(cell.poly[++j % n]!);
          run.push(cell.poly[(j + 1) % n]!);
          if (run.length < 3) continue;
          const want = douglasPeucker(run, tol);
          expect(run.slice(1, -1).map((p) => kept.has(key(p)))).toEqual(want);
          checked++;
        }
      });
    }
    expect(checked).toBeGreaterThan(50);
  });

  it('strays from the full line by no more than the tolerance', () => {
    const { cells } = waved();
    const tol = 3;
    const out = simplifyBorderCells(cells, borderWeights(cells), tol);
    cells.forEach((cell, c) => {
      const kept = out[c]!.poly;
      const at = new Map(kept.map((p, i) => [key(p), i]));
      let prev = kept[kept.length - 1]!;
      let next = 0;
      for (const p of cell.poly) {
        const i = at.get(key(p));
        if (i !== undefined) {
          prev = p;
          next = (i + 1) % kept.length;
          continue;
        }
        expect(toSegment(p, prev, kept[next]!)).toBeLessThanOrEqual(tol + 1e-9);
      }
    });
  });

  it('both sides of every border keep the same points: each frontier piece pairs with its mirror', () => {
    const { cells, seeds } = waved();
    const cache = new TerritoryGeometryCache();
    const shape = { cells, boxes: new Float64Array(cells.length * 4) };
    const borders = cache.borders(shape, seeds, 2);
    const pieces = new Map<string, number>();
    let total = 0;
    for (const segs of borders.ownedFront.values())
      for (const [x0, y0, x1, y1] of segs) {
        const a = key([x0, y0]);
        const b = key([x1, y1]);
        const k = a < b ? `${a}|${b}` : `${b}|${a}`;
        pieces.set(k, (pieces.get(k) ?? 0) + 1);
        total++;
      }
    // Every province is its own owner: each frontier piece is stroked once from each side.
    expect([...pieces.values()].every((n) => n === 2)).toBe(true);
    const full = cache.borders(shape, seeds);
    let fullTotal = 0;
    for (const segs of full.ownedFront.values()) fullTotal += segs.length;
    expect(total).toBeLessThan(fullTotal * 0.8);
  });

  it('never drops a corner or a point of the map edge', () => {
    const { cells } = waved();
    const out = simplifyBorderCells(cells, borderWeights(cells), 1e6);
    cells.forEach((cell, c) => {
      const kept = new Set(out[c]!.poly.map(key));
      const n = cell.poly.length;
      cell.poly.forEach((p, k) => {
        const corner = cell.tags[k] !== cell.tags[(k + n - 1) % n];
        if (corner || cell.tags[k] === BOUNDARY) expect(kept.has(key(p))).toBe(true);
      });
      // A far tolerance leaves each edge its two ends: one point per run.
      const runs = cell.tags.filter((t, k) => t !== cell.tags[(k + n - 1) % n]).length;
      const edge = cell.tags.filter((t) => t === BOUNDARY).length;
      expect(out[c]!.poly.length).toBeLessThanOrEqual(runs + edge);
      expect(out[c]!.tags.length).toBe(out[c]!.poly.length);
    });
  });

  it('keeps every point of an edge whose two sides do not match point for point', () => {
    // Two cells share the edge (0,0)–(0,100), but they cut it differently.
    const a: ShapeCell = {
      idx: 0,
      poly: [
        [0, 0],
        [-1, 25],
        [1, 50],
        [-1, 75],
        [0, 100],
        [-100, 100],
        [-100, 0],
      ],
      tags: [1, 1, 1, 1, BOUNDARY, BOUNDARY, BOUNDARY],
    };
    const b: ShapeCell = {
      idx: 1,
      poly: [
        [0, 100],
        [1, 50],
        [0, 0],
        [100, 0],
        [100, 100],
      ],
      tags: [0, 0, BOUNDARY, BOUNDARY, BOUNDARY],
    };
    const out = simplifyBorderCells([a, b], borderWeights([a, b]), 10);
    expect(out[0]).toBe(a);
    expect(out[1]).toBe(b);
  });

  it('leaves the cells alone at no tolerance, and returns untouched cells as they were', () => {
    const { cells } = waved();
    const before = JSON.stringify(cells);
    const weights = borderWeights(cells);
    expect(simplifyBorderCells(cells, weights, 0)).toBe(cells);
    const out = simplifyBorderCells(cells, weights, 1e-9);
    out.forEach((cell, c) => {
      if (cell.poly.length === cells[c]!.poly.length) expect(cell).toBe(cells[c]);
    });
    expect(JSON.stringify(cells)).toBe(before);
  });
});

describe('border detail by zoom: the geometry cache', () => {
  it('weighs a shape once and classifies each tolerance once per owners', () => {
    const weigh = vi.spyOn(lod, 'borderWeights');
    try {
      const { seeds, clip } = field();
      const cache = new TerritoryGeometryCache();
      const { shape } = cache.shape(seeds, clip, 1, cfg);
      const far = cache.borders(shape, seeds, 2);
      expect(cache.borders(shape, seeds, 2)).toBe(far);
      const nearer = cache.borders(shape, seeds, 1);
      expect(nearer).not.toBe(far);
      expect(cache.borders(shape, seeds, 2)).toBe(far);
      expect(cache.borders(shape, seeds)).toBe(cache.borders(shape, seeds, 0));
      expect(weigh).toHaveBeenCalledTimes(1);
      const captured = seeds.map((s, i) => (i === 3 ? { ...s, owner: 'p4' } : s));
      expect(cache.borders(shape, captured, 2)).not.toBe(far);
      expect(weigh).toHaveBeenCalledTimes(1);
    } finally {
      weigh.mockRestore();
    }
  });

  it('a new shape is weighed again and does not reuse the old classes', () => {
    const { seeds, clip } = field();
    const cache = new TerritoryGeometryCache();
    const first = cache.shape(seeds, clip, 1, cfg).shape;
    const far = cache.borders(first, seeds, 2);
    const second = cache.shape(seeds, clip, 1, { ...cfg, amp: 5 }).shape;
    expect(second).not.toBe(first);
    expect(cache.borders(second, seeds, 2)).not.toBe(far);
    expect(cache.weighBorders(second)).toBe(cache.weighBorders(second));
  });
});
