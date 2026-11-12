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
import sovietHeadquarters1 from '../art/corp/soviet-retrofuturism/headquarters-1.webp';
import sovietHeadquarters2 from '../art/corp/soviet-retrofuturism/headquarters-2.webp';
import sovietHeadquarters3 from '../art/corp/soviet-retrofuturism/headquarters-3.webp';
import sovietSupplyCenter1 from '../art/corp/soviet-retrofuturism/supply_center-1.webp';
import sovietSupplyCenter2 from '../art/corp/soviet-retrofuturism/supply_center-2.webp';
import sovietSupplyCenter3 from '../art/corp/soviet-retrofuturism/supply_center-3.webp';
import sovietEngineeringComplex1 from '../art/corp/soviet-retrofuturism/engineering_complex-1.webp';
import sovietEngineeringComplex2 from '../art/corp/soviet-retrofuturism/engineering_complex-2.webp';
import sovietEngineeringComplex3 from '../art/corp/soviet-retrofuturism/engineering_complex-3.webp';
import imperialHeadquarters1 from '../art/corp/imperial/headquarters-1.webp';
import imperialHeadquarters2 from '../art/corp/imperial/headquarters-2.webp';
import imperialHeadquarters3 from '../art/corp/imperial/headquarters-3.webp';
import imperialSupplyCenter1 from '../art/corp/imperial/supply_center-1.webp';
import imperialSupplyCenter2 from '../art/corp/imperial/supply_center-2.webp';
import imperialSupplyCenter3 from '../art/corp/imperial/supply_center-3.webp';
import imperialEngineeringComplex1 from '../art/corp/imperial/engineering_complex-1.webp';
import imperialEngineeringComplex2 from '../art/corp/imperial/engineering_complex-2.webp';
import imperialEngineeringComplex3 from '../art/corp/imperial/engineering_complex-3.webp';
import expansion from '../art/corp/expansion/manifest.json';
import extraHeadquarters from '../art/corp/expansion/headquarters.webp';
import warehouse from '../art/corp/expansion/warehouse.webp';
import hall from '../art/corp/expansion/hall_of_fame.webp';
import operations from '../art/corp/expansion/operations_center.webp';
import monument from '../art/corp/expansion/monument.webp';

/** Картинка уровня здания. */
export interface CorpArt {
  src: string;
  /** Холст в пикселях — общий для всех уровней здания. */
  w: number;
  h: number;
  /** Рамка нарисованного на этом уровне в долях холста: x0, y0, x1, y1. */
  box: readonly number[];
  /** Cell viewport and placement on the common level canvas; the atlas stays intact. */
  frame?: { sx: number; sy: number; sw: number; sh: number; iw: number; ih: number; dx: number; dy: number; dw: number; dh: number };
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
  // Листы владельца рисуют в этих стилях только штаб I–III, центр снабжения и инженерный
  // комплекс; штаб IV–V и здания дополнения стоят в стандартном виде (corpArt).
  soviet_retrofuturism: {
    nameKey: 'corp.style.soviet-retrofuturism',
    folder: 'soviet-retrofuturism',
    levels: {
      headquarters: [sovietHeadquarters1, sovietHeadquarters2, sovietHeadquarters3],
      supply_center: [sovietSupplyCenter1, sovietSupplyCenter2, sovietSupplyCenter3],
      engineering_complex: [sovietEngineeringComplex1, sovietEngineeringComplex2, sovietEngineeringComplex3],
    },
  },
  imperial: {
    nameKey: 'corp.style.imperial',
    folder: 'imperial',
    levels: {
      headquarters: [imperialHeadquarters1, imperialHeadquarters2, imperialHeadquarters3],
      supply_center: [imperialSupplyCenter1, imperialSupplyCenter2, imperialSupplyCenter3],
      engineering_complex: [imperialEngineeringComplex1, imperialEngineeringComplex2, imperialEngineeringComplex3],
    },
  },
};

