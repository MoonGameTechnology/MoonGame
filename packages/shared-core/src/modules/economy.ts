import type { GameModule, HandlerContext } from '../kernel/module';
import type { GameState, Planet, UnitStack } from '../state/gameState';
import type { GameData, ResourceBag } from '../data/schemas';
import { buildingLevel } from '../data/schemas';
import { bombardedPlanets } from '../state/orbit';
import { battleLocations } from '../state/battle';
import type { Context } from '../action/types';
import { hoursToMs, timeScaleOf } from '../action/types';
import { buildProgress, thresholdRamp, acceptedConstructionHours } from '../util/construction';
import { MS_PER_HOUR, MS_PER_DAY } from '../util/time';
import { feedsOnBiomass, isInfected } from '../util/infestation';

/** Narrow read of a `construction.complete` event's payload — economy never imports
 *  the construction module (modules never import each other), so it re-declares just
 *  the fields it needs off the shared, plain-data `scheduled` queue. */
interface ConstructionPayload {
  durationHours?: number;
  kind?: 'building' | 'unit' | 'upgrade';
  planetId?: string;
  building?: string;
  level?: number;
}

/** Output multiplier for a building whose upkeep resource is in arrears: the lights
 *  dim, they don't go out — half rate keeps a starved economy limping (and honest)
 *  instead of dead-spiralling to zero. */
export const BROWNOUT = 0.5;

/** Base hourly production of a planet = the sum of its buildings' `produces`, each at
 *  its current level. A building whose upkeep names a resource the OWNER failed to pay
 *  last settlement (`Player.arrears`) runs at `BROWNOUT` of its output. A Swarm organ
 *  (`infected`) produces nothing for an owner that does not feed on biomass
 *  (`util/infestation.ts`, решение владельца 2026-09-24). */
function baseProduction(
  planet: Planet,
  data: GameData,
  arrears: readonly string[] | undefined,
  eatsBiomass: boolean,
): ResourceBag {
  const out: Record<string, number> = {};
  for (const building of planet.buildings) {
    const def = data.buildings[building.type];
    if (!def || (!eatsBiomass && isInfected(def))) {
      continue;
    }
    const level = buildingLevel(def, building.level);
    const starved =
      arrears !== undefined &&
      arrears.length > 0 &&
      Object.keys(level.upkeep).some((res) => (level.upkeep[res] ?? 0) > 0 && arrears.includes(res));
    const mult = starved ? BROWNOUT : 1;
    for (const res of Object.keys(level.produces)) {
      out[res] = (out[res] ?? 0) + (level.produces[res] ?? 0) * mult;
    }
  }
  return out;
}

/** Sum two resource bags (`a + b`). */
function mergeBags(a: ResourceBag, b: ResourceBag): ResourceBag {
  const out: Record<string, number> = { ...a };
  for (const [res, amt] of Object.entries(b)) out[res] = (out[res] ?? 0) + amt;
  return out;
}

/** A rate bag times `k` hours: the amounts it yields. */
function scaleBag(bag: ResourceBag, k: number): ResourceBag {
  const out: Record<string, number> = {};
  for (const res of Object.keys(bag)) out[res] = (bag[res] ?? 0) * k;
  return out;
}

/** A construction in progress on a planet, as the output it adds on top of
 *  `baseProduction`'s fully-built total:
 *   - a FRESH build (`kind: 'building'`, not yet in `planet.buildings` at all) ramps
 *     in at the 50%-progress threshold, 1:1 with progress up to its full level-1
 *     output at 100% (nothing before the threshold);
 *   - an UPGRADE (`kind: 'upgrade'`) keeps producing its CURRENT level's full output
 *     throughout — already counted in full by `baseProduction`, since the instance
 *     stays at its old level until the upgrade lands — and ramps in only the DELTA
 *     to the target level's output, same threshold rule.
 *  A PAUSED site has no `scheduled` entry any more (construction.ts's cancel removes
 *  it) — its frozen share is credited separately by `pausedProduction` below, since a
 *  paused site's progress no longer changes with `now` the way an active one's does.
 *
 *  The ramp adds `full × progress` from its 50% instant (`from`) to completion (`to`):
 *  linear in time, which is what lets `settleRamped` integrate it exactly however the
 *  world's time is cut into spans. */
