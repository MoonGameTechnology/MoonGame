/** Челноки: удержание патруля, выбор цели удара, нога «туда» и приказы эскадре в воздухе. Разрезан из `../shuttle.ts` (SLIM). */
import {
  type BaseView,
  type Flyer,
  PATROL_TICK_SHARE,
  absorbIntoStrike,
  divideSquadron,
  fleetBase,
  hourMs,
  nextSquadronId,
  nextStrikeId,
  ownStrike,
  planetBase,
  reorder,
  requireSquadron,
  scheduleLeg,
} from './kit';
import type {
  Fleet,
  Planet,
  ShuttleStrike,
  Squadron,
  StrikeBase,
  UnitStack,
} from '../../state/gameState';
import type { HandlerContext } from '../../kernel/module';
import { type PatrolContact, patrolTarget } from '../../state/patrol';
import { addUnits, cappedUnitStat } from '../../util/stacks';
import {
  baseBlock,
  baseFromPayload,
  flightTime,
  flyTo,
  hitMissile,
  landCargo,
  landingSpot,
  patrolCheck,
  repelStrike,
  squadronReady,
  startPatrol,
  strikeAirPower,
  strikeAttackerFleet,
  strikeFleet,
  strikeGroundPower,
  strikePower,
  takeOffPatrol,
  trimCargoToSurvivors,
  turnHome,
} from './flight';
import { basePosition, homePosition, strikePosition } from '../../state/strikePosition';
import { deepClone } from '../../util/clone';
import { distance } from '../../state/route';
import { fireOnGarrison } from '../../util/groundFire';
import { fleetPositionAt } from '../../state/fleetPosition';
import {
  fleetShuttleBay,
  hasMissiles,
  shuttleBayAt,
  squadronFerryRange,
  squadronReach,
  stacksSize,
} from '../../state/shuttle';
import { hookedDamage, isHostile, mitigationFactor, ownFleet } from '../../util/combat';
import { isForkSite } from '../../state/forkSite';
import { isMineFleet, mineFleetVisible } from '../../state/minefields';
import { isMissileFleet } from '../../state/ordnance';
import { isVisibleTo } from '../../state/visibility';
import { planetPointDefense } from '../../util/pointDefense';
import { wearStructures } from '../../util/structureDamage';

/** Как часто удержание пробует поднять патруль снова, когда мешает бой корабля или
 *  подбитый порт (SHU-6.6): их конец ядро заранее не знает. Час — шаг остальных
 *  почасовых механик. Конец перезарядки, наоборот, известен, и его ждут точно. */
const HOLD_RETRY_HOURS = 1;

/**
 * ДЕРЖАТЬ ПАТРУЛЬ (SHU-6.6, резолюция владельца 2026-10-04) — поднять снова эскадру,
 * вернувшуюся из удерживаемого патруля. Зовёт только собственное событие
 * `shuttle.patrol.resume`; посадка назначает его на ту же минуту, а не поднимает эскадру
 * сама: бросок посреди подъёма отправил бы в dead letter всё событие посадки, и эскадра
 * повисла бы в воздухе навсегда. Решения, которые легко потерять при правке:
 *
 * 1. **Поднимает ЯДРО, а не драйвер хоста.** Дежурный вылет, который удержание заменило,
 *    жил драйверами — свой у сервера, свой у прототипа — и прикрывал офлайн-игрока только
 *    там, где хост их крутил. Удержание — событие расписания: та же партия даёт тот же
 *    патруль на любом хосте и в реплее.
 * 2. **Проверки — те же, что у приказа** (`baseBlock`, `squadronReady`, `patrolCheck`).
 * 3. **Ждут только того, что пройдёт само.** Конец перезарядки известен — будим ровно
 *    тогда. Бой корабля и подбитый порт кончатся неизвестно когда — пробуем раз в час.
 *    Остальное само не пройдёт (состав больше не висит, точка вне радиуса), и удержание
 *    снимается громко, событием `shuttle.hold.ended`, а не будит мир вечно.
 * 4. **Точка у мира прежняя, у корабля — над ним самим.** Корабль ходит, и точка,
 *    выбранная у прежней стоянки, через сутки похода оказалась бы за радиусом.
 * 5. **Эскадру ищут по id, а не по базе, где она села.** Ангар корабля уезжает в другой
 *    флот при слиянии (`fuseFleets`) вместе с удержанием, и проснувшееся по старой базе
 *    событие не нашло бы её: эскадра держала бы патруль, который больше не встаёт.
 */
