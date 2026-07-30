/**
 * Server-side standing-order drivers — the missing "who decides, and when" half of
 * `standingOrdersModule` (`@void/shared-core`, CC-2 auto-storm / CC-4 standing
 * patrol). The core module only stores/validates a player's INTENT
 * (`state.autoAssault`/`state.patrols`/`state.wingSorties`) and garbage-collects it
 * for dead fleets; nothing decided WHEN to act on it in a real multiplayer room —
 * `clockDriver.ts`'s own doc comment flags this exact gap ("the prototype host reads
 * [onTick's `progressed`] to skip its AI/standing-order drivers on a stalled tick").
 *
 * Port of the prototype's `serverAutoAssaultActions`/`serverPatrolActions`
 * (`prototype/src/serverDrivers.ts`, REFP-24), adapted to canon's action set
 * (`fleet.orbit`/`fleet.assault`/`fleet.move`/`fleet.engage`, vs. the prototype's
 * own action-builder shapes) and `PatrolEntry`'s `rearmAt` living inline (canon)
 * rather than split into a parallel `Patrol`/`{rearmAt}` pair (prototype).
 *
 * `serverChainActions` (CC-1 order chains) is NOT ported here — a separate,
 * larger follow-up (more step kinds, hero-ability cooldown tracking); this pass
 * covers auto-storm + reactive patrol only.
 *
 * Both functions are pure: given `(state, data[, now])` they return the actions to
 * submit — via `MatchRoom.submitServerAction`, bypassing the ActionGate like the
 * AI/AvA drivers, including the server-only `patrol.stamp` (the runtime sortie
 * stamp `standingOrdersModule` refuses from the wire). The caller applies them; a
 * rejected action is simply skipped, never retried forever (the CC-2 rejected-churn
 * lesson the prototype already learned).
 */
import {
  canSortie,
  spendSortie,
  tickRearm,
  fleetHasSquadron,
  sortieSpec,
  withinRange,
  getStance,
  identifiedNodes,
  isCapturable,
  type Action,
  type GameData,
  type GameState,
  type SortieState,
} from '@void/shared-core';

let seq = 0;
/** A driver-issued action id: deterministic enough to read at a glance in logs,
 *  unique enough per tick that two decisions never collide (`submitServerAction`
 *  dedups by id — a genuine retry of the SAME decision should reuse one, but this
 *  driver never retries its own submissions, only re-decides next tick). */
function driverActionId(kind: string, fleetId: string): string {
  return `driver:${kind}:${fleetId}:${seq++}`;
}

/** One tick of the CC-2 auto-storm driver: every fleet flagged in `state.autoAssault`
 *  that sits over someone else's capturable, at-war world with the orbit clear gets
 *  its storm orders (orbit first if not already in orbit, then assault). */
export function autoAssaultActions(
  state: GameState,
  data: GameData,
): Array<{ playerId: string; action: Action }> {
  const flagged = state.autoAssault ?? {};
  const out: Array<{ playerId: string; action: Action }> = [];
  for (const fid of Object.keys(flagged).sort()) {
    const f = state.fleets[fid];
    if (!f || f.location === null || f.movement || f.battleId) continue;
    const here = state.planets[f.location];
    if (!here || !isCapturable(data, here) || here.owner === f.owner) continue;
    // Only worlds we are AT WAR with — the core rejects a peaceful assault anyway
    // (E_FORBIDDEN), but re-issuing the doomed pair every tick is rejected-action churn.
    if (here.owner !== null && getStance(state, f.owner, here.owner) !== 'war') continue;
    const enemyHere = Object.values(state.fleets).some(
      (g) => g.owner !== f.owner && g.location === f.location && g.units.some((u) => u.count > 0),
    );
    if (enemyHere) continue; // let the orbital battle settle first
    if (f.orbit !== 'near') {
      out.push({
        playerId: f.owner,
        action: {
          id: driverActionId('orbit', fid),
          type: 'fleet.orbit',
          playerId: f.owner,
          payload: { fleetId: fid, orbit: 'near' },
          issuedAt: state.time,
        },
      });
    }
    out.push({
      playerId: f.owner,
      action: {
        id: driverActionId('assault', fid),
        type: 'fleet.assault',
        playerId: f.owner,
        payload: { fleetId: fid },
        issuedAt: state.time,
      },
    });
  }
  return out;
}

/** The contact a patrol strikes this round: the lowest-id enemy inside the radius,
 *  and only while the wing is flight-ready. Stable tie-break by id — the same rule
 *  orbital AA / lane intercept use. Pure; null = hold fire. */
