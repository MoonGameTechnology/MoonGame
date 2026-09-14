import { describe, expect, it } from 'vitest';
import { computePowerCells, type TerritorySeed } from './territory';
import { TerritoryGeometryCache, projectTerritoryCells } from './territoryCache';

const seeds: TerritorySeed[] = [
  { x: 0, y: 0, w: 3, kind: 'planet', owner: 'a' },
  { x: 10, y: 0, w: 1, kind: 'nebula', owner: null },
  { x: 5, y: 10, w: 2, kind: 'planet', owner: 'b' },
];
const clip: Array<[number, number]> = [
  [-5, -5],
  [15, -5],
  [15, 15],
  [-5, 15],
];

describe('кэш формы провинций', () => {
  it('переносит и масштабирует готовую мозаику без смены геометрии', () => {
    const cache = new TerritoryGeometryCache();
    const cells = cache.cells(seeds, clip);
    for (const scale of [0.3, 1, 6])
      for (const x of [-1200, 0, 75]) {
        const offset = { x, y: 230 };
        const cached = projectTerritoryCells(cache.cells(seeds, clip), scale, offset);
        const direct = computePowerCells(
          seeds.map((s) => ({
            ...s,
            x: s.x * scale + offset.x,
            y: s.y * scale + offset.y,
            w: s.w * scale * scale,
          })),
          clip.map(([px, py]) => [px * scale + offset.x, py * scale + offset.y]),
        );
        expect(cached).toHaveLength(direct.length);
        for (let i = 0; i < cached.length; i++) {
          expect(cached[i]!.tags).toEqual(direct[i]!.tags);
          cached[i]!.poly.forEach((p, k) =>
            p.forEach((v, axis) => expect(v).toBeCloseTo(direct[i]!.poly[k]![axis]!, 6)),
          );
        }
        expect(cache.cells(seeds, clip)[0]!.poly).toBe(cells[0]!.poly);
      }
  });

  it('обновляет известного владельца и тип без пересчёта формы, не хранит чужие знания', () => {
    const cache = new TerritoryGeometryCache();
    const old = cache.cells(seeds, clip);
    const changed = cache.cells(
      seeds.map((s) => ({ ...s, owner: null, kind: 'unknown' })),
      clip,
    );
    expect(changed.every((c) => c.owner === null && c.kind === 'unknown')).toBe(true);
    expect(changed[0]!.poly).toBe(old[0]!.poly);
    expect(old[0]!.owner).toBe('a');
  });

  it('изменение размера, координат, состава или рамки инвалидирует кэш даже при мутации входа', () => {
    for (const change of ['weight', 'position', 'roster', 'clip']) {
      const cache = new TerritoryGeometryCache();
      const sites = seeds.map((s) => ({ ...s }));
      const bounds = clip.map((p) => [...p] as [number, number]);
      const old = cache.cells(sites, bounds);
      if (change === 'weight') sites[0]!.w++;
      if (change === 'position') sites[0]!.x++;
      if (change === 'roster') sites.pop();
      if (change === 'clip') bounds[0]![0]--;
      const next = cache.cells(sites, bounds);
      expect(next).toEqual(computePowerCells(sites, bounds));
      expect(next[0]!.poly).not.toBe(old[0]!.poly);
    }
  });
});
