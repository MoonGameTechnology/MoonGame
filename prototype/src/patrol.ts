/**
 * Squadron patrol (squadrons-roadmap SQ-4.1) — the pure reactive-scramble decision
 * core: a wing left on patrol auto-strikes an enemy that enters its radius, burning
 * a sortie (SQ-2.1) each time; when it runs dry it rearms and then resumes — no live
 * player in the moment, fully deterministic. Extracted from `game.ts` (REFP-23):
 * depends on `SortieState`/`canSortie`/`spendSortie`/`withinRange` (`squadron.ts`,
 * REFP-7) and `engageFleet`/`moveFleet` (`actions.ts`, REFP-22). The frame-loop
 * driver (`main.ts`, mirrors `autoEngage`/`driveQueues`) issues the strike order,
 * burns the sortie, and ticks the rearm on a game-hour cadence; the server-side
 * driver (`serverPatrolActions`, REFP-24) does the same for NET matches.
 * `game.ts` imports this for the server driver and re-exports for `main.ts` / tests.
 */
import { canSortie, spendSortie, withinRange, type SortieState } from './squadron';
import { engageFleet, moveFleet } from './actions';
import type { Action, Fleet } from '../../packages/shared-core/src/index';

/** A standing patrol: guard `center` out to `radius` with the wing's sortie budget. */
export interface Patrol {
  center: { x: number; y: number };
  radius: number;
  sortie: SortieState;
}

/** The contact this patrol strikes this round: the lowest-id enemy inside the radius,
 *  and only while the wing is flight-ready (fuel left, not rearming). Stable tie-break by
 *  id — the same rule orbital AA / lane intercept use. Pure; null = hold fire. */
export function patrolTarget(
  patrol: Patrol,
  enemies: Array<{ id: string; pos: { x: number; y: number } }>,
): string | null {
  if (!canSortie(patrol.sortie)) return null;
  let best: string | null = null;
  for (const e of enemies) {
    if (withinRange(patrol.center, e.pos, patrol.radius) && (best === null || e.id < best)) {
      best = e.id;
    }
  }
  return best;
}

/** One reactive-scramble tick for a patrolling wing (CC-4 — "auto-sortie at an identified
 *  target in vision + range"): pick the in-range contact (SQ-4.1) and launch at it — engage
 *  if co-located, else fly to intercept its node — burning one fuel (SQ-2.1). `targets` are
 *  the pre-filtered hostile, identified contacts that are sitting on a node. Returns the
 *  order to issue (null = hold fire) plus the wing's new sortie state. Pure — the driver
 *  gathers the world (vision + diplomacy) and issues the order. */
export function scrambleOrder(
  me: string,
  fleet: Fleet,
  patrol: Patrol,
  targets: Array<{ id: string; location: string; pos: { x: number; y: number } }>,
  rearmRounds: number,
): { action: Action | null; sortie: SortieState } {
  const pick = patrolTarget(patrol, targets);
  if (pick === null) return { action: null, sortie: patrol.sortie };
  const foe = targets.find((t) => t.id === pick)!;
  const action =
    fleet.location === foe.location
      ? engageFleet(me, fleet.id, foe.id)
      : moveFleet(me, fleet.id, foe.location);
  return { action, sortie: spendSortie(patrol.sortie, rearmRounds) };
}
