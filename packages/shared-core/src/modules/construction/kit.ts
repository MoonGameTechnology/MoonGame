/** Стройка: общие правила — цены, требования, урон постройкам, очереди полос. Вынесено из `../construction.ts` (SLIM). */
import { type Action, hoursToMs } from '../../action/types';
import { type BuildLane, UNIT_LANES, orderLane } from '../../state/buildLane';
import type {
  BuildingInstance,
  GameState,
  PausedConstructionSite,
  Planet,
  Player,
  QueuedConstruction,
  ScheduledEvent,
} from '../../state/gameState';
import type { CompletePayload } from '../../state/construction';
import { type DamageHookArgs, isAllied, mitigationFactor } from '../../util/combat';
import {
  FORTRESS_CORE,
  fortressAssemblyScale,
  fortressFleetId,
  refreshFortressBody,
} from '../../state/fortress';
import { type GameData, type ResourceBag, buildingLevel } from '../../data/schemas';
import type { HandlerContext } from '../../kernel/module';
import { acceptedConstructionHours, buildProgress } from '../../util/construction';
import { battleAt } from '../../state/battle';
import { canAfford, payCost, refundCost } from '../../util/treasury';
import { constructionModuleSnapshot } from '../../util/arsenalLoadout';
import { forkSiteInBattle } from '../../state/forkSite';
import { isBombarded } from '../../state/orbit';
import { isInfected } from '../../util/infestation';
import { loadoutCost } from '../../util/loadout';
import { matchBuildingHours, matchCost, matchUnitCost, matchUnitHours } from '../../util/pricing';
import { mobilizationBusy, mobilizationHead, queuedHeroCount } from '../../state/mobilization';
import { scheduleCompletion } from './schedule';

/** Share of the ground assault's round damage that also wears down the planet's
 *  structures (the rest is spent on the defending garrison). Tunable. */
export const STRUCTURE_DAMAGE_SHARE = 0.5;

