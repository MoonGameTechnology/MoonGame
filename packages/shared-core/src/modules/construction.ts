import type { GameModule, HandlerContext } from '../kernel/module';
import type {
  BuildingInstance,
  Planet,
  PausedConstructionSite,
  Player,
  QueuedConstruction,
  UnitStack,
} from '../state/gameState';
import type { BuildingDef, GameData, ResourceBag, UnitDef } from '../data/schemas';
import { buildingLevel, buildingMaxLevel } from '../data/schemas';
import { isBombarded } from '../state/orbit';
import { fleetAtOwnDock } from '../util/repair';
import { battleAt, battleLocations } from '../state/battle';
import { allowedBuildings, isBuildable } from '../state/sectorKind';
import type { Action } from '../action/types';
import { hoursToMs, timeScaleOf } from '../action/types';
import { MS_PER_HOUR } from '../util/time';
import { canAfford, payCost, refundCost } from '../util/treasury';
import { buildProgress } from '../util/construction';
import { isAllied } from '../util/combat';
import { addUnits } from '../util/stacks';
import { basedMachine, hangarUsed, shuttleBayAt } from '../state/shuttle';
import { effectiveStats, loadoutCost, validateLoadout } from '../util/loadout';

/** Share of the ground assault's round damage that also wears down the planet's
 *  structures (the rest is spent on the defending garrison). Tunable. */
const STRUCTURE_DAMAGE_SHARE = 0.5;

interface ConstructBuildingPayload {
  planetId: string;
  building: string;
}
interface BuildUnitPayload {
  planetId: string;
  unit: string;
  count?: number;
  /** Ship modules to install on the built stack (loadout). Validated against the
   *  hull's slots at order time, paid for up-front, then LOCKED onto the stack —
   *  there is no refit action. Absent/empty = a bare hull. */
  modules?: string[];
}
/** Payload of the internal `construction.complete` schedule (we author it, so
 *  it is well-formed; the handler still guards types and is fail-secure). */
interface CompletePayload {
  kind?: 'building' | 'unit' | 'upgrade';
  planetId?: string;
  playerId?: string;
  building?: string;
  unit?: string;
  count?: number;
  level?: number;
  modules?: string[];
  /** RULES-2.1: instance uid for upgrade completion (when maxPerPlanet > 1). */
  uid?: string;
  /** Scheduled event seq (for uid generation). */
  seq?: number;
}
interface ConstructionRequirement {
  allowed: boolean;
  code?: string;
}
interface CancelConstructionPayload {
  planetId: string;
  /** The `scheduled` entry's `seq` — the same value the client already reads off
   *  `construction.complete` events to identify "the active build". */
  seq: number;
}
interface ResumeConstructionPayload {
  planetId: string;
  /** A `PausedConstructionSite.id` (= the original order's `seq`). */
  id: number;
}

/** Sum two resource bags (`a + b`), for hull + loadout costs. */
function sumBags(a: ResourceBag, b: ResourceBag): ResourceBag {
  const out: Record<string, number> = { ...a };
  for (const [res, amt] of Object.entries(b)) out[res] = (out[res] ?? 0) + amt;
  return out;
}

/** `cost × count`, for multi-unit orders. */
function scaleCost(cost: ResourceBag, count: number): ResourceBag {
  const out: Record<string, number> = {};
  for (const res of Object.keys(cost)) {
    out[res] = (cost[res] ?? 0) * count;
  }
  return out;
}

/** Recomputes the (duration, cost) an in-flight `construction.complete` payload
 *  represents, from data — the exact same lookups used when the order was first
 *  placed. Null for a malformed/unrecognized payload (fail-secure: cancel/resume
 *  reject rather than guess). */
function orderSpec(
  data: GameData,
  p: CompletePayload,
): { hours: number; cost: ResourceBag } | null {
  if (p.kind === 'building' && typeof p.building === 'string') {
    const def = data.buildings[p.building];
    if (!def) return null;
    const level1 = buildingLevel(def, 1);
    return { hours: level1.buildTimeHours, cost: level1.cost };
  }
  if (p.kind === 'upgrade' && typeof p.building === 'string' && typeof p.level === 'number') {
    const def = data.buildings[p.building];
    if (!def) return null;
    const next = buildingLevel(def, p.level);
    return { hours: next.buildTimeHours, cost: next.cost };
  }
  if (p.kind === 'unit' && typeof p.unit === 'string' && typeof p.count === 'number') {
    const def = data.units[p.unit];
    if (!def) return null;
    const perShip =
      p.modules && p.modules.length > 0
        ? sumBags(def.cost, loadoutCost(p.modules, data))
        : def.cost;
    return { hours: def.buildTimeHours, cost: scaleCost(perShip, p.count) };
  }
  return null;
}

/** Schedules a build to finish after `hours`, scaled by the match timeScale
 *  exactly like every other real-time duration (GDD §3.1). */
function scheduleCompletion(h: HandlerContext, hours: number, payload: CompletePayload): void {
  h.schedule(h.ctx.now + hoursToMs(h.ctx, hours), 'construction.complete', payload);
}

/** True if a `construction.complete` of this `kind` for this planet+building is already
 *  in flight — the "already queued?" guard shared verbatim by build and upgrade. */
/**
 * RULES-2. Занят ли лимит экземпляров здания на мире. Правило («одно такое здание на
 * мир, уровень растят улучшением») больше не строка в редьюсере — его объявляет само
 * здание полем `maxPerPlanet`, а код лишь исполняет объявленное. Дефолт схемы `1`
 * сохраняет прежнее поведение всего каталога.
 */
function atInstanceCap(h: HandlerContext, planet: Planet, building: string): boolean {
  const cap = h.ctx.data.buildings[building]?.maxPerPlanet ?? 1;
  return planet.buildings.filter((b) => b.type === building).length >= cap;
}

/** Юнит-гарнизон, который выставляет форт (FORT-2.2). Он `issued`: заказать его нельзя,
 *  он приходит и уходит вместе со зданием. */
const GARRISON_UNIT = 'garrison';

/** Базовый потолок выданного гарнизона на ПЛАНЕТУ (решение владельца). Фракция двигает
 *  его через хук `fort.garrisonCap`. */
const FORT_GARRISON_CAP = 3;

/**
 * Привести гарнизон, ВЫДАННЫЙ зданиями, в соответствие с ними — один дом на три повода
 * (постройка, прокачка, разрушение). Тот же приём, которым крепость держит свои орудия
 * (`syncStationGuns`), и по той же причине: три копии этого правила разошлись бы молча.
 *
 * Правило: сколько суммарно объявили живые здания, столько юнитов и стоит. Ноль — стека
 * нет вовсе. Прокачка ДОБАВЛЯЕТ защитников, но потерь боя не лечит: иначе апгрейд
 * работал бы мгновенным подкреплением посреди штурма.
 *
 * Игроковы войска в том же `garrison` не трогаются: выданные отличимы по id юнита,
 * заказать который нельзя (`issued`), — поэтому «чей это стек» не надо угадывать.
 */
function syncIssuedGarrison(h: HandlerContext, planet: Planet): void {
  let target = 0;
  for (const b of planet.buildings) {
    if (b.hp <= 0) continue;
    const def = h.ctx.data.buildings[b.type];
    if (def) target += buildingLevel(def, b.level).issuesGarrison;
  }
  // ПОТОЛОК СЧИТАЕТСЯ ПО ПЛАНЕТЕ, а не по зданию (FORT-2.3, решение владельца): иначе
  // два форта обошли бы его сложением, и «потолок 3» означал бы «3 на каждый форт».
  // Значение идёт хуком: база живёт здесь, фракция двигает её своей пассивкой, а без
  // модуля фракций работает база — инвариант «расширение деградирует до дефолта».
  const cap = h.hook<number>('fort.garrisonCap', FORT_GARRISON_CAP, { planetId: planet.id });
  target = Math.min(target, Math.max(0, cap));
  const idx = planet.garrison.findIndex((s) => s.unit === GARRISON_UNIT);
  if (target <= 0) {
    if (idx >= 0) planet.garrison.splice(idx, 1);
    return;
  }
  if (idx < 0) {
    planet.garrison.push({ unit: GARRISON_UNIT, count: target });
    return;
  }
  const stack = planet.garrison[idx]!;
  if (stack.count < target) stack.count = target;
}

/**
 * СЛОТЫ ПОСТРОЕК (FORT-5.3, решения владельца 10 и 11): сколько мест несёт узел и
 * сколько уже занято. `null` — лимита нет вовсе.
 *
 * Лимит включается САМИМ НАЛИЧИЕМ мест: пока ни одно стоящее сооружение не объявило
 * `buildSlots`, узел застраивается как раньше. Поэтому планета и прочие виды не тронуты
 * — отдельного флага «а тут лимит есть» не понадобилось.
 *
 * Сооружение, НЕСУЩЕЕ места, само слота не занимает: корпус крепости держит причалы, а
 * не стоит в одном из них. Правило по свойству, а не по имени здания, — новое
 * сооружение с местами получит его само.
 *
 * Очередь считается вместе со стоящим, иначе лимит обходится заказом впрок: пять
 * построек в очередь на крепость первого уровня, и все пять доедут до готовности.
 */
