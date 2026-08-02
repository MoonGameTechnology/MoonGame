/**
 * ONB-3 · Just-in-time mechanic intros (progressive disclosure). The FIRST time a
 * player opens an advanced panel (tech / market / steward / shipyard / diplomacy),
 * a one-screen intro card explains it — then never again. This spreads learning
 * across sessions instead of front-loading it, and only surfaces a system at the
 * moment of first contact (docs/onboarding-roadmap.md ONB-3).
 *
 * Pure module: no DOM, no i18n, no storage — main.ts persists the seen-set
 * per-callsign (`vd.seenIntros.<nick>`) and renders the card copy through `t()`.
 * The parser is fail-secure (garbage → empty set) and every op is idempotent.
 */

export type IntroTrigger = 'panelOpen' | 'firstAvailable' | 'firstFail';

/** One intro card — copy lives in /localization; here are its keys. Shown once. */
export interface IntroCard {
  id: string;
  titleKey: string;
  bodyKey: string;
  trigger: IntroTrigger;
}

/** The advanced systems worth a first-contact card. Panel-open triggers for now;
 *  the `trigger` field leaves room for firstAvailable/firstFail (retreat/artillery). */
export const INTROS: IntroCard[] = [
  {
    id: 'tech',
    trigger: 'panelOpen',
    titleKey: 'onb.intro.tech.title',
    bodyKey: 'onb.intro.tech.body',
  },
  {
    id: 'market',
    trigger: 'panelOpen',
    titleKey: 'onb.intro.market.title',
    bodyKey: 'onb.intro.market.body',
  },
  {
    id: 'steward',
    trigger: 'panelOpen',
    titleKey: 'onb.intro.steward.title',
    bodyKey: 'onb.intro.steward.body',
  },
  {
    id: 'constructor',
    trigger: 'panelOpen',
    titleKey: 'onb.intro.constructor.title',
    bodyKey: 'onb.intro.constructor.body',
  },
  {
    // ONB-3 remainder: fired on first open of the «Герои» tab inside the shipyard
    // (constructor panel already teases it, this is the actual explainer).
    id: 'hero',
    trigger: 'panelOpen',
    titleKey: 'onb.intro.hero.title',
    bodyKey: 'onb.intro.hero.body',
  },
  {
    id: 'diplomacy',
    trigger: 'panelOpen',
    titleKey: 'onb.intro.diplomacy.title',
    bodyKey: 'onb.intro.diplomacy.body',
  },
  {
    // ONB-8: fired on first open of the corporation cabinet.
    id: 'corp',
    trigger: 'panelOpen',
    titleKey: 'onb.intro.corp.title',
    bodyKey: 'onb.intro.corp.body',
  },
  {
    // ONB-8: fired on first open of the "Войны" (AvA) tab inside the corp cabinet.
    id: 'ava',
    trigger: 'panelOpen',
    titleKey: 'onb.intro.ava.title',
    bodyKey: 'onb.intro.ava.body',
  },
  {
    // ONB-5: fired on the FIRST order that takes real time (a fleet leaving on a
    // course) — the moment the async model becomes tangible.
    id: 'asyncDelay',
    trigger: 'firstAvailable',
    titleKey: 'onb.intro.async-delay.title',
    bodyKey: 'onb.intro.async-delay.body',
  },
  {
    // ONB-3 remainder (docs/onboarding-roadmap.md): fired on the FIRST `fleet.retreat`
    // order — teaches the mechanic's real gotcha BEFORE it costs the player a fleet,
    // instead of leaving it buried in the mid-battle `.hint` (same copy, calmer moment).
    id: 'retreat',
    trigger: 'firstFail',
    titleKey: 'onb.intro.retreat.title',
    bodyKey: 'onb.intro.retreat.body',
  },
  {
    // ONB-3 remainder: fired on the FIRST `fleet.barrage` order — the moment standoff
    // fire becomes tangible, mirroring asyncDelay's "teach on first real use" pattern.
    id: 'artillery',
    trigger: 'firstAvailable',
    titleKey: 'onb.intro.artillery.title',
    bodyKey: 'onb.intro.artillery.body',
  },
];

/** Fast lookup by id. */
export const INTRO_BY_ID: Record<string, IntroCard> = Object.fromEntries(
  INTROS.map((c) => [c.id, c]),
);

/** Fail-secure parse of the persisted seen-set: keep only known intro ids. */
export function parseSeenIntros(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    if (!Array.isArray(v)) return [];
    return v.filter((x): x is string => typeof x === 'string' && x in INTRO_BY_ID);
  } catch {
    return [];
  }
}

export function hasSeenIntro(seen: readonly string[], id: string): boolean {
  return seen.includes(id);
}

/** Mark an intro seen (idempotent; no duplicates). */
export function markIntroSeen(seen: readonly string[], id: string): string[] {
  return seen.includes(id) ? [...seen] : [...seen, id];
}

/**
 * Decide what to do on first contact with `id`. An unknown id or an already-seen
 * one is a no-op (`card: null`, seen unchanged). Otherwise the intro is marked
 * seen and returned — UNLESS `veteran` is set, in which case it's marked seen
 * silently (`card: null`) so an experienced player is never nagged ("помечено
 * сразу"). Callers persist the returned `seen` and show `card` when present.
 */
export function resolveIntro(
  seen: readonly string[],
  id: string,
  opts: { veteran?: boolean } = {},
): { card: IntroCard | null; seen: string[] } {
  const card = INTRO_BY_ID[id];
  if (!card || hasSeenIntro(seen, id)) return { card: null, seen: [...seen] };
  return { card: opts.veteran ? null : card, seen: markIntroSeen(seen, id) };
}
