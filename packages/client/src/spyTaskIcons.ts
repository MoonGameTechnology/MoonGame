/**
 * Line icons of the spy tasks (owner's ask 2026-11-20: spy buttons look like a game, not like a
 * phone app, so no emoji). One 24×24 path set per task, stroked with `currentColor`: the caller's
 * stylesheet gives the colour (quiet tasks cyan, loud ones amber). Only geometry lives here.
 */
import type { SpyOp } from '../../shared-core/src/index';
import { SPY_SHIP_SHAPES, type SpyShipId } from './spyShipShapes';

/** Paths of each task's icon, in a 24×24 box. `relocate` is the move between worlds. */
export const SPY_TASK_ICONS: Readonly<Record<SpyOp, string>> = {
  relocate:
    '<path d="M4 19c3-1 4-5 7-6s5 1 8-3"/><circle cx="19" cy="7" r="2.6"/><path d="M4 19h.01" stroke-width="3"/>',
  counter:
    '<path d="M12 3l7 3v5c0 5-3.2 8.2-7 10-3.8-1.8-7-5-7-10V6z"/><path d="M8.2 12.2c2.2-2.6 5.4-2.6 7.6 0-2.2 2.6-5.4 2.6-7.6 0z"/><circle cx="12" cy="12.2" r="1.1"/>',
  recon:
    '<circle cx="12" cy="12" r="7"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4"/><circle cx="12" cy="12" r="2"/>',
  research:
    '<rect x="6" y="6" width="9" height="9" rx="1"/><path d="M9 3v3M12 3v3M9 15v3M3 9h3M3 12h3"/><path d="M14 14l6 6M20 15.5V20h-4.5"/>',
  theft:
    '<path d="M4 9l6-3 6 3v7l-6 3-6-3z"/><path d="M4 9l6 3 6-3M10 12v7"/><path d="M17 6l4-3M21 3v3.6M21 3h-3.6"/>',
  delay:
    '<path d="M4 20h9M6 20V9l5-4 5 4"/><path d="M16 9v3"/><circle cx="17.5" cy="16.5" r="4"/><path d="M16.3 15v3M18.7 15v3"/>',
  disrupt: '<path d="M3 6l5 5 4-3 4 6 5 4"/><path d="M21 13.5V18h-4.5"/><path d="M3 21h18"/>',
  sabotage:
    '<path d="M12 2.5l1.8 5 4.7-2.3-2.2 4.8 5.2 1.6-5 1.9 2.4 4.6-4.9-2.1L12 21.5l-1.9-5.5-4.9 2.1 2.4-4.6-5-1.9 5.2-1.6-2.2-4.8 4.7 2.3z"/>',
};

/** Clock of a duration («12 ч»), the same line style. */
export const SPY_CLOCK_ICON = '<circle cx="12" cy="12" r="8"/><path d="M12 7.5V12l3 2"/>';

/** The icon of task `op` as inline SVG for innerHTML; decorative, so hidden from readers. */
export function spyTaskIconSvg(op: SpyOp, cls = 'sp-ico'): string {
  return `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true">${SPY_TASK_ICONS[op]}</svg>`;
}

/** The clock as inline SVG. */
export function spyClockSvg(cls = 'sp-ico'): string {
  return `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true">${SPY_CLOCK_ICON}</svg>`;
}

/** The spy's own ship (`spyShipOf`) as inline SVG next to its name: the same silhouette the map
 *  draws on the lane. Hull, detail and engines get classes `h`, `d`, `e` for the stylesheet. */
export function spyShipSvg(id: SpyShipId, cls = 'sp-ship'): string {
  const s = SPY_SHIP_SHAPES[id];
  return (
    `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true">` +
    `<path class="h" d="${s.hull}"/><path class="d" d="${s.detail}"/><path class="e" d="${s.engines}"/></svg>`
  );
}