export function resumeHold(h: HandlerContext, owner: string, squadronId: string): void {
  const base = squadronHome(h, owner, squadronId);
  const squad = base?.hangar.find((q) => q.id === squadronId);
  // Эскадра улетела по другому приказу, перегружена, слита — держать нечего.
  if (!base || !squad?.hold) return;
  const ref = base.ref;
  const hold = squad.hold;
  const notNow = (why: string): void => {
    const wait = holdWait(h, base, why);
    if (wait !== null) {
      h.schedule(h.ctx.now + wait, 'shuttle.patrol.resume', { owner, squadronId });
      return;
    }
    delete squad.hold;
    h.emit('shuttle.hold.ended', { owner, baseId: ref.id, baseKind: ref.kind, squadronId, code: why });
  };
  // Корабль в бою не выпускает — то же правило, что у приказа (`baseFromPayload`).
  const busy = ref.kind === 'fleet' && h.state.fleets[ref.id]?.battleId ? 'E_FLEET_BUSY' : null;
  const ready = busy ?? baseBlock(base) ?? squadronReady(h, base, squad);
  if (typeof ready === 'string') return notNow(ready);
  const route = patrolCheck(h, base.position, squad, ref.kind === 'planet' ? (hold.at ?? null) : base.position);
  if (typeof route === 'string') return notNow(route);
  takeOffPatrol(h, owner, base, ready, route, true); // удержание уходит с эскадрой на вылет
}

/** База, в ангаре которой стоит эскадра игрока, — или `null`. Id эскадр не повторяются
 *  (`nextSquadronId`), поэтому база одна (правило 5 `resumeHold`). */
function squadronHome(h: HandlerContext, owner: string, squadronId: string): BaseView | null {
  const has = (hangar: Squadron[] | undefined) => (hangar ?? []).some((q) => q.id === squadronId);
  for (const planet of Object.values(h.state.planets)) {
    if (planet.owner === owner && has(planet.hangar)) return planetBase(planet, h.ctx.data);
  }
  for (const fleet of Object.values(h.state.fleets)) {
    if (fleet.owner === owner && has(fleet.hangar)) {
      return fleetBase(fleet, h.state, h.ctx.data, h.ctx.now);
    }
  }
  return null;
}

/** Сколько ждать до следующей попытки поднять удерживаемый патруль — или `null`, если
 *  помеха сама не пройдёт (правило 3 `resumeHold`). */
function holdWait(h: HandlerContext, base: BaseView, why: string): number | null {
  const hour = hourMs(h);
  if (why === 'E_FLEET_BUSY' || why === 'E_PORT_DAMAGED') {
    return Math.max(1, Math.round(HOLD_RETRY_HOURS * hour));
  }
  if (why !== 'E_NO_FUEL' || !base.sortie || base.sortie.rearming <= 0) return null;
  // Перезарядка кончится, когда отстоит свои часы целиком: остаток сверх целых часов уже
  // накоплен (`carry`), поэтому срок не зависит от того, как хост нарезал время.
  return Math.max(1, Math.ceil(base.sortie.rearming * hour - (base.sortie.carry ?? 0)));
}

/**
 * ТИК ПАТРУЛЯ (SHU-6.2, резолюция владельца 2026-10-04) — по кому и чем бьёт висящая
 * эскадра. Решения, которые легко потерять при правке:
 *
 * 1. **Одна цель за тик — БЛИЖАЙШАЯ к точке**, при равной дистанции меньший id; граница
 *    круга включительна (`patrolTarget`). Правило выбора то же, что у перехвата
 *    (`nearestHostileStrike`): второй прицел у одного оружия объяснить игроку нечем.
 * 2. **Цели — враждебные флоты и враждебные вылеты.** Флот бьётся и стоящий, и идущий
 *    мимо (позиция живая, `fleetPositionAt`), вылет — и летящий, и висящий в своём
 *    патруле. Миры патруль не бомбит (развилка 2а владельца). Враждебность — `isHostile`:
 *    союзник и партнёр по миру — не цели. Невидимая мина — не цель, как и для удара.
 * 3. **Бьётся только то, чему патруль может навредить.** По флотам — `attack`, по вылетам
 *    и ракетам — `shuttleDamage` (ракета — воздушная цель, SM-3.7d); безоружная половина не
 *    выбирает цель, иначе чистый охотник за машинами нырял бы под пушки флота ради нуля
 *    урона.
 * 4. **По флоту — тот же удар, что по прибытии, долей тика**, с ответкой той же долей
 *    (`strikeFleet`). **По вылету — тот же канал, что перехват** (фаза `intercept`,
 *    событие `shuttle.intercepted` с `patrolId`): чужой вылет не отвечает, как не
 *    отвечает он перехвату (SHU-1.3); два патруля бьют друг друга каждый в свой тик.
 */
