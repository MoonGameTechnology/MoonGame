import { hasFixedSides } from '@void/shared-core';
import rawFormats from '../../../data/avaFormats.json';
import { CORP_BUILDINGS } from './corpConstruction';

/**
 * CORP-7 — AvA battle formats (`data/avaFormats.json`). A battle is played N on N; the
 * format sets the challenge price, the winner's influence and the fewest players a side
 * must gather by the roster lock (bots take the rest of the seats, never more than a
 * quarter of a side). Every corporation plays up to `baseMaxFormat`; a larger format is
 * opened by a building level's `maxFormat` (the operations center). Meta-only data like the
 * building catalog: validated once, embedded in both server bundles, fail-secure.
 *
 * CORP-8: each format names the maps its battles are played on. A team map seats the
 * format with its own slots; a larger map is split in two by `pairs` — the starts in play,
 * one pair a seat, the first of a pair fighting for the challenger. The maps themselves are
 * checked at boot against the shipped map files (`buildAvaMapPool`).
 */

/** A map a format's battles are played on. */
export interface AvaFormatMap {
  /** A map id in `data/maps`. */
  id: string;
  /** Only on a split map: the starts in play, `[challenger's, target's]` a seat. A start
   *  keeps its side in every format: a battle settles by the side of the winner's start. */
  pairs?: Array<[string, string]>;
}

export interface AvaFormat {
  /** Players per side. */
  format: number;
  /** Influence the challenger pays; refunded on decline, expiry or cancellation. */
  cost: number;
  /** Influence the winning corporation receives. */
  reward: number;
  /** Fewest players per side at the roster lock: a shorter side cancels the battle. */
  minPlayers: number;
  /** The maps a battle of this format is played on; the orchestrator draws one. */
  maps: AvaFormatMap[];
}

export interface AvaFormatCatalog {
  /** The largest format a corporation plays without any building. */
  baseMaxFormat: number;
  /** Ascending by `format`. */
  formats: AvaFormat[];
}

const positive = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value > 0;

const named = (value: unknown): value is string => typeof value === 'string' && value.length > 0;

/** At least one map; a split map names one pair of starts a seat, no start twice. */
function validMaps(maps: unknown, format: number): boolean {
  if (!Array.isArray(maps) || maps.length === 0) return false;
  return maps.every((entry: Partial<AvaFormatMap> | null) => {
    if (!entry || !named(entry.id)) return false;
    const pairs: unknown = entry.pairs;
    if (pairs === undefined) return true;
    if (!Array.isArray(pairs) || pairs.length !== format) return false;
    if (!pairs.every((pair) => Array.isArray(pair) && pair.length === 2 && pair.every(named)))
      return false;
    const starts = (pairs as string[][]).flat();
    return new Set(starts).size === starts.length;
  });
}

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
      row.minPlayers > row.format ||
      !validMaps(row.maps, row.format)
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

/** CORP-4 — the mode a battle of `slotsPerSide` seats a side plays under. A team battle
 *  is a fixed-side match (`hasFixedSides`): the roster decides the sides, and every ending
 *  counts a side as one unit. One seat a side needs no mode — the base rules already pit
 *  the two seats against each other. `null`: the game has no fixed-side mode for this
 *  format, and a team battle is never played every seat for itself (fail-secure) — the
 *  orchestrator treats it like a battle no map fits, and the map pool refuses to boot. */
export function avaModeId(slotsPerSide: number): string | undefined | null {
  if (slotsPerSide <= 1) return undefined;
  const modeId = `team_${slotsPerSide}v${slotsPerSide}`;
  return hasFixedSides(modeId) ? modeId : null;
}
