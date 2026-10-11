/**
 * Приказы группе (REFM-228): всё, чем игрок отдаёт приказ выбранным флотам разом. Курс и
 * штурм группой (`tryMoveGroup`, `tryMoveEdgeGroup`, `tryAssaultGroup` с отложенным
 * штурмом цепочкой ядра), запрос войны, когда путь идёт через мирных (`warPrompt`,
 * `confirmWarPrompt`, `cancelWarPrompt`), слияние (`orderMerge`, `mergeGroup`), стойка
 * авто-штурма (`isAutoAssault`, `setAutoAssault`) с соседним чтением порога авто-отхода и
 * вход меню погрузки десанта (`troopsInputFor`, `troopsLiftable`).
 *
 * Модуль — владелец двух состояний. Запрос войны `warPrompt` снаружи только читают; его
 * ставят приказы группе и снимают кнопки окна. Стойку авто-штурма в соло хранит локальный
 * набор (в сети она приказ ядра): смена матча забывает его дверью {@link forgetAutoAssault},
 * сохранение схватки читает {@link soloAutoAssault}, а загрузка возвращает
 * {@link restoreAutoAssault}.
 *
 * Мир, своё место, ленту, имена мест на пути и смену выбора модуль получает хуками
 * {@link initGroupOrders} — импорт из `main.ts` был бы циклом. Приказ уходит конвейером
 * (`orderPipeline.ts`), сеть читается у `netSession.ts`, меню десанта — у владельца выбора.
 */
import type { Action, Fleet, GameState } from '../../packages/shared-core/src/index';
import { findHealthyStack, planRoute, sumUnitStat } from '../../packages/shared-core/src/index';
import { garrisonUnderAssault } from '../../packages/shared-core/src/util/fleet';
import { t } from '../../localization/runtime';
import { assaultSteps } from '../../decisions/assaultOrder';
import { mergePlan } from '../../decisions/mergeOrders';
import { refusalText as errText } from '../../decisions/refusalText';
import { laneEnds, warConfirmPlan } from '../../decisions/warOrders';
import { assaultPlan } from './assaultDispatch';
import { esc } from './format';
import {
  assaultFleet,
  canOrder,
  canOrderAll,
  canTraverse,
  data,
  declareWar,
  mergeFleet,
  moveFleet,
  moveFleetEdge,
  orbitFleet,
  orderAuto,
  orderChain,
  unloadArmy,
} from './game';
import { troopsPlan } from './interaction';
import { fleetNode } from './mapFog';
import { NET } from './netSession';
import { playerOrder } from './orderPipeline';
import { isGroundUnit } from './planetSummary';
import { houseDisplayName } from './setupSeats';
import { autoStance } from './stanceToggle';
import type { TroopsInput, TroopsUnitInput } from './troopsMenu';
import { garrisonSide, planFor, troopsGate } from './troopsScene';
import { groundTypes, hasTroops, totalOf, troopSources } from './troopsSources';
import { assaultMovers, assaultTargetBlocker, collectBlockers, moveMovers } from './warPrompt';
import { warPromptText, warReason } from './warPromptView';

/** Что приказам группе нужно от игры. Мир, лента, имена и выбор живут в `main.ts`. */
export interface GroupOrdersHost {
  /** Мир на экране. */
  world(): GameState;
  /** Своё место. */
  me(): string;
  /** Строка в ленту. */
  note(text: string, at?: string): void;
  /** Имя места по таблице мест партии, если оно там есть. */
  seatName(id: string): string | undefined;
  /** Выделить флоты (только свои) и перерисовать панель. */
  selectFleets(ids: string[]): void;
}

let game: GroupOrdersHost;

/** Поднять приказы группе: хуки игры. Зовётся из `main.ts` один раз, до первого кадра. */
export function initGroupOrders(host: GroupOrdersHost): void {
  game = host;
}

const isGround = (u: string) => isGroundUnit(u, data);

// CC-2 standing order: fleets whose owner opted into AUTO-STORM — they descend and assault
// a hostile world on arrival by themselves (the AI's autoEngage capture loop, opted-in).
const autoAssault = new Set<string>();
/** Стойка авто-штурма в соло — только для чтения: соло-драйвер и сохранение схватки. */
export const soloAutoAssault: ReadonlySet<string> = autoAssault;
/** Смена матча: стойки прошлой партии не переходят в новую. */
export function forgetAutoAssault(): void {
  autoAssault.clear();
}
/** Загрузка сохранённой схватки: вернуть стойки, записанные с ней. */
export function restoreAutoAssault(ids: readonly string[]): void {
  for (const id of ids) autoAssault.add(id);
}

