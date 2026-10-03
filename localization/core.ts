// Рантайм локализации — ОДИН на всех потребителей (прототип и PWA-клиент).
// Тексты живут в соседних `ru.ts` / `en.ts`; здесь только выбор языка, поиск
// ключа и подстановка значений.
//
//   t('err.no-capacity')                  → текст по ключу
//   t('fleet.eta', { n: 3 })              → '{x}' подставляет живые значения
//   t('side.world.fleet-ships', { n: 5 }) → '{n|корабль|корабля|кораблей}' — слово по числу
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
export { LOCALE_LABEL, LOCALE_IDS, DEFAULT_LOCALE, isLocaleId } from './index';

const STORE_KEY = 'vd.locale';

/** Подключённые таблицы текстов. Пусто до первого `registerMessages` — ровно поэтому
 *  `lookup()` устроен так, что промах даёт `undefined`, а не падение. */
const TABLES: Partial<Record<LocaleId, Messages>> = {};

/** Подключить тексты языка. Клиент зовёт это один раз для выбранной локали (её файл
 *  уже содержит фолбэк — `bakedLocale()`), прототип и тесты — сразу для всех. */
export function registerMessages(id: LocaleId, messages: Messages): void {
  TABLES[id] = messages;
}

/** Язык, который игрок выбрал САМ (переключателем). `null` — не выбирал или хранилище
 *  недоступно. */
function savedLocale(): LocaleId | null {
  try {
    const saved = typeof localStorage !== 'undefined' ? localStorage.getItem(STORE_KEY) : null;
    if (isLocaleId(saved)) return saved;
  } catch {
    /* storage disabled — fall through to the browser language */
  }
  return null;
}

function detect(): LocaleId {
  const saved = savedLocale();
  if (saved) return saved;
  const nav = typeof navigator !== 'undefined' ? navigator.language : DEFAULT_LOCALE;
  return nav?.toLowerCase().startsWith('ru') ? 'ru' : 'en';
}

export let LOCALE: LocaleId = detect();

/**
 * Язык, подсказанный окружением ПОСЛЕ старта рантайма — сегодня это площадка (`YAG-1.3`):
 * её SDK поднимается позже, чем `detect()` успевает выбрать язык по браузеру.
 *
 * Явный выбор игрока сильнее подсказки: переключил язык — площадка его не перебьёт.
 * Подсказка НЕ сохраняется, иначе она сама стала бы «выбором» и пережила смену языка на
 * площадке. Возвращает, сменился ли язык: вызывающему нужно перерисовать то, что уже
 * успело отрисоваться (`localizeStaticDom`).
 */
export function suggestLocale(id: LocaleId): boolean {
  if (savedLocale() !== null || id === LOCALE) return false;
  LOCALE = id;
  return true;
}

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
  return found(key)?.text;
}

/** Текст ключа и язык, которому он принадлежит (`lookup` плюс язык для склонения). */
function found(key: string): { text: string; id: LocaleId } | undefined {
  const own = TABLES[LOCALE]?.[key];
  if (own !== undefined) return { text: own, id: LOCALE };
  const source = TABLES[DEFAULT_LOCALE]?.[key];
  return source === undefined ? undefined : { text: source, id: DEFAULT_LOCALE };
}

/** Есть ли у ключа перевод. Нужен там, где при промахе положен НЕ ключ, а
 *  осмысленный запасной текст (например, разбор незнакомого кода ошибки). */
export const hasKey = (key: string): boolean => lookup(key) !== undefined;

