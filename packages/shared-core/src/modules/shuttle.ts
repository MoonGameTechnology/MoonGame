import { fleetPointDefense, planetPointDefense, fleetPDRange, PD_COOLDOWN_MINUTES } from '../util/pointDefense';
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
 * 1. **Боя не начинается — но безнаказанности нет** (ROS-2.2, заказ владельца п. 4).
 *    Ни `battleId`, ни раундов: челнок в бой не вяжется. Ответку в момент удара он при
 *    этом получает — от кораблей символическую (долю их огня), от планеты нулевую, и
 *    по-настоящему дорогую там, где стоит ЗОНАЛЬНОЕ ПВО. До ROS-2.2 удар не стоил
 *    нападающему ничего вовсе, и контрмерой были только выстрелы по трассе.
 * 2. **Полёт живёт в состоянии** (`state.strikes`), а не считается мгновенно. Мгновенный
 *    удар не оставил бы против себя никакой защиты и обнулил бы зональное ПВО.
 * 3. **Порт — и дом, и условие.** Вылет невозможен без живого порта (повреждён больше
 *    чем на 30% — не выпускает), возврат идёт в него же, а не стало порта — стоящие в нём
 *    челноки гибнут вместе с ним. Летящие садятся на ближайшую свою базу в дальности
 *    перелёта, а нет такой — гибнут (SHU-6.4, `divert`). Топливо и перезарядка тоже
 *    принадлежат порту. Дом можно и сменить — перелётом (`shuttle.relocate`, SHU-6.4).
 *
 * Здесь же живёт ЗОНАЛЬНОЕ ПВО (`pointDefense`) — контрмера челнокам вместе с
 * перехватом (SHU-1.3). Не путать с ПКО (`aaDamage`): та бьёт по КОРАБЛЯМ на орбите.
 *
 * Зенитка стреляет по вылету в ТРЁХ разных местах, и это не три копии одного:
 * `pd.fired` — реактивный залп корабля по вылету, ПРОХОДЯЩЕМУ в его радиусе;
 * `shuttle.intercepted` — поднятые навстречу перехватчики (SHU-1.3);
 * `shuttle.repelled` — ответка ЦЕЛИ в момент удара (ROS-2.2), и только она бывает
 * у планеты. Каналы разные, счёт сбитых машин один — `absorbIntoStrike`.
 */
import type { GameModule, HandlerContext } from '../kernel/module';
import type {
  Fleet,
  GameState,
  Planet,
  ShuttleStrike,
  Squadron,
  StrikeBase,
  UnitStack,
} from '../state/gameState';
import type { GameData } from '../data/schemas';
import { distance } from '../state/route';
import { chaseRadius, chaseStep } from '../state/chase';
import { fleetPositionAt } from '../state/fleetPosition';
import { isMineFleet, mineFleetVisible } from '../state/minefields';
import { isMissileFleet } from '../state/ordnance';
import { missileVisible } from '../state/visibility';
import { hasMapShare } from '../state/diplomacy';
import { isCapturable } from '../state/sectorKind';
import { isForkSite } from '../state/forkSite';
import { patrolTarget, type PatrolContact } from '../state/patrol';
import {
  canSortie,
  fleetHoldFree,
  fleetShuttleBay,
  hangarMachines,
  hangarSize,
  hangarUsed,
  freshSortie,
  portDisabled,
  shuttleBayAt,
  spendSortie,
  squadronFerryRange,
  squadronSize,
  squadronPatrol,
  squadronReach,
  stacksSize,
  strikesReserved,
  tickRearm,
  trimCargo,
  trimHangar,
  hullShare,
  type SortieState,
} from '../state/shuttle';
import {
  applyDamageToSide,
  beachheadOf,
  hookedDamage,
  isAllied,
  isHostile,
  ownFleet,
  removeIfWiped,
  type HookedDamage,
} from '../util/combat';
import { requireOwnedIdleFleet, requireOwnedUnengagedFleet } from '../util/fleet';
import { addUnits, cappedUnitStat, sumUnitStat } from '../util/stacks';
import { timeScaleOf, travelSpeedFactorOf, type Context } from '../action/types';
import { MS_PER_HOUR } from '../util/time';
import { dockHullRate, fleetAtOwnDock, fleetHangarRepairRate } from '../util/repair';
import { battleLocations } from '../state/battle';

/** Доля огня цели-ФЛОТА, которой она огрызается на удар челноков (ROS-2.2, §0.2).
 *  Символическая по замыслу: без зенитки удар почти безнаказан, и платит игрок
 *  именно за зенитку, а не за то, что у него вообще есть корабли. */
const RETURN_FIRE_FRACTION = 0.05;

/**
 * ОТВЕТНЫЙ УРОН по вылету в момент удара (ROS-2.2, заказ владельца п. 4).
 *
 * Одна формула на обе цели, и обе половины считаются тем же счётом, что и везде:
 *  · пушки — `cappedUnitStat` (в упор бьёт не весь рой, а COMBAT_UNIT_CAP стволов,
 *    ровно как в бою, при бомбардировке и на дистанции), взятые долей;
 *  · зенитка — полный Σ `pointDefense`, тем же несокращённым счётом, каким его уже
 *    считает залп зонального ПВО по трассе. Две арифметики для одного стата разошлись
 *    бы на первой же правке.
 *
 * У ПЛАНЕТЫ пушечной половины нет вовсе: голому миру ответить челноку нечем — стреляют
 * только зенитные установки, которые игрок построил.
 */
function returnFireAgainstFleet(target: Fleet, data: GameData): number {
  return (
    cappedUnitStat(target.units, data, 'attack') * RETURN_FIRE_FRACTION +
    fleetPointDefense(target, data)
  );
}

/** Как часто идущая ПОГОНЯ пересчитывает координаты цели и правит курс (SHU-4.4), в
 *  минутах игрового времени. Шесть — компромисс, а не круглое число: реже, и быстрая
 *  цель успевала бы проскочить радиус захвата между пересчётами; чаще, и ночь офлайна
 *  считалась бы впустую. Константа, а не стат в данных, намеренно: это ЧАСТОТА ОПРОСА
 *  движка, а не свойство машины, — числом в данных её можно было бы выкрутить так, что
 *  исход зависел бы от неё, а не от скоростей. */
const CHASE_STEP_MINUTES = 6;

/** Как часто мир ПРОСЫПАЕТСЯ ради погони, в игровых часах. Не то же самое, что шаг
 *  пересчёта выше: пробуждение стоит целого шага кернела (клон состояния), а пересчёт —
 *  двух умножений. Поэтому событие приходит раз в час, а внутри обработчика прошедший
 *  отрезок нарезается на шаги по `CHASE_STEP_MINUTES` — точность модели остаётся
 *  минутной, а цена остаётся часовой, как у остальных почасовых механик. */
const CHASE_WAKE_HOURS = 1;

/** Как часто висящий ПАТРУЛЬ бьёт цель в своём круге (SHU-6.2, резолюция владельца
 *  2026-10-04), в игровых минутах. Это ПРАВИЛО, а не частота опроса, как у погони выше:
 *  удар ложится ровно в этот момент, поэтому каждый тик — своё событие. Пересчёт «раз в
 *  час задним числом» бил бы флот, который к часу уже ушёл из круга, и вылет, который уже
 *  сел. */
const PATROL_TICK_MINUTES = 15;

/** Доля обычного удара на тик патруля: за час патруль бьёт ровно как один удар (§0.7
 *  роадмапа челноков). Выведена из длины тика, а не задана числом: поменяй тик — часовая
 *  сила останется прежней. Ответка цели берётся той же долей. */
const PATROL_TICK_SHARE = PATROL_TICK_MINUTES / 60;

/** Позиция базы вылета — мира или носителя. Носитель ДВИЖЕТСЯ, поэтому позиция
 *  всегда берётся текущая, а не запомненная при вылете: запомненная разъехалась бы
 *  с носителем ровно так же, как хранимая позиция флота разъезжается с расписанием. */
function basePosition(
  base: StrikeBase,
  state: GameState,
  now: number,
): { x: number; y: number } | null {
  if (base.kind === 'planet') {
    return state.planets[base.id]?.position ?? null;
  }
  const fleet = state.fleets[base.id];
  return fleet ? fleetPositionAt(state, fleet, now) : null;
}

/** Где база вылета сейчас — а погибший корабль там, где его видели в последний раз
 *  (`baseAt`, SHU-6.4). Мир с карты не пропадает, корабль уносит позицию с собой: без
 *  этой точки у эскадры, летящей к нему, не стало бы ни места на карте, ни точки, откуда
 *  искать, где сесть. */
function homePosition(
  strike: ShuttleStrike,
  state: GameState,
  now: number,
): { x: number; y: number } | null {
  return basePosition(strike.base, state, now) ?? strike.baseAt ?? null;
}

/** Запомнить, где сейчас база-корабль (SHU-6.4). Зовётся только в моменты, назначенные
 *  расписанием самого вылета (взлёт, поворот, пересчёт погони, тик патруля), и никогда на
 *  `time.advanced`: нарезку времени выбирает хост, и точка, снятая на его границах, у двух
 *  хостов вышла бы разной (инвариант детерминизма). */
function noteBase(h: HandlerContext, strike: ShuttleStrike): void {
  if (strike.base.kind !== 'fleet') return;
  const at = basePosition(strike.base, h.state, h.ctx.now);
  if (at) strike.baseAt = at;
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
  /** Вместимость в МЕСТАХ (`cargoSize` машин). 0 читается как «базы нет». У порта она
   *  бесконечна, если порт стоит (SHU-5.1: космопорт без предела); у флота это его
   *  трюм за вычетом десанта (`fleetShuttleBay`). */
  bay: number;
  /** Не выпускает из-за повреждений. Есть только у порта: у носителя вместимость
   *  падает вместе с погибшими корпусами, отдельного порога не нужно. */
  disabled: boolean;
  hangar: Squadron[];
  setHangar: (next: Squadron[]) => void;
  sortie: SortieState | undefined;
  /** `undefined` снимает счётчик: следующий вылет начнёт со свежего запаса. */
  setSortie: (next: SortieState | undefined) => void;
}

function planetBase(planet: Planet, data: GameData): BaseView {
  return {
    ref: { kind: 'planet', id: planet.id },
    owner: planet.owner,
    position: planet.position,
    bay: shuttleBayAt(planet, data) > 0 ? Infinity : 0,
    disabled: portDisabled(planet, data),
    hangar: planet.hangar ?? [],
    setHangar: (next) => {
      planet.hangar = next;
    },
    sortie: planet.sortie,
    setSortie: (next) => {
      if (next) planet.sortie = next;
      else delete planet.sortie;
    },
  };
}

function fleetBase(fleet: Fleet, state: GameState, data: GameData, now: number): BaseView {
  return {
    ref: { kind: 'fleet', id: fleet.id },
    owner: fleet.owner,
    position: fleetPositionAt(state, fleet, now),
    bay: fleetShuttleBay(fleet, data),
    disabled: false,
    hangar: fleet.hangar ?? [],
    setHangar: (next) => {
      fleet.hangar = next;
    },
    sortie: fleet.sortie,
    setSortie: (next) => {
      if (next) fleet.sortie = next;
      else delete fleet.sortie;
    },
  };
}

/** База по ссылке — или `null`, если её больше нет (снесённый порт, погибший носитель). */
function baseOf(
  ref: StrikeBase,
  state: GameState,
  data: GameData,
  now: number,
): BaseView | null {
  if (ref.kind === 'planet') {
    const planet = state.planets[ref.id];
    return planet ? planetBase(planet, data) : null;
  }
  const fleet = state.fleets[ref.id];
  return fleet ? fleetBase(fleet, state, data, now) : null;
}

/**
 * Топливо и перезарядка базы берутся у ЧЕЛНОКОВ ЭТОЙ БАЗЫ (первая машина): счётчик
 * принадлежит базе, а числа — машине.
 *
 * «Свои машины» — и те, что стоят в ангаре, И ТЕ, ЧТО СЕЙЧАС В ВОЗДУХЕ. Разница не
 * косметическая: пустой ангар давал `maxFuel: 0`, а `tickRearm` по окончании отсчёта
 * «заправляет» базу ровно на эту величину — то есть в ноль. Порт, поднявший всё, что у
 * него было, оставался сухим НАВСЕГДА: топлива нет, перезарядка кончилась, вылет уже
 * никогда не разрешится. До SHU-4.2 в это упирались редко (поднимали часть машин), а с
 * эскадрой вылет уходит соединением целиком — и редкий случай стал обычным.
 */