/** Приказ группе, отложенный до ответа на запрос войны. */
export interface WarPrompt {
  fleetIds: string[];
  destId: string;
  edge?: { from: string; to: string; t: number };
  blockers: string[];
  /** PC ШТУРМ command: confirm → the moved fleets also assault on arrival; the
   *  prompt reads as "this is a friendly faction's world — declare war?". */
  assault?: boolean;
}
// A staged move that would cross territory of a player you're at PEACE with: held
// until you confirm in the war-prompt (declaring war opens the route) or cancel.
export let warPrompt: WarPrompt | null = null;

// --- часовая погрузка десанта: ТЕПЕРЬ ЭТО ПРАВИЛО МИРА, а не клиента ----------
// Здесь ЖИЛА очередь `pendingLoads` — заказ час висел в памяти вкладки и только потом
// уходил настоящим `army.load`. Онлайн это означало, что приказ существует, только пока
// открыта вкладка: закрыл (или просто переподключился) — и он исчезал молча, без войск и
// без сообщения, а при `TIME_SCALE=1` игровой час это РЕАЛЬНЫЙ час. С CARGO-1 час считает
// ядро (`shared-core/modules/army.ts`): заказ живёт в состоянии мира как ЗАЯВКА
// (`fleet.loading`), переживает офлайн и одинаково идёт в соло и в сети. Клиенту осталось
// только ЧИТАТЬ её — правил здесь больше нет.

/** Объём трюма, уже обещанный идущими подъёмами этого флота. */
function pendingLoadCargo(fleetId: string): number {
  let n = 0;
  for (const c of game.world().fleets[fleetId]?.loading ?? []) {
    n += c.count * (data.units[c.unit]?.stats.cargoSize ?? 1);
  }
  return n;
}

/** Сколько единиц `unit` уже обещано подъёмами ИЗ ЭТОГО мира — по всем флотам. */
function pendingLoadUnits(planetId: string, unit: string): number {
  let n = 0;
  for (const f of Object.values(game.world().fleets)) {
    for (const c of f.loading ?? []) if (c.from === planetId && c.unit === unit) n += c.count;
  }
  return n;
}

/** Сколько единиц `unit` поднимает именно этот флот. */
function pendingLoadOf(fleetId: string, unit: string): number {
  let n = 0;
  for (const c of game.world().fleets[fleetId]?.loading ?? []) if (c.unit === unit) n += c.count;
  return n;
}

/** Fail-secure: ядро не выпускает войска из гарнизона, запертого живым боем
 *  (`E_UNDER_ASSAULT`). Без этой проверки заказ ушёл бы и молча отскочил. */
export function troopsLiftable(planetId: string): boolean {
  if (!garrisonUnderAssault(game.world(), planetId)) return true;
  game.note('✖ ' + t('cargo.under-assault'));
  return false;
}

/** GRND-1: собрать вход меню десанта для флота. `null` — показывать нечего: флот не
 *  пришвартован у СВОЕГО мира, или наземных частей нет ни в гарнизоне, ни в трюме.
 *  Здесь и только здесь живая сцена превращается в числа — дальше меню чистое. */
