/**
 * Squadron free-space movement — эскадрильи (и ракеты) летают СВОБОДНО в пространстве,
 * не по линиям (lane graph). Модель «вылет юнитом» (squadrons-roadmap.md §0):
 * эскадрилья выходит из трюма носителя как отдельный флот, летит к цели прямой
 * линией (не по lane), дерётся обычным боем, возвращается на перезарядку.
 *
 * Ограничение: эскадрилья не может улететь дальше `strikeRange` от `homeBase`.
 * Счётчик вылетов (`SortieState`) живёт в `state.patrols`/`state.wingSorties`
 * (управляется `standingOrdersModule`); этот модуль — только движение.
 *
 * Новый action: `squadron.strike { fleetId, targetFleetId }` — свободный полёт к цели.
 * Событие: `squadron.arrived { fleetId, owner }` — прибытие (бой или возврат).
 */
import type { GameModule, HandlerContext } from '../kernel/module';
import type { Fleet, GameState } from '../state/gameState';
import type { GameData } from '../data/schemas';
import { distance, fleetBaseSpeed } from '../state/route';
import { squadronStrikeRange, fleetHasSquadron } from '../state/squadron';
import { ownFleet, applyDamageToSide, removeIfWiped } from '../util/combat';
import { sumUnitStat } from '../util/stacks';
import { timeScaleOf } from '../action/types';
import { MS_PER_HOUR } from '../util/time';

/** Total point-defense (anti-squadron/anti-missile) firepower of a fleet —
 *  Σ the `pointDefense` stat of its live units (via effectiveStats, so modules
 *  are included). 0 = no point defense. */
function fleetPointDefense(fleet: Fleet, data: GameData): number {
  return sumUnitStat(fleet.units, data, 'pointDefense');
}

/** Default PD engagement range (map units) when the unit's `pointDefenseRange` is 0. */
const PD_RANGE = 120;
/** PD cooldown after a volley (game-minutes). Reducible by module upgrades + tech. */
const PD_COOLDOWN_MINUTES = 20;

/** PD range for a fleet — from its units' `pointDefenseRange` stat, or the default. */
function fleetPDRange(fleet: Fleet, data: GameData): number {
  let r = 0;
  for (const s of fleet.units) {
    if (s.count <= 0) continue;
    const def = data.units[s.unit];
    if (def) r = Math.max(r, (def.stats as Record<string, number>).pointDefenseRange ?? 0);
  }
  return r > 0 ? r : PD_RANGE;
}

/** A squadron's free-flight speed (map units / hour). */
function squadronSpeed(fleet: Fleet, data: GameData): number {
  return fleetBaseSpeed(fleet, data);
}

/** Get the current world position of a fleet (freePosition, location, or edge). */
function fleetWorldPos(fleet: Fleet, state: GameState): { x: number; y: number } | null {
  if (fleet.freePosition) return fleet.freePosition;
  if (fleet.location) return state.planets[fleet.location]?.position ?? null;
  if (fleet.edge) {
    const a = state.planets[fleet.edge.from]?.position;
    const b = state.planets[fleet.edge.to]?.position;
    if (!a || !b) return null;
    return { x: a.x + (b.x - a.x) * fleet.edge.t, y: a.y + (b.y - a.y) * fleet.edge.t };
  }
  return null;
}

/** Is this fleet a squadron (free-space mover with homeBase and squadron-trait units)? */
function isSquadronFleet(fleet: Fleet, data: GameData): boolean {
  return !!fleet.homeBase && fleetHasSquadron(fleet, data);
}

