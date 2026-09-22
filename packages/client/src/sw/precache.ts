/**
 * What the offline shell ships with — decided at BUILD time (CP2.2).
 *
 * The Service Worker cannot discover the app's files by itself: Vite names every chunk
 * after a hash of its contents, so the list is only knowable once the build has run.
 * These helpers turn "what the build emitted" into the two lists the worker needs, and
 * they are kept here — pure, no `node:` imports — so the rules can be tested without a
 * build, a browser or a network (the plugin in `vite.config.ts` supplies the files).
 *
 * Two lists, not one, because "may be cached" and "is downloaded up front" differ for
 * exactly one kind of file — the per-language chunks. LOC-6 made the client download
 * EXACTLY ONE language; precaching both would hand that saving straight back (the two
 * locale chunks are the largest assets of the build after the app itself). So a locale
 * chunk stays cacheable — the player's own language lands in the cache the moment it is
 * fetched — but the install step never reaches for it.
 */

/** One emitted file of a client build. */
export interface BuiltFile {
  /** Path relative to the build output root, POSIX separators: `assets/main-BpldJrhO.js`. */
  path: string;
  /** Any digest that changes with the bytes — only equality is ever read. */
  digest: string;
}

/** The worker's own bundle. The browser fetches it through its own update machinery. */
export const SW_FILE = 'sw.js';

/**
 * A digest of one emitted file. FNV-1a/32 over the bytes — not a security hash and
 * never used as one: the only question ever asked of it is "did this file change".
 * Kept here, dependency-free, so the same function serves the build and its test.
 */
export function digestOf(source: string | Uint8Array): string {
  let h = 0x811c9dc5;
  if (typeof source === 'string') {
    for (let i = 0; i < source.length; i++) h = Math.imul(h ^ source.charCodeAt(i), 0x01000193);
  } else {
    for (let i = 0; i < source.length; i++) h = Math.imul(h ^ (source[i] ?? 0), 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/** `-` and friends are literal in a regex body, but a locale id is data — escape it. */
const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** A per-language chunk emitted by `voidLocaleChunks` (`vite.config.ts`). */
export function isLocaleChunk(path: string, localeIds: readonly string[]): boolean {
  return localeIds.some((id) => new RegExp(`^assets/${escapeRe(id)}-[^/]*\\.js$`).test(path));
}

/** Everything the worker is allowed to keep in its cache, sorted for a stable build id. */
export function cacheablePaths(files: readonly BuiltFile[]): string[] {
  return files
    .map((f) => f.path)
    .filter((p) => p !== SW_FILE)
    .sort();
}

/** What the worker downloads at install time: the shell, minus the other languages. */
export function precachePaths(files: readonly BuiltFile[], localeIds: readonly string[]): string[] {
  return cacheablePaths(files).filter((p) => !isLocaleChunk(p, localeIds));
}

/**
 * A short id that changes when — and only when — the shipped bytes change.
 *
 * It names the cache (`void-shell-<id>`), so a build with the same output reuses the
 * cache it already filled, and a build with anything different gets a fresh one and
 * drops the old. Derived from the file DIGESTS rather than from the hashed names, because
 * one shipped file has a FIXED name and holds real content: `index.html` carries this
 * app's entire stylesheet. Keyed on names alone, a change to it alone would leave every
 * installed client serving the old shell forever.
 */
export function buildId(files: readonly BuiltFile[]): string {
  const canonical = [...files]
    .filter((f) => f.path !== SW_FILE)
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
    .map((f) => `${f.path}\u0000${f.digest}`)
    .join('\n');
  return digestOf(canonical);
}
