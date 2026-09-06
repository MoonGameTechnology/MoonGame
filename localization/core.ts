// Рантайм локализации — ОДИН на всех потребителей (прототип и PWA-клиент).
// Тексты живут в соседних `ru.ts` / `en.ts`; здесь только выбор языка, поиск
// ключа и подстановка значений.
//
//   t('err.no-capacity')                  → текст по ключу
//   t('fleet.eta', { n: 3 })              → '{x}' подставляет живые значения
//   tData('Metal Mine')                   → имя игровых ДАННЫХ (→ data.metal-mine)
//
// До LOC-5 этот файл существовал дважды — `prototype/src/i18n.ts` и
// `packages/client/src/i18n.ts`, — и их расхождение ничем не ловилось: правку
// `tData()` пришлось вносить в оба места вручную. Теперь копия одна.
//
// Тексты сюда ПОДКЛЮЧАЮТСЯ (`registerMessages`), а не импортируются: иначе один
// импорт рантайма затягивал бы в бандл все языки сразу (LOC-6). Кому нужны все —
// импортирует `runtime.ts` (прототип, тесты); клиент подключает одну запечённую
// локаль на старте (`packages/client/src/locale.ts`).
//
// Выбор языка хранится в localStorage ('vd.locale'); переключение перезагружает
// страницу — каждый рендерер строится заново, поэтому DOM на старом языке не выживает.
import { DEFAULT_LOCALE, dataKey, isLocaleId } from './index';
import type { LocaleId, Messages } from './index';

// Потребителю рантайма нужны и подписи языков в переключателе — чтобы ему хватало
// одного импорта, а не двух из соседних файлов.
export type { LocaleId, Messages };
export { LOCALE_LABEL, LOCALE_IDS, DEFAULT_LOCALE } from './index';

const STORE_KEY = 'vd.locale';

/** Подключённые таблицы текстов. Пусто до первого `registerMessages` — ровно поэтому
 *  `lookup()` устроен так, что промах даёт `undefined`, а не падение. */
const TABLES: Partial<Record<LocaleId, Messages>> = {};

/** Подключить тексты языка. Клиент зовёт это один раз для выбранной локали (её файл
 *  уже содержит фолбэк — `bakedLocale()`), прототип и тесты — сразу для всех. */
export function registerMessages(id: LocaleId, messages: Messages): void {
  TABLES[id] = messages;
}

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
 *  нигде — вызывающий решает, что делать (показать ключ или свой запасной текст).
 *  Фолбэк на источник остаётся и здесь: у клиента подключена одна локаль, но фолбэк
 *  в неё уже запечён, а прототип держит обе таблицы сырыми. */
export function lookup(key: string): string | undefined {
  return TABLES[LOCALE]?.[key] ?? TABLES[DEFAULT_LOCALE]?.[key];
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
  // `?? lookup(name)` — страховка, а не разрешение путать вызовы. Если сюда всё же
  // приехал КЛЮЧ (поля каталога `prototypeData.ts` частично хранят ключи), слаг
  // `dataKey()` его схлопнет — точки и кириллица вырезаются, — и наружу вылез бы сам
  // ключ. Так игрок получит перевод, а не `sci.overseer.name`.
  return lookup(dataKey(name)) ?? lookup(name) ?? name;
}

/** Проход по статической разметке на старте. Ключ берётся из ЗНАЧЕНИЯ атрибута
 *  (`data-i18n="hub.play"`), а сам узел в разметке пуст — текст приходит ТОЛЬКО
 *  отсюда, поэтому русская формулировка не может разъехаться с /localization.
 *  Также проставляет <html lang>, чтобы браузер и скринридер согласились с языком
 *  интерфейса. */
export function localizeStaticDom(): void {
  if (typeof document === 'undefined' || !document.querySelectorAll) return;
  if (document.documentElement) document.documentElement.lang = LOCALE;
  for (const el of Array.from(document.querySelectorAll<HTMLElement>('[data-i18n]'))) {
    const key = el.getAttribute('data-i18n')?.trim();
    if (key) el.textContent = t(key);
  }
  const attr = (suffix: string, name: string) => {
    for (const el of Array.from(document.querySelectorAll<HTMLElement>(`[data-i18n-${suffix}]`))) {
      const key = el.getAttribute(`data-i18n-${suffix}`)?.trim();
      if (key) el.setAttribute(name, t(key));
    }
  };
  attr('title', 'title');
  attr('ph', 'placeholder');
  attr('aria', 'aria-label');
}
