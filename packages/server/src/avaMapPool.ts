import {
  avaShape,
  neutralSector,
  validateMatchMap,
  type GameData,
  type MatchMap,
  type Rng,
} from '@void/shared-core';
import { avaModeId, type AvaFormatCatalog } from './avaFormats';

/**
 * AvA map pool (AVA-5) — the orchestrator-side pick of "an AvA map for N×M"
 * (`corporation-wars.md` S4, consumed by AVA-7). Pure and deterministic:
 * candidates are the maps tagged `avaEligible` whose DERIVED shape matches the
 * requested size (`avaShape` — sides / slots-per-side come from the slots
 * themselves, so there are no declared numbers to drift), ordered canonically
 * by map id so the choice is independent of the caller's array order. A pick
 * spends exactly one draw of the supplied seeded `Rng` — same pool + same rng
 * state → the same map, so a session's map choice can be re-derived for
 * replays/audit. No eligible map of that size → `null` (the caller decides
 * whether that cancels the matchup); maps are assumed already validated
 * (`buildAvaMapPool` at load).
 */
export function pickAvaMap(
  maps: readonly MatchMap[],
  sides: number,
  slotsPerSide: number,
  rng: Rng,
): MatchMap | null {
  const pool = maps
    .filter((map) => {
      if (!map.avaEligible) return false;
      const shape = avaShape(map);
      return shape !== null && shape.sides === sides && shape.slotsPerSide === slotsPerSide;
    })
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  if (pool.length === 0) return null;
  return pool[rng.nextInt(0, pool.length)]!;
}

/**
 * CORP-8 — the map a battle is played on (pure): a team map as authored, or a larger map
 * cut down to the starts in `pairs`. The first start of a pair fights for side A (the
 * challenger, `seatAvaRoster`), the second for B; every other start is left neutral
 * (`neutralSector`) and its fleets leave the map. Inhabitants stay as authored. Every
 * start in `pairs` must be a slot of the map. Does not mutate the input.
 */
export function avaMapView(
  map: MatchMap,
  pairs?: ReadonlyArray<readonly [string, string]>,
): MatchMap {
  if (pairs === undefined) return { ...map, avaEligible: true };
  const side = new Map(
    pairs.flatMap(
      ([a, b]) =>
        [
          [a, 'A'],
          [b, 'B'],
        ] as const,
    ),
  );
  const unused = (owner: string | null): boolean =>
    owner !== null && Object.hasOwn(map.slots, owner) && !side.has(owner);
  return {
    ...map,
    avaEligible: true,
    slots: Object.fromEntries(
      [...side].map(([slot, team]) => [slot, { ...map.slots[slot]!, team }]),
    ),
    sectors: Object.fromEntries(
      Object.entries(map.sectors).map(([id, sector]) => [
        id,
        unused(sector.owner) ? neutralSector(sector) : sector,
      ]),
    ),
    fleets: Object.fromEntries(
      Object.entries(map.fleets).filter(([, fleet]) => !unused(fleet.owner)),
    ),
  };
}

/**
 * CORP-8 — the AvA map pool from the formats catalog: every format's maps resolved against
 * the shipped map files (`avaMapView`) and checked once at boot, so a broken catalog refuses
 * to start (fail-secure) instead of cancelling every battle of a format at its lock. Each
 * map must exist with every start it names, seat two sides of the format, have the format's
 * fixed-side mode, pass `validateMatchMap`, and keep each start on one side in every format
 * (a battle settles by the side of the winner's start).
 */
export function buildAvaMapPool(
  catalog: AvaFormatCatalog,
  maps: readonly MatchMap[],
  data: GameData,
): MatchMap[] {
  const issues: string[] = [];
  const pool: MatchMap[] = [];
  const sides = new Map<string, string>(); // `map/start` → the side it fights for
  for (const { format, maps: entries } of catalog.formats) {
    const modeId = avaModeId(format);
    if (!modeId || !data.modes[modeId]) issues.push(`${format}:E_NO_MODE`);
    for (const { id, pairs } of entries) {
      const at = `${format}:${id}`;
      const map = maps.find((m) => m.id === id);
      if (!map) {
        issues.push(`${at}:E_UNKNOWN_MAP`);
        continue;
      }
      const unknown = (pairs ?? []).flat().filter((start) => !Object.hasOwn(map.slots, start));
      if (unknown.length > 0) {
        issues.push(`${at}:E_UNKNOWN_START:${unknown.join(',')}`);
        continue;
      }
      const view = avaMapView(map, pairs);
      const shape = avaShape(view);
      if (shape?.sides !== 2 || shape.slotsPerSide !== format) issues.push(`${at}:E_AVA_SHAPE`);
      issues.push(...validateMatchMap(view, data).map((issue) => `${at}:${issue}`));
      for (const [start, { team }] of Object.entries(view.slots)) {
        const key = `${id}/${start}`;
        if ((sides.get(key) ?? team) !== team) issues.push(`${at}:E_SIDE_CHANGED:${start}`);
        sides.set(key, team);
      }
      pool.push(view);
    }
  }
  if (issues.length > 0) throw new Error(`E_AVA_MAPS: ${issues.join('; ')}`);
  return pool;
}
