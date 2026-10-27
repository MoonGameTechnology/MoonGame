/**
 * Рисунки зданий базы корпорации (CORP-13): по картинке на уровень, I–III.
 *
 * Листы владельца `art/corporations/<стиль>/<здание>.png` режет `scripts/cut-corp-art.py`.
 * Уровни здания лежат на одном холсте, низ холста — фронт платформы: повышение уровня не
 * сдвигает и не масштабирует здание на панораме. `manifest.json` даёт размер холста и рамку
 * нарисованного на каждом уровне — по ней хаб строит зону нажатия.
 *
 * База рисуется в основном стиле: имперская готика и хайтек нарезаны рядом и ждут магазина.
 */
import manifest from '../art/corp/manifest.json';
import headquarters1 from '../art/corp/standard/headquarters-1.webp';
import headquarters2 from '../art/corp/standard/headquarters-2.webp';
import headquarters3 from '../art/corp/standard/headquarters-3.webp';
import supplyCenter1 from '../art/corp/standard/supply_center-1.webp';
import supplyCenter2 from '../art/corp/standard/supply_center-2.webp';
import supplyCenter3 from '../art/corp/standard/supply_center-3.webp';
import engineeringComplex1 from '../art/corp/standard/engineering_complex-1.webp';
import engineeringComplex2 from '../art/corp/standard/engineering_complex-2.webp';
import engineeringComplex3 from '../art/corp/standard/engineering_complex-3.webp';

/** Картинка уровня здания. */
export interface CorpArt {
  src: string;
  /** Холст в пикселях — общий для всех уровней здания. */
  w: number;
  h: number;
  /** Рамка нарисованного на этом уровне в долях холста: x0, y0, x1, y1. */
  box: readonly number[];
}

const LEVELS: Readonly<Record<string, readonly string[]>> = {
  headquarters: [headquarters1, headquarters2, headquarters3],
  supply_center: [supplyCenter1, supplyCenter2, supplyCenter3],
  engineering_complex: [engineeringComplex1, engineeringComplex2, engineeringComplex3],
};

type Sheets = Readonly<Record<string, { w: number; h: number; box: readonly (readonly number[])[] }>>;

/** Здания, у которых есть рисунки. Вызов помечен чистым: без вкладки «Корпорация» модуль
 *  выпадает из сборки вместе с картинками, и в архив площадки (Sector Zero) они не едут. */
export const CORP_ART_BUILDINGS: readonly string[] = /* @__PURE__ */ Object.keys(LEVELS);

/** Рисунок здания на уровне `level`: ниже первого — первый, выше нарисованных — последний.
 *  `null` — здание ещё не нарисовано. */
export function corpArt(id: string, level: number): CorpArt | null {
  const levels = LEVELS[id];
  // Опись читается здесь, а не в теле модуля: обращение к свойству в теле сборщик оставил
  // бы в архиве площадки.
  const sheet = (manifest.standard as Sheets)[id];
  if (!levels || !sheet) return null;
  const i = Math.min(Math.max(Math.trunc(level), 1), levels.length) - 1;
  const src = levels[i];
  const box = sheet.box[i];
  return src && box ? { src, w: sheet.w, h: sheet.h, box } : null;
}
