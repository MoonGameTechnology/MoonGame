/**
 * ВЫЛЕТ ЧЕЛНОКОВ В ХОДЕ БОТА (SLIM-3): погрузка на носитель, базы вылета, высадка, удар
 * страйкером, перелёт к фронту и патруль над базами — в прежнем порядке.
 */
import {
  getStance,
  fleetPositionAt,
  fleetHoldFree,
  fleetShuttleBay,
  shuttleBayAt,
  squadronReach,
  stacksSize,
  squadronSize,
  isMineFleet,
  mineFleetVisible,
  type Action,
  type Squadron,
  type StrikeBase,
  type Fleet,
  type Planet,
} from '../../../packages/shared-core/src/index';
import { fleetHangarRepairRate } from '../../../packages/shared-core/src/util/repair';
import { identifiedNodes, isVisibleTo } from '../../../packages/shared-core/src/state/visibility';
import {
  strikeShuttle,
  loadShuttle,
  patrolShuttle,
  holdPatrol,
  releaseHold,
  relocateShuttle,
} from '../../../decisions/actions';
import { freshIntel, knownGarrison } from '../../../decisions/garrisonIntel';
import { planDrop } from '../../../decisions/dropPlan';
import { pickHoldFleet } from '../../../decisions/holdPick';
import { holdsPatrol } from '../../../decisions/patrolMarks';
import { frontRebase } from '../../../decisions/frontRebase';
import { isLander } from '../../../decisions/landerTroops';
import { canOrder } from '../protoKernel';
import { data } from '../gameData';
import { STRIKE_SHUTTLES } from './rules';
import type { HomeTurn } from './home';
import type { AiTurn } from './turn';

/** Ударные машины вылета «по корпусам и мирам» — в порядке дальности: тяжёлый достаёт
 *  дальше, поэтому поднимается первым; нечем или некого — очередь ударного. */
const STRIKERS = ['heavy_striker', 'bomber'] as const;
/** Кем бот держит патруль над своей базой (SHU-6.8): перехватчиками. Патруль бьёт и
 *  флоты, и чужие вылеты, но ударные машины нужнее в ударе с базы у фронта, а дело
 *  перехватчика — чужие вылеты, которые идут к его базе. */
const PATROL_WING = ['interceptor'] as const;

type Point = { x: number; y: number };

/** База вылета: свой мир с ангаром или свой корабль с трюмом (SHU-6.8). */
interface Launchpad {
  key: string;
  ref: StrikeBase;
  base: { planetId: string } | { fleetId: string };
  at: Point;
  hangar: Squadron[];
}

/** Флот, в трюм которого в этот тик грузится эскадра из порта (`loadCarrier`). */
type HoldPick = { readonly id: string; readonly squadronId: string } | undefined;

/** Общее для вылетов одного тика: базы, цели и что уже занято приказами. */
interface Sorties {
  readonly holdPick: HoldPick;
  /** Базы, с которых в этот тик уже был вылет (топливо у базы общее). */
  readonly launched: Set<string>;
  /** Эскадры, которым в этот тик уже отдан приказ. */
  readonly taken: Set<string>;
  readonly basePos: (b: StrikeBase) => Point | null;
  readonly launchpads: Launchpad[];
  readonly reachOf: (unit: string) => number;
  readonly nearestBy: <T extends { id: string }>(
    xs: T[],
    from: Point,
    at: (x: T) => Point,
  ) => T | undefined;
  readonly identified: Set<string>;
  readonly ownNearOrbit: Set<string>;
  readonly foeFleetAt: Set<string>;
  readonly foeFleets: Fleet[];
  readonly foeFleetPos: (fl: Fleet) => Point;
  readonly foeWorlds: Planet[];
  readonly freeSquads: (hangar: Squadron[], unit: string) => Squadron[];
}

// ═══ ВЫЛЕТ ЧЕЛНОКОВ (SHU-3.2) ═══
// Без этого правила весь пласт челноков не участвовал в замерах ВООБЩЕ: бот их
// строил, они ложились в порт и лежали там до конца матча. Ни удара, ни ответки
// (ROS-2.2), ни зонального ПВО, ни высадки плацдарма (ROS-1.5) отчёт не видел.
//
// Правило нарочно короткое, той же формы, что и постройка: ОДИН вылет с порта за
// тик (топливо у порта общее, вторым приказом его не растянуть), цель — БЛИЖАЙШАЯ
// в радиусе, тай-брейк по id. Ближайшая, а не «лучшая»: выбор цели — это стратегия,
// а кирпичу нужно, чтобы механика заработала и попала в измерение.
export function shuttleSorties(bot: AiTurn, home: HomeTurn): void {
  const { defensive } = bot;
  const s = openSorties(bot, home, loadCarrier(bot));
  if (!landingSortie(bot, s)) strikerSortie(bot, s);
  if (!defensive && s.foeWorlds.length > 0) rebaseToFront(bot, s);
  if (!defensive) holdPatrols(bot, s);
}