function slotsAt(h: HandlerContext, planet: Planet): { capacity: number; used: number } | null {
  let capacity = 0;
  let used = 0;
  for (const b of planet.buildings) {
    if (b.hp <= 0) continue; // разрушенное не несёт мест и не занимает их
    const def = h.ctx.data.buildings[b.type];
    const slots = def ? buildingLevel(def, b.level).buildSlots : 0;
    if (slots > 0) capacity += slots;
    else used += 1;
  }
  if (capacity <= 0) return null; // мест никто не объявил → лимита нет
  for (const e of h.state.scheduled) {
    if (e.type !== 'construction.complete') continue;
    const p = e.payload as CompletePayload;
    if (p.kind === 'building' && p.planetId === planet.id) used += 1;
  }
  for (const q of planet.buildQueue ?? []) {
    if (q.kind === 'building') used += 1;
  }
  return { capacity, used };
}

function isQueued(
  h: HandlerContext,
  kind: CompletePayload['kind'],
  planetId: string,
  building: string,
): boolean {
  const inFlight = h.state.scheduled.some((e) => {
    if (e.type !== 'construction.complete') return false;
    const p = e.payload as CompletePayload;
    return p.kind === kind && p.planetId === planetId && p.building === building;
  });
  if (inFlight) return true;
  // BLD-1: ждущий заказ — тоже «уже заказано». Иначе один и тот же дом ушёл бы в
  // очередь дважды и второй экземпляр умер бы на пороге `atInstanceCap`.
  const queue = h.state.planets[planetId]?.buildQueue ?? [];
  return queue.some((q) => q.kind === kind && q.building === building);
}

// --- очередь стройки (BLD-1) -------------------------------------------------
//
// Находка владельца на плейтесте: «каждая новая постройка переопределяла предыдущую,
// ресурсы тратились». Переопределял ЭКРАН, а не редьюсер: ядро принимало все заказы и
// строило их ПАРАЛЛЕЛЬНО, а клиент показывал ровно один — ближайший по времени.
// С места игрока это неотличимо от «съело ресурсы».
//
// Решение владельца: заказы встают в ОЧЕРЕДЬ. Голова строится, остальные ждут и
// стартуют сами; заменить идущую стройку можно только явной отменой.
//
// Правила, которые из этого следуют (решались здесь — их не было ни в дизайне, ни в
// коде):
//
//  1. **Одна стройка на ПОЛОСУ на мире.** Полос две: `buildings` (здание и апгрейд —
//     они спорят за одну стройплощадку) и `units` (верфь/казармы). Полосы независимы:
//     долгий дом не должен морозить верфь. Ровно это правило ДО BLD-1 стояло в клиенте
//     прототипа и утверждало, будто «ядро всё равно не примет второй». Не принимало
//     только ОДИНАКОВЫЙ (`isQueued`); теперь утверждение стало правдой, и две очереди
//     схлопываются в одну.
//  2. **Деньги списываются НА СТАРТЕ, а не на заказе.** Иначе очередь перестаёт быть
//     планом: в игре, где ты офлайн часами, весь смысл ряда — «накопится и построится
//     само». Ждущий заказ не стоит ничего, поэтому его отмена — просто удаление.
//  3. **Проверяем деньги ТАМ ЖЕ, где стартуем.** Заказ в свободную полосу стартует
//     сразу, значит и проверяется сразу — `E_INSUFFICIENT` как раньше, контракт не
//     менялся. Заказ в занятую полосу сейчас не стартует, значит и денег у него сейчас
//     не спрашивают. Никакого отдельного правила «когда прощаем бедность» нет.
//  4. **Голова, которой не хватило денег, ЖДЁТ** и пробует снова раз в игровой час.
//     Повтор — событие на таймлайне, а не опрос: старт обязан быть привязан к
//     запланированному событию, иначе момент старта зависел бы от того, каким шагом
//     звали `advanceTo` (сервер тикает секундами, тест — часами), и это был бы разрыв
//     детерминизма. Тот же приём уже стоит рядом для бомбардировки.
//  5. **Глубина очереди ограничена.** Это не баланс, а граница ПЕРСИСТИРУЕМОГО
//     состояния: очередь живёт в JSONB, и «сколько угодно» здесь означало бы, что
//     объём строки задаёт клиент.
//  6. **Захват мира стирает очередь.** Ничего не пропадает — она не оплачена.
//
// Туман: очередь видит только владелец мира (`visibleState`). Это будущее НАМЕРЕНИЕ —
// ровно то, за что там режут `scheduled` и цепочки приказов.

/** Полоса конвейера: за одну стройплощадку спорят здание и апгрейд, отдельно — юниты. */
type BuildLane = 'buildings' | 'units';

function laneOfKind(kind: CompletePayload['kind']): BuildLane {
  return kind === 'unit' ? 'units' : 'buildings';
}

/** Потолок ждущих заказов в одной полосе одного мира (правило 5). */
const MAX_BUILD_QUEUE = 5;

/** Как часто голова, упёршаяся в деньги, пробует стартовать снова (правило 4). */
const QUEUE_RETRY_HOURS = 1;

/** Идёт ли на мире стройка в этой полосе прямо сейчас. Неразборчивый `kind` считается
 *  полосой зданий — в сторону «занято», а не «свободно» (инвариант #4). */
function laneBusy(h: HandlerContext, planetId: string, lane: BuildLane): boolean {
  return h.state.scheduled.some((e) => {
    if (e.type !== 'construction.complete') return false;
    const p = e.payload as CompletePayload;
    return p.planetId === planetId && laneOfKind(p.kind) === lane;
  });
}

/** Поставить заказ в хвост очереди мира. Возвращает код отказа или null. */
function enqueueOrder(
  h: HandlerContext,
  planet: Planet,
  order: Omit<QueuedConstruction, 'id'>,
): string | null {
  const queue = planet.buildQueue ?? [];
  const lane = laneOfKind(order.kind);
  if (queue.filter((q) => laneOfKind(q.kind) === lane).length >= MAX_BUILD_QUEUE) {
    return 'E_QUEUE_FULL';
  }
  // Личность из счётчика запланированных событий — чтобы `construction.cancel` брал
  // ОДИН номер и не путал ждущий заказ с идущей стройкой (см. `QueuedConstruction`).
  const id = h.state.scheduleSeq++;
  planet.buildQueue = [...queue, { ...order, id }];
  h.emit('construction.queued', {
    planetId: planet.id,
    id,
    kind: order.kind,
    playerId: order.playerId,
    ...(order.building !== undefined ? { building: order.building } : {}),
    ...(order.level !== undefined ? { level: order.level } : {}),
    ...(order.unit !== undefined ? { unit: order.unit } : {}),
    ...(order.count !== undefined ? { count: order.count } : {}),
  });
  return null;
}

/** Может ли ждущий заказ вообще ещё приземлиться. Проверяется ПЕРЕД оплатой: платить
 *  за апгрейд снесённого здания и терять деньги на пороге — худший из возможных
 *  ответов игроку. Возвращает false → заказ выбрасывается из очереди. */
function queuedStillValid(h: HandlerContext, planet: Planet, q: QueuedConstruction): boolean {
  if (q.kind === 'building' && typeof q.building === 'string') {
    return !atInstanceCap(h, planet, q.building);
  }
  if (q.kind === 'upgrade' && typeof q.building === 'string' && typeof q.level === 'number') {
    const instance = q.uid
      ? planet.buildings.find((b) => b.uid === q.uid)
      : planet.buildings.find((b) => b.type === q.building);
    return !!instance && instance.level === q.level - 1;
  }
  return q.kind === 'unit' && typeof q.unit === 'string' && typeof q.count === 'number';
}

/** Назначить повтор попытки старта (правило 4), не плодя дублей. */
function scheduleQueuePump(h: HandlerContext, planetId: string, lane: BuildLane): void {
  const pending = h.state.scheduled.some((e) => {
    if (e.type !== 'construction.queue.pump') return false;
    const p = e.payload as { planetId?: string; lane?: string };
    return p.planetId === planetId && p.lane === lane;
  });
  if (pending) return;
  h.schedule(h.ctx.now + hoursToMs(h.ctx, QUEUE_RETRY_HOURS), 'construction.queue.pump', {
    planetId,
    lane,
  });
}

/**
 * Пустить голову полосы, если можно. Единственная точка старта из очереди: её зовут
 * завершение стройки, отмена и повтор по таймеру.
 *
 * Порядок проверок — фикс: полоса занята → нечего решать; заказ протух → выбросить и
 * взяться за следующий; денег нет → ЖДАТЬ (заказ остаётся головой, назначается повтор).
 */
