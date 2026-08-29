/**
 * Сторож дрейфа двух каталогов контента (CONV-11).
 *
 * Контент в проекте заведён ДВАЖДЫ: `prototype/src/prototypeData.ts` (инлайновый объект,
 * его читают играбельный прототип, прото-хост и оба харнеса замера) и `data/*.json`
 * (бандл, его читают `packages/server` и `packages/client`). Ядро контента не знает
 * вовсе — оно принимает `GameData` как данные, — поэтому один движок спокойно гоняет два
 * разных набора, и ничто не мешает добавить юнит в один каталог и забыть про другой.
 * Так эти двое и разъехались: у них совпали только идентификаторы, а `stats`, `effects`,
 * `unlocks`, `slots` и местами САМА СТРУКТУРА (одно здание с лестницей `upgrades` против
 * двух отдельных зданий) — разные.
 *
 * 1. **Этот модуль про то, чтобы дрейф ПЕРЕСТАЛ РАСТИ, а не про сведение.** Свести —
 *    отдельная работа (CONV-12), и у неё есть развилка, которую нельзя решить тестом.
 *    Здесь фиксируется СЕГОДНЯШНИЙ список расхождений как базовый, и красным становится
 *    только НОВОЕ: ключ, заведённый в одном каталоге, поле, разошедшееся впервые.
 * 2. **Базовый список обязан быть ТОЧНЫМ, а не «не меньше».** Исчезнувшее расхождение
 *    тоже валит тест: устаревший базовый список врёт о размере долга ровно так же, как
 *    пропущенное новое расхождение врёт о его росте. Убрать строку — часть работы,
 *    которая это расхождение закрыла (конвенция `.trivyignore`: запись живёт, пока живёт
 *    её обоснование).
 * 3. **Гранулярность — поле, а не сущность.** Иначе новое поле у уже разошедшегося юнита
 *    прошло бы молча: строка `units/frigate` уже в базовом списке, и добавленный
 *    `radarRange` спрятался бы за ней.
 * 4. **`version` не сравнивается.** Это версия БАНДЛА, а не контента: она различается
 *    по определению и краснела бы на каждом релизе канона, ничего не говоря о дрейфе.
 */

import type { GameData } from '../../packages/shared-core/src/index';

/** Разделы-словари сущностей: сравниваются по ключам и полям (правило 3). */
const CATALOG_SECTIONS = [
  'units',
  'factions',
  'buildings',
  'events',
  'sectors',
  'sectorKinds',
  'planetTypes',
  'technologies',
  'scientists',
  'modules',
  'heroes',
  'heroAbilities',
  'heroPassives',
  'heroSkillTrees',
  'heroFittings',
  'modes',
] as const;

/** Разделы-объекты (не словари сущностей): сравниваются по полям верхнего уровня. */
const SETTING_SECTIONS = ['rewards', 'researchBoost', 'market'] as const;

type Catalog = Record<string, unknown>;

const asCatalog = (v: unknown): Catalog => (v && typeof v === 'object' ? (v as Catalog) : {});

/** Порядок ключей не значим — сравниваем канонизированный JSON. */
function same(a: unknown, b: unknown): boolean {
  return stable(a) === stable(b);
}

function stable(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v) ?? 'undefined';
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`;
  const o = v as Catalog;
  return `{${Object.keys(o)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stable(o[k])}`)
    .join(',')}}`;
}

/** Расхождения одного раздела-словаря. */
function diffSection(section: string, proto: Catalog, canon: Catalog): string[] {
  const out: string[] = [];
  for (const key of Object.keys(proto).sort()) {
    if (!(key in canon)) {
      out.push(`${section}/${key} only-in-prototype`);
      continue;
    }
    const a = asCatalog(proto[key]);
    const b = asCatalog(canon[key]);
    for (const field of [...new Set([...Object.keys(a), ...Object.keys(b)])].sort()) {
      if (!same(a[field], b[field])) out.push(`${section}/${key} field:${field}`);
    }
  }
  for (const key of Object.keys(canon).sort()) {
    if (!(key in proto)) out.push(`${section}/${key} only-in-canon`);
  }
  return out;
}

/**
 * Полный список расхождений двух каталогов — отсортированный, устойчивый к порядку
 * ключей. Одна строка = одно расхождение (правило 3).
 */
export function contentDivergences(proto: GameData, canon: GameData): string[] {
  const p = proto as unknown as Catalog;
  const c = canon as unknown as Catalog;
  const out: string[] = [];

  // Ресурсы — множество идентификаторов, а не словарь определений.
  const pr = new Set(proto.resources);
  const cr = new Set(canon.resources);
  for (const id of [...pr].sort()) if (!cr.has(id)) out.push(`resources/${id} only-in-prototype`);
  for (const id of [...cr].sort()) if (!pr.has(id)) out.push(`resources/${id} only-in-canon`);

  for (const section of CATALOG_SECTIONS)
    out.push(...diffSection(section, asCatalog(p[section]), asCatalog(c[section])));

  for (const section of SETTING_SECTIONS) {
    const a = asCatalog(p[section]);
    const b = asCatalog(c[section]);
    for (const field of [...new Set([...Object.keys(a), ...Object.keys(b)])].sort())
      if (!same(a[field], b[field])) out.push(`${section} field:${field}`);
  }
  return out.sort();
}

/** Разобрать базовый список: строки без комментариев и пустых (конвенция `.trivyignore`). */
export function parseBaseline(text: string): string[] {
  return text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith('#'))
    .sort();
}

/** Что изменилось против базового списка (правила 1–2). */
export interface ParityDrift {
  /** Расхождения, которых в базовом списке нет — дрейф ВЫРОС. */
  added: string[];
  /** Строки базового списка, которых больше нет — долг закрыт, запись пора убрать. */
  gone: string[];
}

export function parityDrift(actual: readonly string[], baseline: readonly string[]): ParityDrift {
  const base = new Set(baseline);
  const now = new Set(actual);
  return {
    added: actual.filter((l) => !base.has(l)),
    gone: baseline.filter((l) => !now.has(l)),
  };
}