export function troopsInputFor(fleetId: string): TroopsInput | null {
  const s = game.world();
  const ME = game.me();
  const f = s.fleets[fleetId];
  if (!f || !f.location) return null;
  const here = s.planets[f.location];
  if (!here) return null;
  const landing = f.landing ?? [];
  const mine = here.owner === ME;
  const carried = landing.filter((st) => isGround(st.unit) && st.count > 0);
  // Судьба меню — `troopsScene.ts` (REFM-173). ALLY-LAND: круг «свой мир или мир
  // союзника» здесь НЕ переписывается — задаётся вопрос про НАСТОЯЩИЙ приказ, поэтому
  // расширение круга ядром клиент подхватит сам. Вердикт ЛЕНИВЫЙ: на своём мире он не
  // нужен, а с пустым трюмом приказ не из чего собрать.
  const gate = troopsGate({
    docked: !f.movement && !f.battleId,
    worldMine: mine,
    carriesGround: carried.length > 0,
    landingAllowed: () => canOrder(s, unloadArmy(ME, fleetId, carried[0]!.unit, 1)) === null,
  });
  if (gate === 'closed') return null;
  // Источники, типы и суммы — `troopsSources.ts` (REFM-81): на союзном мире поднимать
  // нечего, поэтому счётчик выходит односторонним сам собой, без отдельного режима меню.
  // «Гарнизон» форта неподвижен (`immobile`) — ядро его не поднимет, меню не предлагает.
  const liftable = (u: string) => !data.units[u]?.traits.includes('immobile');
  const types = groundTypes(troopSources(mine, here.garrison, landing, liftable), isGround);
  if (!hasTroops(types)) return null;
  const units: TroopsUnitInput[] = types.map((unit) => ({
    unit,
    // «Всего» складывает и побитые стопки, а поднять/высадить ядро даст только здоровую.
    ...garrisonSide(
      mine,
      findHealthyStack(here.garrison, unit)?.count ?? 0,
      totalOf(here.garrison, unit),
    ),
    hold: findHealthyStack(landing, unit)?.count ?? 0,
    holdAll: totalOf(landing, unit),
    queued: pendingLoadOf(fleetId, unit),
    reserved: pendingLoadUnits(here.id, unit),
    cargoSize: data.units[unit]?.stats.cargoSize ?? 1,
  }));
  return {
    units,
    capacity: sumUnitStat(f.units, data, 'cargoCapacity'),
    used: sumUnitStat(landing, data, 'cargoSize'),
    reservedCargo: pendingLoadCargo(fleetId),
    plan: planFor(troopsPlan?.fleetId, fleetId, troopsPlan?.plan),
  };
}

// --- diplomacy gate (client order layer) -------------------------------------
// A move that would cross or end on territory of a player you're at PEACE with is
// blocked: you must declare war first. Such a move opens a confirmation ("this
// declares war on …") instead of dispatching. The AI honours the same rule (see
// aiOrders); the kernel only fights once a `war` stance exists (combat.isHostile).
function blockerName(id: string): string {
  // Имя в состоянии — английское имя данных («Azure Compact»): его, как и `NAME`,
  // показывают через `houseDisplayName` (UIX-5.3).
  const name = game.world().players[id]?.name;
  return name !== undefined ? houseDisplayName(name) : (game.seatName(id) ?? id);
}
/** Distinct PEACE owners that make the move IMPOSSIBLE without a war — mirrors the
 *  kernel's D2 gate, including its detour: since the right-of-way fix the kernel
 *  reroutes AROUND peace-locked territory, so a blocker on the shortest path is not
 *  a blocker if a peaceful detour exists. Prompting war for it anyway (the pre-fix
 *  behaviour) pushed players into wars the move never needed. Empty ⇒ move is free. */
/**
 * RULES-4. ЗАПЕРТ ЛИ ход миром — вердикт ядра по тому самому приказу, который сайт и
 * издаст. Решение принимает ядро; `peaceBlockers` ниже только НАЗЫВАЕТ виновников для
 * окна войны (в вердикте имён нет, там код — это «подача», а не правило).
 *
 * Что это чинит. `peaceBlockers` строит маршрут из ОДНОГО ближайшего узла
 * (`fleetNode`: t≤0.5 ? from : to), а ядро — из ОБОИХ концов ребра, на котором
 * припаркован флот (`originsOf`), выбирая самую дешёвую пару. Для припаркованного на
 * ребре флота это расходилось в обе стороны: клиент говорил «путь свободен» и приказ
 * ловил `E_NO_RIGHT_OF_WAY`, либо клиент требовал объявления войны там, где ядро
 * спокойно проехало бы другим концом.
 */
function peaceBlocked(action: Action): boolean {
  return canOrder(game.world(), action) === 'E_NO_RIGHT_OF_WAY';
}
/** Кого назвать в окне войны, когда ядро уже сказало «заперто». Список — объяснение,
 *  а не решение: вердикт выше принят ядром. */
