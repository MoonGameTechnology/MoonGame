/**
 * CC-1 fleet order queue (command chains) — the chain step vocabulary, the fleet's
 * queued plan shape, and the payload validator. Port of the prototype's
 * `prototype/src/chain.ts` (REFP-8's extraction), trimmed to the step kinds the
 * canonical gate schema (`order.chain` in `actions/payloadSchemas.ts`) actually
 * accepts — `move`/`wait`/`assault`/`barrage`/`strike`; the prototype's `ability`
 * kind has no matching schema entry yet, so it stays out of this port. A state
 * utility (not a `GameModule`) — `standingOrders.ts` and any future chain-driver
 * both need this shape without importing each other (invariant #3).
 */
import type { Fleet, GameState } from './gameState';

/** A fleet may run its next queued step only when idle — not in transit, not locked in
 *  a battle. (A fleet parked on a lane counts as idle; its next move routes from there.) */
export function fleetIdle(fleet: Fleet): boolean {
  return !fleet.movement && !fleet.battleId;
}

/** One CC-1 chain step. `move` — fly to a world; `wait` — hold N game-hours;
 *  `assault` — storm the world under the fleet; `barrage` — focus artillery
 *  standoff fire (null = nearest hostile); `strike` — a fire window: focus
 *  standoff fire for `hours` game-hours, then cease and move on. A step runs
 *  when the fleet is free, so "arrive then open fire" = [move, barrage] and a
 *  waypoint route is just several move steps. */
export type ChainStep =
  | { kind: 'move'; to: string }
  | { kind: 'wait'; hours: number }
  | { kind: 'assault' }
  | { kind: 'barrage'; target: string | null }
  | { kind: 'strike'; target: string | null; hours: number };

/** A fleet's queued chain: the remaining steps + the deadline of the ARMED head
 *  `wait` step (stamped by the driver; absent while the head is not a ticking wait). */
export interface FleetChain {
  steps: ChainStep[];
  waitUntil?: number;
}
export const MAX_CHAIN_STEPS = 8;
/** One wait is capped at 14 game-days — enough for any real plan, too short to
 *  park garbage in state forever. */
export const MAX_CHAIN_WAIT_HOURS = 24 * 14;

/** Rebuild chain steps from a raw payload: only known kinds, only known worlds, no
 *  smuggled extra keys into state (A08). null = garbage → E_BAD_PAYLOAD. */
export function validateChainSteps(
  raw: unknown,
  state: Pick<GameState, 'planets'>,
): ChainStep[] | null {
  if (!Array.isArray(raw) || raw.length > MAX_CHAIN_STEPS) return null;
  const out: ChainStep[] = [];
  for (const item of raw) {
    const step = item as {
      kind?: unknown;
      to?: unknown;
      hours?: unknown;
      target?: unknown;
    } | null;
    if (!step || typeof step !== 'object') return null;
    if (step.kind === 'move') {
      if (typeof step.to !== 'string' || !state.planets[step.to]) return null;
      out.push({ kind: 'move', to: step.to });
    } else if (step.kind === 'wait') {
      const h = step.hours;
      if (typeof h !== 'number' || !Number.isFinite(h) || h <= 0 || h > MAX_CHAIN_WAIT_HOURS) {
        return null;
      }
      out.push({ kind: 'wait', hours: h });
    } else if (step.kind === 'assault') {
      out.push({ kind: 'assault' });
    } else if (step.kind === 'barrage') {
      if (step.target !== null && step.target !== undefined && typeof step.target !== 'string') {
        return null;
      }
      out.push({ kind: 'barrage', target: typeof step.target === 'string' ? step.target : null });
    } else if (step.kind === 'strike') {
      if (step.target !== null && step.target !== undefined && typeof step.target !== 'string') {
        return null;
      }
      const h = step.hours;
      if (typeof h !== 'number' || !Number.isFinite(h) || h <= 0 || h > MAX_CHAIN_WAIT_HOURS) {
        return null;
      }
      out.push({
        kind: 'strike',
        target: typeof step.target === 'string' ? step.target : null,
        hours: h,
      });
    } else {
      return null;
    }
  }
  return out;
}
