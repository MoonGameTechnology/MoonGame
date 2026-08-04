/**
 * «Хранитель» на карауле (REFP-25) — one guard-duty tick of the Steward for a
 * delegated seat (posture «Оборона», ST-3.2 / steward-roadmap §ST-3): threat
 * forecasting over visible bearings, loss-limit retreat, evacuation with the
 * anti-shuttle cooldown, and the SITREP journal. Extracted from `game.ts` as a
 * pure move. Pure builder like `aiOrders`: returns actions only — both hosts
 * (solo frame loop / netserver driver) apply them through the kernel. Test:
 * `stewardGuard.test.ts`. `game.ts` re-exports for main.ts / netserver.ts /
 * tests (until REFP-28).
 */
import {
  scanNodeThreats,
  previewBattle,
  hullPool,
  journeyDestination,
  planRoute,
  routeDistance,
  estimateTravelHours,
  identifiedNodes,
  hoursToMs,
  STEWARD_LOSS_LIMIT,
  type GameState,
  type Action,
  type StewardPosture,
  type StewardLogEntry,
  type Fleet,
  type UnitStack,
} from '../../packages/shared-core/src/index';
import { findHealthyStack, sumUnitStat } from '../../packages/shared-core/src/util/stacks';
import { garrisonUnderAssault } from '../../packages/shared-core/src/util/fleet';
import { act, moveFleet, loadArmy, engageFleet, orderScramble } from './actions';
import { data } from './prototypeData';
import { ctx } from './protoKernel';
import { fleetHasSquadron } from './squadron';
import type { Patrol } from './patrol';

/** The guard's narrow view of the prototype state extension it reads (the standing
 *  patrols peek) — the same local-projection pattern as `division.ts`/`serverDrivers.ts`. */
type GuardState = GameState & { patrols?: Record<string, Patrol & { rearmAt?: number }> };

/** A garrison unit the evacuation can actually lift: the same gate `army.load`
 *  enforces (ground cargo only, fixed emplacements stay). */
const liftable = (unit: string): boolean => {
  const def = data.units[unit];
  return !!def && def.domain === 'ground' && !def.traits.includes('immobile');
};

/** Anti-shuttle cooldown (ST-3.4), game-hours: after the Steward evacuates X→Y,
 *  the REVERSE trip Y→X is off the haven list for this long — an enemy poking
 *  two nodes alternately must not make the wing челночить between them forever
 *  (each leg it defends nothing and a lane camper can catch it in the open).
 *  With no other haven the wing STANDS instead — a fight beats eternal transit. */
const EVAC_RETURN_COOLDOWN_H = 12;

/**
 * One guard-duty tick of the Steward for a delegated seat (posture «Оборона»,
 * ST-3.2 / steward-roadmap §ST-3): for every owned world a VISIBLE hostile
 * bears on, forecast the stand (`previewBattle`: every bearing force strikes,
 * the node's whole defense — docked fleets + garrison — answers). Forecast own
 * losses at/over `STEWARD_LOSS_LIMIT` mean the fight is a bad trade, so the
 * wing is pulled out to the nearest SAFE own world: self-moving fleets fly out
 * (lifting what garrison fits their holds on the way), and for the rest the
 * nearest idle transport with a free hold is summoned — only if it can arrive
 * with a tick to spare BEFORE the threat lands, because `army.load` locks the
 * moment the assault starts (`E_UNDER_ASSAULT`). Evacuation is loss-avoidance:
 * the autopilot saves what it cannot profitably defend, it never fights better
 * than the player would. Pure builder like `aiOrders`: returns actions only.
 * The forecast is the base model (no `combat.damage` hooks) over one combined
 * engagement — a retreat heuristic, not an oracle (ONB-6 semantics).
 */