export function patrolStrike(h: HandlerContext, strike: ShuttleStrike): void {
  const radius = strike.patrol?.radius ?? 0;
  const data = h.ctx.data;
  const now = h.ctx.now;
  const vsFleet = strikePower(strike, data, 'fleet') * PATROL_TICK_SHARE;
  const vsAir = strikeAirPower(strike, data) * PATROL_TICK_SHARE;
  const contacts: PatrolContact[] = [];
  if (vsFleet > 0) {
    for (const f of Object.values(h.state.fleets)) {
      if (f.owner === strike.owner || !isHostile(h, strike.owner, f.owner)) continue;
      if (!f.units.some((st) => st.count > 0)) continue;
      if (isMissileFleet(f, data)) continue; // ракета — воздушная цель, ниже
      if (isMineFleet(f, data) && !mineFleetVisible(h.state, f, strike.owner, data)) continue;
      const pos = fleetPositionAt(h.state, f, now);
      if (pos) contacts.push({ id: f.id, pos });
    }
  }
  if (vsAir > 0) {
    for (const st of h.state.strikes ?? []) {
      if (st.owner === strike.owner || st.units.length === 0) continue;
      if (!isHostile(h, strike.owner, st.owner)) continue;
      const pos = strikePosition(st, h.state, now);
      if (pos) contacts.push({ id: st.id, pos });
    }
    for (const f of Object.values(h.state.fleets)) {
      if (!isMissileFleet(f, data) || !isHostile(h, strike.owner, f.owner)) continue;
      const pos = fleetPositionAt(h.state, f, now);
      if (pos) contacts.push({ id: f.id, pos });
    }
  }
  const pick = patrolTarget(strike.to, radius, contacts);
  if (pick === null) return;
  // id флота и id вылета не пересекаются: вылет всегда `strike:…` (см. `launchFlight`).
  const fleet = Object.prototype.hasOwnProperty.call(h.state.fleets, pick)
    ? h.state.fleets[pick]
    : undefined;
  if (fleet && isMissileFleet(fleet, data)) return hitMissile(h, strike, fleet, vsAir);
  if (fleet) return strikeFleet(h, strike, fleet, PATROL_TICK_SHARE);
  const target = (h.state.strikes ?? []).find((st) => st.id === pick);
  if (!target) return;
  const dealt = hookedDamage(h, vsAir, {
    phase: 'intercept',
    // Бой идёт в открытом небе у точки патруля, а не над базой: узла нет, как у удара по
    // флоту в перелёте. Узел базы отдал бы патрулю «домашний» бонус сектора вдали от дома.
    location: '',
    attacker: strike.owner,
    defender: target.owner,
    ...strikeAttackerFleet(strike),
  });
  const downed = absorbIntoStrike(target, dealt, data, h, strike.owner);
  h.emit('shuttle.intercepted', {
    baseId: strike.base.id,
    baseKind: strike.base.kind,
    owner: strike.owner,
    strikeId: target.id,
    targetOwner: target.owner,
    damage: dealt,
    downed,
    patrolId: strike.id,
  });
  // Сбитый целиком вылет до цели не долетит и в состоянии не остаётся.
  if (target.units.length === 0) {
    h.state.strikes = (h.state.strikes ?? []).filter((st) => st.id !== target.id);
  }
}

/** Ракета прошла отрезок [from, to] своего полёта (SM-3.7d): шаг или последний отрезок до
 *  цели. Даёт `shuttle`, зовёт `rocketMines`; нет модуля челноков — некому и стрелять. */
export type MissileFlew = (
  h: HandlerContext,
  missileId: string,
  from: { x: number; y: number },
  to: { x: number; y: number },
) => void;

/** Расстояние от точки до отрезка [a, b] — пересёк ли путь ракеты круг патруля. */
export function distanceToSegment(
  a: { x: number; y: number },
  b: { x: number; y: number },
  p: { x: number; y: number },
): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 > 0 ? Math.min(1, Math.max(0, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2)) : 0;
  return distance(p, { x: a.x + dx * t, y: a.y + dy * t });
}

