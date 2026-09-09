/**
 * ЧЕЛНОКИ (shuttles-roadmap, заказ владельца 2026-09-08) — второй класс космических
 * юнитов, устроенный не как корабли.
 *
 * Корабль ходит по линиям между узлами и при столкновении дерётся обычным боем. Челнок
 * не ходит вовсе: он стоит В КОСМОПОРТЕ (`planet.hangar`, SHU-1.1), на карте его нет, а
 * бьёт он НАПРЯМУЮ от своего узла до цели, мимо графа линий, — и сразу возвращается в
 * тот же порт (SHU-1.2).
 *
 * Три вещи, которые из этого следуют и которые легко потерять при правке:
 *
 * 1. **Удар односторонний.** Цель получает урон, но боя не начинается: ни `battleId`, ни
 *    ответного огня. Та же семантика, что у артиллерийского standoff (`artillery.ts`) —
 *    контрмера не «отстреляться в ответ», а сбить челноки на подлёте (зональное ПВО и
 *    перехват, SHU-1.3).
 * 2. **Полёт живёт в состоянии** (`state.strikes`), а не считается мгновенно. Мгновенный
 *    удар не оставил бы против себя никакой защиты и обнулил бы зональное ПВО.
 * 3. **Порт — и дом, и условие.** Вылет невозможен без живого порта (повреждён больше
 *    чем на 30% — не выпускает), возврат идёт в него же, а не стало порта — челноки
 *    гибнут вместе с ним. Топливо и перезарядка тоже принадлежат порту.
 *
 * Здесь же живёт ЗОНАЛЬНОЕ ПВО (`pointDefense`) — контрмера челнокам вместе с
 * перехватом (SHU-1.3). Не путать с ПКО (`aaDamage`): та бьёт по КОРАБЛЯМ на орбите.
 */
import type { GameModule, HandlerContext } from '../kernel/module';
import type {
  Fleet,
  GameState,
  Planet,
  ShuttleStrike,
  StrikeBase,
  UnitStack,
} from '../state/gameState';
import type { GameData } from '../data/schemas';
import { distance } from '../state/route';
import {
  canSortie,
  fleetShuttleBay,
  hangarUsed,
  freshSortie,
  shuttleBayAt,
  spendSortie,
  tickRearm,
  trimHangar,
} from '../state/shuttle';
import { applyDamageToSide, removeIfWiped } from '../util/combat';
import { requireOwnedIdleFleet } from '../util/fleet';
import { addUnits, cappedUnitStat, sumUnitStat } from '../util/stacks';
import { buildingLevel } from '../data/schemas';
import { timeScaleOf } from '../action/types';
import { MS_PER_HOUR } from '../util/time';

/** Total point-defense (anti-shuttle/anti-missile) firepower of a fleet —
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

/** Позиция базы вылета — мира или носителя. Носитель ДВИЖЕТСЯ, поэтому позиция
 *  всегда берётся текущая, а не запомненная при вылете: запомненная разъехалась бы
 *  с носителем ровно так же, как хранимая позиция флота разъезжается с расписанием. */
function basePosition(base: StrikeBase, state: GameState): { x: number; y: number } | null {
  if (base.kind === 'planet') {
    return state.planets[base.id]?.position ?? null;
  }
  const fleet = state.fleets[base.id];
  return fleet ? fleetWorldPos(fleet, state) : null;
}

/**
 * ОДНА форма для двух баз (SHU-2.1). Космопорт и носитель делают одно и то же —
 * вмещают челноки, держат топливо и принимают их обратно, — поэтому все проверки
 * вылета читают эту проекцию, а не «если мир … иначе если флот …» в каждой ветке.
 * Вторая копия правил на второй базе разъехалась бы с первой на первой же правке.
 */
interface BaseView {
  ref: StrikeBase;
  owner: string | null;
  position: { x: number; y: number } | null;
  /** Вместимость. 0 читается как «базы нет»: порт, вмещающий ноль, ничем не отличается
   *  от отсутствующего (SHU-1.1), и у носителя ровно так же. */
  bay: number;
  /** Не выпускает из-за повреждений. Есть только у порта: у носителя вместимость
   *  падает вместе с погибшими корпусами, отдельного порога не нужно. */
  disabled: boolean;
  hangar: UnitStack[];
  setHangar: (next: UnitStack[]) => void;
  sortie: { fuel: number; rearming: number } | undefined;
  setSortie: (next: { fuel: number; rearming: number }) => void;
}

