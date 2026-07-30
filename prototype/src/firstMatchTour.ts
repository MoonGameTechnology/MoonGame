/**
 * ONB-2 · The guided first match — a data-described chain (ONB-1 engine) that
 * walks a brand-new commander through the core loop in a bot-free solo sandbox:
 *
 *   produce (grow the mine) → build (raise a fleet) → troops (load a landing
 *   force — informational, concept only) → move (set a course, fog opens) →
 *   capture a neutral world (two-phase) → the score moves → first win.
 *
 * `startGuidedMatch` (main.ts) also forces the sim to run at accelerated time
 * for this sandbox — a Mine upgrade alone is hours of game time, and a brand
 * new player left on the default ×10 wall-clock-ish preset would wait real
 * MINUTES for the very first beat to resolve.
 *
 * The "do X" beats advance on the REAL game action (`action:<type>`, fed from
 * `playerOrder`) and the home/fleet/capture/score beats on live GAME STATE
 * (`state`, predicates over `s`) — so the guide tracks what the player actually
 * does, not a scripted click path. `home` gates on the panel actually being open
 * (never `optional`+`tap`: the target is guaranteed absent on arrival, which
 * would silently skip a `tap` step past the very instruction it exists to show).
 *
 * `copy` is a `/localization` key (`onb.tour.*`) or, for the not-yet-migrated
 * steps, the legacy canonical-Russian msgid bridged via `/localization/legacy`
 * — `t()` (i18n.ts) resolves either. Predicates come from the host so this
 * stays pure and unit-testable.
 */
import type { SpotlightStep } from './spotlight';

export interface FirstMatchDeps {
  /** True once the player has tapped their homeworld and its panel is open. */
  homeOpened: () => boolean;
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
      copy: 'Это твой первый мир, командир. Проведу тебя по главному циклу — пара минут, спокойно, без соперников.',
      advance: { on: 'tap' },
    },
    {
      id: 'home',
      target: '#side',
      copy: 'onb.tour.home',
      advance: { on: 'state', when: deps.homeOpened },
      placement: 'top',
    },
    {
      // The homeworld starts with a level-1 Mine already built (matchSetup.ts) — a
      // fresh `building.construct` order for it is never possible, so the first
      // economy beat is its upgrade instead (still `mine`, still the first thing
      // worth spending on): a distinct `building.upgrade` order (construction.ts).
      id: 'mine',
      target: '[data-act="upgrade"][data-arg="mine"]',
      copy: 'onb.tour.mine',
      advance: { on: 'action', type: 'building.upgrade' },
      placement: 'top',
    },
    {
      id: 'fleet',
      target: null,
      copy: 'Теперь построй боевой корабль — вкладка «Корабли» той же панели. Готовый корабль сам прилетит на орбиту и соберётся во флот — жди, пока рядом с твоим миром не появится «▲».',
      advance: { on: 'state', when: deps.hasFleet },
    },
    {
      // Concept-only, tap-advance: whether THIS run's target neutral is actually
      // garrisoned depends on the map, so this can't gate on a real load action
      // the way `mine`/`course` gate on theirs — but the mechanic (and the "why")
      // still needs teaching before the player sets a course and finds out the
      // hard way that a defended world without troops aboard won't fall.
      id: 'troops',
      target: null,
      copy: 'onb.tour.troops',
      advance: { on: 'tap' },
    },
    {
      id: 'course',
      target: '#cmdbar',
      copy: 'Выбери свой флот (▲) и тапни соседний мир — задай курс. Флот пойдёт по звёздным трассам, и туман начнёт открываться.',
      advance: { on: 'action', type: 'fleet.move' },
      placement: 'top',
    },
    {
      id: 'capture',
      target: null,
      copy: 'Захвати нейтральный мир: выйди на орбиту, а если он защищён — высади десант. Захват двухфазный: сначала небо, потом земля.',
      advance: { on: 'state', when: deps.capturedWorld },
    },
    {
      id: 'score',
      target: '#devline',
      copy: 'Мир взят — и счёт пошёл! Очки капают за миры и сектора; набери порог — и это победа.',
      advance: { on: 'state', when: deps.scoreRose },
      placement: 'bottom',
    },
    {
      id: 'done',
      target: null,
      copy: 'Первая схватка выиграна! Ты прошёл весь цикл: добыча → стройка → движение → захват → счёт. Дальше — настоящий матч.',
      advance: { on: 'tap' },
    },
  ];
}
