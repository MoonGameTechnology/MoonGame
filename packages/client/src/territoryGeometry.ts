import { computePowerCells, type TerritoryCell, type TerritorySeed } from './territory';
import { waveCells, type WaveConfig } from './territoryWave';

/** One geometry snapshot, independent of camera translation/zoom and viewer intel.
 * Reprojection is O(vertices); the quadratic tessellation runs only on shape changes. */
export class TerritoryGeometryCache {
  private signature = '';
  /** Сырая тесселяция — она КВАДРАТИЧНА по числу семян, и только ради неё этот кэш и
   *  существует. Волна поверх неё линейна по вершинам, поэтому накладывается каждый кадр:
   *  иначе «ветер» (меняющаяся фаза) пересчитывал бы всю мозаику на каждом кадре. */
  private tess: TerritoryCell[] = [];

  /**
   * @param wave Живая линия границы (M2.9). Накладывается ЗДЕСЬ, в локальных координатах
   *  — то есть ДО обратной проекции и после деления на зум. Поэтому изгиб не зависит от
   *  приближения и не ползёт при панораме; посчитай его в экранных, и форма поплыла бы.
   *  Единицы — локальные, перевод из мировых на вызывающем. Кэшируется вместе с формой,
   *  так что на дрожание камеры волна ничего не стоит.
   */
  project(
    seeds: TerritorySeed[],
    clip: Array<[number, number]>,
    scale: number,
    wave?: WaveConfig,
  ): TerritoryCell[] {
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
      // Дробление — часть ФОРМЫ (оно меняет сами вершины), а вот ФАЗА в подпись не
      // входит: ветер не повод пересчитывать тесселяцию.
      `|${wave ? `${q(wave.amp)},${q(wave.wavelength)},${q(wave.segment)}` : ''}`;
    if (signature !== this.signature) {
      this.tess = computePowerCells(local, boundary);
      this.signature = signature;
    }
    const shaped = wave ? waveCells(this.tess, wave) : this.tess;
    return shaped.map((cell) => ({
      ...cell,
      poly: cell.poly.map(([x, y]): [number, number] => [x * scale + ox, y * scale + oy]),
      // Never retain the owner/kind from a previous viewer or fog snapshot.
      owner: seeds[cell.idx]!.owner,
      kind: seeds[cell.idx]!.kind,
    }));
  }
}