/** Цель удара, проверенная по всем правилам приказа: флот или мир, и груз, который
 *  вылет везёт. */
type StrikeAim = {
  target: { kind: 'fleet'; id: string } | { kind: 'planet'; id: string };
  fleet?: Fleet;
  planet?: Planet;
  cargo: UnitStack[];
};

/**
 * ЦЕЛЬ УДАРА — одна проверка на вылет из ангара и на новую цель эскадры в воздухе
 * (SHU-6.13): вторая копия этих правил пустила бы в воздухе то, что ангар отбивает, —
 * невидимую мину, свой мир без десанта, флот без пушек. Дальность здесь не проверяется:
 * её точку отсчёта (база) и её расчёт задаёт вызывающий.
 */
export function strikeAimOf(
  h: HandlerContext,
  playerId: string,
  squad: Flyer,
  p: { targetFleetId?: unknown; targetPlanetId?: unknown },
): StrikeAim {
  // Цель: чужой флот или чужой мир. Ровно одна из двух — payload-схема этого не
  // выражает, поэтому проверяем здесь (fail-secure: обе или ни одной → отказ).
  const wantFleet = typeof p.targetFleetId === 'string';
  const wantPlanet = typeof p.targetPlanetId === 'string';
  if (wantFleet === wantPlanet) return h.reject('E_BAD_PAYLOAD');
  const targetFleet = wantFleet ? h.state.fleets[p.targetFleetId as string] : undefined;
  const targetPlanet = wantPlanet ? h.state.planets[p.targetPlanetId as string] : undefined;
  if (wantFleet && !targetFleet) return h.reject('E_NO_TARGET');
  // Флот, которого игрок не видит, — тот же `E_NO_TARGET`, что и отсутствующий: иначе
  // `E_INVALID_TARGET`, `E_NOT_HOSTILE` или отказ по дальности подтверждали бы перебором
  // id флот за туманом (A06). Правило видимости одно с проекцией (`isVisibleTo`): чужую
  // мину видно только своим флотом вблизи (SM-3.6, ревью #1411), ракету (SM-3.7b) — только
  // глазами; бить её челноками — правило владельца 2026-10-06.
  if (targetFleet && !isVisibleTo(h.state, playerId, { fleetId: targetFleet.id }, h.ctx.data)) {
    return h.reject('E_NO_TARGET');
  }
  if (wantPlanet && !targetPlanet) return h.reject('E_NO_PLANET');
  const targetOwner = targetFleet?.owner ?? targetPlanet?.owner ?? null;
  // ROS-1.5: по КОРАБЛЯМ безоружная машина не бьёт вовсе. Признак берётся из
  // данных (`attack`), а не из имени юнита и не из отдельного флага: «нечем бить»
  // и есть всё правило. Отказ — на приказе, потому что пустой полёт стоил бы
  // игроку топлива и часа ради заведомого ничего.
  // Ракета — воздушная цель (SM-3.7d): по ней бьёт `shuttleDamage`, а не `attack`.
  const airTarget = !!targetFleet && isMissileFleet(targetFleet, h.ctx.data);
  if (targetFleet && cappedUnitStat(squad.units, h.ctx.data, airTarget ? 'shuttleDamage' : 'attack') <= 0) {
    return h.reject('E_INVALID_TARGET');
  }
  // Свой мир бомбить нельзя — но ВЕЗТИ на него подкрепление можно и нужно (ROS-1.5):
  // десантный вылет это транспорт, а не удар, и запрет «по своим не бьют» к нему
  // не относится. Признак — ГРУЗ В ТРЮМЕ (SHU-4.2 грузит его заранее, до приказа).
  const cargo = (squad.cargo ?? []).filter((st) => st.count > 0);
  if (targetOwner === playerId && cargo.length === 0) return h.reject('E_NOT_HOSTILE');
  // На площадку крепости на развилке десант не садится: это не мир, уйти оттуда нельзя, а
  // при гибели крепости войска остались бы у ничейного узла (замечание Codex на #1410).
  if (targetPlanet && isForkSite(targetPlanet) && cargo.length > 0) return h.reject('E_NOT_CAPTURABLE');
  return {
    target: targetFleet ? { kind: 'fleet', id: targetFleet.id } : { kind: 'planet', id: targetPlanet!.id },
    ...(targetFleet ? { fleet: targetFleet } : {}),
    ...(targetPlanet ? { planet: targetPlanet } : {}),
    cargo,
  };
}