function loadCarrier(bot: AiTurn): HoldPick {
  const { state, ai, out } = bot;
  // ═══ ПОГРУЗКА НА НОСИТЕЛЬ (SHU-2.1) ═══
  // Носитель без эскадр — просто дорогой корпус с плохими пушками. Грузим, пока он
  // СТОИТ у своего мира с портом: ядро возит соединение целиком и только со стоянки.
  // Один приказ за тик той же формы, что и остальные правила бота.
  // Кандидат — флот, СТОЯЩИЙ у своего мира, в порту которого есть ударная эскадра,
  // влезающая в его трюм целиком. Берётся ПЕРВАЯ такая эскадра порта — тем же
  // правилом, что и кнопка перегрузки у игрока (`transferPick`): половину ядро отобьёт.
  // Кого из кандидатов грузить — `pickHoldFleet` (SHU-5.6): авианосец, потом флот с
  // ремонтным ангаром (эскадры на его борту чинятся в походе), потом свободный трюм.
  // Раньше лучший флот выбирался ДО порта и трюма, и полный или стоящий не у порта
  // лидер останавливал погрузку совсем.
  const holdPick = pickHoldFleet(
    Object.values(state.fleets).flatMap((f) => {
      if (f.owner !== ai || f.movement || f.battleId || f.location === null) return [];
      if (fleetShuttleBay(f, data) <= 0) return [];
      const dock = state.planets[f.location];
      if (!dock || dock.owner !== ai) return [];
      const room = fleetHoldFree(state, f, data);
      const liftable = (dock.hangar ?? []).find(
        (sq) =>
          sq.units.some((st) => STRIKE_SHUTTLES.includes(st.unit as never) && st.count > 0) &&
          squadronSize(sq) > 0 &&
          stacksSize(sq.units, data) <= room,
      );
      if (!liftable) return [];
      return [
        {
          id: f.id,
          carrier: f.units.some(
            (st) => st.count > 0 && data.units[st.unit]?.traits.includes('carrier'),
          ),
          repair: fleetHangarRepairRate(f, data),
          room,
          squadronId: liftable.id,
        },
      ];
    }),
  );
  if (holdPick) out.push(loadShuttle(ai, holdPick.id, holdPick.squadronId));
  return holdPick;
}

