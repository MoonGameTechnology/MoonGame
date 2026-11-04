import confusables from './unicode-confusables.json';

const mapping: Readonly<Record<string, string>> = confusables.mapping;

/** Registration collision key, never an authentication lookup or a displayed name.
 * Unicode TR39 data is pinned and vendored with its source digest and license. */
export function loginSkeleton(login: string): string {
  // Preserve capital confusables (e.g. Cyrillic М -> M) before case folding.
  // Re-map the folded result so M/m still share the same rn skeleton.
  const visual = Array.from(login.normalize('NFKD'), (c) => mapping[c] ?? c)
    .join('')
    .normalize('NFD')
    .toLowerCase();
  return Array.from(visual, (c) => mapping[c] ?? c)
    .join('')
    .normalize('NFD')
    .toLowerCase();
}

/** Keep both case-sensitive visual matches and case-insensitive handle variants.
 * A capital I and a small i have different TR39 shapes; neither may be discarded. */
export function loginSkeletons(login: string): string[] {
  return [...new Set([login, login.toLowerCase(), login.toUpperCase()].map(loginSkeleton))].sort();
}

const STAFF_NAMES = /* @__PURE__ */ (() =>
  new Set(
    [
      'admin',
      'administrator',
      'moderator',
      'support',
      'operator',
      'official',
      'system',
      'админ',
      'администратор',
      'модератор',
      'поддержка',
      'оператор',
      'официальный',
    ].flatMap(loginSkeletons),
  ))();

/** Reserve complete role tokens (including numeric suffixes), not arbitrary substrings. */
export function reservedStaffName(login: string): boolean {
  const parts = login.normalize('NFKC').split(/[_-]+/u);
  return [...parts, parts.join('')].some((part) =>
    loginSkeletons(part.replace(/\p{N}/gu, '')).some((key) => STAFF_NAMES.has(key)),
  );
}
