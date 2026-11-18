import type { GameModule, HandlerContext } from '../kernel/module';
import type { BuildingInstance, Fleet, UnitStack } from '../state/gameState';
import type { GameData } from '../data/schemas';
import { buildingLevel } from '../data/schemas';
import { hoursToMs, type Context } from '../action/types';
import { cappedUnitStat } from '../util/stacks';
import { requireOwnedIdleFleet } from '../util/fleet';
import { isActivelyBombarding } from '../state/orbit';
import { hasOrbit } from '../state/sectorKind';
import { isMineFleet } from '../state/minefields';
import { BLACKOUT_MULT } from '../state/visibility';
import {
  applyDamageToSide,
  hookedDamage,
  isHostile,
  mitigationFactor,
  removeIfWiped,
  type DamageHookArgs,
} from '../util/combat';
import { splitVolley } from '../util/volley';
import { fireOnGarrison, groundVolley, shipGroundDamage, type GroundVolley } from '../util/groundFire';
import { wearStructures } from '../util/structureDamage';
import { recordValues } from '../util/records';

/** Fraction of a bombarding fleet's firepower that rains on the planet below. */
export const BOMBARD_FRACTION = 0.5;

/** One game-hour of world time — the AA volley grid (same value the melee module
 *  uses for its round interval). */
const hourIntervalMs = (ctx: Context): number => hoursToMs(ctx, 1);

/** The ORBITAL AA tier: Σ the buildings' `aaDamage` — fixed heavy emplacements.
 *  Fires one full-strength volley per game-HOUR. */
function aaOrbitalAt(planet: { buildings: BuildingInstance[] }, data: GameData): number {
  let total = 0;
  for (const b of planet.buildings) {
    const def = data.buildings[b.type];
    if (def) total += buildingLevel(def, b.level).aaDamage;
  }
  return total;
}
/** The CLOSE (point-defense) AA tier: Σ the garrison units' `aaDamage` — mobile
 *  flak. Fires every QUARTER game-hour at a quarter of the hourly rate, so the
 *  hourly output matches the stat while the dodge window shrinks to 15 minutes. */
function aaCloseAt(planet: { garrison: UnitStack[] }, data: GameData): number {
  return cappedUnitStat(planet.garrison, data, 'aaDamage');
}

/** EVERY hostile, free fleet sitting on the NEAR orbit of `planetId`, in a fixed
 *  `id` order. If a pre-built `localFleets` index is supplied it avoids an
 *  O(all-fleets) scan.
 *
 *  MSB-7: this used to return ONE of them (the lowest id) and the whole volley
 *  landed on it. `id` order is effectively ARRIVAL order, so the gun punished
 *  whoever came first: a cheap decoy sent ahead soaked every volley while the
 *  strike group hung beside it untouched. That is not a balance number, it is an
 *  exploit, and it only existed above one hostile. The volley now splits over all
 *  of them (owner decision §0.0 №8), the same rule the melee round runs.
 *
 *  The `id` sort therefore no longer picks a victim — it survives only to fix the
 *  ORDER OF THE TRACERS, so the event stream does not depend on who docked first. */
