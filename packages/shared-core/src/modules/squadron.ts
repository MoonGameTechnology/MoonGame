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
import { ownFleet } from '../util/combat';
import { sumUnitStat } from '../util/stacks';

/** Total point-defense (anti-squadron/anti-missile) firepower of a fleet —
 *  Σ the `pointDefense` stat of its live units. 0 = no point defense. */
function fleetPointDefense(fleet: Fleet, data: GameData): number {
  return sumUnitStat(fleet.units, data, 'pointDefense');
}

/** A squadron's free-flight speed (map units / hour). Squadrons are fast — they
 *  use their own `speed` stat, not the fleet's weighted average. */
function squadronSpeed(fleet: Fleet, data: GameState['version'] extends never ? never : import('../data/schemas').GameData): number {
  return fleetBaseSpeed(fleet, data);
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

      // Not at base — arrived at a target. Point-defense interception: the
      // target fleet (if it has pointDefense) fires on the incoming squadron
      // BEFORE combat starts. If the squadron is wiped, no combat — it was shot
      // down in approach (like flak shredding a strike wing before it reaches
      // the hull). This is the counter-play to squadrons (missiles-roadmap MS-2.1).
      const targetFleet = Object.values(h.state.fleets).find(
        (f) =>
          f.owner !== owner &&
          f.freePosition &&
          fleet.freePosition &&
          distance(f.freePosition, fleet.freePosition) < 5,
      );
      if (targetFleet) {
        const pd = fleetPointDefense(targetFleet, h.ctx.data);
        if (pd > 0) {
          // One hour of point-defense fire shreds the incoming wing. The squadron's
          // total HP vs the PD damage determines if it survives to fight.
          const squadronHp = fleet.units.reduce(
            (sum, st) => sum + st.count * (h.ctx.data.units[st.unit]?.stats.hp ?? 0),
            0,
          );
          if (pd >= squadronHp) {
            // Shot down — the squadron is destroyed before reaching combat.
            h.emit('squadron.intercepted', {
              fleetId,
              owner,
              by: targetFleet.owner,
              interceptorId: targetFleet.id,
            });
            delete h.state.fleets[fleetId];
            return;
          }
          // Survived the flak — but took damage. Apply proportionally to stacks.
          // The squadron proceeds to combat with reduced strength.
          h.emit('squadron.flak', {
            fleetId,
            owner,
            by: targetFleet.owner,
            interceptorId: targetFleet.id,
            damage: pd,
          });
        }
      }

      // Emit fleet.arrived so combatModule can pick up the collision (if the
      // target fleet is still there).
      h.emit('fleet.arrived', { fleetId, departedAt: owner });
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