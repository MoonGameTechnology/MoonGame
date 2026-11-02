import { volleyShare } from './volley';
import type { HandlerContext } from '../kernel/module';
import type { Battle, BattleSide } from '../state/gameState';
import { attacks } from '../state/battle';
import { combatSequence } from './combatSequence';
import { splitDealt, targetedVolley } from './groundTargets';
import {
  addHooked,
  applyDamageToSide,
  creditVolley,
  earnsMerit,
  hookedDamage,
  isAllied,
  isHostile,
  sideAlive,
  sideUnits,
  type HookedDamage,
} from './combat';
import { wearStructures } from './structureDamage';

/** Execute the ready sources in clock/entry order and return round-report totals. */
export function battleExchanges(
  h: HandlerContext,
  battle: Battle,
  due: readonly BattleSide[],
): Map<BattleSide, HookedDamage> {
  const incoming = new Map<BattleSide, HookedDamage>();
  combatSequence(
    battle.sides,
    due,
    (side) => sideAlive(h.state, side.ref),
    (a, b) =>
      a.owner !== b.owner &&
      (a.owner === null || b.owner === null || isHostile(h, a.owner, b.owner)),
    (side) => !attacks(side),
    (source, targets, role) => {
      // Snapshot EVERY share before damage or return fire can change the source.
      const shots = targets.map((target) => {
        const shot = targetedVolley(
          sideUnits(h.state, source.ref) ?? [],
          sideUnits(h.state, target.ref) ?? [],
          h.ctx.data,
          role,
        );
        const dealt = hookedDamage(h, volleyShare(shot.total, targets.length), {
          battleId: battle.id,
          phase: battle.phase,
          location: battle.location,
          attacker: source.owner,
          defender: target.owner,
          ...(source.ref.kind === 'fleet' ? { attackerFleet: source.ref.fleetId } : {}),
          ...(target.ref.kind === 'fleet' ? { defenderFleet: target.ref.fleetId } : {}),
        });
        if (earnsMerit(h.state, source.owner, h.ctx.data))
          creditVolley(h.state, source.ref, shot, dealt);
        return { target, shot, dealt };
      });
      for (const { target, shot, dealt } of shots) {
        const previous = incoming.get(target);
        incoming.set(target, previous === undefined ? dealt : addHooked(previous, dealt));
        if (!(dealt > 0)) continue;
        applyDamageToSide(
          h,
          target.ref,
          dealt,
          h.ctx.data,
          battle.location,
          battle.id,
          splitDealt(shot.pools, shot.total, dealt),
          source.owner,
          undefined,
          { [source.owner ?? '\u0000neutral']: dealt },
        );
        const planet = h.state.planets[battle.location];
        if (
          battle.phase === 'ground' &&
          planet &&
          (planet.owner === target.owner ||
            (planet.owner !== null &&
              target.owner !== null &&
              isAllied(h, planet.owner, target.owner)))
        ) {
          wearStructures(h, planet.id, dealt * 0.5, planet.owner);
        }
      }
    },
  );
  return incoming;
}