interface Ramp {
  full: ResourceBag;
  from: number;
  to: number;
  durationMs: number;
}

/** Every construction ramp on `planet` (see `Ramp`), from its `scheduled` events. */
function rampsOn(
  scheduled: GameState['scheduled'],
  pricing: Pick<GameState, 'pricing'>,
  planet: Planet,
  data: GameData,
  ctx: Context,
): Ramp[] {
  const out: Ramp[] = [];
  const add = (full: ResourceBag, completesAt: number, durationMs: number): void => {
    out.push({ full, from: completesAt - durationMs * 0.5, to: completesAt, durationMs });
  };
  for (const event of scheduled) {
    if (event.type !== 'construction.complete') {
      continue;
    }
    const p = event.payload as ConstructionPayload;
    if (p.planetId !== planet.id) {
      continue;
    }
    if (p.kind === 'building' && typeof p.building === 'string') {
      const def = data.buildings[p.building];
      if (!def) continue;
      const level1 = buildingLevel(def, 1);
      add(level1.produces, event.at, hoursToMs(ctx, acceptedConstructionHours(pricing, data, p)));
    } else if (p.kind === 'upgrade' && typeof p.building === 'string' && typeof p.level === 'number') {
      const def = data.buildings[p.building];
      const instance = planet.buildings.find((b) => b.type === p.building);
      if (!def || !instance) continue;
      const current = buildingLevel(def, instance.level);
      const target = buildingLevel(def, p.level);
      const delta: Record<string, number> = {};
      const resources = new Set([...Object.keys(current.produces), ...Object.keys(target.produces)]);
      for (const res of resources) {
        delta[res] = (target.produces[res] ?? 0) - (current.produces[res] ?? 0);
      }
      add(delta, event.at, hoursToMs(ctx, acceptedConstructionHours(pricing, data, p)));
    }
  }
  return out;
}

/** What a planet whose output grows inside [from, to] yields over it, as amounts (not a
 *  rate). Output without a ramp is one hook call over the whole span (the caller): every
 *  `economy.production` hook either scales it by a constant or, like `integration`, by a
 *  share linear in time, whose mean over a span is the mean of its ends. A ramp past its
 *  50% mark grows linearly too, and the product of two linear ramps is quadratic — the
 *  mean of each, multiplied, is not the mean of the product, and a coarse span (a
 *  long-offline catch-up, a backgrounded tab at high speed) would credit differently from
 *  a fine one. So the span is cut at every ramp's start and end, and each piece is
 *  integrated by Simpson's rule, exact for a quadratic, asking the hooks at an instant
 *  (`from === to`). Without a share that varies in time this is the old trapezoid of the
 *  ramp, the same amount however the span is cut. */
function settleRamped(
  h: HandlerContext,
  planetId: string,
  steady: ResourceBag,
  ramps: readonly Ramp[],
  from: number,
  to: number,
): ResourceBag {
  const cuts = [from, to];
  for (const r of ramps) for (const t of [r.from, r.to]) if (t > from && t < to) cuts.push(t);
  cuts.sort((a, b) => a - b);
  const scale = timeScaleOf(h.ctx);
  const out: Record<string, number> = {};
  for (let i = 1; i < cuts.length; i += 1) {
    const a = cuts[i - 1]!;
    const b = cuts[i]!;
    if (b <= a) continue;
    // Cut at every ramp's ends, a piece lies wholly inside or outside each ramp.
    const live = ramps.filter((r) => r.from <= a && r.to >= b);
    const at = (t: number): ResourceBag => {
      const bag: Record<string, number> = { ...steady };
      for (const r of live) {
        const progress = buildProgress(t, r.to, r.durationMs);
        for (const res of Object.keys(r.full)) bag[res] = (bag[res] ?? 0) + (r.full[res] ?? 0) * progress;
      }
      return h.hook<ResourceBag>('economy.production', bag, { planetId, from: t, to: t });
    };
    const samples = [at(a), at((a + b) / 2), at(b)];
    const hours = ((b - a) / MS_PER_HOUR) * scale;
    for (const [k, rate] of samples.entries()) {
      const weight = (k === 1 ? 4 : 1) / 6;
      for (const res of Object.keys(rate)) out[res] = (out[res] ?? 0) + (rate[res] ?? 0) * weight * hours;
    }
  }
  return out;
}

