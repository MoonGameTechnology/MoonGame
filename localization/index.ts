// Локализация игры — единая точка входа. ОДИН ЯЗЫК = ОДИН ФАЙЛ рядом с этим.
//
// Как это работает (правило проекта, см. CLAUDE.md → «Локализация»):
//
//   1. В коде НЕТ человекочитаемого текста. Есть КЛЮЧ:  t('err.no-capacity')
//   2. Ключ = домен.сущность.аспект. Точки — иерархия, kebab-case внутри сегмента:
//        err.no-capacity · data.metal-mine · hero.ability.corridor.desc
//   3. Каждая локаль — плоская карта ключ → текст (`ru.ts`, `en.ts`, дальше `de.ts`…).
//   4. Нет ключа в выбранной локали → берётся РУССКИЙ (он источник), а не пустота:
//      непереведённая строка видна по-русски, а не как голый `err.no-capacity`.
//   5. Нет ключа нигде → показывается сам ключ. Это заметно и означает опечатку.
//
// Добавить язык: положить рядом `<код>.ts` той же формы и дописать его в LOCALES
// и LOCALE_LABEL ниже. Больше ничего трогать не нужно.
import { ru } from './ru';
import { en } from './en';

export type LocaleId = 'ru' | 'en';

/** Язык-источник: его текст показывается, когда в выбранной локали ключа нет. */
export const DEFAULT_LOCALE: LocaleId = 'ru';

export const LOCALES: Record<LocaleId, Record<string, string>> = { ru, en };

/** Подпись языка в переключателе — на самом языке, не в переводе. */
export const LOCALE_LABEL: Record<LocaleId, string> = { ru: 'РУССКИЙ', en: 'ENGLISH' };

export const LOCALE_IDS = Object.keys(LOCALES) as LocaleId[];

export const isLocaleId = (v: unknown): v is LocaleId =>
  typeof v === 'string' && (LOCALE_IDS as string[]).includes(v);

/** Имя игровых ДАННЫХ (юниты/здания/технологии из data/*.json, заведены по-английски)
 *  → ключ: `tData('Metal Mine')` ищет `data.metal-mine`. Слаг детерминированный,
 *  поэтому отдельная таблица «имя → ключ» не нужна. */
export const dataKey = (name: string): string =>
  'data.' +
  name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
