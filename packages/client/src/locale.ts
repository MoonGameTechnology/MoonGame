/**
 * Locale loading for the web client (LOC-6): the player downloads EXACTLY ONE
 * language, not every language the game speaks.
 *
 * Each `virtual:void-locale/<id>` module is produced by the build (see
 * `vite.config.ts` → `voidLocaleChunks`) from `bakedLocale(id)` — the language with
 * the Russian source already baked in as a fallback. That baking is what makes a
 * single chunk enough: the shared runtime's fallback path (`core.ts` → `lookup`)
 * would otherwise drag the source language into every non-Russian player's download.
 *
 * The map is written out per locale on purpose: Rollup only code-splits a dynamic
 * import whose specifier is a literal, so a computed `import(...)` would either
 * inline every language back into the main chunk or ship an unresolvable URL.
 */
import { LOCALE, registerMessages } from '../../../localization/core';
import type { LocaleId, Messages } from '../../../localization/core';

/** One entry per `LOCALE_IDS`; `locale.test.ts` fails the gate if a language is
 *  missing here — a forgotten entry would show the player raw keys. */
export const LOCALE_CHUNKS: Record<LocaleId, () => Promise<{ default: Messages }>> = {
  ru: () => import('virtual:void-locale/ru'),
  en: () => import('virtual:void-locale/en'),
};

/** Fetch the active locale's chunk and hand its texts to the shared runtime. Must be
 *  awaited before any module that builds localized constants at import time (most of
 *  the app does — hence the `boot.ts` split). */
export async function loadActiveLocale(): Promise<LocaleId> {
  registerMessages(LOCALE, (await LOCALE_CHUNKS[LOCALE]()).default);
  return LOCALE;
}
