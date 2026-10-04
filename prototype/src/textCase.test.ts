// Один шрифт текста и без КАПС с разрядкой (UIX-11.1, скилл frontend-design §3). Текст игры —
// пропорциональным `--sf-font`, цифры — ровными столбцами (`tabular-nums`), а не моноширинным
// шрифтом; КАПС и разрядка остаются только у знака игры, разрядка — ещё у рядов значков.
// Сторож держит это в листах партии и хаба и в строках локали: регистр слова решает строка,
// а не `text-transform`.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { en } from '../../localization/en';
import { LOCALE_LABEL } from '../../localization/index';
import { ru } from '../../localization/ru';

const read = (rel: string): string => readFileSync(new URL(rel, import.meta.url), 'utf8');
const BUILD = read('../build.mjs');
/** Лист игры; пульт администратора (`adminCss`) — инструмент, не игра. Sector Zero — эталон
 *  со своим листом, его подписи и так пишутся обычным регистром. */
const GAME = BUILD.slice(BUILD.indexOf('const css = `'), BUILD.indexOf('const adminCss = `'));

const SHEETS: Record<string, string> = {
  'build.mjs': GAME,
  'holographic.css': read('../holographic.css'),
  'bridge-shell.css': read('../bridge-shell.css'),
  'mobile-console.css': read('../mobile-console.css'),
  'mobile-strategy.css': read('../mobile-strategy.css'),
  'profile.css': read('../profile.css'),
  'hero-cards.css': read('../hero-cards.css'),
  'ship-art.css': read('../ship-art.css'),
};

/** Знак игры: «VOID DOMINION» на хабе и на входе и строка под ним — логотип, а не подпись. */
const BRAND = ['.hub-bt', '.ccrest .wm', '.ccrest .wtag'];
/** Ряды значков (★★★ модуля, ●●○ слотов героя) и «⠿» за ручкой окна — рисунок из символов. */
const GLYPHS = ['.hx-pips', '.sc-stars', '.holo-drag-handle::before'];

/** Правила листа: последняя строка селектора и тело. Комментарии вырезаны. */
function rules(sheet: string): { sel: string; body: string }[] {
  const text = sheet.replace(/\/\*[\s\S]*?\*\//g, '');
  return [...text.matchAll(/([^{};]+)\{([^{}]*)\}/g)].map((m) => ({
    sel: m[1]!.trim().split('\n').pop()!.trim(),
    body: m[2]!,
  }));
}

const allowed = (sel: string, list: readonly string[]): boolean =>
  list.some((x) => sel.includes(x));

describe('один шрифт текста (UIX-11.1)', () => {
  it('тело страницы — --sf-font с цифрами ровными столбцами', () => {
    const body = /\nbody\{[^}]*\}/.exec(GAME)?.[0] ?? '';
    expect(body).toContain('var(--sf-font)');
    expect(body).toContain('font-variant-numeric:tabular-nums');
    expect(body).not.toContain('letter-spacing');
  });

  it.each(Object.keys(SHEETS))('%s: моноширинного шрифта у текста нет', (name) => {
    const mono = rules(SHEETS[name]!)
      .filter((r) => /(?<![-\w])font(?:-family)?:[^;]*monospace/.test(r.body))
      .map((r) => r.sel)
      .filter((sel) => !allowed(sel, GLYPHS));
    expect(mono).toEqual([]);
  });
});

describe('без КАПС с разрядкой (UIX-11.1)', () => {
  it.each(Object.keys(SHEETS))('%s: text-transform: uppercase — только у знака игры', (name) => {
    const caps = rules(SHEETS[name]!)
      .filter((r) => /text-transform:\s*uppercase/.test(r.body))
      .map((r) => r.sel)
      .filter((sel) => !allowed(sel, BRAND));
    expect(caps).toEqual([]);
  });

  it.each(Object.keys(SHEETS))('%s: разрядка — только у знака игры и рядов значков', (name) => {
    const spaced = rules(SHEETS[name]!)
      .filter((r) =>
        [...r.body.matchAll(/letter-spacing:\s*([^;}\s]+)/g)].some(
          (m) => !['0', 'normal', 'inherit'].includes(m[1]!) && !m[1]!.startsWith('-'),
        ),
      )
      .map((r) => r.sel)
      .filter((sel) => !allowed(sel, [...BRAND, ...GLYPHS]));
    expect(spaced).toEqual([]);
  });
});

/** Сокращения пишутся заглавными и в обычной строке; остальное слово целиком заглавными —
 *  это КАПС-лейбл. Название игры и Sector Zero — имена собственные. */
const ACRONYMS: Record<'ru' | 'en', ReadonlySet<string>> = {
  ru: new Set('ИИ ПКО ПВО ЛС ОП КД ЛКМ ПКМ ПК НПЗ ОЗ ПРО БЧ АТК ЗАЩ СКР'.split(' ')),
  en: new Set([
    ...'AI HP XP CD HQ DM AA PD PVE PVP DEV FPS PC APK VPN'.split(' '),
    ...'ATK DEF SPD II III IV VI VOID DOMINION SECTOR ZERO'.split(' '),
  ]),
};
const CAPS_WORD: Record<'ru' | 'en', RegExp> = {
  ru: /(?<![\p{L}\d_])[А-ЯЁ]{2,}(?![\p{L}\d_])/gu,
  en: /(?<![\p{L}\d_])[A-Z]{2,}(?![\p{L}\d_])/gu,
};

describe('строки локали — обычным регистром (UIX-11.1)', () => {
  it.each([
    ['ru', ru],
    ['en', en],
  ] as const)('%s: слов целиком заглавными нет, кроме сокращений', (lang, messages) => {
    const caps = Object.entries(messages).flatMap(([key, text]) =>
      (text.match(CAPS_WORD[lang]) ?? [])
        .filter((w) => !ACRONYMS[lang].has(w))
        .map((w) => `${key}: ${w}`),
    );
    expect(caps).toEqual([]);
  });

  it.each([
    ['ru', ru],
    ['en', en],
  ] as const)('%s: «→» в конце подписи нет', (_lang, messages) => {
    const arrows = Object.entries(messages)
      .filter(([, text]) => /→\s*$/.test(text))
      .map(([key]) => key);
    expect(arrows).toEqual([]);
  });

  it('названия языков в меню — обычным регистром', () => {
    const caps = Object.values(LOCALE_LABEL).filter((label) => label === label.toUpperCase());
    expect(caps).toEqual([]);
  });
});
