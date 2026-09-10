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
 *    чем на 30% — не выпускает), возврат идёт в него же, а не стало порта — челноки
 *    гибнут вместе с ним. Топливо и перезарядка тоже принадлежат порту.
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
import { hasMapShare } from '../state/diplomacy';
import { isCapturable } from '../state/sectorKind';
import {
  canSortie,
  fleetShuttleBay,
  hangarMachines,
  hangarUsed,
  freshSortie,
  shuttleBayAt,
  spendSortie,
  squadronCargoCapacity,
  squadronCargoUsed,
  squadronSize,
  tickRearm,
  trimHangar,
} from '../state/shuttle';
import { applyDamageToSide, isAllied, removeIfWiped } from '../util/combat';
import { requireOwnedIdleFleet } from '../util/fleet';
import { addUnits, cappedUnitStat, findHealthyStack, sumUnitStat } from '../util/stacks';
import { buildingLevel } from '../data/schemas';
import { timeScaleOf } from '../action/types';
import { MS_PER_HOUR } from '../util/time';

/** Total point-defense (anti-shuttle/anti-missile) firepower of a fleet —
 *  Σ the `pointDefense` stat of its live units (via effectiveStats, so modules
 *  are included). 0 = no point defense. */
function fleetPointDefense(fleet: Fleet, data: GameData): number {
  return sumUnitStat(fleet.units, data, 'pointDefense');
}

/** Σ the `pointDefense` of a planet's standing buildings — ЗОНАЛЬНОЕ ПВО мира
 *  (ROS-2.2). Считается ровно как ПКО в `orbital.ts` (`aaOrbitalAt`): по уровню
 *  постройки, без гарнизона. Гарнизон сюда не входит намеренно — по заказу владельца
 *  зональное ПВО это ЗДАНИЕ и модуль корабля, а не свойство наземных войск. */
function planetPointDefense(planet: Planet, data: GameData): number {
  let total = 0;
  for (const b of planet.buildings) {
    const def = data.buildings[b.type];
    if (def) total += buildingLevel(def, b.level).pointDefense;
  }
  return total;
}

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
  hangar: Squadron[];
  setHangar: (next: Squadron[]) => void;
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

/**
 * Перевести УРОН по вылету в СБИТЫЕ МАШИНЫ по корпусу челнока, накопив остаток.
 *
 * У вылета нет своего пула здоровья — и не должно быть: иначе половина сбитого крыла
 * жила бы «раненой» в состоянии, которого игрок не видит. Недобор до корпуса копится на
 * самом вылете и досчитывается следующим залпом, поэтому три канала (зональное ПВО на
 * трассе, перехват, ответка в момент удара) обязаны считать ОДИНАКОВО — счёт живёт здесь
 * в одном экземпляре, а не тремя копиями по месту.
 */