function openSorties(bot: AiTurn, home: HomeTurn, holdPick: HoldPick): Sorties {
  const { state, ai, d } = bot;
  const { base } = home;
  // Что уже занято в этот тик (SHU-6.8): эскадры с приказом и базы, откуда был вылет.
  // Топливо у базы общее, поэтому вылет с базы — один за тик на удар, перелёт и патруль
  // вместе; эскадра — один приказ. Проба `canOrder` видит мир на начало тика, а не после
  // приказов выше, и без этой памяти второй приказ отбивался бы ядром.
  const launched = new Set<string>();
  const taken = new Set<string>(holdPick ? [holdPick.squadronId] : []);
  // ═══ ОТКУДА ПОДНИМАТЬ ═══
  // БАЗА ВЫЛЕТА — ЛЮБАЯ СВОЯ, а не один дом. Пока бот умел только домашний порт, удар
  // не доезжал до войны вовсе: радиус челнока 120–150, а чужие миры так близко к дому
  // не стоят — замер давал ноль вылетов при живой постройке машин. Носитель и есть
  // ответ («плавучий космопорт», SHU-2.1). С SHU-6.8 эскадры ещё и перелетают к фронту,
  // в том числе на свой порт у фронта, и база, с которой бот не поднимает удар, держала
  // бы их там без дела. Поэтому базы — все свои обеих форм (уточнение владельца
  // 2026-10-04: «учти наши базы, в виде трюмов»): сперва дом, потом другие миры с
  // ангаром по id, потом корабли по id. Порядок фиксированный — от него зависит выбор,
  // а решение бота обязано быть чистой функцией состояния (инвариант №1).
  const byId = (a: { id: string }, b: { id: string }): number =>
    a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  const basePos = (b: StrikeBase): { x: number; y: number } | null => {
    if (b.kind === 'planet') return state.planets[b.id]?.position ?? null;
    const f = state.fleets[b.id];
    return f ? fleetPositionAt(state, f, state.time) : null;
  };
  const launchpads: Launchpad[] = [];
  const addPad = (ref: StrikeBase, at: { x: number; y: number }, hangar: Squadron[]): void => {
    const id = ref.id;
    launchpads.push({
      key: `${ref.kind}:${id}`,
      ref,
      base: ref.kind === 'planet' ? { planetId: id } : { fleetId: id },
      at,
      hangar,
    });
  };
  const homePort = state.planets[base.id];
  if (homePort) addPad({ kind: 'planet', id: homePort.id }, homePort.position, homePort.hangar ?? []);
  for (const p of Object.values(state.planets).sort(byId)) {
    if (p.id === base.id || p.owner !== ai || (p.hangar ?? []).length === 0) continue;
    if (shuttleBayAt(p, data) > 0) addPad({ kind: 'planet', id: p.id }, p.position, p.hangar!);
  }
  // СТОЯНКА НОСИТЕЛЮ БОЛЬШЕ НЕ НУЖНА (решение владельца 2026-09-16): ядро пускает
  // вылет с хода, и бот идёт следом. Пока фильтр требовал неподвижности, новое
  // правило не участвовало в замерах вообще — носитель едет с кулаком и стоит редко.
  // Позиция берётся ЖИВОЙ (`fleetPositionAt`, та же функция, по которой считает ядро):
  // у идущего флота `location` пуст, и узел под ним спрашивать не у чего.
  for (const f of Object.values(state.fleets)
    .filter((fl) => fl.owner === ai && !fl.battleId && (fl.hangar ?? []).length > 0)
    .sort(byId)) {
    const at = basePos({ kind: 'fleet', id: f.id });
    if (at) addPad({ kind: 'fleet', id: f.id }, at, f.hangar ?? []);
  }
  // ═══ ЧЕМ ПОДНИМАТЬ: УДАР И ВЫСАДКА — РАЗНЫЕ ПРИКАЗЫ ═══
  // Раньше машина выбиралась ОДНА на фиксированном ростере `['bomber',
  // 'landing_shuttle']`, и когда в ангаре лежал только десантный челнок, тик уходил
  // ВПУСТУЮ: приказа не было вовсе, а отказа, по которому это было бы видно, — тоже.
  // Замер 8 матчей: 112 десантных машин в ангарах против 45 бомбардировщиков, и НИ
  // ОДНОЙ высадки с грузом. Теперь у каждой машины свой путь, свой радиус и свои
  // правила, а бомбардировщик поднимается тогда, когда высадке идти не с чем.
  const squadsWith = (hangar: Squadron[], unit: string): Squadron[] =>
    hangar.filter((sq) => sq.units.some((st) => st.unit === unit && st.count > 0));
  const reachOf = (unit: string): number => data.units[unit]?.stats.strikeRange ?? 0;
  const nearestBy = <T extends { id: string }>(
    xs: T[],
    from: { x: number; y: number },
    at: (x: T) => { x: number; y: number },
  ): T | undefined =>
    xs
      .slice()
      .sort(
        (a, b) =>
          d(from, at(a)) - d(from, at(b)) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
      )[0];

  // ═══ ВЫСАДКА (правила владельца №1, №2, №3 от 2026-09-16) ═══
  // №1 — не высаживаться, НЕ ЗНАЯ гарнизона. До этой правки бот читал
  //      `planet.garrison` напрямую, то есть был всеведущ: пустой гарнизон
  //      невидимого мира он видел так же уверенно, как свой собственный. Теперь
  //      источник один — `knownGarrison` (живое наблюдение либо снимок тумана), и
  //      «не знаю» отличается от «знаю, что пусто».
  // №2 — мир, над которым УЖЕ стоит свой флот, челноками не берут: там дешевле
  //      штурм с кораблей, и он в этом же тике выше по коду.
  // №3 — цель без вражеского флота на орбите; наряд — самая маленькая эскадра,
  //      чей десант в трюме уверенно берёт мир (`planDrop`); самых ударных бойцов
  //      челнок получает ещё на заказе (SHU-5.2).
  const identified = identifiedNodes(state, ai, data);
  const ownNearOrbit = new Set<string>();
  for (const fl of Object.values(state.fleets)) {
    if (fl.owner === ai && fl.orbit === 'near' && fl.location) ownNearOrbit.add(fl.location);
  }
  const foeFleetAt = new Set<string>();
  for (const fl of Object.values(state.fleets)) {
    // Мина (SM-3.6) орбиту не занимает: высадке под ней она не помеха.
    if (fl.owner !== ai && fl.location && fl.units.some((st) => st.count > 0) && !isMineFleet(fl, data)) {
      foeFleetAt.add(fl.location);
    }
  }
  // Цели удара — чужие флоты и миры на войне. Списки общие у удара и перелёта к фронту
  // (SHU-6.8): эскадра, которой со своей базы есть по кому бить, не улетает.
  const foeFleets = Object.values(state.fleets).filter(
    (fl) =>
      fl.owner !== ai &&
      getStance(state, ai, fl.owner) === 'war' &&
      fl.location !== null &&
      fl.units.some((st) => st.count > 0) &&
      // Цель — только видимый боту флот: ядро отказывает в ударе по скрытому (A06), и бот
      // повторял бы отвергнутый приказ. Мину видно только вблизи (SM-3.6).
      isVisibleTo(state, ai, { fleetId: fl.id }, data, identified),
  );
  const foeFleetPos = (fl: Fleet): { x: number; y: number } =>
    state.planets[fl.location!]?.position ?? { x: 1e9, y: 1e9 };
  const foeWorlds = Object.values(state.planets).filter(
    (p) => p.owner !== null && p.owner !== ai && getStance(state, ai, p.owner) === 'war',
  );
  // Эскадры базы, которые этой машиной можно поднять: та, что в этот тик уже грузится
  // в трюм, не в счёт — второй приказ ей ядро отбило бы.
  const freeSquads = (hangar: Squadron[], unit: string): Squadron[] =>
    squadsWith(hangar, unit).filter((sq) => !taken.has(sq.id));
  return {
    holdPick,
    launched,
    taken,
    basePos,
    launchpads,
    reachOf,
    nearestBy,
    identified,
    ownNearOrbit,
    foeFleetAt,
    foeFleets,
    foeFleetPos,
    foeWorlds,
    freeSquads,
  };
}

