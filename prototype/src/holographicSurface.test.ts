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
  });
  it('keeps the exact province polygon without moving a border or node', () => {
    const before = structuredClone(poly);
    const field = makeTerrainField('C2R3', 'nebula', '#8877aa', poly, true)!;
    expect(field.poly).toBe(poly);
    expect(poly).toEqual(before);
    expect(field.box).toEqual({ x: 0, y: 0, width: 140, height: 100 });
    expect(makeTerrainField('C2R3', 'nebula', '#8877aa', poly, true)).toEqual(field);
  });
  it('leaves planet volumes and transit-only geometry to their existing renderers', () => {
    for (const kind of ['planet', 'empty', 'void_station', 'unknown']) {
      expect(makeTerrainField('C2R3', kind, '#ffffff', poly, true)).toBeNull();
    }
  });
});
