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
 *  Producer buildings echo these in `BUILD_ICON` — keep both in sync. These TEXT
 *  glyphs serve inline prose; the top-bar capsules draw richer SVG line icons. */
export const TECH_CUR: Record<string, string> = {
  credits: '⛁',
  food: '⚘',
  metal: '❒',
  energy: 'ϟ',
  microelectronics: '▣',
};

/** Resource token for innerHTML strings, tinted with the resource's accent colour
 *  (`.rc-*` in the stylesheet). Plain-text contexts (toasts, titles) keep the bare
 *  `TECH_CUR` glyph — colour can't ride along there. */
export const curIc = (r: string): string => `<span class="rc-${r}">${TECH_CUR[r] ?? r[0]}</span>`;

/** A cost bag as HTML (resource-tinted tokens) — callers feed innerHTML, don't esc(). */
export function cost(bag: Record<string, number> | undefined): string {
  if (!bag) return 'free';
  const parts = Object.entries(bag).map(
    ([r, n]) => `<span class="rc-${r}">${n}${TECH_CUR[r] ?? r[0]}</span>`,
  );
  return parts.length ? parts.join(' ') : 'free';
}

/** The same bag as PLAIN TEXT — for `title=` attributes and button labels built with
 *  `esc()`, where the HTML from `cost()` would show the player raw markup. */
export function costText(bag: Record<string, number> | undefined): string {
  if (!bag) return 'free';
  const parts = Object.entries(bag).map(([r, n]) => `${n}${TECH_CUR[r] ?? r[0]}`);
  return parts.length ? parts.join(' ') : 'free';
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
