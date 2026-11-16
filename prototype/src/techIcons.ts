/**
 * Значки окна «Технологии»: контурные SVG веток и видов узла (`techIconKind`) и цвет ветки.
 * Рисунок здесь, а решение «какой значок у узла» — в `decisions/techTreeLayout.ts`.
 */
import type { TechIconKind } from '../../decisions/techTreeLayout';

const svg = (paths: string): string => `<svg viewBox="0 0 24 24" aria-hidden="true">${paths}</svg>`;

/** Цвет ветки: плитка ветки и кольцо значка узла. */
export const BRANCH_COLOR: Readonly<Record<string, string>> = {
  industry: '#e2b45c',
  space: '#56dbe8',
  ground: '#7bdc9e',
  shuttle: '#8fb3ff',
  missile: '#f08a6a',
  command: '#f0a8d4',
};

const BRANCH_PATHS: Readonly<Record<string, string>> = {
  industry: '<path d="M3 20V10l5 3V10l5 3V6h4v14z"/><path d="M3 20h18"/>',
  space: '<circle cx="12" cy="12" r="4"/><ellipse cx="12" cy="12" rx="10" ry="3.5" transform="rotate(-20 12 12)"/>',
  ground: '<path d="M12 3l7 3v5c0 5-3 8-7 10-4-2-7-5-7-10V6z"/>',
  shuttle: '<path d="M12 3l2 7 7 4-7 1-2 6-2-6-7-1 7-4z"/>',
  missile: '<path d="M14 4c3 0 6 3 6 6l-8 8-6-6z"/><path d="M6 12l-2 6 6-2"/>',
  command: '<path d="M12 21V9"/><path d="M8 13a5 5 0 0 1 8 0"/><path d="M5 10a9 9 0 0 1 14 0"/><circle cx="12" cy="8" r="1.2"/>',
};

const KIND_PATHS: Readonly<Record<TechIconKind, string>> = {
  prod: BRANCH_PATHS.industry!,
  speed: '<path d="M4 7l6 5-6 5"/><path d="M12 7l6 5-6 5"/>',
  dmg: '<circle cx="12" cy="12" r="7"/><path d="M12 2v5M12 17v5M2 12h5M17 12h5"/>',
  radar: '<path d="M12 12L19 5"/><circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="4"/>',
  ship: '<path d="M3 13l9-8 9 8-3 1H6z"/><path d="M6 14v4h12v-4"/>',
  troop: '<path d="M5 12a7 7 0 0 1 14 0v2H5z"/><path d="M3 14h18"/><path d="M9 18h6"/>',
  craft: BRANCH_PATHS.shuttle!,
  rocket: BRANCH_PATHS.missile!,
  bld: '<path d="M4 20V9l8-5 8 5v11z"/><path d="M9 20v-6h6v6"/>',
  shield: BRANCH_PATHS.ground!,
  hero: '<path d="M12 3l2.6 5.4 5.9.8-4.3 4.1 1 5.8L12 16.4 6.8 19.1l1-5.8L3.5 9.2l5.9-.8z"/>',
  flag: '<path d="M6 21V4"/><path d="M6 4h11l-2 4 2 4H6"/>',
  moon: '<path d="M20 14A8 8 0 1 1 10 4a6 6 0 0 0 10 10z"/>',
  coin: '<circle cx="12" cy="12" r="8"/><path d="M9 10h5a2 2 0 0 1 0 4H9"/><path d="M12 8v8"/>',
  star: '<path d="M12 4v16M4 12h16M7 7l10 10M17 7L7 17"/>',
};

export const branchIconSvg = (branch: string): string => svg(BRANCH_PATHS[branch] ?? KIND_PATHS.star);
export const techKindSvg = (kind: TechIconKind): string => svg(KIND_PATHS[kind]);
