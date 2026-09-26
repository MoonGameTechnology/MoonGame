import type { GameModule, HandlerContext } from '../kernel/module';
import type { Fleet } from '../state/gameState';
import {
  INTERCEPT_TOL,
  isHostile,
  laneOccupancy,
  posAt,
  sameLane,
  trunkOccupancies,
  trunkPosAt,
} from '../util/combat';

/**
 * Флот дерётся в бою НА ДОРОГЕ: приколот к точке полосы, бой на орбитальной фазе. Для
 * проходящего он — такая же стоящая на дороге точка, и встреча с ним — вступление в его
 * бой (`combat`: `joinRoadBattle`). Бой у планеты сюда не относится: туда вступают по
 * прибытии на узел.
 */
function roadEngaged(h: HandlerContext, f: Fleet): boolean {
  if (!f.battleId || f.movement || !f.edge) return false;
  return h.state.battles[f.battleId]?.phase === 'orbital';
}
/** Флот может участвовать во встрече: свободен или стоит в бою на дороге. */
const canMeet = (h: HandlerContext, f: Fleet): boolean => !f.battleId || roadEngaged(h, f);

/**
 * Schedules a `fleet.intercept` for every hostile fleet whose lane occupancy
 * crosses `fleetId`'s on the SAME lane — the analytic "встреча по формуле". Each
 * pair's position difference is linear in time, so the crossing instant is solved
 * exactly by interpolating the well-conditioned 0..1 positions at the overlap
 * window's ends (never dividing by a tiny rate). The intercept re-validates when
 * it fires, so a re-route before contact harmlessly no-ops a stale crossing.
 */
function scanLaneIntercepts(h: HandlerContext, fleetId: string): void {
  const fleet = h.state.fleets[fleetId];
  if (!fleet || !canMeet(h, fleet) || !fleet.units.some((s) => s.count > 0)) {
    return;
  }
  const occA = laneOccupancy(fleet);
  if (!occA) {
    return; // not on a lane (at a node / gone)
  }
  const now = h.ctx.now;
  // Sorted (BF-13): each hit schedules an event, and the schedule's (at, seq)
  // tiebreak follows CALL order — key order must not depend on the JSONB store.
  for (const id of Object.keys(h.state.fleets).sort()) {
    if (id === fleetId) {
      continue;
    }
    const other = h.state.fleets[id];
    if (!other || !canMeet(h, other) || !isHostile(h, fleet.owner, other.owner)) {
      continue;
    }
    if (fleet.battleId && other.battleId) {
      continue; // оба уже в бою — встречать нечего
    }
    if (!other.units.some((s) => s.count > 0)) {
      continue;
    }
    const occB = laneOccupancy(other);
    if (!occB || occB.lo !== occA.lo || occB.hi !== occA.hi) {
      continue; // not on the same lane
    }
    const lo = Math.max(occA.t0, occB.t0, now);
    const hi = Math.min(occA.t1, occB.t1);
    if (!(hi >= lo)) {
      continue; // no shared time window
    }
    let tc: number | null = null;
    if (!occA.moving && !occB.moving) {
      // Both parked: a crossing only if they sit on the very same point (rare).
      if (Math.abs(occA.s0 - occB.s0) <= INTERCEPT_TOL) {
        tc = lo;
      }
    } else {
      // At least one moving ⇒ `hi` is finite. d(t)=posA−posB is linear; find its
      // zero between the window ends.
      const dLo = posAt(occA, lo) - posAt(occB, lo);
      const dHi = posAt(occA, hi) - posAt(occB, hi);
      if (Math.abs(dLo) <= INTERCEPT_TOL) {
        tc = lo; // already together at the window's start
      } else if (Math.abs(dHi) <= INTERCEPT_TOL) {
        tc = hi; // together exactly at the window's end
      } else if (dLo < 0 !== dHi < 0) {
        tc = lo + ((hi - lo) * Math.abs(dLo)) / (Math.abs(dLo) + Math.abs(dHi));
      }
    }
    if (tc !== null) {
      h.schedule(tc, 'fleet.intercept', { a: fleetId, b: id });
    }
  }
}

/**
 * Meetings on a TRUNK (ROADS-3): the stretch from a world to its trail's fork is shared by
 * every road on the trail, so fleets bound for different neighbours ride it together, and
 * its end is the fork every bypass touches. Same analytic solve as on a lane, over each
 * shared trunk — a fleet parked AT the fork (share 1) therefore meets everyone who
 * passes it: the owner's ambush («ловят на развилке», `roads-roadmap.md` §0.2). Two
 * fleets on the SAME lane are the lane detector's to meet (it sees the whole road, trunk
 * included), so one meeting is never scheduled twice. Scheduled as `fleet.meet`; the
 * melee module re-validates and fights it.
 */
