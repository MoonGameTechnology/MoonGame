/**
 * Ground divisions (REFP-13) — mobilisation from locked templates, cargo transport
 * aboard fleets, tick-based ground battle and daily restoration, extracted from
 * `game.ts` as a pure move. Depends on `formations.ts` (templates/slots/stats),
 * `groundcombat.ts` (roster/officers/damage matrix), `prototypeData.ts` (`data`)
 * and shared-core utils. `game.ts` imports `divisionModule` for MODULES and
 * re-exports the public names for `main.ts`/`netserver.ts`/tests (until REFP-28).
 */
import {
  getStance,
  isCapturable,
  timeScaleOf,
  type GameModule,
  type GameState,
  type Fleet,
} from '../../packages/shared-core/src/index';
import { canAfford, payCost } from '../../packages/shared-core/src/util/treasury';
import { sumUnitStat } from '../../packages/shared-core/src/util/stacks';
import { requireOwnedIdleFleet } from '../../packages/shared-core/src/util/fleet';
import type { HandlerContext } from '../../packages/shared-core/src/kernel/module';
import {
  GROUND_ROSTER,
  makeSide,
  damageBuckets,
  OFFICERS,
  type GroundStack,
  type DamageTable,
  type Officer,
} from './groundcombat';
import {
  DEFAULT_TEMPLATES,
  OFFICER_TEMPLATES,
  FORMATION_SLOTS,
  FORMATION_UNITS,
  formationStats,
  type FormationUnit,
  type FormationTemplate,
  type OfficerTemplate,
} from './formations';
import { data } from './prototypeData';

// Wall-clock units, mirrored locally (like `serverDrivers.ts`) instead of importing
// them back from `game.ts` — no reverse edge onto the facade.
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

// --- ground divisions: mobilisation + daily restoration ----------------------
// A division is a cohesive ground formation built from a LOCKED template. It lives in
// `state.divisions` (a prototype-only field, preserved through deepClone), garrisons a
// world, and passively heals there. Combat (resolveGround) + transport land next.

/** A mobilised division in play. */
export interface Division {
  id: string;
  owner: string;
  name: string;
  template: number;
  /** Template counts per type — the regrow target (units rebuild toward this). */
  max: Partial<Record<FormationUnit, number>>;
  units: GroundStack[];
  /** Optional attached officer (OFFICERS key) — its bonuses apply in battle / toughness. */
  officer?: string;
  /** Planet id it garrisons (the world it sits on when not aboard a fleet). */
  location: string;
  /** Fleet id carrying it as cargo, or null/absent when garrisoning `location`.
   *  A carried division is "in the hold": it rides the fleet and does not fight. */
  carriedBy?: string | null;
}

/** Prototype state extended with the division domain: the registry, its id counter,
 *  per-player locked templates and the live ground-battle clock (planetId → unticked
 *  combat-time remainder, ms). Non-`GameState` fields, preserved by deepClone
 *  (own-key copy). The other prototype extensions stay typed in `game.ts` (its
 *  `DivisionState`) — same local-view pattern as `serverDrivers.ts`. */
type DivisionState = GameState & {
  divisions?: Record<string, Division>;
  divisionSeq?: number;
  templates?: Record<string, FormationTemplate[]>;
  groundBattles?: Record<string, number>;
};

export function divisionsOf(state: GameState): Record<string, Division> {
  const s = state as DivisionState;
  return (s.divisions ??= {});
}
/** The live ground-battle accumulator (planetId → combat-time remainder not yet
 *  ticked, ms). A world is in here exactly while a ground battle is underway. */
function groundBattlesOf(state: GameState): Record<string, number> {
  const s = state as DivisionState;
  return (s.groundBattles ??= {});
}
export function templatesOf(state: GameState, playerId: string): FormationTemplate[] {
  return (state as DivisionState).templates?.[playerId] ?? DEFAULT_TEMPLATES;
}

/** Base passive restoration: +1 HP per unit per day on a friendly planet (hospitals /
 *  hero / officer bonuses raise it — later). */
export const REGEN_PER_UNIT_PER_DAY = 1;

/** Per-unit max HP for a division's type, including any attached officer's toughness. */
function unitMaxHp(div: Division, type: FormationUnit): number {
  const base = GROUND_ROSTER[type]?.hp ?? 1;
  const bonus = div.officer ? (OFFICERS[div.officer]?.hp ?? 0) : 0;
  return base * (1 + bonus);
}

