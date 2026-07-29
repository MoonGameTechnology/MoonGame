// Рантайм локализации — ОБЩИЙ для прототипа и клиента. Сами тексты живут рядом
// (`ru.ts`, `en.ts`); здесь только выбор языка, поиск ключа и подстановка значений.
//
//   t('err.no-capacity')                  → текст по ключу
//   t('fleet.eta', { n: 3 })              → '{x}' подставляет живые значения
//   tData('Metal Mine')                   → имя игровых ДАННЫХ (→ data.metal-mine)
//
// Почему здесь, а не в приложении: рантайм один на обе поверхности. Прототип и
// PWA-клиент должны звать один и тот же `t()` — иначе у второго заводится своя
// схема ключей и они расходятся (кирпич LOC-3).
//
// Выбор языка хранится в localStorage ('vd.locale'); переключение перезагружает
// страницу — каждый рендерер строится заново, поэтому DOM на старом языке не выживает.
// Node/SSR без `localStorage` и `navigator` проходит по ветке дефолта, не падая.
import { LOCALES, DEFAULT_LOCALE, dataKey, isLocaleId } from './index';
import type { LocaleId } from './index';

const STORE_KEY = 'vd.locale';

function detect(): LocaleId {
  try {
    const saved = typeof localStorage !== 'undefined' ? localStorage.getItem(STORE_KEY) : null;
    if (isLocaleId(saved)) return saved;
  } catch {
    /* storage disabled — fall through to the browser language */
  }
  const nav = typeof navigator !== 'undefined' ? navigator.language : DEFAULT_LOCALE;
  return nav?.toLowerCase().startsWith('ru') ? 'ru' : 'en';
}

export let LOCALE: LocaleId = detect();

/** Persist the new locale. The caller reloads the page (see the picker wiring). */
export function setLocale(id: LocaleId): void {
  LOCALE = id;
  try {
    localStorage.setItem(STORE_KEY, id);
  } catch {
    /* storage disabled — the choice lives for this page only */
  }
}

/** Текст по ключу: выбранная локаль → русский источник. `undefined`, если ключа нет
 *  нигде — вызывающий решает, что делать (показать ключ или свой запасной текст). */
export function lookup(key: string): string | undefined {
  return LOCALES[LOCALE][key] ?? LOCALES[DEFAULT_LOCALE][key];
}

/** Есть ли у ключа перевод. Нужен там, где при промахе положен НЕ ключ, а
 *  осмысленный запасной текст (например, разбор незнакомого кода ошибки). */
export const hasKey = (key: string): boolean => lookup(key) !== undefined;

function interpolate(s: string, vars?: Record<string, string | number>): string {
  if (!vars) return s;
  return s.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
}

/** Текст интерфейса по ключу. Промах → сам ключ (заметная опечатка). */
export function t(key: string, vars?: Record<string, string | number>): string {
  return interpolate(lookup(key) ?? key, vars);
}

/** Имя игровых ДАННЫХ. Промах → исходное английское имя из data/*.json: новый юнит
 *  виден под своим именем, а не как `data.new-unit`. */
export function tData(name: string): string {
  return lookup(dataKey(name)) ?? name;
}
