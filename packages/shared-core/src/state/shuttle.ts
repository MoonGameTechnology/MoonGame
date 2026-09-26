/**
 * Shuttle mechanics (shuttles-roadmap SQ-1.1/SQ-2.1/SQ-3.1) — the carrier-borne
 * strike wing's pure math: which stacks a fleet can launch, the sortie fuel/rearm
 * counter, and the strike-radius reach check. Was a 1:1 port of the prototype's
 * `shuttle.ts` — no numbers or semantics changed; since CONV-6 that copy is gone and
 * this is the only one, called by both hosts with an explicit `data`. The prototype's
 * client-side wing predicates (`isWing`/`wingCanAct`/`wingCanReturn`, REFM-135) did NOT
 * come here — they decide what to offer the player, not what the world does, and live
 * in `/decisions/wingOrders.ts`. NOT wired into a `fleet.launch` action or any
 * kernel module yet: that needs new GameState shape (where a launched wing's
 * `SortieState` lives) and touches the action/reducer pipeline, a separate,
 * riskier pass. `patrolTarget`/`scrambleOrder` (the auto-scramble driver, CC-4)
 * live in the prototype's `game.ts`, not `shuttle.ts` — out of scope here.
 */
import type { Fleet, GameState, Planet, Squadron, UnitStack } from './gameState';
import type { GameData } from '../data/schemas';
import { buildingLevel } from '../data/schemas';
import { addUnits, sumUnitStat } from '../util/stacks';

/** The shuttle-trait ship stacks aboard a fleet — what a carrier launches as a
 *  strike wing (SQ-1.1: launch-as-unit). Pure. */
export function shuttleTake(
  fleet: Fleet,
  data: GameData,
): Array<{ unit: string; count: number }> {
  return fleet.units
    .filter((st) => st.count > 0 && (data.units[st.unit]?.traits.includes('shuttle') ?? false))
    .map((st) => ({ unit: st.unit, count: st.count }));
}

/** A wing's sortie budget: `fuel` strikes left before rearm, `rearming` rounds left
 *  on the rearm cooldown (0 = flight-ready). */
export interface SortieState {
  fuel: number;
  rearming: number;
  /** Сколько мс перезарядки уже отстояно сверх целых часов (AUD-27). Ядро режет время на
   *  отрезки у каждого события, и во время боёв они короче часа: без остатка часы
   *  отрезков по отдельности давали бы ноль, и перезарядка стояла бы. Нет — 0. */
  carry?: number;
}

/**
 * Запас вылетов базы и длина перезарядки — по ПЕРВОЙ живой машине В ЕЁ АНГАРЕ
 * (дефолты схемы — нули).
 *
 * Читается именно ангар, и это не мелочь. Функция пережила модель, для которой
 * писалась: в старом «крыле» (снято целиком в SHU-2.2) челноки летали КАК ФЛОТ и лежали
 * в `fleet.units` — оттуда она их и брала. С SHU-1.1 челнок живёт в `hangar` базы, а в
 * `units` носителя стоит его КОРПУС, у которого никакого `fuel` нет. Продолжая смотреть
 * в старое место, функция отвечала «топлива 0» на ЛЮБОЙ носитель — и панель показывала
 * полный трюм сухим, а кнопку удара держала мёртвой. Ядро при этом считало верно своей
 * копией правила (`baseSortieSpec` в модуле челноков), так что расходились не правила,
 * а два чтения одного правила.
 *
 * Хост — любая база: и мир, и носитель. Форма ангара у них одна, поэтому и функция одна.
 */
export function sortieSpec(
  host: { hangar?: Squadron[] },
  data: GameData,
): { maxFuel: number; rearmRounds: number } {
  const st = hangarMachines(host).find((s) => s.count > 0);
  const u = st ? data.units[st.unit]?.stats : undefined;
  return {
    maxFuel: Math.max(0, Math.floor(u?.fuel ?? 0)),
    rearmRounds: Math.max(0, Math.floor(u?.rearmRounds ?? 0)),
  };
}

/** A fresh, fully-fuelled wing. */
export function freshSortie(maxFuel: number): SortieState {
  return { fuel: Math.max(0, Math.floor(maxFuel)), rearming: 0 };
}

/** Flight-ready = not mid-rearm and has fuel to burn. */
export function canSortie(s: SortieState): boolean {
  return s.rearming <= 0 && s.fuel > 0;
}

/** Burn one sortie. When the last of the fuel goes the wing drops onto a rearm
 *  cooldown of `rearmRounds` (unavailable until it counts back down). A spend
 *  while not flight-ready is a no-op — guard with canSortie first. */
export function spendSortie(s: SortieState, rearmRounds: number): SortieState {
  if (!canSortie(s)) return s;
  const fuel = s.fuel - 1;
  return fuel <= 0
    ? { fuel: 0, rearming: Math.max(1, Math.floor(rearmRounds)) }
    : { fuel, rearming: 0 };
}