function planetBase(planet: Planet, data: GameData): BaseView {
  return {
    ref: { kind: 'planet', id: planet.id },
    owner: planet.owner,
    position: planet.position,
    bay: shuttleBayAt(planet, data),
    disabled: portDisabled(planet, data),
    hangar: planet.hangar ?? [],
    setHangar: (next) => {
      planet.hangar = next;
    },
    sortie: planet.sortie,
    setSortie: (next) => {
      planet.sortie = next;
    },
  };
}

function fleetBase(fleet: Fleet, state: GameState, data: GameData): BaseView {
  return {
    ref: { kind: 'fleet', id: fleet.id },
    owner: fleet.owner,
    position: fleetWorldPos(fleet, state),
    bay: fleetShuttleBay(fleet, data),
    disabled: false,
    hangar: fleet.hangar ?? [],
    setHangar: (next) => {
      fleet.hangar = next;
    },
    sortie: fleet.sortie,
    setSortie: (next) => {
      fleet.sortie = next;
    },
  };
}

/** База по ссылке — или `null`, если её больше нет (снесённый порт, погибший носитель). */
function baseOf(ref: StrikeBase, state: GameState, data: GameData): BaseView | null {
  if (ref.kind === 'planet') {
    const planet = state.planets[ref.id];
    return planet ? planetBase(planet, data) : null;
  }
  const fleet = state.fleets[ref.id];
  return fleet ? fleetBase(fleet, state, data) : null;
}

/** Топливо и перезарядка базы берутся у ЧЕЛНОКОВ, которые в ней стоят (первый стек):
 *  счётчик принадлежит базе, а числа — машине. */
function baseSortieSpec(base: BaseView, data: GameData): { maxFuel: number; rearmRounds: number } {
  const st = base.hangar.find((s) => s.count > 0);
  const stats = st ? data.units[st.unit]?.stats : undefined;
  return {
    maxFuel: Math.max(0, Math.floor(stats?.fuel ?? 0)),
    rearmRounds: Math.max(0, Math.floor(stats?.rearmRounds ?? 0)),
  };
}

/** Где сейчас летящий удар: линейная интерполяция между портом и точкой удара по доле
 *  пройденного времени. Позиции у челнока нет в состоянии намеренно — она ВЫВОДИТСЯ,
 *  как позиция флота на лейне: хранимая копия разъехалась бы с расписанием. */
