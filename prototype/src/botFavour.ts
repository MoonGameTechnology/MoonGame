/**
 * Bot favour (approval) scale — a bot's opinion of each other seat on a 0..100
 * meter, seeded neutral-friendly. Extracted from `game.ts` (REFP-6): pure functions
 * over `GameState` reading the prototype's `approval` extension field. `game.ts`
 * re-exports the constants and functions for `main.ts` / `botdiplomacy.test.ts`.
 */

import type { GameState } from '../../packages/shared-core/src/index';

/** Every bot's favour toward each other seat: `ledger[bot][seat]`. */
export type ApprovalLedger = Record<string, Record<string, number>>;

/** Minimal view of the prototype's state extension for the approval meter. */
interface ApprovalState extends GameState {
  approval?: ApprovalLedger;
}

export const FAVOUR_BASE = 60; // starting favour toward every seat
export const FAVOUR_EMBARGO = 35; // below → the bot embargoes you on the market (future)
export const FAVOUR_WAR = 15; // below → the bot itself declares war (the extreme case)
// = FAVOUR_WAR: a bot too calm to start a war won't refuse to end one. One war
// declaration (60→30) leaves a ~3-day window to sue for peace before war decay
// (5/day) drops the meter below the line — then the bot fights to the end.
export const FAVOUR_PEACE_ACCEPT = 15;
export const FAVOUR_PACT_ACCEPT = 55; // an offered PACT needs real goodwill
export const FAVOUR_WAR_DECLARED_HIT = 30; // drop when a seat declares WAR on the bot
export const FAVOUR_SPY_CAUGHT_HIT = 20; // drop when the bot catches that seat's spy red-handed
export const FAVOUR_WAR_DECAY_PER_DAY = 5; // sustained war keeps eroding favour
export const FAVOUR_HEAL_PER_DAY = 6; // peace slowly mends it back toward FAVOUR_BASE

/** A bot's favour toward `player` (FAVOUR_BASE if untracked / not a bot). */
export function botFavour(state: GameState, bot: string, player: string): number {
  return (state as ApprovalState).approval?.[bot]?.[player] ?? FAVOUR_BASE;
}
/** Does `bot` embargo `player` on the market (favour below the embargo line)? */
export function botEmbargoes(state: GameState, bot: string, player: string): boolean {
  return (
    (state as ApprovalState).approval?.[bot] !== undefined &&
    botFavour(state, bot, player) < FAVOUR_EMBARGO
  );
}

/**
 * The favour ledger as `viewer` may see it: every bot's opinion of the VIEWER, nothing
 * else. That is all a client reads (`botFavour(state, bot, ME)` in the favour bar, and the
 * market embargo check when the viewer takes a bot's order); how a bot regards everyone
 * else is the bot's private state. It also moves every second — war decay runs per span, and
 * neutrals are at war with pirates from the first minute — so the whole matrix, riding
 * every snapshot as one host key, cost each player the full table per second.
 *
 * `botFavour` and `botEmbargoes` answer the same for the viewer on the narrowed view as
 * on the full state. Pure: the input is left untouched; no ledger ⇒ the same object.
 */
export function approvalView(view: GameState, viewer: string): GameState {
  const { approval, ...rest } = view as ApprovalState;
  if (approval === undefined) return view;
  const mine: Record<string, Record<string, number>> = {};
  for (const [bot, meter] of Object.entries(approval)) {
    const favour = meter[viewer];
    if (favour !== undefined) mine[bot] = { [viewer]: favour };
  }
  // An empty ledger is dropped, not shipped as `{}` — the same delta hygiene the core
  // projection keeps for its per-viewer maps.
  return (Object.keys(mine).length > 0 ? { ...rest, approval: mine } : rest) as GameState;
}

/** The ledger riding in `state`; `undefined` — no bot tracks favour. */
export function approvalLedger(state: GameState): ApprovalLedger | undefined {
  return (state as ApprovalState).approval;
}

/**
 * The inverse of {@link approvalView}: the whole ledger back under a narrowed view, for a
 * copy that must stand for the full world (a save, or the screen taking the world over).
 * Every bot's opinion of the viewer comes from `view`, which is fresh; the rest from
 * `ledger`, an earlier full copy. A seat eliminated in between leaves the table the way
 * `player.eliminated` sweeps it: its own meter and every bot's opinion of it (BF-33).
 *
 * Pure: the inputs are left untouched; no full ledger ⇒ the same object.
 */
export function fullApproval(view: GameState, ledger: ApprovalLedger | undefined): GameState {
  if (ledger === undefined) return view;
  const mine = approvalLedger(view);
  const gone = (id: string): boolean => view.players[id]?.status === 'defeated';
  const approval: ApprovalLedger = {};
  for (const [bot, meter] of Object.entries(ledger)) {
    if (gone(bot)) continue;
    const row: Record<string, number> = {};
    for (const [seat, favour] of Object.entries(meter)) if (!gone(seat)) row[seat] = favour;
    approval[bot] = { ...row, ...mine?.[bot] };
  }
  return { ...view, approval } as GameState;
}
