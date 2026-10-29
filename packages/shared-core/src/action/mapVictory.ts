import { DEFAULT_SCORE_LIMIT } from '../modules/victory';

/**
 * The victory rules of each catalogued map — ONE table for every host. The local
 * simulation and the players' host read it through `prototype/src/mapCatalog.ts`, the
 * canonical server when it raises a match (`createMatchLoader`). The same numbers once
 * stood in two places and parted the HUD's progress bar from the real end of a match;
 * a host without the table judged a corporations battle on a team map by the core's
 * threshold while the HUD counted to the map's (CORP-8).
 */

/** Score threshold per map (BAL-16, owner's resolution 2026-10-15): the points of the
 *  whole built-up map. Half the map taken without a fight brings 55–59% of it, won
 *  battles bring the rest (measured 2026-10-14: 120 bot matches of 30 days). */
export const MAP_SCORE_LIMITS = {
  'duel-1': 560,
  'ffa-4': 790,
  'team-2v2': 2200,
  'team-3v3': 3300,
  // The large FFAs keep the frontier's share of the map's points (~0.47 of the base): one
  // seat of twenty or fifty need not hold half the map to win on points.
  'ffa-20': 3800,
  'ffa-50': 9400,
  nexus: 1100,
  'frontier-50': 7500,
  'frontier-100': 15000,
  // The corporations battle maps retired by CORP-8 never got a threshold of their own: a
  // battle raised on one before then still plays the core's.
  'ava-duel-1': DEFAULT_SCORE_LIMIT,
  'ava-2v2-1': DEFAULT_SCORE_LIMIT,
} as const;

/** Captured share of provinces that wins at once (BAL-16, same resolution): 80% instead of
 *  the core's 60%, or capture ended the duel on day 4, before any battle. */
const MAP_DOMINATION_PERCENT: Readonly<Record<string, number>> = { 'duel-1': 0.8, 'ffa-4': 0.8 };

/** The victory rules a match on this map plays; `undefined` for a map outside the table,
 *  which keeps its mode's preset and the core's rules. */
export function mapVictoryRules(
  mapId: string | undefined,
): { scoreLimit: number; dominationPercent?: number } | undefined {
  if (mapId === undefined || !Object.hasOwn(MAP_SCORE_LIMITS, mapId)) return undefined;
  const domination = Object.hasOwn(MAP_DOMINATION_PERCENT, mapId)
    ? MAP_DOMINATION_PERCENT[mapId]
    : undefined;
  return {
    scoreLimit: MAP_SCORE_LIMITS[mapId as keyof typeof MAP_SCORE_LIMITS],
    ...(domination !== undefined ? { dominationPercent: domination } : {}),
  };
}
