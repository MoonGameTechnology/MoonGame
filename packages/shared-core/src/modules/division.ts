import type { GameModule, HandlerContext } from '../kernel/module';
import type { Division, Fleet, GameState, PlanetId } from '../state/gameState';
import type { GameData } from '../data/schemas';
import { getStance } from '../state/diplomacy';
import { isCapturable } from '../state/sectorKind';
import { timeScaleOf } from '../action/types';
import { canAfford, payCost } from '../util/treasury';
import { sumUnitStat } from '../util/stacks';
import { requireOwnedIdleFleet } from '../util/fleet';
import {
  GROUND_ROSTER,
  COMBAT_WIDTH,
  makeSide,
  damageBuckets,
  OFFICERS,
  type GroundStack,
  type DamageTable,
  type Officer,
} from '../state/groundCombat';
import {
  DEFAULT_TEMPLATES,
  OFFICER_TEMPLATES,
  FORMATION_SLOTS,
  FORMATION_UNITS,
  formationStats,
  type FormationUnit,
  type FormationTemplate,
  type OfficerTemplate,
} from '../data/formations';

/**
 * Ground divisions (H4) — mobilisation from locked templates, cargo transport
 * aboard fleets, tick-based ground battle and daily restoration. Port of the
 * prototype's `division.ts` (same numbers, same behaviour) so the real
 * multiplayer server (`packages/server`) can run division-vs-division ground
 * combat, not only the prototype host. Additive: the legacy `Planet.garrison`
 * army (armyModule / combatModule) is untouched — division combat only ever
 * engages other divisions (see the doc comment on `GameState.divisions`).
 */

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** Read-only accessor — safe to call from anywhere (fog projection, read-models,
 *  tests) without side effects on a state that might be shared/compared/hashed
 *  elsewhere (invariant #2: no mutation outside a handler's own draft). Returns a
 *  fresh empty object when unset rather than materialising the field. */
export function divisionsOf(state: GameState): Record<string, Division> {
  return state.divisions ?? {};
}
/** Write-capable variant, used ONLY inside this module's own handlers (already
 *  operating on the kernel's private draft) — the one place `state.divisions`
 *  legitimately gets created on first mobilisation. */
function ensureDivisions(state: GameState): Record<string, Division> {
  return (state.divisions ??= {});
}
function groundBattlesOf(state: GameState): Record<PlanetId, number> {
  return (state.groundBattles ??= {});
}
export function templatesOf(state: GameState, playerId: string): FormationTemplate[] {
  return state.players[playerId]?.divisionTemplates ?? DEFAULT_TEMPLATES;
}

/** Base passive restoration: +1 HP per unit per day on a friendly planet. */
export const REGEN_PER_UNIT_PER_DAY = 1;

/** Per-unit max HP for a division's type, including any attached officer's toughness. */
function unitMaxHp(div: Division, type: FormationUnit): number {
  const base = GROUND_ROSTER[type]?.hp ?? 1;
  const bonus = div.officer ? (OFFICERS[div.officer]?.hp ?? 0) : 0;
  return base * (1 + bonus);
}

/** Heal + regrow a division toward its template `max` over `days` (per type, capped at
 *  full strength). A fully-dead TYPE regrows; the division as a whole is removed only
 *  when wiped in battle — regen never resurrects a 0-unit division. */
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

/** A division's transport footprint = Σ template-unit `cargoSize` (stable across
 *  casualties — the hold is reserved for the whole formation). */
export function divisionCargo(div: Division, data: GameData): number {
  let total = 0;
  for (const type of Object.keys(div.max) as FormationUnit[]) {
    total += (div.max[type] ?? 0) * (data.units[type]?.stats.cargoSize ?? 0);
  }
  return total;
}

/** Hold left on a fleet = Σ ship `cargoCapacity` − Σ carried divisions' footprint
 *  − the legacy `landing` army aboard (both share the same hold, billed by cargoSize). */
export function fleetCargoFree(state: GameState, fleet: Fleet, data: GameData): number {
  const cap = sumUnitStat(fleet.units, data, 'cargoCapacity');
  const landingUsed = sumUnitStat(fleet.landing ?? [], data, 'cargoSize');
  let divUsed = 0;
  for (const d of Object.values(divisionsOf(state))) {
    if (d.carriedBy === fleet.id) divUsed += divisionCargo(d, data);
  }
  return cap - landingUsed - divUsed;
}

export const GROUND_TICK_HOURS = 3;
const GROUND_TICK_MS = GROUND_TICK_HOURS * HOUR;
const MAX_GROUND_TICKS_PER_SPAN = 1000;

const atWar = (state: GameState, a: string, b: string): boolean =>
  a !== b && getStance(state, a, b) === 'war';

function divisionsAt(state: GameState, planetId: string): Division[] {
  return Object.values(divisionsOf(state))
    .filter(
      (d) => d.carriedBy == null && d.location === planetId && d.units.some((u) => u.count > 0),
    )
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

function mergeSide(divs: Division[]): GroundStack[] {
  const byType = {} as Record<FormationUnit, number>;
  for (const d of divs) for (const u of d.units) byType[u.type as FormationUnit] = (byType[u.type as FormationUnit] ?? 0) + u.count;
  const out: GroundStack[] = [];
  for (const type of Object.keys(byType) as FormationUnit[]) {
    if (byType[type] > 0) out.push({ type, count: byType[type], hp: byType[type], hpEach: 1 });
  }
  return out;
}

/** Merge a side's per-division officers into one count-weighted mean (`atk`/`def`
 *  fractions only). `Officer.atkVs` (a flat per-target-type bonus) is deliberately
 *  NOT merged — a mean of per-type tables has no obvious weighting and no current
 *  officer sets it (`OFFICERS` in `state/groundCombat.ts`). If a future officer
 *  adds `atkVs`, it silently drops out of merged (multi-division) combat until
 *  this is revisited — solo-division fights aren't affected (`makeSide`/damage
 *  application there reads the division's own officer directly, not this merge). */
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

function applyBucketsToDivs(divs: Division[], buckets: DamageTable): void {
  for (const type of Object.keys(buckets)) {
    const dmg = buckets[type] ?? 0;
    if (dmg <= 0) continue;
    const stacks: GroundStack[] = [];
    for (const d of divs) for (const u of d.units) if (u.type === type && u.count > 0) stacks.push(u);
    const totalHp = stacks.reduce((n, u) => n + u.hp, 0);
    if (totalHp <= 0) continue;
    for (const u of stacks) {
      u.hp = Math.max(0, u.hp - dmg * (u.hp / totalHp));
      u.count = u.hp <= 0 ? 0 : Math.ceil(u.hp / u.hpEach);
    }
  }
  for (const d of divs) d.units = d.units.filter((u) => u.count > 0);
}

function reapWipedDivisions(state: GameState): void {
  const divs = divisionsOf(state);
  for (const id of Object.keys(divs)) {
    if (!divs[id]!.units.some((u) => u.count > 0)) delete divs[id];
  }
}

/** Hand a world to the lowest-id attacker present (a non-`defenderOwner` owner),
 *  unless it isn't capturable or a hostile fleet garrison still holds it. The legacy
 *  ground/emplacement garrison is NOT engaged by division combat (a documented seam):
 *  a garrisoned world resists division capture until cleared via the fleet-assault path. */
function captureGround(h: HandlerContext, planetId: string, defenderOwner: string | null): void {
  const planet = h.state.planets[planetId];
  if (!planet || !isCapturable(h.ctx.data, planet)) return;
  if (planet.garrison.some((srv) => srv.count > 0)) return;
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
  h.emit('planet.captured', { planetId, owner: taker, from, via: 'ground' });
}

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
  if (hostiles.length === 0) return false;
  // One attacker owner at a time (see prototype precedent): distinct hostile owners
  // are NOT fused into one side; an FFA resolves as a deterministic pairwise sequence.
  const foe = [...new Set(hostiles.map((d) => d.owner))].sort()[0]!;
  const attackers = hostiles.filter((d) => d.owner === foe);
  if (defenders.length === 0) {
    captureGround(h, planetId, O);
    return false;
  }
  const atkOfficer = mergeOfficer(attackers);
  const defOfficer = mergeOfficer(defenders);
  const atkMerged = mergeSide(attackers);
  const defMerged = mergeSide(defenders);
  const toDefender = damageBuckets(GROUND_ROSTER, atkMerged, defMerged, 'atk', COMBAT_WIDTH, atkOfficer);
  const toAttacker = damageBuckets(GROUND_ROSTER, defMerged, atkMerged, 'def', COMBAT_WIDTH, defOfficer);
  applyBucketsToDivs(defenders, toDefender);
  applyBucketsToDivs(attackers, toAttacker);
  reapWipedDivisions(h.state);
  const after = divisionsAt(h.state, planetId);
  const defLeft = after.some((d) => d.owner === O);
  const foeLeft = after.some((d) => d.owner === foe);
  if (!defLeft && foeLeft) {
    captureGround(h, planetId, O);
    return false;
  }
  return defLeft && foeLeft;
}

/** Drive ground combat over a continuous span: accumulate combat time per world and
 *  resolve one whole tick per GROUND_TICK_MS elapsed — deterministic under any span
 *  granularity (replay / multiplayer). */
function runGroundCombat(h: HandlerContext, elapsed: number): void {
  const battles = groundBattlesOf(h.state);
  const worlds = new Set<string>(Object.keys(battles));
  for (const d of Object.values(divisionsOf(h.state))) if (d.carriedBy == null) worlds.add(d.location);
  for (const planetId of [...worlds].sort()) {
    let acc = (battles[planetId] ?? 0) + elapsed;
    let guard = 0;
    while (acc >= GROUND_TICK_MS && guard < MAX_GROUND_TICKS_PER_SPAN) {
      if (!groundContested(h.state, planetId)) break;
      groundTickAt(h, planetId);
      acc -= GROUND_TICK_MS;
      guard += 1;
    }
    // `acc % GROUND_TICK_MS` is exact only while the guard never trips: if
    // MAX_GROUND_TICKS_PER_SPAN ticks fired (≈125 continuous game-days of one
    // unbroken battle in a single span — offline catch-up, not live play) any
    // further whole ticks banked in `acc` beyond the cap are dropped along with
    // the remainder, not carried to the next span. Acceptable: a battle that
    // long has long since had a winner in practice, and the cap itself exists
    // to bound worst-case work per span, not to preserve every tick exactly.
    if (groundContested(h.state, planetId)) battles[planetId] = acc % GROUND_TICK_MS;
    else delete battles[planetId];
  }
}

export const divisionModule: GameModule = {
  id: 'division',
  version: '1.0.0',
  setup(api) {
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
      const stats = formationStats(tpl, h.ctx.data);
      if (stats.count <= 0) return h.reject('E_EMPTY_TEMPLATE');
      const player = h.state.players[action.playerId];
      if (!player) return h.reject('E_NO_PLAYER');
      if (!canAfford(player.resources, stats.cost)) return h.reject('E_NO_FUNDS');
      payCost(player.resources, stats.cost);
      const divs = ensureDivisions(h.state);
      const seq = (h.state.divisionSeq ?? 0) + 1;
      h.state.divisionSeq = seq;
      const id = `div:${action.playerId}:${seq}`;
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

    api.onAction('division.template', (action, h) => {
      const p = action.payload as { template?: number; slot?: number; unit?: string | null };
      if (typeof p?.template !== 'number' || typeof p?.slot !== 'number') {
        return h.reject('E_BAD_PAYLOAD');
      }
      if (p.slot < 0 || p.slot >= FORMATION_SLOTS) return h.reject('E_BAD_PAYLOAD');
      const unit = p.unit ?? null;
      if (unit !== null && !(FORMATION_UNITS as readonly string[]).includes(unit)) {
        return h.reject('E_BAD_PAYLOAD');
      }
      const player = h.state.players[action.playerId];
      if (!player) return h.reject('E_NO_PLAYER');
      const mine = (player.divisionTemplates ??= DEFAULT_TEMPLATES.map((t) => ({
        name: t.name,
        slots: [...t.slots],
      })));
      const tpl = mine[p.template];
      if (!tpl) return h.reject('E_NO_TEMPLATE');
      tpl.slots[p.slot] = unit as FormationUnit | null;
      h.emit('division.retemplated', { template: p.template, slot: p.slot, unit });
    });

    api.onAction('division.rename', (action, h) => {
      const p = action.payload as { template?: number; name?: unknown };
      if (typeof p?.template !== 'number' || typeof p?.name !== 'string') {
        return h.reject('E_BAD_PAYLOAD');
      }
      const name = p.name.trim().slice(0, 24);
      if (!name) return h.reject('E_BAD_PAYLOAD');
      const player = h.state.players[action.playerId];
      if (!player) return h.reject('E_NO_PLAYER');
      const mine = (player.divisionTemplates ??= DEFAULT_TEMPLATES.map((t) => ({
        name: t.name,
        slots: [...t.slots],
      })));
      const tpl = mine[p.template];
      if (!tpl) return h.reject('E_NO_TEMPLATE');
      tpl.name = name;
    });

    const ownDivision = (h: HandlerContext, id: unknown, playerId: string): Division => {
      if (typeof id !== 'string' || !Object.prototype.hasOwnProperty.call(divisionsOf(h.state), id)) {
        h.reject('E_NO_DIVISION');
      }
      const div = divisionsOf(h.state)[id as string]!;
      if (div.owner !== playerId) h.reject('E_FORBIDDEN');
      return div;
    };

    api.onAction('division.load', (action, h) => {
      const p = action.payload as { divisionId?: string; fleetId?: string };
      if (typeof p?.fleetId !== 'string') return h.reject('E_BAD_PAYLOAD');
      const div = ownDivision(h, p.divisionId, action.playerId);
      if (div.carriedBy != null) return h.reject('E_ALREADY_LOADED');
      const fleet = requireOwnedIdleFleet(h, p.fleetId, action.playerId);
      if (fleet.location !== div.location) return h.reject('E_NOT_COLOCATED');
      if (divisionCargo(div, h.ctx.data) > fleetCargoFree(h.state, fleet, h.ctx.data)) {
        return h.reject('E_NO_CARGO');
      }
      div.carriedBy = fleet.id;
      h.emit('division.loaded', { id: div.id, fleetId: fleet.id, owner: action.playerId, at: div.location });
    });

    api.onAction('division.unload', (action, h) => {
      const div = ownDivision(h, (action.payload as { divisionId?: string })?.divisionId, action.playerId);
      if (div.carriedBy == null) return h.reject('E_NOT_LOADED');
      const fleet = requireOwnedIdleFleet(h, div.carriedBy, action.playerId);
      const target = fleet.location;
      div.carriedBy = null;
      div.location = target;
      const planet = h.state.planets[target];
      if (
        planet &&
        planet.owner !== div.owner &&
        isCapturable(h.ctx.data, planet) &&
        (planet.owner === null || atWar(h.state, div.owner, planet.owner)) &&
        !planet.garrison.some((srv) => srv.count > 0) &&
        !divisionsAt(h.state, target).some((d) => d.owner !== div.owner)
      ) {
        const from = planet.owner;
        planet.owner = div.owner;
        h.emit('planet.captured', { planetId: target, owner: div.owner, from, via: 'ground' });
      }
      h.emit('division.unloaded', { id: div.id, fleetId: fleet.id, owner: action.playerId, at: target });
    });

    // NOTE: there is deliberately NO runtime officer attach/detach action. Officers
    // arrive ONLY with their locked premade (`division.mobilize {officer: true}`).

    api.on('time.advanced', (event, h) => {
      const { from, to } = event.payload as { from: number; to: number };
      const span = to - from;
      if (span <= 0) return;
      const elapsed = span * timeScaleOf(h.ctx);
      const divs = divisionsOf(h.state);
      for (const id of Object.keys(divs)) {
        const d = divs[id]!;
        if (d.carriedBy != null && !Object.prototype.hasOwnProperty.call(h.state.fleets, d.carriedBy)) {
          h.emit('division.lost', { id, owner: d.owner });
          delete divs[id];
        }
      }
      runGroundCombat(h, elapsed);
      const days = elapsed / DAY;
      if (days <= 0) return;
      for (const div of Object.values(divisionsOf(h.state))) {
        if (div.carriedBy != null) continue;
        const planet = h.state.planets[div.location];
        if (!planet || planet.owner !== div.owner) continue;
        if (groundContested(h.state, div.location)) continue;
        if (!div.units.some((s) => s.count > 0)) continue;
        regenDivision(div, days);
      }
    });
  },
};
