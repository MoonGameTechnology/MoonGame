/** Челноки: зональное ПВО и перехват. Разрезан из `../shuttle.ts` (SLIM). */
import type { ModuleSetupApi } from '../../kernel/module';
import {
  type BaseView,
  absorbIntoStrike,
  fleetBase,
  hourMs,
  interceptReach,
  nearestHostileStrike,
  planetBase,
  refuelUntil,
  withHangar,
} from './kit';
import type { Fleet } from '../../state/gameState';
import type { HandlerContext } from '../../kernel/module';
import { PD_COOLDOWN_MINUTES, fleetPDRange, fleetPointDefense } from '../../util/pointDefense';
import { hangarMachines, hullShare, squadronRefueling } from '../../state/shuttle';
import { applyDamageToSide, hookedDamage, isHostile } from '../../util/combat';
import { cappedUnitStat } from '../../util/stacks';
import { clearMine } from './flight';
import { distance } from '../../state/route';
import { effectiveStats } from '../../util/loadout';
import { fleetNodeAt, fleetPositionAt } from '../../state/fleetPosition';
import { isMineFleet, mineFleetVisible } from '../../state/minefields';
import { isMissileFleet } from '../../state/ordnance';
import { recordValues } from '../../util/records';
import { strikePosition } from '../../state/strikePosition';

