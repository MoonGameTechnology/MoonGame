import { afterEach, describe, expect, it, vi } from 'vitest';
import { TerrainRasterCache } from './terrainRasterCache';
import type { TerrainField } from './holographicSurface';

const field = (dx = 0, dy = 0): TerrainField => ({
  id: 'cache-nebula',
  kind: 'nebula',
  color: '#8baceb',
  phase: 0.37,
  box: { x: dx, y: dy, width: 120, height: 90 },
  marker: { x: dx + 31.21, y: dy + 47.13 },
  poly: [
    [dx, dy],
    [dx + 120, dy],
    [dx + 111, dy + 90],
    [dx + 10, dy + 83],
  ],
});
const environmentField = (scale = 1, dx = 0, dy = 0, fingerprint = 'visible-v1'): TerrainField => ({
  id: 'environment:0,0', kind: 'environment', color: '#95b8c5', phase: 0,
  box: { x: dx, y: dy, width: 120 * scale, height: 90 * scale }, poly: [],
  environment: {
    tile: { id: '0,0', x: 0, y: 0, size: 256, box: { x: 0, y: 0, width: 120, height: 90 },
      fingerprint, clipPolygons: [[[0, 0], [120, 0], [120, 90], [0, 90]]],
      features: [{ id: 'storm', family: 'storm', color: '#80c4d5', detail: 'major',
        paths: [{ points: [[5, 10], [60, 25], [110, 15]], closed: false, alpha: 0.3, width: 0.8 }] }],
    },
    projection: { scale, x: dx, y: dy },
  },
});
function surfaces() {
  const strokes = vi.fn();
  const created: (EventTarget & { width: number; height: number })[] = [];
  const noop = () => {};
  const ctx = {
    globalAlpha: 1,
    setTransform: noop,
    save: noop,
    restore: noop,
    beginPath: noop,
    closePath: noop,
    moveTo: noop,
    lineTo: noop,
    clip: noop,
    stroke: strokes,
  };
  const getContext = vi.fn(() => ctx);
  vi.stubGlobal('document', {
    createElement: () => {
      const surface = Object.assign(new EventTarget(), {
        width: 0,
        height: 0,
        getContext,
      });
      created.push(surface);
      return surface;
    },
  });
  const drawImage = vi.fn();
  const target = { ...ctx, drawImage } as unknown as CanvasRenderingContext2D;
  return { created, strokes, drawImage, target, getContext };
}
afterEach(() => vi.unstubAllGlobals());