/** Bonus production from PAUSED sites (construction.ts `construction.cancel` parks a
 *  cancelled order here instead of discarding it): pausing halts further
 *  CONSTRUCTION, not the share of the building already standing — it keeps
 *  contributing whatever it had reached, same 50%-threshold rule as an active build,
 *  but FROZEN at `site.progress` rather than advancing (nothing is scheduled to tick
 *  it forward while paused). Unlike an active site's `Ramp`, a paused site's rate
 *  never changes across a span, so this is already an exact constant rate — no
 *  span-integration needed. */
function pausedProduction(planet: Planet, data: GameData): ResourceBag {
  const out: Record<string, number> = {};
  for (const site of planet.pausedConstruction ?? []) {
    const ramp = thresholdRamp(site.progress);
    if (ramp <= 0) continue;
    if (site.kind === 'building' && typeof site.building === 'string') {
      const def = data.buildings[site.building];
      if (!def) continue;
      const level1 = buildingLevel(def, 1);
      for (const res of Object.keys(level1.produces)) {
        out[res] = (out[res] ?? 0) + (level1.produces[res] ?? 0) * ramp;
      }
    } else if (site.kind === 'upgrade' && typeof site.building === 'string' && typeof site.level === 'number') {
      const def = data.buildings[site.building];
      const instance = planet.buildings.find((b) => b.type === site.building);
      if (!def || !instance) continue;
      const current = buildingLevel(def, instance.level);
      const target = buildingLevel(def, site.level);
      const resources = new Set([...Object.keys(current.produces), ...Object.keys(target.produces)]);
      for (const res of resources) {
        const delta = (target.produces[res] ?? 0) - (current.produces[res] ?? 0);
        if (delta !== 0) out[res] = (out[res] ?? 0) + delta * ramp;
      }
    }
  }
  return out;
}

/** Daily upkeep owed per owner for every unit in the world — ship stacks,
 *  landing troops and planet garrisons — aggregated in ONE pass over fleets and
 *  planets (O(world), not O(players × world)). An owner with no upkeep-bearing
 *  units has no entry. `planetIds` are the planet ids sorted, as the production pass
 *  already sorted them for the same span: nothing between the two adds a world.
 *  `unitShare` is the owner's multiplier on unit upkeep (the `economy.unitUpkeep` hook);
 *  buildings are billed as listed. */