/** Где цель удара сейчас: флот — живая позиция (он ходит), мир — его точка. */
export function aimPosition(h: HandlerContext, aim: StrikeAim): { x: number; y: number } | null {
  return aim.fleet ? fleetPositionAt(h.state, aim.fleet, h.ctx.now) : (aim.planet?.position ?? null);
}

/**
 * ЧТО ПРОИСХОДИТ, КОГДА ЭСКАДРА ДОШЛА ДО ЦЕЛИ — удар, ответка, высадка, разворот.
 *
 * Вынесено из обработчика `shuttle.arrived` в SHU-4.4, потому что вызывающих стало ДВА.
 * Удар по МИРУ прилетает по расписанию (`shuttle.arrived` в назначенный срок), а
 * ПОГОНЯ момента прибытия не знает заранее — его находит пересчёт на `time.advanced`, и
 * зовёт резолюцию сразу, на месте. Назначить себе событие «в прошлом» погоня не может:
 * `advanceTo` начисляет последний отрезок времени и выходит из цикла, не перечитывая
 * очередь, — удар доехал бы до СЛЕДУЮЩЕГО пробуждения, то есть опоздал бы на неизвестно
 * сколько. Две копии этой резолюции разъехались бы на первой же правке правил урона.
 */
export function resolveOutLeg(h: HandlerContext, strike: ShuttleStrike): void {
      // Перелёт и посадка без базы (SHU-6.4) идут обратной ногой с первой секунды: цели,
      // до которой лететь, у них нет. Сюда их не приводит ни одно расписание — страховка.
      if (strike.target.kind === 'base') return turnHome(h, strike);
      // ПАТРУЛЬ дошёл до точки — он не бьёт по прилёте, а встаёт в круг (SHU-6.2).
      if (strike.target.kind === 'point') return startPatrol(h, strike);
      // Удар по миру, которому приказ сменили в воздухе (SHU-6.13), шёл от точки смены
      // (`at`); долетев, эскадра стоит над миром, и домой она повернёт оттуда.
      if (strike.target.kind === 'planet') delete strike.at;
      if (strike.target.kind === 'fleet') {
        const target = h.state.fleets[strike.target.id];
        // Цель ушла с точки удара — челноки бьют пустоту и возвращаются ни с чем.
        if (target && target.owner !== strike.owner) strikeFleet(h, strike, target, 1);
      } else {
        const target = h.state.planets[strike.target.id];
        if (target && target.owner !== strike.owner) {
          const power = strikePower(strike, h.ctx.data, 'planet');
          const hit = { phase: 'shuttle', location: target.id, attacker: strike.owner,
            defender: target.owner ?? '', ...strikeAttackerFleet(strike) };
          const shelling = hookedDamage(h, power, hit);
          const factor = mitigationFactor(h, hit);
          if (power > 0) {
            const dealt = shelling;
            h.emit('shuttle.hit', {
              strikeId: strike.id,
              owner: strike.owner,
              targetId: target.id,
              targetOwner: target.owner,
              playerId: target.owner,
              planetId: target.id,
              damage: dealt,
            });

          }
          // ROS-1.6: удар задевает и войска мира — сильнее обстрела с орбиты, но без
          // последнего бойца (`util/groundFire.ts`). Только у врага или ничейного мира:
          // по чужим, но не враждебным войскам огонь не идёт.
          const troops = strikeGroundPower(strike, target, h.ctx.data);
          if (troops.total > 0 && (target.owner === null || isHostile(h, strike.owner, target.owner))) {
            const toTroops = hookedDamage(h, troops.total, {
              phase: 'shuttle',
              location: target.id,
              attacker: strike.owner,
              defender: target.owner ?? '',
              ...strikeAttackerFleet(strike),
            });
            fireOnGarrison(h, target, toTroops, strike.owner, troops.weights);
          }
          if (power > 0) {
            const structuresApplied = wearStructures(h, target.id, shelling, target.owner, { hit, factor });
            h.emit('planet.bombarded', { planetId: target.id, power: shelling, owner: target.owner,
              hit, factor, structuresApplied });
          }
          repelStrike(h, strike, planetPointDefense(target, h.ctx.data), {
            kind: 'planet',
            id: target.id,
            owner: target.owner,
            location: target.id,
          });
        }
      }
      // Волна, которую ответка сбила целиком, домой не летит и в состоянии не остаётся.
      if (strike.units.length === 0) {
        h.state.strikes = (h.state.strikes ?? []).filter((st) => st.id !== strike.id);
        return;
      }
      // ДЕСАНТНЫЙ ВЫЛЕТ (ROS-1.5) одноразовый: груз сходит на землю, машины остаются
      // там же. Обратной ноги у него нет вовсе — это не удар с возвратом, а высадка.
      if (strike.cargo !== undefined) {
        const target = h.state.planets[strike.target.id];
        if (target) {
          trimCargoToSurvivors(strike);
          landCargo(h, strike, target);
        }
        h.state.strikes = (h.state.strikes ?? []).filter((st) => st.id !== strike.id);
        return;
      }
      turnHome(h, strike);
}