function patrolTarget(
  center: { x: number; y: number },
  radius: number,
  sortie: SortieState,
  enemies: Array<{ id: string; pos: { x: number; y: number } }>,
): string | null {
  if (!canSortie(sortie)) return null;
  let best: string | null = null;
  for (const e of enemies) {
    if (withinRange(center, e.pos, radius) && (best === null || e.id < best)) best = e.id;
  }
  return best;
}

const HOUR = 3_600_000;

/** One tick of the CC-4 standing-patrol driver: tick each patrol's rearm on its
 *  game-hour cadence, then — if the wing is parked and flight-ready — scramble at
 *  the lowest-id identified, at-war contact inside the radius. Vision comes from
 *  the owner's identify coverage, so a patrol never sees through its owner's fog.
 *  Returns the strike actions to submit, plus a `patrol.stamp` per fleet whose
 *  sortie/rearm state actually changed. */
export function patrolActions(
  state: GameState,
  data: GameData,
  now: number,
): Array<{ playerId: string; action: Action }> {
  const patrols = state.patrols ?? {};
  const out: Array<{ playerId: string; action: Action }> = [];
  const identify = new Map<string, Set<string>>(); // owner → identified nodes (hoisted per owner)
  // Sorted fleet-id iteration: JSONB does not preserve object key order, so unsorted
  // iteration would make the strike-issue order — and thus which of two co-located
  // wings wins a race for the same target — host-dependent. Sorting pins one order
  // across hosts and wake cycles (invariant #6).
  for (const fid of Object.keys(patrols).sort()) {
    const p = patrols[fid]!;
    const f = state.fleets[fid];
    if (!f || !fleetHasSquadron(f, data)) continue; // lost its wing — standingOrdersModule's own GC sweeps the entry
    const spec = sortieSpec(f, data);
    let sortie = p.sortie;
    let rearmAt = p.rearmAt ?? now + HOUR;
    while (now >= rearmAt) {
      sortie = tickRearm(sortie, spec.maxFuel);
      rearmAt += HOUR;
    }
    if (!f.movement && !f.battleId) {
      let seen = identify.get(f.owner);
      if (!seen) {
        seen = identifiedNodes(state, f.owner, data);
        identify.set(f.owner, seen);
      }
      const targets: Array<{ id: string; location: string; pos: { x: number; y: number } }> = [];
      for (const g of Object.values(state.fleets)) {
        if (g.owner === f.owner || !g.location || g.movement || !g.units.some((u) => u.count > 0)) {
          continue;
        }
        if (g.battleId) continue; // already locked in a battle — engage would reject
        if (getStance(state, f.owner, g.owner) !== 'war') continue; // declared enemies only
        if (!seen.has(g.location)) continue; // identified contacts only — fog-honest
        const pos = state.planets[g.location]?.position;
        if (pos) targets.push({ id: g.id, location: g.location, pos });
      }
      const pick = patrolTarget(p.center, p.radius, sortie, targets);
      if (pick !== null) {
        const foe = targets.find((t) => t.id === pick)!;
        out.push({
          playerId: f.owner,
          action:
            f.location === foe.location
              ? {
                  id: driverActionId('engage', fid),
                  type: 'fleet.engage',
                  playerId: f.owner,
                  payload: { fleetId: fid, targetId: foe.id },
                  issuedAt: state.time,
                }
              : {
                  id: driverActionId('move', fid),
                  type: 'fleet.move',
                  playerId: f.owner,
                  payload: { fleetId: fid, to: foe.location },
                  issuedAt: state.time,
                },
        });
        sortie = spendSortie(sortie, spec.rearmRounds);
      }
    }
    if (
      sortie.fuel !== p.sortie.fuel ||
      sortie.rearming !== p.sortie.rearming ||
      rearmAt !== p.rearmAt
    ) {
      out.push({
        playerId: f.owner,
        action: {
          id: driverActionId('patrol-stamp', fid),
          type: 'patrol.stamp',
          playerId: f.owner,
          payload: { fleetId: fid, sortie, rearmAt },
          issuedAt: state.time,
        },
      });
    }
  }
  return out;
}

/** Both drivers for one tick, in a fixed order (auto-storm then patrol) — the
 *  single call site `serverWiring.ts` needs. */
export function standingOrderTickActions(
  state: GameState,
  data: GameData,
  now: number,
): Array<{ playerId: string; action: Action }> {
  return [...autoAssaultActions(state, data), ...patrolActions(state, data, now)];
}