export function stewardGuardOrders(
  state: GameState,
  ai: string,
  posture: StewardPosture = 'defend',
): Action[] {
  const out: Action[] = [];
  const c = ctx(state.time);
  // SITREP (ST-2.4): every decision below is journaled and stamped as ONE
  // trailing `steward.report` — the morning report the sleeping owner reads.
  const report: StewardLogEntry[] = [];
  const frac = (x: number): number => Math.round(x * 1000) / 1000;
  // Repeat-prone facts (hold/stranded re-derive every 2h tick) are stamped once
  // per EPISODE: skipped while the node's latest journal line already says the
  // same thing. The journal lives in state, so the check survives the stateless
  // re-tick; any different entry for the node reopens the episode.
  const lastLogged = (node: string): string | undefined => {
    const log = state.players[ai]?.stewardLog;
    if (!log) return undefined;
    for (let i = log.length - 1; i >= 0; i--) {
      if (log[i]!.node === node) return log[i]!.kind;
    }
    return undefined;
  };
  const noteOnce = (entry: StewardLogEntry): void => {
    if (entry.node !== undefined && lastLogged(entry.node) === entry.kind) return;
    report.push(entry);
  };
  const identified = identifiedNodes(state, ai, data);
  const mine = Object.values(state.planets).filter((p) => p.owner === ai);
  // Threat scans are per-node; cache them — the haven search re-reads them.
  const threatCache = new Map<string, ReturnType<typeof scanNodeThreats>>();
  const threatsOf = (node: string): ReturnType<typeof scanNodeThreats> => {
    let t = threatCache.get(node);
    if (t === undefined) {
      t = scanNodeThreats(state, node, ai, c, identified);
      threatCache.set(node, t);
    }
    return t;
  };
  // Hold points (ST-2.1): player-designated standing anchors — never evacuated,
  // reinforced instead; their docked wings are not poached for other errands.
  const holdPoints = new Set(state.players[ai]?.stewardHoldPoints ?? []);
  // A fleet gets ONE task per tick (evacuate or ferry) — never two nodes' errands.
  const tasked = new Set<string>();
  const idleOwn = (f: Fleet): boolean =>
    f.owner === ai && f.location != null && !f.movement && !f.battleId && !tasked.has(f.id);
  // Свободный трюм = грузоподъёмность кораблей минус уже погруженный десант.
  // Раньше это считал `fleetCargoFree` из division.ts, потому что трюм делили с
  // дивизиями; после H4-REVERT делить не с кем — остаётся одна вычитание.
  // too — a transport already ferrying a formation must not be over-filled.
  const freeHold = (f: Fleet): number =>
    sumUnitStat(f.units, data, 'cargoCapacity') - sumUnitStat(f.landing ?? [], data, 'cargoSize');

  for (const p of mine) {
    const threats = threatsOf(p.id);
    if (threats.length === 0) continue;
    const docked = Object.values(state.fleets).filter((f) => idleOwn(f) && f.location === p.id);
    const defenders: UnitStack[] = [...docked.flatMap((f) => f.units), ...p.garrison];
    if (!defenders.some((s) => s.count > 0)) continue; // nothing here to save
    const attackers: UnitStack[] = threats.flatMap((t) => {
      const f = state.fleets[t.fleetId];
      return f ? [...f.units, ...(f.landing ?? [])] : [];
    });
    const stand = previewBattle(attackers, defenders, data);
    // A stand the forecast says we WIN is held regardless of its price: fleeing a
    // won fight gifts the world to a cheap feint (three scouts «push» a cruiser
    // off an empty rock and walk in). The loss limit judges only losing/pyrrhic
    // stands — the wing bails when it would be wiped or ground down for nothing.
    const holds =
      stand.outcome === 'defender' || stand.defender.damageFraction < STEWARD_LOSS_LIMIT;
    if (holds) {
      // Counterstrike (ST-3.3, «Активная оборона» only): war-stance intruders
      // PARKED at our node that auto-engage didn't already lock (war declared
      // after they docked; a resolved battle's leftovers). The combat module
      // AUTO-re-engages a battle's victor into the NEXT parked hostile, so the
      // gate must price the WHOLE ladder, not the first rung: the wing has to
      // clear EVERY parked intruder, chained in scan order, with CUMULATIVE
      // hull losses under the limit — else a cheap first fight would drag the
      // damaged wing into one its forecast declined («держим, но не
      // кровоточим»). One engager, one order — the victor chain does the rest;
      // the fight happens where the wing stands: own territory only.
      const holdEntry: StewardLogEntry = {
        at: state.time,
        kind: 'hold',
        node: p.id,
        fraction: frac(stand.defender.damageFraction),
      };
      if (posture !== 'active_defend') {
        noteOnce(holdEntry);
        continue;
      }
      const ladder: Fleet[] = [];
      for (const t of threats) {
        if (t.kind !== 'present') continue;
        const tf = state.fleets[t.fleetId];
        if (tf && !tf.battleId) ladder.push(tf);
      }
      if (ladder.length === 0) {
        noteOnce(holdEntry);
        continue;
      }
      const byStrength = [...docked].sort(
        (a, b) =>
          hullPool(b.units, data) - hullPool(a.units, data) ||
          (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
      );
      let engaged = false;
      for (const f of byStrength) {
        if (tasked.has(f.id)) continue;
        let wing = f.units;
        let clears = true;
        for (const tf of ladder) {
          const rung = previewBattle(wing, tf.units, data);
          if (rung.outcome !== 'attacker') {
            clears = false;
            break;
          }
          wing = rung.attacker.survivors; // carry the hull damage into the next rung
        }
        const before = hullPool(f.units, data);
        if (!clears || before <= 0) continue;
        const ladderFraction = 1 - hullPool(wing, data) / before;
        if (ladderFraction >= STEWARD_LOSS_LIMIT) continue;
        out.push(engageFleet(ai, f.id, ladder[0]!.id));
        tasked.add(f.id);
        engaged = true;
        report.push({
          at: state.time,
          kind: 'strike',
          node: p.id,
          fleetId: f.id,
          count: ladder.length,
          fraction: frac(ladderFraction),
        });
        break;
      }
      if (!engaged) noteOnce(holdEntry);
      continue;
    }
    const earliest = threats[0]!.eta;
    // Hold point (ST-2.1): a player-designated anchor is NEVER auto-evacuated —
    // the standing order outranks the loss forecast. The Steward instead tries
    // to FLIP the forecast: summon ONE idle wing that (a) arrives with a tick
    // (2h) to spare before the earliest threat lands and (b) turns the combined
    // stand into a hold. Piecemeal feeding is refused — help that arrives late
    // or still loses would only widen the defeat; the wing then stands as
    // ordered, and the journal's bad fraction tells the owner the price.
    if (holdPoints.has(p.id)) {
      // Help already flying in (last tick's relief or the owner's own order) —
      // nothing to add; the episode is already journaled.
      const inboundHelp = Object.values(state.fleets).some(
        (f) => f.owner === ai && f.movement != null && journeyDestination(f.movement) === p.id,
      );
      if (!inboundHelp) {
        let relief: Fleet | null = null;
        let reliefEta = Infinity;
        let reliefFraction = 0;
        for (const f of Object.values(state.fleets)) {
          if (!idleOwn(f) || f.location === p.id) continue;
          if (!f.units.some((s) => s.count > 0)) continue;
          // Same no-poach rule as the ferry: a wing on another threatened node
          // (or another anchor) is needed where it stands.
          if (threatsOf(f.location!).length > 0 || holdPoints.has(f.location!)) continue;
          const hours = estimateTravelHours(state, data, f.location!, p.id, f);
          if (hours === null) continue;
          const arrives = state.time + hoursToMs(c, hours);
          if (arrives + hoursToMs(c, 2) > earliest) continue; // too late to matter
          const together = previewBattle(attackers, [...defenders, ...f.units], data);
          const flips =
            together.outcome === 'defender' ||
            together.defender.damageFraction < STEWARD_LOSS_LIMIT;
          if (!flips) continue;
          if (arrives < reliefEta) {
            reliefEta = arrives;
            relief = f;
            reliefFraction = together.defender.damageFraction;
          }
        }
        if (relief) {
          out.push(moveFleet(ai, relief.id, p.id));
          tasked.add(relief.id);
          report.push({
            at: state.time,
            kind: 'reinforce',
            node: p.id,
            fleetId: relief.id,
            fraction: frac(reliefFraction),
          });
        } else {
          noteOnce({
            at: state.time,
            kind: 'hold',
            node: p.id,
            fraction: frac(stand.defender.damageFraction),
          });
        }
      }
      continue; // a hold point never falls through to evacuation
    }
    // Bad trade — evacuate to the nearest reachable own world nothing bears on.
    // Anti-shuttle hysteresis (ST-3.4): a candidate we RECENTLY fled FROM into
    // this very node is the shuttle's return leg — journaled evacuations
    // (state-resident, so the check survives the stateless re-tick) block it
    // for EVAC_RETURN_COOLDOWN_H game-hours.
    const returnBlocked = (candidate: string): boolean => {
      const log = state.players[ai]?.stewardLog;
      if (!log) return false;
      const horizon = hoursToMs(c, EVAC_RETURN_COOLDOWN_H);
      for (let i = log.length - 1; i >= 0; i--) {
        const e = log[i]!;
        if (e.kind !== 'evac' || e.node !== candidate || e.to !== p.id) continue;
        if (state.time - e.at < horizon) return true;
      }
      return false;
    };
    let haven: string | null = null;
    let havenDist = Infinity;
    for (const q of mine) {
      if (q.id === p.id || threatsOf(q.id).length > 0 || returnBlocked(q.id)) continue;
      const route = planRoute(state, p.id, q.id);
      if (!route) continue;
      const dist = routeDistance(state, p.id, route);
      if (dist < havenDist) {
        havenDist = dist;
        haven = q.id;
      }
    }
    if (haven === null) {
      // Nowhere safer — a FORCED stand; the bad fraction in the entry tells the
      // owner why the wing stayed put.
      noteOnce({
        at: state.time,
        kind: 'hold',
        node: p.id,
        fraction: frac(stand.defender.damageFraction),
      });
      continue;
    }
    const assaulted = garrisonUnderAssault(state, p.id);
    // What the garrison still holds after the loads planned below (state is
    // read-only). Counted EXACTLY as `army.load` will resolve it — via
    // findHealthyStack: only a full-health, default-loadout stack embarks.
    // Battle-worn troops cannot be lifted (they hold the line; hospitals mend
    // them) — planning them would bounce off E_NO_ARMY and, worse, mark the
    // garrison as handled so no ferry would come for anyone.
    const left = new Map<string, number>();
    for (const s of p.garrison) {
      if (s.count <= 0 || !liftable(s.unit) || left.has(s.unit)) continue;
      const healthy = findHealthyStack(p.garrison, s.unit);
      if (healthy) left.set(s.unit, healthy.count);
    }
    // Docked fleets fly out — lifting what garrison fits their holds first
    // (load and move stack in one tick: actions apply in order while docked).
    for (const f of docked) {
      if (!assaulted) {
        let free = freeHold(f);
        for (const [unit, have] of left) {
          if (free <= 0 || have <= 0) continue;
          const size = data.units[unit]?.stats.cargoSize ?? 0;
          const n = size > 0 ? Math.min(have, Math.floor(free / size)) : have;
          if (n <= 0) continue;
          out.push(loadArmy(ai, f.id, unit, n));
          left.set(unit, have - n);
          free -= n * size;
        }
      }
      // A standing patrol flies out with its carrier: stand it down first (the
      // sortie is stashed, BF-26) so no stale patrol record points at this node.
      if ((state as GuardState).patrols?.[f.id]) out.push(orderScramble(ai, f.id, false));
      out.push(moveFleet(ai, f.id, haven));
      tasked.add(f.id);
    }
    if (docked.length > 0) {
      report.push({
        at: state.time,
        kind: 'evac',
        node: p.id,
        to: haven,
        count: docked.length,
        fraction: frac(stand.defender.damageFraction),
      });
    }
    // Garrison still stranded → summon the nearest idle transport with a free
    // hold, but only when it beats the threat with one AI tick (2h) to spare —
    // a transport that would arrive into the assault is not sent at all.
    const stranded = [...left.values()].some((n) => n > 0);
    const inboundAlready = Object.values(state.fleets).some(
      (f) => f.owner === ai && f.movement != null && journeyDestination(f.movement) === p.id,
    );
    if (stranded && !inboundAlready && !assaulted) {
      let ferry: Fleet | null = null;
      let ferryEta = Infinity;
      for (const f of Object.values(state.fleets)) {
        if (!idleOwn(f) || f.location === p.id || freeHold(f) <= 0) continue;
        // Never poach a transport off ANOTHER threatened node (its own evac
        // branch tasks it) or off a hold point (the anchor keeps its wing).
        if (threatsOf(f.location!).length > 0 || holdPoints.has(f.location!)) continue;
        const hours = estimateTravelHours(state, data, f.location!, p.id, f);
        if (hours === null) continue;
        const arrives = state.time + hoursToMs(c, hours);
        if (arrives + hoursToMs(c, 2) > earliest) continue; // too late to load — don't feed it in
        if (arrives < ferryEta) {
          ferryEta = arrives;
          ferry = f;
        }
      }
      if (ferry) {
        out.push(moveFleet(ai, ferry.id, p.id));
        tasked.add(ferry.id);
        report.push({ at: state.time, kind: 'ferry', node: p.id, fleetId: ferry.id });
      } else {
        // Liftable troops remain, no help is coming this tick — the owner should
        // wake up to «гарнизон не спасти», not to silence. Once per episode.
        noteOnce({
          at: state.time,
          kind: 'stranded',
          node: p.id,
          fraction: frac(stand.defender.damageFraction),
        });
      }
    }
  }
  // Fire-watch (ST-3.3, «Активная оборона» only): stand a CC-4 reactive patrol on
  // every wing docked at an OWN world that isn't patrolling yet — the дежурный
  // вылет then answers raiders inside its radius on its own cadence (including
  // the mid-lane standoff campers `fleet.engage` can't reach). Never on foreign
  // soil; a wing the evac branch just tasked is not re-ordered.
  if (posture === 'active_defend') {
    const patrols = (state as GuardState).patrols;
    for (const f of Object.values(state.fleets)) {
      if (!idleOwn(f) || !fleetHasSquadron(f) || patrols?.[f.id]) continue;
      if (state.planets[f.location!]?.owner !== ai) continue;
      out.push(orderScramble(ai, f.id, true));
      report.push({ at: state.time, kind: 'watch', node: f.location!, fleetId: f.id });
    }
  }
  // The SITREP stamp rides LAST: it narrates the orders above. Applied through
  // the same kernel path (steward.report — server-driver-only, gate refuses it
  // from the wire), so the journal lands in state and survives the night.
  if (report.length > 0) out.push(act(ai, 'steward.report', { entries: report }));
  return out;
}