/** Куда перелетать — своя база с портом или трюмом, ровно одна из двух форм (SHU-6.4).
 *  Одна проверка на перелёт из ангара и из воздуха (SHU-6.13). Место и дальность считает
 *  вызывающий: точка, откуда лететь, у них разная. */
export function relocateDest(
  h: HandlerContext,
  playerId: string,
  p: { toPlanetId?: unknown; toFleetId?: unknown },
): StrikeBase {
  // Куда — ровно одна база из двух, как и откуда (fail-secure: схема этого не выражает).
  const toPlanet = typeof p.toPlanetId === 'string';
  const toFleet = typeof p.toFleetId === 'string';
  if (toPlanet === toFleet) return h.reject('E_BAD_PAYLOAD');
  if (toPlanet) {
    const planet = h.state.planets[p.toPlanetId as string];
    if (!planet) return h.reject('E_NO_PLANET');
    if (planet.owner !== playerId) return h.reject('E_FORBIDDEN');
    if (shuttleBayAt(planet, h.ctx.data) <= 0) return h.reject('E_NO_PORT');
    return { kind: 'planet', id: planet.id };
  }
  // Чужой и несуществующий корабль — один ответ: иначе перебором id читались бы скрытые
  // туманом флоты (A06), как и у всех приказов флота.
  const fleet = ownFleet(h.state, p.toFleetId as string);
  if (!fleet || fleet.owner !== playerId) return h.reject('E_NO_FLEET');
  if (fleetShuttleBay(fleet, h.ctx.data) <= 0) return h.reject('E_NO_PORT');
  return { kind: 'fleet', id: fleet.id };
}

// --- ЭСКАДРА В ВОЗДУХЕ (SHU-6.13) ---------------------------------------------------
//
// Владелец 2026-10-11: эскадра в воздухе — такой же космический юнит, как флот: её можно
// выделить, разделить и сменить ей приказ. Дефолты кирпича (сказаны владельцу в треде):
//
// 1. **Радиус — от БАЗЫ, тот же, что на вылете** (`squadronReach`): кольцо, которое игрок
//    видит у базы, обещает ровно то, куда эскадра долетит, и в воздухе тоже. Погоня меряет
//    поводок от базы по той же причине. Перелёт — от эскадры: он в одну сторону.
// 2. **Смена приказа не тратит второй вылет базы**: эскадра уже в воздухе, топливо базы
//    ушло на взлёт.
// 3. **Перенесённый патруль висит, сколько оставалось.** Висящий — остаток срока, ещё не
//    дошедший до точки — свой полный срок; круг тот же, что снят на вылете.
// 4. **Возвращается — значит, удар позади**: новой цели и «Домой» у обратной ноги нет
//    (`E_RETURNING`), бить снова без перезарядки нельзя. Сменить базу посадки можно.
// 5. **Новый путь — от точки, где эскадра сейчас** (`at`), как у погони: прямая от базы
//    провела бы её там, где её никогда не было, и ПВО стреляло бы по призраку.
// 6. **События прежнего приказа гаснут** (`orderSeq`, `flightOf`): прибытие к прежней цели
//    не ударит по новой раньше срока, а погоня не пойдёт двумя цепочками.

/** Приказ эскадре в воздухе адресует ВЫЛЕТ: поля базы и эскадры ангара рядом с ним — это
 *  две формы приказа сразу, и угадывать, какую имели в виду, ядро не должно. */
function aloftOnly(h: HandlerContext, p: Record<string, unknown>): void {
  if (p.planetId !== undefined || p.fleetId !== undefined || p.squadronId !== undefined) {
    h.reject('E_BAD_PAYLOAD');
  }
}