function baseSortieSpec(
  base: BaseView,
  state: GameState,
  data: GameData,
): { maxFuel: number; rearmRounds: number } {
  const away = (state.strikes ?? []).find(
    (s) => s.base.kind === base.ref.kind && s.base.id === base.ref.id,
  );
  const st = hangarMachines({ hangar: base.hangar })[0] ?? away?.units.find((u) => u.count > 0);
  const stats = st ? data.units[st.unit]?.stats : undefined;
  return {
    maxFuel: Math.max(0, Math.floor(stats?.fuel ?? 0)),
    rearmRounds: Math.max(0, Math.floor(stats?.rearmRounds ?? 0)),
  };
}

/** Где сейчас летящий удар: линейная интерполяция между портом и точкой удара по доле
 *  пройденного времени. Позиции у челнока нет в состоянии намеренно — она ВЫВОДИТСЯ,
 *  как позиция флота на лейне: хранимая копия разъехалась бы с расписанием.
 *
 *  У ПОГОНИ (SHU-4.4) начало отрезка другое: не база, а `strike.at` — точка ПОСЛЕДНЕГО
 *  пересчёта. Между пересчётами эскадра идёт к нынешнему прицелу ровно так же линейно,
 *  поэтому мимо `at` она не «прыгает» раз в час, а ползёт: замерший на карте значок
 *  соврал бы и игроку, и обороне. Развилка стоит ЗДЕСЬ, в одной функции, а не у каждого
 *  читателя: зональное ПВО, перехват и трасса спрашивают «где вылет» одинаково и обязаны
 *  получать один ответ.
 *
 *  ВИСЯЩИЙ ПАТРУЛЬ (SHU-6.2) стоит ровно над своей точкой: по нему ПВО и перехват бьют
 *  так же, как по летящему вылету, и это не отдельное правило, а та же развилка.
 *
 *  ПЕРЕЛЁТ (SHU-6.4) — обратная нога от точки взлёта к новой базе, и отдельной ветки у
 *  него нет. Корабль, к которому летят, погиб — нога кончается там, где его видели в
 *  последний раз (`homePosition`). */
