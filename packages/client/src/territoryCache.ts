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
    // Свежие обёртки НАМЕРЕННО: `territoryCache.test.ts` держит прежний результат и
    // требует, чтобы следующий вызов его не переписал. Дешёвую половину аллокаций
    // снимает проекция ниже — там буфер переиспользуется без такого контракта.
    return this.geometry.map((cell) => ({
      ...cell,
      owner: seeds[cell.idx]!.owner,
      kind: seeds[cell.idx]!.kind,
    }));
  }
}

/** A uniform camera transform preserves the power diagram (weights scale by k²).
 * Project its vertices, without re-clipping all n² seed pairs during camera motion.
 *
 * `into` — необязательный буфер выдачи того же размера: с ним ячейки переписываются на
 * месте и на кадр приходится на 831 объект меньше. Сами вершины всё равно создаются
 * заново: их массивы уезжают в `provincePolygons` и живут там до следующей перестройки
 * (хит-тест провинции, подсветка выделенной), поэтому переиспользовать их нельзя. */
export function projectTerritoryCells(
  cells: TerritoryCell[],
  scale: number,
  offset: { x: number; y: number },
  into?: TerritoryCell[],
): TerritoryCell[] {
  if (!into || into.length !== cells.length) {
    return cells.map((cell) => ({
      ...cell,
      poly: cell.poly.map(([x, y]) => [x * scale + offset.x, y * scale + offset.y]),
    }));
  }
  for (let i = 0; i < cells.length; i++) {
    const cell = cells[i]!;
    const slot = into[i]!;
    slot.idx = cell.idx;
    slot.owner = cell.owner;
    slot.kind = cell.kind;
    slot.poly = cell.poly.map(([x, y]) => [x * scale + offset.x, y * scale + offset.y]);
  }
  return into;
}
