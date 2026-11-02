/**
 * КАМПАНИЯ СИЛЬНОГО БОТА (SLIM-3): наземные цеха и войска, гарнизоны призовых миров,
 * оборона, носитель, осадные и ремонтные крейсеры, челноки. Звенья идут в прежнем порядке.
 */
import {
  buildingLevel,
  buildingMaxLevel,
  matchCost,
  matchUnitCost,
  type Planet,
  type UnitStack,
} from '../../../packages/shared-core/src/index';
import { buildBuilding, upgradeBuilding, buildUnit, buildShip } from '../../../decisions/actions';
import { garrisonDefense, garrisonFloor, spareGround } from '../../../decisions/garrisonPolicy';
import { isLander, landerTroopCandidates } from '../../../decisions/landerTroops';
import { canOrder } from '../protoKernel';
import { data } from '../gameData';
import {
  ORDER_RESERVE,
  ownsModule,
  worldsInOrder,
  SHUTTLE_CAP,
  STRIKE_SHUTTLES,
  hasFacilityFor,
} from './rules';
import type { HomeTurn } from './home';
import type { AiTurn } from './turn';

/** Наземные цеха дома, в порядке постройки (ROS-1.1): казармы дают пехоту, завод —
 *  технику. Порядок фиксирован — как и у ростера (`aiTurn/turn.ts`), ради инварианта #1. */
const GROUND_YARDS = ['barracks', 'factory'] as const;

/** Сколько наземных юнитов сильный бот держит дома: гарнизон + запас на десант. */
const GROUND_STOCK = 8;

/**
 * УДАРНЫЙ РЕЗЕРВ (снежный ком, 2026-09-28): сколько бойцов СВЕРХ пола гарнизона столица
 * держит под десант. `GROUND_STOCK` считает головы, а пол (`garrisonFloor`) растёт с
 * развитостью: у застроенной столицы он ≈ 8 ополченцев, то есть весь запас уходил в пол,
 * и `spareGround` отдавал в трюм одного бойца — десант не брал ни одного гарнизона.
 * Замер `selfplay 200` поверх охоты отстающего: snowball 62/57% → 52/57%, лидерство с
 * д7.4/7.8 → д9.1/9.4, штурмов 897/858 → 1568/1660.
 */
const STRIKE_RESERVE = 4;

/** Сколько ПРИЗОВЫХ миров получают гарнизон за один тик. Не единица (иначе империя
 *  добирает пол по одному миру за два игровых часа) и не «сколько влезет»: `affordable*`
 *  меряет казну до ВСЕХ заказов тика, поэтому щедрость обернулась бы пачкой отказов. */
const GARRISON_ORDERS_PER_TICK = 3;

/** Осадных крейсеров — два (SIEGE-1: осада — модуль `siege_platform` на крейсере, а не
 *  отдельный корпус). Столько же держал бот и платформ, пока они были юнитом. */
const SIEGE_CAP = 2;

const SIEGE_MODULE = 'siege_platform';

/** Крейсеров с ремонтным ангаром (SHU-5.6) — два, как осадных: по одному на ударную
 *  группу. Флот чинит эскадры в трюме ЛУЧШИМ модулем среди своих кораблей
 *  (`fleetHangarRepairRate`), второй ангар в том же флоте ничего не добавляет. */
const REPAIR_BAY_CAP = 2;

const REPAIR_MODULE = 'repair_bay';

/** Носителей — два (решение владельца 2026-09-26 слило авианосец и десантный корабль в
 *  один корабль): столько бот держал десантных кораблей, и столько трюма ударной группе
 *  хватало на штурм. */
const CARRIER_CAP = 2;

/** Кандидаты в бойцы десантного челнока (SHU-5.2), от самого ударного — общее правило
 *  `/decisions/landerTroops.ts`. Строить ли их на ЭТОМ мире — спрашивается у ядра
 *  (`canOrder`) в момент заказа. */