function strikePosition(
  strike: ShuttleStrike,
  state: GameState,
  now: number,
): { x: number; y: number } | null {
  if (strike.leg === 'patrol') return { ...strike.to };
  if (strike.at) {
    const chase = strike.arrivesAt - strike.departedAt;
    const k =
      chase <= 0 ? 1 : Math.min(1, Math.max(0, (now - strike.departedAt) / chase));
    return {
      x: strike.at.x + (strike.to.x - strike.at.x) * k,
      y: strike.at.y + (strike.to.y - strike.at.y) * k,
    };
  }
  const home = homePosition(strike, state, now);
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

/**
 * Перевести УРОН по вылету в СБИТЫЕ МАШИНЫ по корпусу челнока, накопив остаток.
 *
 * У вылета нет своего пула здоровья — и не должно быть: иначе половина сбитого крыла
 * жила бы «раненой» в состоянии, которого игрок не видит. Недобор до корпуса копится на
 * самом вылете и досчитывается следующим залпом, поэтому три канала (зональное ПВО на
 * трассе, перехват, ответка в момент удара) обязаны считать ОДИНАКОВО — счёт живёт здесь
 * в одном экземпляре, а не тремя копиями по месту.
 */
function absorbIntoStrike(strike: ShuttleStrike, damage: HookedDamage, data: GameData): number {
  const first = strike.units[0];
  if (!first) return 0;
  const hull = Math.max(1, data.units[first.unit]?.stats.hp ?? 1);
  strike.damage = (strike.damage ?? 0) + damage;
  const downed = shootDownStrike(strike, Math.floor(strike.damage / hull));
  strike.damage -= downed * hull;
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

/** Снять `count` челноков `unit` из ангара. */
// --- ЭСКАДРА (SHU-4.2) ---------------------------------------------------------------
//
// Соединение челноков одной базы: свой id, свой состав, свой трюм. Все приказы ниже
// работают ВНУТРИ одной базы и через одну проекцию `BaseView` — порт мира и трюм
// носителя делают с эскадрами одно и то же, и вторая копия правил на второй базе
// разъехалась бы с первой на первой же правке (тот же довод, что и в SHU-2.1).

/** Следующий id эскадры. Счётчик в состоянии, а не `Math.random`: id обязан выводиться
 *  одинаково на сервере и в реплее (инвариант детерминизма). Позывной из него строит
 *  КЛИЕНТ чистой функцией — как имя флота, — поэтому в состоянии его нет. */
function nextSquadronId(h: HandlerContext, owner: string): string {
  const seq = (h.state.squadronSeq ?? 0) + 1;
  h.state.squadronSeq = seq;
  return `sq:${owner}:${seq}`;
}

/** Эскадра базы по id — или отказ. Молчаливого «ничего не произошло» здесь быть не
 *  может: приказ по несуществующему соединению это ошибка, а не пустая операция. */
function requireSquadron(h: HandlerContext, base: BaseView, id: unknown): Squadron {
  if (typeof id !== 'string') return h.reject('E_BAD_PAYLOAD');
  const sq = base.hangar.find((q) => q.id === id);
  if (!sq) return h.reject('E_NO_SQUADRON');
  return sq;
}

/** Свой ПАТРУЛЬ по id вылета — или отказ: отзыв и удержание адресуют его одинаково.
 *  Чужой вылет и несуществующий — один ответ: чужие вылеты скрыты туманом
 *  (`visibleState`), и различимый отказ выдал бы перебором id, что сейчас в воздухе. */
function ownPatrol(h: HandlerContext, playerId: string, strikeId: string): ShuttleStrike {
  const strike = (h.state.strikes ?? []).find((st) => st.id === strikeId);
  if (!strike || strike.owner !== playerId) return h.reject('E_NO_STRIKE');
  if (strike.target.kind !== 'point') return h.reject('E_NOT_PATROLLING');
  return strike;
}

/** Снять `count` машин юнита из СПИСКА СТЕКОВ. Возвращает остаток; `null` — не хватило. */
function takeMachines(units: readonly UnitStack[], unit: string, count: number): UnitStack[] | null {
  let left = count;
  const out: UnitStack[] = [];
  for (const st of units) {
    if (st.unit !== unit || left <= 0) {
      out.push({ ...st });
      continue;
    }
    const take = Math.min(st.count, left);
    left -= take;
    if (st.count - take > 0) out.push({ ...st, count: st.count - take });
  }
  return left > 0 ? null : out;
}

/** Заявка «столько-то таких машин» из payload — общая форма делёжа и погрузки. */
function parseStacks(h: HandlerContext, raw: unknown): Array<{ unit: string; count: number }> {
  if (!Array.isArray(raw) || raw.length === 0) return h.reject('E_BAD_PAYLOAD');
  const out: Array<{ unit: string; count: number }> = [];
  for (const item of raw) {
    const want = item as { unit?: unknown; count?: unknown };
    if (typeof want.unit !== 'string') return h.reject('E_BAD_PAYLOAD');
    const n = Number(want.count ?? 0);
    if (!Number.isSafeInteger(n) || n <= 0) return h.reject('E_BAD_PAYLOAD');
    out.push({ unit: want.unit, count: n });
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
  // Подбитые машины бьют слабее — в доле живого корпуса (SHU-5.7).
  const share = hullShare(strike.units, strike.damage, data);
  if (target === 'fleet') {
    return cappedUnitStat(strike.units, data, 'attack') * share;
  }
  return (
    cappedUnitStat(strike.units, data, (stats) => {
      const siege = stats.siegeDamage ?? 0;
      return siege > 0 ? siege : (stats.attack ?? 0);
    }) * share
  );
}

/** Носитель, пустивший этот вылет, для `DamageHookArgs.attackerFleet` (CORE-DMG-3).
 *  Вылет с МИРА флотом не является — тогда поле не ставится вовсе. */
function strikeAttackerFleet(strike: ShuttleStrike): { attackerFleet?: string } {
  return strike.base.kind === 'fleet' ? { attackerFleet: strike.base.id } : {};
}

/**
 * Пустить ответку по вылету и записать, чего она стоила (ROS-2.2).
 *
 * Через хук `combat.damage` со СВОЕЙ фазой `returnFire` (CORE-DMG-1): все каналы огня
 * ходят через один хук, и канал, который перестал его звать, молча отменяет техи и
 * пассивы фракций для своей доли урона. Ноль ответки — молчание: голый мир ничем не
 * стрелял, и событие о выстреле было бы враньём.
 */
function repelStrike(
  h: HandlerContext,
  strike: ShuttleStrike,
  amount: number,
  target: { kind: 'fleet' | 'planet'; id: string; owner: string | null; location: string },
): void {
  if (amount <= 0) return;
  const dealt = hookedDamage(h, amount, {
    phase: 'returnFire',
    location: target.location,
    attacker: target.owner ?? '',
    defender: strike.owner,
    // CORE-DMG-3: огрызается ЦЕЛЬ — флот своими орудиями, мир своим ПВО.
    ...(target.kind === 'fleet' ? { attackerFleet: target.id } : {}),
  });
  const downed = absorbIntoStrike(strike, dealt, h.ctx.data);
  h.emit('shuttle.repelled', {
    strikeId: strike.id,
    owner: strike.owner,
    targetId: target.id,
    targetOwner: target.owner,
    damage: dealt,
    downed,
  });
}

/**
 * Урезать груз до того, что довезли УЦЕЛЕВШИЕ машины (ROS-1.5, SHU-5.2).
 *
 * Десантный челнок несёт ровно одного бойца, поэтому сбитый борт уносит своего: иначе
 * зональное ПВО выбивало бы конвой, а на землю всё равно сходил бы полный десант, и
 * оборона против высадки ничего не решала бы. Режем с хвоста (`trimCargo`) тем же
 * порядком, что и сами машины: порядок детерминирован.
 */
function trimCargoToSurvivors(strike: ShuttleStrike): void {
  const cargo = strike.cargo ?? [];
  if (cargo.length === 0) return;
  strike.cargo = trimCargo(cargo, strike.units.reduce((n, st) => n + Math.max(0, st.count), 0));
}

/**
 * ВЫСАДКА (ROS-1.5) — что делает долетевший груз на чужой земле.
 *
 * Решение владельца 2026-09-09: десант с челнока — полноценная сторона наземного боя.
 * Флота у него нет, поэтому его держит МИР (`planet.beachhead`), а не флот, как у
 * высадки с орбиты; всё остальное — тот же шов, что у `fleet.assault`:
 *
 *  · мир СВОЙ или дружественный → груз просто уходит в гарнизон (переброска
 *    подкреплений, дефолт кирпича на открытый вопрос владельцу);
 *  · мир чужой и НЕОБОРОНЯЕМЫЙ → он берётся сразу, десант становится гарнизоном;
 *  · мир чужой и обороняемый → встаёт ПЛАЦДАРМ и начинается наземный бой; если свой
 *    плацдарм там уже есть, груз доливается в него (переброска под огонь);
 *  · за мир уже дерётся КТО-ТО ДРУГОЙ → сесть некуда: один наземный бой на гарнизон
 *    (то же правило, что отбивает второй штурм кодом `E_UNDER_ASSAULT`), и груз гибнет
 *    вместе с машинами. Это не молчаливая потеря: о ней говорит `shuttle.landed`
 *    с `landed: 0`.
 */
/**
 * Поставить высаженных бойцов в список стеков (SHU-5.7). Побитый челнок отдаёт бойцу свою
 * долю живого корпуса: 50% корпуса челнока — 50% здоровья бойца (резолюция владельца
 * 2026-09-26). Раненый стек встаёт ОТДЕЛЬНО — с целыми он не сливается, как и любой
 * раненый стек (`findHealthyStack`); целые сливаются как прежде.
 */
function landStacks(into: UnitStack[], cargo: readonly UnitStack[], share: number, data: GameData): void {
  for (const st of cargo) {
    const per = data.units[st.unit]?.stats.hp ?? 0;
    if (share >= 1 || per <= 0) addUnits(into, st.unit, st.count);
    else into.push({ unit: st.unit, count: st.count, hp: st.count * per * share });
  }
}

function landCargo(h: HandlerContext, strike: ShuttleStrike, planet: Planet): void {
  const cargo = (strike.cargo ?? []).filter((st) => st.count > 0);
  const share = hullShare(strike.units, strike.damage, h.ctx.data);
  const owner = strike.owner;
  const friendly =
    planet.owner === owner ||
    (planet.owner !== null &&
      (isAllied(h, owner, planet.owner) || hasMapShare(h.state, owner, planet.owner)));
  let landed = cargo;
  let mode: 'reinforce' | 'capture' | 'beachhead' | 'lost' = 'lost';
  // MSB-4: свой плацдарм на этом мире и чужие — разные случаи. Свой принимает
  // подкрепление, чужие больше не запрещают высадку, но запрещают тихий захват пустого
  // мира: за него уже дерутся.
  const own = beachheadOf(h.state, planet.id, owner);
  const others = (planet.beachheads ?? []).some((b) => b.owner !== owner);

  if (cargo.length === 0 || isForkSite(planet)) {
    // Площадка развилки десанта не принимает (приказ отбит ещё на вылете) — подстраховка.
    landed = [];
    mode = 'lost';
  } else if (friendly) {
    landStacks(planet.garrison, cargo, share, h.ctx.data);
    mode = 'reinforce';
  } else if (own) {
    // Свой плацдарм уже на земле — подкрепление в идущий бой. Ссылка стороны адресует
    // ПАРУ (мир, владелец), а не снимок стеков, поэтому подошедшие войска считаются со
    // следующего раунда.
    landStacks(own.units, cargo, share, h.ctx.data);
    mode = 'beachhead';
    // Берег мог стоять на земле БЕЗ БОЯ — после ничьей или перемирия. Тогда подкрепление
    // продолжает штурм так же, как новый десант с флота: `beachhead.landed` заводит бой или
    // вводит берег в идущий (замечание Codex на #1409: челнок довозил войска, а бой так и не
    // начинался). Против невраждебного хозяина — нет: перемирие драку и сняло.
    const fighting = Object.values(h.state.battles).some(
      (b) =>
        b.phase === 'ground' &&
        b.location === planet.id &&
        b.sides.some((x) => x.ref.kind === 'beachhead' && x.ref.owner === owner),
    );
    if (!fighting && (planet.owner === null || isHostile(h, owner, planet.owner))) {
      h.emit('beachhead.landed', { planetId: planet.id, owner });
    }
  } else if (!isCapturable(h.ctx.data, planet)) {
    landed = []; // пустое пространство не занимают пехотой
  } else if (
    !planet.garrison.some((st) => st.count > 0) &&
    !others &&
    !groundBattleAt(h, planet.id)
  ) {
    // Fail-secure: тихо занять мир можно, только если за него НИКТО не дерётся. Чужой
    // плацдарм или идущий наземный бой (например, высадка с флота) означают, что мир
    // спорный, — тогда ниже заводится свой берег, а не захват без боя.
    const previous = planet.owner;
    planet.owner = owner;
    planet.garrison = [];
    landStacks(planet.garrison, cargo, share, h.ctx.data);
    h.emit('planet.captured', {
      planetId: planet.id,
      owner,
      by: planet.id,
      from: previous,
      via: 'assault',
    });
    mode = 'capture';
  } else {
    // MSB-4: СВОЙ берег у каждого штурмующего (решение владельца §0.0 №3). Раньше здесь
    // стоял отказ «за мир дерётся другой — садиться некуда»: плацдарм был один, и второй
    // десант просто терял груз. Push в конец — порядок списка это порядок ВЫСАДКИ, по
    // которому §0.0 №4 решает, чей мир.
    const units: UnitStack[] = [];
    landStacks(units, cargo, share, h.ctx.data);
    (planet.beachheads ??= []).push({ owner, units });
    // Бой начинает МОДУЛЬ БОЯ, услышав событие: модули не зовут друг друга напрямую
    // (инвариант «только через шину»), и `startBattle` живёт там же, где все остальные
    // правила боя. Нет модуля боя — плацдарм просто стоит, а не падает.
    h.emit('beachhead.landed', { planetId: planet.id, owner });
    mode = 'beachhead';
  }

  h.emit('shuttle.landed', {
    strikeId: strike.id,
    owner,
    planetId: planet.id,
    landed: landed.reduce((n, st) => n + st.count, 0),
    mode,
  });
}

/** Идёт ли на этом мире наземный бой — то же правило «один бой на гарнизон», которым
 *  `fleet.assault` отбивает второй штурм. */
function groundBattleAt(h: HandlerContext, planetId: string): boolean {
  for (const id of Object.keys(h.state.battles).sort()) {
    const b = h.state.battles[id];
    if (b && b.phase === 'ground' && b.location === planetId) return true;
  }
  return false;
}

/** База из payload: ровно одна из двух — свой мир с портом ИЛИ свой носитель. Общая
 *  преамбула ВСЕХ приказов ангара (вылет, делёж, слияние, погрузка): своя копия у
 *  каждого разъехалась бы с остальными на первой же правке правил владения. */
function baseFromPayload(
  h: HandlerContext,
  playerId: string,
  p: { planetId?: unknown; fleetId?: unknown },
): BaseView {
  const fromPlanet = typeof p.planetId === 'string';
  const fromFleet = typeof p.fleetId === 'string';
  if (fromPlanet === fromFleet) return h.reject('E_BAD_PAYLOAD'); // ровно одна база
  if (fromPlanet) {
    const planet = h.state.planets[p.planetId as string];
    if (!planet) return h.reject('E_NO_PLANET');
    if (planet.owner !== playerId) return h.reject('E_FORBIDDEN');
    return planetBase(planet, h.ctx.data);
  }
  // Носитель обязан быть СВОИМ и не запертым в бою — но НЕ обязан стоять (решение
  // владельца 2026-09-16). Прежнее правило требовало стоянки, и обоснование звучало так:
  // «порт не двигается, и вылет с разгоняющегося носителя пришлось бы догонять». Оно
  // устарело раньше, чем сменилось правило: SHU-4.4 научил удар ДОГОНЯТЬ движущуюся
  // цель, а возврат и так берёт позицию базы ЖИВОЙ (`turnHome`: «носитель мог сдвинуться,
  // пока челноки летели»). Догонять уже умели — запрещали ровно взлёт.
  //
  // Второй ветки правил это не завело: позицию идущего носителя считает та же
  // `fleetPositionAt`, что и стоящего, — и радиус вылета, и возврат читают её одинаково.
  const fleet = requireOwnedUnengagedFleet(h, p.fleetId as string, playerId);
  return fleetBase(fleet, h.state, h.ctx.data, h.ctx.now);
}

/** Скорость соединения — самая медленная машина в нём: летят вместе, не порознь.
 *  Помножена на темп перемещения матча (`travelSpeedFactor`, ×5 в Sector Zero) — тот же,
 *  что у флотов: ускорь одни флоты, и истребитель отстал бы от фрегата, за которым охотится. */
function slowestSpeed(units: readonly UnitStack[], ctx: Context): number {
  let slowest = Infinity;
  for (const st of units) {
    if (st.count <= 0) continue;
    slowest = Math.min(slowest, ctx.data.units[st.unit]?.stats.speed ?? 0);
  }
  return Number.isFinite(slowest) ? slowest * travelSpeedFactorOf(ctx) : 0;
}

/** Скорость вылета — самая медленная машина в нём, урезанная в доле живого корпуса
 *  (SHU-5.7): подбитое соединение летит медленнее. */
function strikeSpeed(strike: ShuttleStrike, ctx: Context): number {
  return slowestSpeed(strike.units, ctx) * hullShare(strike.units, strike.damage, ctx.data);
}

/**
 * ПОСАДОЧНОЕ МЕСТО БАЗЫ (SHU-6.4) — одно правило на посадку, приказ перелёта и поиск
 * запасной базы: три копии разъехались бы ровно там, где игрок теряет эскадру.
 *
 * `bay` — сколько мест ангар базы может занять после посадки, `room` — сколько из них
 * свободно сейчас. У порта места без предела. У корабля — трюм за вычетом мест, которые
 * держат за собой ДРУГИЕ вылеты, летящие к нему (`except` — сам садящийся: своё место он
 * занимает сам). `null` — сесть нельзя вовсе: базы нет, она чужая, порт снесён, трюма нет.
 */
function landingSpot(
  h: HandlerContext,
  owner: string,
  ref: StrikeBase,
  except?: string,
): { base: BaseView; bay: number; room: number } | null {
  const base = baseOf(ref, h.state, h.ctx.data, h.ctx.now);
  if (!base || base.owner !== owner) return null;
  const bay =
    ref.kind === 'fleet' ? base.bay - strikesReserved(h.state, ref.id, h.ctx.data, except) : base.bay;
  if (bay <= 0) return null;
  return { base, bay, room: bay - hangarSize({ hangar: base.hangar }, h.ctx.data) };
}

/**
 * БЛИЖАЙШАЯ СВОЯ БАЗА, куда эскадра сядет целиком (SHU-6.4): мир с портом или ангаром
 * крепости либо корабль с трюмом, в том числе идущий, — в дальности ПЕРЕЛЁТА от точки
 * `from`. Дальность та же, что у приказа: дальше эскадра не долетает ни по приказу, ни
 * без него.
 *
 * Детерминированно: ближе — раньше, при равной дистанции мир раньше корабля, дальше по
 * id. Союзник не база — сажать машины на чужой порт владелец не заказывал.
 */
function nearestBase(
  h: HandlerContext,
  strike: ShuttleStrike,
  from: { x: number; y: number },
  need: number,
): StrikeBase | null {
  const reach = squadronFerryRange(strike, h.ctx.data);
  const candidates: Array<{ ref: StrikeBase; at: { x: number; y: number } | null }> = [];
  for (const id of Object.keys(h.state.planets).sort()) {
    const planet = h.state.planets[id]!;
    if (planet.owner === strike.owner) candidates.push({ ref: { kind: 'planet', id }, at: planet.position });
  }
  for (const id of Object.keys(h.state.fleets).sort()) {
    const fleet = h.state.fleets[id]!;
    if (fleet.owner !== strike.owner) continue;
    candidates.push({ ref: { kind: 'fleet', id }, at: fleetPositionAt(h.state, fleet, h.ctx.now) });
  }
  let best: StrikeBase | null = null;
  let bestDist = Infinity;
  for (const c of candidates) {
    if (!c.at) continue;
    const d = distance(from, c.at);
    // Строго ближе: при равной дистанции остаётся тот, кто раньше в обходе.
    if (d > reach || d >= bestDist) continue;
    const spot = landingSpot(h, strike.owner, c.ref, strike.id);
    if (!spot || spot.room < need) continue;
    best = c.ref;
    bestDist = d;
  }
  return best;
}

/**
 * ЛЕТЕТЬ НА БАЗУ — обратной ногой из точки `from` (SHU-6.4). Одна на возврат домой,
 * перелёт и посадку без базы: та же позиция на карте, тот же зенит по трассе, та же
 * посадка. Копия у каждого разъехалась бы на первой же правке правил возврата.
 *
 * Позиция базы берётся ТЕКУЩАЯ: носитель мог сдвинуться, пока челноки летели, и лететь
 * они должны к нему, а не к точке, где он стоял на вылете. Дальше нога ползёт за живой
 * позицией корабля (`strikePosition`), а садится по сроку.
 *
 * `to` становится точкой РАЗВОРОТА, а живой след (`at`) снимается: с этой секунды у
 * эскадры снова есть расписание, и позицию надо выводить, а не хранить.
 */
function flyTo(
  h: HandlerContext,
  strike: ShuttleStrike,
  dest: StrikeBase,
  from: { x: number; y: number },
): void {
  const at = basePosition(dest, h.state, h.ctx.now);
  const back = at ? distance(from, at) : 0;
  const speed = strikeSpeed(strike, h.ctx);
  const flightMs = speed > 0 ? Math.max(1, Math.round((back / speed) * hourMs(h))) : 1;
  strike.base = dest;
  if (dest.kind === 'planet') delete strike.baseAt;
  else noteBase(h, strike);
  strike.to = { x: from.x, y: from.y };
  delete strike.at;
  strike.leg = 'back';
  strike.departedAt = h.ctx.now;
  strike.arrivesAt = h.ctx.now + flightMs;
  h.schedule(strike.arrivesAt, 'shuttle.arrived', { strikeId: strike.id });
}

/**
 * БАЗА НЕ ПРИНЯЛА — ИСКАТЬ, ГДЕ СЕСТЬ (SHU-6.4, резолюция владельца 2026-10-04).
 *
 * Раньше вылет, чья база пропала, просто гиб на посадке. Теперь:
 *
 * 1. **Перелёт возвращается туда, откуда ушёл** (`origin`), если там есть место, — без
 *    предела дальности: дорогу назад эскадра только что пролетела. Поле снимается сразу:
 *    вторая неудача ведёт уже к ближайшей базе, а не по кругу между двумя.
 * 2. **Иначе — ближайшая своя база в дальности перелёта** (`nearestBase`), куда эскадра
 *    влезает ЦЕЛИКОМ: искать место, чтобы потерять там половину машин, нечестно.
 * 3. **Некуда — эскадра гибнет**, и это громко (`shuttle.lost` с базой, которая не
 *    приняла), а не тихое исчезновение из состояния.
 *
 * Решение принимается в точке, назначенной расписанием вылета (поворот, прибытие), а не
 * на `time.advanced`: нарезка хоста не должна решать, где эскадра сядет.
 */
function divert(
  h: HandlerContext,
  strike: ShuttleStrike,
  from: { x: number; y: number },
  failed: StrikeBase,
): void {
  const need = Math.max(1, stacksSize(strike.units, h.ctx.data));
  const origin = strike.origin;
  delete strike.origin;
  const home = origin ? landingSpot(h, strike.owner, origin, strike.id) : null;
  const dest = origin && home && home.room >= need ? origin : nearestBase(h, strike, from, need);
  if (!dest) {
    h.state.strikes = (h.state.strikes ?? []).filter((st) => st.id !== strike.id);
    h.emit('shuttle.lost', {
      baseId: failed.id,
      baseKind: failed.kind,
      owner: strike.owner,
      count: strike.units.reduce((n, st) => n + st.count, 0),
    });
    return;
  }
  h.emit('shuttle.diverted', {
    strikeId: strike.id,
    owner: strike.owner,
    squadronId: strike.squadronId,
    fromId: failed.id,
    fromKind: failed.kind,
    baseId: dest.id,
    baseKind: dest.kind,
  });
  // С этой секунды у эскадры одно дело — сесть целиком, как у перелёта. Патруль, если это
  // был он, кончился: поле `patrol` есть только у вылета с целью-точкой.
  strike.target = { kind: 'base' };
  delete strike.patrol;
  flyTo(h, strike, dest, from);
}

/**
 * РАЗВОРОТ ДОМОЙ — тем же путём и с той же скоростью. Один на всех, кто разворачивает
 * эскадру: удар состоялся, погоня сорвалась, цель исчезла, патруль кончился. Дома не
 * стало, пока эскадра была в воздухе, — она ищет другую базу сразу, из точки разворота
 * (`divert`), а не летит в пустоту.
 */
function turnHome(h: HandlerContext, strike: ShuttleStrike): void {
  const from = strike.at ?? strike.to;
  if (!landingSpot(h, strike.owner, strike.base, strike.id)) {
    return divert(h, strike, from, strike.base);
  }
  flyTo(h, strike, strike.base, from);
}


/**
 * НАЗНАЧИТЬ СЛЕДУЮЩИЙ ПЕРЕСЧЁТ ПОГОНИ. Раз в час — но не позже, чем эскадра рассчитывает
 * дойти, и не чаще шага пересчёта: разбудить мир ради удара, который случится через
 * десять минут, дешевле, чем проспать его на пятьдесят.
 */
function scheduleChase(h: HandlerContext, strike: ShuttleStrike): void {
  const hour = hourMs(h);
  const eta = Math.max(0, strike.arrivesAt - h.ctx.now);
  const wake = Math.min(CHASE_WAKE_HOURS * hour, Math.max((CHASE_STEP_MINUTES / 60) * hour, eta));
  h.schedule(h.ctx.now + Math.max(1, Math.round(wake)), 'shuttle.chase', { strikeId: strike.id });
}

/**
 * ЭСКАДРА, ГОТОВАЯ К ВЫЛЕТУ, и запас вылетов её базы — общая преамбула удара и патруля
 * (SHU-6.2): своя копия у каждого приказа разъехалась бы с другой на первой правке.
 *
 * База: есть, цела и с топливом. Порог повреждения — на ВЫЛЕТ (правило владельца);
 * возврату он не мешает, иначе челнок повис бы в пустоте. У носителя порога нет:
 * подбитый носитель теряет корпуса, вместимость падает сама.
 *
 * Проверяется РАНЬШЕ эскадры намеренно: «этот флот вообще не база» — более точный ответ,
 * чем «в нём нет такого соединения», а у обычного корабля его и не бывает.
 */
function readySquadron(h: HandlerContext, base: BaseView, squadronId: unknown): Ready {
  const blocked = baseBlock(base);
  if (blocked) return h.reject(blocked);
  const ready = squadronReady(h, base, requireSquadron(h, base, squadronId));
  return typeof ready === 'string' ? h.reject(ready) : ready;
}

/** Эскадра, готовая к вылету, и запас вылетов её базы. */
type Ready = { squad: Squadron; spec: { maxFuel: number; rearmRounds: number }; sortie: SortieState };

/** Выпускает ли база вообще: есть, цела. Код отказа, а не бросок — тем же ответом
 *  удержание патруля (SHU-6.6) решает, ждать ему или снять удержание. */
function baseBlock(base: BaseView): string | null {
  if (base.bay <= 0) return 'E_NO_PORT';
  if (base.disabled) return 'E_PORT_DAMAGED';
  return null;
}

/** Готова ли эскадра и есть ли у базы вылет — без бросков, как {@link baseBlock}. */
function squadronReady(h: HandlerContext, base: BaseView, squad: Squadron): Ready | string {
  if (squadronSize(squad) <= 0) return 'E_NOT_ENOUGH';
  const spec = baseSortieSpec(base, h.state, h.ctx.data);
  const sortie = base.sortie ?? freshSortie(spec.maxFuel);
  if (!canSortie(sortie)) return 'E_NO_FUEL';
  return { squad, spec, sortie };
}

/** Время полёта эскадры по прямой: самая медленная машина, урезанная в доле живого
 *  корпуса (SHU-5.7). Не летит вовсе — отказ `E_NO_SPEED`. */
function flightTime(
  h: HandlerContext,
  squad: Squadron,
  from: { x: number; y: number },
  to: { x: number; y: number },
): number {
  return flightMs(h, squad, from, to) ?? h.reject('E_NO_SPEED');
}

/** То же время полёта без броска: `null` — эскадре нечем лететь. Нужно удержанию патруля
 *  (SHU-6.6), которое поднимает эскадру из события и обязано снять удержание, а не
 *  уронить событие. */
function flightMs(
  h: HandlerContext,
  squad: Squadron,
  from: { x: number; y: number },
  to: { x: number; y: number },
): number | null {
  const speed = slowestSpeed(squad.units, h.ctx) * hullShare(squad.units, squad.damage, h.ctx.data);
  if (speed <= 0) return null;
  return Math.max(1, Math.round((distance(from, to) / speed) * hourMs(h)));
}

/**
 * ВЗЛЁТ — один на удар, патруль и перелёт (SHU-6.2, SHU-6.4): эскадра покидает ангар,
 * база тратит вылет, в состоянии появляется летящий вылет. Id, снятие с ангара и расход
 * топлива у приказов не должны расходиться. Расписание (прибытие или погоню) ставит
 * вызывающий: оно у приказов разное.
 *
 * `dest` — у ПЕРЕЛЁТА: эскадра сразу идёт обратной ногой на новую базу, а база, с
 * которой она ушла, запоминается в `origin` — туда она вернётся, если новая не примет.
 */
function launchFlight(
  h: HandlerContext,
  owner: string,
  base: BaseView,
  ready: Ready,
  flight: Pick<ShuttleStrike, 'target' | 'to' | 'arrivesAt'> &
    Partial<Pick<ShuttleStrike, 'at' | 'cargo' | 'patrol'>> & { dest?: StrikeBase },
): ShuttleStrike {
  const { squad, spec, sortie } = ready;
  // Эскадра покидает ангар ЦЕЛИКОМ — с этой секунды её в базе нет. Груз уже в трюме
  // (SHU-4.2), брать с базы нечего: он ушёл из гарнизона при погрузке.
  base.setHangar(base.hangar.filter((q) => q.id !== squad.id));
  base.setSortie(spendSortie(sortie, spec.rearmRounds));
  const seq = (h.state.strikeSeq ?? 0) + 1;
  h.state.strikeSeq = seq;
  const strike: ShuttleStrike = {
    id: `strike:${owner}:${h.ctx.now}:${seq}`,
    owner,
    base: flight.dest ?? base.ref,
    squadronId: squad.id,
    units: squad.units.map((st) => ({ ...st })),
    target: flight.target,
    to: flight.to,
    departedAt: h.ctx.now,
    arrivesAt: flight.arrivesAt,
    leg: flight.dest ? 'back' : 'out',
    ...(flight.at ? { at: flight.at } : {}),
    ...(flight.cargo ? { cargo: flight.cargo } : {}),
    // Подбитые машины летят подбитыми (SHU-5.3): урон эскадры — начало счёта вылета.
    ...(squad.damage ? { damage: squad.damage } : {}),
    ...(flight.patrol ? { patrol: flight.patrol } : {}),
    ...(flight.dest ? { origin: base.ref } : {}),
  };
  noteBase(h, strike);
  h.state.strikes = [...(h.state.strikes ?? []), strike];
  h.emit('shuttle.launched', {
    strikeId: strike.id,
    owner,
    from: base.ref.id,
    fromKind: base.ref.kind,
    count: squadronSize(squad),
  });
  return strike;
}

/**
 * Сбитая ракета (SM-3.7b) уходит с карты отработавшей — `spent`, как после попадания и
 * перехвата ПРО: «☠️ флот уничтожен» читался бы потерей флота, которой не было. Конец ракеты
 * объявляет своя строка, обеим сторонам — как перехват ПРО (`rocketMine.intercepted`):
 * `owner` — хозяин челноков, как у прочих событий `shuttle.*`, `playerId` — хозяин ракеты.
 */
function downMissile(h: HandlerContext, strike: ShuttleStrike, missileId: string): void {
  const missile = h.state.fleets[missileId];
  if (!missile || missile.units.length > 0) return;
  delete h.state.fleets[missileId];
  h.emit('fleet.destroyed', { fleetId: missileId, owner: missile.owner, spent: true });
  h.emit('shuttle.missileDowned', { owner: strike.owner, playerId: missile.owner, missileId });
}

/**
 * УДАР ВЫЛЕТА ПО ФЛОТУ — урон, гибель цели и её ответка. Один на удар по прибытии и на
 * тик патруля (SHU-6.2): `share` — доля обычного удара (у удара 1, у тика ¼), и ответка
 * берётся той же долей. Две копии этих строк разъехались бы на первой правке урона.
 */
function strikeFleet(h: HandlerContext, strike: ShuttleStrike, target: Fleet, share: number): void {
  // Ответка считается ДО удара, из того же снимка: цель, которую этот залп добьёт, всё
  // равно успевает огрызнуться — та же одновременность, что у артиллерии, где залпы
  // считаются из состояния до отрезка.
  const answer = returnFireAgainstFleet(target, h.ctx.data) * share;
  const power = strikePower(strike, h.ctx.data, 'fleet') * share;
  // Ракету узнаём ДО удара: у добитого отряда не остаётся юнитов, по которым её узнать.
  const missile = isMissileFleet(target, h.ctx.data);
  if (power > 0) {
    const dealt = hookedDamage(h, power, {
      phase: 'shuttle',
      location: target.location ?? '',
      attacker: strike.owner,
      defender: target.owner,
      ...strikeAttackerFleet(strike),
      defenderFleet: target.id,
    });
    h.emit('shuttle.hit', {
      strikeId: strike.id,
      owner: strike.owner,
      targetId: target.id,
      targetOwner: target.owner,
      damage: dealt,
    });
    applyDamageToSide(
      h,
      { kind: 'fleet', fleetId: target.id },
      dealt,
      h.ctx.data,
      '',
      undefined,
      undefined,
      strike.owner,
    );
    if (missile) downMissile(h, strike, target.id);
    else removeIfWiped(h, target.id);
  }
  repelStrike(h, strike, answer, {
    kind: 'fleet',
    id: target.id,
    owner: target.owner,
    location: target.location ?? '',
  });
}

/**
 * ПАТРУЛЬ ВСТАЛ В КРУГ (SHU-6.2): эскадра дошла до точки и висит над ней `patrol.hours`
 * игровых часов. Своё расписание нога `patrol` держит той же парой полей, что и полёт:
 * `departedAt` — начало патруля, `arrivesAt` — конец, по ним интерфейс рисует таймер.
 * Конец патруля — последний тик, а не отдельное событие прибытия: так отозванный патруль
 * не оставляет в очереди ничего, что вернуло бы его домой по старому сроку.
 */
function startPatrol(h: HandlerContext, strike: ShuttleStrike): void {
  delete strike.at; // путь к точке пройден: дальше позиция эскадры и есть точка
  strike.leg = 'patrol';
  strike.departedAt = h.ctx.now;
  strike.arrivesAt = h.ctx.now + Math.max(1, Math.round((strike.patrol?.hours ?? 0) * hourMs(h)));
  schedulePatrolTick(h, strike);
}

/** Следующий тик патруля — через `PATROL_TICK_MINUTES`, но не позже конца патруля. */
function schedulePatrolTick(h: HandlerContext, strike: ShuttleStrike): void {
  const tick = Math.max(1, Math.round((PATROL_TICK_MINUTES / 60) * hourMs(h)));
  h.schedule(Math.min(h.ctx.now + tick, strike.arrivesAt), 'shuttle.patrol.tick', {
    strikeId: strike.id,
  });
}

/** Путь патруля: часы и круг эскадры, откуда она взлетит, куда встанет и сколько лететь. */
type PatrolRoute = {
  plan: { hours: number; radius: number };
  from: { x: number; y: number };
  to: { x: number; y: number };
  flight: number;
};

/**
 * Встанет ли эскадра в патруль в точке `to` — путь, или код отказа. Одна проверка на
 * приказ и на удержание (SHU-6.6): своя копия у удержания разъехалась бы с приказом, и
 * эскадра вставала бы сама туда, куда игрок её не пустил бы. `to` — `null`, если точки в
 * приказе нет.
 */
function patrolCheck(
  h: HandlerContext,
  base: BaseView,
  squad: Squadron,
  to: { x: number; y: number } | null,
): PatrolRoute | string {
  // Время и круг — по слабому звену; ноль хоть у одной машины — патрулировать нечем
  // (десантный челнок этих чисел не имеет).
  const plan = squadronPatrol(squad, h.ctx.data);
  if (plan.hours <= 0 || plan.radius <= 0) return 'E_CANNOT_PATROL';
  // Груз в патруль не берут: обратная нога сажает только машины, и боец бы пропал.
  if ((squad.cargo ?? []).some((st) => st.count > 0)) return 'E_HAS_CARGO';
  if (!to) return 'E_BAD_PAYLOAD';
  const from = base.position;
  if (!from) return 'E_NO_PORT';
  const range = squadronReach(squad, h.ctx.data);
  if (range <= 0) return 'E_NO_RANGE';
  if (distance(from, to) > range) return 'E_OUT_OF_RANGE';
  const flight = flightMs(h, squad, from, to);
  if (flight === null) return 'E_NO_SPEED';
  return { plan, from, to, flight };
}

/** Поднять патруль — один взлёт на приказ и на удержание (SHU-6.6). */
function takeOffPatrol(
  h: HandlerContext,
  owner: string,
  base: BaseView,
  ready: Ready,
  route: PatrolRoute,
  hold: boolean,
): void {
  const strike = launchFlight(h, owner, base, ready, {
    target: { kind: 'point' },
    to: route.to,
    arrivesAt: h.ctx.now + route.flight,
    // Путь к неподвижной точке идёт от места взлёта: с идущего носителя начало
    // отрезка иначе ехало бы вместе с ним (`ShuttleStrike.at`).
    at: { ...route.from },
    patrol: hold ? { ...route.plan, hold: true } : route.plan,
  });
  h.schedule(strike.arrivesAt, 'shuttle.arrived', { strikeId: strike.id });
}

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
function resumeHold(h: HandlerContext, owner: string, squadronId: string): void {
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
  const route = patrolCheck(h, base, squad, ref.kind === 'planet' ? (hold.at ?? null) : base.position);
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
 *    — `shuttleDamage`; безоружная половина не выбирает цель, иначе чистый охотник за
 *    машинами нырял бы под пушки флота ради нуля урона.
 * 4. **По флоту — тот же удар, что по прибытии, долей тика**, с ответкой той же долей
 *    (`strikeFleet`). **По вылету — тот же канал, что перехват** (фаза `intercept`,
 *    событие `shuttle.intercepted` с `patrolId`): чужой вылет не отвечает, как не
 *    отвечает он перехвату (SHU-1.3); два патруля бьют друг друга каждый в свой тик.
 */
function patrolStrike(h: HandlerContext, strike: ShuttleStrike): void {
  const radius = strike.patrol?.radius ?? 0;
  const data = h.ctx.data;
  const now = h.ctx.now;
  const vsFleet = strikePower(strike, data, 'fleet') * PATROL_TICK_SHARE;
  const vsAir =
    sumUnitStat(strike.units, data, 'shuttleDamage') *
    hullShare(strike.units, strike.damage, data) *
    PATROL_TICK_SHARE;
  const contacts: PatrolContact[] = [];
  if (vsFleet > 0) {
    for (const f of Object.values(h.state.fleets)) {
      if (f.owner === strike.owner || !isHostile(h, strike.owner, f.owner)) continue;
      if (!f.units.some((st) => st.count > 0)) continue;
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
  }
  const pick = patrolTarget(strike.to, radius, contacts);
  if (pick === null) return;
  // id флота и id вылета не пересекаются: вылет всегда `strike:…` (см. `launchFlight`).
  const fleet = Object.prototype.hasOwnProperty.call(h.state.fleets, pick)
    ? h.state.fleets[pick]
    : undefined;
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
  const downed = absorbIntoStrike(target, dealt, data);
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
function resolveOutLeg(h: HandlerContext, strike: ShuttleStrike): void {
      // Перелёт и посадка без базы (SHU-6.4) идут обратной ногой с первой секунды: цели,
      // до которой лететь, у них нет. Сюда их не приводит ни одно расписание — страховка.
      if (strike.target.kind === 'base') return turnHome(h, strike);
      // ПАТРУЛЬ дошёл до точки — он не бьёт по прилёте, а встаёт в круг (SHU-6.2).
      if (strike.target.kind === 'point') return startPatrol(h, strike);
      if (strike.target.kind === 'fleet') {
        const target = h.state.fleets[strike.target.id];
        // Цель ушла с точки удара — челноки бьют пустоту и возвращаются ни с чем.
        if (target && target.owner !== strike.owner) strikeFleet(h, strike, target, 1);
      } else {
        const target = h.state.planets[strike.target.id];
        if (target && target.owner !== strike.owner) {
          const power = strikePower(strike, h.ctx.data, 'planet');
          const answer = planetPointDefense(target, h.ctx.data);
          if (power > 0) {
            // Второй шов по шине, как у обстрела с орбиты: урон миру накладывает
            // `construction`, получив `planet.bombarded` (CORE-DMG-2).
            const dealt = hookedDamage(h, power, {
              phase: 'shuttle',
              location: target.id,
              attacker: strike.owner,
              defender: target.owner ?? '',
              ...strikeAttackerFleet(strike),
            });
            h.emit('shuttle.hit', {
              strikeId: strike.id,
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
          repelStrike(h, strike, answer, {
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

export const shuttleModule: GameModule = {
  id: 'shuttle',
  // 1.3.0: невидимая чужая мина — не цель вылета (`E_NO_TARGET`, ревью #1411).
  // 1.4.0: подкрепление берегу без боя продолжает штурм (замечание Codex на #1409).
  // 1.5.0: десант на площадку крепости на развилке не садится (замечание Codex на #1410).
  // 1.6.0: патруль в точке (SHU-6.2) — `shuttle.patrol`/`shuttle.recall`, нога `patrol`,
  //        тик раз в 15 минут; прибытие по устаревшему сроку больше не сажает эскадру.
  // 1.7.0: перелёт и посадка без базы (SHU-6.4) — `shuttle.relocate`, цель `base`,
  //        `origin`/`baseAt`, событие `shuttle.diverted`; опустевшая база снимает счётчик.
  // 1.8.0: «Держать патруль» (SHU-6.6) — `hold` у патруля и эскадры, `shuttle.hold`,
  //        событие расписания `shuttle.patrol.resume`; отзыв снимает удержание.
  // 1.9.0: ракета — отряд (SM-3.7b): удар приказом бьёт её только видимой; сбитая уходит
  //        отработавшей (`spent`) со своей строкой `shuttle.missileDowned`.
  version: '1.9.0',
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
        squadronId?: string;
        targetFleetId?: string;
        targetPlanetId?: string;
      };
      const base = baseFromPayload(h, action.playerId, p ?? {});
      const ready = readySquadron(h, base, p?.squadronId);
      const squad = ready.squad;

      // Цель: чужой флот или чужой мир. Ровно одна из двух — payload-схема этого не
      // выражает, поэтому проверяем здесь (fail-secure: обе или ни одной → отказ).
      const wantFleet = typeof p.targetFleetId === 'string';
      const wantPlanet = typeof p.targetPlanetId === 'string';
      if (wantFleet === wantPlanet) return h.reject('E_BAD_PAYLOAD');
      const targetFleet = wantFleet ? h.state.fleets[p.targetFleetId!] : undefined;
      const targetPlanet = wantPlanet ? h.state.planets[p.targetPlanetId!] : undefined;
      if (wantFleet && !targetFleet) return h.reject('E_NO_TARGET');
      // Чужую мину видно только своим флотом вблизи (SM-3.6); невидимая мина — тот же
      // `E_NO_TARGET`, что и отсутствующий флот, иначе перебором id её нашёл бы любой
      // клиент (A06). Ревью #1411: правило видимости мин — во всех путях к цели челнока.
      // Ракету (SM-3.7b) — тоже только видимую: её id предсказуем, и перебор нашёл бы ракету,
      // которой зритель не видит. Бить её челноками — правило владельца 2026-10-06.
      if (
        targetFleet &&
        targetFleet.owner !== action.playerId &&
        ((isMineFleet(targetFleet, h.ctx.data) &&
          !mineFleetVisible(h.state, targetFleet, action.playerId, h.ctx.data)) ||
          (isMissileFleet(targetFleet, h.ctx.data) &&
            !missileVisible(h.state, targetFleet, action.playerId, h.ctx.data)))
      ) {
        return h.reject('E_NO_TARGET');
      }
      if (wantPlanet && !targetPlanet) return h.reject('E_NO_PLANET');
      const targetOwner = targetFleet?.owner ?? targetPlanet?.owner ?? null;
      // ROS-1.5: по КОРАБЛЯМ безоружная машина не бьёт вовсе. Признак берётся из
      // данных (`attack`), а не из имени юнита и не из отдельного флага: «нечем бить»
      // и есть всё правило. Отказ — на приказе, потому что пустой полёт стоил бы
      // игроку топлива и часа ради заведомого ничего.
      if (targetFleet && cappedUnitStat(squad.units, h.ctx.data, 'attack') <= 0) {
        return h.reject('E_INVALID_TARGET');
      }
      // Свой мир бомбить нельзя — но ВЕЗТИ на него подкрепление можно и нужно (ROS-1.5):
      // десантный вылет это транспорт, а не удар, и запрет «по своим не бьют» к нему
      // не относится. Признак — ГРУЗ В ТРЮМЕ (SHU-4.2 грузит его заранее, до приказа).
      const cargo = (squad.cargo ?? []).filter((st) => st.count > 0);
      if (targetOwner === action.playerId && cargo.length === 0) return h.reject('E_NOT_HOSTILE');
      // На площадку крепости на развилке десант не садится: это не мир, уйти оттуда нельзя, а
      // при гибели крепости войска остались бы у ничейного узла (замечание Codex на #1410).
      if (targetPlanet && isForkSite(targetPlanet) && cargo.length > 0) return h.reject('E_NOT_CAPTURABLE');

      const from = base.position;
      if (!from) return h.reject('E_NO_PORT'); // носитель без позиции (в перелёте) — не база
      const to = targetFleet
        ? (fleetPositionAt(h.state, targetFleet, h.ctx.now) ?? null)
        : (targetPlanet?.position ?? null);
      if (!to) return h.reject('E_NO_TARGET_POSITION');

      // Радиус считается ОТ УЗЛА БАЗИРОВАНИЯ: своей позиции у челнока в ангаре нет.
      // У СОЕДИНЕНИЯ он по САМОЙ КОРОТКОЙ руке (SHU-4.2) — как и скорость по самой
      // медленной машине: эскадра идёт вместе, и дальность у неё общая.
      const range = squadronReach(squad, h.ctx.data);
      if (range <= 0) return h.reject('E_NO_RANGE');
      if (distance(from, to) > range) return h.reject('E_OUT_OF_RANGE');

      const strike = launchFlight(h, action.playerId, base, ready, {
        target: targetFleet
          ? { kind: 'fleet', id: targetFleet.id }
          : { kind: 'planet', id: targetPlanet!.id },
        to,
        arrivesAt: h.ctx.now + flightTime(h, squad, from, to),
        // ПОГОНЯ (SHU-4.4) заводится только на удар по ФЛОТУ: мир не двигается, и
        // догонять его нечем — туда эскадра идёт по расписанию, как и раньше.
        ...(targetFleet ? { at: { ...from } } : {}),
        ...(cargo.length > 0 ? { cargo: cargo.map((st) => ({ ...st })) } : {}),
      });
      // Удар по МИРУ прилетает точно в срок, как и раньше. У ПОГОНИ срока нет — вместо
      // прибытия назначается первый пересчёт, и он же решит, когда эскадра дошла.
      if (targetFleet) scheduleChase(h, strike);
      else h.schedule(strike.arrivesAt, 'shuttle.arrived', { strikeId: strike.id });
    });

    /**
     * `shuttle.patrol { planetId | fleetId, squadronId, at: {x, y} }` — ПАТРУЛЬ В ТОЧКЕ
     * (SHU-6.2, резолюция владельца 2026-10-04, по образцу Conflict of Nations).
     *
     * Эскадра летит к точке как на удар — её видно, ПВО по трассе стреляет, — висит над
     * ней `patrolHours` и каждые `PATROL_TICK_MINUTES` бьёт одну цель в круге
     * `patrolRadius` (`patrolStrike`). Время вышло — домой, на обычную перезарядку;
     * `shuttle.recall` возвращает раньше.
     *
     * База та же, что у удара, и обе её формы: мир с портом или ангаром крепости и любой
     * корабль с трюмом, в том числе идущий. Точка — в радиусе удара эскадры от базы: круг,
     * который игрок видит у базы, обещает ровно то, куда патруль долетит. Тратится одна
     * единица запаса вылетов, как у удара.
     *
     * `hold: true` — «Держать патруль» (SHU-6.6): вернувшись, эскадра встанет снова сама.
     */
    api.onAction('shuttle.patrol', (action, h: HandlerContext) => {
      const p = (action.payload ?? {}) as {
        planetId?: unknown;
        fleetId?: unknown;
        squadronId?: unknown;
        at?: { x?: unknown; y?: unknown } | null;
        hold?: unknown;
      };
      if (p.hold !== undefined && typeof p.hold !== 'boolean') return h.reject('E_BAD_PAYLOAD');
      const base = baseFromPayload(h, action.playerId, p);
      const ready = readySquadron(h, base, p.squadronId);
      const x = p.at?.x;
      const y = p.at?.y;
      const to =
        typeof x === 'number' && typeof y === 'number' && Number.isFinite(x) && Number.isFinite(y)
          ? { x, y }
          : null;
      const route = patrolCheck(h, base, ready.squad, to);
      if (typeof route === 'string') return h.reject(route);
      takeOffPatrol(h, action.playerId, base, ready, route, p.hold === true);
    });

    /**
     * `shuttle.recall { strikeId }` — вернуть ПАТРУЛЬ домой раньше срока (SHU-6.2). С пути
     * к точке и из круга одинаково: разворот там, где эскадра сейчас, — не из точки взлёта
     * и не из точки патруля.
     *
     * Только патруль: у удара по флоту есть погоня, у десанта — груз, и «вернуть с
     * полпути» для них — отдельные правила, которых владелец не заказывал.
     *
     * Отзыв снимает и «Держать патруль» (SHU-6.6): игрок вернул эскадру домой, и встать
     * снова сама она не должна.
     */
    api.onAction('shuttle.recall', (action, h: HandlerContext) => {
      const p = (action.payload ?? {}) as { strikeId?: unknown };
      if (typeof p.strikeId !== 'string') return h.reject('E_BAD_PAYLOAD');
      const strike = ownPatrol(h, action.playerId, p.strikeId);
      if (strike.leg === 'back') return h.reject('E_NOT_PATROLLING');
      const here = strikePosition(strike, h.state, h.ctx.now);
      if (here) strike.to = here;
      delete strike.at;
      delete strike.patrol?.hold;
      turnHome(h, strike);
    });

    /**
     * `shuttle.hold { strikeId, on }` — «ДЕРЖАТЬ ПАТРУЛЬ» у патруля в воздухе;
     * `shuttle.hold { planetId | fleetId, squadronId, on: false }` — снять удержание с
     * эскадры, которая ждёт дома перезарядки (SHU-6.6, резолюция владельца 2026-10-04:
     * патруль заменяет дежурный вылет).
     *
     * Включить можно, пока патруль не повернул домой, — там же, где его можно вернуть:
     * повернувший по отзыву держать уже нечего, игрок сам вернул его. Снять можно всегда,
     * в том числе на обратной ноге, дома и на корабле в бою: снять стоячий приказ должно
     * быть можно в любую минуту, как и любой другой. Дома включить нельзя — там нет
     * патруля, у которого взять точку: для этого есть сам приказ патруля с `hold`.
     */
    api.onAction('shuttle.hold', (action, h: HandlerContext) => {
      const p = (action.payload ?? {}) as {
        strikeId?: unknown;
        planetId?: unknown;
        fleetId?: unknown;
        squadronId?: unknown;
        on?: unknown;
      };
      if (typeof p.on !== 'boolean') return h.reject('E_BAD_PAYLOAD');
      if (p.strikeId !== undefined) {
        if (typeof p.strikeId !== 'string' || p.squadronId !== undefined) {
          return h.reject('E_BAD_PAYLOAD');
        }
        const strike = ownPatrol(h, action.playerId, p.strikeId);
        if (!p.on) delete strike.patrol?.hold;
        else if (strike.leg === 'back' || !strike.patrol) return h.reject('E_NOT_PATROLLING');
        else strike.patrol.hold = true;
        return;
      }
      if (p.on) return h.reject('E_NOT_PATROLLING');
      const fromPlanet = typeof p.planetId === 'string';
      if (fromPlanet === (typeof p.fleetId === 'string')) return h.reject('E_BAD_PAYLOAD');
      let hangar: Squadron[];
      if (fromPlanet) {
        const planet = h.state.planets[p.planetId as string];
        if (!planet) return h.reject('E_NO_PLANET');
        if (planet.owner !== action.playerId) return h.reject('E_FORBIDDEN');
        hangar = planet.hangar ?? [];
      } else {
        // Чужой и несуществующий корабль — один ответ, как у всех приказов флота (A06).
        const fleet = ownFleet(h.state, p.fleetId as string);
        if (!fleet || fleet.owner !== action.playerId) return h.reject('E_NO_FLEET');
        hangar = fleet.hangar ?? [];
      }
      if (typeof p.squadronId !== 'string') return h.reject('E_BAD_PAYLOAD');
      const squad = hangar.find((q) => q.id === p.squadronId);
      if (!squad) return h.reject('E_NO_SQUADRON');
      delete squad.hold;
    });

    /**
     * `shuttle.relocate { planetId | fleetId, squadronId, toPlanetId | toFleetId }` —
     * ПЕРЕБАЗИРОВАНИЕ (SHU-6.4, резолюция владельца 2026-10-04, по образцу Conflict of
     * Nations): эскадра перелетает на другую СВОЮ базу и остаётся там.
     *
     * Базы — обе формы с обеих сторон (уточнение владельца: «учти наши базы, в виде
     * трюмов»): мир с портом или ангаром крепости и любой корабль с трюмом, в том числе
     * идущий. Решения, которые легко потерять при правке:
     *
     * 1. **Дальность — два радиуса удара** (`squadronFerryRange`): радиус удара — туда и
     *    обратно, перелёт — в одну сторону. По самой короткой руке, как всё у эскадры.
     * 2. **Перелёт — обратная нога с самого взлёта.** Лететь на новую базу — то же, что
     *    возвращаться домой: та же позиция на карте, тот же зенит по трассе, та же посадка
     *    на живую позицию идущего корабля. Своей ноги и своего прибытия у перелёта нет —
     *    вторая копия посадки разъехалась бы с первой.
     * 3. **Место в трюме корабля держится с взлёта** (`strikesReserved` считает вылет,
     *    чья база — этот корабль): два перелёта на одно место иначе оба взлетели бы, а сел
     *    бы один.
     * 4. **Тратится один вылет базы, с которой ушли**, как у удара и патруля.
     * 5. **Боец летит с бортом.** Десантный челнок перебирается вместе со своим бойцом:
     *    это не высадка, на землю он не сходит.
     * 6. **Новая база не приняла — назад, а нет и дома — на ближайшую** (`divert`): тем же
     *    правилом садится и удар, чья база пропала, пока он был в воздухе.
     */
    api.onAction('shuttle.relocate', (action, h: HandlerContext) => {
      const p = (action.payload ?? {}) as {
        planetId?: unknown;
        fleetId?: unknown;
        squadronId?: unknown;
        toPlanetId?: unknown;
        toFleetId?: unknown;
      };
      const base = baseFromPayload(h, action.playerId, p);
      const ready = readySquadron(h, base, p.squadronId);
      const squad = ready.squad;
      // Куда — ровно одна база из двух, как и откуда (fail-secure: схема этого не выражает).
      const toPlanet = typeof p.toPlanetId === 'string';
      const toFleet = typeof p.toFleetId === 'string';
      if (toPlanet === toFleet) return h.reject('E_BAD_PAYLOAD');
      const dest: StrikeBase = toPlanet
        ? { kind: 'planet', id: p.toPlanetId as string }
        : { kind: 'fleet', id: p.toFleetId as string };
      // На свою же базу — не перелёт, а пустой расход вылета.
      if (dest.kind === base.ref.kind && dest.id === base.ref.id) return h.reject('E_BAD_PAYLOAD');
      if (dest.kind === 'planet') {
        const planet = h.state.planets[dest.id];
        if (!planet) return h.reject('E_NO_PLANET');
        if (planet.owner !== action.playerId) return h.reject('E_FORBIDDEN');
        if (shuttleBayAt(planet, h.ctx.data) <= 0) return h.reject('E_NO_PORT');
      } else {
        // Чужой и несуществующий корабль — один ответ: иначе перебором id читались бы
        // скрытые туманом флоты (A06), как и у всех приказов флота.
        const fleet = ownFleet(h.state, dest.id);
        if (!fleet || fleet.owner !== action.playerId) return h.reject('E_NO_FLEET');
        if (fleetShuttleBay(fleet, h.ctx.data) <= 0) return h.reject('E_NO_PORT');
      }
      const spot = landingSpot(h, action.playerId, dest);
      if (!spot || spot.room < stacksSize(squad.units, h.ctx.data)) return h.reject('E_NO_CAPACITY');

      const from = base.position;
      if (!from) return h.reject('E_NO_PORT');
      const to = basePosition(dest, h.state, h.ctx.now);
      if (!to) return h.reject('E_NO_TARGET_POSITION');
      const range = squadronFerryRange(squad, h.ctx.data);
      if (range <= 0) return h.reject('E_NO_RANGE');
      if (distance(from, to) > range) return h.reject('E_OUT_OF_RANGE');

      const cargo = (squad.cargo ?? []).filter((st) => st.count > 0);
      const strike = launchFlight(h, action.playerId, base, ready, {
        target: { kind: 'base' },
        // Обратная нога идёт от `to` к базе: начало перелёта — точка взлёта.
        to: { ...from },
        arrivesAt: h.ctx.now + flightTime(h, squad, from, to),
        dest,
        ...(cargo.length > 0 ? { cargo: cargo.map((st) => ({ ...st })) } : {}),
      });
      h.schedule(strike.arrivesAt, 'shuttle.arrived', { strikeId: strike.id });
    });

    /**
     * `shuttle.split { planetId | fleetId, squadronId, units: [{unit,count}] }` —
     * отделить машины в НОВУЮ эскадру той же базы (SHU-4.2).
     *
     * **Позывной остаётся у БОЛЬШЕЙ половины** (дефолт кирпича): отделил двойку от
     * десятки — имя у восьмёрки, отделил восьмёрку — имя ушло с ней. Иначе имя
     * следовало бы за тем, на что игрок случайно нажал. Ничья — у исходной.
     *
     * **Груз делится, только если он однороден** (SHU-5.2): десантный челнок несёт
     * ровно одного бойца, и у эскадры, где все бойцы одного рода, ответ «кто уходит»
     * однозначен — по бойцу на уходящий борт. Смешанный трюм (после `shuttle.merge`
     * разных десантов) делить нельзя: кому достаётся танк, а кому пехотинец, модель не
     * знает.
     */
    api.onAction('shuttle.split', (action, h: HandlerContext) => {
      const p = (action.payload ?? {}) as { squadronId?: unknown; units?: unknown };
      const base = baseFromPayload(h, action.playerId, p as Record<string, unknown>);
      const squad = requireSquadron(h, base, p.squadronId);
      const hold = (squad.cargo ?? []).filter((st) => st.count > 0);
      if (hold.length > 1) return h.reject('E_HAS_CARGO');

      const want = parseStacks(h, p.units);
      let left: UnitStack[] = squad.units.map((st) => ({ ...st }));
      const moved: UnitStack[] = [];
      for (const w of want) {
        const next = takeMachines(left, w.unit, w.count);
        if (!next) return h.reject('E_NOT_ENOUGH');
        left = next;
        addUnits(moved, w.unit, w.count);
      }
      // Делить нечего, если уходит ВСЁ: это не делёж, а переименование.
      const stay = left.reduce((n, st) => n + st.count, 0);
      if (stay <= 0) return h.reject('E_BAD_PAYLOAD');

      const goes = moved.reduce((n, st) => n + st.count, 0);
      const freshId = nextSquadronId(h, action.playerId);
      // Бойцы расходятся по бортам: уходящим — по одному на борт, остальные остаются.
      const troop = hold[0];
      const goesN = troop ? Math.min(troop.count, goes) : 0;
      // Урон делится по числу бортов (SHU-5.3): он пул корпусов, а не метка на машине.
      const hurt = squad.damage ?? 0;
      const part = (units: UnitStack[], n: number, share: number): Omit<Squadron, 'id'> => ({
        units,
        ...(troop && n > 0 ? { cargo: [{ unit: troop.unit, count: n }] } : {}),
        ...(hurt > 0 && share > 0 ? { damage: (hurt * share) / (goes + stay) } : {}),
      });
      const movedPart = part(moved, goesN, goes);
      const leftPart = part(left, troop ? troop.count - goesN : 0, stay);
      const named: Squadron = { id: squad.id, ...(goes > stay ? movedPart : leftPart) };
      const other: Squadron = { id: freshId, ...(goes > stay ? leftPart : movedPart) };
      base.setHangar(base.hangar.flatMap((q) => (q.id === squad.id ? [named, other] : [q])));
      h.emit('squadron.split', {
        baseId: base.ref.id,
        baseKind: base.ref.kind,
        owner: action.playerId,
        squadronId: squad.id,
        newId: freshId,
      });
    });

    /**
     * `shuttle.merge { planetId | fleetId, squadronId, intoId }` — свести две эскадры
     * ОДНОЙ базы в одну (SHU-4.2). Трюмы складываются и переполнить приёмник не могут:
     * вместимость складывается вместе с бортами, а каждая половина уже влезала в свою.
     */
    api.onAction('shuttle.merge', (action, h: HandlerContext) => {
      const p = (action.payload ?? {}) as { squadronId?: unknown; intoId?: unknown };
      const base = baseFromPayload(h, action.playerId, p as Record<string, unknown>);
      if (p.squadronId === p.intoId) return h.reject('E_BAD_PAYLOAD');
      const from = requireSquadron(h, base, p.squadronId);
      const into = requireSquadron(h, base, p.intoId);

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
    });

    /**
     * `shuttle.load` / `shuttle.unload { fleetId, squadronId }` — перегрузка ЭСКАДРЫ
     * между космопортом мира и СТОЯЩИМ ТАМ ЖЕ носителем (SHU-2.1; с SHU-4.2 ездит
     * соединение целиком, а не россыпь машин). Ровно тот же шов, что у наземной армии
     * (`army.load`/`army.unload`): челнок строится в порту, но воевать вдали от своих
     * миров может только с борта.
     *
     * Эскадра переезжает ПОД СВОИМ ИМЕНЕМ: перегрузка — смена базы, а не роспуск
     * соединения. Груз в трюме едет вместе с ней — он стоит на её бортах.
     *
     * Обе стороны — СВОИ. Порт союзника не донор и не гараж: «помощь» иначе означала бы
     * вывоз чужой обороны, ровно как у `army.load`.
     */
    const transfer = (
      action: { playerId: string; payload: unknown },
      h: HandlerContext,
    ): { fleet: Fleet; planet: Planet; squadronId: string } => {
      const p = action.payload as { fleetId?: string; squadronId?: string };
      if (typeof p?.fleetId !== 'string' || typeof p?.squadronId !== 'string') {
        return h.reject('E_BAD_PAYLOAD');
      }
      const fleet = requireOwnedIdleFleet(h, p.fleetId, action.playerId);
      const planet = fleet.location ? h.state.planets[fleet.location] : undefined;
      if (!planet) return h.reject('E_NO_PLANET');
      if (planet.owner !== action.playerId) return h.reject('E_FORBIDDEN');
      return { fleet, planet, squadronId: p.squadronId };
    };

    /** Переезд эскадры между двумя ангарами одного узла. Форма ангара одна, поэтому и
     *  правило одно: своя копия на каждую сторону разъехалась бы. */
    const moveSquadron = (
      h: HandlerContext,
      from: { hangar?: Squadron[] },
      to: { hangar?: Squadron[] },
      squadronId: string,
      freeSpace: number,
    ): Squadron => {
      const squad = (from.hangar ?? []).find((q) => q.id === squadronId);
      if (!squad) return h.reject('E_NO_SQUADRON');
      if (stacksSize(squad.units, h.ctx.data) > freeSpace) return h.reject('E_NO_CAPACITY');
      from.hangar = (from.hangar ?? []).filter((q) => q.id !== squadronId);
      // «Держать патруль» (SHU-6.6) держится над СВОЕЙ базой: на новой базе точки нет.
      delete squad.hold;
      to.hangar = [...(to.hangar ?? []), squad];
      return squad;
    };

    api.onAction('shuttle.load', (action, h: HandlerContext) => {
      const { fleet, planet, squadronId } = transfer(action, h);
      const squad = moveSquadron(
        h,
        planet,
        fleet,
        squadronId,
        fleetHoldFree(h.state, fleet, h.ctx.data),
      );
      h.emit('shuttle.loaded', {
        fleetId: fleet.id,
        planetId: planet.id,
        squadronId: squad.id,
        count: squadronSize(squad),
        owner: action.playerId,
      });
    });

    api.onAction('shuttle.unload', (action, h: HandlerContext) => {
      const { fleet, planet, squadronId } = transfer(action, h);
      const squad = moveSquadron(
        h,
        fleet,
        planet,
        squadronId,
        shuttleBayAt(planet, h.ctx.data) > 0 ? Infinity : 0,
      );
      h.emit('shuttle.unloaded', {
        fleetId: fleet.id,
        planetId: planet.id,
        squadronId: squad.id,
        count: squadronSize(squad),
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
      // Прибытие РАНЬШЕ срока — устаревшее (SHU-6.2): отозванный с пути патруль получил
      // новое расписание, а старое событие осталось в очереди. Настоящее прибытие всегда
      // приходит ровно в `arrivesAt` или позже (событие, проспанное хостом), но не раньше.
      if (h.ctx.now < strike.arrivesAt) return;

      if (strike.leg === 'out') {
        resolveOutLeg(h, strike);
        return;
      }

      // Посадка — домой после удара или патруля, на новую базу при перелёте. У корабля
      // места считаются БЕЗ этого вылета (своё место он занимает сам), но с остальными,
      // ещё летящими: их места заняты до их собственной посадки.
      const spot = landingSpot(h, strike.owner, strike.base, strike.id);
      // База пропала, пока эскадра летела (снесённый порт, сбитый корабль, захваченный
      // мир), — или перелёту не хватает места: садиться сюда некуда, эскадра ищет другую
      // базу (SHU-6.4). Вернувшийся домой удар при нехватке места садится, чем влезет
      // (`trimHangar`): место за ним держалось с взлёта, и не хватить его может, только
      // если сам корабль потерял корпуса.
      if (
        !spot ||
        (strike.target.kind === 'base' && spot.room < stacksSize(strike.units, h.ctx.data))
      ) {
        return divert(h, strike, homePosition(strike, h.state, h.ctx.now) ?? strike.to, strike.base);
      }
      h.state.strikes = strikes.filter((s) => s.id !== strikeId);
      const base = spot.base;
      // Эскадра встаёт в ангар ПОД СВОИМ ИМЕНЕМ (SHU-4.2): она уходила соединением и
      // возвращается им же. Если её id за время полёта занят (перегрузка, слияние —
      // ангар живёт своей жизнью, пока машины летят), соединение садится под свежим,
      // потому что двух эскадр с одним именем в модели быть не может.
      const taken = base.hangar.some((q) => q.id === strike.squadronId);
      // Боец перелетевшего десантного челнока сходит в ангар вместе с бортом (SHU-6.4) —
      // по одному на уцелевший борт, как и при высадке.
      trimCargoToSurvivors(strike);
      const cargo = (strike.cargo ?? []).filter((st) => st.count > 0);
      // Удерживаемый патруль (SHU-6.6) садится с удержанием. Его точка у МИРА — `to`
      // обратной ноги: удержание живёт только у патруля, повернувшего домой по концу
      // времени (отзыв его снимает, а потерявший базу перестаёт быть патрулём), и
      // повернул он ровно из своей точки.
      const held = strike.target.kind === 'point' && strike.patrol?.hold === true;
      const home: Squadron = {
        id: taken ? nextSquadronId(h, strike.owner) : strike.squadronId,
        units: strike.units.map((st) => ({ ...st })),
        ...(cargo.length > 0 ? { cargo: cargo.map((st) => ({ ...st })) } : {}),
        // Недобитый урон вылета остаётся на машинах (SHU-5.3), а не забывается на посадке.
        ...(strike.damage && strike.damage > 0 ? { damage: strike.damage } : {}),
        ...(held ? { hold: base.ref.kind === 'planet' ? { at: { ...strike.to } } : {} } : {}),
      };
      base.setHangar(trimHangar([...base.hangar, home], spot.bay, h.ctx.data));
      h.emit('shuttle.landed', {
        baseId: base.ref.id,
        baseKind: base.ref.kind,
        owner: strike.owner,
        strikeId,
      });
      if (held) h.schedule(h.ctx.now, 'shuttle.patrol.resume', { owner: strike.owner, squadronId: home.id });
    });

    /**
     * СНОВА В ПАТРУЛЬ (SHU-6.6): удерживаемый патруль сел — или его база дождалась конца
     * перезарядки, боя корабля, ремонта порта (`resumeHold`). Своё событие, а не опрос на
     * `time.advanced`: срок назначает расписание, и нарезка хоста его не сдвигает.
     */
    api.on('shuttle.patrol.resume', (event, h: HandlerContext) => {
      const p = (event.payload ?? {}) as { owner?: unknown; squadronId?: unknown };
      if (typeof p.owner !== 'string' || typeof p.squadronId !== 'string') return;
      resumeHold(h, p.owner, p.squadronId);
    });

    /**
     * ПОГОНЯ (SHU-4.4) — как летящий удар догоняет ДВИЖУЩУЮСЯ цель.
     *
     * До этого кирпича цель фиксировалась координатой на вылете, и флот, идущий по
     * линии, не брался вовсе: приказ отбивался `E_NO_TARGET_POSITION`. Причина была не в
     * правиле, а в ДУБЛЕ — у модуля лежала своя копия «где сейчас флот», и она, в отличие
     * от ядровой `fleetPositionAt`, не знала про `Fleet.movement`. Копия снята, а поверх
     * живой точки встала модель владельца: эскадра регулярно пересчитывает координаты
     * цели, правит курс к центру её радиуса и бьёт, когда на очередном пересчёте
     * оказалась ВНУТРИ радиуса.
     *
     * Пять решений, которые здесь легко потерять при правке:
     *
     * 1. **Погоня живёт на СВОЁМ событии, а не на `time.advanced`.** Отрезок непрерывного
     *    времени нарезает ХОСТ — по своим пробуждениям, чужим таймерам, гибернации, — и
     *    сетка пересчётов, привязанная к его границам, у двух хостов вышла бы разной.
     *    Одна и та же партия дала бы разный исход, а реплей разъехался бы с матчем
     *    (инвариант #1). Собственное расписание от этого не зависит вовсе.
     * 2. **Отрезок между пробуждениями ИНТЕГРИРУЕТСЯ.** Между пересчётами час, и
     *    «посмотреть только в конец» дало бы уход от любого удара: цель успела бы сделать
     *    круг и вернуться. Шаг фиксирован (`CHASE_STEP_MINUTES`) и отсчитывается от
     *    прошлого пересчёта, а не от начала отрезка хоста.
     * 3. **Поводок меряется от БАЗЫ, а не от эскадры.** `strikeRange` и на вылете
     *    считается от узла базирования (§0.2 роадмапа), второй точки отсчёта у него быть
     *    не должно. Ушёл центр радиуса за дальность — атака отменяется сама. Это и есть
     *    контригра: от медленной эскадры быстрый флот отрывается, от быстрой — никто.
     * 4. **Цель исчезла или перестала быть чужой — домой.** Добитый в бою флот и союзник,
     *    с которым помирились, одинаково не цель; гнаться за пустым id значило бы держать
     *    вылет в состоянии до конца матча.
     * 5. **Удар наносит НЕ этот обработчик.** Догнала — зовётся общая резолюция
     *    `resolveOutLeg`, та же, что у удара по миру. Урон, ответка, высадка и разворот
     *    живут в одном экземпляре; вторая копия разъехалась бы с первой ровно так же, как
     *    разъехалась копия позиции флота.
     */
    api.on('shuttle.chase', (event, h: HandlerContext) => {
      const { strikeId } = event.payload as { strikeId?: string };
      if (typeof strikeId !== 'string') return;
      const strike = (h.state.strikes ?? []).find((s) => s.id === strikeId);
      // Сбит по дороге, уже развернулся, сел — пересчитывать нечего (dead letter).
      if (!strike?.at || strike.leg !== 'out' || strike.target.kind !== 'fleet') return;

      const data = h.ctx.data;
      const hour = hourMs(h);
      const stepMs = Math.max(1, (CHASE_STEP_MINUTES / 60) * hour);
      const speed = strikeSpeed(strike, h.ctx);
      const radius = chaseRadius(strike.units, data);
      const leash = squadronReach(strike, data);

      let cursor = strike.departedAt; // прошлый пересчёт (правило 2)
      let caught = false;
      let lost = false;
      while (cursor < h.ctx.now && !caught && !lost) {
        const next = Math.min(cursor + stepMs, h.ctx.now);
        const target = h.state.fleets[strike.target.id];
        const aim = target ? fleetPositionAt(h.state, target, next) : null;
        const home = basePosition(strike.base, h.state, next);
        if (!target || target.owner === strike.owner || !aim || !home) {
          lost = true; // правило 4
          break;
        }
        if (distance(home, aim) > leash) {
          lost = true; // правило 3
          break;
        }
        const step = chaseStep(strike.at, aim, speed * ((next - cursor) / hour), radius);
        strike.at = step.at;
        strike.to = aim;
        caught = step.caught;
        cursor = next;
      }

      noteBase(h, strike); // корабль-база жив — запомнить, где он (SHU-6.4)
      if (caught) return resolveOutLeg(h, strike); // правило 5
      if (lost) return turnHome(h, strike);
      // Ни догнала, ни сорвалась: закрыть отрезок и переназначить пересчёт. `departedAt`
      // у погони — момент ПОСЛЕДНЕГО пересчёта, а `arrivesAt` — оценка на нынешнем
      // прицеле: расписания у неё нет, но игроку надо видеть, догоняет она или отстаёт.
      const left = Math.max(0, distance(strike.at, strike.to) - radius);
      strike.departedAt = h.ctx.now;
      strike.arrivesAt = h.ctx.now + (speed > 0 ? Math.round((left / speed) * hour) : 0);
      scheduleChase(h, strike);
    });

    /**
     * ТИК ПАТРУЛЯ (SHU-6.2): удар по одной цели в круге (`patrolStrike`), затем — либо
     * следующий тик, либо домой, если время патруля вышло. Конец патруля — тоже тик: в
     * последнюю минуту круг держится так же, как в первую.
     */
    api.on('shuttle.patrol.tick', (event, h: HandlerContext) => {
      const { strikeId } = event.payload as { strikeId?: string };
      if (typeof strikeId !== 'string') return;
      const strike = (h.state.strikes ?? []).find((s) => s.id === strikeId);
      // Отозван, сбит, уже летит домой — тик ничей (dead letter).
      if (!strike || strike.leg !== 'patrol') return;
      noteBase(h, strike); // корабль-база жив — запомнить, где он (SHU-6.4)
      patrolStrike(h, strike);
      // Ответка цели могла сбить патруль целиком — домой лететь некому.
      if (strike.units.length === 0) {
        h.state.strikes = (h.state.strikes ?? []).filter((st) => st.id !== strike.id);
        return;
      }
      if (h.ctx.now >= strike.arrivesAt) return turnHome(h, strike);
      schedulePatrolTick(h, strike);
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
     * исчезла за время полёта, ловится на повороте к ней или на посадке и ищет, где сесть
     * (`divert`, SHU-6.4): решение в точке расписания, а не здесь, на нарезке хоста.
     */
    api.on('time.advanced', (_event, h: HandlerContext) => {
      const bases: BaseView[] = [
        ...Object.values(h.state.planets).map((planet) => ({
          ...planetBase(planet, h.ctx.data),
          // Ничей мир не держит ангар: вместимость нейтрального мира читается как 0.
          bay: planet.owner === null ? 0 : planetBase(planet, h.ctx.data).bay,
        })),
        ...Object.values(h.state.fleets).map((fleet) => fleetBase(fleet, h.state, h.ctx.data, h.ctx.now)),
      ];
      for (const base of bases) {
        if (base.hangar.length === 0) continue;
        const kept = trimHangar(base.hangar, base.bay, h.ctx.data);
        const lost = hangarUsed({ hangar: base.hangar }) - hangarUsed({ hangar: kept });
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

    /**
     * РЕМОНТ ЭСКАДР (SHU-5.3). Урон, привезённый с вылета, чинится у ДОКА тем же темпом,
     * что корпус корабля (`shipRepair` живых построек, доля полного корпуса в час): в
     * порту своего мира и на борту флота, стоящего у своего или союзного дока
     * (`fleetAtOwnDock` — правило одно на все пути ремонта). Флот с ремонтным ангаром
     * (`repair_bay`, SHU-5.4) чинит свои эскадры и в походе. Пока на узле бой, ремонта
     * нет — как и у кораблей (решение владельца 17).
     */
    api.on('time.advanced', (event, h: HandlerContext) => {
      const { from, to } = event.payload as { from: number; to: number };
      if (to <= from) return;
      const hours = ((to - from) / MS_PER_HOUR) * timeScaleOf(h.ctx);
      const data = h.ctx.data;
      const fighting = battleLocations(h.state);
      const mend = (hangar: readonly Squadron[], rate: number): void => {
        if (rate <= 0) return;
        for (const sq of hangar) {
          if (!sq.damage) continue;
          const left = sq.damage - rate * hours * sumUnitStat(sq.units, data, 'hp');
          if (left > 0) sq.damage = left;
          else delete sq.damage;
        }
      };
      for (const planet of Object.values(h.state.planets)) {
        if (!planet.hangar?.length || planet.owner === null || fighting.has(planet.id)) continue;
        mend(planet.hangar, dockHullRate(planet, data));
      }
      // Флот чинит свой ангар ремонтным модулем ВЕЗДЕ вне боя (SHU-5.4), у дока — сверх
      // темпа дока.
      for (const fleet of Object.values(h.state.fleets)) {
        if (!fleet.hangar?.length || fleet.battleId) continue;
        if (fleet.location !== null && fighting.has(fleet.location)) continue;
        const docked =
          fleet.location !== null && fleetAtOwnDock(fleet, h.state, data, (a, b) => isAllied(h, a, b));
        const dock = docked ? dockHullRate(h.state.planets[fleet.location!]!, data) : 0;
        mend(fleet.hangar, dock + fleetHangarRepairRate(fleet, data));
      }
    });

    /** Мир захвачен — челноки прежнего владельца гибнут вместе с портом, а не достаются
     *  захватчику (резолюция владельца 2026-09-08). Сразу, не дожидаясь тика: между
     *  захватом и следующим `time.advanced` ангар иначе числился бы за новым хозяином. */
    api.on('planet.captured', (event, h: HandlerContext) => {
      const { planetId } = event.payload as { planetId?: string };
      if (typeof planetId !== 'string') return;
      const planet = h.state.planets[planetId];
      const lost = hangarUsed({ hangar: planet?.hangar });
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
        const myPos = fleetPositionAt(h.state, fleet, h.ctx.now);
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
          const dealt = hookedDamage(h, perTarget, {
            phase: 'pointDefense',
            location: fleet.location ?? '',
            attacker: fleet.owner,
            defender: target.owner,
            attackerFleet: fleet.id, // зональное ПВО ведёт сам корабль (CORE-DMG-3)
          });
          // Урон переводится в СБИТЫЕ МАШИНЫ по корпусу челнока — счёт один на все
          // каналы, см. `absorbIntoStrike`.
          const downed = absorbIntoStrike(target, dealt, data);
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
        ...Object.values(h.state.fleets).map((fleet) => fleetBase(fleet, h.state, data, h.ctx.now)),
      ];
      for (const base of bases) {
        if (base.owner === null || base.position === null) continue;
        const machines = hangarMachines({ hangar: base.hangar });
        const power = sumUnitStat(machines, data, 'shuttleDamage');
        if (power <= 0) continue; // в ангаре нет охотников
        const spec = baseSortieSpec(base, h.state, data);
        const sortie = base.sortie ?? freshSortie(spec.maxFuel);
        if (!canSortie(sortie)) continue; // дежурить нечем — топливо или перезарядка
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
        const downed = absorbIntoStrike(target, dealt, data);
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
     *  правилом, а не двумя копиями, которые разъедутся.
     *
     *  Часы считаются от НАКОПЛЕННОГО времени, а не от отрезка (AUD-27): остаток сверх
     *  целых часов переходит в следующий отрезок (`SortieState.carry`). Иначе итог зависел
     *  бы от нарезки времени — от частоты событий и вызовов `advanceTo`.
     *
     *  Перезарядка кончилась, а заправлять НЕЧЕГО — счётчик снимается (SHU-6.4). База
     *  опустела насовсем: эскадра перелетела, сгрузилась на корабль, погибла. «Полный»
     *  бак нулевого размера остался бы на базе навсегда, и следующая эскадра, севшая сюда,
     *  не взлетела бы никогда; без счётчика она начнёт со свежего запаса своих машин. */
    api.on('time.advanced', (event, h: HandlerContext) => {
      const { from, to } = event.payload as { from: number; to: number };
      const span = to - from;
      if (!(span > 0)) return;
      const hour = hourMs(h);
      const bases: BaseView[] = [
        ...Object.values(h.state.planets).map((planet) => planetBase(planet, h.ctx.data)),
        ...Object.values(h.state.fleets).map((fleet) => fleetBase(fleet, h.state, h.ctx.data, h.ctx.now)),
      ];
      for (const base of bases) {
        const sortie = base.sortie;
        if (!sortie || sortie.rearming <= 0) continue;
        const spec = baseSortieSpec(base, h.state, h.ctx.data);
        const total = (sortie.carry ?? 0) + span;
        const hours = Math.floor(total / hour);
        let next: SortieState = { fuel: sortie.fuel, rearming: sortie.rearming };
        for (let i = 0; i < hours && next.rearming > 0; i++) next = tickRearm(next, spec.maxFuel);
        if (next.rearming <= 0 && next.fuel <= 0) {
          base.setSortie(undefined);
          continue;
        }
        const carry = total - hours * hour;
        base.setSortie(next.rearming > 0 && carry > 0 ? { ...next, carry } : next);
      }
    });

  },
};