/** Heal + regrow a division toward its template `max` over `days` (per type, capped at
 *  full strength). A fully-dead TYPE regrows; the division as a whole is removed only
 *  when wiped in battle (handled there) — regen never resurrects a 0-unit division. */
export function regenDivision(div: Division, days: number): void {
  if (days <= 0) return;
  const byType: Record<string, GroundStack> = {};
  for (const s of div.units) byType[s.type] = s;
  const next: GroundStack[] = [];
  for (const type of Object.keys(div.max) as FormationUnit[]) {
    const maxCount = div.max[type] ?? 0;
    if (maxCount <= 0) continue;
    const hpEach = unitMaxHp(div, type);
    const maxHp = maxCount * hpEach;
    const cur = byType[type]?.hp ?? 0;
    const healed = Math.min(maxHp, cur + REGEN_PER_UNIT_PER_DAY * maxCount * days);
    const count = healed <= 0 ? 0 : Math.ceil(healed / hpEach);
    if (count > 0) next.push({ type, count, hp: healed, hpEach });
  }
  div.units = next;
}

// --- ground transport: divisions ride a fleet by cargo capacity --------------
// "По грузоподъёмности": a division's transport footprint is the summed `cargoSize`
// of its template, and a fleet carries as many divisions as fit in its ships' summed
// `cargoCapacity`. A carried division is "in the hold" — it rides the fleet and does
// not garrison or fight until unloaded onto a world.

/** A division's transport footprint = Σ template-unit `cargoSize` (stable across
 *  casualties — the hold is reserved for the whole formation). */
export function divisionCargo(div: Division): number {
  let total = 0;
  for (const type of Object.keys(div.max) as FormationUnit[]) {
    total += (div.max[type] ?? 0) * (data.units[type]?.stats.cargoSize ?? 0);
  }
  return total;
}

/** Hold left on a fleet = Σ ship `cargoCapacity` − Σ carried divisions' footprint
 *  − the legacy `landing` army aboard (both share the same hold, billed by cargoSize). */
export function fleetCargoFree(state: GameState, fleet: Fleet): number {
  const cap = sumUnitStat(fleet.units, data, 'cargoCapacity');
  const landingUsed = sumUnitStat(fleet.landing ?? [], data, 'cargoSize');
  let divUsed = 0;
  for (const d of Object.values(divisionsOf(state))) {
    if (d.carriedBy === fleet.id) divUsed += divisionCargo(d);
  }
  return cap - landingUsed - divUsed;
}

// --- ground battle: co-located hostile divisions trade matrix damage ---------
// "Потиково во времени": each owner's divisions on a contested world merge into one
// fighting side (so combat width 12 spans the whole force), the two sides trade
// `damageBuckets` each tick, casualties spread back per division by HP share, a wiped
// division is removed, and the attacker that clears the defenders CAPTURES the world.
// Resolved in discrete ticks as the clock advances — driven by `time.advanced` with a
// per-world remainder, so the tick sequence is the same however finely time is stepped.
// (Near/mid/far lines are a FLEET concept; ground routes damage by the type matrix.)

/** Hours of real time per ground combat tick (a ground assault plays out over hours). */
export const GROUND_TICK_HOURS = 3;
const GROUND_TICK_MS = GROUND_TICK_HOURS * HOUR;
/** Fail-secure cap on ticks resolved in one span (real battles end far sooner). */
const MAX_GROUND_TICKS_PER_SPAN = 1000;

const atWar = (state: GameState, a: string, b: string): boolean =>
  a !== b && getStance(state, a, b) === 'war';

/** The garrisoning (not in-transit) divisions at a world that still have units,
 *  lowest id first (deterministic order). */
