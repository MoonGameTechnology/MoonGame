/**
 * Spy experience and levels (owner's resolution 2026-11-10). A spy earns experience
 * points (`Spy.xp`, multiples of 0.25) and reaches level 1, 2 and 3 — the ticks on its
 * portrait. Each level needs NEW points on top of the previous one: 1, then 2 more, then
 * 4 more, so the totals are 1 / 3 / 7. A recruit starts at 0; a killed or turned spy takes
 * its experience with it.
 *
 * Pure numbers only: the espionage modules award the points and apply the bonuses.
 */

/** Points each level needs on top of the previous one. */
export const SPY_LEVEL_STEPS: readonly number[] = [1, 2, 4];
/** Total points at which levels 1, 2, 3 are reached: 1, 3, 7. */
export const SPY_LEVEL_THRESHOLDS: readonly number[] = SPY_LEVEL_STEPS.map((_, i) =>
  SPY_LEVEL_STEPS.slice(0, i + 1).reduce((a, b) => a + b, 0),
);
export const SPY_MAX_LEVEL = SPY_LEVEL_STEPS.length;

export type SpyLevel = 0 | 1 | 2 | 3;

/** What each deed is worth, in points. */
export const SPY_XP = {
  /** Counter-intelligence caught a hostile spy who got away alive. */
  catch: 0.5,
  /** Counter-intelligence's catch was killed. */
  kill: 1,
  /** Counter-intelligence's catch was turned. */
  turn: 1.25,
  /** A successful theft, research theft, sabotage, queue delay or economic disruption. */
  deed: 1,
  /** Every completed `SPY_RECON_XP_HOURS` a recon spy survives on post; an unfinished
   *  span cut short by capture or recall earns nothing, an earned step is never lost. */
  reconStep: 0.25,
} as const;
/** How long a recon spy stays on post for one `SPY_XP.reconStep`, game-hours. */
export const SPY_RECON_XP_HOURS = 24;

/** The level `xp` points reach (0–3). Broken input (NaN, negative) is level 0. */
export function spyLevel(xp: number | undefined): SpyLevel {
  if (xp === undefined || !Number.isFinite(xp)) return 0;
  let level = 0;
  for (const t of SPY_LEVEL_THRESHOLDS) if (xp >= t) level++;
  return level as SpyLevel;
}

/** What one level adds (owner's resolution 2026-11-10; tune after playtests). */
export const SPY_LEVEL_BONUS = {
  /** To the mission's success chance. */
  chance: 0.05,
  /** Taken off the odds the spy is detected. */
  detect: 0.05,
  /** To the mission's quality: theft share and cap, sabotage damage, delay hours, recon
   *  digging pace, a guard's odds to catch a hostile guard. */
  quality: 0.1,
  /** To the travel speed between worlds. */
  speed: 0.1,
} as const;

/** The bonus of `kind` a spy of `level` carries. */
export function spyLevelBonus(kind: keyof typeof SPY_LEVEL_BONUS, level: number): number {
  const l = Math.min(SPY_MAX_LEVEL, Math.max(0, Math.floor(Number.isFinite(level) ? level : 0)));
  return SPY_LEVEL_BONUS[kind] * l;
}

/**
 * Split `total` points between the guards who made one catch (owner's resolution
 * 2026-11-10): the guards are ranked by experience (most first; a tie keeps the input
 * order, which the caller makes deterministic), the n-th of N weighs N−n+1, each share is
 * rounded DOWN to 0.25 and the rest goes to the most experienced — experience must not
 * come easily to recruits riding on veterans' work. Returns the points per guard in the
 * INPUT order. Counted in quarters, so no float drift.
 */
export function splitGuardXp(total: number, guardXp: readonly number[]): number[] {
  const n = guardXp.length;
  if (n === 0) return [];
  const quarters = Math.round(total * 4);
  const rank = guardXp
    .map((_, i) => i)
    .sort((a, b) => (guardXp[b] ?? 0) - (guardXp[a] ?? 0) || a - b);
  const weightSum = (n * (n + 1)) / 2;
  const out = new Array<number>(n).fill(0);
  let given = 0;
  rank.forEach((guard, place) => {
    const q = Math.floor((quarters * (n - place)) / weightSum);
    out[guard] = q;
    given += q;
  });
  const top = rank[0]!;
  out[top] = (out[top] ?? 0) + quarters - given;
  return out.map((q) => q / 4);
}
