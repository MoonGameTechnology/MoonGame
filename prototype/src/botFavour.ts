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

export { approvalView } from '../../packages/shared-core/src/index';

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