function peaceBlockers(from: string | null, toId: string): string[] {
  if (!from || from === toId) return [];
  const s = game.world();
  const ME = game.me();
  const peaceLocked = (id: string): boolean => {
    const owner = s.planets[id]?.owner ?? null;
    return owner != null && !canTraverse(s, ME, owner);
  };
  // The same veto predicate the kernel replans with; planRoute exempts the
  // destination, so a reachable-by-detour move reports at most the DESTINATION's
  // owner (landing on their world genuinely needs the war declaration).
  const route = planRoute(s, from, toId, peaceLocked) ?? planRoute(s, from, toId) ?? [toId];
  const set = new Set<string>();
  for (const hop of route) {
    const owner = s.planets[hop]?.owner ?? null;
    if (owner != null && !canTraverse(s, ME, owner)) set.add(owner);
  }
  return [...set];
}
/** Живые флоты из выбора: ссылка могла пережить сам флот (погиб, слился, доставлен). */
function livingFleets(fleetIds: readonly string[]): Fleet[] {
  const s = game.world();
  return fleetIds.map((id) => s.fleets[id]).filter((f): f is Fleet => !!f);
}
/** Order every selected fleet to a world. If the route crosses PEACE territory, stage
 *  a war-declaration prompt instead of dispatching (confirm → declare war + advance). */
export function tryMoveGroup(fleetIds: string[], destId: string): void {
  const ME = game.me();
  // Отсев участников и сбор виновников — `warPrompt.ts` (REFM-57).
  const movers = moveMovers(livingFleets(fleetIds), destId);
  if (!movers.length) return;
  const blockers = collectBlockers(movers, (id) =>
    // ядро пропускает — объезд есть, виновников по этому флоту нет
    peaceBlocked(moveFleet(ME, id, destId))
      ? peaceBlockers(fleetNode(game.world().fleets[id]!), destId)
      : [],
  );
  if (blockers.length) {
    warPrompt = { fleetIds: movers, destId, blockers };
    renderWarPrompt();
    return;
  }
  for (const id of movers) playerOrder(moveFleet(ME, id, destId));
}
/** PC ШТУРМ: send every selected fleet at `destId` (someone else's capturable world)
 *  and assault on arrival. A peaceful target/route stages the war prompt first —
 *  worded as "this is a friendly faction's world". */
export function tryAssaultGroup(fleetIds: string[], destId: string): void {
  const s = game.world();
  const ME = game.me();
  // Штурмуют ВСЕ выбранные: стоящий у цели штурмует с места (`warPrompt.ts`, REFM-57).
  const movers = assaultMovers(livingFleets(fleetIds));
  if (!movers.length) return;
  const blockers = collectBlockers(movers, (id) =>
    peaceBlocked(moveFleet(ME, id, destId)) ? peaceBlockers(fleetNode(s.fleets[id]!), destId) : [],
  );
  // Штурм — не просто ход: даже по свободному маршруту нельзя высадиться на мир
  // НЕвраждебного игрока (ядро: `E_FORBIDDEN`). Спросить об этом ядро нельзя — флот
  // ещё не там, — поэтому владелец цели проверяется здесь и ТОЛЬКО здесь.
  const target = assaultTargetBlocker(s.planets[destId]?.owner, ME, (owner) =>
    canTraverse(s, ME, owner),
  );
  const all = target && !blockers.includes(target) ? [...blockers, target] : blockers;
  if (all.length) {
    warPrompt = { fleetIds: movers, destId, blockers: all, assault: true };
    renderWarPrompt();
    return;
  }
  dispatchAssault(movers, destId);
}
/**
 * ПРОГНОЗ (не гейт): похоже ли, что к прилёту штурмовать будет нечем. Нужен ровно там,
 * где приказ издаётся НЕ сейчас, — флот ещё летит, спросить ядро про штурм нельзя
 * (оно ответит про мир, в котором флот в другом месте). Поэтому здесь остаётся ручная
 * прикидка, и она честно предупреждает, а не отменяет: десант могут догрузить в пути.
 *
 * RULES-4: там, где приказ издаётся СЕЙЧАС, этой прикидки больше нет — решает
 * `assaultVerdict` ниже.
 */
