/**
 * App entry point. Its only job is ordering: load the player's locale, THEN the app.
 *
 * The app builds localized constants at module scope (`welcomeScreen.ts`'s
 * `defaultStrings`, `main.ts`'s rejection texts), so it must not be evaluated before
 * the texts are registered — a static import would evaluate it first. Hence the
 * dynamic `import('./main')`, which also keeps the locale chunk and the app chunk
 * separate (LOC-6: one language per player, not all of them).
 */
import { localizeStaticDom } from '../../../localization/core';
import { loadActiveLocale } from './locale';

void loadActiveLocale()
  // `<html lang>` is stamped from the locale that actually loaded — the static
  // attribute in index.html is a guess made before the language is known.
  .then(() => localizeStaticDom())
  // A chunk that fails to load must not leave a blank screen: the app still boots and
  // shows raw keys, which is visibly wrong but usable.
  .catch(() => undefined)
  .then(() => import('./main'));
