import names from '../../../data/corpNames.json';

/** Canonical proper names shared by all viewers, independent of client input/locale. */
export const CORP_NAME_COUNT = names.prefixes.length * names.nouns.length;

export function generatedCorpName(index: number): string {
  if (!Number.isInteger(index) || index < 0 || index >= CORP_NAME_COUNT) throw Error('E_BAD_NAME');
  return `${names.prefixes[Math.floor(index / names.nouns.length)]!} ${names.nouns[index % names.nouns.length]!}`;
}
