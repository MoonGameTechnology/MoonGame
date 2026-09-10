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
import type { Fleet, Planet, Squadron, UnitStack } from './gameState';
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
}

/** The wing's max sortie budget + rearm length, read from its shuttle unit's
 *  stats (schema defaults 0). Reads the FIRST shuttle-trait stack of the fleet. */
export function sortieSpec(
  fleet: Fleet,
  data: GameData,
): { maxFuel: number; rearmRounds: number } {
  const st = fleet.units.find(
    (s) => s.count > 0 && (data.units[s.unit]?.traits.includes('shuttle') ?? false),
  );
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
// Челнок не флот и не гарнизон: он стоит ВНУТРИ порта. Поэтому вместимость порта — сразу
// и гейт («можно ли здесь вообще держать челноки»), и предел («сколько»). Отдельного
// флага «умеет ангар» нет намеренно: порт, вмещающий ноль, ничем не отличается от
// отсутствующего, а два способа сказать одно и то же расходятся на первой же правке
// данных.

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

/** Сколько челноков базируется на флоте: Σ `shuttleBay` его ЖИВЫХ корпусов (SHU-2.1).
 *  Носитель — мобильный космопорт, поэтому вместимость считается тем же способом, что у
 *  мира, только слагаемые берутся у кораблей. Порога повреждения у носителя нет и не
 *  нужно: подбитый носитель гибнет целыми корпусами, вместимость падает сама, и лишние
 *  челноки снимает та же `trimHangar`, что у порта. */
export function fleetShuttleBay(fleet: Fleet, data: GameData): number {
  return sumUnitStat(fleet.units, data, 'shuttleBay');
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

/** Сколько наземных войск поднимет эскадра: Σ `cargoCapacity` её машин (ROS-1.5). */
export function squadronCargoCapacity(sq: Squadron, data: GameData): number {
  return sumUnitStat(sq.units, data, 'cargoCapacity');
}

/** Сколько мест трюма занято сейчас. */
export function squadronCargoUsed(sq: Squadron): number {
  return (sq.cargo ?? []).reduce((n, st) => n + st.count, 0);
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
): Squadron[] {
  const out = hangar.map((q) => ({ ...q, units: q.units.map((st) => ({ ...st })) }));
  const home = out.find((q) => q.units.some((st) => st.unit === unit));
  if (home) {
    addUnits(home.units, unit, count, modules);
    return out;
  }
  const fresh: Squadron = { id: freshId, units: [] };
  addUnits(fresh.units, unit, count, modules);
  out.push(fresh);
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
 *  гибнет вместе со своей эскадрой — войска стояли на её бортах. */
export function trimHangar(hangar: readonly Squadron[], bay: number): Squadron[] {
  let left = Math.max(0, Math.floor(bay));
  const out: Squadron[] = [];
  for (const sq of hangar) {
    if (left <= 0) break;
    const units: UnitStack[] = [];
    for (const st of sq.units) {
      if (left <= 0) break;
      const keep = Math.min(st.count, left);
      left -= keep;
      units.push({ ...st, count: keep, ...(st.modules ? { modules: [...st.modules] } : {}) });
    }
    if (units.length === 0) continue;
    out.push({ ...sq, units, ...(sq.cargo ? { cargo: sq.cargo.map((c) => ({ ...c })) } : {}) });
  }
  return out;
}
