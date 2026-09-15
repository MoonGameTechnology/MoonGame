import { computePowerCells, type TerritoryCell, type TerritorySeed } from './territory';

/** One geometry snapshot, independent of camera translation/zoom and viewer intel.
 * Reprojection is O(vertices); the quadratic tessellation runs only on shape changes. */
export class TerritoryGeometryCache {
  private signature = '';
  private cells: TerritoryCell[] = [];

  project(seeds: TerritorySeed[], clip: Array<[number, number]>, scale: number): TerritoryCell[] {
    const [ox, oy] = clip[0]!;
    const point = (x: number, y: number): [number, number] => [(x - ox) / scale, (y - oy) / scale];
    const local = seeds.map((s) => {
      const [x, y] = point(s.x, s.y);
      return { ...s, x, y, w: s.w / (scale * scale) };
    });
    const boundary = clip.map(([x, y]) => point(x, y));
    // Floating-point camera roundoff is not a shape change. A microunit at base
    // scale stays below 0.00005 CSS pixels even at the largest supported zoom.
    const q = (n: number): number => Math.round(n * 1e6);
    const signature =
      local.map((s) => `${q(s.x)},${q(s.y)},${q(s.w)}`).join(';') +
      '|' +
      boundary.map(([x, y]) => `${q(x)},${q(y)}`).join(';');
    if (signature !== this.signature) {
      this.cells = computePowerCells(local, boundary);
      this.signature = signature;
    }
    return this.cells.map((cell) => ({
      ...cell,
      poly: cell.poly.map(([x, y]): [number, number] => [x * scale + ox, y * scale + oy]),
      // Never retain the owner/kind from a previous viewer or fog snapshot.
      owner: seeds[cell.idx]!.owner,
      kind: seeds[cell.idx]!.kind,
    }));
  }
}
