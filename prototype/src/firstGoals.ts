/**
 * ONB-7 · First-session goals — a light "am I playing right?" checklist for the
 * onboarding match. One short goal per chapter of the guided lesson (produce → research →
 * build → capture, then the operation: market → hero → militia → aviation → landing →
 * assault); each ticks from live game state, and finishing them all earns praise + a
 * nudge to play a real match (docs/onboarding-roadmap.md ONB-7, ONB-15).
 *
 * Pure module: no DOM, no game imports — `guideFlow.ts` derives the `GoalSignals` from
 * live state (against the match-start baseline) and this decides which goals are
 * met. Completion is monotonic (a met goal never un-ticks).
 */

export interface Goal {
  id: string;
  labelKey: string; // ключ локали, рендерится через t()
}

/** The first-session goals, in the order the guided match teaches them. */
export const FIRST_GOALS = [
  { id: 'mine', labelKey: 'onb.goal.mine' },
  { id: 'research', labelKey: 'onb.goal.research' },
  { id: 'fleet', labelKey: 'onb.goal.fleet' },
  { id: 'capture', labelKey: 'onb.goal.capture' },
  { id: 'market', labelKey: 'onb.goal.market' },
  { id: 'hero', labelKey: 'onb.goal.hero' },
  { id: 'ground', labelKey: 'onb.goal.ground' },
  { id: 'aviation', labelKey: 'onb.goal.aviation' },
  { id: 'landing', labelKey: 'onb.goal.landing' },
  { id: 'assault', labelKey: 'onb.goal.assault' },
] as const satisfies readonly Goal[];

export type GoalId = (typeof FIRST_GOALS)[number]['id'];

/**
 * Live progress per goal, measured against the onboarding match's start baseline. The
 * homeworld starts with a level-1 Mine (matchSetup.ts), so `mine` tracks its output
 * growing, not a fresh instance; `fleet`/`capture` count beyond the start, and `ground`
 * counts militia at home plus aboard, so loading them does not un-train them.
 */
export type GoalSignals = Record<GoalId, boolean>;

/** Which goal ids are currently satisfied by the signals. */
export function metGoals(sig: GoalSignals): Set<string> {
  return new Set(FIRST_GOALS.filter((g) => sig[g.id]).map((g) => g.id));
}

/** Fold newly-met goals into the done-set (monotonic — order preserved). */
export function mergeDone(prev: readonly string[], met: ReadonlySet<string>): string[] {
  const out = [...prev];
  for (const g of FIRST_GOALS) if (met.has(g.id) && !out.includes(g.id)) out.push(g.id);
  return out;
}

/** Every goal achieved. */
export function goalsComplete(done: readonly string[]): boolean {
  return FIRST_GOALS.every((g) => done.includes(g.id));
}