function assaultNeedsTroops(f: Fleet, planetId: string): boolean {
  const defended = (game.world().planets[planetId]?.garrison ?? []).some((u) => u.count > 0);
  return defended && !(f.landing ?? []).some((u) => u.count > 0);
}
/**
 * RULES-4. «Пройдёт ли штурм ПРЯМО СЕЙЧАС» — код отказа или `null`, от ядра.
 *
 * Спрашивается вся связка «встать на низкую орбиту → штурм» (`canOrderAll`, RULES-3):
 * штурм нелегален с дальней орбиты, поэтому вопрос об одном лишь штурме вернул бы
 * `E_WRONG_ORBIT`, а вопрос об одной орбите пропустил бы обречённую пару — и её первая
 * половина применилась бы.
 *
 * Раньше здесь стоял `assaultNeedsTroops`, то есть ОДИН отказ из шести. Остальные пять
 * (`E_OWN_PLANET`, `E_FORBIDDEN` по миру союзника, `E_UNDER_ASSAULT`,
 * `E_ORBIT_CONTESTED`, `E_NOT_CAPTURABLE`) клиент не знал и честно доезжал до отказа —
 * то есть обещанного «одно понятное сообщение вместо потока E_*» предикат не давал.
 */
function assaultVerdict(fleetId: string, f: Fleet): string | null {
  const ME = game.me();
  return canOrderAll(
    game.world(),
    f.orbit === 'near'
      ? [assaultFleet(ME, fleetId)]
      : [orbitFleet(ME, fleetId, 'near'), assaultFleet(ME, fleetId)],
  );
}
/**
 * Издать связку приказов штурма для флота, стоящего у цели (`assaultOrder.ts`, REFM-141):
 * штурмуют с БЛИЖНЕЙ орбиты, поэтому перевод на неё идёт в паре со штурмом и только если
 * флот не там. Годность самого штурма к этому моменту уже подтвердило ядро (правило 1).
 */
function issueAssault(id: string, orbit: string | undefined): void {
  const ME = game.me();
  for (const step of assaultSteps(orbit))
    playerOrder(step === 'orbit-near' ? orbitFleet(ME, id, 'near') : assaultFleet(ME, id));
}

function dispatchAssault(fleetIds: string[], destId: string): void {
  const ME = game.me();
  // Правила штурма группой — `assaultDispatch.ts` (REFM-167): стоящий у цели штурмует
  // СЕЙЧАС и получает вердикт ЯДРА (RULES-4: приказ издаётся сейчас, значит ядро знает
  // всю связку запретов), летящему ядро ответить не может — ему только предупреждение,
  // приказ всё равно уходит (десант можно погрузить в пути). Жалоба ОДНА на группу:
  // пять флотов без десанта высыпали бы пять одинаковых строк, и журнал утонул бы.
  const views = fleetIds.flatMap((id) => {
    const f = game.world().fleets[id];
    if (!f) return []; // правило 5: погибших в списке нет
    const parked = f.location === destId && !f.movement;
    return [
      {
        id,
        parked,
        refusal: parked ? assaultVerdict(id, f) : null,
        lacksTroops: !parked && assaultNeedsTroops(f, destId),
      },
    ];
  });
  const plan = assaultPlan(views);
  const warnText = (w: NonNullable<typeof plan.warn>): string =>
    w.kind === 'no-troops'
      ? t('log.assault.warn-no-troops')
      : w.code === 'E_NO_TROOPS'
        ? t('log.assault.no-troops')
        : '✖ ' + errText(w.code);
  for (const [i, step] of plan.steps.entries()) {
    // Жалоба встаёт ПЕРЕД действием вызвавшего её флота (правило 4): иначе в журнале
    // «не смог» оказалось бы раньше приказов, которые ушли до него.
    if (i === plan.warnAt && plan.warn) game.note(warnText(plan.warn), destId);
    if (step.kind === 'refused') continue;
    if (step.kind === 'storm') {
      // already parked at the target — storm right away (orbit first if needed)
      issueAssault(step.id, game.world().fleets[step.id]?.orbit);
      continue;
    }
    // ORD-2. Отложенный ШТУРМ уходит в ЯДРО цепочкой приказов «дойти → штурмовать», а не
    // в локальную карту клиента.
    //
    // Раньше здесь было `moveFleet` + запись в `assaultOnArrival`, и сам штурм издавал
    // покадровый цикл браузера — в ОБОИХ режимах. В сети это значило: перелёт ведёт
    // сервер, часами реального времени, а решающий приказ ждёт открытой вкладки. Закрыл
    // вкладку, перезагрузил страницу, оборвалась связь — карта пары исчезла вместе со
    // страницей, флот прилетал и стоял на орбите вечно. Для игры, которая идёт 24/7 и вся
    // построена на «отдал приказ и ушёл», это была молчаливая потеря самого дорогого
    // приказа.
    //
    // Цепочки ядра (`order.chain`) для этого уже всё умеют: шаг `assault` сам поднимает
    // флот на ближнюю орбиту и штурмует, а гоняют цепочки ОБА хоста — сервер
    // (`runServerStanding` → `serverChainActions`) и соло-драйвер прототипа. То есть
    // правило переезжает туда, где исполняется, и становится одним на сеть и на соло.
    //
    // Что при этом ИЗМЕНИЛОСЬ, и это надо знать: план теперь ПЕРЕЖИВАЕТ перенаправление.
    // Локальная карта снималась, как только флот получал другой приказ; цепочка — нет,
    // она возобновится, когда флот освободится. Так ведут себя все планы («Приказ»,
    // CHAIN-UX), и отменяется он там же — тапом по ◎-бейджу плана. Взамен приказ стал
    // ВИДИМЫМ: раньше он жил невидимкой в памяти вкладки и молча исчезал.
    playerOrder(orderChain(ME, step.id, [{ kind: 'move', to: destId }, { kind: 'assault' }]));
  }
}
/** As tryMoveGroup, but the target is a point on a lane (continuous order). Either lane
 *  endpoint sitting on PEACE territory blocks the march until war is declared. */
