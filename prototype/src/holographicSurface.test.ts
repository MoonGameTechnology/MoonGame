import { describe, expect, it, vi } from 'vitest';
import { drawTerrainEnvironmentTile } from '../../packages/client/src/terrainEnvironmentDraw';
import { drawGlassRim, drawGlassWave, drawTerrainField, makeTerrainField, type TerrainField } from './holographicSurface';

vi.mock('../../packages/client/src/terrainEnvironmentDraw', () => ({ drawTerrainEnvironmentTile: vi.fn() }));

const poly = [
  [0, 0],
  [140, 0],
  [110, 100],
  [0, 100],
] as const;
describe('terrain presentation respects discovered geometry', () => {
  it('never replaces unexplored fog with terrain details', () => {
    expect(makeTerrainField('C2R3', 'ion_storm', '#ffaa00', poly, false)).toBeNull();
    expect(makeTerrainField('C2R3', 'asteroid', '#aaaaaa', poly, false)).toBeNull();
    for (const kind of ['asteroid_cluster', 'rift', 'dust_lane', 'depleted_system']) {
      expect(makeTerrainField('C2R3', kind, '#aaaaaa', poly, false)).toBeNull();
      expect(makeTerrainField('C2R3', kind, '#aaaaaa', poly, true)?.kind).toBe(kind);
    }
  });
  it('keeps the exact province polygon without moving a border or node', () => {
    const before = structuredClone(poly);
    const field = makeTerrainField('C2R3', 'nebula', '#8877aa', poly, true)!;
    expect(field.poly).toBe(poly);
    expect(poly).toEqual(before);
    expect(field.box).toEqual({ x: 0, y: 0, width: 140, height: 100 });
    expect(makeTerrainField('C2R3', 'nebula', '#8877aa', poly, true)).toEqual(field);
  });
  it('presents catalogued bodies and transit space without inventing unknown terrain', () => {
    for (const kind of ['planet', 'empty', 'void_station']) {
      expect(makeTerrainField('C2R3', kind, '#ffffff', poly, true)?.kind).toBe(kind);
      expect(makeTerrainField('C2R3', kind, '#ffffff', poly, false)).toBeNull();
    }
    expect(makeTerrainField('C2R3', 'unknown', '#ffffff', poly, true)).toBeNull();
  });
  it('keeps rock silhouettes inside concave provinces and clear of the central marker', () => {
    const concave = [[0, 0], [180, 0], [180, 70], [100, 70], [100, 150], [0, 150]] as const;
    for (const id of ['C2R3', 'C7R1', 'C1R4']) {
      const rocks = makeTerrainField(id, 'asteroid', '#aaaaaa', concave, true)!.asteroids!;
      expect(rocks.length).toBeGreaterThan(15);
      for (const { x, y, radius, poly: silhouette } of rocks) {
        expect(x - radius).toBeGreaterThan(0);
        expect(y - radius).toBeGreaterThan(0);
        expect(x + radius).toBeLessThan(180);
        expect(y + radius).toBeLessThan(150);
        for (const [px, py] of silhouette) expect(px < 100 || py < 70).toBe(true);
        expect(Math.hypot((x - 90) / 180, (y - 75) / 150)).toBeGreaterThan(0.15);
      }
    }
  });
  it('preserves each province composition through camera translation and zoom', () => {
    const rocks = makeTerrainField('C2R3', 'asteroid', '#aaaaaa', poly, true)!.asteroids!;
    const zoomedPoly = poly.map(([x, y]) => [x * 2.5 + 81, y * 2.5 - 32] as const);
    const zoomed = makeTerrainField('C2R3', 'asteroid', '#aaaaaa', zoomedPoly, true)!.asteroids!;
    expect(zoomed.length).toBe(rocks.length);
    zoomed.forEach((rock, i) => {
      expect((rock.x - 81) / 2.5).toBeCloseTo(rocks[i]!.x, 8);
      expect((rock.y + 32) / 2.5).toBeCloseTo(rocks[i]!.y, 8);
      expect(rock.radius / 2.5).toBeCloseTo(rocks[i]!.radius, 8);
    });
    expect(makeTerrainField('C7R1', 'asteroid', '#aaaaaa', poly, true)!.asteroids).not.toEqual(rocks);
  });
  it('keeps an off-centre survey node clear without changing its location', () => {
    const marker = { x: 33, y: 72 };
    const rocks = makeTerrainField('C2R3', 'asteroid', '#aaaaaa', poly, true, marker)!.asteroids!;
    expect(rocks.length).toBeGreaterThan(15);
    for (const { x, y, radius } of rocks) {
      expect(Math.hypot((x - marker.x) / 140, (y - marker.y) / 100)).toBeGreaterThan(0.15 + radius / 100);
    }
    expect(marker).toEqual({ x: 33, y: 72 });
  });

  it('delegates complete environment tiles without a province clip or duplicate live pass', () => {
    vi.mocked(drawTerrainEnvironmentTile).mockClear();
    const field: TerrainField = {
      ...makeTerrainField('C2R3', 'nebula', '#8877aa', poly, true)!,
      environment: {
        tile: { id: '0,0', x: 0, y: 0, size: 256, box: { x: 0, y: 0, width: 300, height: 300 },
          clipPolygons: [poly], features: [], fingerprint: 'visible-v1' },
        projection: { scale: 2, x: -10, y: 20 },
      },
    };
    // No path/clip methods: the adapter must not clip the tile back to field.poly.
    const g = { save: vi.fn(), restore: vi.fn() } as unknown as CanvasRenderingContext2D;
    drawTerrainField(g, field, 0, false);
    expect(drawTerrainEnvironmentTile).toHaveBeenCalledExactlyOnceWith(
      g, field.environment!.tile, field.environment!.projection,
    );
    expect(g.restore).toHaveBeenCalledTimes(1);
    drawTerrainField(g, field, 14000, true);
    expect(drawTerrainEnvironmentTile).toHaveBeenCalledTimes(1);
    expect(g.save).toHaveBeenCalledTimes(1);
  });
});

