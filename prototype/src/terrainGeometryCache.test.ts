import { describe, expect, it } from 'vitest';
import { makeTerrainField } from './holographicSurface';
import { TerrainGeometryCache } from './terrainGeometryCache';

const poly: Array<[number, number]> = [
  [0, 0],
  [140, 0],
  [110, 100],
  [0, 100],
];
const marker = { x: 33, y: 72 };

describe('terrain geometry preparation', () => {
  it('prewarms a small province and reuses its shape through pan and zoom', () => {
    const cache = new TerrainGeometryCache();
    const prepared = cache.prepare('rocks', 'asteroid', '#aaaaaa', poly, true, marker);
    for (const scale of [0.2, 1.37, 6]) {
      const point = ([x, y]: [number, number]): [number, number] => [
        x * scale + 71.25,
        y * scale - 18.3,
      ];
      const projected = poly.map(point);
      const [x, y] = point([marker.x, marker.y]);
      expect(cache.prepare('rocks', 'asteroid', '#aaaaaa', projected, true, { x, y })).toBe(
        prepared,
      );
      const actual = cache.project('rocks', 'asteroid', '#aaaaaa', projected, true, { x, y })!;
      const direct = makeTerrainField('rocks', 'asteroid', '#aaaaaa', projected, true, { x, y })!;
      expect(actual.poly).toBe(projected);
      expect(actual.asteroids).toHaveLength(direct.asteroids!.length);
      actual.asteroids!.forEach((rock, i) => {
        expect(rock.x).toBeCloseTo(direct.asteroids![i]!.x, 6);
        expect(rock.y).toBeCloseTo(direct.asteroids![i]!.y, 6);
        expect(rock.radius).toBeCloseTo(direct.asteroids![i]!.radius, 6);
      });
    }
  });

  it('keeps undiscovered geometry private and invalidates changed terrain and matches', () => {
    const cache = new TerrainGeometryCache();
    const known = cache.prepare('a', 'asteroid', '#aaaaaa', poly, true);
    expect(cache.project('a', 'asteroid', '#aaaaaa', poly, false)).toBeNull();
    expect(cache.prepare('a', 'ion_storm', '#aaaaaa', poly, true)?.kind).toBe('ion_storm');
    const changed = cache.prepare('a', 'asteroid', '#aaaaaa', poly.slice(0, 3), true);
    expect(changed).not.toBe(known);
    cache.clear();
    expect(cache.prepare('a', 'asteroid', '#aaaaaa', poly, true)).not.toBe(known);
  });

  it('bounds the number of retained province shapes', () => {
    const cache = new TerrainGeometryCache(2);
    const first = cache.prepare('a', 'nebula', '#aaaaaa', poly, true);
    cache.prepare('b', 'nebula', '#aaaaaa', poly, true);
    cache.prepare('c', 'nebula', '#aaaaaa', poly, true);
    expect(cache.prepare('a', 'nebula', '#aaaaaa', poly, true)).not.toBe(first);
  });
});
