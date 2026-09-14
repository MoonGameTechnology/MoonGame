import { computePowerCells, type TerritoryCell, type TerritorySeed } from './territory';

/** One map's camera-independent tessellation. O(n) validation, bounded to one entry.
 * Owners and kinds are deliberately rebound from the viewer's current knowledge on
 * every read. Returned polygons/tags are shared and must be treated as read-only. */
export class TerritoryGeometryCache {
  private seeds: Array<{ x: number; y: number; w: number }> = [];
  private clip: Array<[number, number]> = [];
  private geometry: TerritoryCell[] = [];

  cells(seeds: TerritorySeed[], clip: Array<[number, number]>): TerritoryCell[] {
    const same =
      seeds.length === this.seeds.length &&
      clip.length === this.clip.length &&
      seeds.every(
        (s, i) => s.x === this.seeds[i]!.x && s.y === this.seeds[i]!.y && s.w === this.seeds[i]!.w,
      ) &&
      clip.every((p, i) => p[0] === this.clip[i]![0] && p[1] === this.clip[i]![1]);
    if (!same) {
      this.seeds = seeds.map(({ x, y, w }) => ({ x, y, w }));
      this.clip = clip.map(([x, y]) => [x, y]);
      // Cache geometry only, never an owner's hidden/live identity.
      this.geometry = computePowerCells(
        seeds.map((s) => ({ ...s, owner: null, kind: '' })),
        clip,
      );
    }
    return this.geometry.map((cell) => ({
      ...cell,
      owner: seeds[cell.idx]!.owner,
      kind: seeds[cell.idx]!.kind,
    }));
  }
}

/** A uniform camera transform preserves the power diagram (weights scale by k²).
 * Project its vertices, without re-clipping all n² seed pairs during camera motion. */
export function projectTerritoryCells(
  cells: TerritoryCell[],
  scale: number,
  offset: { x: number; y: number },
): TerritoryCell[] {
  return cells.map((cell) => ({
    ...cell,
    poly: cell.poly.map(([x, y]) => [x * scale + offset.x, y * scale + offset.y]),
  }));
}
