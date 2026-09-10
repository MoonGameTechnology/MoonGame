import type { HandlerContext } from '../kernel/module';
import type { CombatantRef, Fleet, GameState, PlanetId, UnitStack } from '../state/gameState';
import type { GameData, UnitDef } from '../data/schemas';
import { cappedUnitStat } from './stacks';
import { effectiveStats } from './loadout';
import { getStance, type DiplomacyCapability } from '../state/diplomacy';

/**
 * Shared combat primitives — the damage model, combatant-side accessors,
 * hostility test and lane-occupancy math used by the combat family of modules
 * (`combat` melee battles, `orbital` AA/bombardment,
 * `intercept` lane crossings). A helper library, NOT a module: the modules stay
 * decoupled from each other (invariant #3) and share only these pure(ish)
 * functions, exactly like `util/fleet.ts` / `state/route.ts`.
 */

/** Stalemate safety valve: a battle is force-resolved (winner null) once its round
 *  counter EXCEEDS this — shared by the live combat module and the previewBattle
 *  forecast so the two can never drift apart. */
export const MAX_COMBAT_ROUNDS = 240;

export type Tier = 'front' | 'mid' | 'rear';
/** The lines bow to stern (GDD §7.2). Not a damage ORDER any more — every line
 *  present in the fight is hit in the same volley; the order decides only which
 *  line rounds UP when an absent line's share is split (see {@link lineShares}).
 *
 *  ROS-2.1 dropped a fourth line that a since-removed trait carried; every hull
 *  now states its own line and there is no exception to it. */
export const TIER_ORDER: readonly Tier[] = ['front', 'mid', 'rear'];

/** Share of an incoming volley each line takes, in whole percent (sums to 100).
 *  A line with no live ship takes nothing and its share is split across the lines
 *  that ARE present. Balance constants (like COMBAT_UNIT_CAP) — data after shakeout.
 *
 *  50/30/20 since ROS-2.1: the old 40/30/20/10 only summed to 100 together with a
 *  fourth line, so dropping that line had to redistribute its ten percent. */
export const LINE_SHARE: Readonly<Record<Tier, number>> = {
  front: 50,
  mid: 30,
  rear: 20,
};

/**
 * Which line a unit takes its damage in.
 *
 * Lines are a SHIP formation: a ground assault is one body of troops, so every
 * ground unit shares the front line and the whole volley lands on it — the split
 * below can never carve up an army.
 *
 * No hull overrides its line: `def.line` is the whole rule.
 */
export function unitTier(def: UnitDef): Tier {
  if (def.domain === 'ground') {
    return 'front';
  }
  return def.line;
}

/**
 * How a volley splits across the lines that are actually in the fight, in whole
 * percent summing to exactly 100 (GDD §7.2).
 *
 * Base split is {@link LINE_SHARE}; an ABSENT line takes nothing and its percent
 * is divided EVENLY among the present ones. When that division is not whole, the
 * odd percent goes to the more forward lines (bow rounds up, stern rounds down) —
 * so an even split of a missing line's 20% is 60/40, never 61/39.
 * One line alone therefore always takes 100%.
 *
 * `present` need not be sorted: the result is read off {@link TIER_ORDER}, so the
 * split is a pure function of WHICH lines are in the fight, never of stack order.
 */
export function lineShares(present: readonly Tier[]): Record<Tier, number> {
  const out: Record<Tier, number> = { front: 0, mid: 0, rear: 0 };
  const lines = TIER_ORDER.filter((tier) => present.includes(tier));
  if (lines.length === 0) {
    return out;
  }
  let orphaned = 100;
  for (const tier of lines) {
    orphaned -= LINE_SHARE[tier];
  }
  const each = Math.floor(orphaned / lines.length);
  let odd = orphaned - each * lines.length;
  for (const tier of lines) {
    out[tier] = LINE_SHARE[tier] + each + (odd > 0 ? 1 : 0);
    if (odd > 0) {
      odd -= 1;
    }
  }
  return out;
}

// --- combatant side access (ships / landing troops / planet garrison) --------

export function sideUnits(state: GameState, ref: CombatantRef): UnitStack[] | null {
  switch (ref.kind) {
    case 'fleet':
      return state.fleets[ref.fleetId]?.units ?? null;
    case 'landing': {
      const f = state.fleets[ref.fleetId];
      return f ? (f.landing ?? []) : null;
    }
    // ROS-1.5: плацдарм — тот же десант, только держит его МИР, а не флот.
    case 'beachhead':
      return state.planets[ref.planetId]?.beachhead?.units ?? null;
    case 'garrison':
      return state.planets[ref.planetId]?.garrison ?? null;
  }
}

