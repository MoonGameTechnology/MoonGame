import { describe, expect, it, vi } from 'vitest';
import * as territory from './territory';
import { placePoly, TerritoryGeometryCache, type ShapePlacement } from './territoryGeometry';

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

describe('форма в координатах мозаики: выпечка ставит её на место сама', () => {
  // Двенадцать провинций трёх владельцев и ничьи: есть фронтиры, внутренние и ничьи грани.
  const many: territory.TerritorySeed[] = Array.from({ length: 12 }, (_, i) => ({
    x: 15 + ((i * 37) % 80),
    y: 12 + ((i * 53) % 77),
    w: 60 + ((i * 71) % 300),
    owner: i % 4 === 3 ? null : `p${i % 3}`,
    kind: 'planet',
  }));
  // Камера, как у выпечки: зум и сдвиг с неудобными дробями.
  const camera = (scale: number, dx: number, dy: number) => {
    const point = ([x, y]: readonly [number, number]): [number, number] => [
      x * scale + dx,
      y * scale + dy,
    ];
    return {
      seeds: many.map((s) => {
        const [x, y] = point([s.x, s.y]);
        return { ...s, x, y, w: s.w * scale * scale };
      }),
      clip: clip.map(point),
      scale,
    };
  };
  const wave = { amp: 3, wavelength: 50, segment: 9 };
  const placeSegments = (
    segs: territory.BorderSegment[],
    at: ShapePlacement,
  ): territory.BorderSegment[] =>
    segs.map(([x0, y0, x1, y1]) => [
      x0 * at.scale + at.x,
      y0 * at.scale + at.y,
      x1 * at.scale + at.x,
      y1 * at.scale + at.y,
    ]);

  it('одна форма на все камеры, а `project` — ровно она, поставленная `placePoly`', () => {
    const cache = new TerritoryGeometryCache();
    const first = cache.shape(many, clip, 1, wave).shape;
    for (const [scale, dx, dy] of [
      [1.37, 51.125, -127.8],
      [6.02, -1033.3, 410.7],
      [23.9, 4410.1, -2207.45],
    ] as const) {
      const c = camera(scale, dx, dy);
      const { shape, place } = cache.shape(c.seeds, c.clip, c.scale, wave);
      expect(shape).toBe(first);
      expect(place).toEqual({ scale, x: c.clip[0]![0], y: c.clip[0]![1] });
      const cells = cache.project(c.seeds, c.clip, c.scale, wave);
      cells.forEach((cell, i) => expect(cell.poly).toEqual(placePoly(shape.cells[i]!.poly, place)));
    }
  });

  it('рамка клетки, поставленная на место, — та же до бита, что рамка поставленного полигона', () => {
    const cache = new TerritoryGeometryCache();
    const c = camera(7.31, -2911.77, 1503.03);
    const { shape, place } = cache.shape(c.seeds, c.clip, c.scale, wave);
    shape.cells.forEach((cell, i) => {
      const poly = placePoly(cell.poly, place);
      const xs = poly.map((p) => p[0]);
      const ys = poly.map((p) => p[1]);
      expect(shape.boxes[i * 4]! * place.scale + place.x).toBe(Math.min(...xs));
      expect(shape.boxes[i * 4 + 1]! * place.scale + place.y).toBe(Math.min(...ys));
      expect(shape.boxes[i * 4 + 2]! * place.scale + place.x).toBe(Math.max(...xs));
      expect(shape.boxes[i * 4 + 3]! * place.scale + place.y).toBe(Math.max(...ys));
    });
  });

  it('границы: классы те же, что у поставленных клеток, и живут, пока живы форма и владельцы', () => {
    const cache = new TerritoryGeometryCache();
    const near = camera(4.4, 77.7, -31.3);
    const { shape, place } = cache.shape(near.seeds, near.clip, near.scale, wave);
    const borders = cache.borders(shape, near.seeds);
    // Поставленные точки — ровно те, что дала бы классификация клеток выпечки.
    const baked = territory.classifyBorders(
      cache.project(near.seeds, near.clip, near.scale, wave),
      near.seeds,
    );
    expect(placeSegments(borders.neutralEdge, place)).toEqual(baked.neutralEdge);
    for (const kind of ['ownedFront', 'ownedInner'] as const) {
      expect([...borders[kind].keys()]).toEqual([...baked[kind].keys()]);
      for (const [owner, segs] of borders[kind])
        expect(placeSegments(segs, place)).toEqual(baked[kind].get(owner));
    }
    // Камера ушла — классы те же, тот же объект.
    const far = camera(1.9, -406.2, 12.5);
    expect(cache.shape(far.seeds, far.clip, far.scale, wave).shape).toBe(shape);
    expect(cache.borders(shape, far.seeds)).toBe(borders);
  });

  it('смена владельца — и туман другого игрока — классифицирует заново, а не несёт прежние классы', () => {
    const cache = new TerritoryGeometryCache();
    const { shape } = cache.shape(many, clip, 1);
    const before = cache.borders(shape, many);
    const captured = many.map((s, i) => (i === 0 ? { ...s, owner: 'p2' } : s));
    const after = cache.borders(shape, captured);
    expect(after).not.toBe(before);
    expect(after).toEqual(territory.classifyBorders(cache.project(captured, clip, 1), captured));
    const fog = many.map((s) => ({ ...s, owner: null }));
    const blind = cache.borders(shape, fog);
    expect(blind.ownedFront.size).toBe(0);
    expect(blind.ownedInner.size).toBe(0);
    expect(blind).toEqual(territory.classifyBorders(cache.project(fog, clip, 1), fog));
  });
});