const GROUND_BY_ATTACK: readonly string[] = landerTroopCandidates(data);

/** Сколько НАЗЕМНЫХ юнитов стоит в гарнизоне мира (корабли в гарнизоне не в счёт). */
function groundCount(p: Planet): number {
  return p.garrison.reduce((n, s) => n + (data.units[s.unit]?.domain === 'ground' ? s.count : 0), 0);
}

// ═══ СИЛЬНЫЙ БОТ (AI-BAL-3): наземная кампания ═══
// Диагноз, ради которого этот блок и появился: в батче на 300 матчей ВСЕ четыре
// наземных юнита показывались «мёртвым контентом» — и не потому, что бот их не
// заказывал (на войне он заказывал ополчение), а потому, что каждый такой заказ
// ядро отбивало отказом «нет здания»: наземное производство открывает
// казарма (сегодня `enablesInfantryConstruction`), а бот не строил её никогда — стартовый
// мир получает только космопорт (`matchSetup.ts`). Отказ тихий: `applyAction`
// возвращает `{ ok: false }`, харнес его пропускает, и в отчёте это выглядело как
// «бот не хочет пехоту», а не как «пехота ему запрещена».
//
// Порядок здесь и есть цепочка захвата: казарма → войска → гарнизон на призовых
// мирах (он-то и превращает «прилетел и забрал» в ШТУРМ) → десантный корпус.
export function strongCampaign(bot: AiTurn, home: HomeTurn): void {
  const {
    state,
    ai,
    out,
    pad,
    pirate,
    skilled,
    lineUnit,
    militiaUnit,
    army,
    groundRoster,
    groundDefenders,
    warFooting,
  } = bot;
  const { base, pl, pendingBuild, affordable, buildAllowed, shuttlesOwned } = home;
  const pendingUnit = (planetId: string, unit: string): boolean =>
    state.scheduled.some((e) => {
      if (e.type !== 'construction.complete') return false;
      const q = e.payload as { kind?: string; planetId?: string; unit?: string };
      return q.kind === 'unit' && q.planetId === planetId && q.unit === unit;
    });
  const pendingSiege = (planetId: string, mod: string = SIEGE_MODULE): boolean =>
    state.scheduled.some((e) => {
      if (e.type !== 'construction.complete') return false;
      const q = e.payload as { kind?: string; planetId?: string; modules?: string[] };
      return q.kind === 'unit' && q.planetId === planetId && !!q.modules?.includes(mod);
    });
  // `troop` — боец десантного челнока (SHU-5.2): платится вместе с машиной.
  const affordableUnit = (unit: string, count: number, troop?: string): boolean => {
    const hull = matchUnitCost(state, data.units[unit]) ?? {};
    const extra = troop !== undefined ? (matchUnitCost(state, data.units[troop]) ?? {}) : {};
    return Object.keys({ ...hull, ...extra }).every(
      (r) =>
        (pl.resources[r] ?? 0) >=
        ((hull[r] ?? 0) + (extra[r] ?? 0)) * count + pad(r, ORDER_RESERVE[r] ?? 0),
    );
  };
  // 1. Дома — оба цеха: КАЗАРМЫ открывают пехоту, ЗАВОД — технику (ROS-1.1).
  //    Одной казармой ростер больше не открывается: без завода танк отбивается
  //    кодом `E_NO_FACTORY`, и самый тяжёлый род войск снова выпал бы из замеров.
  //    Порядок «казармы → завод» — от дешёвого к дорогому: ранняя казна тянет
  //    пехоту, поздняя доплачивает за технику.
  const missingYard = GROUND_YARDS.find(
    (b) => !base.buildings.some((x) => x.type === b && x.hp > 0) && !pendingBuild(base.id, b),
  );
  if (missingYard) {
    if (affordable(missingYard)) out.push(buildBuilding(ai, base.id, missingYard));
  }
  if (hasFacilityFor(base, militiaUnit)) {
    // 2. Запас войск дома: гарнизон столицы + то, что увезёт десант. Берётся самое
    //    тяжёлое по карману, поэтому ростер отыгрывается весь: ранняя казна тянет
    //    ополчение, поздняя — спецназ и танки.
    const pendingHome = groundRoster.reduce(
      (n, u) => n + (pendingUnit(base.id, u) ? 2 : 0),
      0,
    );
    const spareHome = spareGround(base, data).reduce((n, st) => n + st.count, 0);
    if (
      groundCount(base) + pendingHome < GROUND_STOCK ||
      spareHome + pendingHome < STRIKE_RESERVE
    ) {
      // Пока дома нет даже домашней стражи — заказывается ОБОРОНИТЕЛЬНЫЙ род войск;
      // всё сверх неё уедет в трюме, поэтому там нужен ударный.
      // ПРАВИЛО ВЛАДЕЛЬЦА №4 (2026-09-16): «чем больше развита планета, тем больше
      // наземных сил на ней». Мера — тот же ПОЛ, что запрещает вычёрпывать гарнизон
      // (`garrisonFloor`), поэтому «сколько держать» и «сколько можно увезти» не
      // могут разойтись: это одно число, спрошенное с двух сторон. Пока пол не
      // набран — заказывается ОБОРОНИТЕЛЬНЫЙ род войск; всё сверх него уедет в
      // трюме, и там нужен ударный.
      const list =
        garrisonDefense(base.garrison, data) < garrisonFloor(base)
          ? groundDefenders
          : groundRoster;
      const pick = list.find((u) => affordableUnit(u, 2) && hasFacilityFor(base, u));
      if (pick) out.push(buildUnit(ai, base.id, pick, 2));
    }
  }
  // 3. Призовые миры: сперва казарма, потом ополчение в пустой гарнизон. Мир с
  //    гарнизоном нельзя забрать прилётом — за него придётся высаживаться, и
  //    ровно этого измерению не хватало.
  // СТРОЙКА И ГАРНИЗОН — РАЗНЫЕ ОЧЕРЕДИ, и до 2026-09-16 они делили один `break`.
  // Ветка казармы выходила из ВСЕГО цикла, поэтому за тик бот заказывал ЛИБО одну
  // казарму, ЛИБО одну пару ополченцев — на всю империю. Первым в обходе то и дело
  // оказывался мир без казармы (19% своих миров), и тогда ополчение не заказывалось
  // НИГДЕ. Замер: 1498 заказов казармы против 538 заказов ополчения, при том что
  // большинство голодных миров (1445 из 2402) казарму уже имели. Стройка осталась
  // одна за тик, а гарнизон теперь считается своим счётчиком.
  let barracksOrdered = false;
  let garrisonOrders = 0;
  for (const p of worldsInOrder(state, ai, 'barracks', skilled)) {
    if (p.owner !== ai || p.kind !== 'planet' || p.id === base.id) continue;
    if (!hasFacilityFor(p, militiaUnit)) {
      if (barracksOrdered || pendingBuild(p.id, 'barracks')) continue;
      if (!affordable('barracks')) continue;
      out.push(buildBuilding(ai, p.id, 'barracks'));
      barracksOrdered = true; // одна стройка за тик — как и с шахтой
      continue; // …но остальным мирам ещё нужен гарнизон
    }
    // Тот же ПОЛ (правило №4): голый мир держит двух ополченцев, развитый — больше.
    // Раньше условием было «гарнизон пуст», и застроенный призовой мир навсегда
    // оставался при той же паре бойцов, что и голый камень.
    if (garrisonOrders >= GARRISON_ORDERS_PER_TICK) break;
    // BAL-7 (2026-10-01): гарнизон добирается тем же ОБОРОНИТЕЛЬНЫМ списком, что и
    // столица, — тяжёлая пехота первой, если по карману. Раньше здесь стояло одно
    // ополчение, и тяжёлую пехоту бот почти не строил (selfplay 200: 2746 против
    // 22428 ополченцев; с этим и ценой 40+10 — 6646 против 18466).
    if (
      garrisonDefense(p.garrison, data) >= garrisonFloor(p) ||
      groundDefenders.some((u) => pendingUnit(p.id, u))
    )
      continue;
    const pick = groundDefenders.find((u) => affordableUnit(u, 2) && hasFacilityFor(p, u));
    if (!pick) break;
    out.push(buildUnit(ai, p.id, pick, 2));
    garrisonOrders += 1;
  }
  // 5. ОБОРОНА (AI-BAL-2): форт → госпиталь → орбитальное ПКО. Порядок — по тому,
  //    что каждое здание делает для УДЕРЖАНИЯ: форт даёт гарнизону +30% обороны
  //    (`defenseBonus` через хук `combat.damage`), госпиталь его лечит между
  //    штурмами (`healRate`), ПКО бьёт флот на орбите (`aaDamage`), зональное ПВО
  //    (ROS-2.2) огрызается по челнокам, бьющим мир (`pointDefense`) — последним,
  //    потому что оно контрмера ОДНОМУ роду угрозы, а первые три держат мир от всех.
  //    Плюс любое
  //    стоящее здание снимает 1% наземного урона (потолок 90%), поэтому застроенный
  //    мир дорог сам по себе. Только призовые миры: провинций вчетверо больше, и
  //    застраивать их — разорить казну на десятую долю территории.
  const DEFENSE_CHAIN = ['fort', 'hospital', 'orbital_aa', 'zonal_aa'] as const;
  for (const p of warFooting ? worldsInOrder(state, ai, 'defense', skilled) : []) {
    if (p.owner !== ai || p.kind !== 'planet') continue;
    const missing = DEFENSE_CHAIN.find(
      (b) =>
        !p.buildings.some((x) => x.type === b) &&
        !pendingBuild(p.id, b) &&
        buildAllowed(p.id, b),
    );
    if (!missing) continue;
    if (!affordable(missing)) break;
    out.push(buildBuilding(ai, p.id, missing));
    break; // одна стройка за тик — как в экономической цепочке
  }
  // Сколько таких корпусов у места ВСЕГО: во флотах плюс ещё не поднятые в
  //    гарнизоне дома (авто-рандеву кладёт новый корабль именно туда).
  // `withModule` — считать только корпуса с этим модулем (осадные крейсеры SIEGE-1).
  const shipsOwned = (unit: string, withModule?: string): number => {
    const hit = (st: UnitStack): number =>
      st.unit === unit && (!withModule || (st.modules ?? []).includes(withModule)) ? st.count : 0;
    return (
      Object.values(state.fleets).reduce(
        (n, fl) => n + (fl.owner === ai ? fl.units.reduce((k, st) => k + hit(st), 0) : 0),
        0,
      ) + base.garrison.reduce((n, st) => n + hit(st), 0)
    );
  };
  // 4. НОСИТЕЛЬ (решение владельца 2026-09-26: авианосец и десантный корабль — один
  //    корабль). Трюм 16 против 5 у крейсера: без него ударная группа везёт горстку и
  //    штурм захлёбывается на первом же гарнизоне. Тот же трюм возит челноки — вылет
  //    поднимается с борта у фронта, а не с базы, куда радиус 120–150 не дотягивается.
  //    Носитель — тяжёлый корпус, ему нужен стапель 3-го уровня (FORT-5.5), а верфь
  //    дома стоит вторая. Заказ без подъёма верфи ядро отбивало `E_YARD_TOO_SMALL`
  //    каждый тик, и за 96 матчей плейтеста 2026-10-09 не встал ни один Носитель.
  //    Поэтому сперва спрашиваем ядро; мал стапель — поднимаем верфь.
  if (
    !pirate &&
    shipsOwned('shuttle_carrier') < CARRIER_CAP &&
    !pendingUnit(base.id, 'shuttle_carrier')
  ) {
    const carrier = buildUnit(ai, base.id, 'shuttle_carrier', 1);
    const verdict = canOrder(state, carrier);
    if (verdict === null) {
      if (affordableUnit('shuttle_carrier', 1)) out.push(carrier);
    } else if (verdict === 'E_YARD_TOO_SMALL') {
      const yard = base.buildings.find((x) => x.type === 'shipyard' && x.hp > 0);
      const def = data.buildings['shipyard'];
      const upgrading = state.scheduled.some((e) => {
        if (e.type !== 'construction.complete') return false;
        const q = e.payload as { kind?: string; planetId?: string; building?: string };
        return q.kind === 'upgrade' && q.planetId === base.id && q.building === 'shipyard';
      });
      if (yard && def && !upgrading && yard.level < buildingMaxLevel(def)) {
        const cost = matchCost(state, buildingLevel(def, yard.level + 1).cost);
        const order = upgradeBuilding(ai, base.id, 'shipyard');
        if (
          Object.keys(cost).every(
            (r) => (pl.resources[r] ?? 0) >= (cost[r] ?? 0) + pad(r, ORDER_RESERVE[r] ?? 0),
          ) &&
          canOrder(state, order) === null
        ) {
          out.push(order);
        }
      }
    }
  }
  // ═══ 6. АВИАЦИЯ И ЗАДНЯЯ ЛИНИЯ (AI-BAL-4) ═══
  // Правило постройки `artillery` СНЯТО (решение владельца 2026-09-16). Дальний огонь
  // убран из игры целиком ещё раньше: модуль `artillery` вышел из графа, манифест
  // поднят до 14 (`scenario.ts`), и корпуса `artillery` нет ни в одном `data/*.json`.
  // Правило же осталось и заказывало его КАЖДЫЙ тик — ядро отбивало `E_UNKNOWN_UNIT`
  // молча, 2493 отказа за 8 матчей замера. Линии приёма урона это не касается: они
  // живы, и заднюю линию держит осадная платформа ниже.
  // Осада — модулем, а не корпусом (SIEGE-1, резолюция владельца 2026-09-23): юнита
  // «осадная платформа» больше нет, её роль — модуль `siege_platform` на крейсере.
  // Бот держит пару таких крейсеров на войне: без них миры он рушил бы только
  // `attack × BOMBARD_FRACTION` линейных корпусов. Заднюю линию теперь держит
  // шаттл-носитель выше.
  const lineCost = matchUnitCost(state, data.units[lineUnit]) ?? {};
  const siegeCost = matchCost(state, data.modules[SIEGE_MODULE]?.cost) ?? {};
  if (
    warFooting &&
    data.modules[SIEGE_MODULE] &&
    ownsModule(state, ai, SIEGE_MODULE) &&
    shipsOwned(lineUnit, SIEGE_MODULE) < (army.siegeCap ?? SIEGE_CAP) &&
    !pendingSiege(base.id) &&
    Object.keys({ ...lineCost, ...siegeCost }).every(
      (r) =>
        (pl.resources[r] ?? 0) >=
        (lineCost[r] ?? 0) + (siegeCost[r] ?? 0) + pad(r, ORDER_RESERVE[r] ?? 0),
    )
  ) {
    out.push(buildShip(ai, base.id, lineUnit, 1, [SIEGE_MODULE]));
  }
  // РЕМОНТНЫЙ АНГАР (SHU-5.4 → SHU-5.6). Крейсер — тот корпус, что у бота возит
  // шаттлы в трюме (5 мест; авианосец строится редко), и вспомогательный слот у него
  // свободен: осадный модуль — оружейный. Ангар чинит корпус в походе и эскадры на
  // борту, поэтому нужен ровно там, где идут вылеты: на войне, пара на империю.
  // Погрузка предпочитает флот с ангаром (`pickHoldFleet`). Проба `canOrder` — на
  // случай арсенала без модуля: тогда заказа нет, а не отказ ядра каждый тик.
  const repairCost = matchCost(state, data.modules[REPAIR_MODULE]?.cost) ?? {};
  if (
    warFooting &&
    data.modules[REPAIR_MODULE] &&
    shipsOwned(lineUnit, REPAIR_MODULE) < REPAIR_BAY_CAP &&
    !pendingSiege(base.id, REPAIR_MODULE) &&
    Object.keys({ ...lineCost, ...repairCost }).every(
      (r) =>
        (pl.resources[r] ?? 0) >=
        (lineCost[r] ?? 0) + (repairCost[r] ?? 0) + pad(r, ORDER_RESERVE[r] ?? 0),
    ) &&
    canOrder(state, buildShip(ai, base.id, lineUnit, 1, [REPAIR_MODULE])) === null
  ) {
    out.push(buildShip(ai, base.id, lineUnit, 1, [REPAIR_MODULE]));
  }
  // ═══ ЧЕЛНОКИ (SHU-1.1 + SHU-3.2) ═══
  // Ворота — КОСМОПОРТ: челнок строится в порту и живёт в нём, поэтому цепочка
  // короткая — порт у бота и так есть под корабли.
  //
  const orderShuttle = (unit: string): void => {
    if (pirate) return; // This roster has ships and ground troops, no shuttle wing.
    const cap = (STRIKE_SHUTTLES as readonly string[]).includes(unit)
      ? (army.strikeCap ?? SHUTTLE_CAP)
      : SHUTTLE_CAP;
    if (shuttlesOwned(unit) >= cap) return;
    if (pendingUnit(base.id, unit)) return;
    if (!affordableUnit(unit, 1)) return;
    // ВОРОТА СПРАШИВАЮТСЯ У ЯДРА, а не подразумеваются. Раньше здесь стояло
    // допущение «порт у бота и так есть под корабли» — с YARD-1 оно неверно: дом
    // несёт верфь, а порт бот строит сам (цепочка выше). Заказ без порта ядро
    // отбивает `E_NO_PORT`, и без этой пробы бот платил бы за него отказом каждый
    // тик — ровно тем же способом, каким когда-то упирался в `E_HANGAR_FULL`.
    // ДЕСАНТНЫЙ ЧЕЛНОК строится сразу с бойцом внутри (SHU-5.2), и боец выбирается
    // здесь: самый УДАРНЫЙ (`attack` вниз, тай-брейк по id), которого ядро примет на
    // этом мире — правило владельца №3 «максимум силы наземных юнитов» решается на
    // заказе, грузить трюм перед вылетом больше нечем. Некого строить — челнока нет.
    if (isLander(data.units[unit])) {
      const troop = GROUND_BY_ATTACK.find(
        (g) =>
          affordableUnit(unit, 1, g) &&
          canOrder(state, buildUnit(ai, base.id, unit, 1, g)) === null,
      );
      if (troop !== undefined) out.push(buildUnit(ai, base.id, unit, 1, troop));
      return;
    }
    if (canOrder(state, buildUnit(ai, base.id, unit, 1)) !== null) return;
    out.push(buildUnit(ai, base.id, unit, 1));
  };
  // Перехватчик — ВСЕГДА, и на войне, и в мире: он не оружие нападения, а ПВО
  // базы. Своё дело он делает без единого приказа — база поднимает звено навстречу
  // чужому вылету сама (SHU-1.3), — поэтому держать его дежурным есть смысл и в
  // мирное время, ровно как орбитальное ПКО.
  orderShuttle('interceptor');
  // Ударные челноки — только на войне: бомбардировщик бьёт корпуса (ROS-1.4),
  // десантный везёт войска и высаживает плацдарм (ROS-1.5). В мирное время оба
  // просто занимали бы ангар и микроэлектронику.
  if (warFooting) for (const unit of STRIKE_SHUTTLES) orderShuttle(unit);
}