export function setSideUnits(state: GameState, ref: CombatantRef, units: UnitStack[]): void {
  switch (ref.kind) {
    case 'fleet': {
      const f = state.fleets[ref.fleetId];
      if (f) f.units = units;
      return;
    }
    case 'landing': {
      const f = state.fleets[ref.fleetId];
      if (f) f.landing = units;
      return;
    }
    case 'beachhead': {
      const beachhead = state.planets[ref.planetId]?.beachhead;
      if (beachhead) beachhead.units = units;
      return;
    }
    case 'garrison': {
      const p = state.planets[ref.planetId];
      if (p) p.garrison = units;
      return;
    }
  }
}

export function sideAlive(state: GameState, ref: CombatantRef): boolean {
  const units = sideUnits(state, ref);
  return !!units && units.some((s) => s.count > 0);
}

/**
 * Damage a side deals in one round = Σ count × stat over at most COMBAT_UNIT_CAP
 * units — the strongest guns form the firing line, everyone behind them only
 * soaks (Bytro line cap; the receiving hull pools stay whole-stack). The
 * aggressor uses its `attack` stat; a standing fleet that is attacked (the
 * defender) answers with its `defense` stat only — the return-fire mechanic.
 */
export function sideDamage(
  state: GameState,
  ref: CombatantRef,
  data: GameData,
  stat: 'attack' | 'defense',
): number {
  const units = sideUnits(state, ref);
  return units ? cappedUnitStat(units, data, stat) : 0;
}

/**
 * ALLY-LAND. Союзники ли `a` и `b` — та же дорога, что у {@link isHostile}, только про
 * другой конец шкалы: спрашиваем capability `diplomacy` (D2 владеет проекцией
 * стойка→отношение), а без модуля дипломатии честно читаем D1. Себе игрок не союзник:
 * «свой мир» — отдельное условие у каждого вызывающего, и путать их нельзя.
 *
 * В этой модели `alliance` — это И коалиция (`victory.ts` считает коалицией именно
 * взаимно-союзную клику), И обмен картами (`coverageFor` пулит разведку только по
 * `alliance`). `pact`/`peace` не делят ни того, ни другого, поэтому союзником здесь
 * считается ровно `alliance`.
 */
export function isAllied(h: HandlerContext, a: string, b: string): boolean {
  if (a === b) {
    return false;
  }
  const diplomacy = h.capability<DiplomacyCapability>('diplomacy');
  if (diplomacy) {
    return diplomacy.getRelation(h.state, a, b) === 'ally';
  }
  return getStance(h.state, a, b) === 'alliance';
}

export function isHostile(h: HandlerContext, a: string, b: string): boolean {
  if (a === b) {
    return false;
  }
  // The `diplomacy` capability (D2) owns the stance→relation projection; consult
  // it when a diplomacy module is present. Without one, fall back to the D1 read:
  // only an explicit `war` stance is hostile, and the default for an unrecorded
  // pair is `war` (FFA) — the capability's base mapping matches, so behaviour is
  // identical either way (graceful degradation, invariant #3).
  const diplomacy = h.capability<DiplomacyCapability>('diplomacy');
  if (diplomacy) {
    return diplomacy.getRelation(h.state, a, b) === 'hostile';
  }
  return getStance(h.state, a, b) === 'war';
}

// --- damage ------------------------------------------------------------------

/** THE one copy of the damage model's hull accounting, shared with the battle
 *  forecast (`previewBattle`'s `hullPool`): per-ship hull floors at 1 (a
 *  zero-hp def still takes a hit to die), a stack's current pool is its
 *  residual `hp` or full `count × perShip`. Change it here and the live model
 *  and the forecast's denominator move together — they must never drift. */
export function stackHull(
  stack: UnitStack,
  effHp: number | undefined,
): { perShip: number; pool: number } {
  const perShip = effHp !== undefined && effHp > 0 ? effHp : 1;
  return { perShip, pool: stack.hp ?? stack.count * perShip };
}

/**
 * Damage ONE line: spends `amount` on the line's stacks (sorted by unit id, so
 * the order is data-driven and not stack order) and RETURNS what the line could
 * not absorb. Each stack's remaining HP pool is tracked so partial damage
 * persists across rounds; whole ships/troops are lost as the pool drops.
 */
