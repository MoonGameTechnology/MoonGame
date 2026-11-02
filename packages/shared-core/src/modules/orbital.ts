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

/** Resolves the orbital layer over one continuous time span: planetary AA fires
 *  at near-orbit attackers (unless a ground assault keeps it busy). Bombardment is
 *  not here: it fires on each fleet's own hourly clock ({@link fireBombardVolley}).
 *
 *  Optimized with a fleet-by-location index and a ground-assault set so the
 *  cost is O(planets + fleets + battles) instead of O(planets × fleets). */
function runOrbital(h: HandlerContext, from: number, to: number): void {
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

  for (const planetId of Object.keys(h.state.planets)) {
    const planet = h.state.planets[planetId];
    if (!planet) {
      continue;
    }
    const localFleets = fleetsByLocation.get(planetId);

    // No orbital layer (asteroid field, nebula, dead world, debris) — nothing to
    // shell and nothing to shell FROM: neither AA nor bombardment happens here.
    if (!hasOrbit(data, planet)) {
      continue;
    }

    // AA — anti-ship, only when not defending the ground. Two tiers, both firing
    // discrete VOLLEYS on the world-time grid (a fleet slipping in and out of orbit
    // BETWEEN volleys escapes untouched — timing a raid past the flak matters):
    //   - ORBITAL (buildings): one full-strength volley per game-HOUR;
    //   - CLOSE (garrison units): a quarter-strength volley every QUARTER-hour —
    //     same hourly output, but only a 15-minute window to dodge.
    // The quarter grid contains the hour grid, so one walk over quarter boundaries
    // covers both; at a shared boundary the heavy orbital volley lands first.
    if (planet.owner !== null && !groundAssaults.has(planetId)) {
      // ECON-2 «блэкаут»: unpaid energy halves BOTH flak tiers until the bill is
      // covered — same knob as the radar dim (BLACKOUT_MULT, visibility.ts).
      const starved = h.state.players[planet.owner]?.arrears?.includes('energy') === true;
      const aaMult = starved ? BLACKOUT_MULT : 1;
      const aaOrbital = aaOrbitalAt(planet, data) * aaMult;
      const aaClose = aaCloseAt(planet, data) * aaMult;
      if (aaOrbital > 0 || aaClose > 0) {
        const hourMs = hourIntervalMs(h.ctx); // one game-hour of world time
        const quarterMs = hourMs / 4;
        const firstQ = Math.floor(from / quarterMs) + 1;
        const lastQ = Math.floor(to / quarterMs);
        const volley = (damage: number, tier: 'orbital' | 'close'): boolean => {
          // Re-aim every volley: a target destroyed mid-span frees its share of the
          // next strike for the hostiles still hanging in orbit.
          const targets = nearOrbitHostiles(h, planetId, planet.owner!, localFleets);
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
              attacker: planet.owner,
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
              owner: planet.owner,
              fleetId: target.id,
              by: target.owner,
              damage: dealt,
              tier,
            });
            applyDamageToSide(h, share.to, dealt, data, planetId, undefined, undefined, planet.owner);
            removeIfWiped(h, target.id);
          }
          return true;
        };
        outer: for (let q = firstQ; q <= lastQ; q++) {
          if (aaOrbital > 0 && q % 4 === 0) {
            if (!volley(aaOrbital, 'orbital')) break outer;
          }
          if (aaClose > 0) {
            if (!volley(aaClose / 4, 'close')) break outer;
          }
        }
      }
    }

  }
}

/** Start a fleet's bombardment clock: the first volley lands one game hour from now,
 *  like the first strike of a melee attack order (`battle.attack`). */
function armBombard(h: HandlerContext, fleet: Fleet): void {
  fleet.bombardNextAt = h.ctx.now + hourIntervalMs(h.ctx);
}

/** Every bombardment volley due in the span `(from, to]`, in (instant, fleet id) order.
 *  The clock is absolute (`fleet.bombardNextAt`), so one long span and many short ones
 *  land the same volleys at the same instants. A fleet that stopped bombarding drops its
 *  clock; one left bombarding without a clock (an old save) starts it at the span start. */
function runBombardment(h: HandlerContext, from: number, to: number): void {
  const hourMs = hourIntervalMs(h.ctx);
  const due: Array<{ at: number; fleet: Fleet }> = [];
  for (const f of recordValues(h.state.fleets)) {
    if (!f.bombarding) {
      if (f.bombardNextAt !== undefined) delete f.bombardNextAt;
      continue;
    }
    if (f.bombardNextAt === undefined) f.bombardNextAt = from + hourMs;
    for (let at = f.bombardNextAt; at <= to; at += hourMs) due.push({ at, fleet: f });
  }
  due.sort((a, b) => a.at - b.at || (a.fleet.id < b.fleet.id ? -1 : a.fleet.id > b.fleet.id ? 1 : 0));
  for (const { at, fleet } of due) {
    // A volley earlier in this span may have ended the bombardment (the fleet is gone
    // or no longer shelling): its later volleys do not land.
    if (h.state.fleets[fleet.id] !== fleet || !fleet.bombarding) continue;
    fireBombardVolley(h, fleet);
    fleet.bombardNextAt = at + hourMs;
  }
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
      hit, factor, structuresApplied });
  }

}

/**
 * Orbital — the near-orbit layer (GDD §7.4), split out of the melee combat
 * module along the bus seams. There is a SINGLE orbit: arriving stations a fleet
 * in it, a stationed fleet can bombard the world below and is exposed to the
 * planet's AA. AA fires discrete two-tier VOLLEYS on the world-time grid (hourly
 * orbital emplacements, quarter-hour close flak); bombardment accrues over
 * continuous time (`time.advanced`), like the economy. Degrades gracefully:
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
  version: '1.7.0',
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

    // The orbital layer accrues over continuous time, like the economy (AA fires
    // in discrete volleys on the from→to grid; bombardment has its own volley clock).
    // Its place in the manifest fixes the order in which the layers accrue
    // within one span (invariant #6).
    api.on('time.advanced', (event, h) => {
      const { from, to } = event.payload as { from: number; to: number };
      const span = to - from;
      if (span <= 0) {
        return;
      }
      runOrbital(h, from, to);
      runBombardment(h, from, to);
    });
  },
};