function upkeepByOwner(
  state: GameState,
  data: GameData,
  planetIds: readonly string[],
  unitShare: (owner: string) => number,
): Map<string, ResourceBag> {
  const out = new Map<string, ResourceBag>();
  const addStacks = (owner: string, stacks: UnitStack[]) => {
    const share = unitShare(owner);
    for (const stack of stacks) {
      const def = data.units[stack.unit];
      if (!def) {
        continue;
      }
      let bag = out.get(owner);
      if (!bag) {
        out.set(owner, (bag = {}));
      }
      for (const res of Object.keys(def.upkeep)) {
        bag[res] = (bag[res] ?? 0) + (def.upkeep[res] ?? 0) * stack.count * share;
      }
    }
  };
  // Sorted walks (BF-13): several fleets/planets of one owner add into the SAME
  // resource cell, and float addition is order-sensitive — a JSONB round-trip
  // (hibernation) re-orders object keys, so an insertion-order walk diverges
  // from the replay. Sorting pins the summation order to the data, not the store.
  for (const id of Object.keys(state.fleets).sort()) {
    const fleet = state.fleets[id]!;
    addStacks(fleet.owner, fleet.units);
    if (fleet.landing) addStacks(fleet.owner, fleet.landing);
  }
  for (const pid of planetIds) {
    const planet = state.planets[pid]!;
    // Десант на плацдарме содержит его владелец, на чьей бы земле он ни стоял: с MSB-9 весь
    // штурмующий десант живёт плацдармом до конца боя, и без этой строки штурм снимал
    // содержание с войск на каждый его час (замечание Codex на #1392).
    for (const b of planet.beachheads ?? []) addStacks(b.owner, b.units);
    if (planet.owner === null) {
      continue;
    }
    addStacks(planet.owner, planet.garrison);
    // Standing buildings bill their owner daily too (destroyed ones are gone from
    // the array, so nothing dead is ever billed). A Swarm organ bills only the Swarm:
    // to anyone else it is dead tissue awaiting clearance (`util/infestation.ts`).
    const eatsBiomass = feedsOnBiomass(state, planet.owner, data);
    for (const building of planet.buildings) {
      const def = data.buildings[building.type];
      if (!def || (!eatsBiomass && isInfected(def))) {
        continue;
      }
      const upkeep = buildingLevel(def, building.level).upkeep;
      let bag = out.get(planet.owner);
      for (const res of Object.keys(upkeep)) {
        const perDay = upkeep[res] ?? 0;
        if (perDay === 0) {
          continue;
        }
        if (!bag) {
          out.set(planet.owner, (bag = {}));
        }
        bag[res] = (bag[res] ?? 0) + perDay;
      }
    }
    // A paused site past its 50% mark keeps producing its frozen share
    // (`pausedProduction`), so it pays the same share of its upkeep. Without this a build
    // parked at 99% gave 99% of the output for free, indefinitely.
    for (const [res, perDay] of Object.entries(pausedUpkeep(planet, data, eatsBiomass))) {
      if (perDay === 0) continue;
      let bag = out.get(planet.owner);
      if (!bag) out.set(planet.owner, (bag = {}));
      bag[res] = (bag[res] ?? 0) + perDay;
    }
  }
  return out;
}

/** Daily upkeep of a planet's PAUSED sites: the frozen share (`thresholdRamp`) of what
 *  the finished work would cost, the mirror of `pausedProduction`. A fresh building
 *  owes its level-1 upkeep, an upgrade the rise over its current level. */
export function pausedUpkeep(planet: Planet, data: GameData, eatsBiomass: boolean): ResourceBag {
  const out: Record<string, number> = {};
  for (const site of planet.pausedConstruction ?? []) {
    const ramp = thresholdRamp(site.progress);
    if (ramp <= 0 || typeof site.building !== 'string') continue;
    const def = data.buildings[site.building];
    if (!def || (!eatsBiomass && isInfected(def))) continue;
    if (site.kind === 'building') {
      const level1 = buildingLevel(def, 1).upkeep;
      for (const res of Object.keys(level1)) out[res] = (out[res] ?? 0) + (level1[res] ?? 0) * ramp;
    } else if (site.kind === 'upgrade' && typeof site.level === 'number') {
      const instance = planet.buildings.find((b) => b.type === site.building);
      if (!instance) continue;
      const current = buildingLevel(def, instance.level).upkeep;
      const target = buildingLevel(def, site.level).upkeep;
      for (const res of Object.keys(target)) {
        const rise = (target[res] ?? 0) - (current[res] ?? 0);
        if (rise > 0) out[res] = (out[res] ?? 0) + rise * ramp;
      }
    }
  }
  return out;
}

/** A player's whole daily bill: the `economy.upkeep` pipeline over what their units and
 *  buildings cost. A broken result (not a bag of finite, non-negative numbers) bills the
 *  base: a broken pipeline neither pays the player nor poisons the treasury. */
function billOf(h: HandlerContext, playerId: string, base: ResourceBag): ResourceBag {
  const raw = h.hook<ResourceBag>('economy.upkeep', { ...base }, { playerId });
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return base;
  for (const v of Object.values(raw)) {
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) return base;
  }
  return raw;
}

/** Construction completions by planet — one pass over the queue, not one per planet.
 *  `rampsOn` takes each list in the queue's own order. */
