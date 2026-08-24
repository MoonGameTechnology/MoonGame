/**
 * Squadron mechanics (squadrons-roadmap SQ-1.1/SQ-2.1/SQ-3.1) — the carrier-borne
 * strike wing's pure math: which stacks a fleet can launch, the sortie fuel/rearm
 * counter, and the strike-radius reach check. Was a 1:1 port of the prototype's
 * `squadron.ts` — no numbers or semantics changed; since CONV-6 that copy is gone and
 * this is the only one, called by both hosts with an explicit `data`. The prototype's
 * client-side wing predicates (`isWing`/`wingCanAct`/`wingCanReturn`, REFM-135) did NOT
 * come here — they decide what to offer the player, not what the world does, and live
 * in `/decisions/wingOrders.ts`. NOT wired into a `fleet.launch` action or any
 * kernel module yet: that needs new GameState shape (where a launched wing's
 * `SortieState` lives) and touches the action/reducer pipeline, a separate,
 * riskier pass. `patrolTarget`/`scrambleOrder` (the auto-scramble driver, CC-4)
 * live in the prototype's `game.ts`, not `squadron.ts` — out of scope here.
 */
import type { Fleet } from './gameState';
import type { GameData } from '../data/schemas';

/** The squadron-trait ship stacks aboard a fleet — what a carrier launches as a
 *  strike wing (SQ-1.1: launch-as-unit). Pure. */
export function squadronTake(
  fleet: Fleet,
  data: GameData,
): Array<{ unit: string; count: number }> {
  return fleet.units
    .filter((st) => st.count > 0 && (data.units[st.unit]?.traits.includes('squadron') ?? false))
    .map((st) => ({ unit: st.unit, count: st.count }));
}

/** A wing's sortie budget: `fuel` strikes left before rearm, `rearming` rounds left
 *  on the rearm cooldown (0 = flight-ready). */
export interface SortieState {
  fuel: number;
  rearming: number;
}

/** The wing's max sortie budget + rearm length, read from its squadron unit's
 *  stats (schema defaults 0). Reads the FIRST squadron-trait stack of the fleet. */
export function sortieSpec(
  fleet: Fleet,
  data: GameData,
): { maxFuel: number; rearmRounds: number } {
  const st = fleet.units.find(
    (s) => s.count > 0 && (data.units[s.unit]?.traits.includes('squadron') ?? false),
  );
  const u = st ? data.units[st.unit]?.stats : undefined;
  return {
    maxFuel: Math.max(0, Math.floor(u?.fuel ?? 0)),
    rearmRounds: Math.max(0, Math.floor(u?.rearmRounds ?? 0)),
  };
}

/** A fresh, fully-fuelled wing. */
export function freshSortie(maxFuel: number): SortieState {
  return { fuel: Math.max(0, Math.floor(maxFuel)), rearming: 0 };
}

/** Flight-ready = not mid-rearm and has fuel to burn. */
export function canSortie(s: SortieState): boolean {
  return s.rearming <= 0 && s.fuel > 0;
}

/** Burn one sortie. When the last of the fuel goes the wing drops onto a rearm
 *  cooldown of `rearmRounds` (unavailable until it counts back down). A spend
 *  while not flight-ready is a no-op — guard with canSortie first. */
export function spendSortie(s: SortieState, rearmRounds: number): SortieState {
  if (!canSortie(s)) return s;
  const fuel = s.fuel - 1;
  return fuel <= 0
    ? { fuel: 0, rearming: Math.max(1, Math.floor(rearmRounds)) }
    : { fuel, rearming: 0 };
}

/** Advance the rearm cooldown one round; when it elapses the wing refuels to max
 *  and is flight-ready again. A wing that isn't rearming is unchanged. */
export function tickRearm(s: SortieState, maxFuel: number): SortieState {
  if (s.rearming <= 0) return s;
  const rearming = s.rearming - 1;
  return rearming <= 0
    ? { fuel: Math.max(0, Math.floor(maxFuel)), rearming: 0 }
    : { fuel: s.fuel, rearming };
}

/** Does this fleet carry a launchable strike wing (squadron-trait ships)? */
export function fleetHasSquadron(f: Fleet | undefined, data: GameData): boolean {
  return (
    !!f &&
    f.units.some((u) => u.count > 0 && (data.units[u.unit]?.traits.includes('squadron') ?? false))
  );
}

/** The wing's strike radius (map units) — the longest `strikeRange` among its live
 *  squadron ships. 0 = carries no strike wing. */
export function squadronStrikeRange(fleet: Fleet, data: GameData): number {
  let r = 0;
  for (const st of fleet.units) {
    if (st.count > 0 && (data.units[st.unit]?.traits.includes('squadron') ?? false)) {
      r = Math.max(r, data.units[st.unit]?.stats.strikeRange ?? 0);
    }
  }
  return r;
}

/** Is `target` within `range` (Euclidean map units) of `from`? Boundary inclusive —
 *  a target sitting exactly on the radius edge is reachable. */
export function withinRange(
  from: { x: number; y: number },
  target: { x: number; y: number },
  range: number,
): boolean {
  const dx = target.x - from.x;
  const dy = target.y - from.y;
  return Math.sqrt(dx * dx + dy * dy) <= range;
}

/** Can the wing strike `targetPos` from its launch node at `fromPos`? Only a real
 *  strike wing (range > 0) whose target lies inside the radius (SQ-3.1). */
export function squadronReaches(
  fleet: Fleet,
  data: GameData,
  fromPos: { x: number; y: number },
  targetPos: { x: number; y: number },
): boolean {
  const r = squadronStrikeRange(fleet, data);
  return r > 0 && withinRange(fromPos, targetPos, r);
}