describe('the glass rim and wave keep to the strip of the bake they can touch', () => {
  const frame = { x: 0, y: 0, width: 400, height: 800 };
  /** A context that counts the strokes it is asked for. */
  function counting(): { g: CanvasRenderingContext2D; strokes: () => number } {
    let strokes = 0;
    const g = new Proxy({}, {
      get: (_, name) => (name === 'stroke' ? () => { strokes++; }
        : typeof name === 'string' && name.startsWith('create') ? () => ({ addColorStop() {} }) : () => undefined),
      set: () => true,
    }) as CanvasRenderingContext2D;
    return { g, strokes: () => strokes };
  }
  const rim = (box?: { x0: number; y0: number; x1: number; y1: number }): number => {
    const { g, strokes } = counting();
    drawGlassRim(g, frame, 0, false, box);
    return strokes();
  };
  const wave = (box?: { x0: number; y0: number; x1: number; y1: number }): number => {
    const { g, strokes } = counting();
    drawGlassWave(g, frame, 390, 844, 0, false, box);
    return strokes();
  };

  it('the rim: drawn where a strip meets the frame edge, not deep in the glass nor far outside', () => {
    const whole = rim();
    expect(whole).toBeGreaterThan(0);
    expect(rim({ x0: -5, y0: 300, x1: 5, y1: 310 })).toBe(whole);
    expect(rim({ x0: 2, y0: 2, x1: 12, y1: 12 })).toBe(whole); // the rounded corner
    expect(rim({ x0: 100, y0: 100, x1: 300, y1: 700 })).toBe(0);
    expect(rim({ x0: -100, y0: 0, x1: -50, y1: 800 })).toBe(0);
  });

  it('the wave: drawn where a strip meets its line inside the glass', () => {
    // At clock 0 the line crosses the glass at 5% of its height.
    const whole = wave();
    expect(whole).toBeGreaterThan(0);
    expect(wave({ x0: 0, y0: 30, x1: 400, y1: 50 })).toBe(whole);
    expect(wave({ x0: 0, y0: 300, x1: 400, y1: 400 })).toBe(0);
    expect(wave({ x0: 450, y0: 0, x1: 500, y1: 800 })).toBe(0);
  });
});