/**
 * УЗЕЛ НЕ РАБОТАЕТ — и почему именно. Две разные беды с разными сообщениями игроку:
 * обстрел с орбиты и бой прямо здесь (решение владельца 17). Один дом на все ворота,
 * иначе шесть копий этого «или» разойдутся, как уже расходились два хука форта.
 *
 * Отдельный код для боя нужен, потому что `E_BOMBARDED` в этом случае СОВРЁТ: игрок
 * пойдёт искать чужой флот на орбите, а бой идёт у него под окнами.
 */
function suppressed(h: HandlerContext, planetId: string): 'E_BOMBARDED' | 'E_BATTLE_HERE' | null {
  if (isBombarded(h.state, planetId, h.ctx.data)) return 'E_BOMBARDED';
  if (battleAt(h.state, planetId)) return 'E_BATTLE_HERE';
  return null;
}

function startNextQueued(h: HandlerContext, planet: Planet, lane: BuildLane): void {
  if (laneBusy(h, planet.id, lane)) return;
  if (suppressed(h, planet.id)) return; // узел не работает — не старт, а пауза
  for (;;) {
    const queue = planet.buildQueue ?? [];
    const head = queue.find((q) => laneOfKind(q.kind) === lane);
    if (!head) return;
    const drop = (): void => {
      planet.buildQueue = (planet.buildQueue ?? []).filter((q) => q.id !== head.id);
      if (planet.buildQueue.length === 0) delete planet.buildQueue;
    };
    const player = h.state.players[head.playerId];
    const spec = orderSpec(h.ctx.data, head);
    if (!player || planet.owner !== head.playerId || !spec || !queuedStillValid(h, planet, head)) {
      drop();
      h.emit('construction.queue.dropped', {
        planetId: planet.id,
        id: head.id,
        kind: head.kind,
        playerId: head.playerId,
      });
      continue; // следующий заказ той же полосы получает свой шанс в этот же миг
    }
    if (!canAfford(player.resources, spec.cost)) {
      scheduleQueuePump(h, planet.id, lane);
      return;
    }
    payCost(player.resources, spec.cost);
    drop();
    scheduleCompletion(h, spec.hours, {
      kind: head.kind,
      planetId: planet.id,
      playerId: head.playerId,
      building: head.building,
      level: head.level,
      uid: head.uid,
      unit: head.unit,
      count: head.count,
      modules: head.modules,
    });
    h.emit('construction.started', {
      kind: head.kind,
      planetId: planet.id,
      playerId: head.playerId,
      ...(head.building !== undefined ? { building: head.building } : {}),
      ...(head.level !== undefined ? { level: head.level } : {}),
      ...(head.unit !== undefined ? { unit: head.unit } : {}),
      ...(head.count !== undefined ? { count: head.count } : {}),
      fromQueue: true,
    });
    return;
  }
}

/** Строительные способности здания — те, что гейтят `unit.build`. */
type ConstructionCapability =
  | 'enablesShipConstruction'
  | 'enablesInfantryConstruction'
  | 'enablesVehicleConstruction';

/** Открыта ли способность у здания ЭТОГО уровня. База — флаг самого здания; дальше
 *  способность может открыть любой ПРОЙДЕННЫЙ апгрейд, и назад она не выключается
 *  (см. `BuildingLevelSchema`: «уровень открывает», а не «уровень умеет»).
 *
 *  Раньше здесь читался только базовый def, и это делало данные немой опечаткой:
 *  здание объявляет способность в апгрейдах — «второй уровень открывает», — а гейт
 *  этого не видел, и юнит оказывался непостроим вовсе. Та же ловушка сторожится для
 *  вместимости ангара (`shuttleBay`, SHU-1.1), которую читает `shuttleBayAt`. */
function capabilityAt(def: BuildingDef, level: number, key: ConstructionCapability): boolean {
  if (def[key]) return true;
  for (let l = 2; l <= level; l++) {
    if (def.upgrades[l - 2]?.[key]) return true;
  }
  return false;
}

/** True if some standing (undestroyed) building on the planet has the capability at
 *  its current level. */
function hasCapability(planet: Planet, data: GameData, key: ConstructionCapability): boolean {
  return planet.buildings.some((b) => {
    if (b.hp <= 0) return false;
    const def = data.buildings[b.type];
    return def ? capabilityAt(def, b.level, key) : false;
  });
}

/** The yard a space-domain hull needs to be laid down (shipyard/spaceport). Ground
 *  units never check this. */
function hasShipyard(planet: Planet, data: GameData): boolean {
  return hasCapability(planet, data, 'enablesShipConstruction');
}

/** Какой уровень верфи нужен корпусу этого класса (решение владельца 15). Класс не
 *  объявлен — корабль довольствуется любой верфью, как было до FORT-5.5. */
const YARD_LEVEL_FOR: Record<string, number> = { light: 1, medium: 2, heavy: 3 };

/** Самый большой СТАПЕЛЬ узла: максимальный уровень среди живых верфей. Максимум, а не
 *  сумма: две верфи первого уровня не собирают линкор — нужен один стапель нужного
 *  размера. (Ср. `shuttleBay`, где вместимость как раз СКЛАДЫВАЕТСЯ: причалов может быть
 *  много, а стапель для корпуса нужен один.) */
function yardLevelAt(planet: Planet, data: GameData): number {
  let best = 0;
  for (const b of planet.buildings) {
    if (b.hp <= 0) continue;
    const def = data.buildings[b.type];
    // Способность читается через `capabilityAt`, а НЕ через `buildingLevel`: разбор
    // уровня отдаёт числовые поля, а флаги способностей в него не входят вовсе, и
    // `buildingLevel(def, 1).enablesShipConstruction` молча равен `undefined`. На этом
    // первая версия и попалась — лёгкий корпус не проходил на верфи первого уровня.
    if (def && capabilityAt(def, b.level, 'enablesShipConstruction')) best = Math.max(best, b.level);
  }
  return best;
}

/** Сколько ЕЩЁ челноков примет мир (SHU-1.1): вместимость стоящих портов минус уже
 *  базирующиеся минус уже заказанные и не достроенные.
 *
 *  Очередь считается вместе с ангаром намеренно. Иначе десять заказов по одному прошли
 *  бы там, где один заказ на десять честно отбивается: каждый по отдельности видел бы
 *  пустой ангар, а на выходе порт получил бы вдесятеро больше, чем вмещает. */
function hangarFree(h: HandlerContext, planet: Planet): number {
  const data = h.ctx.data;
  let queued = 0;
  for (const e of h.state.scheduled) {
    if (e.type !== 'construction.complete') continue;
    const p = e.payload as CompletePayload;
    if (p.kind !== 'unit' || p.planetId !== planet.id || typeof p.unit !== 'string') continue;
    if (data.units[p.unit]?.traits.includes('shuttle')) queued += p.count ?? 0;
  }
  return shuttleBayAt(planet, data) - hangarUsed(planet) - queued;
}

/** Здание, без которого наземный юнит не заложить: КАЗАРМЫ для пехоты, ЗАВОД для
 *  техники (ROS-1.1). Род войск живёт в данных (`UnitDef.kind`), поэтому новый род
 *  вводится юнитом и зданием, а не правкой этой функции. */
const GROUND_FACILITY = {
  infantry: { capability: 'enablesInfantryConstruction', code: 'E_NO_BARRACKS' },
  vehicle: { capability: 'enablesVehicleConstruction', code: 'E_NO_FACTORY' },
} as const satisfies Record<string, { capability: ConstructionCapability; code: string }>;

function hasGroundFacility(planet: Planet, data: GameData, kind: UnitDef['kind']): boolean {
  return hasCapability(planet, data, GROUND_FACILITY[kind].capability);
}

/**
 * ГДЕ ЭТОТ ЮНИТ ВООБЩЕ МОЖНО ЗАЛОЖИТЬ — тот же гейт зданий, что применяет `unit.build`,
 * вынесенный наружу чистой функцией. Возвращает код отказа или `null`, если мир годится.
 *
 * Экспортируется РАДИ ИНТЕРФЕЙСА (ROS-3.1):
 * экран «Производство» показывает список миров, где заказ пройдёт, и своя копия этих
 * правил разъехалась бы на первой же правке — игрок выбирал бы мир, на котором ядро
 * отвечает отказом. Спрашивать надо ту функцию, по которой ядро и решает.
 *
 * Считается только ПОСТОЯННАЯ половина гейта — здания. Очередь (`E_HANGAR_FULL`) сюда не
 * входит: она зависит от уже поставленных заказов, то есть от расписания, которого у
 * чистой функции нет, и остаётся ответом ядра в момент приказа.
 */