/** Новый путь «туда» из точки `from` (правило 5): нога `out` с расписанием от этой минуты. */
function flyOut(
  h: HandlerContext,
  strike: ShuttleStrike,
  from: { x: number; y: number },
  to: { x: number; y: number },
  flight: number,
): void {
  strike.to = { ...to };
  strike.at = { ...from };
  strike.leg = 'out';
  strike.departedAt = h.ctx.now;
  strike.arrivesAt = h.ctx.now + flight;
  scheduleLeg(h, strike);
}

/**
 * `shuttle.redirect { strikeId, targetFleetId | targetPlanetId | at }` — НОВАЯ ЦЕЛЬ или
 * НОВАЯ ТОЧКА ПАТРУЛЯ эскадре в воздухе. Проверки цели — те же, что у вылета из ангара
 * (`strikeAimOf`, `patrolCheck`), радиус — от базы (правило 1).
 */
export function redirectAloft(h: HandlerContext, playerId: string, p: Record<string, unknown>): void {
  aloftOnly(h, p);
  const strike = ownStrike(h, playerId, p.strikeId);
  if (strike.leg === 'back') return h.reject('E_RETURNING'); // правило 4
  const point = p.at !== undefined;
  if (point === (p.targetFleetId !== undefined || p.targetPlanetId !== undefined)) {
    return h.reject('E_BAD_PAYLOAD'); // ровно одна цель: точка, флот или мир
  }
  const here = strikePosition(strike, h.state, h.ctx.now);
  if (!here) return h.reject('E_NO_TARGET_POSITION');
  const home = homePosition(strike, h.state, h.ctx.now);
  if (point) {
    const at = p.at as { x?: unknown; y?: unknown } | null;
    const x = at?.x;
    const y = at?.y;
    const to =
      typeof x === 'number' && typeof y === 'number' && Number.isFinite(x) && Number.isFinite(y)
        ? { x, y }
        : null;
    const route = patrolCheck(h, home, strike, to);
    if (typeof route === 'string') return h.reject(route);
    const flight = flightTime(h, strike, here, route.to);
    // Правило 3: срок над кругом не начинается заново, круг — снятый на вылете.
    const was = strike.target.kind === 'point' ? strike.patrol : undefined;
    const hours = !was
      ? route.plan.hours
      : strike.leg === 'patrol'
        ? Math.max(0, strike.arrivesAt - h.ctx.now) / hourMs(h)
        : was.hours;
    reorder(strike);
    strike.target = { kind: 'point' };
    strike.patrol = {
      hours,
      radius: was?.radius ?? route.plan.radius,
      ...(was?.hold ? { hold: true as const } : {}),
    };
    return flyOut(h, strike, here, route.to, flight);
  }
  const aim = strikeAimOf(h, playerId, strike, p);
  if (!home) return h.reject('E_NO_PORT');
  const to = aimPosition(h, aim);
  if (!to) return h.reject('E_NO_TARGET_POSITION');
  const range = squadronReach(strike, h.ctx.data);
  if (range <= 0) return h.reject('E_NO_RANGE');
  if (distance(home, to) > range) return h.reject('E_OUT_OF_RANGE');
  const flight = flightTime(h, strike, here, to);
  reorder(strike);
  strike.target = aim.target;
  // Патруль, ушедший на удар, перестал быть патрулём — и удержание уходит с ним.
  delete strike.patrol;
  flyOut(h, strike, here, to, flight);
}

/**
 * `shuttle.relocate { strikeId, toPlanetId | toFleetId }` — сесть на ДРУГУЮ свою базу прямо
 * из воздуха: с пути к цели, из патруля и с обратной ноги (правило 4). Дальность — перелёт
 * от точки, где эскадра сейчас: лететь ей в одну сторону, и оттуда. Не примет новая база —
 * назад, туда, откуда эскадра ушла (`origin`), как у перелёта из ангара.
 */
export function relocateAloft(h: HandlerContext, playerId: string, p: Record<string, unknown>): void {
  aloftOnly(h, p);
  const strike = ownStrike(h, playerId, p.strikeId);
  const dest = relocateDest(h, playerId, p);
  // Туда она и так летит садиться — это не новый приказ.
  if (strike.leg === 'back' && dest.kind === strike.base.kind && dest.id === strike.base.id) {
    return h.reject('E_BAD_PAYLOAD');
  }
  const spot = landingSpot(h, playerId, dest, strike.id);
  if (!spot || spot.room < stacksSize(strike.units, h.ctx.data)) return h.reject('E_NO_CAPACITY');
  const here = strikePosition(strike, h.state, h.ctx.now);
  const to = basePosition(dest, h.state, h.ctx.now);
  if (!here || !to) return h.reject('E_NO_TARGET_POSITION');
  const range = squadronFerryRange(strike, h.ctx.data);
  if (range <= 0) return h.reject('E_NO_RANGE');
  if (distance(here, to) > range) return h.reject('E_OUT_OF_RANGE');
  reorder(strike);
  // Откуда ушла: перелёт помнит прежний дом, остальные — свою базу.
  strike.origin = strike.origin ?? { ...strike.base };
  strike.target = { kind: 'base' };
  delete strike.patrol;
  flyTo(h, strike, dest, here);
}