function buildsByPlanet(scheduled: GameState['scheduled']): Map<unknown, GameState['scheduled']> {
  const builds = new Map<unknown, GameState['scheduled']>();
  for (const event of scheduled) {
    if (event.type !== 'construction.complete') continue;
    const planetId = (event.payload as ConstructionPayload).planetId;
    const list = builds.get(planetId);
    if (list) list.push(event);
    else builds.set(planetId, [event]);
  }
  return builds;
}

/** An owner's multiplier on unit upkeep (the `economy.unitUpkeep` hook), asked once per
 *  owner. A broken multiplier bills the base rate rather than paying the owner (negative)
 *  or poisoning the treasury (non-finite). */
function unitShares(h: HandlerContext): (owner: string) => number {
  const shares = new Map<string, number>();
  return (owner) => {
    let share = shares.get(owner);
    if (share === undefined) {
      const raw = h.hook<number>('economy.unitUpkeep', 1, { playerId: owner });
      share = Number.isFinite(raw) && raw >= 0 ? raw : 1;
      shares.set(owner, share);
    }
    return share;
  };
}

/** Each listed owner's hourly output at the instant `at`: what the settlement credits
 *  there — the same buildings, brownout and `economy.production` hooks, a construction
 *  ramp at its share of that instant. A world under bombardment or in battle yields
 *  nothing, as in the settlement. */
function incomeAt(
  h: HandlerContext,
  planetIds: readonly string[],
  at: number,
  owners: ReadonlyMap<string, unknown>,
): Map<string, Record<string, number>> {
  const data = h.ctx.data;
  const bombarded = bombardedPlanets(h.state, data);
  const fighting = battleLocations(h.state);
  const builds = buildsByPlanet(h.state.scheduled);
  const out = new Map<string, Record<string, number>>();
  for (const planetId of planetIds) {
    const planet = h.state.planets[planetId]!;
    if (planet.owner === null || !owners.has(planet.owner)) continue;
    const player = h.state.players[planet.owner];
    if (!player || bombarded.has(planetId) || fighting.has(planetId)) continue;
    const bag: Record<string, number> = mergeBags(
      baseProduction(planet, data, player.arrears, feedsOnBiomass(h.state, planet.owner, data)),
      pausedProduction(planet, data),
    );
    for (const r of rampsOn(builds.get(planetId) ?? [], h.state, planet, data, h.ctx)) {
      if (r.from > at || r.to <= at) continue;
      const progress = buildProgress(at, r.to, r.durationMs);
      for (const res of Object.keys(r.full)) bag[res] = (bag[res] ?? 0) + (r.full[res] ?? 0) * progress;
    }
    const rate = h.hook<ResourceBag>('economy.production', bag, { planetId, from: at, to: at });
    let total = out.get(planet.owner);
    if (!total) out.set(planet.owner, (total = {}));
    for (const res of Object.keys(rate)) total[res] = (total[res] ?? 0) + (rate[res] ?? 0);
  }
  return out;
}

/** PE-2.2: the first instant inside `(from, to)` at which a player's treasury runs dry of a
 *  resource it is billed in — as the whole millisecond just past it, so the settlement
 *  there finds the bill short — or at which a brownout can lift, or `Infinity`. The economy settles a span with the
 *  arrears of the LAST settlement, so a span that ran on past the dry instant paid full
 *  output for hours the player had nothing to run on; the length of a span is not ours
 *  (an unwatched match catches a night up in one, a watched one ticks every second).
 *  Stopping the world there lets the brownout start where the treasury ran out.
 *
 *  Only a bill the treasury could not cover on its own over the span can run dry inside
 *  it, so only those owners' income is worked out. The rate is the one at `from`: output
 *  only grows inside a span (a construction ramp, a world settling in), so a dry instant
 *  never comes later than the estimate — at worst the world stops early and the next span
 *  looks again. Brownout only lowers output, so a bill short at brownout stays short and
 *  nothing flips back and forth.
 *
 *  The other way round: a resource in arrears with nothing in store whose income now
 *  covers its bill (a new reactor) is paid by the very next instant, so the world stops a
 *  millisecond on — the settlement there lifts the brownout instead of the whole span
 *  running browned out. */