export interface ConstructBuildingPayload {
  planetId: string;
  building: string;
}
interface ConstructionRequirement {
  allowed: boolean;
  code?: string;
}
export interface CancelConstructionPayload {
  planetId: string;
  /** The `scheduled` entry's `seq` — the same value the client already reads off
   *  `construction.complete` events to identify "the active build". */
  seq: number;
}
export interface ResumeConstructionPayload {
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
export function orderSpec(
  state: Pick<GameState, 'pricing'>,
  data: GameData,
  p: CompletePayload,
): { hours: number; cost: ResourceBag } | null {
  if (p.kind === 'building' && typeof p.building === 'string') {
    const def = data.buildings[p.building];
    if (!def) return null;
    const level1 = buildingLevel(def, 1);
    return { hours: matchBuildingHours(state, level1.buildTimeHours), cost: matchCost(state, level1.cost) };
  }
  if (p.kind === 'upgrade' && typeof p.building === 'string' && typeof p.level === 'number') {
    const def = data.buildings[p.building];
    if (!def) return null;
    const next = buildingLevel(def, p.level);
    return { hours: matchBuildingHours(state, next.buildTimeHours), cost: matchCost(state, next.cost) };
  }
  if (p.kind === 'unit' && typeof p.unit === 'string' && typeof p.count === 'number') {
    const def = data.units[p.unit];
    if (!def) return null;
    // Цена партии — по частям (корпус, модули, боец) за ОДИН корабль, потом × число:
    // окно верфи складывает те же части, и округление у них не разойдётся.
    const hull =
      p.modules && p.modules.length > 0
        ? sumBags(matchUnitCost(state, def), matchCost(state, loadoutCost(p.modules, data)))
        : matchUnitCost(state, def);
    // Десантный челнок: цена — челнок ПЛЮС его боец, срок — дольший из двух (SHU-5.2).
    const troop = typeof p.troop === 'string' ? data.units[p.troop] : undefined;
    if (p.troop !== undefined && !troop) return null;
    const perShip = troop ? sumBags(hull, matchUnitCost(state, troop)) : hull;
    const hours = troop ? Math.max(def.buildTimeHours, troop.buildTimeHours) : def.buildTimeHours;
    return { hours: matchUnitHours(state, hours), cost: scaleCost(perShip, p.count) };
  }
  return null;
}

/** True if a `construction.complete` of this `kind` for this planet+building is already
 *  in flight — the "already queued?" guard shared verbatim by build and upgrade. */
/**
 * RULES-2. Занят ли лимит экземпляров здания на мире. Правило («одно такое здание на
 * мир, уровень растят улучшением») больше не строка в редьюсере — его объявляет само
 * здание полем `maxPerPlanet`, а код лишь исполняет объявленное. Дефолт схемы `1`
 * сохраняет прежнее поведение всего каталога.
 */
export function atInstanceCap(h: HandlerContext, planet: Planet, building: string): boolean {
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
export function syncIssuedGarrison(h: HandlerContext, planet: Planet, issue = true): void {
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
  if (!issue) return; // Damage removes defenders whose source fell; it never recruits replacements.
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
export function slotsAt(h: HandlerContext, planet: Planet): { capacity: number; used: number } | null {
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
  // Пауза держит место: возобновление его не спрашивает, иначе на одно место встали бы две.
  for (const s of planet.pausedConstruction ?? []) if (s.kind === 'building') used += 1;
  return { capacity, used };
}

export function isQueued(
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
//  1. **Одна стройка на ПОЛОСУ на мире.** `buildings` — здание и апгрейд (одна площадка),
//     и по полосе на производственную постройку (BLD-2.1, `state/buildLane.ts`). Полосы независимы:
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

/** Потолок ждущих заказов в одной полосе одного мира (правило 5). */
const MAX_BUILD_QUEUE = 5;

/** Как часто голова, упёршаяся в деньги, пробует стартовать снова (правило 4). */
const QUEUE_RETRY_HOURS = 1;

/** Идёт ли на мире стройка в этой полосе прямо сейчас. Неразборчивый `kind` считается
 *  полосой зданий — в сторону «занято», а не «свободно» (инвариант #4). */
export function laneBusy(h: HandlerContext, planetId: string, lane: BuildLane): boolean {
  if (lane === 'mobilization') return mobilizationBusy(h.state, planetId, h.ctx.data);
  return h.state.scheduled.some((e) => {
    if (e.type !== 'construction.complete') return false;
    const p = e.payload as CompletePayload;
    return p.planetId === planetId && orderLane(h.ctx.data, p) === lane;
  });
}

/** Поставить заказ в хвост очереди мира. Возвращает код отказа или null. */
export function enqueueOrder(
  h: HandlerContext,
  planet: Planet,
  order: Omit<QueuedConstruction, 'id'>,
): string | null {
  const queue = planet.buildQueue ?? [];
  const lane = orderLane(h.ctx.data, order);
  if (queue.filter((q) => orderLane(h.ctx.data, q) === lane).length + (lane === 'mobilization' ? queuedHeroCount(h.state, planet.id) : 0) >= MAX_BUILD_QUEUE) {
    return 'E_QUEUE_FULL';
  }
  // Личность из счётчика запланированных событий — чтобы `construction.cancel` брал
  // ОДИН номер и не путал ждущий заказ с идущей стройкой (см. `QueuedConstruction`).
  const id = h.state.scheduleSeq++;
  if (order.kind === 'unit') order.moduleSnapshot = constructionModuleSnapshot(order.modules, h.state.players[order.playerId]?.arsenal);
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
  if (q.kind !== 'unit' || typeof q.unit !== 'string' || typeof q.count !== 'number') return false;
  // The planet may have fallen beyond the control limit while the order waited (BAL-19).
  return h.hook<ConstructionRequirement>(
    'construction.requirement',
    { allowed: true },
    { playerId: q.playerId, kind: 'unit', id: q.unit, planetId: planet.id },
  ).allowed;
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
export function suppressed(h: HandlerContext, planetId: string): 'E_BOMBARDED' | 'E_BATTLE_HERE' | null {
  if (isBombarded(h.state, planetId, h.ctx.data)) return 'E_BOMBARDED';
  if (battleAt(h.state, planetId)) return 'E_BATTLE_HERE';
  // Площадка крепости на развилке: бой с её орудиями идёт на дороге, а не на узле площадки.
  if (forkSiteInBattle(h.state, h.state.planets[planetId])) return 'E_BATTLE_HERE';
  return null;
}

export function startNextQueued(h: HandlerContext, planet: Planet, lane: BuildLane): void {
  if (lane === 'infantry' || lane === 'vehicles') lane = 'mobilization';
  if (laneBusy(h, planet.id, lane)) return;
  if (suppressed(h, planet.id)) {
    // Узел не работает — не старт, а пауза. Но пауза с повтором: без него голова очереди,
    // оставшаяся без события завершения (активную стройку отменили посреди боя), не
    // стартовала бы никогда — конец боя и обстрела очередь не будит (замечание Codex на #1416).
    if ((planet.buildQueue ?? []).some((q) => orderLane(h.ctx.data, q) === lane)) scheduleQueuePump(h, planet.id, lane);
    return;
  }
  for (;;) {
    if (lane === 'mobilization' && mobilizationHead(h.state, planet.id, h.ctx.data)?.heroId) {
      h.emit('hero.mobilization.pump', { planetId: planet.id, owner: planet.owner });
      return;
    }
    const queue = planet.buildQueue ?? [];
    const head = queue.find((q) => orderLane(h.ctx.data, q) === lane);
    if (!head) return;
    const drop = (): void => {
      planet.buildQueue = (planet.buildQueue ?? []).filter((q) => q.id !== head.id);
      if (planet.buildQueue.length === 0) delete planet.buildQueue;
    };
    const player = h.state.players[head.playerId];
    const spec = orderSpec(h.state, h.ctx.data, head);
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
      moduleSnapshot: head.moduleSnapshot,
      troop: head.troop,
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

/** Полоса юнитов будит ВСЕ полосы юнитов (`UNIT_LANES`): мост с общей `units` BLD-1 в сейве. */
export function startNextAfter(h: HandlerContext, planet: Planet, lane: BuildLane): void {
  for (const l of lane === 'buildings' ? [lane] : UNIT_LANES) startNextQueued(h, planet, l);
}

export function requireUnlocked(
  h: HandlerContext,
  playerId: string,
  kind: 'unit' | 'building',
  id: string,
  planetId: string,
): void {
  const requirement = h.hook<ConstructionRequirement>(
    'construction.requirement',
    { allowed: true },
    { playerId, kind, id, planetId },
  );
  if (!requirement.allowed) {
    return h.reject(requirement.code ?? 'E_LOCKED');
  }
}

/** Resolves the acting player and a planet they own, or rejects with a stable
 *  code (E_NO_PLANET / E_FORBIDDEN). Shared by every build / upgrade order. */
export function ownedPlanet(
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
 * Предикат один на всю защиту построек (`worldDamageReduction`): при первой правке, когда
 * правил было два (бонус форта и скидка за число зданий), союзник начал получать бонус
 * форта, но не скидку, и игрок увидел бы необъяснимо частичное прикрытие.
 *
 * Проверка именно «владелец ИЛИ союзник», а не «не враг»: снять её целиком значило бы
 * прикрыть и ШТУРМУЮЩЕГО, стоящего на вашей же земле, то есть заставить форт работать на
 * захватчика. Союзник здесь — ровно `alliance` (см. {@link isAllied}): перемирие и пакт
 * войсками не делятся, значит и прикрытием не делятся тоже.
 */
export function fortificationCovers(
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

/**
 * Урон, который канал огня уже СРЕЗАЛ прикрытием мира: с какими аргументами он спрашивал
 * пул (`hit`) и какую долю пул пропустил (`factor`, {@link mitigationFactor}). Нужен
 * {@link damageBuildings}, чтобы пересчитывать остаток урона по мере того, как прикрытие
 * рушится.
 */
interface CoveredDamage {
  hit: DamageHookArgs;
  factor: number;
}

/** Wears `amount` of structural damage across a planet's buildings (array order,
 *  carrying overflow). Buildings with no modelled HP are untouched; ones whose
 *  HP reaches zero are removed and announced via `building.destroyed`. `owner` is
 *  passed in (not read from the planet) because a capture may have already
 *  flipped `planet.owner` by the time the round's damage is applied.
 *
 *  `covered` — урон уже срезан прикрытием мира (обстрел, FORT-5.15). Тогда каждая
 *  снесённая постройка ОСЛАБЛЯЕТ прикрытие для остатка этого же урона: остаток
 *  пересчитывается долей, которую пул пропускает теперь, без павшей постройки. Без этого
 *  исход зависел от нарезки времени (замечание Codex на #1389): обстрел, который сервер
 *  догоняет одним длинным отрезком (матч без зрителей спит до следующего события), весь
 *  шёл бы под прикрытием начала отрезка, и постройка, павшая в первую минуту, прикрывала
 *  бы мир до его конца, а тот же обстрел под присмотром (такт раз в секунду) снимал бы
 *  прикрытие по ходу. С пересчётом один отрезок и сотня коротких дают одно и то же.
 *
 *  Пересчёт идёт и ДО первой постройки: события одного отрезка разбираются очередью, и
 *  обстрел второго флота над тем же миром приходит, когда первый уже мог что-то снести. */
export function damageBuildings(
  h: HandlerContext,
  planet: Planet,
  amount: number,
  owner: string | null,
  covered?: CoveredDamage,
): void {
  let remaining = amount;
  let factor = covered?.factor ?? 1;
  const recover = (): void => {
    if (!covered || !(remaining > 0)) return;
    const now = mitigationFactor(h, covered.hit);
    remaining *= now / factor;
    factor = now;
  };
  recover();
  const survivors: BuildingInstance[] = [];
  for (const b of planet.buildings) {
    if (planet.fortress && b.type === FORTRESS_CORE) {
      survivors.push(b); // the core's level record is not a second hull HP pool
      continue;
    }
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
      recover(); // hp 0 — постройка больше не прикрывает (`worldDamageReduction`)
    }
  }
  planet.buildings = survivors;
  // Разрушенное здание уносит выданный им гарнизон: иначе защитники пережили бы то, что
  // их породило, и мир остался бы «занят» призраками снесённого форта.
  syncIssuedGarrison(h, planet, false);
}

/** Снять `amount` прочности с заражённых построек мира — по очереди, в порядке массива,
 *  с переносом остатка; обычные постройки не трогаются. Снесённые убираются и объявляются
 *  `building.destroyed` с пометкой `cleared` — это зачистка, а не штурм. */
export function clearInfected(h: HandlerContext, planet: Planet, amount: number): void {
  let remaining = amount;
  const survivors: BuildingInstance[] = [];
  for (const b of planet.buildings) {
    if (remaining <= 0 || !isInfected(h.ctx.data.buildings[b.type])) {
      survivors.push(b);
      continue;
    }
    const absorbed = Math.min(remaining, b.hp);
    b.hp -= absorbed;
    remaining -= absorbed;
    if (b.hp > 0) survivors.push(b);
    else h.emit('building.destroyed', { planetId: planet.id, building: b.type, owner: planet.owner, cleared: true });
  }
  planet.buildings = survivors;
}

/** One hit of {@link BuildingDamage}: `amount` HP off the building at `index` of
 *  `planet.buildings` (indices as they stand BEFORE the call). */
export interface BuildingHit {
  index: number;
  amount: number;
}

/**
 * Capability `building.damage` (SPY-9): wear targeted damage on chosen buildings of one
 * world — sabotage picks WHICH buildings, this module owns what damage means. A building
 * whose HP reaches zero is removed and announced via `building.destroyed`, and the
 * garrison it issued goes with it (`syncIssuedGarrison`), exactly as under bombardment.
 * Returns what each hit did; unknown indices and undamageable buildings are skipped.
 */
export type BuildingDamage = (
  h: HandlerContext,
  planetId: string,
  hits: readonly BuildingHit[],
) => { building: string; destroyed: boolean }[];

export const damageChosenBuildings: BuildingDamage = (h, planetId, hits) => {
  const planet = h.state.planets[planetId];
  if (!planet) return [];
  const out: { building: string; destroyed: boolean }[] = [];
  const doomed = new Set<number>();
  for (const hit of hits) {
    const b = planet.buildings[hit.index];
    const def = b ? h.ctx.data.buildings[b.type] : undefined;
    if (!b || !def || doomed.has(hit.index) || buildingLevel(def, b.level).hp <= 0) continue;
    if (planet.fortress && b.type === FORTRESS_CORE) continue;
    if (!(hit.amount > 0)) continue;
    b.hp = Math.max(0, b.hp - hit.amount);
    const destroyed = b.hp <= 0;
    if (destroyed) doomed.add(hit.index);
    out.push({ building: b.type, destroyed });
  }
  if (doomed.size > 0) {
    for (const i of [...doomed].sort((x, y) => x - y)) {
      h.emit('building.destroyed', {
        planetId,
        building: planet.buildings[i]!.type,
        owner: planet.owner,
      });
    }
    planet.buildings = planet.buildings.filter((_, i) => !doomed.has(i));
    syncIssuedGarrison(h, planet);
  }
  return out;
};

/** What {@link ConstructionDelay} pushed back: the order and by how many hours. */
export interface DelayedOrder {
  kind: 'building' | 'unit' | 'upgrade';
  building?: string;
  unit?: string;
  hours: number;
}

/**
 * Capability `construction.delay` (SPY-14): push the active order of one world that
 * finishes first back by `hours` — the spy picks how long, this module owns the order
 * book. The order keeps its `seq` (cancel and paused-site ids stay valid) and the
 * queue stays `(at, seq)`-sorted, so the kernel's loop fires it at the new time. Orders
 * waiting in `buildQueue` start after it and slide with it. `null` — nothing is built.
 */
export type ConstructionDelay = (h: HandlerContext, planetId: string, hours: number) => DelayedOrder | null;

export const delayFirstOrder: ConstructionDelay = (h, planetId, hours) => {
  if (!(hours > 0)) return null;
  const active = h.state.scheduled.filter(
    (e) => e.type === 'construction.complete' && (e.payload as CompletePayload).planetId === planetId,
  );
  const first = active.sort((a, b) => a.at - b.at || a.seq - b.seq)[0];
  if (!first) return null;
  const rest = h.state.scheduled.filter((e) => e !== first);
  const moved = { ...first, at: first.at + hoursToMs(h.ctx, hours) };
  const p = first.payload as CompletePayload;
  const site = h.state.planets[planetId];
  const work = p.kind === 'upgrade' && p.building === FORTRESS_CORE ? site?.fortress?.assembly : undefined;
  if (site && work) {
    const readiness = fortressAssemblyScale(site, h.ctx.now);
    moved.at = Math.max(first.at, work.doneAt) + hoursToMs(h.ctx, hours);
    Object.assign(work, { from: readiness, startedAt: h.ctx.now, doneAt: moved.at });
    const body = h.state.fleets[fortressFleetId(site.id)]?.units[0];
    if (body) refreshFortressBody(site, body, h.ctx.data, readiness);
  }
  const pos = rest.findIndex((e) => e.at > moved.at || (e.at === moved.at && e.seq > moved.seq));
  rest.splice(pos < 0 ? rest.length : pos, 0, moved);
  h.state.scheduled = rest;
  return {
    kind: p.kind ?? 'building',
    ...(p.building ? { building: p.building } : {}),
    ...(p.unit ? { unit: p.unit } : {}),
    hours,
  };
};

/**
 * Park a running build: refund the unbuilt share of its cost and keep its progress as a
 * resumable paused site, then let the lane's next order start. One body for a player's
 * cancel and for a unit whose world has left control (BAL-19). False for an order this
 * module cannot price, before anything changed.
 */
export function parkActive(h: HandlerContext, planet: Planet, event: ScheduledEvent): boolean {
  const p = event.payload as CompletePayload;
  const playerId = p.playerId;
  const player = playerId === undefined ? undefined : h.state.players[playerId];
  const spec = orderSpec(h.state, h.ctx.data, p);
  if (playerId === undefined || !player || !spec) return false;
  const acceptedHours = acceptedConstructionHours(h.state, h.ctx.data, p);
  const totalDurationMs = hoursToMs(h.ctx, acceptedHours);
  const fortressWork = p.kind === 'upgrade' && p.building === FORTRESS_CORE ? planet.fortress?.assembly : undefined;
  const progress = fortressWork && p.level !== undefined
    ? Math.max(0, Math.min(1, fortressAssemblyScale(planet, h.ctx.now) - (p.level - 1)))
    : buildProgress(h.ctx.now, event.at, totalDurationMs);
  const refund = scaleCost(spec.cost, 1 - progress); // linear, NOT the 50% output threshold
  refundCost(player.resources, refund);
  h.state.scheduled = h.state.scheduled.filter((e) => e.seq !== event.seq);
  const site: PausedConstructionSite = {
    id: event.seq,
    kind: p.kind === 'unit' || p.kind === 'upgrade' ? p.kind : 'building',
    playerId,
    building: p.building,
    level: p.level,
    unit: p.unit,
    count: p.count,
    modules: p.modules,
    moduleSnapshot: p.moduleSnapshot,
    troop: p.troop,
    progress,
    remainingHours: fortressWork ? Math.max(0, fortressWork.doneAt - h.ctx.now) / hoursToMs(h.ctx, 1)
      : acceptedHours * (1 - progress),
    remainingCost: refund,
  };
  planet.pausedConstruction = [...(planet.pausedConstruction ?? []), site];
  h.emit('construction.cancelled', { planetId: planet.id, seq: event.seq, kind: site.kind, progress, playerId });
  // Полоса освободилась — её занимает следующий по очереди (BLD-1). Ровно это и
  // делает отмену осмысленной кнопкой: «убрать текущее» = «пустить следующее».
  startNextAfter(h, planet, orderLane(h.ctx.data, p));
  return true;
}
