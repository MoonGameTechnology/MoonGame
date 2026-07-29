/**
 * ONB-2 · The guided first match — a data-described chain (ONB-1 engine) that
 * walks a brand-new commander through the core loop in a bot-free solo sandbox:
 *
 *   produce (build a mine) → build (raise a fleet) → move (set a course, fog
 *   opens) → capture a neutral world (two-phase) → the score moves → first win.
 *
 * The "do X" beats advance on the REAL game action (`action:<type>`, fed from
 * `playerOrder`) and the capture/score beats on live GAME STATE (`state`,
 * predicates over `s`) — so the guide tracks what the player actually does, not
 * a scripted click path. The narration steers even where a precise highlight is
 * unavailable: HUD highlights are `optional`, so a missing/renamed selector
 * degrades to copy-only guidance instead of stopping the tour (spotlight.ts).
 *
 * `copy` is a locale key (canonical-Russian msgid; en.ts translates). Predicates
 * come from the host so this stays pure and unit-testable.
 */
import type { SpotlightStep } from './spotlight';

export interface FirstMatchDeps {
  /** True once the player has raised a mobile fleet (a built ship auto-rallies to orbit). */
  hasFleet: () => boolean;
  /** True once the player owns a world beyond their start (a neutral was taken). */
  capturedWorld: () => boolean;
  /** True once the player's score has risen above its starting value. */
  scoreRose: () => boolean;
}

/** The ordered guide chain for a fresh commander's first, bot-free match. */
export function buildFirstMatchTour(deps: FirstMatchDeps): SpotlightStep[] {
  return [
    {
      id: 'welcome',
      target: null,
      copy: 'onb.tour.first.welcome',
      advance: { on: 'tap' },
    },
    {
      id: 'home',
      target: '#side',
      copy: 'onb.tour.first.home',
      advance: { on: 'tap' },
      placement: 'top',
      optional: true,
    },
    {
      id: 'mine',
      target: '[data-buildorder="building:mine"]',
      copy: 'onb.tour.first.mine',
      advance: { on: 'action', type: 'building.construct' },
      placement: 'top',
    },
    {
      id: 'fleet',
      target: null,
      copy: 'onb.tour.first.fleet',
      advance: { on: 'state', when: deps.hasFleet },
    },
    {
      id: 'course',
      target: '#cmdbar',
      copy: 'onb.tour.first.course',
      advance: { on: 'action', type: 'fleet.move' },
      placement: 'top',
    },
    {
      id: 'capture',
      target: null,
      copy: 'onb.tour.first.capture',
      advance: { on: 'state', when: deps.capturedWorld },
    },
    {
      id: 'score',
      target: '#devline',
      copy: 'onb.tour.first.score',
      advance: { on: 'state', when: deps.scoreRose },
      placement: 'bottom',
    },
    {
      id: 'done',
      target: null,
      copy: 'onb.tour.first.done',
      advance: { on: 'tap' },
    },
  ];
}
