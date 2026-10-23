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
    Array.from(password.trim()).length < NEW_PASSWORD_MIN ||
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

// Curated severe profanity/abuse across major game audiences. Full words only:
// word fragments are never matched inside innocent names (e.g. Scunthorpe).
// Additions require locale-aware positive AND false-positive regression tests.
// The original RU/EN vocabulary above is retained for compatibility.
const MULTILINGUAL_BLOCKED_NAMES: Readonly<Record<string, readonly string[]>> = {
  de: ['arschloch', 'scheiße', 'scheisse', 'hurensohn', 'wichser', 'fotze', 'schlampe'],
  fr: ['connard', 'connasse', 'enculé', 'encule', 'salope', 'putain', 'merde'],
  es: ['gilipollas', 'cabron', 'cabrón', 'mierda', 'coño', 'puta', 'puto', 'maricón', 'maricon'],
  pt: ['caralho', 'porra', 'filhodaputa', 'otário', 'otario', 'vadia'],
  it: ['stronzo', 'stronza', 'vaffanculo', 'coglione', 'cazzo', 'troia'],
  pl: ['kurwa', 'skurwysyn', 'pierdolony', 'dziwka', 'chuj', 'chujek'],
  uk: ['довбойоб', 'йобаний', 'йобана', 'підорас'],
  tr: ['siktir', 'orospu', 'pezevenk'],
  ja: ['死ね', 'くたばれ'],
  ko: ['씨발', '시발', '개새끼', '병신'],
  zh: ['傻逼', '操你妈', '操你媽', '去死'],
  ar: ['كسمك', 'شرموطة', 'متناك'],
  hi: ['मादरचोद', 'बहनचोद'],
};
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
  // Frequent mixed-script (Greek/Latin) homoglyph substitutions in public names.
  α: 'a',
  ε: 'e',
  ι: 'i',
  κ: 'k',
  ο: 'o',
  ρ: 'p',
  σ: 's',
  τ: 't',
  υ: 'u',
  χ: 'x',
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
  return Array.from(text, (c) => {
    // Preserve known Cyrillic transliterations (e.g. й → y) before decomposing accents.
    const mapped = alphabet[c] ?? LEET[c];
    if (mapped !== undefined) return mapped;
    const plain = c.normalize('NFKD').replace(/\p{M}/gu, '');
    return Array.from(plain, (letter) => alphabet[letter] ?? LEET[letter] ?? letter).join('');
  }).join('');
}
const BLOCKED_KEYS = new Set(
  [...BLOCKED_NAMES, ...Object.values(MULTILINGUAL_BLOCKED_NAMES).flat()].flatMap((word) => [
    fold(word, VISUAL),
    fold(word, PHONETIC),
  ]),
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


/**
 * Find whole offensive words, including spaced-letter/obfuscated spellings
 * ("f.u.c.k", "s h 1 t", Cyrillic/Latin homoglyphs). The dictionary is not a
 * substring search: ordinary words containing a short swear are untouched.
 * This is a low-cost deterministic safety net, not a semantic hate-speech model.
 */
function offensiveSpans(text: string): Array<{ start: number; end: number }> {
  const words = Array.from(text.matchAll(/[\p{L}\p{M}\p{N}]+/gu), (match) => {
    const start = match.index ?? 0;
    return { raw: match[0], start, end: start + match[0].length };
  });
  const spans: Array<{ start: number; end: number }> = [];
  for (let i = 0; i < words.length; i++) {
    const word = words[i]!;
    if (blockedPublicName(word.raw)) spans.push({ start: word.start, end: word.end });
    let joined = word.raw;
    let end = word.end;
    // Limited to 16 chunks / 36 characters: bounded work even on spammy punctuation.
    for (let j = i + 1; j < Math.min(words.length, i + 16); j++) {
      const next = words[j]!;
      const separator = text.slice(end, next.start);
      if (
        !separator ||
        Array.from(separator).length > 3 ||
        !/^[\p{P}\p{S}\p{Zs}]+$/u.test(separator)
      ) break;
      // Spaces between whole words are normal speech. Only concatenate separated
      // individual letters when the separator is whitespace alone.
      if (
        /^\p{Zs}+$/u.test(separator) &&
        (Array.from(words[j - 1]!.raw).length !== 1 || Array.from(next.raw).length !== 1)
      ) break;
      joined += next.raw;
      end = next.end;
      if (Array.from(joined).length > 36) break;
      if (blockedPublicName(joined)) spans.push({ start: word.start, end });
    }
  }
  return spans;
}

/** For free-form public text such as coalition descriptions: reject rather than rewrite. */
export function containsBlockedLanguage(text: string): boolean {
  return offensiveSpans(sanitizeChatText(text, 512)).length > 0;
}

/** Sanitize first, then mask offending runs before any chat relay, history or bot callback. */
export function censorChatText(raw: string, max: number): string {
  const text = sanitizeChatText(raw, max);
  const spans = offensiveSpans(text).sort((a, b) => a.start - b.start || a.end - b.end);
  if (spans.length === 0) return text;
  const merged: Array<{ start: number; end: number }> = [];
  for (const span of spans) {
    const last = merged[merged.length - 1];
    if (last && span.start <= last.end) last.end = Math.max(last.end, span.end);
    else merged.push({ ...span });
  }
  let out = '';
  let pos = 0;
  for (const span of merged) {
    out += text.slice(pos, span.start) + '***';
    pos = span.end;
  }
  return out + text.slice(pos);
}