function nearOrbitHostiles(
  h: HandlerContext,
  planetId: string,
  owner: string | null,
  localFleets?: readonly Fleet[],
): Fleet[] {
  const candidates =
    localFleets ?? recordValues(h.state.fleets).filter((f) => f.location === planetId);
  const hostiles: Fleet[] = [];
  for (const f of candidates) {
    if (f.orbit !== 'near' || f.battleId) {
      continue;
    }
    // Мина не подставляет себя под залп ПВО вместо кораблей (ревью #1411): на орбиту её
    // не пускает общий пропуск приказов, а старое состояние с миной на орбите сюда не
    // протечёт — правило по трейту стоит и здесь.
    if (isMineFleet(f, h.ctx.data)) {
      continue;
    }
    if (!f.units.some((s) => s.count > 0) || owner === null || !isHostile(h, owner, f.owner)) {
      continue;
    }
    hostiles.push(f);
  }
  return hostiles.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** Bombardment firepower a fleet rains on the planet, over at most COMBAT_UNIT_CAP
 *  units (the same firing line as melee).
 *
 *  Per hull: a SIEGE platform contributes its `siegeDamage` in full; every other
 *  hull contributes `attack × BOMBARD_FRACTION`, exactly as before (ROS-1.3). Two
 *  numbers, because one could not say «weak against ships, terrible for buildings»:
 *  while structural damage was a fraction of `attack`, a siege hull could only be
 *  made to wreck buildings by making it a strong warship too.
 *
 *  The choice is per HULL, not per fleet, so a mixed fleet needs one firing line
 *  over both formulas — hence the formula form of `cappedUnitStat`. */
function fleetBombardPower(fleet: Fleet, data: GameData): number {
  return cappedUnitStat(fleet.units, data, (stats) => {
    const siege = stats.siegeDamage ?? 0;
    return siege > 0 ? siege : (stats.attack ?? 0) * BOMBARD_FRACTION;
  });
}

/** Огонь обстреливающего флота по ВОЙСКАМ мира за час (ROS-1.6) — той же линией огня,
 *  по роду каждого юнита гарнизона (ROS-1.6b). */
function shipGroundPower(
  fleet: Fleet,
  planet: { garrison: UnitStack[] },
  data: GameData,
): GroundVolley {
  return groundVolley(fleet.units, planet.garrison, data, shipGroundDamage);
}

/** A world whose flak may fire in this span: owned, with an orbit, not holding off a
 *  ground assault, and armed at the span's start. Inside a span flak can only weaken —
 *  shelling wrecks emplacements and thins the crews, while new guns and troops arrive with
 *  an event, i.e. at a span's edge — so a world unarmed at the start stays silent to its end. */
interface FlakBattery {
  planetId: string;
  owner: string;
  /** Fleets on this node at the span's start: within the span they only leave it by dying. */
  localFleets: Fleet[] | undefined;
  /** ECON-2 «блэкаут» multiplier, fixed for the span like the arrears it reads. */
  aaMult: number;
}

/** The worlds whose flak may fire in this span.
 *
 *  Optimized with a fleet-by-location index and a ground-assault set so the
 *  cost is O(planets + fleets + battles) instead of O(planets × fleets). */
function flakBatteries(h: HandlerContext): FlakBattery[] {
  const data = h.ctx.data;

  // Pre-index fleets by location — O(fleets).
  const fleetsByLocation = new Map<string, Fleet[]>();
  for (const f of recordValues(h.state.fleets)) {
    if (f.location !== null) {
      const arr = fleetsByLocation.get(f.location);
      if (arr) arr.push(f);
      else fleetsByLocation.set(f.location, [f]);
    }
  }

  // Pre-index planets with an active ground assault — O(battles).
  const groundAssaults = new Set<string>();
  for (const b of Object.values(h.state.battles)) {
    if (b.phase === 'ground') groundAssaults.add(b.location);
  }

  const batteries: FlakBattery[] = [];
  for (const planetId of Object.keys(h.state.planets)) {
    const planet = h.state.planets[planetId];
    if (!planet) {
      continue;
    }

    // No orbital layer (asteroid field, nebula, dead world, debris) — nothing to
    // shell and nothing to shell FROM: neither AA nor bombardment happens here.
    if (!hasOrbit(data, planet)) {
      continue;
    }

    // AA — anti-ship, only when not defending the ground.
    if (planet.owner === null || groundAssaults.has(planetId)) {
      continue;
    }
    // ECON-2 «блэкаут»: unpaid energy halves BOTH flak tiers until the bill is
    // covered — same knob as the radar dim (BLACKOUT_MULT, visibility.ts).
    const starved = h.state.players[planet.owner]?.arrears?.includes('energy') === true;
    const aaMult = starved ? BLACKOUT_MULT : 1;
    if (aaOrbitalAt(planet, data) * aaMult > 0 || aaCloseAt(planet, data) * aaMult > 0) {
      batteries.push({ planetId, owner: planet.owner, localFleets: fleetsByLocation.get(planetId), aaMult });
    }
  }
  return batteries;
}

/** One flak volley of `battery` at `instant`. False when there is no hostile left in
 *  its orbit: then the world has nothing to shoot at for the rest of the span. */
function flakVolley(
  h: HandlerContext,
  battery: FlakBattery,
  damage: number,
  tier: 'orbital' | 'close',
  instant: number,
): boolean {
  const { planetId, owner } = battery;
  // Re-aim every volley: a target destroyed mid-span frees its share of the
  // next strike for the hostiles still hanging in orbit.
  const targets = nearOrbitHostiles(h, planetId, owner, battery.localFleets);
  if (targets.length === 0) return false;
  // MSB-7 — the volley is SPLIT over every hostile in near orbit, by the same
  // shared rule the melee round runs (`splitVolley`). One gun, one firing
  // solution, no target selection: the flak cannot be baited onto a decoy,
  // and with one hostile the split degenerates into the old behaviour exactly.
  const enemies = targets.map((f) => ({
    ref: { kind: 'fleet' as const, fleetId: f.id },
    owner: f.owner,
  }));
  for (const [i, share] of splitVolley(damage, enemies).entries()) {
    const target = targets[i]!;
    // CORE-DMG-1: flak runs through the SAME extension point as a melee round, so
    // a technology bonus or faction passive reaches it. `phase` names the near-orbit
    // layer and is never 'ground', so the fort / planet-type mitigations (which
    // guard on the ground phase) stay out of the flak exchange.
    // The hook is called PER SHARE, not once for the whole volley, for the reason
    // the melee round calls it per pair: its subscribers measure the relation of
    // two concrete owners, and one call would make their contributions
    // indistinguishable.
    // Scaled BEFORE the announcement: the tracer must carry the number that really
    // lands, or the client draws one volley and the hull loses another.
    const dealt = hookedDamage(h, share.damage, {
      phase: 'orbital',
      location: planetId,
      attacker: owner,
      defender: target.owner,
      // `attackerFleet` нет намеренно: стреляет МИР. Ауры героя — бонус флотам.
      defenderFleet: target.id,
    });
    // Announce BEFORE applying: the client draws the flak burst planet→fleet
    // even when this very volley destroys the target (H2 — visible AA fire).
    // One tracer PER SHARE — a single event for a split volley would draw one
    // burst where three hulls took damage.
    h.emit('aa.fired', {
      planetId,
      owner,
      fleetId: target.id,
      by: target.owner,
      damage: dealt,
      tier,
    });
    const stamped = target.lastDamagedAt;
    applyDamageToSide(h, share.to, dealt, h.ctx.data, planetId, undefined, undefined, owner);
    // The shared damage path stamps a hit with `h.ctx.now` — the END of this span. The
    // volley landed at `instant`, inside it: re-stamp, so a shield waits out its delay from
    // the volley itself, however long the span (FORT-5.17).
    if (target.lastDamagedAt !== stamped) target.lastDamagedAt = instant;
    removeIfWiped(h, target.id);
  }
  return true;
}

/** One quarter-hour mark `q` of a world's flak, at `instant`. Two tiers, both firing
 *  discrete VOLLEYS on the world-time grid (a fleet slipping in and out of orbit
 *  BETWEEN volleys escapes untouched — timing a raid past the flak matters):
 *    - ORBITAL (buildings): one full-strength volley per game-HOUR;
 *    - CLOSE (garrison units): a quarter-strength volley every QUARTER-hour —
 *      same hourly output, but only a 15-minute window to dodge.
 *  The quarter grid contains the hour grid; at a shared mark the heavy orbital volley
 *  lands first. Both tiers are read AT the mark: shelling earlier in the span may have
 *  wrecked an emplacement or thinned the crews (FORT-5.17). False once the world has
 *  nothing to shoot at or nothing left to shoot with — silent for the rest of the span. */
function fireFlak(h: HandlerContext, battery: FlakBattery, q: number, instant: number): boolean {
  const planet = h.state.planets[battery.planetId];
  if (!planet) return false;
  const aaOrbital = aaOrbitalAt(planet, h.ctx.data) * battery.aaMult;
  const aaClose = aaCloseAt(planet, h.ctx.data) * battery.aaMult;
  if (aaOrbital <= 0 && aaClose <= 0) return false;
  if (aaOrbital > 0 && q % 4 === 0 && !flakVolley(h, battery, aaOrbital, 'orbital', instant)) return false;
  if (aaClose > 0 && !flakVolley(h, battery, aaClose / 4, 'close', instant)) return false;
  return true;
}

/** Start a fleet's bombardment clock: the first volley lands one game hour from now,
 *  like the first strike of a melee attack order (`battle.attack`). */
function armBombard(h: HandlerContext, fleet: Fleet): void {
  fleet.bombardNextAt = h.ctx.now + hourIntervalMs(h.ctx);
}

/** Every bombardment volley due by `to` — before it, or also on it when `closed` — in
 *  (instant, fleet id) order. The clock is absolute (`fleet.bombardNextAt`), so one long
 *  span and many short ones see the same volleys at the same instants. A fleet that stopped
 *  bombarding drops its clock; one left bombarding without a clock (an old save) starts it
 *  at the span start. */
function dueBombardVolleys(
  h: HandlerContext,
  from: number,
  to: number,
  closed: boolean,
): Array<{ at: number; fleet: Fleet }> {
  const hourMs = hourIntervalMs(h.ctx);
  const due: Array<{ at: number; fleet: Fleet }> = [];
  for (const f of recordValues(h.state.fleets)) {
    if (!f.bombarding) {
      if (f.bombardNextAt !== undefined) delete f.bombardNextAt;
      continue;
    }
    if (f.bombardNextAt === undefined) f.bombardNextAt = from + hourMs;
    for (let at = f.bombardNextAt; closed ? at <= to : at < to; at += hourMs) due.push({ at, fleet: f });
  }
  return due.sort((a, b) => a.at - b.at || (a.fleet.id < b.fleet.id ? -1 : a.fleet.id > b.fleet.id ? 1 : 0));
}

/** The orbital layer over one continuous span `(from, to)`: the worlds' flak on the
 *  quarter-hour grid and every fleet's bombardment volley on its own clock, IN THE ORDER
 *  OF TIME (FORT-5.17). The span's length is not ours — an unwatched match sleeps to its
 *  next event, a watched one ticks every second — so the two fires must interleave as they
 *  would tick by tick: a shelled emplacement stops firing, a fleet downed by flak lands
 *  the volleys it fired before, with the strength it had then. At one instant the flak
 *  lands first.
 *
 *  A volley ON the span's end `to` is not this span's: it lands on the `time.stopped` step
 *  at `to` ({@link runOrbitalInstant}), after every module has accrued the span — so the
 *  hull a dock or a repair bay mended before the volley is there when it hits. The hook
 *  `time.stop` ends a span on every next volley ({@link nextVolleyAt}), so a span never
 *  holds one inside; this loop is the guard if a span arrives uncut. */
function runOrbitalSpan(h: HandlerContext, from: number, to: number): void {
  const hourMs = hourIntervalMs(h.ctx); // one game-hour of world time
  const quarterMs = hourMs / 4;
  let q = Math.floor(from / quarterMs) + 1;
  const lastQ = Math.ceil(to / quarterMs) - 1;
  let batteries = q <= lastQ ? flakBatteries(h) : [];
  const volleys = dueBombardVolleys(h, from, to, false);
  let next = 0;
  for (;;) {
    const flakAt = batteries.length > 0 && q <= lastQ ? q * quarterMs : Infinity;
    const shellAt = next < volleys.length ? volleys[next]!.at : Infinity;
    if (flakAt === Infinity && shellAt === Infinity) return;
    if (flakAt <= shellAt) {
      const mark = q++;
      batteries = batteries.filter((battery) => fireFlak(h, battery, mark, flakAt));
      continue;
    }
    const { at, fleet } = volleys[next++]!;
    // A volley earlier in this span may have ended the bombardment (the fleet is gone
    // or no longer shelling): its later volleys do not land.
    if (h.state.fleets[fleet.id] !== fleet || !fleet.bombarding) continue;
    fireBombardVolley(h, fleet);
    fleet.bombardNextAt = at + hourMs;
  }
}

/** The volleys due ON `at`: the `time.stopped` step there. Flak only when `at` is a mark of
 *  its grid — another module may stop the world between marks, and the mark before it has
 *  had its own step. Bombardment by each fleet's clock (an overdue tick lands now too). */
function runOrbitalInstant(h: HandlerContext, at: number): void {
  const hourMs = hourIntervalMs(h.ctx);
  const quarterMs = hourMs / 4;
  const q = Math.round(at / quarterMs);
  // Flak lands first at one instant, as inside a span.
  if (q * quarterMs === at) for (const battery of flakBatteries(h)) fireFlak(h, battery, q, at);
  for (const { at: due, fleet } of dueBombardVolleys(h, at, at, true)) {
    if (h.state.fleets[fleet.id] !== fleet || !fleet.bombarding) continue;
    fireBombardVolley(h, fleet);
    fleet.bombardNextAt = due + hourMs;
  }
}

/** The next instant after `from` on which a volley is due: the next quarter-hour mark
 *  while some world's flak has a target, or a bombarding fleet's next clock tick. Reads
 *  the world at the span's start only — the `time.stop` contract. */
function nextVolleyAt(h: HandlerContext, from: number, limit: number): number {
  const hourMs = hourIntervalMs(h.ctx);
  const quarterMs = hourMs / 4;
  let next = Infinity;
  for (const f of recordValues(h.state.fleets)) {
    if (!f.bombarding) continue;
    let at = f.bombardNextAt ?? from + hourMs;
    while (at <= from) at += hourMs;
    if (at < next) next = at;
  }
  const flakAt = (Math.floor(from / quarterMs) + 1) * quarterMs;
  if (flakAt < next && flakAt <= limit && flakBatteries(h).length > 0) next = flakAt;
  return next;
}

/** One bombardment volley: an hour's worth of the fleet's shelling, landed at once
 *  (owner's order 2026-11-02: «каждый час, как обычная атака флота, только на планету»).
 *  It hits the world's structures (and, weakly, its garrison, ROS-1.6). The production
 *  freeze is not a volley: it holds the whole time bombardment is on (`isBombarded`).
 *  The rule for WHO shells (incl. the pinned-in-melee exception) is THE shared predicate
 *  `isActivelyBombarding` — the same one the economy / construction freeze reads, so
 *  damage and freeze can't disagree. Here it gets combat's capability-aware hostility. */
function fireBombardVolley(h: HandlerContext, f: Fleet): void {
  const data = h.ctx.data;
  const planetId = f.location;
  const planet = planetId === null ? undefined : h.state.planets[planetId];
  if (planetId === null || !planet) return;
  const hostile = (a: string, b: string): boolean => isHostile(h, a, b);
  if (!isActivelyBombarding(h.state, f, hostile, data)) return;
  const hit: DamageHookArgs = {
    phase: 'bombard',
    location: planetId,
    attacker: f.owner,
    defender: planet.owner,
    attackerFleet: f.id, // обстрел ведёт флот на орбите (CORE-DMG-3)
  };
  const power = fleetBombardPower(f, data);
  // Both channels sample the same protection; structures are then worn before
  // another source or its return fire is evaluated.
  const shelling = hookedDamage(h, power, hit);
  const factor = mitigationFactor(h, hit);
  const troops = shipGroundPower(f, planet, data);
  if (troops.total > 0) {
    fireOnGarrison(h, planet, hookedDamage(h, troops.total, hit), f.owner, troops.weights);
  }
  if (power > 0) {
    const structuresApplied = wearStructures(h, planetId, shelling, planet.owner, { hit, factor });
    h.emit('planet.bombarded', { planetId, power: shelling, owner: planet.owner, by: f.owner,
      fleetId: f.id, hit, factor, structuresApplied });
  }

}

/**
 * Orbital — the near-orbit layer (GDD §7.4), split out of the melee combat
 * module along the bus seams. There is a SINGLE orbit: arriving stations a fleet
 * in it, a stationed fleet can bombard the world below and is exposed to the
 * planet's AA. AA fires discrete two-tier VOLLEYS on the world-time grid (hourly
 * orbital emplacements, quarter-hour close flak); bombardment fires a volley an hour
 * on each fleet's own clock; within a span both land in the order of time
 * ({@link runOrbitalSpan}). Degrades gracefully:
 * without this module fleets still fight (melee `combat`) — no AA, no bombardment.
 */
export const orbitalModule: GameModule = {
  id: 'orbital',
  // 1.1.0: обстрел сообщает, каким прикрытием он срезан (`hit` + `factor`, FORT-5.16).
  // 1.2.0: мина не встаёт на орбиту, не обстреливает и не делит залп ПВО (ревью #1411).
  // 1.3.0: обстрел бьёт и войска мира, без последнего бойца (ROS-1.6).
  // 1.4.0: урон обстрела по войскам делится поровну на каждого юнита, а не фокусом (ROS-1.6a).
  // 1.5.0: обстрел бьёт пехоту и технику разной долей атаки (ROS-1.6b).
  // 1.6.0: обстрел бьёт залпом раз в игровой час по своим часам флота, как атака в бою
  //        (`fleet.bombardNextAt`), а не непрерывно.
  // 1.8.0: флак мира и обстрел ложатся в порядке времени, а не «весь флак отрезка, потом
  //        весь обстрел»; залп флака метит `lastDamagedAt` своим мгновением (FORT-5.17).
  // 1.9.0: каждый залп — свой шаг мира: хук `time.stop` режет отрезок на следующем залпе, а
  //        залп на конце отрезка ложится на `time.stopped`, когда ремонт и щиты всех модулей
  //        за отрезок уже начислены. Залпы и ремонт идут вперемешку при любой нарезке.
  version: '1.9.0',
  setup(api) {
    // A single orbit (GDD §7.4): arriving = stationed in orbit, not bombarding
    // until ordered. Registered BEFORE the melee module in the manifest, so this
    // runs first on `fleet.arrived` — the same stamp-then-engage sequence the
    // old single handler had (invariant #6: order = module array order).
    api.on('fleet.arrived', (event, h) => {
      const { fleetId } = event.payload as { fleetId: string };
      const fleet = h.state.fleets[fleetId];
      if (fleet && !fleet.battleId) {
        fleet.orbit = 'near';
        fleet.bombarding = false;
        delete fleet.bombardNextAt;
      }
    });

    // Bring an idle fleet into the planet's orbit. There is a SINGLE orbit (GDD §7.4) —
    // `'near'` is the only value; arrival enters it automatically, so this is mostly the
    // explicit "enter orbit" path. A fleet in orbit can bombard / land and is exposed to
    // the planet's AA. (The old far/near switch was collapsed to one orbit.)
    api.onAction('fleet.orbit', (action, h) => {
      const { fleetId, orbit } = action.payload as { fleetId?: string; orbit?: string };
      if (typeof fleetId !== 'string' || orbit !== 'near') {
        return h.reject('E_BAD_PAYLOAD');
      }
      const fleet = requireOwnedIdleFleet(h, fleetId, action.playerId);
      fleet.orbit = 'near';
      h.emit('fleet.orbit', { fleetId, orbit: 'near', owner: action.playerId });
    });

    // Toggle bombardment of the world below (near orbit, a hostile world, ships
    // aboard). While on, it shells structures and the garrison and freezes the owner's
    // production each time span — and the fleet eats the planet's AA fire in return.
    api.onAction('fleet.bombard', (action, h) => {
      const { fleetId, on } = action.payload as { fleetId?: string; on?: boolean };
      if (typeof fleetId !== 'string' || typeof on !== 'boolean') {
        return h.reject('E_BAD_PAYLOAD');
      }
      const fleet = requireOwnedIdleFleet(h, fleetId, action.playerId);
      if (on) {
        if (fleet.orbit !== 'near') {
          return h.reject('E_WRONG_ORBIT');
        }
        const planet = h.state.planets[fleet.location];
        if (!planet) {
          return h.reject('E_NO_PLANET');
        }
        // Only a province WITH an orbital layer can be shelled from above (owner's
        // rule: a planet and a space fortress, nothing else). The shared predicate
        // repeats this — this gate exists so the player gets a reason instead of a
        // switch that flips on and quietly does nothing.
        if (!hasOrbit(h.ctx.data, planet)) {
          return h.reject('E_WRONG_SECTOR');
        }
        if (planet.owner === fleet.owner) {
          return h.reject('E_OWN_PLANET');
        }
        if (planet.owner !== null && !isHostile(h, fleet.owner, planet.owner)) {
          return h.reject('E_FORBIDDEN');
        }
        if (!fleet.units.some((s) => s.count > 0)) {
          return h.reject('E_NO_SHIPS');
        }
      }
      // The volley clock, like a melee attack order: a repeated «on» never restarts it,
      // «off» drops it.
      if (!on) delete fleet.bombardNextAt;
      else if (!fleet.bombarding || fleet.bombardNextAt === undefined) armBombard(h, fleet);
      fleet.bombarding = on;
      h.emit('fleet.bombard', { fleetId, on, owner: action.playerId });
    });

    // The orbital layer over a span: AA volleys on the world-time grid and each fleet's
    // bombardment volleys on its own clock, interleaved in the order of time.
    // Its place in the manifest fixes the order in which the layers accrue
    // within one span (invariant #6).
    api.on('time.advanced', (event, h) => {
      const { from, to } = event.payload as { from: number; to: number };
      const span = to - from;
      if (span <= 0) {
        return;
      }
      runOrbitalSpan(h, from, to);
    });
    // Every volley gets a step of its own: the world stops on it, after the span before
    // it has been accrued by every module (PE-2.2: one span = many short ones).
    api.hook<number>('time.stop', (stop, args, h) => {
      const { from, to } = args as { from: number; to: number };
      const limit = Math.min(stop, to);
      const at = nextVolleyAt(h, from, limit);
      return at <= limit ? at : stop;
    });
    api.on('time.stopped', (event, h) => {
      runOrbitalInstant(h, (event.payload as { at: number }).at);
    });
  },
};