export const squadronModule: GameModule = {
  id: 'squadron',
  version: '1.0.0',
  setup(api) {
    /** `squadron.strike { fleetId, targetFleetId }` — launch a squadron fleet toward
     *  an enemy fleet in free space (not via lanes). The squadron must already be
     *  a separate fleet (split off via `fleet.split`), have a `homeBase`, and be
     *  within `strikeRange` of its base. The target must be an identified hostile. */
    api.onAction('squadron.strike', (action, h: HandlerContext) => {
      const payload = action.payload as { fleetId?: string; targetFleetId?: string };
      if (typeof payload?.fleetId !== 'string' || typeof payload?.targetFleetId !== 'string') {
        return h.reject('E_BAD_PAYLOAD');
      }
      const fleet = ownFleet(h.state, payload.fleetId);
      if (!fleet) {
        return h.reject('E_NO_FLEET');
      }
      // Must be a squadron fleet (has homeBase, has squadron-trait units)
      if (!fleet.homeBase) {
        return h.reject('E_NOT_SQUADRON');
      }
      if (!fleetHasSquadron(fleet, h.ctx.data)) {
        return h.reject('E_NOT_SQUADRON');
      }
      if (fleet.battleId) {
        return h.reject('E_IN_BATTLE');
      }
      if (fleet.freeMovement) {
        return h.reject('E_FLEET_BUSY'); // already flying
      }

      const target = h.state.fleets[payload.targetFleetId];
      if (!target) {
        return h.reject('E_NO_TARGET');
      }
      if (target.owner === action.playerId) {
        return h.reject('E_NOT_HOSTILE');
      }

      // The squadron must have a current position (freePosition or location)
      const origin = fleet.freePosition ?? fleetPosForSquadron(fleet, h.state);
      if (!origin) {
        return h.reject('E_NO_POSITION');
      }

      // Target position (from its location or freePosition)
      const targetPos = target.freePosition ?? h.state.planets[target.location ?? '']?.position ?? null;
      if (!targetPos) {
        return h.reject('E_NO_TARGET_POSITION');
      }

      // Range check: the target must be within strikeRange of the home base
      const base = h.state.fleets[fleet.homeBase];
      const basePos = base?.freePosition ?? h.state.planets[base?.location ?? '']?.position ?? null;
      if (!basePos) {
        return h.reject('E_NO_BASE');
      }
      const range = squadronStrikeRange(fleet, h.ctx.data);
      if (range <= 0) {
        return h.reject('E_NO_RANGE');
      }
      const distToTarget = distance(basePos, targetPos);
      if (distToTarget > range) {
        return h.reject('E_OUT_OF_RANGE');
      }

      // Compute flight time based on squadron speed
      const speed = squadronSpeed(fleet, h.ctx.data); // map units / hour
      if (speed <= 0) {
        return h.reject('E_NO_SPEED');
      }
      const flightHours = distance(origin, targetPos) / speed;
      const arrivesAt = h.ctx.now + Math.max(1, Math.round(flightHours * 3_600_000));

      // Set free movement
      fleet.freePosition = origin;
      fleet.freeMovement = {
        targetX: targetPos.x,
        targetY: targetPos.y,
        departedAt: h.ctx.now,
        arrivesAt,
      };
      fleet.location = null;
      fleet.edge = null;
      fleet.movement = null;

      h.schedule(arrivesAt, 'squadron.arrived', { fleetId: fleet.id, owner: action.playerId });
      h.emit('squadron.launched', { fleetId: fleet.id, owner: action.playerId, targetFleetId: target.id });
    });

    /** `squadron.return { fleetId }` — fly back to the home base in free space. */
    api.onAction('squadron.return', (action, h: HandlerContext) => {
      const payload = action.payload as { fleetId?: string };
      if (typeof payload?.fleetId !== 'string') {
        return h.reject('E_BAD_PAYLOAD');
      }
      const fleet = ownFleet(h.state, payload.fleetId);
      if (!fleet) {
        return h.reject('E_NO_FLEET');
      }
      if (!fleet.homeBase) {
        return h.reject('E_NOT_SQUADRON');
      }
      if (fleet.freeMovement) {
        return h.reject('E_FLEET_BUSY');
      }
      if (fleet.battleId) {
        return h.reject('E_IN_BATTLE');
      }

      const base = h.state.fleets[fleet.homeBase];
      const basePos = base?.freePosition ?? h.state.planets[base?.location ?? '']?.position ?? null;
      if (!basePos) {
        return h.reject('E_NO_BASE');
      }

      const origin = fleet.freePosition ?? fleetPosForSquadron(fleet, h.state);
      if (!origin) {
        return h.reject('E_NO_POSITION');
      }

      const speed = squadronSpeed(fleet, h.ctx.data);
      if (speed <= 0) {
        return h.reject('E_NO_SPEED');
      }
      const flightHours = distance(origin, basePos) / speed;
      const arrivesAt = h.ctx.now + Math.max(1, Math.round(flightHours * 3_600_000));

      fleet.freeMovement = {
        targetX: basePos.x,
        targetY: basePos.y,
        departedAt: h.ctx.now,
        arrivesAt,
      };

      h.schedule(arrivesAt, 'squadron.arrived', { fleetId: fleet.id, owner: action.playerId });
      h.emit('squadron.returning', { fleetId: fleet.id, owner: action.playerId });
    });

    /** `squadron.arrived` — free flight completed. The fleet parks at its target
     *  position. If the target was an enemy fleet, combat starts (via the existing
     *  `fleet.arrived` → collision logic in combatModule). If returning, the fleet
     *  docks back at its base. */
    api.on('squadron.arrived', (event, h: HandlerContext) => {
      const { fleetId, owner } = event.payload as { fleetId: string; owner: string };
      const fleet = h.state.fleets[fleetId];
      if (!fleet || !fleet.freeMovement) {
        return; // fleet gone or not in free flight — dead-letter
      }

      // Park at the destination
      fleet.freePosition = { x: fleet.freeMovement.targetX, y: fleet.freeMovement.targetY };
      fleet.freeMovement = null;

      // If the fleet is at its home base's position, dock (rejoin the carrier)
      if (fleet.homeBase) {
        const base = h.state.fleets[fleet.homeBase];
        const basePos = base?.freePosition ?? h.state.planets[base?.location ?? '']?.position ?? null;
        if (basePos && distance(fleet.freePosition, basePos) < 1) {
          // Docked: merge units back into the carrier
          if (base) {
            base.units = [...base.units];
            for (const st of fleet.units) {
              const existing = base.units.find((s) => s.unit === st.unit);
              if (existing) existing.count += st.count;
              else base.units.push({ ...st });
            }
            delete h.state.fleets[fleetId];
          }
          h.emit('squadron.docked', { fleetId, owner, baseId: fleet.homeBase });
          return;
        }
      }

      // Not at base — arrived at a target. Emit fleet.arrived so combatModule
      // can pick up the collision (if the target fleet is still there).
      // Point-defense is handled reactively on time.advanced (see below), not
      // as a one-shot check here — PD fires whenever an enemy squadron is in
      // range, not just on arrival.
      h.emit('fleet.arrived', { fleetId, departedAt: owner });
    });

    /** Reactive point-defense on time.advanced: for each fleet with PD > 0 that
     *  is NOT on cooldown, find all enemy squadrons in PD range. If any — fire
     *  one volley (full PD damage distributed evenly across all targets), then
     *  start the 20-minute cooldown. If none — PD stays ready (no cooldown).
     *
     *  This is REACTIVE, not periodic: PD fires the moment an enemy squadron
     *  enters range (detected on the next time.advanced tick), then recharges.
     *  The cooldown gates how fast a single PD system can respond to waves. */
    api.on('time.advanced', (_event, h: HandlerContext) => {
      const data = h.ctx.data;
      const cooldownMs = (PD_COOLDOWN_MINUTES / 60) * MS_PER_HOUR * timeScaleOf(h.ctx);

      for (const fleet of Object.values(h.state.fleets)) {
        // Skip fleets with no PD, or on cooldown
        const pd = fleetPointDefense(fleet, data);
        if (pd <= 0) continue;
        if (fleet.battleId) continue; // in combat — PD is part of the battle
        const cooldownUntil = fleet.pdCooldownUntil ?? 0;
        if (h.ctx.now < cooldownUntil) continue; // still recharging

        const myPos = fleetWorldPos(fleet, h.state);
        if (!myPos) continue;
        const range = fleetPDRange(fleet, data);

        // Find all enemy squadrons in PD range
        const targets: Fleet[] = [];
        for (const target of Object.values(h.state.fleets)) {
          if (target.owner === fleet.owner) continue;
          if (target.battleId) continue; // already in combat
          if (!isSquadronFleet(target, data)) continue; // PD only hits squadrons
          const tp = fleetWorldPos(target, h.state);
          if (!tp) continue;
          if (distance(myPos, tp) <= range) targets.push(target);
        }

        if (targets.length === 0) continue; // no one in range — PD stays ready

        // Distribute damage evenly across all targets
        const damagePerTarget = pd / targets.length;
        for (const target of targets) {
          h.emit('pd.fired', {
            fleetId: fleet.id,
            owner: fleet.owner,
            targetId: target.id,
            targetOwner: target.owner,
            damage: damagePerTarget,
          });
          // RAW on purpose (CORE-DMG-1): point-defense is not a melee round, so it
          // skips the `combat.damage` hook. Pinned by `damageHookScope.test.ts`.
          applyDamageToSide(h, { kind: 'fleet', fleetId: target.id }, damagePerTarget, data, '');
          removeIfWiped(h, target.id);
        }

        // Start cooldown
        fleet.pdCooldownUntil = h.ctx.now + cooldownMs;
      }
    });
  },
};

/** Get the current world position of a squadron fleet (from freePosition, or
 *  fall back to its planet location). */
function fleetPosForSquadron(fleet: Fleet, state: GameState): { x: number; y: number } | null {
  if (fleet.freePosition) return fleet.freePosition;
  if (fleet.location) return state.planets[fleet.location]?.position ?? null;
  return null;
}