function landingSortie(bot: AiTurn, s: Sorties): boolean {
  const { state, ai, out, capturable, d } = bot;
  const {
    launched,
    taken,
    launchpads,
    reachOf,
    nearestBy,
    identified,
    ownNearOrbit,
    foeFleetAt,
    freeSquads,
  } = s;
  // Высадка поднимается с ПЕРВОЙ базы, у которой есть и десант, и цель, и наряд, — не
  // с первой, где лежит десантный челнок: иначе челнок дома без цели держал бы на
  // земле десант, перелетевший к фронту (SHU-6.8).
  for (const pad of launchpads) {
    const landers = freeSquads(pad.hangar, 'landing_shuttle');
    if (landers.length === 0) continue;
    // Десант уже в трюме: челнок строится с бойцом внутри (SHU-5.2), поэтому источника
    // войск у вылета больше нет — гарнизон базы под операцию не трогается.
    const reach = reachOf('landing_shuttle');
    const target = nearestBy(
      Object.values(state.planets).filter((p) => {
        if (p.owner === null || p.owner === ai) return false;
        if (getStance(state, ai, p.owner) !== 'war') return false;
        if (!capturable(p)) return false;
        if (d(pad.at, p.position) > reach) return false;
        if (ownNearOrbit.has(p.id)) return false; // №2: возьмём штурмом, челноки целы
        if (foeFleetAt.has(p.id)) return false; // №3: под чужим флотом высадка не идёт
        return freshIntel(knownGarrison(state, ai, p.id, data, identified), state.time);
      }),
      pad.at,
      (p) => p.position,
    );
    const intel = target ? knownGarrison(state, ai, target.id, data, identified) : null;
    const plan = target && intel ? planDrop(landers, intel.units, data) : null;
    if (target && plan) {
      out.push(strikeShuttle(ai, pad.base, plan.squadronId, { targetPlanetId: target.id }));
      launched.add(pad.key);
      taken.add(plan.squadronId);
      return true;
    }
  }
  return false;
}

