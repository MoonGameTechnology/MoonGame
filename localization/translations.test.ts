import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { LocaleId, Messages } from './index';
import { pluralCategories } from './core';
import { ru } from './ru';
import { de } from './de';
import { pl } from './pl';
import { es } from './es';

// Гейт для неполных переводов (de/pl/es). ru/en держит prototype/src/i18n.test.ts
// строже: там наборы ключей обязаны совпадать. Здесь недостающий ключ — норма
// (его подставит русский фолбэк при запекании), а ошибкой считается то, что
// игрок увидит сломанным: ключ, которого нет в источнике (мёртвый перевод),
// кириллица в чужом языке (в pl так жил текст в неверной кодировке),
// потерянная подстановка `{n}` и неверное число форм `{n|…}`.

const here = path.dirname(fileURLToPath(import.meta.url));
const PARTIAL: readonly [LocaleId, Messages][] = [
  ['de', de],
  ['pl', pl],
  ['es', es],
];

/** Имена подстановок строки: `{n}` и `{n|форма|…}` дают `n`. */
const slots = (text: string): string[] =>
  [...new Set([...text.matchAll(/\{(\w+)[}|]/g)].map((m) => m[1]!))].sort();

describe.each(PARTIAL)('локаль %s', (id, table) => {
  it('не держит ключей, которых нет в источнике', () => {
    expect(Object.keys(table).filter((k) => !(k in ru))).toEqual([]);
  });

  it('в исходнике нет дублей ключей', () => {
    const seen = new Map<string, number>();
    for (const m of readFileSync(path.join(here, `${id}.ts`), 'utf8').matchAll(/^ {2}'([^']+)':/gm))
      seen.set(m[1]!, (seen.get(m[1]!) ?? 0) + 1);
    expect([...seen].filter(([, n]) => n > 1).map(([k]) => k)).toEqual([]);
  });

  it('в значениях нет кириллицы', () => {
    expect(Object.keys(table).filter((k) => /[А-Яа-яЁё]/.test(table[k]!))).toEqual([]);
  });

  it('подстановки совпадают с источником', () => {
    const bad = Object.keys(table).filter(
      (k) => k in ru && slots(table[k]!).join() !== slots(ru[k]!).join(),
    );
    expect(bad).toEqual([]);
  });

  it('слово при числе дано во всех формах языка', () => {
    const cats = pluralCategories(id).length;
    const bad: string[] = [];
    for (const [key, text] of Object.entries(table))
      for (const m of text.matchAll(/\{\w+((?:\|[^|{}]*)+)\}/g)) {
        const forms = m[1]!.slice(1).split('|');
        if (
          forms.length < Math.max(2, cats - 1) ||
          forms.length > cats ||
          forms.some((f) => !f.trim())
        )
          bad.push(`${key}: ${m[0]}`);
      }
    expect(bad).toEqual([]);
  });
});
