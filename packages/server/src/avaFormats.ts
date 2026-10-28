import rawFormats from '../../../data/avaFormats.json';
import { CORP_BUILDINGS } from './corpConstruction';

/**
 * CORP-7 — AvA battle formats (`data/avaFormats.json`). A battle is played N on N; the
 * format sets the challenge price, the winner's influence and the fewest players a side
 * must gather by the roster lock (bots take the rest of the seats, never more than a
 * quarter of a side). Every corporation plays up to `baseMaxFormat`; a larger format is
 * opened by a building level's `maxFormat` (the operations center). Meta-only data like the
 * building catalog: validated once, embedded in both server bundles, fail-secure.
 */

export interface AvaFormat {
  /** Players per side. */
  format: number;
  /** Influence the challenger pays; refunded on decline, expiry or cancellation. */
  cost: number;
  /** Influence the winning corporation receives. */
  reward: number;
  /** Fewest players per side at the roster lock: a shorter side cancels the battle. */
  minPlayers: number;
}

export interface AvaFormatCatalog {
  /** The largest format a corporation plays without any building. */
  baseMaxFormat: number;
  /** Ascending by `format`. */
  formats: AvaFormat[];
}

const positive = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value > 0;

export function parseAvaFormats(raw: unknown): AvaFormatCatalog {
  const catalog = raw as Partial<AvaFormatCatalog> | null;
  const rows = catalog?.formats;
  if (!Array.isArray(rows) || rows.length === 0) throw new Error('E_AVA_FORMATS');
  let previous = 1;
  for (const row of rows as AvaFormat[]) {
    if (
      !row ||
      !positive(row.format) ||
      row.format <= previous ||
      !positive(row.cost) ||
      !positive(row.reward) ||
      !positive(row.minPlayers) ||
      row.minPlayers > row.format
    )
      throw new Error('E_AVA_FORMATS');
    previous = row.format;
  }
  const formats = structuredClone(rows as AvaFormat[]);
  const known = new Set(formats.map((row) => row.format));
  // The base and every format a building opens must be formats a battle can be played in.
  if (
    !known.has(catalog!.baseMaxFormat as number) ||
    CORP_BUILDINGS.some((b) =>
      b.levels.some((l) => l.maxFormat !== undefined && !known.has(l.maxFormat)),
    )
  )
    throw new Error('E_AVA_FORMATS');
  return { baseMaxFormat: catalog!.baseMaxFormat as number, formats };
}

export const AVA_FORMATS = parseAvaFormats(rawFormats);

/** The catalog row of a format; undefined for one the catalog does not know. */
export function avaFormat(catalog: AvaFormatCatalog, format: number): AvaFormat | undefined {
  return catalog.formats.find((row) => row.format === format);
}

/** The largest format a corporation plays with these buildings at these levels (the
 *  infrastructure view's `buildings`): the base, or what a built level opens. */
export function corpMaxFormat(
  catalog: AvaFormatCatalog,
  buildings: ReadonlyArray<{ level: number; levels: ReadonlyArray<{ maxFormat?: number }> }>,
): number {
  let max = catalog.baseMaxFormat;
  for (const building of buildings) {
    const opened = building.levels[building.level - 1]?.maxFormat;
    if (opened !== undefined && opened > max) max = opened;
  }
  return max;
}
