import { describe, expect, it, vi } from 'vitest';
import { fitTransform } from './camera';
import { drawSchematicNode, mapLod, mapSpacing } from './mapLod';

describe('map detail follows screen density', () => {
  it('keeps three useful layers and restores all detail on approach', () => {
    expect(mapLod(20)).toMatchObject({ art: 0, detail: 0 });
    expect(mapLod(48)).toMatchObject({ art: 0.5, detail: 0 });
    expect(mapLod(70)).toMatchObject({ art: 1, detail: 0 });
    expect(mapLod(85).detail).toBeGreaterThan(0);
    expect(mapLod(110)).toMatchObject({ art: 1, detail: 1 });
    let previous = mapLod(0);
    for (let gap = 1; gap <= 180; gap++) {
      const next = mapLod(gap);
      expect(next.art).toBeGreaterThanOrEqual(previous.art);
      expect(next.detail).toBeGreaterThanOrEqual(previous.detail);
      expect(next.art - previous.art).toBeLessThan(0.04);
      expect(next.detail - previous.detail).toBeLessThan(0.07);
      previous = next;
    }
  });

  it('makes equally dense views identical regardless of world-coordinate scale', () => {
    const nodes = [
      { id: 'a', x: 0, y: 0, links: ['b'] },
      { id: 'b', x: 100, y: 0, links: ['a'] },
    ];
    const vp = { left: 0, right: 400, top: 0, bottom: 800 };
    const b = { minX: 0, minY: 0, maxX: 1000, maxY: 1000 };
    const large = nodes.map((n) => ({ ...n, x: n.x * 10, y: n.y * 10 }));
    const largeBounds = { ...b, maxX: 10000, maxY: 10000 };
    expect(mapLod(mapSpacing(nodes) * fitTransform(vp, b).scale)).toEqual(
      mapLod(mapSpacing(large) * fitTransform(vp, largeBounds).scale),
    );
    const desktop = { ...vp, right: 1600, bottom: 1200 };
    expect(mapLod(mapSpacing(nodes) * fitTransform(desktop, b).scale).detail).toBe(1);
    expect(mapLod(mapSpacing(nodes) * fitTransform(vp, b).scale).detail).toBe(0);
  });

  it('ignores isolated black holes, missing links and coincident points', () => {
    expect(
      mapSpacing([
        { id: 'a', x: 0, y: 0, links: ['b', 'missing', 'a'] },
        { id: 'b', x: 100, y: 0, links: ['a'] },
        { id: 'hole', x: 9000, y: 9000, links: [] },
      ]),
    ).toBe(100);
    expect(Number.isFinite(mapSpacing([]))).toBe(true);
  });

  it('uses a small anonymous ring with no terrain or ownership input', () => {
    const paint = vi.fn();
    const g = {
      beginPath: vi.fn(),
      arc: vi.fn(),
      rect: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      closePath: vi.fn(),
      stroke: paint,
      fill: vi.fn(),
    };
    drawSchematicNode(g as unknown as CanvasRenderingContext2D, { x: 40, y: 30 }, 3);
    expect(paint).toHaveBeenCalledOnce();
    expect(g.beginPath).toHaveBeenCalledOnce();
    expect(g.arc).toHaveBeenCalledWith(40, 30, 3, 0, Math.PI * 2);
    expect(g.rect).not.toHaveBeenCalled();
    expect(g.fill).not.toHaveBeenCalled();
    expect(mapLod(20).markerRadius).toBeCloseTo(1.8);
    expect(mapLod(200).markerRadius).toBe(3.2);
  });

  it('keeps sparse whole-map views schematic as well as dense regions', () => {
    expect(mapLod(160, 1)).toMatchObject({ art: 0, detail: 0, provinceDetail: 0 });
    expect(mapLod(160, 1.325)).toMatchObject({ art: 0.5, detail: 0.5, provinceDetail: 0.5 });
    expect(mapLod(160, 2)).toMatchObject({ art: 1, detail: 1, provinceDetail: 1 });
    expect(mapLod(20, 6)).toMatchObject({ art: 0, detail: 0, provinceDetail: 0 });
  });
});
