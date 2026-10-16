/** Shared input policy; no I/O. Password bytes and account identity are never rewritten. */
export const LOGIN_RE = /^[\p{L}\p{N}_-]{3,24}$/u;
export const NEW_PASSWORD_MIN = 12;
export const PASSWORD_MAX = 128;

export function validLogin(login: string): boolean {
  return login.length <= 96 && LOGIN_RE.test(login);
}

/** Legacy seat labels have a wider display contract than account logins. */
export function validSeatName(name: string): boolean {
  return (
    name.length <= 64 &&
    /^[\p{L}\p{N}_ -]+$/u.test(name) &&
    name.trim().length > 0 &&
    !blockedPublicName(name)
  );
}

/** Existing accounts retain their 8–128 UTF-16-unit password contract at sign-in. */
export function validLoginPassword(password: string): boolean {
  return password.length >= 8 && password.length <= PASSWORD_MAX;
}

export type PasswordIssue = 'length' | 'weak' | 'characters';
export function passwordIssue(password: string): PasswordIssue | null {
  if (password.length > PASSWORD_MAX || Array.from(password).length < NEW_PASSWORD_MIN)
    return 'length';
  if (/[\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp}]/u.test(password)) return 'characters';
  const key = password.normalize('NFKC').toLowerCase().trim();
  if (
    Array.from(key).length < NEW_PASSWORD_MIN ||
    /^(.{1,4})\1+$/u.test(key) ||
    /^(?:p[a@4]ssw[o0]rd|qwerty|letmein|admin|welcome|пароль|йцукен)[\d!@#$%^&*._-]*$/u.test(key) ||
    ['passwordpassword', 'iloveyou1234', 'letmeinplease', 'correcthorsebatterystaple'].includes(
      key,
    ) ||
    /^(?:0123456789|1234567890|123456789|0987654321|9876543210|987654321)[\d!@#$%^&*._-]*$/u.test(
      key,
    )
  )
    return 'weak';
  return null;
}

/** Curated RU/EN public-name blocklist. Complete tokens avoid e.g. Scunthorpe/Assassin.
 * Comparison folds are for moderation ONLY, not lookup/uniqueness or stored display names. */
const BLOCKED_NAMES = [
  'долбоеб',
  'ебанат',
  'уебок',
  'ублюдок',
  'шлюха',
  'говно',
  'нахуй',
  'fuckyou',
  'motherfucker',
  'bullshit',
  'идиот',
  'идиоты',
  'идиотка',
  'дурак',
  'дураки',
  'дура',
  'тупой',
  'дебил',
  'дебилы',
  'кретин',
  'мудак',
  'мудаки',
  'мудила',
  'хуй',
  'хуило',
  'хуйло',
  'хуесос',
  'сука',
  'суки',
  'блядь',
  'блять',
  'еблан',
  'ебать',
  'пизда',
  'пиздец',
  'пидор',
  'пидорас',
  'говнюк',
  'fuck',
  'fucker',
  'fucking',
  'shit',
  'asshole',
  'bitch',
  'bastard',
  'cunt',
  'nigger',
  'nigga',
  'faggot',
  'retard',
  'idiot',
];
const VISUAL: Readonly<Record<string, string>> = {
  а: 'a',
  б: 'b',
  в: 'b',
  г: 'g',
  д: 'd',
  е: 'e',
  ё: 'e',
  ж: 'zh',
  з: 'z',
  и: 'i',
  й: 'y',
  к: 'k',
  л: 'l',
  м: 'm',
  н: 'h',
  о: 'o',
  п: 'n',
  р: 'p',
  с: 'c',
  т: 't',
  у: 'y',
  ф: 'f',
  х: 'x',
  ц: 'c',
  ч: 'ch',
  ш: 'sh',
  щ: 'shch',
  ъ: '',
  ы: 'y',
  ь: '',
  э: 'e',
  ю: 'yu',
  я: 'ya',
  і: 'i',
  ј: 'j',
  ѕ: 's',
};
const PHONETIC: Readonly<Record<string, string>> = {
  ...VISUAL,
  в: 'v',
  й: 'y',
  н: 'n',
  п: 'p',
  р: 'r',
  с: 's',
  у: 'u',
  х: 'h',
  ц: 'ts',
};
const LEET: Readonly<Record<string, string>> = {
  '0': 'o',
  '1': 'i',
  '3': 'e',
  '4': 'a',
  '5': 's',
  '7': 't',
  '8': 'b',
};
function fold(text: string, alphabet: Readonly<Record<string, string>>): string {
  return Array.from(text, (c) => alphabet[c] ?? LEET[c] ?? c).join('');
}
const BLOCKED_KEYS = new Set(
  BLOCKED_NAMES.flatMap((word) => [fold(word, VISUAL), fold(word, PHONETIC)]),
);

export function blockedPublicName(name: string): boolean {
  if (name.length > 256) return true;
  // Keep the original numeral categories too: NFKC turns e.g. Ⅸ into IX and ¼ into 1⁄4.
  const tokens = [name.toLowerCase(), name.normalize('NFKC').toLowerCase()].flatMap((text) => {
    const parts = text.split(/[\s_-]+/u);
    return [...parts, parts.join('')];
  });
  for (const token of tokens) {
    const chars = Array.from(token);
    let start = 0;
    let end = chars.length;
    while (start < end && /\p{N}/u.test(chars[start]!)) start++;
    while (end > start && /\p{N}/u.test(chars[end - 1]!)) end--;
    const candidates = [token, chars.slice(start, end).join(''), token.replace(/\p{N}/gu, '')];
    for (const raw of candidates) {
      const candidate = raw.normalize('NFKC').toLowerCase();
      if (BLOCKED_KEYS.has(fold(candidate, VISUAL)) || BLOCKED_KEYS.has(fold(candidate, PHONETIC)))
        return true;
    }
  }
  return false;
}

/** Optional email: trim surrounding whitespace, refuse controls, markup and header tricks. */
export function parseRecoveryEmail(value: unknown): string | null | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string' || value.length > 254 || /[\p{Cc}\p{Cf}\p{Cs}<>"'\\]/u.test(value))
    return null;
  const email = value.trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email) ? email : null;
}

export function closedInput(
  body: unknown,
  fields: readonly string[],
): body is Record<string, unknown> {
  return (
    typeof body === 'object' &&
    body !== null &&
    !Array.isArray(body) &&
    Object.keys(body).every((key) => fields.includes(key))
  );
}

/** Plain text, not HTML. Renderers still MUST escape at their output boundary. */
export function sanitizeChatText(text: string, max: number): string {
  return Array.from(
    text
      .replace(/\r\n?|[\p{Zl}\p{Zp}]/gu, '\n')
      .replace(/[\p{Cc}\p{Cf}\p{Cs}]/gu, (c) => (c === '\n' || c === '\t' ? c : ''))
      .trim(),
  )
    .slice(0, max)
    .join('');
}