/** Advance the rearm cooldown one round; when it elapses the wing refuels to max
 *  and is flight-ready again. A wing that isn't rearming is unchanged. */
export function tickRearm(s: SortieState, maxFuel: number): SortieState {
  if (s.rearming <= 0) return s;
  const rearming = s.rearming - 1;
  return rearming <= 0
    ? { fuel: Math.max(0, Math.floor(maxFuel)), rearming: 0 }
    : { fuel: s.fuel, rearming };
}

/** Does this fleet carry a launchable strike wing (shuttle-trait ships)? */
export function fleetHasShuttle(f: Fleet | undefined, data: GameData): boolean {
  return (
    !!f &&
    f.units.some((u) => u.count > 0 && (data.units[u.unit]?.traits.includes('shuttle') ?? false))
  );
}

/** The wing's strike radius (map units) — the longest `strikeRange` among its live
 *  shuttle ships. 0 = carries no strike wing. */
export function shuttleStrikeRange(fleet: Fleet, data: GameData): number {
  let r = 0;
  for (const st of fleet.units) {
    if (st.count > 0 && (data.units[st.unit]?.traits.includes('shuttle') ?? false)) {
      r = Math.max(r, data.units[st.unit]?.stats.strikeRange ?? 0);
    }
  }
  return r;
}

/** Is `target` within `range` (Euclidean map units) of `from`? Boundary inclusive —
 *  a target sitting exactly on the radius edge is reachable. */
export function withinRange(
  from: { x: number; y: number },
  target: { x: number; y: number },
  range: number,
): boolean {
  const dx = target.x - from.x;
  const dy = target.y - from.y;
  return Math.sqrt(dx * dx + dy * dy) <= range;
}

/** Can the wing strike `targetPos` from its launch node at `fromPos`? Only a real
 *  strike wing (range > 0) whose target lies inside the radius (SQ-3.1). */
export function shuttleReaches(
  fleet: Fleet,
  data: GameData,
  fromPos: { x: number; y: number },
  targetPos: { x: number; y: number },
): boolean {
  const r = shuttleStrikeRange(fleet, data);
  return r > 0 && withinRange(fromPos, targetPos, r);
}


// --- Ангар космопорта (SHU-1.1) ------------------------------------------------------
//
// Челнок не флот и не гарнизон: он стоит ВНУТРИ порта. `shuttleBay` порта — ворота:
// ноль значит «здесь челноки не держат», больше нуля — держат СКОЛЬКО УГОДНО (резолюция
// владельца 2026-09-26, SHU-5.1: космопорт без предела). Отдельного флага «умеет ангар»
// нет намеренно: два способа сказать одно и то же расходятся на первой же правке данных.

/** Сколько челноков вмещают СТОЯЩИЕ порты мира: Σ `shuttleBay` их текущих уровней.
 *  Разрушенное здание (`hp <= 0`) вместимости не даёт — его уже нет. */
export function shuttleBayAt(planet: Planet, data: GameData): number {
  let bay = 0;
  for (const b of planet.buildings) {
    if (b.hp <= 0) continue;
    const def = data.buildings[b.type];
    if (def) bay += buildingLevel(def, b.level).shuttleBay;
  }
  return bay;
}

/** Сколько МЕСТ занимает одна машина или один боец: `cargoSize` юнита (SHU-5.1). Трюм
 *  общий, и у шаттла, и у наземки место меряется одним числом — иначе два трюма в одном
 *  корпусе разошлись бы на первой правке данных. */
export function machineSize(unit: string, data: GameData): number {
  return data.units[unit]?.stats.cargoSize ?? 1;
}

/** Сколько мест занимают стеки: Σ count × `cargoSize`. */
export function stacksSize(stacks: readonly UnitStack[] | undefined, data: GameData): number {
  let n = 0;
  for (const st of stacks ?? []) if (st.count > 0) n += st.count * machineSize(st.unit, data);
  return n;
}

/** Сколько мест трюма занимает ангар базы: машины по своему `cargoSize` (SHU-5.1). */
export function hangarSize(host: { hangar?: Squadron[] }, data: GameData): number {
  let n = 0;
  for (const sq of host.hangar ?? []) n += stacksSize(sq.units, data);
  return n;
}

/** Места, которые держат за собой эскадры флота, УЛЕТЕВШИЕ в вылет (SHU-5.1): борт,
 *  выпустивший страйкера, обязан его принять, поэтому место не освобождается на время
 *  полёта. `except` — вылет, который как раз садится и своё место занимает сам. */
