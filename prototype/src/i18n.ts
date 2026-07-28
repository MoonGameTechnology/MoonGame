// Тонкий рантайм локализации прототипа. Сами тексты живут в /localization —
// здесь только выбор языка, поиск ключа и подстановка значений.
//
//   t('err.no-capacity')                  → текст по ключу
//   t('fleet.eta', { n: 3 })              → '{x}' подставляет живые значения
//   tData('Metal Mine')                   → имя игровых ДАННЫХ (→ data.metal-mine)
//
// ПЕРЕХОДНЫЙ ПЕРИОД (этап 2 миграции). Исторически msgid'ом была сама русская
// строка (`t('трюм полон')`), и большая часть вызовов ещё такая. Пока они живы,
// работает мост: если аргумент — не ключ, он трактуется как старый русский msgid и
// ищется в /localization/legacy. Мост уйдёт вместе с последним немигрированным
// вызовом; ключи и старые msgid'ы не пересекаются (в ключе нет кириллицы).
//
// Выбор языка хранится в localStorage ('vd.locale'); переключение перезагружает
// страницу — каждый рендерер строится заново, поэтому DOM на старом языке не выживает.
import { LOCALES, DEFAULT_LOCALE, LOCALE_LABEL, dataKey, isLocaleId } from '../../localization';
import type { LocaleId } from '../../localization';
import { en as legacyEn } from '../../localization/legacy/en';

export type { LocaleId };
export { LOCALE_LABEL };

/** Старые msgid-карты (msgid = русская строка). Для РУССКОГО она пуста: msgid и есть
 *  текст, поэтому запись не нужна — строка показывается как написана. */
const LEGACY: Record<LocaleId, Record<string, string>> = { ru: {}, en: legacyEn };

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

/** Текст интерфейса по ключу. Промах → старый русский msgid (мост), иначе — сам ключ. */
export function t(key: string, vars?: Record<string, string | number>): string {
  return interpolate(lookup(key) ?? LEGACY[LOCALE][key] ?? key, vars);
}

/** Имя игровых ДАННЫХ. Промах → исходное английское имя из data/*.json: новый юнит
 *  виден под своим именем, а не как `data.new-unit`. */
export function tData(name: string): string {
  return lookup(dataKey(name)) ?? LEGACY[LOCALE][`data:${name}`] ?? name;
}

/** Проход по статической разметке на старте. Ключ берётся из ЗНАЧЕНИЯ атрибута
 *  (`data-i18n="hub.play"`); если значения нет — из текста узла, как в старой схеме
 *  (мост на время миграции). Также проставляет <html lang>, чтобы браузер и
 *  скринридер согласились с языком интерфейса. */
export function localizeStaticDom(): void {
  if (typeof document === 'undefined' || !document.querySelectorAll) return;
  if (document.documentElement) document.documentElement.lang = LOCALE;
  for (const el of Array.from(document.querySelectorAll<HTMLElement>('[data-i18n]'))) {
    const key = el.getAttribute('data-i18n')?.trim();
    const cur = el.textContent?.trim();
    if (key) el.textContent = t(key);
    else if (cur) el.textContent = t(cur);
  }
  const attr = (suffix: string, name: string) => {
    for (const el of Array.from(document.querySelectorAll<HTMLElement>(`[data-i18n-${suffix}]`))) {
      const key = el.getAttribute(`data-i18n-${suffix}`)?.trim();
      const cur = el.getAttribute(name);
      if (key) el.setAttribute(name, t(key));
      else if (cur) el.setAttribute(name, t(cur));
    }
  };
  attr('title', 'title');
  attr('ph', 'placeholder');
  attr('aria', 'aria-label');
}