function strikePosition(
  strike: ShuttleStrike,
  state: GameState,
  now: number,
): { x: number; y: number } | null {
  const home = basePosition(strike.base, state);
  if (!home) return null;
  const [a, b] = strike.leg === 'out' ? [home, strike.to] : [strike.to, home];
  const span = strike.arrivesAt - strike.departedAt;
  const t = span <= 0 ? 1 : Math.min(1, Math.max(0, (now - strike.departedAt) / span));
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

/** Убрать `amount` машин из вылета (сбитые зональным ПВО или перехватом), с хвоста. Пустой вылет исчезает. */
function shootDownStrike(strike: ShuttleStrike, amount: number): number {
  let left = Math.floor(amount);
  let downed = 0;
  for (let i = strike.units.length - 1; i >= 0 && left > 0; i--) {
    const st = strike.units[i]!;
    const hit = Math.min(st.count, left);
    st.count -= hit;
    left -= hit;
    downed += hit;
  }
  strike.units = strike.units.filter((st) => st.count > 0);
  return downed;
}

/** Насколько далеко база поднимает перехватчики — самый дальнобойный охотник в
 *  ангаре. Тот же `strikeRange`, которым он летит бить: машина не может встречать
 *  дальше, чем достаёт сама. */
function interceptReach(hangar: readonly UnitStack[], data: GameData): number {
  let reach = 0;
  for (const st of hangar) {
    if (st.count <= 0) continue;
    const stats = data.units[st.unit]?.stats;
    if (!stats || (stats.shuttleDamage ?? 0) <= 0) continue;
    reach = Math.max(reach, stats.strikeRange ?? 0);
  }
  return reach;
}

/** Ближайший ЧУЖОЙ вылет в радиусе базы, детерминированно: ближе — раньше, при равной
 *  дистанции побеждает меньший id. Одна цель за час на базу: дежурное звено взлетает
 *  один раз и садится, а не размазывает залп по всем небесам сразу. */
function nearestHostileStrike(
  strikes: readonly ShuttleStrike[],
  base: BaseView,
  reach: number,
  h: HandlerContext,
): ShuttleStrike | null {
  const from = base.position;
  if (!from) return null;
  let best: ShuttleStrike | null = null;
  let bestDist = Infinity;
  for (const st of strikes) {
    if (st.owner === base.owner || st.units.length === 0) continue;
    const p = strikePosition(st, h.state, h.ctx.now);
    if (!p) continue;
    const d = distance(from, p);
    if (d > reach) continue;
    if (d < bestDist || (d === bestDist && best !== null && st.id < best.id)) {
      best = st;
      bestDist = d;
    }
  }
  return best;
}

/** Один игровой час в миллисекундах мира — с учётом ускорения времени матча. */
function hourMs(h: HandlerContext): number {
  return MS_PER_HOUR * timeScaleOf(h.ctx);
}

/** Доля, ниже которой порт перестаёт выпускать челноки: повреждён БОЛЕЕ чем на 30%
 *  (резолюция владельца 2026-09-08). Порог на вылет, не на возврат. */
const PORT_LAUNCH_HP = 0.7;

/** Не выпускает ли порт челноки из-за повреждений. Считается по САМОМУ ЦЕЛОМУ порту
 *  мира: два порта — вылет идёт из уцелевшего, а не блокируется разрушенным. */
function portDisabled(planet: Planet, data: GameData): boolean {
  let best = 0;
  for (const b of planet.buildings) {
    const def = data.buildings[b.type];
    if (!def) continue;
    const level = buildingLevel(def, b.level);
    if (level.shuttleBay <= 0 || level.hp <= 0) continue;
    best = Math.max(best, b.hp / level.hp);
  }
  return best < PORT_LAUNCH_HP;
}

/** Снять `count` челноков `unit` из ангара. */
function takeFromHangar(hangar: readonly UnitStack[], unit: string, count: number): UnitStack[] {
  let left = count;
  const out: UnitStack[] = [];
  for (const st of hangar) {
    if (st.unit !== unit || left <= 0) {
      out.push({ ...st });
      continue;
    }
    const take = Math.min(st.count, left);
    left -= take;
    if (st.count - take > 0) out.push({ ...st, count: st.count - take });
  }
  return out;
}

/** Сила вылета против ЦЕЛИ ЭТОГО РОДА, ограниченная линией боя, ровно как у
 *  артиллерии: количество бьёт, но не бесконечно.
 *
 *  Профилей два (ROS-1.4): по КОРАБЛЯМ челнок бьёт `attack`, по ЗДАНИЯМ — своим
 *  `siegeDamage` (тот же стат, которым осадная платформа крушит мир, ROS-1.3).
 *  Одной цифрой роли челноков не различались вовсе: машина, хорошая против флота,
 *  была ровно настолько же хороша против построек, и «бомбардировщик против
 *  кораблей, перехватчик против челноков» оставалось словами в дизайне.
 *
 *  Нет `siegeDamage` → по зданиям считается `attack`, как до разделения: мягкая
 *  деградация, чужой и старый контент ведёт себя как вёл. */
function strikePower(
  strike: ShuttleStrike,
  data: GameData,
  target: ShuttleStrike['target']['kind'],
): number {
  if (target === 'fleet') {
    return cappedUnitStat(strike.units, data, 'attack');
  }
  return cappedUnitStat(strike.units, data, (stats) => {
    const siege = stats.siegeDamage ?? 0;
    return siege > 0 ? siege : (stats.attack ?? 0);
  });
}

/** Скорость вылета — самая медленная машина в нём. */
function strikeSpeed(strike: ShuttleStrike, data: GameData): number {
  let slowest = Infinity;
  for (const st of strike.units) {
    if (st.count <= 0) continue;
    slowest = Math.min(slowest, data.units[st.unit]?.stats.speed ?? 0);
  }
  return Number.isFinite(slowest) ? slowest : 0;
}

export const shuttleModule: GameModule = {
  id: 'shuttle',
  version: '1.0.0',
  setup(api) {
    /**
     * `shuttle.strike { planetId | fleetId, unit, count, targetFleetId | targetPlanetId }`
     * — вылет с базы. Челноки покидают ангар, летят по прямой к точке, снятой в момент
     * вылета, и после удара разворачиваются домой.
     *
     * База — мир с космопортом ИЛИ флот-носитель (SHU-2.1). Ровно одна из двух: обе
     * или ни одной — отказ (fail-secure; схема payload этого не выражает).
     *
     * Цель фиксируется КООРДИНАТОЙ, а не ссылкой: «навёлся и пустил». Цель может уйти —
     * челноки всё равно летят туда, куда их послали, и по прибытии бьют того, кто там
     * оказался. Иначе удар был бы самонаводящимся, а уклонение — невозможным.
     */
    api.onAction('shuttle.strike', (action, h: HandlerContext) => {
      const p = action.payload as {
        planetId?: string;
        fleetId?: string;
        unit?: string;
        count?: number;
        targetFleetId?: string;
        targetPlanetId?: string;
      };
      if (typeof p?.unit !== 'string') {
        return h.reject('E_BAD_PAYLOAD');
      }
      const fromPlanet = typeof p.planetId === 'string';
      const fromFleet = typeof p.fleetId === 'string';
      if (fromPlanet === fromFleet) {
        return h.reject('E_BAD_PAYLOAD'); // ровно одна база
      }
      const count = p.count ?? 1;
      if (!Number.isSafeInteger(count) || count <= 0) return h.reject('E_BAD_PAYLOAD');

      let base: BaseView;
      if (fromPlanet) {
        const planet = h.state.planets[p.planetId!];
        if (!planet) return h.reject('E_NO_PLANET');
        if (planet.owner !== action.playerId) return h.reject('E_FORBIDDEN');
        base = planetBase(planet, h.ctx.data);
      } else {
        // Носитель обязан СТОЯТЬ у узла и быть свободен (`E_FLEET_BUSY` — бой, перелёт
        // или стоянка на лейне): порт не двигается, и вылет с разгоняющегося носителя
        // пришлось бы догонять — вторая ветка правил в самом горячем месте ядра.
        // Возврату это не мешает: носитель волен уйти, пока челноки летят.
        const fleet = requireOwnedIdleFleet(h, p.fleetId!, action.playerId);
        base = fleetBase(fleet, h.state, h.ctx.data);
      }

      // База: есть, цела и с топливом. Порог повреждения — на ВЫЛЕТ (правило владельца);
      // возврату он не мешает, иначе челнок повис бы в пустоте. У носителя порога нет:
      // подбитый носитель теряет корпуса, вместимость падает сама.
      if (base.bay <= 0) return h.reject('E_NO_PORT');
      if (base.disabled) return h.reject('E_PORT_DAMAGED');

      const have = base.hangar
        .filter((st) => st.unit === p.unit)
        .reduce((n, st) => n + st.count, 0);
      if (have < count) return h.reject('E_NOT_ENOUGH');

      const spec = baseSortieSpec(base, h.ctx.data);
      const sortie = base.sortie ?? freshSortie(spec.maxFuel);
      if (!canSortie(sortie)) return h.reject('E_NO_FUEL');

      // Цель: чужой флот или чужой мир. Ровно одна из двух — payload-схема этого не
      // выражает, поэтому проверяем здесь (fail-secure: обе или ни одной → отказ).
      const wantFleet = typeof p.targetFleetId === 'string';
      const wantPlanet = typeof p.targetPlanetId === 'string';
      if (wantFleet === wantPlanet) return h.reject('E_BAD_PAYLOAD');
      const targetFleet = wantFleet ? h.state.fleets[p.targetFleetId!] : undefined;
      const targetPlanet = wantPlanet ? h.state.planets[p.targetPlanetId!] : undefined;
      if (wantFleet && !targetFleet) return h.reject('E_NO_TARGET');
      if (wantPlanet && !targetPlanet) return h.reject('E_NO_PLANET');
      const targetOwner = targetFleet?.owner ?? targetPlanet?.owner ?? null;
      if (targetOwner === action.playerId) return h.reject('E_NOT_HOSTILE');

      const from = base.position;
      if (!from) return h.reject('E_NO_PORT'); // носитель без позиции (в перелёте) — не база
      const to = targetFleet
        ? (fleetWorldPos(targetFleet, h.state) ?? null)
        : (targetPlanet?.position ?? null);
      if (!to) return h.reject('E_NO_TARGET_POSITION');

      // Радиус считается ОТ УЗЛА БАЗИРОВАНИЯ: своей позиции у челнока в ангаре нет.
      const range = h.ctx.data.units[p.unit]?.stats.strikeRange ?? 0;
      if (range <= 0) return h.reject('E_NO_RANGE');
      if (distance(from, to) > range) return h.reject('E_OUT_OF_RANGE');

      const speed = h.ctx.data.units[p.unit]?.stats.speed ?? 0;
      if (speed <= 0) return h.reject('E_NO_SPEED');
      const flightMs = Math.max(1, Math.round((distance(from, to) / speed) * hourMs(h)));

      // Челноки покидают ангар — с этой секунды их в базе нет.
      base.setHangar(takeFromHangar(base.hangar, p.unit, count));
      base.setSortie(spendSortie(sortie, spec.rearmRounds));
      const seq = (h.state.strikeSeq ?? 0) + 1;
      h.state.strikeSeq = seq;
      const strike: ShuttleStrike = {
        id: `strike:${action.playerId}:${h.ctx.now}:${seq}`,
        owner: action.playerId,
        base: base.ref,
        units: [{ unit: p.unit, count }],
        target: targetFleet
          ? { kind: 'fleet', id: targetFleet.id }
          : { kind: 'planet', id: targetPlanet!.id },
        to,
        departedAt: h.ctx.now,
        arrivesAt: h.ctx.now + flightMs,
        leg: 'out',
      };
      h.state.strikes = [...(h.state.strikes ?? []), strike];
      h.schedule(strike.arrivesAt, 'shuttle.arrived', { strikeId: strike.id });
      h.emit('shuttle.launched', {
        strikeId: strike.id,
        owner: action.playerId,
        from: base.ref.id,
        fromKind: base.ref.kind,
        count,
      });
    });

    /**
     * `shuttle.load` / `shuttle.unload { fleetId, unit, count }` — перегрузка челноков
     * между космопортом мира и СТОЯЩИМ ТАМ ЖЕ носителем (SHU-2.1). Ровно тот же шов,
     * что у наземной армии (`army.load`/`army.unload`): челнок строится в порту, но
     * воевать вдали от своих миров может только с борта.
     *
     * Обе стороны — СВОИ. Порт союзника не донор и не гараж: «помощь» иначе означала бы
     * вывоз чужой обороны, ровно как у `army.load`.
     */
    const transfer = (
      action: { playerId: string; payload: unknown },
      h: HandlerContext,
    ): { fleet: Fleet; planet: Planet; unit: string; count: number } => {
      const p = action.payload as { fleetId?: string; unit?: string; count?: number };
      if (typeof p?.fleetId !== 'string' || typeof p?.unit !== 'string') {
        return h.reject('E_BAD_PAYLOAD');
      }
      const count = p.count ?? 1;
      if (!Number.isSafeInteger(count) || count <= 0) return h.reject('E_BAD_PAYLOAD');
      const def = h.ctx.data.units[p.unit];
      if (!def) return h.reject('E_UNKNOWN_UNIT');
      if (!def.traits.includes('shuttle')) return h.reject('E_NOT_SHUTTLE');
      const fleet = requireOwnedIdleFleet(h, p.fleetId, action.playerId);
      const planet = fleet.location ? h.state.planets[fleet.location] : undefined;
      if (!planet) return h.reject('E_NO_PLANET');
      if (planet.owner !== action.playerId) return h.reject('E_FORBIDDEN');
      return { fleet, planet, unit: p.unit, count };
    };

    api.onAction('shuttle.load', (action, h: HandlerContext) => {
      const { fleet, planet, unit, count } = transfer(action, h);
      const have = (planet.hangar ?? [])
        .filter((st) => st.unit === unit)
        .reduce((n, st) => n + st.count, 0);
      if (have < count) return h.reject('E_NOT_ENOUGH');
      const free = fleetShuttleBay(fleet, h.ctx.data) - hangarUsed(fleet);
      if (count > free) return h.reject('E_NO_CAPACITY');
      planet.hangar = takeFromHangar(planet.hangar ?? [], unit, count);
      const aboard = [...(fleet.hangar ?? [])];
      addUnits(aboard, unit, count);
      fleet.hangar = aboard;
      h.emit('shuttle.loaded', {
        fleetId: fleet.id,
        planetId: planet.id,
        unit,
        count,
        owner: action.playerId,
      });
    });

    api.onAction('shuttle.unload', (action, h: HandlerContext) => {
      const { fleet, planet, unit, count } = transfer(action, h);
      const have = (fleet.hangar ?? [])
        .filter((st) => st.unit === unit)
        .reduce((n, st) => n + st.count, 0);
      if (have < count) return h.reject('E_NOT_ENOUGH');
      const free = shuttleBayAt(planet, h.ctx.data) - hangarUsed(planet);
      if (count > free) return h.reject('E_NO_CAPACITY');
      fleet.hangar = takeFromHangar(fleet.hangar ?? [], unit, count);
      const ashore = [...(planet.hangar ?? [])];
      addUnits(ashore, unit, count);
      planet.hangar = ashore;
      h.emit('shuttle.unloaded', {
        fleetId: fleet.id,
        planetId: planet.id,
        unit,
        count,
        owner: action.playerId,
      });
    });

    /**
     * Прибытие. Нога `out` — удар и разворот, нога `back` — посадка в свой порт.
     *
     * Удар наносится ОДНОСТОРОННЕ: флоту — через тот же хук `combat.damage`, что и
     * любой другой канал огня (CORE-DMG-1, `phase: 'shuttle'`), миру — событием
     * `planet.bombarded`, которое модуль построек уже умеет превращать в урон зданиям.
     * Ни бой, ни ответный огонь не начинаются.
     */
    api.on('shuttle.arrived', (event, h: HandlerContext) => {
      const { strikeId } = event.payload as { strikeId?: string };
      if (typeof strikeId !== 'string') return;
      const strikes = h.state.strikes ?? [];
      const strike = strikes.find((s) => s.id === strikeId);
      if (!strike) return; // сбит по дороге / удалён — dead letter, таймлайн не застревает

      if (strike.leg === 'out') {
        const power = strikePower(strike, h.ctx.data, strike.target.kind);
        if (power > 0) {
          if (strike.target.kind === 'fleet') {
            const target = h.state.fleets[strike.target.id];
            // Цель ушла с точки удара — челноки бьют пустоту и возвращаются ни с чем.
            if (target && target.owner !== strike.owner) {
              const dealt = h.hook<number>('combat.damage', power, {
                phase: 'shuttle',
                location: target.location ?? '',
                attacker: strike.owner,
                defender: target.owner,
              });
              h.emit('shuttle.hit', {
                strikeId,
                owner: strike.owner,
                targetId: target.id,
                targetOwner: target.owner,
                damage: dealt,
              });
              applyDamageToSide(h, { kind: 'fleet', fleetId: target.id }, dealt, h.ctx.data, '');
              removeIfWiped(h, target.id);
            }
          } else {
            const target = h.state.planets[strike.target.id];
            if (target && target.owner !== strike.owner) {
              const dealt = h.hook<number>('combat.damage', power, {
                phase: 'shuttle',
                location: target.id,
                attacker: strike.owner,
                defender: target.owner ?? '',
              });
              h.emit('shuttle.hit', {
                strikeId,
                owner: strike.owner,
                targetId: target.id,
                targetOwner: target.owner,
                damage: dealt,
              });
              h.emit('planet.bombarded', {
                planetId: target.id,
                power: dealt,
                owner: target.owner,
              });
            }
          }
        }
        // Разворот домой — тем же путём и с той же скоростью. Позиция базы берётся
        // ТЕКУЩАЯ: носитель мог сдвинуться, пока челноки летели, и лететь они должны
        // к нему, а не к точке, где он стоял на вылете.
        const home = basePosition(strike.base, h.state);
        const back = home ? distance(strike.to, home) : 0;
        const speed = strikeSpeed(strike, h.ctx.data);
        const flightMs = speed > 0 ? Math.max(1, Math.round((back / speed) * hourMs(h))) : 1;
        strike.leg = 'back';
        strike.departedAt = h.ctx.now;
        strike.arrivesAt = h.ctx.now + flightMs;
        h.schedule(strike.arrivesAt, 'shuttle.arrived', { strikeId });
        return;
      }

      // Посадка. База могла погибнуть, пока челноки летели (снесённый порт, сбитый
      // носитель, захваченный мир), — тогда садиться некуда.
      h.state.strikes = strikes.filter((s) => s.id !== strikeId);
      const base = baseOf(strike.base, h.state, h.ctx.data);
      const bay = base && base.owner === strike.owner ? base.bay : 0;
      if (!base || bay <= 0) {
        h.emit('shuttle.lost', {
          baseId: strike.base.id,
          baseKind: strike.base.kind,
          owner: strike.owner,
          count: strike.units.reduce((n, st) => n + st.count, 0),
        });
        return;
      }
      const hangar = [...base.hangar];
      for (const st of strike.units) addUnits(hangar, st.unit, st.count, st.modules);
      base.setHangar(trimHangar(hangar, bay));
      h.emit('shuttle.landed', {
        baseId: base.ref.id,
        baseKind: base.ref.kind,
        owner: strike.owner,
        strikeId,
      });
    });

    /**
     * АНГАР НЕ ПЕРЕЖИВАЕТ СВОЮ БАЗУ (SHU-1.1, распространено на носители в SHU-2.1).
     * Челнок стоит ВНУТРИ космопорта или носителя, поэтому снесённый порт и сбитые
     * корпуса носителя забирают его с собой, а упавшая вместимость оставляет ровно
     * столько, сколько теперь помещается.
     *
     * Правило висит на `time.advanced`, а не на событии «здание разрушено», намеренно:
     * база исчезает НЕСКОЛЬКИМИ путями — бомбардировка, наземный штурм, гибель корпусов
     * в бою, — а вместимость может упасть и от смены уровня. Реакция на одно событие
     * закрыла бы один путь и оставила остальные, и в состоянии остались бы челноки,
     * которым негде стоять. Здесь же ловится захват: мир сменил владельца — ангар
     * прежнего хозяина пуст (`planet.captured` ниже снимает его сразу, это лишь
     * страховка того же правила).
     *
     * Флот, погибший ЦЕЛИКОМ, отдельного правила не требует: ангар лежит НА флоте, и
     * удаление флота уносит его с собой — осиротеть здесь нечему. Вылет, чья база
     * исчезла за время полёта, ловится на посадке (`shuttle.lost` там же).
     */
    api.on('time.advanced', (_event, h: HandlerContext) => {
      const bases: BaseView[] = [
        ...Object.values(h.state.planets).map((planet) => ({
          ...planetBase(planet, h.ctx.data),
          // Ничей мир не держит ангар: вместимость нейтрального мира читается как 0.
          bay: planet.owner === null ? 0 : shuttleBayAt(planet, h.ctx.data),
        })),
        ...Object.values(h.state.fleets).map((fleet) => fleetBase(fleet, h.state, h.ctx.data)),
      ];
      for (const base of bases) {
        if (base.hangar.length === 0) continue;
        const kept = trimHangar(base.hangar, base.bay);
        const lost =
          base.hangar.reduce((n, st) => n + st.count, 0) - kept.reduce((n, st) => n + st.count, 0);
        if (lost <= 0) continue;
        base.setHangar(kept);
        h.emit('shuttle.lost', {
          baseId: base.ref.id,
          baseKind: base.ref.kind,
          owner: base.owner,
          count: lost,
        });
      }
    });

    /** Мир захвачен — челноки прежнего владельца гибнут вместе с портом, а не достаются
     *  захватчику (резолюция владельца 2026-09-08). Сразу, не дожидаясь тика: между
     *  захватом и следующим `time.advanced` ангар иначе числился бы за новым хозяином. */
    api.on('planet.captured', (event, h: HandlerContext) => {
      const { planetId } = event.payload as { planetId?: string };
      if (typeof planetId !== 'string') return;
      const planet = h.state.planets[planetId];
      const lost = (planet?.hangar ?? []).reduce((n, st) => n + st.count, 0);
      if (!planet || lost <= 0) return;
      planet.hangar = [];
      h.emit('shuttle.lost', {
        baseId: planetId,
        baseKind: 'planet',
        owner: planet.owner,
        count: lost,
      });
    });

    /**
     * ТОЧЕЧНАЯ ОБОРОНА — единственная контрмера челнокам (SHU-1.2; полный перехват с
     * подъёмом своих перехватчиков — SHU-1.3). Реактивно, на `time.advanced`: флот с
     * `pointDefense` вне боя и вне перезарядки бьёт по ЧУЖИМ ВЫЛЕТАМ, проходящим в его
     * радиусе, и сбивает их машины. Один залп делится поровну между всеми целями в
     * радиусе, затем 20 игровых минут перезарядки.
     *
     * Раньше здесь целями были «флоты-крылья» — сущность, которой в новой модели нет.
     * Цель сменилась вместе с моделью, механика (радиус, кулдаун, деление залпа) — та же.
     */
    api.on('time.advanced', (_event, h: HandlerContext) => {
      const strikes = h.state.strikes ?? [];
      if (strikes.length === 0) return;
      const data = h.ctx.data;
      const cooldownMs = (PD_COOLDOWN_MINUTES / 60) * hourMs(h);

      for (const fleet of Object.values(h.state.fleets)) {
        const pd = fleetPointDefense(fleet, data);
        if (pd <= 0) continue;
        if (fleet.battleId) continue; // в бою зональное ПВО — часть боя
        if (h.ctx.now < (fleet.pdCooldownUntil ?? 0)) continue;
        const myPos = fleetWorldPos(fleet, h.state);
        if (!myPos) continue;
        const range = fleetPDRange(fleet, data);

        const targets = strikes.filter((st) => {
          if (st.owner === fleet.owner || st.units.length === 0) return false;
          const p = strikePosition(st, h.state, h.ctx.now);
          return !!p && distance(myPos, p) <= range;
        });
        if (targets.length === 0) continue;

        const perTarget = pd / targets.length;
        for (const target of targets) {
          const dealt = h.hook<number>('combat.damage', perTarget, {
            phase: 'pointDefense',
            location: fleet.location ?? '',
            attacker: fleet.owner,
            defender: target.owner,
          });
          // Урон переводится в СБИТЫЕ МАШИНЫ по корпусу челнока: у вылета нет своего
          // пула здоровья — он и не должен его иметь, иначе половина сбитого крыла
          // жила бы «раненой» в состоянии, которого игрок не видит.
          const hull = Math.max(1, data.units[target.units[0]!.unit]?.stats.hp ?? 1);
          target.damage = (target.damage ?? 0) + dealt;
          const downed = shootDownStrike(target, Math.floor(target.damage / hull));
          target.damage -= downed * hull;
          h.emit('pd.fired', {
            fleetId: fleet.id,
            owner: fleet.owner,
            strikeId: target.id,
            targetOwner: target.owner,
            damage: dealt,
            downed,
          });
        }
        fleet.pdCooldownUntil = h.ctx.now + cooldownMs;
      }
      // Вылет, у которого не осталось машин, до цели не долетит.
      h.state.strikes = strikes.filter((st) => st.units.length > 0);
    });

    /**
     * ПЕРЕХВАТ (SHU-1.3) — вторая контрмера челнокам и единственная АКТИВНАЯ: своя
     * база поднимает машины навстречу чужому вылету, проходящему в её радиусе, и
     * сбивает его корпуса. Реактивно, как и зональное ПВО: приказа не нужно —
     * дежурное звено взлетает само, иначе игрок оборонялся бы только сидя у экрана.
     *
     * Три вещи, которые здесь легко потерять при правке:
     *
     * 1. **Перехватчик — тот, у кого есть `shuttleDamage`.** Отдельного флага «я
     *    истребитель» нет намеренно: ноль урона по челнокам и «не умею перехватывать»
     *    — одно и то же, а два способа сказать одно разъезжаются (тот же довод, что у
     *    `shuttleBay` в SHU-1.1).
     * 2. **Взлёт стоит топлива БАЗЫ.** Дежурство не бесплатно: пустой порт пропускает
     *    удар, и это ровно то решение, ради которого топливо вообще существует.
     * 3. **Машины не улетают из ангара.** Перехват — это подъём и посадка внутри
     *    одного часа; заводить ради него второй летящий объект в состоянии значило бы
     *    удвоить сущность, которую видят туман, зональное ПВО и выбор цели.
     */
    api.on('time.advanced', (_event, h: HandlerContext) => {
      const strikes = h.state.strikes ?? [];
      if (strikes.length === 0) return;
      const data = h.ctx.data;
      const bases: BaseView[] = [
        ...Object.values(h.state.planets).map((planet) => planetBase(planet, data)),
        ...Object.values(h.state.fleets).map((fleet) => fleetBase(fleet, h.state, data)),
      ];
      for (const base of bases) {
        if (base.owner === null || base.position === null) continue;
        const power = sumUnitStat(base.hangar, data, 'shuttleDamage');
        if (power <= 0) continue; // в ангаре нет охотников
        const spec = baseSortieSpec(base, data);
        const sortie = base.sortie ?? freshSortie(spec.maxFuel);
        if (!canSortie(sortie)) continue; // дежурить нечем — топливо или перезарядка
        const reach = interceptReach(base.hangar, data);
        if (reach <= 0) continue;

        const target = nearestHostileStrike(strikes, base, reach, h);
        if (!target) continue;

        const dealt = h.hook<number>('combat.damage', power, {
          phase: 'intercept',
          location: base.ref.kind === 'planet' ? base.ref.id : '',
          attacker: base.owner,
          defender: target.owner,
        });
        // Тот же перевод урона в сбитые машины, что у зонального ПВО: у вылета нет
        // своего пула здоровья, и заводить его здесь второй раз нельзя.
        const hull = Math.max(1, data.units[target.units[0]!.unit]?.stats.hp ?? 1);
        target.damage = (target.damage ?? 0) + dealt;
        const downed = shootDownStrike(target, Math.floor(target.damage / hull));
        target.damage -= downed * hull;
        base.setSortie(spendSortie(sortie, spec.rearmRounds));
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

    /** Перезарядка идёт ДОМА: час мира — раунд перезарядки (SHU-1.2). «Дом» — любая
     *  база: и космопорт, и носитель (SHU-2.1), поэтому счётчик тикает у обоих одним
     *  правилом, а не двумя копиями, которые разъедутся. */
    api.on('time.advanced', (event, h: HandlerContext) => {
      const { from, to } = event.payload as { from: number; to: number };
      const hours = Math.floor((to - from) / hourMs(h));
      if (hours <= 0) return;
      const bases: BaseView[] = [
        ...Object.values(h.state.planets).map((planet) => planetBase(planet, h.ctx.data)),
        ...Object.values(h.state.fleets).map((fleet) => fleetBase(fleet, h.state, h.ctx.data)),
      ];
      for (const base of bases) {
        const sortie = base.sortie;
        if (!sortie || sortie.rearming <= 0) continue;
        const spec = baseSortieSpec(base, h.ctx.data);
        let next = sortie;
        for (let i = 0; i < hours && next.rearming > 0; i++) next = tickRearm(next, spec.maxFuel);
        base.setSortie(next);
      }
    });

  },
};