export function unitBuildSiteBlocker(
  planet: Planet,
  def: UnitDef,
  data: GameData,
): 'E_NO_PORT' | 'E_NO_SHIPYARD' | 'E_NO_BARRACKS' | 'E_NO_FACTORY' | null {
  if (def.traits.includes('shuttle')) {
    return shuttleBayAt(planet, data) > 0 ? null : 'E_NO_PORT';
  }
  if (def.domain === 'space') {
    return hasShipyard(planet, data) ? null : 'E_NO_SHIPYARD';
  }
  if (def.domain === 'ground') {
    return hasGroundFacility(planet, data, def.kind) ? null : GROUND_FACILITY[def.kind].code;
  }
  return null;
}

function requireUnlocked(
  h: HandlerContext,
  playerId: string,
  kind: 'unit' | 'building',
  id: string,
): void {
  const requirement = h.hook<ConstructionRequirement>(
    'construction.requirement',
    { allowed: true },
    { playerId, kind, id },
  );
  if (!requirement.allowed) {
    return h.reject(requirement.code ?? 'E_LOCKED');
  }
}

/** Resolves the acting player and a planet they own, or rejects with a stable
 *  code (E_NO_PLANET / E_FORBIDDEN). Shared by every build / upgrade order. */
function ownedPlanet(
  h: HandlerContext,
  action: Action,
  planetId: string,
): { planet: Planet; player: Player } {
  const planet = h.state.planets[planetId];
  if (!planet) {
    return h.reject('E_NO_PLANET');
  }
  if (planet.owner !== action.playerId) {
    return h.reject('E_FORBIDDEN');
  }
  const player = h.state.players[action.playerId];
  if (!player) {
    return h.reject('E_FORBIDDEN'); // no treasury / not a participant
  }
  return { planet, player };
}

// --- building combat helpers -------------------------------------------------

/**
 * Прикрывают ли постройки мира того, кто сейчас получает урон (решение владельца 5,
 * fortress-roadmap §0.6): владельца — да, его СОЮЗНИКА — тоже, остальных — нет.
 *
 * Предикат ОДИН на оба хука наземной защиты (`defenseBonus` и скидка за число зданий).
 * Держать его в двух местах значило бы дать им разойтись: ровно это и случилось при
 * первой правке — союзник начал получать бонус форта, но не однопроцентную скидку, и
 * игрок увидел бы необъяснимо частичное прикрытие.
 *
 * Проверка именно «владелец ИЛИ союзник», а не «не враг»: снять её целиком значило бы
 * прикрыть и ШТУРМУЮЩЕГО, стоящего на вашей же земле, то есть заставить форт работать на
 * захватчика. Союзник здесь — ровно `alliance` (см. {@link isAllied}): перемирие и пакт
 * войсками не делятся, значит и прикрытием не делятся тоже.
 */
function fortificationCovers(
  h: HandlerContext,
  location: string | undefined,
  defender: string | undefined,
): Planet | null {
  if (!location || defender === undefined) return null;
  const planet = h.state.planets[location];
  if (!planet || planet.owner === null) return null;
  if (planet.owner === defender || isAllied(h, planet.owner, defender)) return planet;
  return null;
}

/** Total ground-defense bonus a planet's standing buildings grant its garrison. */
function totalDefenseBonus(planet: Planet, data: GameData): number {
  let bonus = 0;
  for (const b of planet.buildings) {
    const def = data.buildings[b.type];
    if (def) {
      bonus += buildingLevel(def, b.level).defenseBonus;
    }
  }
  return bonus;
}

/** Wears `amount` of structural damage across a planet's buildings (array order,
 *  carrying overflow). Buildings with no modelled HP are untouched; ones whose
 *  HP reaches zero are removed and announced via `building.destroyed`. `owner` is
 *  passed in (not read from the planet) because a capture may have already
 *  flipped `planet.owner` by the time the round's damage is applied. */
function damageBuildings(
  h: HandlerContext,
  planet: Planet,
  amount: number,
  owner: string | null,
): void {
  let remaining = amount;
  const survivors: BuildingInstance[] = [];
  for (const b of planet.buildings) {
    const def = h.ctx.data.buildings[b.type];
    const maxHp = def ? buildingLevel(def, b.level).hp : 0;
    if (maxHp <= 0) {
      survivors.push(b); // not modelled as destructible
      continue;
    }
    const absorbed = Math.min(remaining, b.hp);
    b.hp -= absorbed;
    remaining -= absorbed;
    if (b.hp > 0) {
      survivors.push(b);
    } else {
      h.emit('building.destroyed', { planetId: planet.id, building: b.type, owner });
    }
  }
  planet.buildings = survivors;
  // Разрушенное здание уносит выданный им гарнизон: иначе защитники пережили бы то, что
  // их породило, и мир остался бы «занят» призраками снесённого форта.
  syncIssuedGarrison(h, planet);
}

/**
 * Buildings — a base module (docs/modulesystem.md). It owns everything about
 * planet structures:
 *
 *   - orders: `building.construct` / `building.upgrade` / `unit.build`, each
 *     paid up-front from the ordering player's treasury (`Player.resources`) and
 *     finished after `buildTimeHours` (timeScale-scaled) via a scheduled
 *     `construction.complete`. Fail-secure: an unaffordable / unauthorized order
 *     is rejected and charges nothing (OWASP A10). Delivery is gated on still
 *     owning the planet — lose it mid-build and the investment is forfeited.
 *   - defense: each standing building toughens the garrison through the
 *     `combat.damage` hook (the `defenseBonus`, +1% by default, more for a
 *     fortress, growing with level — GDD §7).
 *   - destruction: the ground assault wears down building HP each round; a
 *     destroyed building stops granting its bonus (GDD §7.4). (A distinct
 *     orbital-bombardment pass, with its own magnitude, is a future refinement.)
 */
