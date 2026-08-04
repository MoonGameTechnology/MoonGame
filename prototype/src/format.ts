/**
 * Presentation formatters (REFM-2) — the pure text/HTML helpers every screen needs:
 * escaping, number shortening, resource glyphs + tinted cost strings, display names,
 * ETA wording. Extracted from `main.ts` first ON PURPOSE: they carry no state and no
 * DOM, so every later REFM brick can import them directly instead of threading the
 * same five helpers through a `deps` object (see the method note in the REFM block of
 * docs/backlog.md — `main.ts` has no export surface, so screen modules take their
 * host dependencies explicitly; these are the ones that never need to be passed).
 *
 * Locale-aware but state-free: `t`/`tData` read the chosen locale, nothing else.
 */
import { t, tData } from '../../localization/runtime';
import { RES_SVG } from './icons';

/** HTML-escape for text AND attribute values (CWE-79). Covers both quote styles: the
 *  file uses double-quoted attributes today, escaping `'` too keeps this complete if a
 *  single-quoted attribute is ever added. */
export function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Compact count: 1234 → «1.2k». Rounds first, drops a trailing «.0». */
export function kfmt(n: number): string {
  const v = Math.round(n);
  return Math.abs(v) >= 1000 ? (v / 1000).toFixed(1).replace(/\.0$/, '') + 'k' : String(v);
}

/** Grouped count for dossier/profile numbers: 1234 → «1 234». */
export function nfmt(n: number): string {
  return n.toLocaleString('ru-RU');
}

/** One decimal — keeps a slow bleed visible instead of rounding it to a lying 0. */
export const round1 = (n: number): number => Math.round(n * 10) / 10;

/** Highlight a value inside dossier prose. */
export const hl = (v: string | number): string => `<em class="hl">${v}</em>`;

/** Resource glyph family (mock 2026-07: coin stack / cube / sprout / bolt / chip).
 *  These TEXT glyphs serve PLAIN-TEXT contexts only — `title=` attributes, toasts,
 *  button labels built with `esc()` — where SVG can't ride along. Every innerHTML
 *  surface draws the shared `RES_SVG` line icons instead (one look everywhere). */
export const TECH_CUR: Record<string, string> = {
  credits: '⛁',
  food: '⚘',
  metal: '❒',
  energy: 'ϟ',
  microelectronics: '▣',
};

/** Resource token for innerHTML strings: the SAME inline-SVG line icon the top bar
 *  draws, tinted by the same stylesheet accent (`.rc-*`). A player who learned the
 *  bar reads costs, the market book and yield rows for free — one icon, one colour,
 *  every surface. Unknown resource (modded data) → its localized-name initial. */
export const curIc = (r: string): string =>
  `<span class="rc-${r} ri">${RES_SVG[r] ?? esc((tData(r)[0] ?? r[0] ?? '?').toUpperCase())}</span>`;

/**
 * A cost bag as HTML (icon + amount per resource) — callers feed innerHTML, don't esc().
 *
 * With `have` (the buyer's treasury) each unaffordable entry turns SHORT: the chip
 * reads red and carries the exact deficit («−N») — the player sees not just "can't",
 * but how far away the build is. No `have` → the neutral price tag, unchanged look.
 */
export function cost(
  bag: Record<string, number> | undefined,
  have?: Record<string, number>,
): string {
  const entries = Object.entries(bag ?? {});
  if (!entries.length) return `<span class="rcost-free">${t('cost.free')}</span>`;
  return entries
    .map(([r, n]) => {
      const lack = have ? Math.max(0, Math.ceil(n - (have[r] ?? 0))) : 0;
      const gap = lack > 0 ? `<em class="lack" title="${t('cost.short', { n: lack })}">−${lack}</em>` : '';
      return `<span class="rcost rc-${r}${lack > 0 ? ' short' : ''}">${curIc(r)}${n}${gap}</span>`;
    })
    .join(' ');
}

/** The same bag as PLAIN TEXT — for `title=` attributes and button labels built with
 *  `esc()`, where the HTML from `cost()` would show the player raw markup. */
export function costText(bag: Record<string, number> | undefined): string {
  const parts = Object.entries(bag ?? {}).map(([r, n]) => `${n}${TECH_CUR[r] ?? r[0]}`);
  return parts.length ? parts.join(' ') : t('cost.free');
}

/** Localized display name of a unit id. Ids are English-ish («scout_drone») — the
 *  space-joined id is the DATA name the RU locale translates; EN shows it as-is. */
export function displayUnit(unit: string): string {
  return tData(unit.replace(/_/g, ' '));
}

/** Localized display name of a building id (`data/*.json` names are English). */
export function buildingName(name: string | undefined, id: string): string {
  return tData(name ?? id);
}

/** «2.5 ч» / «40 мин» — an ETA in the wording the HUD uses. */
export function fmtEta(totalH: number): string {
  return totalH >= 1
    ? t('fmt.hours', { n: totalH.toFixed(1) })
    : t('fmt.minutes', { n: Math.ceil(totalH * 60) });
}

/** «≈14ч» / «≈2д 3ч» — plan durations are game-hours, like every duration in the UI. */
export function fmtHrs(h: number): string {
  const r = Math.max(0, Math.round(h));
  return r >= 48
    ? t('browser.left.days', { d: Math.floor(r / 24), h: r % 24 })
    : t('fmt.hours', { n: r });
}