// Вызовы в теле модуля помечены чистыми: без вкладки «Корпорация» модуль выпадает из сборки
// вместе с картинками, и в архив площадки (Sector Zero) они не едут.

/** Стили, которые хаб умеет рисовать, — стандартный первым. */
export const CORP_STYLES: readonly string[] = /* @__PURE__ */ Object.keys(STYLES);

/** Здания, у которых есть рисунки. */
export const CORP_ART_BUILDINGS: readonly string[] = ['headquarters', 'supply_center', 'engineering_complex', 'operations_center', 'warehouse', 'hall_of_fame', 'monument'];

const styleArt = (style: string): StyleArt => Object.hasOwn(STYLES, style) ? STYLES[style]! : STANDARD;

// A sheet is shared by many SVG viewports. Do not copy its entire data URI into
// every card and every level thumbnail on each refresh (especially on Android).
const atlasUrls = /* @__PURE__ */ new Map<string, string>();
function atlasSrc(src: string): string {
  if (!src.startsWith('data:image/webp;base64,') || typeof URL.createObjectURL !== 'function') return src;
  const known = atlasUrls.get(src);
  if (known) return known;
  const bytes = Uint8Array.from(atob(src.slice(src.indexOf(',') + 1)), (char) => char.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([bytes], { type: 'image/webp' }));
  atlasUrls.set(src, url); // document-lifetime assets, released together with the page
  return url;
}

/** Ключ имени стиля; незнакомый стиль называется стандартным, как и рисуется. */
export function corpStyleName(style: string): string {
  return styleArt(style).nameKey;
}

/** Рисунок здания на уровне `level`: ниже первого — первый, выше нарисованных — последний.
 *  `null` — здание ещё не нарисовано. */
export function corpArt(id: string, level: number, style: string = CORP_STYLE_STANDARD): CorpArt | null {
  const art = styleArt(style);
  const knownStyle = Object.hasOwn(STYLES, style) ? style : CORP_STYLE_STANDARD;
  const atlas = expansion as Readonly<Record<string, Readonly<Record<string, readonly Omit<CorpArt, 'src'>[]>>>>;
  // Стиль без рисунков дополнения строит эти здания стандартными.
  const extras = (atlas[knownStyle] ?? atlas[CORP_STYLE_STANDARD])?.[id];
  if (extras && (id !== 'headquarters' || level >= 4)) {
    const sprites: Readonly<Record<string, string>> = { headquarters: extraHeadquarters, warehouse, hall_of_fame: hall, operations_center: operations, monument };
    const frame = extras[Math.min(Math.max(Math.trunc(level) - (id === 'headquarters' ? 4 : 1), 0), extras.length - 1)];
    const src = sprites[id];
    return frame && src ? { ...frame, src: atlasSrc(src) } : null;
  }
  const levels = art.levels[id];
  // Опись читается здесь, а не в теле модуля: обращение к свойству в теле сборщик оставил
  // бы в архиве площадки.
  const sheet = (manifest as Readonly<Record<string, Sheets>>)[art.folder]?.[id];
  if (!levels || !sheet) return null;
  const i = Math.min(Math.max(Math.trunc(level), 1), levels.length) - 1;
  const src = levels[i];
  const box = sheet.box[i];
  if (!src || !box) return null;
  if (id === 'headquarters') {
    const dx = (600 - sheet.w) / 2, dy = 600 - sheet.h;
    return { src, w: 600, h: 600,
      box: [(dx + box[0]! * sheet.w) / 600, (dy + box[1]! * sheet.h) / 600, (dx + box[2]! * sheet.w) / 600, (dy + box[3]! * sheet.h) / 600],
      frame: { sx: 0, sy: 0, sw: sheet.w, sh: sheet.h, iw: sheet.w, ih: sheet.h, dx, dy, dw: sheet.w, dh: sheet.h } };
  }
  return { src, w: sheet.w, h: sheet.h, box };
}