function absorbIntoStrike(strike: ShuttleStrike, damage: number, data: GameData): number {
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

/** Записать в ангар изменённую эскадру; опустевшая ИСЧЕЗАЕТ — соединение без бортов
 *  это не соединение, а имя. */
function putSquadron(base: BaseView, next: Squadron): void {
  base.setHangar(
    base.hangar.flatMap((q) => (q.id !== next.id ? [q] : squadronSize(next) > 0 ? [next] : [])),
  );
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
  target: { id: string; owner: string | null; location: string },
): void {
  if (amount <= 0) return;
  const dealt = h.hook<number>('combat.damage', amount, {
    phase: 'returnFire',
    location: target.location,
    attacker: target.owner ?? '',
    defender: strike.owner,
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
 * Урезать груз до того, что довезли УЦЕЛЕВШИЕ машины (ROS-1.5).
 *
 * Сбитая машина уносит свою долю трюма — иначе зональное ПВО выбивало бы конвой, а на
 * землю всё равно сходил бы полный десант, и оборона против высадки ничего не решала бы.
 * Режем с хвоста тем же порядком, что и сами машины (`shootDownStrike`): порядок
 * детерминирован, а «кого именно потеряли» игрок всё равно видит числом, а не списком.
 */
function trimCargoToSurvivors(strike: ShuttleStrike, data: GameData): void {
  const cargo = strike.cargo ?? [];
  if (cargo.length === 0) return;
  let room = 0;
  for (const st of strike.units) {
    room += (data.units[st.unit]?.stats.cargoCapacity ?? 0) * st.count;
  }
  let used = 0;
  for (const st of cargo) used += (data.units[st.unit]?.stats.cargoSize ?? 0) * st.count;
  for (let i = cargo.length - 1; i >= 0 && used > room; i--) {
    const st = cargo[i]!;
    const size = data.units[st.unit]?.stats.cargoSize ?? 0;
    if (size <= 0) continue;
    const drop = Math.min(st.count, Math.ceil((used - room) / size));
    st.count -= drop;
    used -= drop * size;
  }
  strike.cargo = cargo.filter((st) => st.count > 0);
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
function landCargo(h: HandlerContext, strike: ShuttleStrike, planet: Planet): void {
  const cargo = (strike.cargo ?? []).filter((st) => st.count > 0);
  const owner = strike.owner;
  const friendly =
    planet.owner === owner ||
    (planet.owner !== null &&
      (isAllied(h, owner, planet.owner) || hasMapShare(h.state, owner, planet.owner)));
  let landed = cargo;
  let mode: 'reinforce' | 'capture' | 'beachhead' | 'lost' = 'lost';

  if (cargo.length === 0) {
    mode = 'lost';
  } else if (friendly) {
    for (const st of cargo) addUnits(planet.garrison, st.unit, st.count);
    mode = 'reinforce';
  } else if (planet.beachhead?.owner === owner) {
    // Свой плацдарм уже на земле — подкрепление в идущий бой. Ссылка стороны адресует
    // МИР, а не снимок стеков, поэтому подошедшие войска считаются со следующего раунда.
    for (const st of cargo) addUnits(planet.beachhead.units, st.unit, st.count);
    mode = 'beachhead';
  } else if (planet.beachhead || groundBattleAt(h, planet.id)) {
    landed = []; // за мир дерётся другой — садиться некуда
  } else if (!isCapturable(h.ctx.data, planet)) {
    landed = []; // пустое пространство не занимают пехотой
  } else if (!planet.garrison.some((st) => st.count > 0)) {
    const previous = planet.owner;
    planet.owner = owner;
    planet.garrison = cargo.map((st) => ({ ...st }));
    h.emit('planet.captured', {
      planetId: planet.id,
      owner,
      by: planet.id,
      from: previous,
      via: 'assault',
    });
    mode = 'capture';
  } else {
    planet.beachhead = { owner, units: cargo.map((st) => ({ ...st })) };
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

/** Откуда десантный вылет берёт груз: у мира это гарнизон, у носителя — его десант.
 *  Обе стороны уже существуют в модели (`army.load` возит войска ровно между ними), и
 *  третьего хранилища кирпич не заводит. */
function troopSource(state: GameState, base: BaseView): UnitStack[] | null {
  if (base.ref.kind === 'planet') return state.planets[base.ref.id]?.garrison ?? null;
  const fleet = state.fleets[base.ref.id];
  return fleet ? (fleet.landing ?? []) : null;
}

function setTroopSource(state: GameState, base: BaseView, units: UnitStack[]): void {
  if (base.ref.kind === 'planet') {
    const planet = state.planets[base.ref.id];
    if (planet) planet.garrison = units;
    return;
  }
  const fleet = state.fleets[base.ref.id];
  if (fleet) fleet.landing = units;
}

/**
 * Проверить заявленный груз и собрать его стеки (ROS-1.5). Ничего не меняет — только
 * отвечает «можно» или кодом отказа, потому что fail-secure требует отбить приказ до
 * первой правки состояния.
 *
 * Три границы, и все три — существующие правила, а не новые: грузом бывает ТОЛЬКО
 * наземный юнит (как у `army.load`), его должно хватать в источнике, и он обязан
 * влезть в `cargoCapacity` вылета — тот же стат, которым меряется трюм корабля.
 */
function loadTroops(
  h: HandlerContext,
  base: BaseView,
  troops: ReadonlyArray<{ unit: string; count: number }>,
  capacity: number,
): { units: UnitStack[] } | { code: string } {
  if (troops.length === 0) return { units: [] };
  const source = troopSource(h.state, base);
  if (!source) return { code: 'E_NO_ARMY' };
  const units: UnitStack[] = [];
  let used = 0;
  for (const want of troops) {
    const def = h.ctx.data.units[want.unit];
    if (!def) return { code: 'E_UNKNOWN_UNIT' };
    if (def.domain !== 'ground') return { code: 'E_NOT_GROUND' };
    const stack = findHealthyStack(source, want.unit);
    if (!stack || stack.count < want.count) return { code: 'E_NO_ARMY' };
    used += want.count * def.stats.cargoSize;
    addUnits(units, want.unit, want.count);
  }
  if (used > capacity) return { code: 'E_NO_CAPACITY' };
  return { units };
}

/** Снять погруженное с базы. Отдельным шагом после всех проверок: до этой строки
 *  состояние не тронуто, и любой отказ выше не оставляет за собой полугрузки. */
function takeCargoFromBase(h: HandlerContext, base: BaseView, cargo: readonly UnitStack[]): void {
  if (cargo.length === 0) return;
  const source = troopSource(h.state, base);
  if (!source) return;
  const left = source.map((st) => ({ ...st }));
  for (const st of cargo) {
    const from = findHealthyStack(left, st.unit);
    if (from) from.count -= st.count;
  }
  setTroopSource(
    h.state,
    base,
    left.filter((st) => st.count > 0),
  );
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
  // Носитель обязан СТОЯТЬ у узла и быть свободен (`E_FLEET_BUSY` — бой, перелёт или
  // стоянка на лейне): порт не двигается, и вылет с разгоняющегося носителя пришлось
  // бы догонять — вторая ветка правил в самом горячем месте ядра. Возврату это не
  // мешает: носитель волен уйти, пока челноки летят.
  const fleet = requireOwnedIdleFleet(h, p.fleetId as string, playerId);
  return fleetBase(fleet, h.state, h.ctx.data);
}

/** Скорость соединения — самая медленная машина в нём: летят вместе, не порознь. */
function slowestSpeed(units: readonly UnitStack[], data: GameData): number {
  let slowest = Infinity;
  for (const st of units) {
    if (st.count <= 0) continue;
    slowest = Math.min(slowest, data.units[st.unit]?.stats.speed ?? 0);
  }
  return Number.isFinite(slowest) ? slowest : 0;
}

/** Дальность ЭСКАДРЫ — по самой короткой руке (SHU-4.2). Тот же довод, что у скорости:
 *  соединение идёт целиком, и цель, до которой не дотянется одна машина, недосягаема
 *  для всех. Максимум обещал бы удар, из которого часть эскадры не вернулась бы домой. */
function squadronReach(sq: Squadron, data: GameData): number {
  let shortest = Infinity;
  for (const st of sq.units) {
    if (st.count <= 0) continue;
    shortest = Math.min(shortest, data.units[st.unit]?.stats.strikeRange ?? 0);
  }
  return Number.isFinite(shortest) ? shortest : 0;
}

/** Скорость вылета — самая медленная машина в нём. */
function strikeSpeed(strike: ShuttleStrike, data: GameData): number {
  return slowestSpeed(strike.units, data);
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
        squadronId?: string;
        targetFleetId?: string;
        targetPlanetId?: string;
      };
      const base = baseFromPayload(h, action.playerId, p ?? {});

      // База: есть, цела и с топливом. Порог повреждения — на ВЫЛЕТ (правило владельца);
      // возврату он не мешает, иначе челнок повис бы в пустоте. У носителя порога нет:
      // подбитый носитель теряет корпуса, вместимость падает сама.
      //
      // Проверяется РАНЬШЕ эскадры намеренно: «этот флот вообще не база» — более точный
      // ответ, чем «в нём нет такого соединения», а у обычного корабля его и не бывает.
      if (base.bay <= 0) return h.reject('E_NO_PORT');
      if (base.disabled) return h.reject('E_PORT_DAMAGED');
      const squad = requireSquadron(h, base, p?.squadronId);
      if (squadronSize(squad) <= 0) return h.reject('E_NOT_ENOUGH');

      const spec = baseSortieSpec(base, h.state, h.ctx.data);
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

      const from = base.position;
      if (!from) return h.reject('E_NO_PORT'); // носитель без позиции (в перелёте) — не база
      const to = targetFleet
        ? (fleetWorldPos(targetFleet, h.state) ?? null)
        : (targetPlanet?.position ?? null);
      if (!to) return h.reject('E_NO_TARGET_POSITION');

      // Радиус считается ОТ УЗЛА БАЗИРОВАНИЯ: своей позиции у челнока в ангаре нет.
      // У СОЕДИНЕНИЯ он по САМОЙ КОРОТКОЙ руке (SHU-4.2) — как и скорость по самой
      // медленной машине: эскадра идёт вместе, и дальность у неё общая.
      const range = squadronReach(squad, h.ctx.data);
      if (range <= 0) return h.reject('E_NO_RANGE');
      if (distance(from, to) > range) return h.reject('E_OUT_OF_RANGE');

      const speed = slowestSpeed(squad.units, h.ctx.data);
      if (speed <= 0) return h.reject('E_NO_SPEED');
      const flightMs = Math.max(1, Math.round((distance(from, to) / speed) * hourMs(h)));

      // Эскадра покидает ангар ЦЕЛИКОМ — с этой секунды её в базе нет. Груз уже в
      // трюме (SHU-4.2), брать с базы нечего: он ушёл из гарнизона при погрузке.
      base.setHangar(base.hangar.filter((q) => q.id !== squad.id));
      base.setSortie(spendSortie(sortie, spec.rearmRounds));
      const seq = (h.state.strikeSeq ?? 0) + 1;
      h.state.strikeSeq = seq;
      const strike: ShuttleStrike = {
        id: `strike:${action.playerId}:${h.ctx.now}:${seq}`,
        owner: action.playerId,
        base: base.ref,
        squadronId: squad.id,
        units: squad.units.map((st) => ({ ...st })),
        target: targetFleet
          ? { kind: 'fleet', id: targetFleet.id }
          : { kind: 'planet', id: targetPlanet!.id },
        to,
        departedAt: h.ctx.now,
        arrivesAt: h.ctx.now + flightMs,
        leg: 'out',
        ...(cargo.length > 0 ? { cargo: cargo.map((st) => ({ ...st })) } : {}),
      };
      h.state.strikes = [...(h.state.strikes ?? []), strike];
      h.schedule(strike.arrivesAt, 'shuttle.arrived', { strikeId: strike.id });
      h.emit('shuttle.launched', {
        strikeId: strike.id,
        owner: action.playerId,
        from: base.ref.id,
        fromKind: base.ref.kind,
        count: squadronSize(squad),
      });
    });

    /**
     * `shuttle.split { planetId | fleetId, squadronId, units: [{unit,count}] }` —
     * отделить машины в НОВУЮ эскадру той же базы (SHU-4.2).
     *
     * **Позывной остаётся у БОЛЬШЕЙ половины** (дефолт кирпича): отделил двойку от
     * десятки — имя у восьмёрки, отделил восьмёрку — имя ушло с ней. Иначе имя
     * следовало бы за тем, на что игрок случайно нажал. Ничья — у исходной.
     *
     * **Эскадру с грузом делить нельзя.** Делёж трюма — правило, которого в модели нет
     * и которое пришлось бы выдумывать (кому достаётся взвод, если бортов поровну?).
     * Выгрузи, раздели, погрузи заново — три понятных шага вместо одного гадания.
     */
    api.onAction('shuttle.split', (action, h: HandlerContext) => {
      const p = (action.payload ?? {}) as { squadronId?: unknown; units?: unknown };
      const base = baseFromPayload(h, action.playerId, p as Record<string, unknown>);
      const squad = requireSquadron(h, base, p.squadronId);
      if (squadronCargoUsed(squad) > 0) return h.reject('E_HAS_CARGO');

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
      const keepsName = goes > stay ? moved : left;
      const named: Squadron = { id: squad.id, units: keepsName };
      const other: Squadron = { id: freshId, units: keepsName === moved ? left : moved };
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
      for (const st of from.units) addUnits(units, st.unit, st.count, st.modules);
      const cargo = (into.cargo ?? []).map((st) => ({ ...st }));
      for (const st of from.cargo ?? []) addUnits(cargo, st.unit, st.count);
      const merged: Squadron = { id: into.id, units, ...(cargo.length > 0 ? { cargo } : {}) };
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
     * `shuttle.loadTroops { planetId | fleetId, squadronId, troops: [{unit,count}] }` —
     * погрузить наземные войска в трюм ЗАРАНЕЕ (SHU-4.2, заказ владельца).
     *
     * До этого кирпича груз брали с базы в момент вылета, и до вылета трюма не
     * существовало вовсе: собрать десант и подержать его наготове было нельзя. Теперь
     * войска ПОКИДАЮТ ГАРНИЗОН СРАЗУ — иначе тот же взвод числился бы и в обороне мира,
     * и в трюме, и два приказа послали бы его дважды.
     */
    api.onAction('shuttle.loadTroops', (action, h: HandlerContext) => {
      const p = (action.payload ?? {}) as { squadronId?: unknown; troops?: unknown };
      const base = baseFromPayload(h, action.playerId, p as Record<string, unknown>);
      const squad = requireSquadron(h, base, p.squadronId);
      const want = parseStacks(h, p.troops);
      const free = squadronCargoCapacity(squad, h.ctx.data) - squadronCargoUsed(squad);
      const loaded = loadTroops(h, base, want, free);
      if ('code' in loaded) return h.reject(loaded.code);

      const cargo = (squad.cargo ?? []).map((st) => ({ ...st }));
      for (const st of loaded.units) addUnits(cargo, st.unit, st.count);
      putSquadron(base, { ...squad, cargo });
      takeCargoFromBase(h, base, loaded.units);
      h.emit('squadron.loaded', {
        baseId: base.ref.id,
        baseKind: base.ref.kind,
        owner: action.playerId,
        squadronId: squad.id,
      });
    });

    /**
     * `shuttle.unloadTroops { planetId | fleetId, squadronId, troops? }` — ссадить трюм
     * обратно. Приказ без обратного хода запер бы войска в трюме до вылета, а вылет
     * десантный одноразовый — то есть навсегда.
     *
     * `troops` НЕОБЯЗАТЕЛЕН, и это не удобство: интерфейс (SHU-4.3) считает погрузку и
     * выгрузку ОДНИМ знаковым планом на строку («+2 взять, −1 ссадить»), и «всё или
     * ничего» им не выразить — кнопка обещала бы игроку то, чего ядро не умеет. Без
     * списка ссаживается весь трюм: это и есть «выгрузить всё» одним тапом.
     */
    api.onAction('shuttle.unloadTroops', (action, h: HandlerContext) => {
      const p = (action.payload ?? {}) as { squadronId?: unknown; troops?: unknown };
      const base = baseFromPayload(h, action.playerId, p as Record<string, unknown>);
      const squad = requireSquadron(h, base, p.squadronId);
      const aboard = (squad.cargo ?? []).filter((st) => st.count > 0);
      if (aboard.length === 0) return h.reject('E_NO_ARMY');
      // Заявка проверяется ЦЕЛИКОМ до первой правки состояния (fail-secure): половина
      // ссаженного взвода при отказе второй половины — это молча испорченный трюм.
      const cargo = p.troops === undefined ? aboard : parseStacks(h, p.troops);
      let left: UnitStack[] = aboard.map((st) => ({ ...st }));
      for (const want of cargo) {
        const next = takeMachines(left, want.unit, want.count);
        if (!next) return h.reject('E_NO_ARMY');
        left = next;
      }
      const source = troopSource(h.state, base);
      if (!source) return h.reject('E_NO_ARMY');
      const back = source.map((st) => ({ ...st }));
      for (const st of cargo) addUnits(back, st.unit, st.count);
      setTroopSource(h.state, base, back);
      // Пустой трюм — ОТСУТСТВИЕ поля, а не ключ со значением `undefined`: состояние
      // хранится как JSONB, и «пустой ключ» пережил бы только один рейс до базы.
      const { cargo: _gone, ...bare } = squad;
      putSquadron(base, left.length > 0 ? { ...bare, cargo: left } : bare);
      h.emit('squadron.unloaded', {
        baseId: base.ref.id,
        baseKind: base.ref.kind,
        owner: action.playerId,
        squadronId: squad.id,
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
      if (squadronSize(squad) > freeSpace) return h.reject('E_NO_CAPACITY');
      from.hangar = (from.hangar ?? []).filter((q) => q.id !== squadronId);
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
        fleetShuttleBay(fleet, h.ctx.data) - hangarUsed(fleet),
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
        shuttleBayAt(planet, h.ctx.data) - hangarUsed(planet),
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

      if (strike.leg === 'out') {
        const power = strikePower(strike, h.ctx.data, strike.target.kind);
        if (strike.target.kind === 'fleet') {
          const target = h.state.fleets[strike.target.id];
          // Цель ушла с точки удара — челноки бьют пустоту и возвращаются ни с чем.
          if (target && target.owner !== strike.owner) {
            // Ответка считается ДО удара, из того же снимка: цель, которую этот залп
            // добьёт, всё равно успевает огрызнуться — та же одновременность, что у
            // артиллерии, где залпы считаются из состояния до отрезка.
            const answer = returnFireAgainstFleet(target, h.ctx.data);
            if (power > 0) {
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
            repelStrike(h, strike, answer, {
              id: strike.target.id,
              owner: target.owner,
              location: target.location ?? '',
            });
          }
        } else {
          const target = h.state.planets[strike.target.id];
          if (target && target.owner !== strike.owner) {
            const answer = planetPointDefense(target, h.ctx.data);
            if (power > 0) {
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
            repelStrike(h, strike, answer, {
              id: target.id,
              owner: target.owner,
              location: target.id,
            });
          }
        }
        // Волна, которую ответка сбила целиком, домой не летит и в состоянии не остаётся.
        if (strike.units.length === 0) {
          h.state.strikes = strikes.filter((st) => st.id !== strikeId);
          return;
        }
        // ДЕСАНТНЫЙ ВЫЛЕТ (ROS-1.5) одноразовый: груз сходит на землю, машины остаются
        // там же. Обратной ноги у него нет вовсе — это не удар с возвратом, а высадка.
        if (strike.cargo !== undefined) {
          const target = h.state.planets[strike.target.id];
          if (target) {
            trimCargoToSurvivors(strike, h.ctx.data);
            landCargo(h, strike, target);
          }
          h.state.strikes = strikes.filter((st) => st.id !== strikeId);
          return;
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
      // Эскадра встаёт в ангар ПОД СВОИМ ИМЕНЕМ (SHU-4.2): она уходила соединением и
      // возвращается им же. Если её id за время полёта занят (перегрузка, слияние —
      // ангар живёт своей жизнью, пока машины летят), соединение садится под свежим,
      // потому что двух эскадр с одним именем в модели быть не может.
      const taken = base.hangar.some((q) => q.id === strike.squadronId);
      const home: Squadron = {
        id: taken ? nextSquadronId(h, strike.owner) : strike.squadronId,
        units: strike.units.map((st) => ({ ...st })),
      };
      base.setHangar(trimHangar([...base.hangar, home], bay));
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
        ...Object.values(h.state.fleets).map((fleet) => fleetBase(fleet, h.state, data)),
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

        const dealt = h.hook<number>('combat.damage', power, {
          phase: 'intercept',
          location: base.ref.kind === 'planet' ? base.ref.id : '',
          attacker: base.owner,
          defender: target.owner,
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
        const spec = baseSortieSpec(base, h.state, h.ctx.data);
        let next = sortie;
        for (let i = 0; i < hours && next.rearming > 0; i++) next = tickRearm(next, spec.maxFuel);
        base.setSortie(next);
      }
    });

  },
};