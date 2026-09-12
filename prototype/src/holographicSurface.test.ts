import { describe, expect, it } from 'vitest';
import { makeTerrainField } from './holographicSurface';

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
});
