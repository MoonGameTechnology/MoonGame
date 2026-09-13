import { afterEach, describe, expect, it, vi } from 'vitest';
import { shippedGameData } from '../../../data/bundle';
import { dominantUnit, unitGlyphSvg, unitShape } from './shipGlyphs';
import { drawShipShape, SHIP_SHAPES, shipPaths } from './shipShapes';

const data = shippedGameData();
afterEach(() => vi.unstubAllGlobals());

describe('approved ship hulls', () => {
  it('distinguishes the frigate and the wide landing craft from combat triangles', () => {
    expect(unitShape(data.units.frigate!, 'frigate')).toBe('frigate');
    expect(unitShape(data.units.landing_shuttle!, 'landing_shuttle')).toBe('dropship');
    expect(unitShape(data.units.bomber!, 'bomber')).toBe('strikeCraft');
    expect(unitShape(data.units.interceptor!, 'interceptor')).toBe('fighter');
    expect(unitShape(data.units.tank!, 'tank')).toBeNull();
    expect(unitGlyphSvg(data.units.frigate!, { unitId: 'frigate', color: '#ff5a4d' })).toContain(
      SHIP_SHAPES.frigate.hull,
    );
  });

  it('keeps fleet identity stable when cargo or stack order changes', () => {
    const ships = [
      { unit: 'frigate', count: 1 },
      { unit: 'interceptor', count: 10 },
    ];
    expect(dominantUnit(ships, data)?.unit).toBe('frigate');
    expect(dominantUnit([...ships].reverse(), data)?.unit).toBe('frigate');
    expect(dominantUnit([...ships, { unit: 'tank', count: 50 }], data)?.unit).toBe('frigate');
    expect(dominantUnit([{ unit: 'unknown', count: 1 }], data)).toBeNull();
  });

  it('reuses vector paths across frames and keeps the same contour at both LODs', () => {
    const ctor = vi.fn(function (this: { source: string }, source: string) {
      this.source = source;
    });
    vi.stubGlobal('Path2D', ctor);
    const g = { fill: vi.fn(), stroke: vi.fn(), shadowBlur: 6 };
    drawShipShape(g as unknown as CanvasRenderingContext2D, 'frigate', true);
    const paths = shipPaths('frigate');
    expect(ctor).toHaveBeenCalledTimes(3);
    expect(g.stroke.mock.calls.map((c) => c[0])).toEqual([paths.hull, paths.detail, paths.engines]);
    g.stroke.mockClear();
    drawShipShape(g as unknown as CanvasRenderingContext2D, 'frigate', false);
    expect(g.stroke.mock.calls.map((c) => c[0])).toEqual([paths.hull]);
    expect(g.fill).toHaveBeenLastCalledWith(paths.hull, 'evenodd');
    expect(ctor).toHaveBeenCalledTimes(3);
  });
});