export function tryMoveEdgeGroup(
  fleetIds: string[],
  edge: { from: string; to: string; t: number },
): void {
  const ME = game.me();
  // Марш упирается в ОБА конца лейна (`warOrders.ts`, REFM-59), а не только в «куда».
  const blockers = collectBlockers(fleetIds, (id) => {
    if (!peaceBlocked(moveFleetEdge(ME, id, edge))) return [];
    const node = fleetNode(game.world().fleets[id]!);
    return laneEnds(edge).flatMap((end) => peaceBlockers(node, end));
  });
  if (blockers.length) {
    warPrompt = { fleetIds: [...fleetIds], destId: edge.to, edge, blockers };
    renderWarPrompt();
    return;
  }
  for (const id of fleetIds) playerOrder(moveFleetEdge(ME, id, edge));
}
/** Confirm the staged move: declare war on each blocker (opens the lanes), then issue
 *  the held move for every fleet. War-first ordering means the routes are clear when
 *  the moves apply (solo: sequential; net: server applies in send order). */
export function confirmWarPrompt(): void {
  if (!warPrompt) return;
  const ME = game.me();
  const wp = warPrompt;
  warPrompt = null;
  hideWarPrompt();
  // Порядок шагов держит `warOrders.ts` (REFM-59): все объявления войны идут ПЕРВЫМИ,
  // иначе приказ упрётся в те же запертые лейны и будет отвергнут ядром.
  for (const step of warConfirmPlan(wp)) {
    if (step.kind === 'declare-war') playerOrder(declareWar(ME, step.on));
    else if (step.kind === 'assault') dispatchAssault([...step.fleetIds], step.destId);
    else if (step.kind === 'move-edge')
      for (const id of step.fleetIds) playerOrder(moveFleetEdge(ME, id, step.edge));
    else for (const id of step.fleetIds) playerOrder(moveFleet(ME, id, step.destId));
  }
  game.note(t('log.war.declared'));
}
export function cancelWarPrompt(): void {
  warPrompt = null;
  hideWarPrompt();
}
function renderWarPrompt(): void {
  const el = document.getElementById('warprompt');
  if (!el || !warPrompt) return;
  // Что написано и что на кнопках — `warPromptView.ts` (REFM-168): у штурма война и есть
  // цель (прямой вопрос ДА/НЕТ), у транзита она попутная, поэтому кнопка называет
  // ПОСЛЕДСТВИЕ («объявить войну») — «ДА» тут читалось бы как «да, лететь».
  // Имена виновников — чужой ввод в разметке, поэтому экранируются (правило 4).
  const names = warPrompt.blockers.map((b) => esc(blockerName(b))).join(', ');
  const text = warPromptText(warReason(warPrompt.assault));
  el.innerHTML =
    `<div class="wpbox">` +
    `<div class="wp-head">⚔ ${t(text.title)}</div>` +
    `<div class="wp-body">${t(text.body, { names })}</div>` +
    `<div class="wp-actions"><button class="wp-no">${t(text.no)}</button>` +
    `<button class="wp-yes">${t(text.yes)}</button></div>` +
    `</div>`;
  el.classList.add('show');
}
function hideWarPrompt(): void {
  document.getElementById('warprompt')?.classList.remove('show');
}

