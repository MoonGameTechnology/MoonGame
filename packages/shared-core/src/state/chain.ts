/**
 * CC-1 fleet order queue (command chains) — the chain step vocabulary, the fleet's
 * queued plan shape, and the payload validator. Port of the prototype's
 * `chain.ts` (REFP-8's extraction), carrying the full step vocabulary —
 * `move`/`wait`/`assault`/`barrage`/`strike`/`ability` — in lockstep with the gate
 * schema (`order.chain` in `actions/payloadSchemas.ts`). The `ability` kind was
 * initially left out of this port ("no matching schema entry yet"), which silently
 * diverged the three copies: solo accepted the step, a gated server rejected the
 * whole plan with E_BAD_PAYLOAD. **CONV-7 removed the prototype's copy** — that
 * particular drift can no longer happen; the vocabulary here and the gate schema
 * still have to be kept in sync with each other. A state utility (not a
 * `GameModule`) — `standingOrders.ts` and any future chain-driver both need this
 * shape without importing each other (invariant #3).
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
 *  standoff fire for `hours` game-hours, then cease and move on; `ability` — the
 *  fleet's hero casts `abilityId` once the fleet is free (`target` — a world for
 *  ranged casts; the `hero.ability` handler re-gates everything). A step runs
 *  when the fleet is free, so "arrive then open fire" = [move, barrage] and a
 *  waypoint route is just several move steps. */
export type ChainStep =
  | { kind: 'move'; to: string }
  | { kind: 'wait'; hours: number }
  | { kind: 'assault' }
  | { kind: 'barrage'; target: string | null }
  | { kind: 'strike'; target: string | null; hours: number }
  | { kind: 'ability'; abilityId: string; target?: string | null };

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
 *  smuggled extra keys into state (A08). null = garbage → E_BAD_PAYLOAD.
 *  `abilities` — the hero-ability catalog (`ctx.data.heroAbilities`): an `ability`
 *  step must name a real ability, like `move` must name a real world. */
export function validateChainSteps(
  raw: unknown,
  state: Pick<GameState, 'planets'>,
  abilities: Record<string, unknown>,
): ChainStep[] | null {
  if (!Array.isArray(raw) || raw.length > MAX_CHAIN_STEPS) return null;
  const out: ChainStep[] = [];
  for (const item of raw) {
    const step = item as {
      kind?: unknown;
      to?: unknown;
      hours?: unknown;
      target?: unknown;
      abilityId?: unknown;
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
    } else if (step.kind === 'ability') {
      // The ability must exist in the catalog (like `move` checks the world); the
      // `hero.ability` handler re-gates ownership/liveness/equipment/range/cost.
      // `target` — optional world for ranged casts. Mirrors the prototype validator.
      if (typeof step.abilityId !== 'string' || !abilities[step.abilityId]) return null;
      if (step.target !== null && step.target !== undefined && typeof step.target !== 'string') {
        return null;
      }
      out.push({
        kind: 'ability',
        abilityId: step.abilityId,
        ...(typeof step.target === 'string' ? { target: step.target } : {}),
      });
    } else {
      return null;
    }
  }
  return out;
}
