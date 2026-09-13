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
function surfaces() {
  const strokes = vi.fn();
  const created: { width: number; height: number }[] = [];
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
  vi.stubGlobal('document', {
    createElement: () => {
      const surface = { width: 0, height: 0, getContext: () => ctx };
      created.push(surface);
      return surface;
    },
  });
  const drawImage = vi.fn();
  const target = { ...ctx, drawImage } as unknown as CanvasRenderingContext2D;
  return { created, strokes, drawImage, target };
}
afterEach(() => vi.unstubAllGlobals());

describe('province raster cache', () => {
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
});
