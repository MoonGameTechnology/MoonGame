/** Челноки: общие помощники — вид базы, отряды, номера, счёт сбитых машин. Разрезан из `../shuttle.ts` (SLIM). */
import type {
  Fleet,
  GameState,
  Planet,
  ShuttleStrike,
  Squadron,
  StrikeBase,
  UnitStack,
} from '../../state/gameState';
import type { GameData } from '../../data/schemas';
import type { HandlerContext } from '../../kernel/module';
import type { HookedDamage } from '../../util/combat';
import { MS_PER_HOUR } from '../../util/time';
import {
  type SortieState,
  fleetShuttleBay,
  hangarMachines,
  isMissileStack,
  portDisabled,
  shuttleBayAt,
} from '../../state/shuttle';
import { addUnits, cappedUnitStat } from '../../util/stacks';
import { basePosition, strikePosition } from '../../state/strikePosition';
import { captureCasualtyCost } from '../../util/casualtyCost';
import { distance } from '../../state/route';
import { fleetPointDefense } from '../../util/pointDefense';
import { fleetPositionAt } from '../../state/fleetPosition';
import { timeScaleOf } from '../../action/types';

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
export function returnFireAgainstFleet(target: Fleet, data: GameData): number {
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
export const CHASE_STEP_MINUTES = 6;

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
export const PATROL_TICK_SHARE = PATROL_TICK_MINUTES / 60;

/** Запомнить, где сейчас база-корабль (SHU-6.4). Зовётся только в моменты, назначенные
 *  расписанием самого вылета (взлёт, поворот, пересчёт погони, тик патруля), и никогда на
 *  `time.advanced`: нарезку времени выбирает хост, и точка, снятая на его границах, у двух
 *  хостов вышла бы разной (инвариант детерминизма). */
export function noteBase(h: HandlerContext, strike: ShuttleStrike): void {
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
export interface BaseView {
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

export function planetBase(planet: Planet, data: GameData): BaseView {
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

export function fleetBase(fleet: Fleet, state: GameState, data: GameData, now: number): BaseView {
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

/** Есть ли у мира или флота машины в ангаре: обходы баз на каждом отрезке времени
 *  собирают вид базы только для таких. */
export function withHangar(holder: { hangar?: readonly Squadron[] }): boolean {
  return (holder.hangar?.length ?? 0) > 0;
}

/** База по ссылке — или `null`, если её больше нет (снесённый порт, погибший носитель). */
export function baseOf(
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
export function baseSortieSpec(
  base: BaseView,
  state: GameState,
  data: GameData,
): { maxFuel: number; rearmRounds: number } {
  const away = (state.strikes ?? []).find(
    (s) => s.base.kind === base.ref.kind && s.base.id === base.ref.id,
  );
  const st =
    hangarMachines({ hangar: base.hangar }).find((u) => !isMissileStack(u, data)) ??
    away?.units.find((u) => u.count > 0);
  const stats = st ? data.units[st.unit]?.stats : undefined;
  return {
    maxFuel: Math.max(0, Math.floor(stats?.fuel ?? 0)),
    rearmRounds: Math.max(0, Math.floor(stats?.rearmRounds ?? 0)),
  };
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
export function absorbIntoStrike(strike: ShuttleStrike, damage: HookedDamage, data: GameData, h: HandlerContext, by: string | null): number {
  const first = strike.units[0];
  if (!first) return 0;
  const hull = Math.max(1, data.units[first.unit]?.stats.hp ?? 1);
  const value = captureCasualtyCost(h.state, strike.units, data);
  const before = strike.units.map(stack => ({ stack, count: stack.count }));
  strike.damage = (strike.damage ?? 0) + damage;
  const downed = shootDownStrike(strike, Math.floor(strike.damage / hull));
  strike.damage -= downed * hull;
  const costs = value();
  const losses: Record<string, number> = {};
  for (const { stack, count } of before) losses[stack.unit] = (losses[stack.unit] ?? 0) + count - stack.count;
  for (const [unit, count] of Object.entries(losses)) if (count > 0)
    h.emit('career.casualty', { unit, count, owner: strike.owner, killedBy: by, lossCost: costs[unit] ?? {} });
  return downed;
}

/** Насколько далеко база поднимает перехватчики — самый дальнобойный охотник в
 *  ангаре. Тот же `strikeRange`, которым он летит бить: машина не может встречать
 *  дальше, чем достаёт сама. */
export function interceptReach(hangar: readonly UnitStack[], data: GameData): number {
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
export function nearestHostileStrike(
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

/**
 * СОБЫТИЕ РАСПИСАНИЯ ВЫЛЕТА — прибытие, пересчёт погони, тик патруля — с номером приказа
 * (SHU-6.13). Номер пишется, только если приказ в воздухе уже меняли: у вылета, которому
 * приказ не меняли, событие то же, что и до кирпича, и реплеи прежних партий не сдвигаются.
 */
export function scheduleFlight(
  h: HandlerContext,
  strike: ShuttleStrike,
  at: number,
  type: 'shuttle.arrived' | 'shuttle.chase' | 'shuttle.patrol.tick',
): void {
  h.schedule(at, type, { strikeId: strike.id, ...(strike.orderSeq ? { orderSeq: strike.orderSeq } : {}) });
}

/** Вылет, к которому пришло событие, — или `null`, если события ждать некому: вылета нет
 *  (сбит, сел) или событие осталось от приказа, который игрок уже сменил (SHU-6.13). */
export function flightOf(h: HandlerContext, payload: unknown): ShuttleStrike | null {
  const { strikeId, orderSeq } = (payload ?? {}) as { strikeId?: unknown; orderSeq?: unknown };
  if (typeof strikeId !== 'string') return null;
  const strike = (h.state.strikes ?? []).find((st) => st.id === strikeId);
  if (!strike) return null;
  return (typeof orderSeq === 'number' ? orderSeq : 0) === (strike.orderSeq ?? 0) ? strike : null;
}

/** Один игровой час в миллисекундах мира — с учётом ускорения времени матча. */
export function hourMs(h: HandlerContext): number {
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
export function nextSquadronId(h: HandlerContext, owner: string): string {
  const seq = (h.state.squadronSeq ?? 0) + 1;
  h.state.squadronSeq = seq;
  return `sq:${owner}:${seq}`;
}

/** Эскадра базы по id — или отказ. Молчаливого «ничего не произошло» здесь быть не
 *  может: приказ по несуществующему соединению это ошибка, а не пустая операция. */
export function requireSquadron(h: HandlerContext, base: BaseView, id: unknown): Squadron {
  if (typeof id !== 'string') return h.reject('E_BAD_PAYLOAD');
  const sq = base.hangar.find((q) => q.id === id);
  if (!sq) return h.reject('E_NO_SQUADRON');
  return sq;
}

/** Свой ВЫЛЕТ по id — или отказ: все приказы эскадре в воздухе адресуют её одинаково.
 *  Чужой вылет и несуществующий — один ответ: чужие вылеты скрыты туманом
 *  (`visibleState`), и различимый отказ выдал бы перебором id, что сейчас в воздухе. */
export function ownStrike(h: HandlerContext, playerId: string, strikeId: unknown): ShuttleStrike {
  if (typeof strikeId !== 'string') return h.reject('E_BAD_PAYLOAD');
  const strike = (h.state.strikes ?? []).find((st) => st.id === strikeId);
  if (!strike || strike.owner !== playerId) return h.reject('E_NO_STRIKE');
  return strike;
}

/** Свой ПАТРУЛЬ по id вылета — или отказ: удержание бывает только у патруля. */
export function ownPatrol(h: HandlerContext, playerId: string, strikeId: string): ShuttleStrike {
  const strike = ownStrike(h, playerId, strikeId);
  if (strike.target.kind !== 'point') return h.reject('E_NOT_PATROLLING');
  return strike;
}

/** Эскадре в воздухе сменили приказ (SHU-6.13): события прежнего приказа больше не её. */
export function reorder(strike: ShuttleStrike): void {
  strike.orderSeq = (strike.orderSeq ?? 0) + 1;
}

/** Две половины соединения после дележа: `named` остаётся под прежним именем. */
type Halves = { named: Omit<Squadron, 'id'>; other: Omit<Squadron, 'id'> };

/**
 * ДЕЛЁЖ СОЕДИНЕНИЯ — одна арифметика на эскадру в ангаре (SHU-4.2) и на эскадру в воздухе
 * (SHU-6.13): копия у вылета разделила бы урон и десант иначе, чем ангар.
 *
 * **Позывной остаётся у БОЛЬШЕЙ половины** (дефолт кирпича): отделил двойку от десятки —
 * имя у восьмёрки, отделил восьмёрку — имя ушло с ней. Иначе имя следовало бы за тем, на
 * что игрок случайно нажал. Ничья — у исходной.
 *
 * **Груз делится, только если он однороден** (SHU-5.2): десантный челнок несёт ровно одного
 * бойца, и у эскадры, где все бойцы одного рода, ответ «кто уходит» однозначен — по бойцу
 * на уходящий борт. Смешанный трюм (после `shuttle.merge` разных десантов) делить нельзя:
 * кому достаётся танк, а кому пехотинец, модель не знает.
 */
export function divideSquadron(h: HandlerContext, squad: Flyer, raw: unknown): Halves {
  const hold = (squad.cargo ?? []).filter((st) => st.count > 0);
  if (hold.length > 1) return h.reject('E_HAS_CARGO');

  const want = parseStacks(h, raw);
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
  return goes > stay ? { named: movedPart, other: leftPart } : { named: leftPart, other: movedPart };
}

/** Следующий id вылета. Счётчик в состоянии, как у эскадр: id обязан выводиться
 *  одинаково на сервере и в реплее (инвариант детерминизма). */
export function nextStrikeId(h: HandlerContext, owner: string): string {
  const seq = (h.state.strikeSeq ?? 0) + 1;
  h.state.strikeSeq = seq;
  return `strike:${owner}:${h.ctx.now}:${seq}`;
}

/** Поставить вылету событие, которого ждёт его нога сейчас: тик патруля, пересчёт
 *  погони или прибытие. Нужно половине, отделённой в воздухе (SHU-6.13): у неё новый id,
 *  и события вылета, от которого она отделилась, её не найдут. */
export function scheduleLeg(h: HandlerContext, strike: ShuttleStrike): void {
  if (strike.leg === 'patrol') return schedulePatrolTick(h, strike);
  if (strike.leg === 'out' && strike.target.kind === 'fleet') return scheduleChase(h, strike);
  scheduleFlight(h, strike, strike.arrivesAt, 'shuttle.arrived');
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


/**
 * НАЗНАЧИТЬ СЛЕДУЮЩИЙ ПЕРЕСЧЁТ ПОГОНИ. Раз в час — но не позже, чем эскадра рассчитывает
 * дойти, и не чаще шага пересчёта: разбудить мир ради удара, который случится через
 * десять минут, дешевле, чем проспать его на пятьдесят.
 */
export function scheduleChase(h: HandlerContext, strike: ShuttleStrike): void {
  const hour = hourMs(h);
  const eta = Math.max(0, strike.arrivesAt - h.ctx.now);
  const wake = Math.min(CHASE_WAKE_HOURS * hour, Math.max((CHASE_STEP_MINUTES / 60) * hour, eta));
  scheduleFlight(h, strike, h.ctx.now + Math.max(1, Math.round(wake)), 'shuttle.chase');
}

/** Чем летят и что везут: эскадра в ангаре и вылет в воздухе одной формы (SHU-6.13) —
 *  проверки полёта и патруля читают у обоих одни и те же поля. */
export type Flyer = Pick<Squadron, 'units' | 'cargo' | 'damage'>;

/** Следующий тик патруля — через `PATROL_TICK_MINUTES`, но не позже конца патруля. */
export function schedulePatrolTick(h: HandlerContext, strike: ShuttleStrike): void {
  const tick = Math.max(1, Math.round((PATROL_TICK_MINUTES / 60) * hourMs(h)));
  scheduleFlight(h, strike, Math.min(h.ctx.now + tick, strike.arrivesAt), 'shuttle.patrol.tick');
}
