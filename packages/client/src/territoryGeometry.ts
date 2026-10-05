import {
  classifyBorders,
  computePowerCells,
  type ClassifiedBorders,
  type TerritoryCell,
  type TerritorySeed,
} from './territory';
import { waveCells, type WaveConfig } from './territoryWave';

/** A cell of the cached shape: its polygon and per-edge neighbour tags in the cache's local
 *  space, and the seed it belongs to. No owner and no kind: those are the viewer's, and every
 *  call takes them fresh from its own seeds. */
export type ShapeCell = Pick<TerritoryCell, 'poly' | 'tags' | 'idx'>;

/** The provinces' shape in local space, independent of camera translation/zoom and viewer
 *  intel. `boxes` holds the box of `cells[i]` at `4i` (x0, y0, x1, y1). */
export interface TerritoryShape {
  readonly cells: readonly ShapeCell[];
  readonly boxes: Float64Array;
}

/** Where local space lands in the caller's: local point (x, y) lies at
 *  (x·scale + x, y·scale + y). */
export interface ShapePlacement {
  readonly scale: number;
  readonly x: number;
  readonly y: number;
}

/**
 * A local polygon in the caller's space. Whatever places local points — this, and the border
 * strokes that place theirs as they draw — uses this same expression, `v·scale + offset`, so a
 * point placed in two places is one number to the last bit, and so is its box: the placement
 * is a positive scale, which keeps every min and max where it was.
 */
export function placePoly(
  poly: ReadonlyArray<readonly [number, number]>,
  at: ShapePlacement,
): Array<[number, number]> {
  return poly.map(([x, y]): [number, number] => [x * at.scale + at.x, y * at.scale + at.y]);
}

function boxesOf(cells: readonly ShapeCell[]): Float64Array {
  const boxes = new Float64Array(cells.length * 4);
  cells.forEach((cell, i) => {
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const [x, y] of cell.poly) {
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
    boxes[i * 4] = x0;
    boxes[i * 4 + 1] = y0;
    boxes[i * 4 + 2] = x1;
    boxes[i * 4 + 3] = y1;
  });
  return boxes;
}

/** One geometry snapshot, independent of camera translation/zoom and viewer intel.
 * The quadratic tessellation runs only on shape changes; placing a cell is O(its vertices),
 * and a caller places only the cells it draws. */
export class TerritoryGeometryCache {
  private signature = '';
  private current: TerritoryShape = { cells: [], boxes: new Float64Array(0) };
  private classified: {
    shape: TerritoryShape;
    owners: Array<string | null>;
    borders: ClassifiedBorders;
  } | null = null;

  /**
   * The shape of these seeds in local space, and where it lands among them.
   *
   * @param wave Живая линия границы (M2.9). Накладывается ЗДЕСЬ, в локальных координатах
   *  — то есть ДО обратной проекции и после деления на зум. Поэтому изгиб не зависит от
   *  приближения и не ползёт при панораме; посчитай его в экранных, и форма поплыла бы.
   *  Единицы — локальные, перевод из мировых на вызывающем. Кэшируется вместе с формой,
   *  так что на дрожание камеры волна ничего не стоит.
   */
  shape(
    seeds: TerritorySeed[],
    clip: Array<[number, number]>,
    scale: number,
    wave?: WaveConfig,
  ): { shape: TerritoryShape; place: ShapePlacement } {
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
      boundary.map(([x, y]) => `${q(x)},${q(y)}`).join(';') +
      // Волна — часть ФОРМЫ: сменилась настройка — форму надо пересчитать.
      `|${wave ? `${q(wave.amp)},${q(wave.wavelength)},${q(wave.segment)}` : ''}`;
    if (signature !== this.signature) {
      const tess = computePowerCells(local, boundary);
      const cells = (wave ? waveCells(tess, wave) : tess).map(({ poly, tags, idx }) => ({
        poly,
        tags,
        idx,
      }));
      this.current = { cells, boxes: boxesOf(cells) };
      this.signature = signature;
    }
    return { shape: this.current, place: { scale, x: ox, y: oy } };
  }

  /** Every cell of the shape placed among the seeds, with their owner and kind. */
  project(
    seeds: TerritorySeed[],
    clip: Array<[number, number]>,
    scale: number,
    wave?: WaveConfig,
  ): TerritoryCell[] {
    const { shape, place } = this.shape(seeds, clip, scale, wave);
    return shape.cells.map((cell) => ({
      poly: placePoly(cell.poly, place),
      tags: cell.tags,
      // Never retain the owner/kind from a previous viewer or fog snapshot.
      owner: seeds[cell.idx]!.owner,
      kind: seeds[cell.idx]!.kind,
      idx: cell.idx,
    }));
  }

  /**
   * The borders of `shape` classified by the owners of `seeds` (`classifyBorders`), in the
   * shape's local space: whoever strokes them places their points as {@link placePoly} does.
   * The classes depend on nothing but the owners, so a camera move reuses them, and they are
   * classified again only when the shape or an owner changes.
   */
  borders(shape: TerritoryShape, seeds: readonly TerritorySeed[]): ClassifiedBorders {
    const memo = this.classified;
    if (
      memo &&
      memo.shape === shape &&
      memo.owners.length === seeds.length &&
      seeds.every((s, i) => s.owner === memo.owners[i])
    )
      return memo.borders;
    const cells: TerritoryCell[] = shape.cells.map((cell) => ({
      ...cell,
      owner: seeds[cell.idx]!.owner,
      kind: seeds[cell.idx]!.kind,
    }));
    const borders = classifyBorders(cells, seeds);
    this.classified = { shape, owners: seeds.map((s) => s.owner), borders };
    return borders;
  }
}
