/**
 * The bot favour ledger on the wire — what a viewer may see of it and how a full copy
 * is put back together. The scale itself (`FAVOUR_*`, `botFavour`, `botEmbargoes`) is a
 * rule of the world and lives in shared-core (`state/botFavour.ts`, SLIM-4).
 */

import type { ApprovalLedger, GameState } from '../../packages/shared-core/src/index';

/** Minimal view of the state extension for the approval meter. */
interface ApprovalState extends GameState {
  approval?: ApprovalLedger;
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