/** Order `movers` to merge into `anchorId`. Co-located & idle fleets fuse at once;
 *  distant ones are sent to the anchor's sector and finish on arrival (pending). */
export function orderMerge(movers: string[], anchorId: string) {
  const ME = game.me();
  // Правила приказа — `mergeOrders.ts` (REFM-165): якорь только свой и живой (иначе приказ
  // отскочит, а игрок уже увидит «слито»), сам в себя не сливается, чужие и погибшие среди
  // сливаемых пропускаются молча, стоящие вместе сливаются СРАЗУ, остальные летят к якорю —
  // и точка встречи берётся у него (где стоит, а если он уже в пути — конец пути).
  const plan = mergePlan(
    Object.fromEntries(
      Object.entries(game.world().fleets).map(([id, f]) => [
        id,
        { owner: f.owner, location: f.location ?? null, movingTo: f.movement?.to ?? null },
      ]),
    ),
    movers,
    anchorId,
    ME,
  );
  if (!plan) return;
  for (const step of plan.steps) {
    if (step.kind === 'now') {
      playerOrder(mergeFleet(ME, step.mover, anchorId));
      continue;
    }
    // Догоняющего сперва отправляем в путь, и только потом объявляем слияние: ядро
    // принимает «слить» у ЛЕТЯЩЕГО (MRG-1) и держит намерение у себя (`fleet.mergeInto`),
    // поэтому вторая половина приказа больше не живёт в памяти вкладки и исполняется,
    // даже когда игрока нет. Новое намерение вытесняет прежнее самим полем.
    if (step.sendTo) playerOrder(moveFleet(ME, step.mover, step.sendTo));
    playerOrder(mergeFleet(ME, step.mover, anchorId));
  }
  game.selectFleets([anchorId]); // keep the surviving fleet selected for follow-up
  game.note(plan.queued ? `⛬ ${plan.queued} fleet(s) en route to merge` : '⛬ fleets merged');
}

/** Merge button on a multi-selection: pick a docked anchor, fold the rest into it. */
export function mergeGroup(ids: string[]) {
  const s = game.world();
  const fleets = ids.map((id) => s.fleets[id]).filter((f): f is Fleet => !!f);
  if (fleets.length < 2) return;
  const anchor = fleets.find((f) => f.location && !f.movement) ?? fleets[0]!;
  orderMerge(
    ids.filter((id) => id !== anchor.id),
    anchor.id,
  );
}

/** The CC-2 auto-storm stance of a fleet — authoritative state in NET, local Set solo. */
export function isAutoAssault(fleetId: string): boolean {
  return NET
    ? ((game.world() as { autoAssault?: Record<string, true> }).autoAssault?.[fleetId] ?? false)
    : autoAssault.has(fleetId);
}
/**
 * RETR-2: порог авто-отхода, стоящий на флоте, или `null`, если приказа нет.
 *
 * Читается ИЗ СОСТОЯНИЯ в обоих режимах, в отличие от авто-штурма рядом: тот в соло
 * живёт локальной картой клиента, а этот — приказ ядра (`order.retreat`), и ядро
 * крутится в соло тоже. Своей копии заводить не нужно, а завести — значит разойтись
 * с тем, по чему считает драйвер.
 */
export function autoRetreatAt(fleetId: string): number | null {
  return (
    (game.world() as { autoRetreat?: Record<string, { at: number }> }).autoRetreat?.[fleetId]?.at ??
    null
  );
}

/** CC-2: set the auto-storm stance UNIFORMLY on the given own fleets (☰-row toggle —
 *  a mixed group snaps to one state instead of flipping each). Authoritative in NET
 *  (order.auto — the server presses the storm while you're offline), local Set solo. */
export function setAutoAssault(ids: string[], on: boolean): void {
  const ME = game.me();
  for (const id of ids) {
    // Кому стойка положена — `stanceToggle.ts` (REFM-98).
    const mine = game.world().fleets[id]?.owner === ME;
    if (autoStance(mine, isAutoAssault(id), on) === 'skip') continue;
    if (NET) playerOrder(orderAuto(ME, id, on));
    else if (on) autoAssault.add(id);
    else autoAssault.delete(id);
  }
}
