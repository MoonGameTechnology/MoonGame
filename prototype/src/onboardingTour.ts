/**
 * ONB-1 · A concrete, data-described guide-mark chain over the live HUD — the
 * proof that the spotlight engine (`./spotlight`) leads a player around REAL
 * elements, and the base ONB-2 extends into the full guided first match.
 *
 * `copy` is a locale key: the canonical-Russian msgid (translated by locale/en.ts).
 * The HUD-targeted steps are `optional` so launching the tour outside a match
 * (targets hidden → engine sees no rect) skips them gracefully instead of
 * safe-stopping — see spotlight.ts. Selectors are stable HUD ids from build.mjs.
 */
import type { SpotlightStep } from './spotlight';

/** A short interface-orientation tour: welcome → real-time clock → treasury → tools. */
export const HUD_ORIENTATION_TOUR: SpotlightStep[] = [
  {
    id: 'welcome',
    target: null,
    copy: 'onb.tour.hud.welcome',
    advance: { on: 'tap' },
  },
  {
    id: 'clock',
    target: '#speedbar',
    copy: 'onb.tour.hud.clock',
    advance: { on: 'tap' },
    placement: 'top',
    optional: true,
  },
  {
    id: 'purse',
    target: '#purse',
    copy: 'onb.tour.hud.purse',
    advance: { on: 'tap' },
    placement: 'bottom',
    optional: true,
  },
  {
    id: 'tools',
    target: '#rail',
    copy: 'onb.tour.hud.tools',
    advance: { on: 'tap' },
    placement: 'right',
    optional: true,
  },
  {
    id: 'done',
    target: null,
    copy: 'onb.tour.hud.done',
    advance: { on: 'tap' },
  },
];
