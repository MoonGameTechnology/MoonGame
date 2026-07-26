/**
 * CC-1 fleet order queue (command chains) — the chain step vocabulary, the fleet's
 * queued plan shape, and the payload validator. Extracted from `game.ts` (REFP-8):
 * pure functions over `Fleet`/`GameState`/`data`, no other game.ts deps. The chain
 * driver (consumes head / arms wait) stays in `game.ts` (REFP-24). `game.ts`
 * re-exports the public surface for `main.ts` / `orderchain.test.ts`.
 */
import type { Fleet, GameState } from '../../packages/shared-core/src/index';
import { data } from './prototypeData';

/** A fleet may run its next queued step only when idle — not in transit, not locked in
 *  a battle. (A fleet parked on a lane counts as idle; its next move routes from there.) */
export function fleetIdle(fleet: Fleet): boolean {
  return !fleet.movement && !fleet.battleId;
}

/** One CC-1 chain step. `move` — fly to a world; `wait` — hold N game-hours
 *  (Задержка); `assault` — storm the world under the fleet (entering orbit first if
 *  needed); `barrage` — focus artillery standoff fire (null = nearest hostile);
 *  `ability` — the hero commanding the fleet casts a skill (HERO-4).
 *  A step runs when the fleet is FREE, so «прийти и открыть огонь» = [move, barrage]
 *  and «дойти и открыть Коридор» = [move, ability] — a waypoint route (Точка+) is
 *  just several move steps. */
export type ChainStep =
  | { kind: 'move'; to: string }
  | { kind: 'wait'; hours: number }
  | { kind: 'assault' }
  | { kind: 'barrage'; target: string | null }
  // A FIRE WINDOW: focus artillery standoff fire (null = auto-target) for `hours`
  // game-hours, then cease and move on. Artillery damage is continuous
  // (`power × hours`, artillery.ts) — hours ARE the honest count of «ударов».
  | { kind: 'strike'; target: string | null; hours: number }
  // A HERO ABILITY (HERO-4) cast as a step: the fleet's hero casts `abilityId` when
  // the fleet is free (`target` — a world for ranged casts). The core `hero.ability`
  // re-gates everything; the driver holds only while the ability is on cooldown.
  | { kind: 'ability'; abilityId: string; target?: string | null };
/** A fleet's queued chain: the remaining steps + the deadline of the ARMED head
 *  `wait` step (stamped by the driver; absent while the head is not a ticking wait). */
export interface FleetChain {
  steps: ChainStep[];
  waitUntil?: number;
}
export const MAX_CHAIN_STEPS = 8;
/** One Задержка is capped at 14 game-days — enough for any real plan, too short to
 *  park garbage in state forever. */
export const MAX_CHAIN_WAIT_HOURS = 24 * 14;

/** Rebuild chain steps from a raw payload: only known kinds, only known worlds, no
 *  smuggled extra keys into state (A08). null = garbage → E_BAD_PAYLOAD. */
export function validateChainSteps(raw: unknown, state: GameState): ChainStep[] | null {
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
      // The ability must exist in the catalog (like `move` checks the world); the core
      // re-checks the fleet's hero actually carries it. `target` — optional world (ranged).
      if (typeof step.abilityId !== 'string' || !data.heroAbilities[step.abilityId]) return null;
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