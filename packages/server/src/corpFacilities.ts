import type { CorpInfrastructureState, CorpPublicFacilities, CorpShowcaseError } from '@void/protocol';
import { CORP_BUILDINGS } from './corpConstruction';
import medals from '../../../data/medals.json';

/** Read-only benefits include a construction whose absolute deadline has elapsed.
 * The regular infrastructure transaction still settles income and its audit. */
export function corpFacilities(state: CorpInfrastructureState | null, now: number): Required<Pick<CorpPublicFacilities, 'warehouseItems' | 'showcaseSlots' | 'monument'>> {
  const levels = { ...state?.levels };
  const queued = state?.construction;
  if (queued && queued.completesAt <= now) levels[queued.buildingId] = queued.level;
  let warehouseItems = 0, showcaseSlots = 0, monument = false;
  for (const building of CORP_BUILDINGS) {
    const level = building.levels[(levels[building.id] ?? 0) - 1];
    warehouseItems = Math.max(warehouseItems, level?.warehouseItems ?? 0);
    showcaseSlots = Math.max(showcaseSlots, level?.showcaseSlots ?? 0);
    monument ||= level?.monument === true;
  }
  return { warehouseItems, showcaseSlots, monument };
}

export function publicCorpFacilities(state: CorpInfrastructureState | null, now: number, selected: readonly string[] = []): CorpPublicFacilities {
  const b = corpFacilities(state, now);
  return { ...(b.warehouseItems ? { warehouseItems: b.warehouseItems } : {}),
    ...(b.showcaseSlots ? { showcaseSlots: b.showcaseSlots, showcase: selected.slice(0, b.showcaseSlots) } : {}),
    ...(b.monument ? { monument: true } : {}) };
}

export function earnedCorpMedals(stats: { wins: number; matches: number }): string[] {
  return Object.entries(medals.medals).filter(([, medal]) => medal.scope === 'corp' &&
    (medal.condition.type === 'corp_wins' ? stats.wins : stats.matches) >= medal.condition.count).map(([id]) => id);
}

export function validateShowcase(selected: unknown, capacity: number, stats: { wins: number; matches: number }): CorpShowcaseError | null {
  if (!capacity) return 'E_CORP_HALL_REQUIRED';
  if (!Array.isArray(selected) || selected.length > capacity || selected.some((id) => typeof id !== 'string') || new Set(selected).size !== selected.length) return 'E_BAD_SHOWCASE';
  const earned = earnedCorpMedals(stats);
  return selected.every((id) => earned.includes(id)) ? null : 'E_CORP_MEDAL_NOT_EARNED';
}