function damageLine(
  units: UnitStack[],
  tier: Tier,
  amount: number,
  data: GameData,
  deaths: { unit: string; count: number }[],
): number {
  let remaining = amount;
  const stacks = units
    .filter((s) => {
      if (!isTargetable(s, data)) {
        return false;
      }
      const def = data.units[s.unit];
      return def ? unitTier(def) === tier : false;
    })
    .sort((a, b) => (a.unit < b.unit ? -1 : a.unit > b.unit ? 1 : 0));

  for (const stack of stacks) {
    if (remaining <= 0) {
      break;
    }
    const def = data.units[stack.unit];
    if (!def) {
      continue;
    }
    const eff = effectiveStats(def, stack, data);
    const { perShip, pool: startPool } = stackHull(stack, eff.hp);

    // Ablative shield absorbs first (shields-roadmap SH-0.2); only the overflow
    // reaches the hull. A shield never kills — a ship dies only when its hull hits 0.
    const shieldPerShip = eff.shield ?? 0;
    if (shieldPerShip > 0) {
      let shield = stack.shieldHp ?? stack.count * shieldPerShip;
      const shieldAbsorbed = Math.min(remaining, shield);
      shield -= shieldAbsorbed;
      remaining -= shieldAbsorbed;
      stack.shieldHp = shield;
      if (remaining <= 0) {
        continue; // shield soaked it all — hull untouched
      }
    }

    let pool = startPool;
    const absorbed = Math.min(remaining, pool);
    pool -= absorbed;
    remaining -= absorbed;

    const newCount = pool <= 0 ? 0 : Math.ceil(pool / perShip);
    const lost = stack.count - newCount;
    if (lost > 0) {
      deaths.push({ unit: stack.unit, count: lost });
    }
    stack.count = newCount;
    stack.hp = newCount > 0 ? pool : 0;
    // Dead ships take their shields with them: cap the pool at surviving capacity.
    if (shieldPerShip > 0) {
      stack.shieldHp = newCount > 0 ? Math.min(stack.shieldHp ?? 0, newCount * shieldPerShip) : 0;
    }
  }
  return remaining;
}

/** Can this stack be hit by the volley being distributed? Everything alive can:
 *  no hull is exempt from a volley aimed at its side. */
function isTargetable(stack: UnitStack, data: GameData): boolean {
  return stack.count > 0 && !!data.units[stack.unit];
}

/** The lines that have at least one live, TARGETABLE ship, in {@link TIER_ORDER}.
 *  A stack whose unit is missing from `data` belongs to no line — it neither fires
 *  nor is hit, and its line's share is redistributed by the «absent line» rule. */
function presentLines(units: readonly UnitStack[], data: GameData): Tier[] {
  return TIER_ORDER.filter((tier) =>
    units.some((s) => {
      if (!isTargetable(s, data)) {
        return false;
      }
      const def = data.units[s.unit];
      return def ? unitTier(def) === tier : false;
    }),
  );
}

/**
 * The PURE damage model (GDD §7.2): EVERY line in the fight takes a slice of
 * `totalDamage` in the same volley — {@link lineShares} says how big a slice,
 * given which lines are present.
 *
 * Overkill is never wasted: a line handed more than it can absorb dies and its
 * leftover is re-split over the lines still standing by the SAME rule — the
 * split is simply recomputed and the pass repeats. There is one rule in the
 * game, not a split rule plus a spill rule. That terminates in at most four
 * passes: a pass either spends everything or empties a line.
 *
 * No bus access — losses are RETURNED (`deaths`, in processing order) so the math
 * is unit-testable in isolation; the `applyDamage` wrapper turns each loss into a
 * `unit.died` event.
 */
export function damageUnits(
  units: UnitStack[],
  totalDamage: number,
  data: GameData,
): { survivors: UnitStack[]; deaths: { unit: string; count: number }[] } {
  const deaths: { unit: string; count: number }[] = [];
  let remaining = totalDamage;
  while (remaining > 0) {
    const lines = presentLines(units, data);
    if (lines.length === 0) {
      break; // nothing left that can be hit
    }
    const shares = lineShares(lines);
    let allocated = 0;
    let leftover = 0;
    for (const [i, tier] of lines.entries()) {
      // The last line takes the exact remainder, so splitting by percent can
      // neither lose nor mint damage to floating-point rounding.
      const slice =
        i === lines.length - 1 ? remaining - allocated : (remaining * shares[tier]) / 100;
      allocated += slice;
      leftover += damageLine(units, tier, slice, data, deaths);
    }
    if (leftover >= remaining) {
      break; // absorbed nothing — cannot happen with live lines, but never spin
    }
    remaining = leftover;
  }
  return { survivors: units.filter((s) => s.count > 0), deaths };
}

/** The bus-facing wrapper over {@link damageUnits}: each loss is announced via
 *  `unit.died` (tagged with `source`), and the surviving stacks are returned. */
export function applyDamage(
  h: HandlerContext,
  units: UnitStack[],
  totalDamage: number,
  data: GameData,
  source: Record<string, string>,
): UnitStack[] {
  const { survivors, deaths } = damageUnits(units, totalDamage, data);
  for (const d of deaths) {
    h.emit('unit.died', { unit: d.unit, count: d.count, ...source });
  }
  return survivors;
}

