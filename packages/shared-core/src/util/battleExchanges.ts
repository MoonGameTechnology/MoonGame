import type { HandlerContext } from '../kernel/module';
import type { Battle, BattleSide } from '../state/gameState';
import { hoursToMs } from '../action/types';
import { attacks } from '../state/battle';
import { combatSequence } from './combatSequence';
import { splitDealt, targetedVolley, type FireRole, type TargetedVolley } from './groundTargets';
import { OVERCHARGE_HOURS, spendVolley } from './overflow';
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

/** Враждебны ли две стороны боя — одно правило на залп, ответ и остаток. */
function hostileSides(h: HandlerContext, a: BattleSide, b: BattleSide): boolean {
  return (
    a.owner !== b.owner && (a.owner === null || b.owner === null || isHostile(h, a.owner, b.owner))
  );
}

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
    (a, b) => hostileSides(h, a, b),
    (side) => !attacks(side),
    (source, targets, role) => {
      const { left, volley } = fireWithOverflow(h, battle, source, targets, role, 1, incoming);
      if (left > 0) storeOvercharge(h, source, left * volley);
    },
  );
  return incoming;
}

/**
 * Залп `source` по `targets` с переносом остатка (`util/overflow.ts`): что не легло на
 * погибшую цель, уходит в живых врагов стрелка, по их собственной оценке — бонусы
 * атакующего и защита цели берутся хуком заново для каждой цели. Возвращает долю залпа,
 * которой не нашлось живой цели (`left`), и сам залп до хука (`volley`, по первой цели):
 * их произведение — урон заряда.
 */
function fireWithOverflow(
  h: HandlerContext,
  battle: Battle,
  source: BattleSide,
  targets: readonly BattleSide[],
  role: FireRole,
  budget: number,
  incoming: Map<BattleSide, HookedDamage>,
): { left: number; volley: number } {
  const shots = new Map<BattleSide, TargetedVolley>();
  const shotAt = (target: BattleSide): TargetedVolley => {
    let shot = shots.get(target);
    if (!shot) {
      shot = targetedVolley(
        sideUnits(h.state, source.ref) ?? [],
        sideUnits(h.state, target.ref) ?? [],
        h.ctx.data,
        role,
      );
      shots.set(target, shot);
    }
    return shot;
  };
  // Snapshot EVERY share before damage or return fire can change the source.
  for (const target of targets) shotAt(target);
  const living = (): BattleSide[] =>
    battle.sides.filter(
      (side) => side !== source && sideAlive(h.state, side.ref) && hostileSides(h, source, side),
    );
  const left = spendVolley(
    targets,
    living,
    (legs) => {
      // Оценка всего прохода — до того, как ляжет первый урон (тот же снимок, что выше).
      const priced = legs.map(({ target, budget: share }) => {
        const shot = shotAt(target);
        const dealt = hookedDamage(h, shot.total * share, {
          battleId: battle.id,
          phase: battle.phase,
          location: battle.location,
          attacker: source.owner,
          defender: target.owner,
          ...(source.ref.kind === 'fleet' ? { attackerFleet: source.ref.fleetId } : {}),
          ...(target.ref.kind === 'fleet' ? { defenderFleet: target.ref.fleetId } : {}),
        });
        return { target, shot, dealt, share };
      });
      return priced.map(({ target, shot, dealt, share }) => {
        const previous = incoming.get(target);
        incoming.set(target, previous === undefined ? dealt : addHooked(previous, dealt));
        if (!(dealt > 0)) return 0;
        const unspent = applyDamageToSide(
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
        // Заслуга ветерана — за то, что легло: остаток засчитается там, куда он уйдёт, иначе
        // доля погибшей цели была бы засчитана дважды.
        const landed = dealt - Math.max(0, unspent);
        if (landed > 0 && earnsMerit(h.state, source.owner, h.ctx.data))
          creditVolley(h.state, source.ref, shot, landed);
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
        // Остаток измеряется долей залпа: другая цель оценит её своим хуком.
        return share * Math.min(1, Math.max(0, unspent) / dealt);
      });
    },
    budget,
  );
  return { left, volley: targets[0] ? shotAt(targets[0]).total : 0 };
}

/** Урон без живой цели (до хука) — заряд флота на {@link OVERCHARGE_HOURS} игрового времени.
 *  Заряд — число, а не доля будущего залпа: «9 остаются заряженными» — это 9, сколько бы
 *  флот ни окреп или ни потерял к разрядке. */
function storeOvercharge(h: HandlerContext, side: BattleSide, damage: number): void {
  if (side.ref.kind !== 'fleet' || !(damage > 0)) return;
  const fleet = h.state.fleets[side.ref.fleetId];
  if (!fleet) return;
  const live =
    fleet.overcharge && fleet.overcharge.until >= h.ctx.now ? fleet.overcharge.damage : 0;
  fleet.overcharge = {
    damage: live + damage,
    until: h.ctx.now + hoursToMs(h.ctx, OVERCHARGE_HOURS),
  };
}

/**
 * Разрядить заряды флотов боя `battleId` (резолюция владельца 2026-11-17): флот, у которого
 * от прошлого залпа остался урон без цели, сошёлся с врагом раньше, чем истекли пять
 * игровых минут, — урон уходит в живых врагов поровну, с тем же переносом остатка. Ответа
 * на разрядку нет: это хвост залпа, на который уже ответили. Истёкший заряд снимается.
 */
export function dischargeOvercharges(h: HandlerContext, battleId: string): void {
  const battle = h.state.battles[battleId];
  if (!battle) return;
  for (const side of battle.sides) {
    if (side.ref.kind !== 'fleet') continue;
    const fleet = h.state.fleets[side.ref.fleetId];
    const charge = fleet?.overcharge;
    if (!fleet || !charge) continue;
    if (charge.until < h.ctx.now || !sideAlive(h.state, side.ref)) {
      delete fleet.overcharge;
      continue;
    }
    const targets = battle.sides.filter(
      (other) => other !== side && sideAlive(h.state, other.ref) && hostileSides(h, side, other),
    );
    if (targets.length === 0) continue;
    delete fleet.overcharge;
    // Урон заряда переводится в долю ТЕКУЩЕГО залпа только для раскладки по целям: доля ×
    // залп снова даёт ровно `charge.damage`. Флот, которому нечем стрелять, разрядиться не может.
    const volley = targetedVolley(
      sideUnits(h.state, side.ref) ?? [],
      sideUnits(h.state, targets[0]!.ref) ?? [],
      h.ctx.data,
      'attack',
    ).total;
    if (!(volley > 0)) continue;
    const { left } = fireWithOverflow(
      h,
      battle,
      side,
      targets,
      'attack',
      charge.damage / volley,
      new Map(),
    );
    if (left > 0) fleet.overcharge = { damage: left * volley, until: charge.until };
  }
}