/**
 * `shuttle.split { strikeId, units }` — разделить эскадру в воздухе. Обе половины летят
 * дальше тем же приказом — та же цель, та же нога, тот же срок, — а дальше каждой можно
 * сменить его отдельно. Имя, урон и десант делятся тем же правилом, что в ангаре
 * (`divideSquadron`). Вылет базы не тратится: обе половины уже в воздухе.
 */
export function splitAloft(h: HandlerContext, playerId: string, p: Record<string, unknown>): void {
  aloftOnly(h, p);
  const strike = ownStrike(h, playerId, p.strikeId);
  const halves = divideSquadron(h, strike, p.units);
  const apply = (st: ShuttleStrike, half: Omit<Squadron, 'id'>): void => {
    st.units = half.units;
    // Половина без бойцов — уже не десант: долетев, она повернёт домой, а не сойдёт на
    // землю ни с чем (`resolveOutLeg` узнаёт десант по полю `cargo`).
    if (half.cargo) st.cargo = half.cargo;
    else delete st.cargo;
    if (half.damage) st.damage = half.damage;
    else delete st.damage;
  };
  const other: ShuttleStrike = deepClone(strike);
  other.id = nextStrikeId(h, playerId);
  other.squadronId = nextSquadronId(h, playerId);
  // У новой половины свои события (`scheduleLeg`), номер приказа — с нуля.
  delete other.orderSeq;
  apply(strike, halves.named);
  apply(other, halves.other);
  h.state.strikes = [...(h.state.strikes ?? []), other];
  scheduleLeg(h, other);
  h.emit('squadron.split', {
    owner: playerId,
    squadronId: strike.squadronId,
    newId: other.squadronId,
    strikeId: strike.id,
    newStrikeId: other.id,
  });
}

/**
 * `shuttle.merge { planetId | fleetId, squadronId, intoId }` — свести две эскадры
 * ОДНОЙ базы в одну (SHU-4.2). Трюмы складываются и переполнить приёмник не могут:
 * вместимость складывается вместе с бортами, а каждая половина уже влезала в свою.
 */
export function mergeSquadrons(action: { playerId: string; payload: unknown }, h: HandlerContext): void {
  const p = (action.payload ?? {}) as { squadronId?: unknown; intoId?: unknown };
  const base = baseFromPayload(h, action.playerId, p as Record<string, unknown>);
  if (p.squadronId === p.intoId) return h.reject('E_BAD_PAYLOAD');
  const from = requireSquadron(h, base, p.squadronId);
  const into = requireSquadron(h, base, p.intoId);
  // Ракеты с челноками в одну эскадру не сводятся: такую эскадру нельзя было бы ни поднять,
  // ни пустить (решение владельца 2026-11-09).
  if (hasMissiles(from, h.ctx.data) !== hasMissiles(into, h.ctx.data)) return h.reject('E_MISSILE_SQUADRON');

  const units = into.units.map((st) => ({ ...st }));
  for (const st of from.units) addUnits(units, st.unit, st.count, st.modules, st.moduleStars, st.moduleRarity);
  const cargo = (into.cargo ?? []).map((st) => ({ ...st }));
  for (const st of from.cargo ?? []) addUnits(cargo, st.unit, st.count);
  const damage = (into.damage ?? 0) + (from.damage ?? 0);
  const merged: Squadron = {
    id: into.id,
    units,
    ...(cargo.length > 0 ? { cargo } : {}),
    ...(damage > 0 ? { damage } : {}),
  };
  base.setHangar(base.hangar.flatMap((q) => (q.id === from.id ? [] : q.id === into.id ? [merged] : [q])));
  h.emit('squadron.merged', {
    baseId: base.ref.id,
    baseKind: base.ref.kind,
    owner: action.playerId,
    squadronId: into.id,
    absorbed: from.id,
  });
}
