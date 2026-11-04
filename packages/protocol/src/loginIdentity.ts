import confusables from './unicode-confusables.json';

const mapping: Readonly<Record<string, string>> = confusables.mapping;

/** Registration collision key, never an authentication lookup or a displayed name.
 * Unicode TR39 data is pinned and vendored with its source digest and license. */
export function loginSkeleton(login: string): string {
  return Array.from(login.normalize('NFKD').toLowerCase(), (c) => mapping[c] ?? c)
    .join('')
    .normalize('NFD')
    .toLowerCase();
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
    ].map(loginSkeleton),
  ))();

/** Reserve complete role tokens (including numeric suffixes), not arbitrary substrings. */
export function reservedStaffName(login: string): boolean {
  const parts = login.normalize('NFKC').split(/[_-]+/u);
  return [...parts, parts.join('')].some((part) =>
    STAFF_NAMES.has(loginSkeleton(part.replace(/\p{N}/gu, ''))),
  );
}
