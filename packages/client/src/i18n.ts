/**
 * Thin localization runtime for the PWA client (LOC-3) — mirrors the prototype's
 * `prototype/src/i18n.ts`: texts live in `/localization`, this file only picks a
 * locale and looks a key up. No bridge, no third localization system — same
 * `LOCALES`/`DEFAULT_LOCALE`/keys the prototype and `data/*.json` content share.
 */
import { LOCALES, DEFAULT_LOCALE, dataKey, isLocaleId } from '../../../localization';
import type { LocaleId } from '../../../localization';

export type { LocaleId };

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

export const LOCALE: LocaleId = detect();

/** Text by key: chosen locale → Russian source. `undefined` if the key exists
 *  nowhere — callers decide what to show (usually the key itself). */
export function lookup(key: string): string | undefined {
  return LOCALES[LOCALE][key] ?? LOCALES[DEFAULT_LOCALE][key];
}

function interpolate(s: string, vars?: Record<string, string | number>): string {
  if (!vars) return s;
  return s.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
}

/** UI text by key. A miss returns the key itself — a visible typo, never blank. */
export function t(key: string, vars?: Record<string, string | number>): string {
  return interpolate(lookup(key) ?? key, vars);
}

/** Game-DATA name (units/buildings/etc from `data/*.json`). A miss falls back to
 *  the source English name, not the key — an unrecognised name stays readable. */
export function tData(name: string): string {
  return lookup(dataKey(name)) ?? name;
}
