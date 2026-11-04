import confusables from './unicode-confusables.json';

const mapping: Readonly<Record<string, string>> = confusables.mapping;
const visualMap = (text: string): string => Array.from(text, (c) => mapping[c] ?? c).join('');

/** Registration collision key, never an authentication lookup or a displayed name.
 * Unicode TR39 data is pinned and vendored with its source digest and license. */
export function loginSkeleton(login: string): string {
  // Preserve capital confusables (e.g. Cyrillic М -> M) before case folding.
  // Re-map the folded result so M/m still share the same rn skeleton.
  const visual = visualMap(visualMap(login).normalize('NFD')).normalize('NFD').toLowerCase();
  return visualMap(visual).normalize('NFD').toLowerCase();
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
  return [login, login.replace(/\p{N}/gu, '')].some((value) =>
    loginSkeletons(value).some((key) => {
      const parts = key.split(/[_-]+/u);
      return [...parts, parts.join('')].some((part) => STAFF_NAMES.has(part));
    }),
  );
}
