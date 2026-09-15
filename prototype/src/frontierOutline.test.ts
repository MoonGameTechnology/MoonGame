import { describe, expect, it } from 'vitest';
import { frontierOutline } from './frontierOutline';
import { mapPreset } from './mapCatalog';
import { clipPolygon, clipRect } from './provinceMap';
import {
  computePowerCells,
  computePowerCell,
  type TerritoryCell,
} from '../../packages/client/src/territory';

const area = (cell: TerritoryCell): number =>
  Math.abs(
    cell.poly.reduce((sum, p, i, poly) => {
      const q = poly[(i + 1) % poly.length]!;
      return sum + p[0] * q[1] - q[0] * p[1];
    }, 0),
  ) / 2;

describe('finite Frontier rim', () => {
  it.each(['frontier-50', 'frontier-100'])(
    'removes stretched corners without losing provinces: %s',
    (id) => {
      const nodes = mapPreset(id).nodes;
      const before = structuredClone(nodes);
      const outline = frontierOutline(nodes).map((p): [number, number] => [p.x, p.y]);
      const seeds = nodes.map((n) => ({
        ...n,
        w: n.sector === 'nebula' ? 13500 : 9000,
        kind: n.sector,
      }));
      const rect = clipRect({
        minX: Math.min(...nodes.map((n) => n.x)),
        maxX: Math.max(...nodes.map((n) => n.x)),
        minY: Math.min(...nodes.map((n) => n.y)),
        maxY: Math.max(...nodes.map((n) => n.y)),
      });
      const old = computePowerCells(seeds, clipPolygon(rect.topLeft, rect.bottomRight));
      const cells = computePowerCells(seeds, outline);
      expect(cells).toHaveLength(nodes.length);
      expect(Math.max(...cells.filter((c) => c.idx !== 0).map(area))).toBeLessThan(
        Math.max(...old.filter((c) => c.idx !== 0).map(area)) * 0.35,
      );
      for (const cell of cells) {
        expect(area(cell)).toBeGreaterThan(0);
        const seed = nodes[cell.idx]!;
        // Every seed remains inside its own convex cell; no rim world is clipped away.
        for (let i = 0; i < cell.poly.length; i++) {
          const a = cell.poly[i]!;
          const b = cell.poly[(i + 1) % cell.poly.length]!;
          expect(
            (b[0] - a[0]) * (seed.y - a[1]) - (b[1] - a[1]) * (seed.x - a[0]),
          ).toBeGreaterThanOrEqual(-1e-6);
        }
      }
      expect(nodes).toEqual(before);
      const rim = cells.find((c) => c.tags.includes(-1))!;
      expect(computePowerCell(seeds, outline, rim.idx)).toEqual(rim);
      const scaled = computePowerCell(
        seeds.map((s) => ({ ...s, x: s.x * 3 + 123, y: s.y * 3 - 456, w: s.w * 9 })),
        outline.map(([x, y]) => [x * 3 + 123, y * 3 - 456]),
        rim.idx,
      )!;
      expect(scaled.poly).toHaveLength(rim.poly.length);
      scaled.poly.forEach(([x, y], i) => {
        expect(x).toBeCloseTo(rim.poly[i]![0] * 3 + 123, 5);
        expect(y).toBeCloseTo(rim.poly[i]![1] * 3 - 456, 5);
      });
    },
  );
});
