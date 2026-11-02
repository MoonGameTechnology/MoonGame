import { describe, expect, it } from 'vitest';
import {
  diploDisplayName,
  nextDiploSort,
  selectDiploRoster,
  type DiploParticipant,
  type DiploRosterOptions,
} from './diploRoster';

const rows: DiploParticipant[] = [
  { id: 'me', house: 'Alpha', nick: 'Zulu', kind: 'human', worlds: 2, stance: null },
  { id: 'a', house: 'Zulu', nick: 'Pilot 10', kind: 'human', worlds: 9, stance: 'peace' },
  { id: 'b', house: 'Beta', nick: 'Pilot 2', kind: 'human', worlds: 3, stance: 'war' },
  { id: 'bot', house: 'Crimson', nick: 'A stale nick', kind: 'ai', worlds: 3, stance: 'alliance' },
];
const options: DiploRosterOptions = {
  sort: { key: 'name', direction: 'asc' },
  query: '',
  stances: new Set(),
  kinds: new Set(),
  locale: 'en',
};
const ids = (opts: Partial<DiploRosterOptions> = {}, input = rows) =>
  selectDiploRoster(input, { ...options, ...opts }).map((row) => row.id);

describe('diplomacy roster ordering and filtering', () => {
  it('sorts visible nicknames naturally and includes the player instead of pinning them', () => {
    expect(ids()).toEqual(['bot', 'b', 'a', 'me']);
    expect(ids({ sort: { key: 'name', direction: 'desc' } })).toEqual(['me', 'a', 'b', 'bot']);
    expect(diploDisplayName(rows[3]!)).toBe('Crimson');
  });
  it('orders provinces numerically in both directions with a visible-name tie breaker', () => {
    expect(ids({ sort: { key: 'worlds', direction: 'desc' } })).toEqual(['a', 'bot', 'b', 'me']);
    expect(ids({ sort: { key: 'worlds', direction: 'asc' } })).toEqual(['me', 'bot', 'b', 'a']);
  });
  it('orders stances from war to alliance and back; self is outside the stance scale', () => {
    expect(ids({ sort: { key: 'stance', direction: 'asc' } })).toEqual(['me', 'b', 'a', 'bot']);
    expect(ids({ sort: { key: 'stance', direction: 'desc' } })).toEqual(['bot', 'a', 'b', 'me']);
  });
  it('combines search by nickname/house with OR within filters and AND across categories', () => {
    expect(ids({ query: '  PILOT   zulu ' })).toEqual(['a']);
    expect(ids({ query: 'stale' })).toEqual([]);
    expect(ids({ kinds: new Set(['human']), stances: new Set(['war', 'peace']) })).toEqual([
      'b',
      'a',
    ]);
    expect(ids({ query: 'Crimson', kinds: new Set(['human']) })).toEqual([]);
  });
  it('breaks equal names by seat ID independently of snapshot insertion order without mutation', () => {
    const tied = rows.map((r) => ({ ...r, house: 'Equal', nick: 'equal' }));
    const before = JSON.stringify(tied);
    expect(ids({}, tied)).toEqual(ids({}, [...tied].reverse()));
    expect(JSON.stringify(tied)).toBe(before);
  });
  it('uses the selected locale for Russian case-insensitive names and search', () => {
    const ru = rows.slice(0, 2).map((r, i) => ({ ...r, nick: ['Ястреб', 'альфа'][i] }));
    expect(ids({ locale: 'ru' }, ru)).toEqual(['a', 'me']);
    expect(ids({ locale: 'ru', query: 'ЯСТРЕБ' }, ru)).toEqual(['me']);
  });
  it('toggles direction only on repeated selection and defaults provinces to descending', () => {
    expect(nextDiploSort(options.sort, 'name')).toEqual({ key: 'name', direction: 'desc' });
    expect(nextDiploSort(options.sort, 'worlds')).toEqual({ key: 'worlds', direction: 'desc' });
    expect(nextDiploSort({ key: 'worlds', direction: 'desc' }, 'stance')).toEqual({
      key: 'stance',
      direction: 'asc',
    });
  });
});