function dryInstant(h: HandlerContext, from: number, to: number): number {
  const data = h.ctx.data;
  const scale = timeScaleOf(h.ctx);
  const spanDays = ((to - from) / MS_PER_DAY) * scale;
  const planetIds = Object.keys(h.state.planets).sort();
  const upkeepPerOwner = upkeepByOwner(h.state, data, planetIds, unitShares(h));
  // Per owner: [resource, bill per day, browned out with nothing in store].
  const atRisk = new Map<string, Array<[string, number, boolean]>>();
  for (const playerId of Object.keys(h.state.players).sort()) {
    const player = h.state.players[playerId]!;
    const bill = billOf(h, playerId, upkeepPerOwner.get(playerId) ?? {});
    const risky: Array<[string, number, boolean]> = [];
    for (const res of Object.keys(bill).sort()) {
      const perDay = bill[res] ?? 0;
      const have = player.resources[res] ?? 0;
      if (perDay <= 0 || have >= perDay * spanDays) continue; // lasts the span with no income
      risky.push([res, perDay, have <= 0 && player.arrears?.includes(res) === true]);
    }
    if (risky.length > 0) atRisk.set(playerId, risky);
  }
  if (atRisk.size === 0) return Infinity;
  const income = incomeAt(h, planetIds, from, atRisk);
  let dry = Infinity;
  for (const [playerId, risky] of atRisk) {
    const have = h.state.players[playerId]!.resources;
    const rate = income.get(playerId) ?? {};
    for (const [res, perDay, brownedOut] of risky) {
      const netPerMs = ((rate[res] ?? 0) / MS_PER_HOUR - perDay / MS_PER_DAY) * scale;
      if (brownedOut) {
        // Covered again — by a clear margin: income that only just matches the bill could
        // settle a millisecond short by a float's last digit and stop the world every
        // millisecond after; such a bill lifts at the span's end, as before.
        const billPerMs = (perDay / MS_PER_DAY) * scale;
        if (netPerMs > billPerMs * 1e-9) dry = Math.min(dry, from + 1);
        continue;
      }
      if (!(netPerMs < 0)) continue;
      const at = from + (have[res] ?? 0) / -netPerMs;
      dry = Math.min(dry, Math.max(from + 1, Math.floor(at) + 1));
    }
  }
  return dry < to ? dry : Infinity;
}

/**
 * Economy — a base module (docs/modulesystem.md). On every `time.advanced` span
 * it settles the player economy by formula over elapsed real time
 * (docs/architecture.md §4.1):
 *
 *   - production: each owned planet feeds its owner's treasury
 *     (`Player.resources`), scaled by the `economy.production` hook;
 *   - upkeep: each player pays daily maintenance for their units, drained from
 *     the same treasury (clamped at zero — a deficit just leaves you at empty). The
 *     `economy.unitUpkeep` hook scales an owner's unit bill (base 1, args `{ playerId }`),
 *     and the `economy.upkeep` hook adds what the world's units and buildings do not
 *     know about (base — that bill, args `{ playerId }`; the espionage module puts its
 *     spies' pay here). An unpaid addition enters arrears like any other bill.
 *
 * Both scale with `timeScale`, like every other match timer (GDD §3.1).
 */