export function applyDamageToSide(
  h: HandlerContext,
  ref: CombatantRef,
  dmg: number,
  data: GameData,
  location: string,
): void {
  const units = sideUnits(h.state, ref);
  if (!units) {
    return;
  }
  // Плацдарм адресуется миром, как и гарнизон: флота у него нет (ROS-1.5).
  const onPlanet = ref.kind === 'garrison' || ref.kind === 'beachhead';
  const source: Record<string, string> = onPlanet
    ? { at: location, planetId: ref.planetId }
    : { at: location, fleetId: ref.fleetId };
  // Tag the casualty's owner NOW: a wiped fleet is deleted before the `unit.died`
  // event drains, so listeners (heroes / score) can't re-find it. У плацдарма
  // владелец СВОЙ — он не хозяин мира, он на него высадился.
  const owner =
    ref.kind === 'beachhead'
      ? h.state.planets[ref.planetId]?.beachhead?.owner
      : ref.kind === 'garrison'
        ? h.state.planets[ref.planetId]?.owner
        : h.state.fleets[ref.fleetId]?.owner;
  if (owner != null) {
    source.owner = owner;
  }
  // Taking damage stamps `lastDamagedAt` — shields hold their regen for a delay
  // after being hit (shields-roadmap SH-1.1).
  if (ref.kind === 'fleet' && dmg > 0) {
    const f = h.state.fleets[ref.fleetId];
    if (f) {
      f.lastDamagedAt = h.ctx.now;
    }
  }
  setSideUnits(h.state, ref, applyDamage(h, units, dmg, data, source));
}

/** Delete a fleet whose LAST ship just died outside a battle (orbital AA or
 *  standoff fire), announcing `fleet.destroyed`. A battle-side wipe goes through
 *  the melee module's own release path instead. */
export function removeIfWiped(h: HandlerContext, fleetId: string): void {
  const after = h.state.fleets[fleetId];
  if (after && after.units.length === 0) {
    h.emit('fleet.destroyed', { fleetId: after.id, owner: after.owner });
    delete h.state.fleets[fleetId];
  }
}

/** Look up a fleet by id treating `fleets` as a plain map — an OWN key only, so a
 *  prototype-chain string (`__proto__` / `constructor` / `toString`) can never
 *  resolve to `Object.prototype` and slip a non-fleet object past validation
 *  (fail-secure: a poisoned id reads as "no such fleet", not a later crash). */
export function ownFleet(state: GameState, id: string): Fleet | undefined {
  return Object.prototype.hasOwnProperty.call(state.fleets, id) ? state.fleets[id] : undefined;
}

// --- lane occupancy (two fleets sharing a lane, GDD §7.4) ---------------------

/** |Δfraction| below which two fleets on a lane count as co-located (a crossing). */
export const INTERCEPT_TOL = 1e-6;

/**
 * A fleet's occupancy of a lane as a linear function of time: its normalized
 * position `s ∈ [0,1]` along the canonical lane (endpoints sorted `lo`→`hi`, so
 * fleets travelling opposite ways share one axis), valid over [`t0`,`t1`]. A
 * moving fleet interpolates s0→s1 across its leg; a parked fleet is constant
 * (s0===s1) over an unbounded window.
 */
export interface LaneOcc {
  lo: PlanetId;
  hi: PlanetId;
  s0: number;
  s1: number;
  t0: number;
  t1: number;
  moving: boolean;
}

/** Where a fleet sits on a lane as a time-parametrized segment — or null if it is
 *  at a node / gone (not on a lane). */
export function laneOccupancy(fleet: Fleet): LaneOcc | null {
  const mv = fleet.movement;
  if (mv) {
    if (mv.arrivesAt <= mv.departedAt) {
      return null; // degenerate zero-length leg — no meaningful segment
    }
    const reversed = mv.from > mv.to;
    const startT = mv.startT ?? 0;
    const endT = mv.endT ?? 1;
    return {
      lo: reversed ? mv.to : mv.from,
      hi: reversed ? mv.from : mv.to,
      s0: reversed ? 1 - startT : startT,
      s1: reversed ? 1 - endT : endT,
      t0: mv.departedAt,
      t1: mv.arrivesAt,
      moving: true,
    };
  }
  const e = fleet.edge;
  if (e) {
    const reversed = e.from > e.to;
    const s = reversed ? 1 - e.t : e.t;
    return {
      lo: reversed ? e.to : e.from,
      hi: reversed ? e.from : e.to,
      s0: s,
      s1: s,
      t0: -Infinity,
      t1: Infinity,
      moving: false,
    };
  }
  return null;
}

/** Normalized position of an occupant at time `t` (linear; constant if parked). */
export function posAt(occ: LaneOcc, t: number): number {
  if (!occ.moving) {
    return occ.s0;
  }
  return occ.s0 + ((occ.s1 - occ.s0) * (t - occ.t0)) / (occ.t1 - occ.t0);
}
