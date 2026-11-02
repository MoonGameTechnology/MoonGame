import { isAvaMatchId } from '../packages/protocol/src/ava';

/** Server lists describe membership; the corporate tab keeps each row's source. */
export type MatchListTab = 'available' | 'active' | 'archived';
export type MatchPageTab = MatchListTab | 'corporate';

export function splitCorporateMatches<R extends { matchId: string }>(
  lists: Partial<Record<MatchListTab, readonly R[]>> | null,
): (Record<MatchListTab, R[]> & { corporate: Array<{ match: R; source: MatchListTab }> }) | null {
  if (!lists) return null;
  const out: Record<MatchListTab, R[]> & { corporate: Array<{ match: R; source: MatchListTab }> } =
    {
      available: [],
      active: [],
      archived: [],
      corporate: [],
    };
  const seen = new Set<string>();
  for (const source of ['active', 'available', 'archived'] as const) {
    for (const match of lists[source] ?? []) {
      if (!isAvaMatchId(match.matchId)) out[source].push(match);
      else if (!seen.has(match.matchId)) {
        seen.add(match.matchId);
        out.corporate.push({ match, source });
      }
    }
  }
  return out;
}