function divisionsAt(state: GameState, planetId: string): Division[] {
  return Object.values(divisionsOf(state))
    .filter(
      (d) => d.carriedBy == null && d.location === planetId && d.units.some((u) => u.count > 0),
    )
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** Merge a side's divisions into one stack list (summed counts per type). Only the
 *  per-type COUNT matters to `damageBuckets`; hp/hpEach here are unused placeholders. */
function mergeSide(divs: Division[]): GroundStack[] {
  const byType = {} as Record<FormationUnit, number>;
  for (const d of divs) for (const u of d.units) byType[u.type] = (byType[u.type] ?? 0) + u.count;
  const out: GroundStack[] = [];
  for (const type of Object.keys(byType) as FormationUnit[]) {
    if (byType[type] > 0) out.push({ type, count: byType[type], hp: byType[type], hpEach: 1 });
  }
  return out;
}

/** A merged side's effective officer = count-weighted mean of its divisions'
 *  attack/defence officer bonuses (per-division hp/atkVs are omitted in the merge). */
function mergeOfficer(divs: Division[]): Officer | undefined {
  let total = 0;
  let atk = 0;
  let def = 0;
  for (const d of divs) {
    const c = d.units.reduce((n, u) => n + u.count, 0);
    if (c <= 0) continue;
    total += c;
    const o = d.officer ? OFFICERS[d.officer] : undefined;
    if (o) {
      atk += (o.atk ?? 0) * c;
      def += (o.def ?? 0) * c;
    }
  }
  if (total <= 0 || (atk === 0 && def === 0)) return undefined;
  return { name: 'merged', atk: atk / total, def: def / total };
}

/** Spread a per-type damage bucket across a side's divisions, proportional to each
 *  stack's current HP; whole units die as the pool drops (per-division `hpEach`). */
function applyBucketsToDivs(divs: Division[], buckets: DamageTable): void {
  for (const type of Object.keys(buckets) as FormationUnit[]) {
    const dmg = buckets[type] ?? 0;
    if (dmg <= 0) continue;
    const stacks: GroundStack[] = [];
    for (const d of divs)
      for (const u of d.units) if (u.type === type && u.count > 0) stacks.push(u);
    const totalHp = stacks.reduce((n, u) => n + u.hp, 0);
    if (totalHp <= 0) continue;
    for (const u of stacks) {
      u.hp = Math.max(0, u.hp - dmg * (u.hp / totalHp));
      u.count = u.hp <= 0 ? 0 : Math.ceil(u.hp / u.hpEach);
    }
  }
  for (const d of divs) d.units = d.units.filter((u) => u.count > 0);
}

/** Drop fully-wiped divisions (last unit gone) from the registry. Survivors keep
 *  their HP; restoration regrows dead TYPES, never a fully-wiped division. */
function reapWipedDivisions(state: GameState): void {
  const divs = divisionsOf(state);
  for (const id of Object.keys(divs)) {
    if (!divs[id]!.units.some((u) => u.count > 0)) delete divs[id];
  }
}

/** Hand a world to the lowest-id attacker present (a non-`defenderOwner` owner),
 *  unless it isn't capturable or a hostile fleet garrison still holds it. The legacy
 *  ground/emplacement garrison is NOT engaged by division combat yet (a documented seam):
 *  a garrisoned world resists division capture until cleared via the fleet-assault path. */
function captureGround(h: HandlerContext, planetId: string, defenderOwner: string | null): void {
  const planet = h.state.planets[planetId];
  if (!planet || !isCapturable(data, planet)) return;
  if (planet.garrison.some((srv) => srv.count > 0)) return;
  // The taker is the lowest-id owner present that is actually AT WAR with the defender —
  // a co-located ally / non-belligerent must never steal the capture.
  const owners = [
    ...new Set(
      divisionsAt(h.state, planetId)
        .filter(
          (d) =>
            d.owner !== defenderOwner &&
            defenderOwner !== null &&
            atWar(h.state, d.owner, defenderOwner),
        )
        .map((d) => d.owner),
    ),
  ].sort();
  const taker = owners[0];
  if (taker === undefined) return;
  const from = planet.owner;
  planet.owner = taker;
  // Emit the SAME event the fleet path uses (`via: 'ground'`), so victory re-evaluates
  // and the UI logs + refreshes — a division-only event had no listener.
  h.emit('planet.captured', { planetId, owner: taker, from, via: 'ground' });
}

/** Whether a world currently hosts a ground battle: its owner's divisions facing a
 *  co-located at-war intruder's. (Undefended/neutral capture is a walk-in, not here.) */
function groundContested(state: GameState, planetId: string): boolean {
  const O = state.planets[planetId]?.owner ?? null;
  if (O === null) return false;
  const divs = divisionsAt(state, planetId);
  return (
    divs.some((d) => d.owner === O) && divs.some((d) => d.owner !== O && atWar(state, d.owner, O))
  );
}

/** Resolve ONE ground tick at a contested world. Returns true if a two-sided fight is
 *  still ongoing afterwards (keep ticking), false once it has resolved. */
function groundTickAt(h: HandlerContext, planetId: string): boolean {
  const O = h.state.planets[planetId]?.owner ?? null;
  if (O === null) return false;
  const divs = divisionsAt(h.state, planetId);
  const defenders = divs.filter((d) => d.owner === O);
  const hostiles = divs.filter((d) => d.owner !== O && atWar(h.state, d.owner, O));
  if (hostiles.length === 0) return false; // no hostiles → no battle
  // One attacker owner at a time: the lowest-id at-war owner engages the defender this
  // tick. Distinct owners are NOT fused into a single side — that would force mutual
  // enemies into an alliance and let them share the combat-width-12 budget. When this
  // attacker captures, the next tick re-evaluates with the NEW owner, so an FFA resolves
  // as a deterministic sequence of pairwise fights (driver re-checks groundContested).
  const foe = [...new Set(hostiles.map((d) => d.owner))].sort()[0]!;
  const attackers = hostiles.filter((d) => d.owner === foe);
  if (defenders.length === 0) {
    captureGround(h, planetId, O); // undefended by division → attacker seizes it
    return false;
  }
  // Both sides present: one simultaneous tick from the pre-tick snapshot.
  const atkOfficer = mergeOfficer(attackers);
  const defOfficer = mergeOfficer(defenders);
  const atkMerged = mergeSide(attackers);
  const defMerged = mergeSide(defenders);
  const toDefender = damageBuckets(GROUND_ROSTER, atkMerged, defMerged, 'atk', atkOfficer);
  const toAttacker = damageBuckets(GROUND_ROSTER, defMerged, atkMerged, 'def', defOfficer);
  applyBucketsToDivs(defenders, toDefender);
  applyBucketsToDivs(attackers, toAttacker);
  reapWipedDivisions(h.state);
  const after = divisionsAt(h.state, planetId);
  const defLeft = after.some((d) => d.owner === O);
  const foeLeft = after.some((d) => d.owner === foe);
  if (!defLeft && foeLeft) {
    captureGround(h, planetId, O); // defenders wiped → attacker captures
    return false;
  }
  return defLeft && foeLeft; // this pairwise fight continues only while both stand
}

/** Drive ground combat over a continuous span: accumulate combat time per world and
 *  resolve one whole tick per GROUND_TICK_MS elapsed. The accumulated time is spent
 *  ACROSS battle transitions — a capture that opens a follow-on fight (new owner faces
 *  the next attacker) keeps ticking within the same span — and only the sub-tick
 *  remainder is carried. So the tick sequence is identical however finely time is
 *  stepped (a single big span === many small spans), which a coarse offline catch-up
 *  and a per-frame live client both depend on (replay / multiplayer determinism). */
function runGroundCombat(h: HandlerContext, elapsed: number): void {
  const battles = groundBattlesOf(h.state);
  // Candidate worlds: any holding a garrisoning division, plus any mid-battle.
  const worlds = new Set<string>(Object.keys(battles));
  for (const d of Object.values(divisionsOf(h.state)))
    if (d.carriedBy == null) worlds.add(d.location);
  for (const planetId of [...worlds].sort()) {
    let acc = (battles[planetId] ?? 0) + elapsed;
    let guard = 0;
    // Tick while there's a whole tick of time AND a live contest; re-check the contest
    // each iteration so a mid-span capture's follow-on fight is resolved here, not
    // discarded (which would diverge from finer stepping).
    while (acc >= GROUND_TICK_MS && guard < MAX_GROUND_TICKS_PER_SPAN) {
      if (!groundContested(h.state, planetId)) break;
      groundTickAt(h, planetId);
      acc -= GROUND_TICK_MS;
      guard += 1;
    }
    // Carry the sub-tick remainder while a contest survives; otherwise the world is
    // settled — drop it (no contest left to spend leftover time on).
    if (groundContested(h.state, planetId)) battles[planetId] = acc % GROUND_TICK_MS;
    else delete battles[planetId];
  }
}

export const divisionModule: GameModule = {
  id: 'division',
  version: '0.1.0',
  setup(api) {
    // Mobilise a division by template on an owned world: pay the summed slot cost, the
    // formation garrisons the world at full strength. (Build time / transport — later.)
    api.onAction('division.mobilize', (action, h) => {
      const p = action.payload as { planetId?: string; template?: number };
      if (typeof p?.planetId !== 'string' || typeof p?.template !== 'number') {
        return h.reject('E_BAD_PAYLOAD');
      }
      const planet = h.state.planets[p.planetId];
      if (!planet) return h.reject('E_NO_PLANET');
      if (planet.owner !== action.playerId) return h.reject('E_FORBIDDEN');
      const fromOfficer = (action.payload as { officer?: unknown }).officer === true;
      const tpl = fromOfficer
        ? OFFICER_TEMPLATES[p.template]
        : templatesOf(h.state, action.playerId)[p.template];
      if (!tpl) return h.reject('E_NO_TEMPLATE');
      const stats = formationStats(tpl);
      if (stats.count <= 0) return h.reject('E_EMPTY_TEMPLATE');
      const player = h.state.players[action.playerId];
      if (!player) return h.reject('E_NO_PLAYER');
      if (!canAfford(player.resources, stats.cost)) return h.reject('E_NO_FUNDS');
      payCost(player.resources, stats.cost);
      const divs = divisionsOf(h.state);
      const ds = h.state as DivisionState;
      const seq = (ds.divisionSeq ?? 0) + 1;
      ds.divisionSeq = seq;
      const id = `div:${action.playerId}:${seq}`;
      // Именной шаблон приходит со своим офицером — «готовый шаблон, менять нельзя».
      // Its HP bonus is baked into hpEach at birth, so the division is born AT its
      // regen-max (unitMaxHp reads the same officer), not below it.
      const officer = fromOfficer ? (tpl as OfficerTemplate).officer : undefined;
      divs[id] = {
        id,
        owner: action.playerId,
        name: tpl.name,
        template: p.template,
        max: { ...stats.byType },
        units: makeSide(GROUND_ROSTER, stats.byType, officer ? OFFICERS[officer] : undefined),
        location: p.planetId,
        ...(officer ? { officer } : {}),
      };
      h.emit('division.mobilized', {
        id,
        owner: action.playerId,
        planetId: p.planetId,
        template: p.template,
      });
    });

    // Assemble a division template in-match — set slot `slot` of the player's template
    // `template` to a formation unit (or null). Templates are no longer frozen at setup:
    // "сбор шаблона из разных юнитов" happens at mobilisation. Materialises the player's
    // templates from the defaults on first edit (per-player, deep-copied, JSON-safe).
    api.onAction('division.template', (action, h) => {
      const p = action.payload as { template?: number; slot?: number; unit?: string | null };
      if (typeof p?.template !== 'number' || typeof p?.slot !== 'number')
        return h.reject('E_BAD_PAYLOAD');
      if (p.slot < 0 || p.slot >= FORMATION_SLOTS) return h.reject('E_BAD_PAYLOAD');
      const unit = p.unit ?? null;
      if (unit !== null && !(FORMATION_UNITS as readonly string[]).includes(unit)) {
        return h.reject('E_BAD_PAYLOAD');
      }
      const ds = h.state as DivisionState;
      const all = (ds.templates ??= {});
      const mine = (all[action.playerId] ??= DEFAULT_TEMPLATES.map((t) => ({
        name: t.name,
        slots: [...t.slots],
      })));
      const tpl = mine[p.template];
      if (!tpl) return h.reject('E_NO_TEMPLATE');
      tpl.slots[p.slot] = unit as FormationUnit | null;
      h.emit('division.retemplated', { template: p.template, slot: p.slot, unit });
    });

    // Rename a CUSTOM template (Stellaris-style designer). Officer premades are not
    // player templates, so they are unreachable here — their name is locked by data.
    api.onAction('division.rename', (action, h) => {
      const p = action.payload as { template?: number; name?: unknown };
      if (typeof p?.template !== 'number' || typeof p?.name !== 'string')
        return h.reject('E_BAD_PAYLOAD');
      const name = p.name.trim().slice(0, 24);
      if (!name) return h.reject('E_BAD_PAYLOAD');
      const ds = h.state as DivisionState;
      const all = (ds.templates ??= {});
      const mine = (all[action.playerId] ??= DEFAULT_TEMPLATES.map((t) => ({
        name: t.name,
        slots: [...t.slots],
      })));
      const tpl = mine[p.template];
      if (!tpl) return h.reject('E_NO_TEMPLATE');
      tpl.name = name;
    });

    /** Own-key division lookup owned by `playerId` (rejects a poisoned id / a foreign
     *  or missing division — fail-secure, mirroring the artillery `ownFleet` guard). */
    const ownDivision = (h: HandlerContext, id: unknown, playerId: string): Division => {
      if (
        typeof id !== 'string' ||
        !Object.prototype.hasOwnProperty.call(divisionsOf(h.state), id)
      ) {
        h.reject('E_NO_DIVISION');
      }
      const div = divisionsOf(h.state)[id as string]!;
      if (div.owner !== playerId) h.reject('E_FORBIDDEN');
      return div;
    };

    // Load a garrisoning division into a co-located, idle fleet — bounded by the
    // fleet's free hold ("по грузоподъёмности"). A carried division rides the fleet.
    api.onAction('division.load', (action, h) => {
      const p = action.payload as { divisionId?: string; fleetId?: string };
      if (typeof p?.fleetId !== 'string') return h.reject('E_BAD_PAYLOAD');
      const div = ownDivision(h, p.divisionId, action.playerId);
      if (div.carriedBy != null) return h.reject('E_ALREADY_LOADED');
      const fleet = requireOwnedIdleFleet(h, p.fleetId, action.playerId); // docked, not in battle
      if (fleet.location !== div.location) return h.reject('E_NOT_COLOCATED');
      if (divisionCargo(div) > fleetCargoFree(h.state, fleet)) return h.reject('E_NO_CARGO');
      div.carriedBy = fleet.id;
      h.emit('division.loaded', {
        id: div.id,
        fleetId: fleet.id,
        owner: action.playerId,
        at: div.location,
      });
    });

    // Unload a carried division onto the world its carrier is docked over. An
    // undefended, capturable hostile/neutral world is seized on the spot (walk-in
    // capture), mirroring fleet capture-on-arrival; otherwise the world's ground
    // battle (if any) is resolved by the continuous-time driver below.
    api.onAction('division.unload', (action, h) => {
      const div = ownDivision(
        h,
        (action.payload as { divisionId?: string })?.divisionId,
        action.playerId,
      );
      if (div.carriedBy == null) return h.reject('E_NOT_LOADED');
      const fleet = requireOwnedIdleFleet(h, div.carriedBy, action.playerId); // docked at a node
      const target = fleet.location;
      div.carriedBy = null;
      div.location = target;
      const planet = h.state.planets[target];
      if (
        planet &&
        planet.owner !== div.owner &&
        isCapturable(data, planet) &&
        (planet.owner === null || atWar(h.state, div.owner, planet.owner)) &&
        !planet.garrison.some((srv) => srv.count > 0) &&
        !divisionsAt(h.state, target).some((d) => d.owner !== div.owner)
      ) {
        const from = planet.owner;
        planet.owner = div.owner;
        // Same event the fleet capture path uses (`via: 'ground'`) → victory + UI react.
        h.emit('planet.captured', { planetId: target, owner: div.owner, from, via: 'ground' });
      }
      h.emit('division.unloaded', {
        id: div.id,
        fleetId: fleet.id,
        owner: action.playerId,
        at: target,
      });
    });

    // NOTE: there is deliberately NO runtime officer attach/detach action. Officers
    // arrive ONLY with their locked premade (`division.mobilize {officer: true}`) —
    // a raw `division.officer` action used to attach any officer to any division for
    // free, bypassing the premade lock (bughunt BF-19).

    // Per-span ground upkeep: lose divisions with their destroyed carrier, resolve
    // tick-based ground battles, then restore survivors on friendly soil.
    api.on('time.advanced', (event, h) => {
      const { from, to } = event.payload as { from: number; to: number };
      const span = to - from;
      if (span <= 0) return;
      const elapsed = span * timeScaleOf(h.ctx); // clamps a missing/non-positive scale to 1, like every sibling module
      // A division aboard a destroyed carrier is lost with the ship.
      const divs = divisionsOf(h.state);
      for (const id of Object.keys(divs)) {
        const d = divs[id]!;
        if (
          d.carriedBy != null &&
          !Object.prototype.hasOwnProperty.call(h.state.fleets, d.carriedBy)
        ) {
          h.emit('division.lost', { id, owner: d.owner });
          delete divs[id];
        }
      }
      // Tick-based ground combat on contested worlds (real time → discrete ticks).
      runGroundCombat(h, elapsed);
      // Daily restoration: +1 HP/unit/day for a garrisoning division on a friendly
      // planet (not in transit; a wiped division is gone, never resurrected).
      const days = elapsed / DAY;
      if (days <= 0) return;
      for (const div of Object.values(divisionsOf(h.state))) {
        if (div.carriedBy != null) continue; // in transit / in a hold — no restoration
        const planet = h.state.planets[div.location];
        if (!planet || planet.owner !== div.owner) continue; // own planet only
        // No field repair under fire: regen while a ground battle rages would also
        // make the outcome depend on how finely the span is stepped (BF-22).
        if (groundContested(h.state, div.location)) continue;
        if (!div.units.some((s) => s.count > 0)) continue; // wiped → gone, never resurrected
        regenDivision(div, days);
      }
    });
  },
};