export const economyModule: GameModule = {
  id: 'economy',
  // 1.1.0: содержание войск на плацдармах (замечание Codex на #1392).
  // 1.2.0: `economy.production` names the span it settles (`from`, `to`), BAL-19.
  // 1.3.0: a construction ramp is settled by Simpson's rule, exact under a share that
  // changes with time (замечание Codex на #1996).
  // 1.4.0: хук `economy.unitUpkeep` — множитель содержания войск владельца (BAL-19).
  // 1.4.2: приостановленная стройка платит содержание за ту долю, которую производит.
  // 1.5.0: хук `economy.upkeep` — счёт игрока целиком (зарплата шпионов).
  // 1.6.0: мир останавливается в миг, когда казна игрока иссякла по счёту, и блэкаут идёт
  // с этого мига, а не с конца отрезка (PE-2.2).
  version: '1.6.0',
  setup(api) {
    // PE-2.2: stop the world where a treasury runs dry ({@link dryInstant}).
    api.hook<number>('time.stop', (stop, args, h) => {
      const { from, to } = args as { from: number; to: number };
      return Math.min(stop, dryInstant(h, from, Math.min(stop, to)));
    });
    api.on('time.advanced', (event, h) => {
      const { from, to } = event.payload as { from: number; to: number };
      const span = to - from;
      if (span <= 0) {
        return;
      }
      const scale = timeScaleOf(h.ctx);
      const hours = (span / MS_PER_HOUR) * scale;
      const days = (span / MS_PER_DAY) * scale;
      const data = h.ctx.data;
      const bombarded = bombardedPlanets(h.state, data); // O(fleets) once, then O(1) per planet
      // Решение владельца 17: бой на узле глушит производство так же, как обстрел. Оба
      // набора считаются ОДНИМ проходом каждый — иначе на каждый узел пришлось бы
      // перебирать все бои и все флоты.
      const fighting = battleLocations(h.state);
      const builds = buildsByPlanet(h.state.scheduled);

      // Sorted (BF-13): several planets credit the same treasury cell — float
      // addition order must not depend on JSONB key order after hibernation.
      const planetIds = Object.keys(h.state.planets).sort();
      for (const planetId of planetIds) {
        const planet = h.state.planets[planetId];
        if (!planet || planet.owner === null) {
          continue; // neutral / unclaimed sectors do not produce
        }
        const player = h.state.players[planet.owner];
        if (!player) {
          continue; // owner without a player record → nothing to credit
        }
        if (bombarded.has(planetId) || fighting.has(planetId)) {
          continue; // узел не работает: обстрел (GDD §7.4) либо бой прямо здесь
        }
        // Arrears from the LAST settlement dim this span's output, and a PAUSED construction
        // keeps its frozen share (only further construction halts). A span never runs past
        // the instant a bill runs dry or can be paid again: the world is stopped there
        // ({@link dryInstant}, PE-2.2), so the brownout follows the treasury however the
        // span is cut.
        const steady = mergeBags(
          baseProduction(planet, data, player.arrears, feedsOnBiomass(h.state, planet.owner, data)),
          pausedProduction(planet, data),
        );
        // Constructions past their 50% mark chip in a growing share on top.
        const ramps = rampsOn(builds.get(planetId) ?? [], h.state, planet, data, h.ctx).filter(
          (r) => r.from < to && r.to > from,
        );
        const gained =
          ramps.length > 0
            ? settleRamped(h, planetId, steady, ramps, from, to)
            : scaleBag(
                // The span rides along for a share that changes with time (`integration`).
                h.hook<ResourceBag>('economy.production', steady, { planetId, from, to }),
                hours,
              );
        for (const res of Object.keys(gained)) {
          const amount = gained[res] ?? 0;
          if (amount !== 0) {
            player.resources[res] = (player.resources[res] ?? 0) + amount;
          }
        }
      }

      const upkeepPerOwner = upkeepByOwner(h.state, data, planetIds, unitShares(h));
      for (const playerId of Object.keys(h.state.players).sort()) {
        const player = h.state.players[playerId];
        if (!player) {
          continue;
        }
        const upkeep = billOf(h, playerId, upkeepPerOwner.get(playerId) ?? {});
        // Settle the bill and record what went UNPAID: a resource whose drain pinned
        // the treasury at zero with a remainder owed enters arrears — next span its
        // consumers run at BROWNOUT until the debt is coverable again.
        const short: string[] = [];
        for (const res of Object.keys(upkeep)) {
          const perDay = upkeep[res] ?? 0;
          if (perDay === 0) {
            continue;
          }
          const have = player.resources[res] ?? 0;
          const owed = perDay * days;
          player.resources[res] = Math.max(0, have - owed);
          if (have < owed) {
            short.push(res);
          }
        }
        if (short.length > 0) {
          player.arrears = short.sort();
        } else if (player.arrears !== undefined) {
          delete player.arrears; // bills paid in full — the brownout lifts
        }
      }
    });
  },
};