/** Зональное ПВО и перехват. */
export function registerAirDefense(api: ModuleSetupApi): void {
  /**
   * ТОЧЕЧНАЯ ОБОРОНА — единственная контрмера челнокам (SHU-1.2; полный перехват с
   * подъёмом своих перехватчиков — SHU-1.3). Реактивно, на `time.advanced`: флот с
   * `pointDefense` вне боя и вне перезарядки бьёт по ЧУЖИМ ВЫЛЕТАМ, проходящим в его
   * радиусе, и сбивает их машины. Один залп делится поровну между всеми целями в
   * радиусе, затем 20 игровых минут перезарядки.
   *
   * Раньше здесь целями были «флоты-крылья» — сущность, которой в новой модели нет.
   * Цель сменилась вместе с моделью, механика (радиус, кулдаун, деление залпа) — та же.
   *
   * Тот же залп бьёт и ЧУЖИЕ МИНЫ в радиусе (решение владельца 2026-10-13): мина — отряд,
   * и снимают её те же, кто сбивает челноки. Только видимую хозяину ПВО (`mineFleetVisible`),
   * как и челноки: иначе корабль с ПВО тралил бы невидимые мины, и ловушка перестала бы
   * работать. Только враждебную (`isHostile`): мину союзника не трогают. Залп один на все
   * цели, перезарядка общая — мина не уводит залп в сторону от идущего налёта.
   *
   * Мина ждёт, а ракета нет: пока враждебная ракета в радиусе, корабль мину не бьёт, иначе
   * общая перезарядка ушла бы на мину, и ракета прошла бы ПВО (`rocketMines`) нетронутой
   * (замечание Codex на #1626). Видимость мин считается один раз на хозяина ПВО, а не на
   * каждый корабль. Уцелевшая мина ставит в расписание `pd.reload` на конец перезарядки:
   * без игроков время идёт от события к событию, и следующего залпа иначе не было бы.
   */
  api.on('time.advanced', (_event, h: HandlerContext) => {
    const strikes = h.state.strikes ?? [];
    const data = h.ctx.data;
    const mines = recordValues(h.state.fleets).filter((f) => isMineFleet(f, data));
    if (strikes.length === 0 && mines.length === 0) return;
    const missiles =
      mines.length > 0 ? recordValues(h.state.fleets).filter((f) => isMissileFleet(f, data)) : [];
    const seenMines = new Map<string, Set<string>>();
    const minesSeenBy = (owner: string): Set<string> => {
      let seen = seenMines.get(owner);
      if (!seen) {
        seen = new Set(mines.filter((m) => mineFleetVisible(h.state, m, owner, data)).map((m) => m.id));
        seenMines.set(owner, seen);
      }
      return seen;
    };
    const cooldownMs = (PD_COOLDOWN_MINUTES / 60) * hourMs(h);

    for (const fleet of recordValues(h.state.fleets)) {
      const pd = fleetPointDefense(fleet, data);
      if (pd <= 0) continue;
      if (fleet.battleId) continue; // в бою зональное ПВО — часть боя
      if (h.ctx.now < (fleet.pdCooldownUntil ?? 0)) continue;
      const myPos = fleetPositionAt(h.state, fleet, h.ctx.now);
      if (!myPos) continue;
      const range = fleetPDRange(fleet, data);

      const targets = strikes.filter((st) => {
        if (st.owner === fleet.owner || st.units.length === 0) return false;
        const p = strikePosition(st, h.state, h.ctx.now);
        return !!p && distance(myPos, p) <= range;
      });
      const inRange = (f: Fleet): boolean => {
        const p = fleetPositionAt(h.state, f, h.ctx.now);
        return !!p && distance(myPos, p) <= range;
      };
      const missileNear = missiles.some(
        (m) => !!h.state.fleets[m.id] && isHostile(h, fleet.owner, m.owner) && inRange(m),
      );
      const mineTargets = missileNear
        ? []
        : mines.filter(
            (m) =>
              !!h.state.fleets[m.id] &&
              isHostile(h, fleet.owner, m.owner) &&
              inRange(m) &&
              minesSeenBy(fleet.owner).has(m.id),
          );
      if (targets.length + mineTargets.length === 0) continue;

      const perTarget = pd / (targets.length + mineTargets.length);
      for (const target of targets) {
        const dealt = hookedDamage(h, perTarget, {
          phase: 'pointDefense',
          location: fleet.location ?? '',
          attacker: fleet.owner,
          defender: target.owner,
          attackerFleet: fleet.id, // зональное ПВО ведёт сам корабль (CORE-DMG-3)
        });
        // Урон переводится в СБИТЫЕ МАШИНЫ по корпусу челнока — счёт один на все
        // каналы, см. `absorbIntoStrike`.
        const downed = absorbIntoStrike(target, dealt, data, h, fleet.owner);
        h.emit('pd.fired', {
          fleetId: fleet.id,
          owner: fleet.owner,
          strikeId: target.id,
          targetOwner: target.owner,
          damage: dealt,
          downed,
        });
      }
      // Узел стрелка — и на дороге: позиционные хуки (сектор, ауры героя) пустую строку
      // пропускают (замечание Codex на #1626).
      const node = fleetNodeAt(h.state, fleet, h.ctx.now) ?? '';
      for (const mine of mineTargets) {
        const dealt = hookedDamage(h, perTarget, {
          phase: 'pointDefense',
          location: node,
          attacker: fleet.owner,
          defender: mine.owner,
          attackerFleet: fleet.id,
          defenderFleet: mine.id,
        });
        const at = fleetNodeAt(h.state, mine, h.ctx.now) ?? '';
        applyDamageToSide(h, { kind: 'fleet', fleetId: mine.id }, dealt, data, at, undefined, undefined, fleet.owner);
        clearMine(h, fleet.owner, mine.id, 'pd.mineCleared');
      }
      fleet.pdCooldownUntil = h.ctx.now + cooldownMs;
      if (mineTargets.some((m) => h.state.fleets[m.id])) {
        h.schedule(fleet.pdCooldownUntil, 'pd.reload', { fleetId: fleet.id });
      }
    }
    // Вылет, у которого не осталось машин, до цели не долетит. Без вылетов список не
    // заводится: залп по одним минам не должен дописывать в состояние пустой `strikes`.
    if (strikes.length > 0) h.state.strikes = strikes.filter((st) => st.units.length > 0);
  });
  // Конец перезарядки ПВО у недобитой мины. Своей работы у события нет: оно лишь делит
  // время, и залп выше срабатывает на своём `time.advanced` в эту минуту.
  api.on('pd.reload', () => {});

  /**
   * ПЕРЕХВАТ (SHU-1.3) — вторая контрмера челнокам и единственная АКТИВНАЯ: своя
   * база поднимает машины навстречу чужому вылету, проходящему в её радиусе, и
   * сбивает его корпуса. Реактивно, как и зональное ПВО: приказа не нужно —
   * дежурное звено взлетает само, иначе игрок оборонялся бы только сидя у экрана.
   *
   * Три вещи, которые здесь легко потерять при правке:
   *
   * Interceptors use their remaining hull and the air-wing size threshold.
   * Only squadrons that are not refuelling take part; after the pass each of them
   * refuels like a landed sortie (owner's decision 2026-11-17, replaced the base's
   * shared sortie pool). Targets the nearest hostile flight in range.
   */
  api.on('time.advanced', (_event, h: HandlerContext) => {
    const strikes = h.state.strikes ?? [];
    if (strikes.length === 0) return;
    const data = h.ctx.data;
    // Без машин в ангаре перехватывать нечем (сила 0 ниже), поэтому вид базы — только там.
    const bases: BaseView[] = [
      ...recordValues(h.state.planets)
        .filter(withHangar)
        .map((planet) => planetBase(planet, data)),
      ...recordValues(h.state.fleets)
        .filter(withHangar)
        .map((fleet) => fleetBase(fleet, h.state, data, h.ctx.now)),
    ];
    for (const base of bases) {
      if (base.owner === null || base.position === null) continue;
      // Охотники — эскадры, что не заправляются; машины без `shuttleDamage` в них не идут.
      const hunters = base.hangar.filter(
        (squad) =>
          !squadronRefueling(squad, h.ctx.now) &&
          squad.units.some(
            (st) => st.count > 0 && (data.units[st.unit]?.stats.shuttleDamage ?? 0) > 0,
          ),
      );
      if (hunters.length === 0) continue;
      const machines = hangarMachines({ hangar: hunters });
      const healthyMachines = hunters.flatMap((squad) => {
        const health = hullShare(squad.units, squad.damage, data);
        return squad.units.map(stack => ({ ...stack,
          hp: (stack.hp ?? stack.count * (effectiveStats(data.units[stack.unit]!, stack, data).hp ?? 1)) * health,
        }));
      });
      const power = cappedUnitStat(healthyMachines, data, 'shuttleDamage');
      if (power <= 0) continue; // в ангаре нет охотников
      const reach = interceptReach(machines, data);
      if (reach <= 0) continue;

      const target = nearestHostileStrike(strikes, base, reach, h);
      if (!target) continue;

      const dealt = hookedDamage(h, power, {
        phase: 'intercept',
        // CORE-DMG-3: у базы-НОСИТЕЛЯ узел тоже есть — он был потерян пустой строкой,
        // и вместе с ним для этого канала пропадали все позиционные хуки (сектор,
        // ауры героя), хотя перехват идёт над вполне конкретной клеткой.
        location:
          base.ref.kind === 'planet'
            ? base.ref.id
            : (h.state.fleets[base.ref.id]?.location ?? ''),
        attacker: base.owner,
        defender: target.owner,
        // Перехватчики с МИРА — не флот; с носителя — он самый.
        ...(base.ref.kind === 'fleet' ? { attackerFleet: base.ref.id } : {}),
      });
      // Тот же перевод урона в сбитые машины, что у зонального ПВО (`absorbIntoStrike`).
      const downed = absorbIntoStrike(target, dealt, data, h, base.owner);
      const flew = new Set(hunters.map((squad) => squad.id));
      base.setHangar(
        base.hangar.map((squad) =>
          flew.has(squad.id) ? { ...squad, ...refuelUntil(h, squad.units) } : squad,
        ),
      );
      h.emit('shuttle.intercepted', {
        baseId: base.ref.id,
        baseKind: base.ref.kind,
        owner: base.owner,
        strikeId: target.id,
        targetOwner: target.owner,
        damage: dealt,
        downed,
      });
    }
    h.state.strikes = strikes.filter((st) => st.units.length > 0);
  });
}