function scanTrunkIntercepts(h: HandlerContext, fleetId: string): void {
  const fleet = h.state.fleets[fleetId];
  if (!fleet || !canMeet(h, fleet) || !fleet.units.some((s) => s.count > 0)) return;
  const mine = trunkOccupancies(h.state, fleet);
  if (mine.length === 0) return;
  const now = h.ctx.now;
  // Sorted (BF-13): the schedule's tiebreak follows call order.
  for (const id of Object.keys(h.state.fleets).sort()) {
    if (id === fleetId) continue;
    const other = h.state.fleets[id];
    if (!other || !canMeet(h, other) || !isHostile(h, fleet.owner, other.owner)) continue;
    if (fleet.battleId && other.battleId) continue; // оба уже в бою
    if (!other.units.some((s) => s.count > 0) || sameLane(fleet, other)) continue;
    const theirs = trunkOccupancies(h.state, other);
    for (const occA of mine) {
      for (const occB of theirs) {
        if (occB.key !== occA.key) continue;
        const lo = Math.max(occA.t0, occB.t0, now);
        const hi = Math.min(occA.t1, occB.t1);
        if (!(hi >= lo)) continue;
        let tc: number | null = null;
        if (!occA.moving && !occB.moving) {
          // Both parked: a meeting only if they stand on the very same point.
          if (Math.abs(occA.s0 - occB.s0) <= INTERCEPT_TOL) tc = lo;
        } else {
          const dLo = trunkPosAt(occA, lo) - trunkPosAt(occB, lo);
          const dHi = trunkPosAt(occA, hi) - trunkPosAt(occB, hi);
          if (Math.abs(dLo) <= INTERCEPT_TOL) tc = lo;
          else if (Math.abs(dHi) <= INTERCEPT_TOL) tc = hi;
          else if (dLo < 0 !== dHi < 0) {
            tc = lo + ((hi - lo) * Math.abs(dLo)) / (Math.abs(dLo) + Math.abs(dHi));
          }
        }
        if (tc !== null) h.schedule(tc, 'fleet.meet', { a: fleetId, b: id, trunk: occA.key });
      }
    }
  }
}

/**
 * Intercept — the lane-crossing DETECTOR (GDD §7.4), split out of the melee
 * combat module along the bus seams. On every leg start / mid-lane park it
 * solves the crossing instant analytically and schedules `fleet.intercept` —
 * the melee `combat` module re-validates and resolves the meeting into a battle
 * when it fires. With a road network (ROADS-3) it also meets fleets of different
 * lanes on a trail's shared trunk and at its fork, as `fleet.meet`. Degrades
 * gracefully both ways: without this module fleets only collide at nodes (no road
 * meetings are ever scheduled); without the melee module the scheduled
 * `fleet.intercept` / `fleet.meet` events harmlessly fade (nobody listens).
 */
export const interceptModule: GameModule = {
  id: 'intercept',
  version: '1.2.0',
  setup(api) {
    // Lane combat: a fleet just began a leg / parked on a lane → look for a hostile
    // fleet it will cross ON the lane (not only at a node), or on a trunk it shares with
    // another lane, and schedule the meeting.
    api.on('fleet.leg', (event, h) => {
      const { fleetId } = event.payload as { fleetId: string };
      scanLaneIntercepts(h, fleetId);
      scanTrunkIntercepts(h, fleetId);
    });
    api.on('fleet.parked', (event, h) => {
      const { fleetId } = event.payload as { fleetId: string };
      scanLaneIntercepts(h, fleetId);
      scanTrunkIntercepts(h, fleetId);
    });
    // Бой завязался на дороге: те, кто уже едет по ней, считали встречу с флотами, пока
    // те ехали, — теперь флоты боя стоят в другой точке. Пересчитать встречи от них,
    // иначе проходящий проедет сквозь бой (плейтест Sector Zero 2026-09-26).
    api.on('battle.started', (event, h) => {
      const { battleId } = event.payload as { battleId: string };
      const battle = h.state.battles[battleId];
      if (!battle) return;
      for (const side of battle.sides) {
        if (side.ref.kind !== 'fleet') continue;
        const f = h.state.fleets[side.ref.fleetId];
        if (!f || !roadEngaged(h, f)) continue;
        scanLaneIntercepts(h, f.id);
        scanTrunkIntercepts(h, f.id);
      }
    });
  },
};
