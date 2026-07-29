// Локализация прототипа. Рантайм (выбор языка, `t`/`tData`) — ОБЩИЙ с клиентом и
// живёт в `/localization/runtime.ts`; здесь остаётся только то, что специфично для
// прототипа: проход по его статической разметке.
//
//   t('err.no-capacity')                  → текст по ключу
//   t('fleet.eta', { n: 3 })              → '{x}' подставляет живые значения
//   tData('Metal Mine')                   → имя игровых ДАННЫХ (→ data.metal-mine)
import { LOCALE_LABEL } from '../../localization';
import type { LocaleId } from '../../localization';
import { LOCALE, t } from '../../localization/runtime';

export type { LocaleId };
export { LOCALE_LABEL };
export { LOCALE, setLocale, lookup, hasKey, t, tData } from '../../localization/runtime';

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