describe('province raster cache', () => {
  it('reuses environment geography across camera placement and sharpens after zoom', () => {
    const f = surfaces();
    const cache = new TerrainRasterCache();
    cache.draw(f.target, environmentField(), 2);
    expect(f.strokes).toHaveBeenCalled();
    f.strokes.mockClear();
    cache.draw(f.target, environmentField(1, 178.273, -57.199), 2);
    // Political/province metadata is irrelevant to a continuous tile's drawing.
    cache.draw(f.target, { ...environmentField(), color: '#ff0000', phase: 0.5, poly: [[0, 0]] }, 2);
    cache.draw(f.target, environmentField(2, 10, -5), 2, true);
    expect(f.created).toHaveLength(1);
    expect(f.strokes).not.toHaveBeenCalled();
    expect(cache.pending).toBe(true);
    expect(cache.owed(environmentField(2, 10, -5), 2)).toBe(488 * 368);
    cache.beginFrame(1);
    cache.draw(f.target, environmentField(2, 10, -5), 2);
    expect(f.created).toHaveLength(2);
    expect(cache.owed(environmentField(2, -80, 36), 2)).toBe(0);
  });

  it('invalidates edited terrain, roads or fog masks by tile fingerprint without showing stale pixels', () => {
    const f = surfaces();
    const cache = new TerrainRasterCache();
    cache.prepare(environmentField(), 1);
    const edited = environmentField(1, 0, 0, 'visible-v2');
    expect(cache.owed(edited, 1)).toBe(124 * 94);
    cache.beginFrame(0);
    f.strokes.mockClear();
    cache.draw(f.target, edited, 1, true);
    expect(cache.pending).toBe(true);
    expect(f.created[0]!.width).toBe(0);
    expect(f.drawImage).not.toHaveBeenCalled();
    expect(f.strokes).not.toHaveBeenCalled();
    cache.beginFrame(1);
    cache.draw(f.target, edited, 1);
    expect(f.created).toHaveLength(2);
    expect(f.strokes).toHaveBeenCalled();
    expect(cache.owed(edited, 1)).toBe(0);
  });

  it('reuses pixels throughout a zoom and sharpens only after it settles', () => {
    const f = surfaces();
    const cache = new TerrainRasterCache();
    cache.prepare(field(), 2);
    f.strokes.mockClear();
    const base = field();
    const scaled = (scale: number): TerrainField => ({
      ...base,
      box: { x: 10, y: -5, width: 120 * scale, height: 90 * scale },
      poly: base.poly.map(([x, y]) => [10 + x * scale, -5 + y * scale]),
      marker: { x: 10 + base.marker!.x * scale, y: -5 + base.marker!.y * scale },
    });
    for (const scale of [1.1, 1.47, 2]) cache.draw(f.target, scaled(scale), 2, true);
    expect(f.strokes).not.toHaveBeenCalled();
    expect(f.created).toHaveLength(1);
    expect(f.drawImage.mock.calls.at(-1)?.slice(1)).toEqual([6, -9, 248, 188]);
    // The stretched raster is a stand-in: whoever baked it with the map still owes a sharp one.
    expect(cache.pending).toBe(true);
    cache.beginFrame(2);
    cache.draw(f.target, base, 2, true);
    expect(cache.pending).toBe(false);
    cache.draw(f.target, scaled(2), 2);
    expect(f.created).toHaveLength(2);
    expect(f.strokes).toHaveBeenCalled();
  });

  it('spreads new bakes across frames without expensive vector fallbacks or stale pixels', () => {
    const f = surfaces();
    const cache = new TerrainRasterCache();
    const batch = Array.from({ length: 5 }, (_, i) => ({ ...field(), id: String(i) }));
    for (const expected of [2, 4, 5]) {
      cache.beginFrame(2);
      for (const item of batch) cache.draw(f.target, item, 1);
      expect(f.created).toHaveLength(expected);
      expect(cache.pending).toBe(expected < 5);
    }
    cache.beginFrame(0);
    f.strokes.mockClear();
    f.drawImage.mockClear();
    cache.draw(f.target, { ...batch[0]!, kind: 'ion_storm' }, 1, true);
    expect(cache.pending).toBe(true);
    expect(f.drawImage).not.toHaveBeenCalled();
    expect(f.strokes).not.toHaveBeenCalled();
  });

  it('tells the pixels a sharp raster still owes without making one', () => {
    const f = surfaces();
    const cache = new TerrainRasterCache();
    expect(cache.owed(field(), 2)).toBe(248 * 188);
    expect(f.created).toHaveLength(0);
    expect(cache.prepare(field(), 2)?.pixels).toBe(248 * 188);
    expect(cache.owed(field(), 2)).toBe(0);
    expect(cache.owed(field(178.273, -57.199), 2)).toBe(0);
    // The same shape at another scale is shown stretched until its own raster is made.
    const doubled: TerrainField = {
      ...field(),
      box: { x: 0, y: 0, width: 240, height: 180 },
      poly: field().poly.map(([x, y]) => [x * 2, y * 2]),
      marker: { x: 62.42, y: 94.26 },
    };
    expect(cache.owed(doubled, 2)).toBe(488 * 368);
    // Lost pixels are owed again; worlds and oversized provinces keep no raster to owe.
    f.created[0]!.dispatchEvent(new Event('contextlost'));
    expect(cache.owed(field(), 2)).toBe(248 * 188);
    expect(cache.owed({ ...field(), kind: 'planet' }, 2)).toBe(0);
    expect(new TerrainRasterCache(100).owed(field(), 2)).toBe(0);
  });

  it('keeps lazy and rebuilt terrain on the requested context policy', () => {
    const f = surfaces();
    const cache = new TerrainRasterCache(undefined, { willReadFrequently: true });
    cache.prepare(field(), 2);
    cache.clear();
    cache.draw(f.target, field(1, 2), 2);
    expect(f.getContext).toHaveBeenCalledTimes(2);
    for (const args of f.getContext.mock.calls)
      expect(args).toEqual(['2d', { willReadFrequently: true }]);
  });
  it('prepares art without painting the map and reuses it on first presentation', () => {
    const f = surfaces();
    const cache = new TerrainRasterCache();
    cache.prepare(field(), 1);
    expect(f.drawImage).not.toHaveBeenCalled();
    f.strokes.mockClear();
    cache.draw(f.target, field(15, -9), 1);
    expect(f.strokes).not.toHaveBeenCalled();
    expect(f.drawImage).toHaveBeenCalledOnce();
  });
  it('reuses the full terrain drawing through fractional camera translations', () => {
    const f = surfaces();
    const cache = new TerrainRasterCache();
    cache.draw(f.target, field(), 2);
    expect(f.strokes.mock.calls.length).toBeGreaterThan(100);
    f.strokes.mockClear();
    for (const [x, y] of [
      [0.1, -0.3],
      [178.273, -57.199],
      [-519.311, 391.222],
    ])
      cache.draw(f.target, field(x, y), 2);
    expect(f.strokes).not.toHaveBeenCalled();
    expect(f.created).toHaveLength(1);
    expect(f.drawImage).toHaveBeenCalledTimes(4);
    expect(f.drawImage.mock.calls.at(-1)?.slice(1, 3)).toEqual([-521.311, 389.222]);
  });
  it('repaints after a genuine polygon, marker, terrain or DPR change', () => {
    const f = surfaces();
    const cache = new TerrainRasterCache();
    cache.draw(f.target, field(), 1);
    for (const [next, dpr] of [
      [{ ...field(), marker: { x: 65, y: 45 } }, 1],
      [{ ...field(), kind: 'ion_storm' }, 1],
      [
        {
          ...field(),
          poly: [
            [0, 0],
            [90, 0],
            [80, 90],
          ],
        },
        1,
      ],
      [field(), 2],
    ] as [TerrainField, number][]) {
      f.strokes.mockClear();
      cache.draw(f.target, next, dpr);
      expect(f.strokes.mock.calls.length).toBeGreaterThan(0);
    }
  });
  it('keeps memory bounded and releases evicted surfaces', () => {
    const f = surfaces();
    const cache = new TerrainRasterCache(24_000);
    cache.draw(f.target, field(), 1);
    cache.draw(f.target, { ...field(), id: 'second' }, 1);
    cache.draw(f.target, { ...field(), id: 'third' }, 1);
    expect(f.created[0]?.width).toBe(0);
    expect(f.created.reduce((sum, c) => sum + c.width * c.height, 0)).toBeLessThanOrEqual(24_000);
  });
  it('paints oversized provinces directly instead of exceeding the cache budget', () => {
    const f = surfaces();
    const cache = new TerrainRasterCache(100);
    cache.draw(f.target, field(), 2);
    expect(f.created).toHaveLength(0);
    expect(f.drawImage).not.toHaveBeenCalled();
    expect(f.strokes.mock.calls.length).toBeGreaterThan(0);
  });
  it('repaints lost/restored pixels even when geometry and dimensions are unchanged', () => {
    const f = surfaces();
    const cache = new TerrainRasterCache();
    cache.draw(f.target, field(), 2);
    const lost = f.created[0]!;
    lost.dispatchEvent(new Event('contextlost'));
    f.strokes.mockClear();
    cache.draw(f.target, field(), 2);
    expect(f.strokes).toHaveBeenCalled();
    expect(f.created).toHaveLength(2);
    // An old context may finish restoration after a new surface is already cached.
    lost.dispatchEvent(new Event('contextrestored'));
    cache.draw(f.target, field(), 2);
    expect(f.created).toHaveLength(2);
    f.created[1]!.dispatchEvent(new Event('contextrestored'));
    cache.draw(f.target, field(), 2);
    expect(f.created).toHaveLength(3);
  });
  it('releases all surfaces on display recovery and prepares fresh pixels on demand', () => {
    const f = surfaces();
    const cache = new TerrainRasterCache();
    cache.prepare(field(), 2);
    cache.prepare({ ...field(), id: 'second' }, 2);
    cache.clear();
    expect(f.created.every((c) => c.width === 0 && c.height === 0)).toBe(true);
    f.strokes.mockClear();
    cache.draw(f.target, field(), 2);
    expect(f.strokes).toHaveBeenCalled();
    expect(f.created).toHaveLength(3);
  });
});
