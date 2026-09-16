import { describe, expect, it, vi } from 'vitest';
import * as territory from './territory';
import { TerritoryGeometryCache } from './territoryGeometry';

const seeds: territory.TerritorySeed[] = [
  { x: 10, y: 10, w: 500, owner: 'p1', kind: 'planet' },
  { x: 80, y: 30, w: 200, owner: null, kind: 'asteroid' },
  { x: 30, y: 80, w: 100, owner: 'p2', kind: 'planet' },
];
const clip: Array<[number, number]> = [
  [0, 0],
  [100, 0],
  [100, 100],
  [0, 100],
];

describe('camera-independent province geometry', () => {
  it('tessellates once through pan/zoom while matching the original weighted cells', () => {
    const compute = vi.spyOn(territory, 'computePowerCells');
    const cache = new TerritoryGeometryCache();
    try {
      cache.project(seeds, clip, 1);
      const expected = territory.computePowerCells;
      for (const scale of [1, 1.12, 2.3, 12, 48]) {
        const point = ([x, y]: [number, number]): [number, number] => [
          x * scale + 51.125,
          y * scale - 127.8,
        ];
        const projected = seeds.map((s) => {
          const [x, y] = point([s.x, s.y]);
          return { ...s, x, y, w: s.w * scale * scale };
        });
        const calls = compute.mock.calls.length;
        const actual = cache.project(projected, clip.map(point), scale);
        expect(compute.mock.calls.length).toBe(calls);
        const direct = expected(projected, clip.map(point));
        expect(actual.map((c) => c.tags)).toEqual(direct.map((c) => c.tags));
        actual.forEach((c, i) =>
          c.poly.forEach((p, j) =>
            p.forEach((v, k) => expect(v).toBeCloseTo(direct[i]!.poly[j]![k]!, 7)),
          ),
        );
      }
    } finally {
      compute.mockRestore();
    }
  });

  it('refreshes known owners and terrain without reusing stale intelligence', () => {
    const cache = new TerritoryGeometryCache();
    const first = cache.project(seeds, clip, 1);
    const snapshot = seeds.map((s) => ({ ...s, owner: null, kind: 'unknown' }));
    const next = cache.project(snapshot, clip, 1);
    expect(next.every((c) => c.owner === null && c.kind === 'unknown')).toBe(true);
    expect(next.map((c) => c.poly)).toEqual(first.map((c) => c.poly));
    expect(seeds[0]!.owner).toBe('p1');
  });

  it('invalidates on resizing a province, viewport changes and switching maps', () => {
    const cache = new TerritoryGeometryCache();
    cache.project(seeds, clip, 1);
    for (const changed of [
      seeds.map((s) => ({ ...s, w: s.w * 3 })),
      seeds.map((s) => ({ ...s, x: s.x * 0.8, y: s.y * 0.8 })),
      seeds.slice(0, 2),
    ]) {
      expect(cache.project(changed, clip, 1)).toEqual(territory.computePowerCells(changed, clip));
    }
  });
});
