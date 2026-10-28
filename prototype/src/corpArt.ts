/**
 * Рисунки зданий базы корпорации (CORP-13): по картинке на уровень, I–III, в каждом стиле
 * базы (CORP-14).
 *
 * Фронтальные листы владельца `art/corporations/frontal/<здание>.png` режет
 * `scripts/cut-corp-art.py`. Уровни здания лежат на одном холсте, низ холста — линия земли:
 * повышение уровня не сдвигает и не масштабирует здание на панораме. `manifest.json` даёт
 * размер холста и рамку нарисованного на каждом уровне — по ней хаб строит зону нажатия.
 *
 * Стиль базы применяет глава корпорации (`decisions/corpStyle.ts`); id стиля — из каталога
 * магазина (`data/metaEconomy.json`, `corpStyle`). Стиль без рисунков в этой сборке
 * рисуется стандартным.
 */
import manifest from '../art/corp/manifest.json';
import { CORP_STYLE_STANDARD } from '../../packages/protocol/src/corpStyle';
import headquarters1 from '../art/corp/standard/headquarters-1.webp';
import headquarters2 from '../art/corp/standard/headquarters-2.webp';
import headquarters3 from '../art/corp/standard/headquarters-3.webp';
import supplyCenter1 from '../art/corp/standard/supply_center-1.webp';
import supplyCenter2 from '../art/corp/standard/supply_center-2.webp';
import supplyCenter3 from '../art/corp/standard/supply_center-3.webp';
import engineeringComplex1 from '../art/corp/standard/engineering_complex-1.webp';
import engineeringComplex2 from '../art/corp/standard/engineering_complex-2.webp';
import engineeringComplex3 from '../art/corp/standard/engineering_complex-3.webp';
import gothicHeadquarters1 from '../art/corp/imperial-gothic/headquarters-1.webp';
import gothicHeadquarters2 from '../art/corp/imperial-gothic/headquarters-2.webp';
import gothicHeadquarters3 from '../art/corp/imperial-gothic/headquarters-3.webp';
import gothicSupplyCenter1 from '../art/corp/imperial-gothic/supply_center-1.webp';
import gothicSupplyCenter2 from '../art/corp/imperial-gothic/supply_center-2.webp';
import gothicSupplyCenter3 from '../art/corp/imperial-gothic/supply_center-3.webp';
import gothicEngineeringComplex1 from '../art/corp/imperial-gothic/engineering_complex-1.webp';
import gothicEngineeringComplex2 from '../art/corp/imperial-gothic/engineering_complex-2.webp';
import gothicEngineeringComplex3 from '../art/corp/imperial-gothic/engineering_complex-3.webp';
import techHeadquarters1 from '../art/corp/high-tech/headquarters-1.webp';
import techHeadquarters2 from '../art/corp/high-tech/headquarters-2.webp';
import techHeadquarters3 from '../art/corp/high-tech/headquarters-3.webp';
import techSupplyCenter1 from '../art/corp/high-tech/supply_center-1.webp';
import techSupplyCenter2 from '../art/corp/high-tech/supply_center-2.webp';
import techSupplyCenter3 from '../art/corp/high-tech/supply_center-3.webp';
import techEngineeringComplex1 from '../art/corp/high-tech/engineering_complex-1.webp';
import techEngineeringComplex2 from '../art/corp/high-tech/engineering_complex-2.webp';
import techEngineeringComplex3 from '../art/corp/high-tech/engineering_complex-3.webp';

/** Картинка уровня здания. */
export interface CorpArt {
  src: string;
  /** Холст в пикселях — общий для всех уровней здания. */
  w: number;
  h: number;
  /** Рамка нарисованного на этом уровне в долях холста: x0, y0, x1, y1. */
  box: readonly number[];
}

type Sheets = Readonly<Record<string, { w: number; h: number; box: readonly (readonly number[])[] }>>;

/** Стиль: ключ имени, папка в описи нарезки и рисунки уровней по зданиям. */
interface StyleArt {
  nameKey: string;
  folder: string;
  levels: Readonly<Record<string, readonly string[]>>;
}

const STANDARD_LEVELS: StyleArt['levels'] = {
  headquarters: [headquarters1, headquarters2, headquarters3],
  supply_center: [supplyCenter1, supplyCenter2, supplyCenter3],
  engineering_complex: [engineeringComplex1, engineeringComplex2, engineeringComplex3],
};

const STANDARD: StyleArt = { nameKey: 'corp.style.standard', folder: 'standard', levels: STANDARD_LEVELS };

/** Ключ — id стиля из каталога магазина; стандартный — `CORP_STYLE_STANDARD`. */
const STYLES: Readonly<Record<string, StyleArt>> = {
  standard: STANDARD,
  imperial_gothic: {
    nameKey: 'corp.style.imperial-gothic',
    folder: 'imperial-gothic',
    levels: {
      headquarters: [gothicHeadquarters1, gothicHeadquarters2, gothicHeadquarters3],
      supply_center: [gothicSupplyCenter1, gothicSupplyCenter2, gothicSupplyCenter3],
      engineering_complex: [gothicEngineeringComplex1, gothicEngineeringComplex2, gothicEngineeringComplex3],
    },
  },
  high_tech: {
    nameKey: 'corp.style.high-tech',
    folder: 'high-tech',
    levels: {
      headquarters: [techHeadquarters1, techHeadquarters2, techHeadquarters3],
      supply_center: [techSupplyCenter1, techSupplyCenter2, techSupplyCenter3],
      engineering_complex: [techEngineeringComplex1, techEngineeringComplex2, techEngineeringComplex3],
    },
  },
};

// Вызовы в теле модуля помечены чистыми: без вкладки «Корпорация» модуль выпадает из сборки
// вместе с картинками, и в архив площадки (Sector Zero) они не едут.

/** Стили, которые хаб умеет рисовать, — стандартный первым. */
export const CORP_STYLES: readonly string[] = /* @__PURE__ */ Object.keys(STYLES);

/** Здания, у которых есть рисунки. */
export const CORP_ART_BUILDINGS: readonly string[] = /* @__PURE__ */ Object.keys(STANDARD_LEVELS);

const styleArt = (style: string): StyleArt => STYLES[style] ?? STANDARD;

/** Ключ имени стиля; незнакомый стиль называется стандартным, как и рисуется. */
export function corpStyleName(style: string): string {
  return styleArt(style).nameKey;
}

/** Рисунок здания на уровне `level`: ниже первого — первый, выше нарисованных — последний.
 *  `null` — здание ещё не нарисовано. */
export function corpArt(id: string, level: number, style: string = CORP_STYLE_STANDARD): CorpArt | null {
  const art = styleArt(style);
  const levels = art.levels[id];
  // Опись читается здесь, а не в теле модуля: обращение к свойству в теле сборщик оставил
  // бы в архиве площадки.
  const sheet = (manifest as Readonly<Record<string, Sheets>>)[art.folder]?.[id];
  if (!levels || !sheet) return null;
  const i = Math.min(Math.max(Math.trunc(level), 1), levels.length) - 1;
  const src = levels[i];
  const box = sheet.box[i];
  return src && box ? { src, w: sheet.w, h: sheet.h, box } : null;
}