export const constructionModule: GameModule = {
  id: 'construction',
  version: '1.0.0',
  setup(api) {
    api.onAction('building.construct', (action, h) => {
      const payload = action.payload as Partial<ConstructBuildingPayload>;
      if (typeof payload?.planetId !== 'string' || typeof payload?.building !== 'string') {
        return h.reject('E_BAD_PAYLOAD');
      }
      const { planet, player } = ownedPlanet(h, action, payload.planetId);
      const stopped = suppressed(h, planet.id);
      if (stopped) {
        return h.reject(stopped); // узел не работает: обстрел либо бой прямо здесь
      }
      const def = h.ctx.data.buildings[payload.building];
      if (!def) {
        return h.reject('E_UNKNOWN_BUILDING');
      }
      // Province type decides construction in TWO steps, and both are gates here.
      //
      // 1. `buildable` — can anything at all be raised on this province type? Until
      //    SEC/BLD-… this flag was declared in `sectorKinds` and read by nobody but the
      //    map renderer, so `buildable: false` blocked nothing: `empty`/`debris_field`
      //    were safe only because they ALSO carry `allowedBuildings: []`. Same defect
      //    `orbit` had before ORB-1 turned it into a rule; this is that fix for
      //    `buildable`. Now a nebula or an ion storm needs no roster to host nothing.
      if (!isBuildable(h.ctx.data, planet)) {
        return h.reject('E_WRONG_SECTOR'); // nothing is raised on this province type
      }
      // 2. `allowedBuildings` — WHICH structures a buildable province type hosts.
      //    undefined roster (kind-less / unknown / roster-less) = any building —
      //    kind-less scenario worlds keep building exactly as before. An explicit
      //    `[]` means "no construction here" (empty / debris).
      const roster = allowedBuildings(h.ctx.data, planet);
      if (roster !== undefined && !roster.includes(payload.building)) {
        return h.reject('E_WRONG_SECTOR'); // this structure does not fit this province type
      }
      // 3. `onlyOn` — ограничение со стороны САМОГО ЗДАНИЯ (решение владельца 3): «строится
      //    ТОЛЬКО там-то». Ростером вида этого не выразить: у планеты ростера нет вовсе
      //    (undefined = любое здание), и запретить ей добывающую станцию можно было бы
      //    лишь выписав поимённый список всех ОСТАЛЬНЫХ зданий — список, устаревающий на
      //    первом же новом здании, причём молча. Ворота те же и код отказа тот же: игроку
      //    важно «сюда нельзя», а не чьё правило сработало.
      const onlyOn = h.ctx.data.buildings[payload.building]?.onlyOn;
      if (onlyOn !== undefined && !onlyOn.includes(planet.kind ?? '')) {
        return h.reject('E_WRONG_SECTOR');
      }
      // 4. `buildSlots` — СКОЛЬКО построек узел вообще вмещает (решения 10 и 11). Своё
      //    место в порядке ворот: первые три отвечают «что сюда ставят», это — «влезет
      //    ли ещё одна». Код отказа поэтому другой: «сюда нельзя» и «места кончились»
      //    игроку говорят разное, и второе лечится прокачкой. Не `E_NO_SLOTS` — тот уже
      //    занят фиттингами корабля, и его текст («слоты фиттингов заняты») в ответ на
      //    заказ постройки соврал бы.
      const slots = slotsAt(h, planet);
      if (slots && slots.used >= slots.capacity) {
        return h.reject('E_NO_BUILD_SLOTS');
      }
      requireUnlocked(h, action.playerId, 'building', payload.building);
      if (atInstanceCap(h, planet, payload.building)) {
        return h.reject('E_ALREADY_BUILT'); // лимит экземпляров исчерпан (maxPerPlanet)
      }
      if (isQueued(h, 'building', planet.id, payload.building)) {
        return h.reject('E_ALREADY_QUEUED');
      }
      if (
        planet.pausedConstruction?.some(
          (s) => s.kind === 'building' && s.building === payload.building,
        )
      ) {
        return h.reject('E_ALREADY_PAUSED'); // resume it instead of re-ordering fresh
      }
      // BLD-1: полоса занята — заказ встаёт в очередь и стартует сам. Денег у него
      // здесь не спрашивают: он сейчас и не стартует (правило 3).
      if (laneBusy(h, planet.id, 'buildings')) {
        const code = enqueueOrder(h, planet, {
          kind: 'building',
          playerId: action.playerId,
          building: payload.building,
        });
        return code ? h.reject(code) : undefined;
      }
      const level1 = buildingLevel(def, 1);
      if (!canAfford(player.resources, level1.cost)) {
        return h.reject('E_INSUFFICIENT');
      }
      payCost(player.resources, level1.cost);
      scheduleCompletion(h, level1.buildTimeHours, {
        kind: 'building',
        planetId: planet.id,
        playerId: action.playerId,
        building: payload.building,
      });
      h.emit('construction.started', {
        kind: 'building',
        planetId: planet.id,
        building: payload.building,
        playerId: action.playerId,
      });
    });

    api.onAction('building.upgrade', (action, h) => {
      const payload = action.payload as Partial<ConstructBuildingPayload & { uid?: string }>;
      if (typeof payload?.planetId !== 'string' || typeof payload?.building !== 'string') {
        return h.reject('E_BAD_PAYLOAD');
      }
      const { planet, player } = ownedPlanet(h, action, payload.planetId);
      const stopped = suppressed(h, planet.id);
      if (stopped) {
        return h.reject(stopped); // узел не работает: обстрел либо бой прямо здесь
      }
      // RULES-2.1: address a SPECIFIC instance by uid when maxPerPlanet > 1.
      // Without uid (old client / maxPerPlanet=1), fall back to find-by-type.
      const instance = payload.uid
        ? planet.buildings.find((b) => b.uid === payload.uid)
        : planet.buildings.find((b) => b.type === payload.building);
      if (!instance) {
        return h.reject('E_NO_BUILDING'); // nothing of that type to upgrade
      }
      const def = h.ctx.data.buildings[instance.type];
      if (!def) {
        return h.reject('E_UNKNOWN_BUILDING');
      }
      const nextLevel = instance.level + 1;
      if (nextLevel > buildingMaxLevel(def)) {
        return h.reject('E_MAX_LEVEL');
      }
      if (isQueued(h, 'upgrade', planet.id, instance.type)) {
        return h.reject('E_ALREADY_QUEUED');
      }
      if (
        planet.pausedConstruction?.some((s) => s.kind === 'upgrade' && s.building === instance.type)
      ) {
        return h.reject('E_ALREADY_PAUSED'); // resume it instead of re-ordering fresh
      }
      if (laneBusy(h, planet.id, 'buildings')) {
        const code = enqueueOrder(h, planet, {
          kind: 'upgrade',
          playerId: action.playerId,
          building: instance.type,
          level: nextLevel,
          uid: instance.uid,
        });
        return code ? h.reject(code) : undefined;
      }
      const next = buildingLevel(def, nextLevel);
      if (!canAfford(player.resources, next.cost)) {
        return h.reject('E_INSUFFICIENT');
      }
      payCost(player.resources, next.cost);
      scheduleCompletion(h, next.buildTimeHours, {
        kind: 'upgrade',
        planetId: planet.id,
        playerId: action.playerId,
        building: instance.type,
        level: nextLevel,
        uid: instance.uid,
      });
      h.emit('construction.started', {
        kind: 'upgrade',
        planetId: planet.id,
        building: instance.type,
        level: nextLevel,
        playerId: action.playerId,
      });
    });

    api.onAction('unit.build', (action, h) => {
      const payload = action.payload as Partial<BuildUnitPayload>;
      if (typeof payload?.planetId !== 'string' || typeof payload?.unit !== 'string') {
        return h.reject('E_BAD_PAYLOAD');
      }
      const count = payload.count ?? 1;
      if (!Number.isSafeInteger(count) || count <= 0) {
        return h.reject('E_BAD_PAYLOAD');
      }
      const { planet, player } = ownedPlanet(h, action, payload.planetId);
      const stopped = suppressed(h, planet.id);
      if (stopped) {
        return h.reject(stopped); // узел не работает: обстрел либо бой прямо здесь
      }
      const def = h.ctx.data.units[payload.unit];
      if (!def) {
        return h.reject('E_UNKNOWN_UNIT');
      }
      // ВЫДАВАЕМОЕ НЕ ЗАКАЗЫВАЮТ: трейт `issued` значит «этот отряд приходит вместе с
      // сооружением, которому принадлежит» — орудия крепости (FORT-5.4), гарнизон форта
      // (FORT-2.2). Без этих ворот орудия крепости заказывались бы на любой верфи как
      // обычный корабль: домен у них космический, а верфь в ростере крепости есть.
      //
      // Мерять по `immobile` было БЫ ОШИБКОЙ, и её поймал сторож `autoRally`: неподвижность
      // и «не заказывается» — разные вещи. Стационарная зенитка в гарнизоне тоже неподвижна,
      // но её игрок как раз строит, и близкий зенитный залп на этом и держится.
      if (def.traits.includes('issued')) {
        return h.reject('E_NOT_BUILDABLE');
      }
      requireUnlocked(h, action.playerId, 'unit', payload.unit);
      // Челнок строится В КОСМОПОРТЕ и остаётся в нём: порт — и гейт, и предел
      // (SHU-1.1). Ноль вместимости читается как «порта нет» — отдельного флага
      // «умеет ангар» больше нет, чтобы две правды не разъезжались.
      const isShuttle = def.traits.includes('shuttle');
      if (isShuttle) {
        if (shuttleBayAt(planet, h.ctx.data) <= 0) {
          return h.reject('E_NO_PORT');
        }
        if (hangarFree(h, planet) < count) {
          return h.reject('E_HANGAR_FULL');
        }
      }
      if (!isShuttle && def.domain === 'space' && !hasShipyard(planet, h.ctx.data)) {
        return h.reject('E_NO_SHIPYARD');
      }
      // Класс корпуса против размера стапеля (решение владельца 15). Отдельный код от
      // `E_NO_SHIPYARD`: «верфи нет» и «верфь мала» игроку говорят разное — первое лечится
      // постройкой, второе прокачкой, и подменять их значило бы отправить его строить
      // вторую верфь там, где нужна та же, но выше.
      if (!isShuttle && def.domain === 'space' && def.hullClass) {
        const need = YARD_LEVEL_FOR[def.hullClass] ?? 1;
        if (yardLevelAt(planet, h.ctx.data) < need) {
          return h.reject('E_YARD_TOO_SMALL');
        }
      }
      // Наземный юнит идёт в СВОЁ здание: пехота в казармы, техника на завод
      // (ROS-1.1). Отказ называет недостающее здание, а не «наземное производство» —
      // игроку из кода отказа должно быть видно, что именно строить.
      if (def.domain === 'ground' && !hasGroundFacility(planet, h.ctx.data, def.kind)) {
        return h.reject(GROUND_FACILITY[def.kind].code);
      }
      // ARS-3 ownership gate: a seat with an arsenal SNAPSHOT builds only what it
      // owns — the hull and every module must be listed (fail-secure E_NOT_OWNED).
      // No snapshot on the player ⇒ no restriction (regular/dev matches unchanged).
      //
      // ГЕЙТ СПРАШИВАЕТ ТОЛЬКО ПРО КОРАБЛИ (решение владельца 2026-09-15). Пока он не
      // различал домен, гейтированное место (человеческое кресло AvA) не могло построить
      // НИ ОДНОГО наземного юнита: снапшот перечисляет корпуса кораблей, а пехоты и
      // техники в нём не бывает никогда. Кресло получало стартовый гарнизон и теряло
      // способность его пополнять — захват миров закрывался целиком, хотя казармы с
      // заводом стояли. Замысел арсенала (`docs/arsenal-roadmap.md`) — «корпуса КОРАБЛЕЙ,
      // модули, фитинги героев», и наземка в него не входила ни дня; поэтому сузилось
      // ПРАВИЛО, а не расширился список. Наземный род войск гейтят ЗДАНИЯ (выше).
      const arsenal = def.domain === 'ground' ? undefined : player.arsenal;
      if (arsenal && !arsenal.hulls.includes(payload.unit)) {
        return h.reject('E_NOT_OWNED');
      }
      const modules = payload.modules;
      if (modules !== undefined) {
        if (!Array.isArray(modules) || !modules.every((m) => typeof m === 'string')) {
          return h.reject('E_BAD_PAYLOAD');
        }
        if (arsenal && modules.some((m) => !arsenal.modules.includes(m))) {
          return h.reject('E_NOT_OWNED');
        }
        const valid = validateLoadout(payload.unit, def, modules, h.ctx.data);
        if (!valid.ok) return h.reject(valid.code);
      }
      if (laneBusy(h, planet.id, 'units')) {
        const code = enqueueOrder(h, planet, {
          kind: 'unit',
          playerId: action.playerId,
          unit: payload.unit,
          count,
          ...(modules && modules.length > 0 ? { modules } : {}),
        });
        return code ? h.reject(code) : undefined;
      }
      // The loadout is paid up-front with the hull and locked onto the built stack.
      const perShip =
        modules && modules.length > 0
          ? sumBags(def.cost, loadoutCost(modules, h.ctx.data))
          : def.cost;
      const cost = scaleCost(perShip, count);
      if (!canAfford(player.resources, cost)) {
        return h.reject('E_INSUFFICIENT');
      }
      payCost(player.resources, cost);
      scheduleCompletion(h, def.buildTimeHours, {
        kind: 'unit',
        planetId: planet.id,
        playerId: action.playerId,
        unit: payload.unit,
        count,
        ...(modules && modules.length > 0 ? { modules } : {}),
      });
      h.emit('construction.started', {
        kind: 'unit',
        planetId: planet.id,
        unit: payload.unit,
        count,
        playerId: action.playerId,
      });
    });

    // Cancel an ACTIVE (already paid, already ticking) build/upgrade/unit order:
    // refunds the unbuilt share of its cost and parks it as a resumable paused site
    // — the investment isn't lost, just halted (GDD: partial-refund cancel). The
    // building never existed in `planet.buildings` to begin with (it only lands
    // there on `construction.complete`), so there's nothing else to roll back.
    api.onAction('construction.cancel', (action, h) => {
      const payload = action.payload as Partial<CancelConstructionPayload>;
      if (typeof payload?.planetId !== 'string' || typeof payload?.seq !== 'number') {
        return h.reject('E_BAD_PAYLOAD');
      }
      const { planet, player } = ownedPlanet(h, action, payload.planetId);
      // BLD-1. Один номер — один заказ, независимо от того, СТРОИТСЯ он или ЖДЁТ:
      // `id` ждущего берётся из того же счётчика, что и `seq` запланированного, так
      // что перепутать их нельзя. Игроку это одна кнопка «отменить», а не две.
      const waiting = (planet.buildQueue ?? []).find((q) => q.id === payload.seq);
      if (waiting) {
        if (waiting.playerId !== action.playerId) {
          return h.reject('E_FORBIDDEN');
        }
        planet.buildQueue = (planet.buildQueue ?? []).filter((q) => q.id !== payload.seq);
        if (planet.buildQueue.length === 0) delete planet.buildQueue;
        // Возврата нет и быть не может: ждущий заказ не оплачен (правило 2). Поэтому
        // же он не становится `PausedConstructionSite` — возобновлять нечего.
        h.emit('construction.cancelled', {
          planetId: planet.id,
          seq: payload.seq,
          kind: waiting.kind,
          progress: 0,
          playerId: action.playerId,
          waiting: true,
        });
        return;
      }
      const event = h.state.scheduled.find(
        (e) => e.type === 'construction.complete' && e.seq === payload.seq,
      );
      if (!event) {
        return h.reject('E_NOT_ACTIVE'); // already completed, or never existed
      }
      const p = event.payload as CompletePayload;
      if (p.planetId !== planet.id || p.playerId !== action.playerId) {
        return h.reject('E_FORBIDDEN'); // that seq belongs to someone else's order
      }
      const spec = orderSpec(h.ctx.data, p);
      if (!spec) {
        return h.reject('E_UNKNOWN_BUILDING');
      }
      const totalDurationMs = hoursToMs(h.ctx, spec.hours);
      const progress = buildProgress(h.ctx.now, event.at, totalDurationMs);
      const refund = scaleCost(spec.cost, 1 - progress); // linear, NOT the 50% output threshold
      refundCost(player.resources, refund);
      h.state.scheduled = h.state.scheduled.filter((e) => e.seq !== payload.seq);
      const site: PausedConstructionSite = {
        id: payload.seq,
        kind: p.kind === 'unit' || p.kind === 'upgrade' ? p.kind : 'building',
        playerId: action.playerId,
        building: p.building,
        level: p.level,
        unit: p.unit,
        count: p.count,
        modules: p.modules,
        progress,
        remainingHours: spec.hours * (1 - progress),
        remainingCost: refund,
      };
      planet.pausedConstruction = [...(planet.pausedConstruction ?? []), site];
      h.emit('construction.cancelled', {
        planetId: planet.id,
        seq: payload.seq,
        kind: site.kind,
        progress,
        playerId: action.playerId,
      });
      // Полоса освободилась — её занимает следующий по очереди (BLD-1). Ровно это и
      // делает отмену осмысленной кнопкой: «убрать текущее» = «пустить следующее».
      startNextQueued(h, planet, laneOfKind(p.kind));
    });

    // Resume a paused site: pays exactly what was refunded, re-schedules exactly the
    // remaining duration (not the full one) — the build continues from where it was
    // paused, it does not restart.
    api.onAction('construction.resume', (action, h) => {
      const payload = action.payload as Partial<ResumeConstructionPayload>;
      if (typeof payload?.planetId !== 'string' || typeof payload?.id !== 'number') {
        return h.reject('E_BAD_PAYLOAD');
      }
      const { planet, player } = ownedPlanet(h, action, payload.planetId);
      const stopped = suppressed(h, planet.id);
      if (stopped) {
        return h.reject(stopped); // узел не работает: обстрел либо бой прямо здесь
      }
      const paused = planet.pausedConstruction ?? [];
      const site = paused.find((s) => s.id === payload.id);
      if (!site) {
        return h.reject('E_NOT_PAUSED');
      }
      if (site.kind === 'building' && typeof site.building === 'string') {
        if (atInstanceCap(h, planet, site.building)) {
          return h.reject('E_ALREADY_BUILT');
        }
        if (isQueued(h, 'building', planet.id, site.building)) {
          return h.reject('E_ALREADY_QUEUED');
        }
      } else if (
        site.kind === 'upgrade' &&
        typeof site.building === 'string' &&
        typeof site.level === 'number'
      ) {
        const instance = site.uid
          ? planet.buildings.find((b) => b.uid === site.uid)
          : planet.buildings.find((b) => b.type === site.building);
        if (!instance || instance.level !== site.level - 1) {
          return h.reject('E_STALE_CONSTRUCTION'); // building moved on without this upgrade
        }
        if (isQueued(h, 'upgrade', planet.id, site.building)) {
          return h.reject('E_ALREADY_QUEUED');
        }
      }
      // BLD-1: возобновление — это СТАРТ, а полоса одна. В очередь его не ставим:
      // приостановленная стройка уже хранит свой прогресс и остаток цены отдельно
      // (`PausedConstructionSite`), и заводить ей второе место ожидания значило бы
      // держать одну сущность в двух списках. Игрок возобновит, когда полоса освободится.
      if (laneBusy(h, planet.id, laneOfKind(site.kind))) {
        return h.reject('E_LANE_BUSY');
      }
      if (!canAfford(player.resources, site.remainingCost)) {
        return h.reject('E_INSUFFICIENT');
      }
      payCost(player.resources, site.remainingCost);
      planet.pausedConstruction = paused.filter((s) => s.id !== payload.id);
      scheduleCompletion(h, site.remainingHours, {
        kind: site.kind,
        planetId: planet.id,
        playerId: action.playerId,
        building: site.building,
        level: site.level,
        unit: site.unit,
        count: site.count,
        modules: site.modules,
      });
      h.emit('construction.resumed', {
        planetId: planet.id,
        id: payload.id,
        kind: site.kind,
        playerId: action.playerId,
      });
    });

    // BLD-1. Освободить полосу и пустить в неё следующего обязан КАЖДЫЙ путь, который
    // израсходовал событие завершения, — включая тихие «не приземлилось» ниже
    // (лимит экземпляров, здание ушло вперёд). Иначе полоса осталась бы занятой
    // навсегда: событие уже снято с таймлайна, а очередь ждёт его вечно. Единственное
    // исключение — отсрочка под бомбардировкой: там стройка НЕ закончилась.
    api.on('construction.complete', (event, h) => {
      const p = event.payload as CompletePayload;
      if (typeof p?.planetId !== 'string' || typeof p?.playerId !== 'string') {
        return; // malformed → no-op (fail-secure)
      }
      const planet = h.state.planets[p.planetId];
      if (!planet || planet.owner !== p.playerId) {
        return; // planet gone or captured mid-build → investment forfeited
      }
      if (suppressed(h, planet.id)) {
        // узел не работает (обстрел или бой) → отложить до лучших времён (scale the
        // retry by timeScale like every other duration, so a fast match isn't stuck)
        h.schedule(h.ctx.now + hoursToMs(h.ctx, 1), 'construction.complete', p);
        return;
      }
      landCompletion(h, planet, p);
      startNextQueued(h, planet, laneOfKind(p.kind));
    });

    // Повтор попытки для головы, упёршейся в деньги (правило 4). Сам себя не
    // перепланирует: новый повтор назначает только `startNextQueued`, и только если
    // денег снова не хватило, — очередь опустела или голова стартовала, цикл затих.
    api.on('construction.queue.pump', (event, h) => {
      const p = (event.payload ?? {}) as { planetId?: unknown; lane?: unknown };
      if (typeof p.planetId !== 'string') return;
      const lane: BuildLane = p.lane === 'units' ? 'units' : 'buildings';
      const planet = h.state.planets[p.planetId];
      if (!planet) return;
      startNextQueued(h, planet, lane);
    });

    /**
     * ГИБЕЛЬ КРЕПОСТИ СНОСИТ ВСЁ, ЧТО НА НЕЙ СТОЯЛО (FORT-5.13, решение владельца 22).
     *
     * Станция объявляет событие, а сносит ЭТОТ модуль — потому что здания его дом, и
     * вместе с ними здесь живут три вещи, которые прямое обнуление массива оставило бы
     * сиротами, каждая со своим видимым последствием:
     *
     *   · ВЫДАННЫЙ ФОРТОМ ГАРНИЗОН. `syncIssuedGarrison` ходит только путями стройки, и
     *     без него бойцы пережили бы породивший их форт. `captureOnArrival` увидел бы
     *     живой гарнизон и отказал в том самом «голом месте», ради которого решение 22
     *     и принималось.
     *   · ОЧЕРЕДЬ И ПРИОСТАНОВЛЕННЫЕ СТРОЙКИ. Ждущие заказы не оплачены, но остались бы
     *     планами на узле, которого больше нет.
     *   · ОПЛАЧЕННЫЕ ЗАВЕРШЕНИЯ В ТАЙМЛАЙНЕ. Вот это хуже всего: `landCompletion`
     *     вернувшийся вид узла НЕ перепроверяет, так что радар или верфь выросли бы на
     *     туманности уже ПОСЛЕ гибели крепости. Владельца гибель намеренно не меняет
     *     (узел стал своим захватом), поэтому проверка владельца в `construction.complete`
     *     такое завершение пропустила бы.
     *
     * Снос идёт теми же событиями `building.destroyed`, что и обстрел: журнал клиента и
     * сводка возвращения их уже понимают, и заводить рядом второе имя для того же факта
     * значило бы учить клиента одному и тому же дважды.
     */
    api.on('station.destroyed', (event, h) => {
      const p = (event.payload ?? {}) as { planetId?: unknown; owner?: unknown };
      if (typeof p.planetId !== 'string') return;
      const planet = h.state.planets[p.planetId];
      if (!planet) return;
      const owner = typeof p.owner === 'string' ? p.owner : planet.owner;
      for (const b of planet.buildings) {
        h.emit('building.destroyed', { planetId: planet.id, building: b.type, owner });
      }
      planet.buildings = [];
      syncIssuedGarrison(h, planet);
      delete planet.buildQueue;
      delete planet.pausedConstruction;
      h.state.scheduled = h.state.scheduled.filter(
        (e) =>
          e.type !== 'construction.complete' ||
          (e.payload as CompletePayload | undefined)?.planetId !== planet.id,
      );
    });

    // Захват стирает очередь прежнего хозяина (правило 6). Терять нечего — ждущие
    // заказы не оплачены; а оставить их значило бы показать новому владельцу планы
    // старого и однажды списать деньги с игрока за чужой мир.
    api.on('planet.captured', (event, h) => {
      const p = (event.payload ?? {}) as { planetId?: unknown };
      if (typeof p.planetId !== 'string') return;
      const planet = h.state.planets[p.planetId];
      if (planet?.buildQueue) delete planet.buildQueue;
    });

    function landCompletion(h: HandlerContext, planet: Planet, p: CompletePayload): void {
      if (p.kind === 'building' && typeof p.building === 'string') {
        // Same instance cap as the order gate, read from the same data field. This is
        // the LAST barrier (a duplicate/replayed completion must not double-build), so
        // it has to move with `maxPerPlanet` too: leaving `some(...)` here would accept
        // the order for a second instance, take the payment, then silently drop the
        // result. With the default cap of 1 this is bit-identical to the old check.
        if (atInstanceCap(h, planet, p.building)) {
          return; // cap reached (e.g. a duplicate queued order) → no-op
        }
        const def = h.ctx.data.buildings[p.building];
        const hp = def ? buildingLevel(def, 1).hp : 0;
        const uid = `b:${planet.id}:${p.building}:${h.ctx.now}:${p.seq ?? 0}`;
        planet.buildings.push({ uid, type: p.building, level: 1, hp });
        syncIssuedGarrison(h, planet);
        h.emit('building.constructed', {
          planetId: planet.id,
          building: p.building,
          owner: p.playerId,
        });
      } else if (
        p.kind === 'upgrade' &&
        typeof p.building === 'string' &&
        typeof p.level === 'number'
      ) {
        const instance = p.uid
          ? planet.buildings.find((b) => b.uid === p.uid)
          : planet.buildings.find((b) => b.type === p.building);
        const def = h.ctx.data.buildings[p.building];
        if (!instance || !def || instance.level !== p.level - 1) {
          return; // building gone or already changed → drop
        }
        instance.level = p.level;
        instance.hp = buildingLevel(def, p.level).hp;
        syncIssuedGarrison(h, planet);
        h.emit('building.upgraded', {
          planetId: planet.id,
          building: p.building,
          level: p.level,
          owner: p.playerId,
        });
      } else if (p.kind === 'unit' && typeof p.unit === 'string' && typeof p.count === 'number') {
        // Челнок сдают В ПОРТ (SHU-1.1) — он не гарнизон (не держит мир, не гибнет в
        // наземном штурме) и не флот (`autoRally` его не поднимает).
        const built = h.ctx.data.units[p.unit];
        // Звёздность модулей (SZE-1.1) берётся из СНИМКА арсенала места, а не из меты:
        // ядро во время матча мету не читает. Нет снимка (обычный матч) → ★0 у всех.
        const stars =
          typeof p.playerId === 'string' ? h.state.players[p.playerId]?.arsenal?.stars : undefined;
        if (built?.traits.includes('shuttle')) {
          // Готовая машина встаёт в ЭСКАДРУ (SHU-4.2), а не россыпью. Правило живёт в
          // `state/shuttle.ts` — там же, где вся арифметика ангара: своя копия здесь
          // разъехалась бы с посадкой вернувшегося вылета. Импортировать его из
          // модуля челноков нельзя вовсе — модули общаются только через шину.
          const seq = (h.state.squadronSeq ?? 0) + 1;
          h.state.squadronSeq = seq;
          planet.hangar = basedMachine(
            planet.hangar ?? [],
            p.unit,
            p.count,
            `sq:${p.playerId}:${seq}`,
            p.modules,
            stars,
          );
        } else {
          addUnits(planet.garrison, p.unit, p.count, p.modules, stars);
        }
        h.emit('unit.built', {
          planetId: planet.id,
          unit: p.unit,
          count: p.count,
          owner: p.playerId,
          ...(p.modules && p.modules.length > 0 ? { modules: p.modules } : {}),
        });
      }
    }

    // Standing buildings toughen the ground defence: they reduce the damage taken in
    // the ground phase by the planet's total defense bonus.
    //
    // Кого именно прикрывают — `fortificationCovers` (решение владельца 5): владельца и
    // его союзника. Раньше здесь стояло `planet.owner !== a.defender` → выход, то есть
    // союзник, приведший войска оборонять ВАШ мир, не получал ничего; расхождение было
    // тихим, потому что все тесты проверяли владельца, а после MSB-4 обороняющихся на
    // одном мире может быть несколько.
    api.hook<number>('combat.mitigation', (pool, args, h) => {
      const a = args as { phase?: string; location?: string; defender?: string };
      if (a.phase !== 'ground') return pool;
      const planet = fortificationCovers(h, a.location, a.defender);
      if (!planet) return pool;
      return pool + totalDefenseBonus(planet, h.ctx.data);
    });

    // Each standing building on the planet adds 1% worth of mitigation POINTS. This is
    // a SEPARATE parameter from `defenseBonus` (a per-building stat); this one counts
    // ALL buildings: 10 buildings = 0.1 points. PERK-2.1 removed the local 90% ceiling
    // this rule used to carry — the cap now belongs to the POOL (`MITIGATION_CAP`), so
    // four sources can no longer stack four separate ceilings.
    const GROUND_DAMAGE_REDUCTION_PER_BUILDING = 0.01;
    api.hook<number>('combat.mitigation', (pool, args, h) => {
      const a = args as { phase?: string; location?: string; defender?: string };
      if (a.phase !== 'ground') return pool;
      const planet = fortificationCovers(h, a.location, a.defender);
      if (!planet) return pool;
      const standing = planet.buildings.filter((b) => b.hp > 0).length;
      return pool + standing * GROUND_DAMAGE_REDUCTION_PER_BUILDING;
    });

    // The ground assault wears down the contested planet's structures each round
    // (GDD §7.4). The event carries the location and the defending owner, so this
    // still fires correctly on the round that ENDS the battle — by which point
    // combat has already removed the battle and may have flipped `planet.owner`.
    api.on('combat.round', (event, h) => {
      const p = event.payload as {
        phase?: string;
        location?: string;
        defender?: string;
        dmgToDefender?: number;
      };
      if (p.phase !== 'ground' || typeof p.location !== 'string') {
        return; // only the ground assault wears structures (orbital is fleet-vs-fleet)
      }
      if (typeof p.dmgToDefender !== 'number' || p.dmgToDefender <= 0) {
        return;
      }
      const planet = h.state.planets[p.location];
      if (!planet) {
        return;
      }
      damageBuildings(
        h,
        planet,
        p.dmgToDefender * STRUCTURE_DAMAGE_SHARE,
        p.defender ?? planet.owner,
      );
    });

    // Orbital bombardment wears structures the same way (combat measures the
    // firepower; the buildings module applies it — GDD §7.4).
    api.on('planet.bombarded', (event, h) => {
      const p = event.payload as { planetId?: string; power?: number; owner?: string | null };
      if (typeof p.planetId !== 'string' || typeof p.power !== 'number' || p.power <= 0) {
        return;
      }
      const planet = h.state.planets[p.planetId];
      if (!planet) {
        return;
      }
      damageBuildings(h, planet, p.power, p.owner ?? planet.owner);
    });

    // Hospital healing: regenerate garrison HP each tick proportional to the
    // planet's total `healRate` from standing buildings.
    api.on('time.advanced', (event, h) => {
      const { from, to } = event.payload as { from: number; to: number };
      const span = to - from;
      if (span <= 0) return;
      const scale = timeScaleOf(h.ctx);
      const hours = (span / MS_PER_HOUR) * scale;
      const data = h.ctx.data;

      // Узлы, где идёт бой ЛЮБОЙ фазы, не лечат гарнизон (решение владельца 17).
      // Прежде условием был только НАЗЕМНЫЙ бой, и это давало странность: флот врага
      // режется с крепостью на орбите, а её госпиталь спокойно штопает гарнизон.
      const fighting = battleLocations(h.state);

      /** Подлечить один стек наземных войск — доля от полного HP за час, как и было. */
      const mend = (stack: UnitStack, rate: number): void => {
        const unitDef = data.units[stack.unit];
        if (!unitDef) return;
        const fullHp = stack.count * (effectiveStats(unitDef, stack, data).hp ?? 0);
        const currentHp = stack.hp ?? fullHp;
        if (currentHp >= fullHp) return;
        const newHp = Math.min(fullHp, currentHp + rate * hours * fullHp);
        stack.hp = newHp >= fullHp ? undefined : newHp;
      };

      // Кого лечит госпиталь, стоящий на узле: гарнизон САМОГО узла и десант в трюме
      // припаркованных рядом флотов — своих и СОЮЗНЫХ (FORT-5.9, из описания построек
      // крепости: «когда флот игрока или союзника рядом, лечатся наземные войска в трюме»).
      // Прежде трюм не лечил никто и нигде: раненый десант оставался раненым навсегда,
      // если его не высадить.
      const landingsAt = new Map<string, UnitStack[]>();
      for (const fleet of Object.values(h.state.fleets)) {
        if (fleet.movement || fleet.battleId || !fleet.location) continue;
        const host = h.state.planets[fleet.location];
        if (!host || host.owner === null) continue;
        if (host.owner !== fleet.owner && !isAllied(h, fleet.owner, host.owner)) continue;
        const bucket = landingsAt.get(fleet.location) ?? [];
        for (const stack of fleet.landing ?? []) bucket.push(stack);
        if (bucket.length > 0) landingsAt.set(fleet.location, bucket);
      }

      for (const planet of Object.values(h.state.planets)) {
        if (planet.owner === null) continue;
        if (fighting.has(planet.id)) continue;
        const landings = landingsAt.get(planet.id) ?? [];
        if (planet.garrison.length === 0 && landings.length === 0) continue;
        let totalHealRate = 0;
        for (const b of planet.buildings) {
          if (b.hp <= 0) continue; // destroyed building contributes nothing
          const def = data.buildings[b.type];
          if (def) totalHealRate += buildingLevel(def, b.level).healRate;
        }
        if (totalHealRate <= 0) continue;
        for (const stack of planet.garrison) mend(stack, totalHealRate);
        for (const stack of landings) mend(stack, totalHealRate);
      }

      // Ship regen/repair — the two pools mend differently (shields-roadmap §1):
      //   • SHIELD (`shieldHp`) recharges for free anywhere out of combat, once past a
      //     short delay after the last hit (`lastDamagedAt`) — the async "hit-and-run"
      //     loop; paused entirely while in a battle.
      //   • HULL (`hp`) never regens for free: it repairs ONLY while the fleet is
      //     stationed over a FRIENDLY world (base rate + a repair building's healRate),
      //     and hull damage drags the fleet's speed (route.ts) until mended.
      const SHIELD_REGEN = 0.06; // shield-pool fraction restored per game-hour
      const SHIELD_REGEN_DELAY = MS_PER_HOUR; // shields stay down this long after a hit
      for (const fleet of Object.values(h.state.fleets)) {
        if (fleet.battleId) continue; // a fleet in combat regenerates nothing
        // Решение владельца 17: пока на узле идёт бой, док не чинит — даже флот, который
        // сам в драку не втянут. Прежде такой флот спокойно чинился посреди сражения.
        if (fleet.location !== null && fighting.has(fleet.location)) continue;

        // Корпус чинится только у ДРУЖЕСТВЕННОГО мира с верфью или космопортом
        // (`shipRepair`, shields-roadmap SH-2.1) — нет дока, нет починки. «Дружественный»
        // с FORT-5.8 значит свой ИЛИ союзный: правило одно на все три пути ремонта, и
        // живёт оно в `fleetAtOwnDock`. Частичный эффект здесь был бы необъяснимым —
        // ровно так разъезжались два хука наземной защиты форта.
        let hullRate = 0;
        const planet = fleet.location ? h.state.planets[fleet.location] : undefined;
        if (planet && fleetAtOwnDock(fleet, h.state, data, (a, b) => isAllied(h, a, b))) {
          for (const b of planet.buildings) {
            if (b.hp <= 0) continue;
            const def = data.buildings[b.type];
            if (def) hullRate += buildingLevel(def, b.level).shipRepair;
          }
        }

        // Shields regen only over the part of this span past the post-damage delay.
        const shieldFrom = Math.max(from, (fleet.lastDamagedAt ?? -Infinity) + SHIELD_REGEN_DELAY);
        const shieldHours = shieldFrom < to ? ((to - shieldFrom) / MS_PER_HOUR) * scale : 0;

        for (const stack of fleet.units) {
          const unitDef = data.units[stack.unit];
          if (!unitDef) continue;

          // Hull (`hp`): friendly-port repair only, never a free regen.
          if (stack.hp !== undefined) {
            const fullHp = stack.count * (effectiveStats(unitDef, stack, data).hp ?? 0);
            if (fullHp <= 0 || stack.hp >= fullHp) stack.hp = undefined;
            else if (hullRate > 0) {
              const cur = Math.min(fullHp, stack.hp + hullRate * hours * fullHp);
              stack.hp = cur >= fullHp ? undefined : cur;
            }
          }

          // Shield (`shieldHp`): free out-of-combat regen once past the damage delay.
          //
          // Темп = общая база ПЛЮС добавка юнита (`shieldRegen`, FORT-5.10: со ступенью
          // щита крепости растёт не только размер пула, но и скорость его набора).
          // Именно ДОБАВКА, а не замена: корпус без этого стата обязан копить щит ровно
          // с прежней скоростью, иначе правка молча переписала бы весь флот игры.
          if (stack.shieldHp !== undefined) {
            const eff = effectiveStats(unitDef, stack, data);
            const fullShield = stack.count * (eff.shield ?? 0);
            const shieldRate = SHIELD_REGEN + (eff.shieldRegen ?? 0);
            if (fullShield <= 0 || stack.shieldHp >= fullShield) stack.shieldHp = undefined;
            else if (shieldHours > 0) {
              const cur = Math.min(
                fullShield,
                stack.shieldHp + shieldRate * shieldHours * fullShield,
              );
              stack.shieldHp = cur >= fullShield ? undefined : cur;
            }
          }
        }
      }
    });
  },
};