export function strikesReserved(
  state: GameState,
  fleetId: string,
  data: GameData,
  except?: string,
): number {
  let n = 0;
  for (const s of state.strikes ?? []) {
    if (s.base.kind !== 'fleet' || s.base.id !== fleetId || s.id === except) continue;
    n += stacksSize(s.units, data);
  }
  return n;
}

/** Сколько мест трюма флот может отдать шаттлам (SHU-5.1): общий трюм Σ `cargoCapacity`
 *  живых корпусов минус наземка на борту и минус обещанная погрузка. Отдельного ангара у
 *  корабля больше нет — шаттл едет в том же трюме, что и десант, и на одном месте они не
 *  помещаются вдвоём. Подбитый флот гибнет целыми корпусами, трюм падает сам, и лишних
 *  снимает та же `trimHangar`, что у порта. */
export function fleetShuttleBay(fleet: Fleet, data: GameData): number {
  let claimed = 0;
  for (const c of fleet.loading ?? []) claimed += c.count * machineSize(c.unit, data);
  return Math.max(
    0,
    sumUnitStat(fleet.units, data, 'cargoCapacity') - stacksSize(fleet.landing, data) - claimed,
  );
}

/** Свободные места трюма флота прямо сейчас: всё, что не занято наземкой, заявками на
 *  погрузку, эскадрами в ангаре и эскадрами в полёте (SHU-5.1). Этим числом меряют и
 *  погрузку десанта, и погрузку шаттлов — одно число на один трюм. */
export function fleetHoldFree(state: GameState, fleet: Fleet, data: GameData): number {
  return fleetShuttleBay(fleet, data) - hangarSize(fleet, data) - strikesReserved(state, fleet.id, data);
}

/** Все МАШИНЫ базы одним списком — ангар без деления на эскадры (SHU-4.2).
 *
 *  Половине читателей нужна не структура соединений, а ответ «что вообще стоит в этом
 *  порту»: вместимость, сводка мира, счётчик бота. Своя развёртка у каждого из них
 *  разъехалась бы с этой на первой же правке формы, поэтому она здесь одна. */
export function hangarMachines(host: { hangar?: Squadron[] }): UnitStack[] {
  const out: UnitStack[] = [];
  for (const sq of host.hangar ?? []) {
    for (const st of sq.units) if (st.count > 0) out.push(st);
  }
  return out;
}

/** Сколько машин в эскадре. */
export function squadronSize(sq: Squadron): number {
  return sq.units.reduce((n, st) => n + (st.count > 0 ? st.count : 0), 0);
}

/** Сколько мест ангара занято сейчас — у мира или у флота (форма ангара одна).
 *  Считаются МАШИНЫ, а не эскадры: место в порту занимает борт, а не соединение. */
export function hangarUsed(host: { hangar?: Squadron[] }): number {
  return (host.hangar ?? []).reduce((n, sq) => n + squadronSize(sq), 0);
}

/** Оставить в трюме не больше `n` бойцов, срезая с ХВОСТА (SHU-5.2): десантный челнок
 *  несёт ровно одного, поэтому погибший борт уносит своего бойца. Порядок фиксирован,
 *  как у самих машин (`trimHangar`), — «кого потеряли» не зависит от обхода объекта. */
export function trimCargo(cargo: readonly UnitStack[], n: number): UnitStack[] {
  let left = Math.max(0, Math.floor(n));
  const out: UnitStack[] = [];
  for (const st of cargo) {
    if (left <= 0) break;
    const keep = Math.min(st.count, left);
    left -= keep;
    if (keep > 0) out.push({ ...st, count: keep });
  }
  return out;
}

/** Сколько мест трюма занято сейчас. */
export function squadronCargoUsed(sq: Squadron): number {
  return (sq.cargo ?? []).reduce((n, st) => n + st.count, 0);
}

/** Дальность ЭСКАДРЫ — по САМОЙ КОРОТКОЙ руке (SHU-4.2). Соединение идёт целиком, и
 *  цель, до которой не дотянется одна машина, недосягаема для всех: максимум обещал бы
 *  удар, из которого часть эскадры не вернулась бы домой.
 *
 *  Живёт здесь, а не в модуле, ровно потому же, почему `shuttleBayAt` (SHU-3.1): по
 *  этому числу ядро отбивает `E_OUT_OF_RANGE`, и им же интерфейс рисует круг взведённого
 *  прицела. Своя копия формулы в клиенте разъехалась бы на первой правке данных, и игрок
 *  целился бы по одному радиусу, а вылет шёл бы по другому. */
export function squadronReach(sq: Squadron, data: GameData): number {
  let shortest = Infinity;
  for (const st of sq.units) {
    if (st.count <= 0) continue;
    shortest = Math.min(shortest, data.units[st.unit]?.stats.strikeRange ?? 0);
  }
  return Number.isFinite(shortest) ? shortest : 0;
}

