// Шкала текста (UIX-1.2): 12 · 14 · 16 · 20 px, мельче 12 px ничего. Две копии одного факта —
// `typeScale` в packages/client/src/theme.ts и --fs-* в prototype/build.mjs (скилл
// frontend-design §2) — держатся одинаковыми, а размер мельче подписи не возвращается в листы
// игры: браузерный сторож `smoke:sizes` ловит его на семи экранах, этот — во всех правилах,
// включая окна, которые сторож не открывает.
import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { typeScale, type TypeScale } from '../../packages/client/src/theme';

const read = (rel: string): string => readFileSync(new URL(rel, import.meta.url), 'utf8');
const BUILD = read('../build.mjs');
/** Лист игры и разметка страницы; пульт администратора (`adminCss`) — инструмент, не игра. */
const GAME = BUILD.slice(BUILD.indexOf('const css = `'), BUILD.indexOf('const adminCss = `'));
const ROOT = /:root\{([\s\S]*?)\n\}/.exec(BUILD)?.[1] ?? '';
const CLIENT = read('../../packages/client/index.html');

const VAR: Record<keyof TypeScale, string> = {
  caption: '--fs-caption',
  body: '--fs-body',
  heading: '--fs-heading',
  title: '--fs-title',
};

/** Листы игры: всё, что `allCss()` склеивает для партии и хаба, кроме Sector Zero — у его
 *  листа свой сторож того же правила (`sectorZeroMenu.test.ts`). */
const SHEETS: Record<string, string> = {
  'build.mjs': GAME,
  'holographic.css': read('../holographic.css'),
  'bridge-shell.css': read('../bridge-shell.css'),
  'mobile-console.css': read('../mobile-console.css'),
  'mobile-strategy.css': read('../mobile-strategy.css'),
  'profile.css': read('../profile.css'),
  'hero-cards.css': read('../hero-cards.css'),
  'ship-art.css': read('../ship-art.css'),
  'packages/client/index.html': CLIENT,
};

/** Цифра на плашке медали — часть рисунка медали 34 px, а не надпись для чтения. */
const ART = ['#profile .ps-medal i', '#profile .ps-pin .ps-medal i'];

/** Размеры мельче 12 px в листе: `font-size` (в том числе нижняя граница `clamp`) и размер
 *  в сокращении `font:` (до `/` высоты строки). Возвращает «селектор: размер». */
function tinySizes(sheet: string): string[] {
  const out: string[] = [];
  const text = sheet.replace(/\/\*[\s\S]*?\*\//g, '');
  for (const m of text.matchAll(/([^{};]+)\{([^{}]*)\}/g)) {
    const sel = m[1]!.trim().split('\n').pop()!.trim();
    const body = m[2]!;
    const sizes = [
      ...[...body.matchAll(/font-size:\s*(?:clamp\(\s*)?(\d+(?:\.\d+)?)px/g)].map((x) => x[1]!),
      ...[...body.matchAll(/(?<![-\w])font:\s*([^;]*)/g)].flatMap((x) => {
        const size = /(?:^|\s)(\d+(?:\.\d+)?)px/.exec(x[1]!);
        return size ? [size[1]!] : [];
      }),
    ];
    for (const px of sizes) if (Number(px) < typeScale.caption) out.push(`${sel}: ${px}px`);
  }
  return out;
}

describe('шкала текста: theme.ts и build.mjs — одна правда (UIX-1.2)', () => {
  it.each(Object.entries(VAR))('%s живёт в %s с тем же значением', (key, name) => {
    const m = new RegExp(`${name}:([^;]+);`).exec(ROOT);
    expect(m, `${name} нет в :root build.mjs`).not.toBeNull();
    expect(m![1]).toBe(`${typeScale[key as keyof TypeScale]}px`);
    expect(CLIENT, `запасное значение ${name} в index.html клиента`).toContain(
      `${name}: ${typeScale[key as keyof TypeScale]}px;`,
    );
  });

  it('четыре размера по возрастанию, подпись — 12 px, основной текст — 14 px', () => {
    expect(typeScale).toEqual({ caption: 12, body: 14, heading: 16, title: 20 });
  });
});

describe('мельче 12 px текста нет (UIX-1.2)', () => {
  it.each(Object.keys(SHEETS))('%s', (name) => {
    const tiny = tinySizes(SHEETS[name]!);
    expect(tiny.filter((x) => !ART.some((sel) => x.startsWith(`${sel}:`)))).toEqual([]);
  });

  it('разметка экранов в prototype/src не задаёт мелкий текст в style', () => {
    const dir = new URL('./', import.meta.url);
    const found: string[] = [];
    for (const file of readdirSync(dir)) {
      if (!file.endsWith('.ts') || file.endsWith('.test.ts')) continue;
      const src = readFileSync(new URL(file, dir), 'utf8');
      for (const m of src.matchAll(/style="[^"]*font-size:\s*(\d+(?:\.\d+)?)px/g))
        if (Number(m[1]) < typeScale.caption) found.push(`${file}: ${m[1]}px`);
    }
    expect(found).toEqual([]);
  });

  it('исключения — только цифра на медали; уйдёт рисунок — уйдёт и строка', () => {
    const profile = tinySizes(SHEETS['profile.css']!).map((x) => x.split(':')[0]);
    expect(profile).toEqual(ART);
  });
});

describe('вторичный текст читается (UIX-1.2)', () => {
  it('текст цвета --cyan-dim в листе игры не пишется: на стекле это 3,4:1, нужно 4,5:1', () => {
    expect(GAME.match(/(?<![-\w])color:\s*var\(--cyan-dim\)/g) ?? []).toEqual([]);
  });
});
