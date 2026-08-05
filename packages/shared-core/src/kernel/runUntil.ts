import type { AdvanceFailure, Context, DomainEvent } from '../action/types';
import type { GameState } from '../state/gameState';
import type { Kernel } from './kernel';

/**
 * AUD-5 — chain partial advances until the world clock reaches `ctx.now`.
 *
 * `advanceTo` may return `partial: true`: it stopped early (an event budget, a batch
 * boundary) without reaching the target instant. Every caller that wants "bring the
 * world to now" therefore has to LOOP — and every caller also has to notice the one
 * pathological case, a partial round that moved the clock nowhere, which means a
 * same-instant runaway and would spin forever.
 *
 * That loop was hand-written in three places (`replay.ts`, `MatchRoom.computeAdvance`,
 * the prototype's `protoKernel.advance`), and each new harness wrote a fourth. This is
 * the single copy.
 *
 * Deliberately a plain function over the public `Kernel`, not a kernel method: the
 * kernel's two entry points are the deterministic contract (`docs/architecture.md`),
 * and a convenience wrapper does not belong inside it.
 */

export interface RunUntilOptions {
  /** Cap on partial rounds. Omitted → unbounded, stopped only by the no-progress
   *  guard; that is what `replay.ts` has always done. `MatchRoom` supplies its own. */
  maxChunks?: number;
}

export type RunUntilResult =
  | { ok: true; state: GameState; events: DomainEvent[]; failures: AdvanceFailure[] }
  /** `code` is either the code `advanceTo` refused with, or one of the two below. */
  | { ok: false; code: string };

/** A partial round that left the clock where it was — the world would never reach the
 *  target, so spinning is refused instead of hanging the caller. */
export const E_ADVANCE_STUCK = 'E_ADVANCE_STUCK';
/** `maxChunks` exhausted while still partial (only reachable when a cap was given). */
export const E_ADVANCE_BUDGET = 'E_ADVANCE_BUDGET';

export function runUntil(
  kernel: Kernel,
  state: GameState,
  ctx: Context,
  opts: RunUntilOptions = {},
): RunUntilResult {
  const events: DomainEvent[] = [];
  const failures: AdvanceFailure[] = [];
  let current = state;
  let chunks = 0;

  while (current.time < ctx.now) {
    if (opts.maxChunks !== undefined && chunks >= opts.maxChunks) {
      return { ok: false, code: E_ADVANCE_BUDGET };
    }
    chunks += 1;

    const before = current.time;
    const advanced = kernel.advanceTo(current, ctx);
    if (!advanced.ok) return { ok: false, code: advanced.code };

    current = advanced.state;
    events.push(...advanced.events);
    failures.push(...advanced.failures);

    if (!advanced.partial) break; // reached `ctx.now`
    if (current.time === before) return { ok: false, code: E_ADVANCE_STUCK };
  }

  return { ok: true, state: current, events, failures };
}