// ═══ УДАР СТРАЙКЕРОМ ═══
// Один вылет за тик: топливо у базы общее, вторым приказом его не растянуть.
// Цель — чужой ФЛОТ (бомбардировщик бьёт корпуса) либо чужой МИР, ближайшая в
// радиусе, тай-брейк по id: иначе выбор зависел бы от порядка ключей объекта.
// SHU-5.6: машин две — тяжёлый и ударный страйкер (`STRIKERS`), и пробуются они
// по порядку: первая, у которой есть и эскадра на базе, и цель в СВОЁМ радиусе,
// поднимается, остальные ждут следующего тика. Базы перебираются все по порядку
// (SHU-6.8): эскадра в тылу без цели не держит удар эскадры у фронта.
function strikerSortie(bot: AiTurn, s: Sorties): void {
  const { ai, out, d } = bot;
  const {
    launched,
    taken,
    launchpads,
    reachOf,
    nearestBy,
    foeFleets,
    foeFleetPos,
    foeWorlds,
    freeSquads,
  } = s;
  for (const unit of STRIKERS) {
    const reach = reachOf(unit);
    for (const pad of launchpads) {
      const squad = freeSquads(pad.hangar, unit)[0];
      if (!squad) continue;
      const inReach = (at: { x: number; y: number }): boolean => d(pad.at, at) <= reach;
      const foeFleet = nearestBy(
        foeFleets.filter((fl) => inReach(foeFleetPos(fl))),
        pad.at,
        foeFleetPos,
      );
      const foeWorld = nearestBy(
        foeWorlds.filter((p) => inReach(p.position)),
        pad.at,
        (p) => p.position,
      );
      const target = foeFleet
        ? { targetFleetId: foeFleet.id }
        : foeWorld
          ? { targetPlanetId: foeWorld.id }
          : null;
      if (!target) continue;
      out.push(strikeShuttle(ai, pad.base, squad.id, target));
      launched.add(pad.key);
      taken.add(squad.id);
      return;
    }
  }
}

// ═══ ПЕРЕЛЁТ К ФРОНТУ (SHU-6.8) ═══
// Ударная эскадра, которой со своей базы бить некого, перелетает на свою базу ближе к
// фронту — решение `frontRebase` (`/decisions`): фронт — чужие миры на войне, база —
// любой формы, шаг не короче половины радиуса удара. Цели страйкера — те же списки,
// что у удара выше; у десантного челнока — миры, которые можно взять. Один перелёт
// за тик. Перехватчики не перелетают: их дело — патруль над своей базой (ниже).
// Приказ уходит, только если его примет ядро (`canOrder`), иначе бот платил бы
// отказом каждый тик. «Оборона» Хранителя к фронту не летит: она держит своё.
function rebaseToFront(bot: AiTurn, s: Sorties): void {
  const { state, ai, out, capturable } = bot;
  const { holdPick, launched, taken, basePos, launchpads, foeFleets, foeFleetPos, foeWorlds } = s;
  const front = foeWorlds.map((p) => p.position);
  const strikerTargets = [...front, ...foeFleets.map(foeFleetPos)];
  const landerTargets = foeWorlds.filter(capturable).map((p) => p.position);
  for (const pad of launchpads) {
    if (launched.has(pad.key)) continue;
    for (const sq of pad.hangar) {
      if (taken.has(sq.id) || sq.hold !== undefined) continue;
      const machines = sq.units.filter((st) => st.count > 0);
      if (!machines.some((st) => STRIKE_SHUTTLES.includes(st.unit as never))) continue;
      const lander = machines.some((st) => isLander(data.units[st.unit]));
      const dest = frontRebase(state, {
        me: ai,
        from: pad.ref,
        squadron: sq,
        data,
        pos: basePos,
        targets: lander ? landerTargets : strikerTargets,
        front,
      });
      // В трюм, куда в этот тик грузится эскадра из порта, места может не хватить.
      if (!dest || (dest.base.kind === 'fleet' && dest.base.id === holdPick?.id)) continue;
      const order = relocateShuttle(
        ai,
        pad.base,
        sq.id,
        dest.base.kind === 'planet' ? { toPlanetId: dest.base.id } : { toFleetId: dest.base.id },
      );
      if (canOrder(state, order) !== null) continue;
      out.push(order);
      launched.add(pad.key);
      taken.add(sq.id);
      return;
    }
  }
}