/**
 * СКЛОНЕНИЕ ПО ЧИСЛУ (UIX-5.3). «4 кораблей» и «1 кораблей» получались потому, что слово
 * при числе стояло в тексте одной формой. Теперь форма выбирается по числу прямо в строке
 * локали: `{n|корабль|корабля|кораблей}` — имя значения и формы через черту. Ключ остаётся
 * один, перевод видит фразу целиком, а в коде вызов тот же `t(key, { n })`.
 *
 * 1. **Правило выбора — языка, а не наше.** Категорию числа даёт `Intl.PluralRules`:
 *    русскому нужны три формы (1 корабль, 2 корабля, 5 кораблей, а 11 — «кораблей»),
 *    английскому две. Самописная таблица окончаний ошиблась бы на 11–14 и на новом языке.
 * 2. **Формы — в порядке категорий CLDR** (`zero one two few many other`), из которых
 *    берутся только категории этого языка: у русского `one few many other`, у английского
 *    `one other`. Последняя форма служит и всем пропущенным: русскому `other` (дробные,
 *    «1,5 корабля») можно не писать, пока число при слове целое.
 * 3. **Число пишется отдельно** (`{n} {n|корабль|…}`): форма — только слово, поэтому
 *    «~{n}», «+{n}» и формат числа остаются за строкой. Значение может прийти в разметке
 *    (`hl()` выделяет числа `<em>`): число читается из текста без тегов. Не число —
 *    категория `other`.
 * 4. **Правило — того языка, чей текст нашёлся.** Непереведённый ключ показывается
 *    по-русски (`lookup`), и его формы выбираются по-русски, а не по выбранному языку.
 *    У клиента фолбэк запечён в таблицу языка (LOC-6), и там такая строка склоняется по
 *    правилу языка — переводом она и чинится.
 */
const PLURAL_ORDER: readonly Intl.LDMLPluralRule[] = ['zero', 'one', 'two', 'few', 'many', 'other'];
const PLURAL_RULES = new Map<LocaleId, Intl.PluralRules>();
const pluralRules = (id: LocaleId): Intl.PluralRules => {
  let rules = PLURAL_RULES.get(id);
  if (!rules) PLURAL_RULES.set(id, (rules = new Intl.PluralRules(id)));
  return rules;
};

/** Категории числа языка в порядке форм `{n|…}` (правило 2). */
export function pluralCategories(id: LocaleId): Intl.LDMLPluralRule[] {
  const own = pluralRules(id).resolvedOptions().pluralCategories;
  return PLURAL_ORDER.filter((c) => own.includes(c));
}

/** Форма слова для числа `n` (правила 1–3). */
export function pluralForm(id: LocaleId, n: number, forms: readonly string[]): string {
  const at = pluralCategories(id).indexOf(Number.isFinite(n) ? pluralRules(id).select(n) : 'other');
  return forms[Math.min(at, forms.length - 1)] ?? '';
}

/** Число значения подстановки: из текста без тегов (правило 3). */
const countOf = (v: string | number): number =>
  typeof v === 'number' ? v : Number(v.replace(/<[^>]*>/g, ''));

/** `{имя}` — значение, `{имя|форма|форма…}` — слово по числу. */
const SLOT_RE = /\{(\w+)((?:\|[^|{}]*)+)?\}/g;

function interpolate(s: string, vars: Record<string, string | number> | undefined, id: LocaleId): string {
  if (!vars) return s;
  return s.replace(SLOT_RE, (m, k: string, forms?: string) => {
    if (!(k in vars)) return m;
    return forms ? pluralForm(id, countOf(vars[k]!), forms.slice(1).split('|')) : String(vars[k]);
  });
}

/** Текст интерфейса по ключу. Промах → сам ключ (заметная опечатка). */
export function t(key: string, vars?: Record<string, string | number>): string {
  const hit = found(key);
  return interpolate(hit?.text ?? key, vars, hit?.id ?? LOCALE);
}

/** Имя игровых ДАННЫХ. Промах → исходное английское имя из data/*.json: новый юнит
 *  виден под своим именем, а не как `data.new-unit`. */
export function tData(name: string): string {
  // `?? lookup(name)` — страховка, а не разрешение путать вызовы. Если сюда всё же
  // приехал КЛЮЧ (часть полей каталога `data/*.json` хранит ключи, а не текст), слаг
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
