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

  it('ВОЛНА НЕ ЗАВИСИТ ОТ ЗУМА (M2.9): одна и та же форма на любом приближении', () => {
    // Главное правило кирпича. Волна накладывается в ЛОКАЛЬНЫХ координатах — уже после
    // деления на зум, — поэтому изгиб обязан совпасть, если развернуть проекцию обратно.
    // Посчитай его в экранных, и на приближении карта «перекроилась» бы.
    const wave = { amp: 4, wavelength: 60, segment: 12 };
    const [ox, oy] = clip[0]!;
    const unproject = (
      cells: territory.TerritoryCell[],
      scale: number,
    ): Array<Array<[number, number]>> =>
      cells.map((c) =>
        c.poly.map(([x, y]): [number, number] => [(x - ox) / scale, (y - oy) / scale]),
      );

    const near = new TerritoryGeometryCache();
    const far = new TerritoryGeometryCache();
    const a = unproject(near.project(seeds, clip, 1, wave), 1);
    const zoomed: Array<[number, number]> = clip.map(([x, y]): [number, number] => [
      (x - ox) * 3 + ox,
      (y - oy) * 3 + oy,
    ]);
    const bigSeeds = seeds.map((s) => ({
      ...s,
      x: (s.x - ox) * 3 + ox,
      y: (s.y - oy) * 3 + oy,
      w: s.w * 9,
    }));
    const b = unproject(far.project(bigSeeds, zoomed, 3, wave), 3);

    expect(b.length).toBe(a.length);
    for (let i = 0; i < a.length; i++)
      for (let k = 0; k < a[i]!.length; k++) {
        expect(b[i]![k]![0]).toBeCloseTo(a[i]![k]![0], 6);
        expect(b[i]![k]![1]).toBeCloseTo(a[i]![k]![1], 6);
      }
  });

  it('СМЕНА НАСТРОЙКИ ВОЛНЫ — смена ФОРМЫ: кэш обязан пересчитаться', () => {
    const cache = new TerritoryGeometryCache();
    const straight = cache.project(seeds, clip, 1);
    const wavy = cache.project(seeds, clip, 1, { amp: 4, wavelength: 60, segment: 12 });
    expect(wavy.map((c) => c.poly)).not.toEqual(straight.map((c) => c.poly));
    // И обратно: убрали волну — вернулась прямая мозаика.
    expect(cache.project(seeds, clip, 1).map((c) => c.poly)).toEqual(
      straight.map((c) => c.poly),
    );
  });
});