// ═══ ПАТРУЛЬ НАД БАЗАМИ (SHU-6.8) ═══
// База держит патруль, ПОКА РЯДОМ ВРАГ: чужой флот на войне (идущий тоже, мина —
// если видна) в радиусе удара её перехватчиков — в том круге, что игрок видит у базы
// (SHU-6.1). Тогда база поднимает удерживаемый патруль над собой первой эскадрой
// перехватчиков (`PATROL_WING`), и дальше её после каждой перезарядки снова поднимает
// само ядро (SHU-6.6), в том числе между ходами бота. Врага не стало — удержание
// снимается: и у патруля в воздухе (он довисит своё и сядет), и у эскадры, ждущей
// дома перезарядки. Почему не всегда: перехватчики в ангаре сами встречают чужие
// вылеты во всём этом круге (SHU-1.3), а патруль закрывает только свой круг (90).
// Патруль в тылу без цели жёг бы топливо базы, нужное удару и перелёту, — замер
// `selfplay 8` с патрулём всегда: 69 урона патрулями за 961 вылет и на треть меньше
// перелётов. Точка у мира — сам мир, у корабля — его живая позиция: ядро и потом
// встаёт над кораблём, а не над прежней стоянкой. «Активная оборона» Хранителя
// держит свою вахту (`stewardGuardOrders`), «Оборона» патрулей не ставит.
function holdPatrols(bot: AiTurn, s: Sorties): void {
  const { state, ai, out, d } = bot;
  const { launched, taken, basePos, launchpads } = s;
  const foesLive: Array<{ x: number; y: number }> = [];
  for (const fl of Object.values(state.fleets)) {
    if (fl.owner === ai || getStance(state, ai, fl.owner) !== 'war') continue;
    if (!fl.units.some((st) => st.count > 0)) continue;
    if (isMineFleet(fl, data) && !mineFleetVisible(state, fl, ai, data)) continue;
    const at = fleetPositionAt(state, fl, state.time);
    if (at) foesLive.push(at);
  }
  const threatened = (at: { x: number; y: number }, wing: Pick<Squadron, 'units'>): boolean => {
    const reach = squadronReach(wing, data);
    return foesLive.some((p) => d(at, p) <= reach);
  };
  const patrolWing = (sq: Squadron): boolean => {
    const machines = sq.units.filter((st) => st.count > 0);
    return (
      machines.length > 0 && machines.every((st) => PATROL_WING.includes(st.unit as never))
    );
  };
  const issue = (order: Action): boolean => {
    if (canOrder(state, order) !== null) return false;
    out.push(order);
    return true;
  };
  // Правило трогает только патруль НАД БАЗОЙ. У мира это точка самого мира: патруль
  // над другой точкой (игрок поставил его над развилкой, а потом место занял
  // заместитель) бот не снимает. У корабля точку не сверить — она осталась там, где
  // корабль был на подъёме, а удержание ядро и так поднимает над самим кораблём
  // (SHU-6.6), — поэтому патруль корабля считается патрулём над базой.
  const overBase = (b: StrikeBase, point: { x: number; y: number }, at: { x: number; y: number }): boolean =>
    b.kind === 'fleet' || d(point, at) < 1;
  for (const pad of launchpads) {
    // Удержание у эскадры, ждущей дома перезарядки, снимается, когда врага не стало.
    for (const sq of pad.hangar) {
      if (sq.hold === undefined || taken.has(sq.id)) continue;
      if (!overBase(pad.ref, sq.hold.at ?? pad.at, pad.at)) continue;
      if (!threatened(pad.at, sq)) issue(releaseHold(ai, pad.base, sq.id));
    }
    if (launched.has(pad.key) || holdsPatrol(state.strikes, pad.hangar, pad.ref, ai)) continue;
    const wing = pad.hangar.find((sq) => !taken.has(sq.id) && patrolWing(sq));
    if (!wing || !threatened(pad.at, wing)) continue;
    if (issue(patrolShuttle(ai, pad.base, wing.id, pad.at, true))) {
      launched.add(pad.key);
      taken.add(wing.id);
    }
  }
  // …и у патруля в воздухе: врага не стало — довисит своё и сядет, не поднимаясь
  // снова; враг вернулся, пока патруль ещё висит или летит к точке, — удержание
  // ставится обратно, без нового вылета.
  for (const st of state.strikes ?? []) {
    if (st.owner !== ai || st.target.kind !== 'point' || !st.patrol) continue;
    const at = basePos(st.base);
    if (!at || !overBase(st.base, st.to, at)) continue;
    const want = threatened(at, st);
    if (st.patrol.hold === true && !want) issue(holdPatrol(ai, st.id, false));
    else if (st.patrol.hold !== true && want && st.leg !== 'back') issue(holdPatrol(ai, st.id, true));
  }
}
