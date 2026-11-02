import { STANCE_RANK } from '../packages/shared-core/src/state/diplomacy';
import type { DiplomaticStance } from '../packages/shared-core/src/state/gameState';

export type DiploSort = 'name' | 'worlds' | 'stance';
export interface DiploSortOrder {
  key: DiploSort;
  direction: 'asc' | 'desc';
}
export interface DiploParticipant {
  id: string;
  house: string;
  nick?: string;
  kind: 'human' | 'ai';
  worlds: number;
  /** Your own seat has no diplomatic stance towards itself. */
  stance: DiplomaticStance | null;
}
export interface DiploRosterOptions {
  sort: DiploSortOrder;
  query: string;
  stances: ReadonlySet<DiplomaticStance>;
  kinds: ReadonlySet<'human' | 'ai'>;
  locale: string;
}

/** Sort/search by precisely the name the roster displays, never a bot's stale nickname. */
export function diploDisplayName(row: DiploParticipant): string {
  return (row.kind === 'human' && row.nick) || row.house;
}

/** A second press reverses the order; a new column starts in its useful direction. */
export function nextDiploSort(current: DiploSortOrder, key: DiploSort): DiploSortOrder {
  return {
    key,
    direction:
      current.key === key
        ? current.direction === 'asc'
          ? 'desc'
          : 'asc'
        : key === 'worlds'
          ? 'desc'
          : 'asc',
  };
}

/** Pure presentation decision. Includes your own seat in name/province ordering. */
export function selectDiploRoster(
  participants: readonly DiploParticipant[],
  options: DiploRosterOptions,
): DiploParticipant[] {
  const fold = (value: string): string => value.normalize('NFKC').toLocaleLowerCase(options.locale);
  const terms = fold(options.query.trim()).split(/\s+/).filter(Boolean);
  const compare = new Intl.Collator(options.locale, { numeric: true, sensitivity: 'base' }).compare;
  const byName = (a: DiploParticipant, b: DiploParticipant): number =>
    compare(diploDisplayName(a), diploDisplayName(b));
  const direction = options.sort.direction === 'asc' ? 1 : -1;
  return participants
    .filter((row) => {
      if (options.stances.size && (!row.stance || !options.stances.has(row.stance))) return false;
      if (options.kinds.size && !options.kinds.has(row.kind)) return false;
      const text = fold(`${diploDisplayName(row)} ${row.house}`);
      return terms.every((term) => text.includes(term));
    })
    .sort((a, b) => {
      const primary =
        options.sort.key === 'name'
          ? byName(a, b)
          : options.sort.key === 'worlds'
            ? a.worlds - b.worlds
            : (a.stance ? STANCE_RANK[a.stance] : -1) - (b.stance ? STANCE_RANK[b.stance] : -1);
      return primary * direction || byName(a, b) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    });
}