/** Построенная (или севшая) машина встаёт в ПЕРВУЮ эскадру базы, где такой юнит уже
 *  есть, иначе заводит свою (SHU-4.2). Правило одно на весь ангар и держит две вещи
 *  сразу: шесть заказанных перехватчиков не превращаются в шесть эскадр по одному, а
 *  десантный борт не оказывается молча в ударном звене. Порядок обхода — порядок
 *  массива, то есть детерминирован. */
export function basedMachine(
  hangar: readonly Squadron[],
  unit: string,
  count: number,
  freshId: string,
  modules?: readonly string[],
  stars?: Record<string, number>,
  rarity?: Record<string, string>,
): Squadron[] {
  const out = hangar.map((q) => ({ ...q, units: q.units.map((st) => ({ ...st })) }));
  const home = out.find((q) => q.units.some((st) => st.unit === unit));
  if (home) {
    addUnits(home.units, unit, count, modules, stars, rarity);
    return out;
  }
  const fresh: Squadron = { id: freshId, units: [] };
  addUnits(fresh.units, unit, count, modules, stars, rarity);
  out.push(fresh);
  return out;
}

/** Десантный челнок встаёт в ангар ВМЕСТЕ со своим бойцом (SHU-5.2): челнок строится
 *  уже с наземным юнитом внутри, по одному на машину, и боец лежит в трюме эскадры.
 *  Встаёт он в первую эскадру, где ТОЛЬКО такие челноки и ТОЛЬКО такие бойцы, иначе
 *  заводит свою: смешанная эскадра не делится (`shuttle.split` не знает, чей боец
 *  на каком борту), а однородную можно делить поштучно. */
export function basedLander(
  hangar: readonly Squadron[],
  unit: string,
  count: number,
  troop: string,
  freshId: string,
): Squadron[] {
  const out = hangar.map((q) => ({
    ...q,
    units: q.units.map((st) => ({ ...st })),
    ...(q.cargo ? { cargo: q.cargo.map((c) => ({ ...c })) } : {}),
  }));
  const home = out.find(
    (q) =>
      q.units.length > 0 &&
      q.units.every((st) => st.unit === unit) &&
      (q.cargo ?? []).length > 0 &&
      (q.cargo ?? []).every((c) => c.unit === troop),
  );
  if (home) {
    addUnits(home.units, unit, count);
    addUnits((home.cargo ??= []), troop, count);
    return out;
  }
  out.push({ id: freshId, units: [{ unit, count }], cargo: [{ unit: troop, count }] });
  return out;
}

/** Обрезать ангар до вместимости `bay`, начиная с ХВОСТА: раньше построенное переживает
 *  потерю порта, позже построенное гибнет первым. Порядок здесь — не вкус, а инвариант
 *  детерминизма: «лишние гибнут» обязано давать один и тот же результат на сервере и в
 *  реплее, поэтому правило фиксировано и не зависит от обхода объекта.
 *
 *  С эскадрами хвост считается СКВОЗНЫМ (SHU-4.2): сначала гибнут машины последней
 *  эскадры, и только когда она опустела — предыдущей. Опустевшая эскадра исчезает
 *  вместе с последней машиной: соединение без бортов — не соединение, а имя. ТРЮМ
 *  гибнет вместе с бортами — по бойцу на погибший борт (SHU-5.2). */
export function trimHangar(hangar: readonly Squadron[], bay: number, data: GameData): Squadron[] {
  // Места, а не штуки (SHU-5.1): тяжёлый страйкер занимает два. Машина, которой не
  // хватает мест целиком, гибнет целиком — половины борта не бывает.
  let left = bay === Infinity ? Infinity : Math.max(0, Math.floor(bay));
  const out: Squadron[] = [];
  for (const sq of hangar) {
    if (left <= 0) break;
    const units: UnitStack[] = [];
    for (const st of sq.units) {
      if (left <= 0) break;
      const size = machineSize(st.unit, data);
      const keep = size > 0 ? Math.min(st.count, Math.floor(left / size)) : st.count;
      left -= keep * size;
      if (keep > 0) {
        units.push({ ...st, count: keep, ...(st.modules ? { modules: [...st.modules] } : {}) });
      }
      // Хвост сквозной: не влезла машина — не влезает и всё, что стоит за ней, даже
      // если там борт поменьше. Иначе порядок гибели зависел бы от размеров, а не от
      // очереди постройки.
      if (keep < st.count) left = 0;
    }
    if (units.length === 0) continue;
    // Боец едет на своём борту (SHU-5.2): сколько бортов осталось, столько и бойцов.
    const cargo = sq.cargo ? trimCargo(sq.cargo, squadronSize({ id: sq.id, units })) : [];
    const { cargo: _old, ...bare } = sq;
    out.push({ ...bare, units, ...(cargo.length > 0 ? { cargo } : {}) });
  }
  return out;
}
