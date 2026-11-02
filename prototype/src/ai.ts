/**
 * Server-side seat AIs (REFP-26) — which AI (if any) plays a seat this tick
 * (`seatAiDecision`, SES-2.2: Steward delegation ⊳ substitute-after-grace ⊳ none)
 * and the full expansion bot / delegated-posture driver (`aiOrders`). Extracted
 * from `game.ts` as a pure move. Pure builders: both hosts (solo frame loop /
 * netserver driver) apply the returned actions through the kernel. `game.ts`
 * re-exports for main.ts / netserver.ts / tests (until REFP-28).
 */
import {
  HERO_ACTIVE_CAP,
  abilityRange,
  getStance,
  heroCooldownKey,
  knownSkillNodes,
  MARKET_COMMISSION,
  moduleAllowed,
  slotUsage,
  fleetPositionAt,
  fleetHoldFree,
  fleetShuttleBay,
  shuttleBayAt,
  squadronReach,
  stacksSize,
  squadronSize,
  beaconCallouts,
  beaconSentinels,
  counterattackPlan,
  swarmAdaptDue,
  swarmNetPlan,
  musterPlan,
  SWARM_MEMORY_WINDOW,
  isMineFleet,
  isRocketMineFleet,
  mineFleetVisible,
  rocketMinelayer,
  type GameState,
  type Action,
  type Hero,
  type StewardPosture,
  type Squadron,
  type StrikeBase,
  type Fleet,
} from '../../packages/shared-core/src/index';
import { bossFallen, heroNode } from '../../packages/shared-core/src/state/heroes';
import { fleetHangarRepairRate } from '../../packages/shared-core/src/util/repair';
// Опознанные узлы считаются ОДИН раз на тик и передаются в `knownGarrison`: покрытие
// сенсоров — проход по всему флоту, а спрашивают про него десятки миров подряд.
import { identifiedNodes, isVisibleTo } from '../../packages/shared-core/src/state/visibility';
import { canOrder, canOrderAll } from './protoKernel';
import { isForkSite } from '../../packages/shared-core/src/state/forkSite';
import {
  moveFleet,
  launchFleet,
  buildBuilding,
  buildUnit,
  canTraverse,
  marketList,
  marketTake,
  splitFleet,
  strikeShuttle,
  loadShuttle,
  patrolShuttle,
  holdPatrol,
  releaseHold,
  relocateShuttle,
  spawnHero,
  unlockHeroSkill,
  installHeroModule,
  castHeroAbility,
  stopFleet,
  deployRocketMine,
  swarmAdapt,
} from '../../decisions/actions';
// ПРАВИЛА НАЗЕМНОЙ ВОЙНЫ БОТА (решение владельца 2026-09-16) живут в `/decisions`, а не
// здесь: «возьму ли я этот мир», «сколько оставить дома» и «что известно о гарнизоне» —
// чистые решения, которые завтра захочет показать и клиент. Своей копии у бота нет.
import { freshIntel, knownGarrison } from '../../decisions/garrisonIntel';
import { planDrop } from '../../decisions/dropPlan';
import { pickHoldFleet } from '../../decisions/holdPick';
import { holdsPatrol } from '../../decisions/patrolMarks';
import { frontRebase } from '../../decisions/frontRebase';
import { isLander } from '../../decisions/landerTroops';
import { botEmbargoes } from './botFavour';
import { data } from './gameData';
import type { MarketSide } from '../../packages/shared-core/src/index';
import { planAllyOperation } from '../../decisions/allyOperation';
import { allyCaptiveOrders } from '../../decisions/captive';
import { openTurn, type AiProfile } from './aiTurn/turn';
import { consolidateFleets, expansionMoves, retreatLosingFleets } from './aiTurn/fleets';
import { declareWarOnLeader } from './aiTurn/war';
import { finishTurn } from './aiTurn/finish';
import { openHome } from './aiTurn/home';
import { economyOrders } from './aiTurn/economy';
import { researchOrders } from './aiTurn/research';
import { lineOrders, warFootingOrders } from './aiTurn/production';
import { strongCampaign } from './aiTurn/campaign';
import { STRIKE_SHUTTLES, ownsModule } from './aiTurn/rules';
import {
  isPirateClan,
  pirateShipCap,
  pirateShipCount,
} from '../../decisions/pirateReach';

/** The two server-side AIs that can play a seat, kept explicitly DISTINCT
 *  (SES-2.2). `steward` — «Хранитель»: the player's OWN autopilot, a defensive
 *  posture they turned on to cover their sleep; it runs on their chosen posture
 *  even while they are connected-but-idle, and its live delegation OUTRANKS the
 *  abandon grace. `substitute` — «заместитель»: the full expansion bot that takes
 *  over an ABANDONED chair, only after the player has been gone past the
 *  real-time grace window, and it is reclaimed the instant they return. `none` —
 *  no AI drives the seat this tick (a present player commands it, or an absent
 *  one is still inside their reconnect grace). */
export type SeatAiKind = 'steward' | 'substitute' | 'none';

/** Сложность бота — её смысл и границы описаны у типа (`aiTurn/turn.ts`). */
export type { AiProfile };
// Ход бота живёт по фазам в `aiTurn/` (SLIM-3); наружу из него смотрят эти две функции.
export { huntWeight } from './aiTurn/fleets';
export { weakTurn } from './aiTurn/rules';

/** Ударные машины вылета «по корпусам и мирам» — в порядке дальности: тяжёлый достаёт
 *  дальше, поэтому поднимается первым; нечем или некого — очередь ударного. */
const STRIKERS = ['heavy_striker', 'bomber'] as const;
/** Кем бот держит патруль над своей базой (SHU-6.8): перехватчиками. Патруль бьёт и
 *  флоты, и чужие вылеты, но ударные машины нужнее в ударе с базы у фронта, а дело
 *  перехватчика — чужие вылеты, которые идут к его базе. */
const PATROL_WING = ['interceptor'] as const;

/**
 * Что СИЛЬНЫЙ БОТ думает про каждый торгуемый товар (AI-BAL-9): сколько держит про запас
 * (`keep`), почём готов купить (`bid`) и почём отдать (`ask`).
 *
 * Одна таблица на ВСЮ торговлю — и на выставление своих лотов, и на снятие чужих.
 * Держать оценку в двух местах нельзя: бот, который выставляет лот по одной цене, а
 * чужой снимает по другой, торгует сам против себя, и первым признаком была бы не
 * ошибка, а тихо изменившийся баланс.
 *
 * Товар без `ask` бот не продаёт (металл он тратит быстрее всех и отдавать его незачем),
 * товар без `bid` — не покупает (еда и энергия ему не нужны вовсе, BAL-3). Микроэлектроника
 * единственная торгуется в обе стороны, и это не прихоть: она гейтит крейсера и артиллерию
 * (`ECON-7`), но производится фабрикатором, которого у соперника может не быть, — то есть
 * ровно тот случай, когда у одного излишек, а у другого нехватка.
 */
const TRADE_BOOK: Record<string, { keep: number; bid?: number; ask?: number }> = {
  metal: { keep: 80, bid: 3 },
  microelectronics: { keep: 40, bid: 3, ask: 2 },
  food: { keep: 120, ask: 2 },
  energy: { keep: 120, ask: 2 },
};
/** Столько кредитов бот НЕ тратит на рынке — казна нужна стройке и войскам. */
const TRADE_CREDIT_FLOOR = 300;

/** What drives a seat this tick + the posture to hand `aiOrders`. */
export interface SeatAiDecision {
  kind: SeatAiKind;
  posture: StewardPosture | 'expand' | null; // null ⇔ kind === 'none'
}

/** Decide which server AI (if any) plays ONE seat this tick — SES-2.2. Pure:
 *  reads only the three facts the host tracks, no time source of its own.
 *  `hasHuman` — a live peer holds the chair; `posture` — the seat's active
 *  Steward delegation (`stewardActive`), null if none; `graceExpired` — the
 *  player has been absent PAST the real-time abandon window (wall-clock, the host
 *  compares `Date.now()`; always true for a chair that never opened a window).
 *  The precedence encodes the owner's intent: a delegation they set beats the
 *  automatic takeover, and a present human beats the idle bot. */
export function seatAiDecision(
  hasHuman: boolean,
  posture: StewardPosture | null,
  graceExpired: boolean,
): SeatAiDecision {
  // A live Steward delegation is the player's OWN autopilot: it plays regardless
  // of connection and never waits on the abandon grace (they asked for it).
  if (posture) return { kind: 'steward', posture };
  // No delegation → a present human commands their own chair.
  if (hasHuman) return { kind: 'none', posture: null };
  // Empty chair: wait out the grace (a drop / restart blip / a few days away)
  // before the substitute bot seizes it — reclaimed the moment they return.
  if (!graceExpired) return { kind: 'none', posture: null };
  return { kind: 'substitute', posture: 'expand' };
}

/**
 * Состояние глазами бота: только провинции. Площадка крепости на развилке (FORT-6.1) — не
 * мир: лейнов к ней нет, захватить её нельзя, и бот, увидевший в ней цель или базу, слал
 * бы флоты туда, куда дороги нет. Её орудия — обычный флот на дороге, и его бот видит как
 * прежде. Без площадок на карте состояние отдаётся как есть — копии не заводим.
 */
function provincesOnly(state: GameState): GameState {
  if (!Object.values(state.planets).some(isForkSite)) return state;
  return {
    ...state,
    planets: Object.fromEntries(Object.entries(state.planets).filter(([, p]) => !isForkSite(p))),
  };
}

/** One decision tick's orders for an AI-driven seat, evaluated against `state`.
 *  Read-only: it builds and returns the actions; the caller applies them — the
 *  client to its local sim, the server through the authoritative room. Drives
 *  empty seats the same way in solo and multiplayer (a seat with no human). */
export function aiOrders(
  full: GameState,
  ai: string,
  posture: StewardPosture | 'expand' = 'expand',
  profile: AiProfile = 'weak',
): Action[] {
  return keepLandings(full, decideOrders(full, ai, posture, profile));
}

/**
 * Курс флоту, который высаживает десант, бот не даёт. Вылет отменяет высадку (заказ
 * владельца 2026-11-01: «так же, как с погрузкой»), а «свободный» флот многие правила бота
 * узнают только по `movement`/`battleId`: стоящий над миром высаживающийся флот для них
 * свободен, и первый же такой приказ отменил бы штурм, который бот сам начал. Раньше ядро
 * отбивало этот курс, теперь он прошёл бы — поэтому фильтр стоит здесь, одним местом на все
 * ветки бота, а не в каждом правиле.
 */
function keepLandings(state: GameState, orders: Action[]): Action[] {
  return orders.filter((a) => {
    if (a.type !== 'fleet.move') return true;
    const id = (a.payload as { fleetId?: unknown } | undefined)?.fleetId;
    return typeof id !== 'string' || !state.fleets[id]?.assaultLanding;
  });
}

function decideOrders(
  full: GameState,
  ai: string,
  posture: StewardPosture | 'expand',
  profile: AiProfile,
): Action[] {
  const state = provincesOnly(full);
  if (state.players[ai]?.npc === 'neutral') return allySeatOrders(state, ai, posture, profile);
  if (isPirateClan(state, ai) && !state.pve)
    return capPirateFleet(state, ai, baseAiOrders(state, ai, posture, profile, new Set()));
  if (state.pve?.npcPlayerId !== ai) return baseAiOrders(state, ai, posture, profile, new Set());
  // Сеть Роя (`docs/swarm-behavior.md`): посты-ретрансляторы стоят там, куда их ставит
  // сеть, — общий бот их не двигает и не сливает (`swarmNetPlan`, то же правило на сервере).
  const net = swarmNetPlan(state, data, ai);
  // Построенное Роем ждёт в улье и уходит с волной (решение владельца 2026-09-24):
  // общий бот флоты сбора не уводит, а построенные на другой верфи ведёт в улей.
  const muster = musterPlan(state, data, ai);
  // PVR-4.7: флот героя, ведущего осаду «Поглощения мира», стоит над миром до её конца:
  // уход, слияние или прекращение огня сорвали бы осаду самому Рою.
  const besieging = Object.values(state.heroes ?? {}).flatMap((x) =>
    x.owner === ai && x.siege && x.fleetId !== undefined ? [x.fleetId] : [],
  );
  // PVR-8.4 (глава VI §8.7): потеряв внешние позиции, Рой ведёт к известному месту эвакуации
  // уцелевшие соединения и построенное. Правило одно на оба хоста (`counterattackPlan`, его же
  // зовёт серверный оркестратор); флоты контрудара общий бот не трогает, улей их не ждёт.
  const counter = counterattackPlan(state, data, ai);
  const pinned = new Set([
    ...beaconSentinels(state, ai),
    ...net.held,
    ...muster.held,
    ...besieging,
    ...counter.held,
  ]);
  const out = baseAiOrders(state, ai, posture, profile, pinned);
  // AUD-20: адаптация Роя. Правило «пора» одно на оба хоста (`swarmAdaptDue`, то же зовёт
  // серверный оркестратор), а окно памяти — это сложность забега (§3.9): слабый Рой
  // помнит 4 боя, сильный — весь забег. До аудита бот забега `swarm.adapt` не отправлял
  // вовсе, и Рой в одиночной игре не учился.
  // Проект идёт отдельно от приказов флоту: орган, ушедший отвечать на маяк, растить
  // форму не перестаёт, поэтому фильтр маяка ниже этот приказ не трогает.
  const adapt = swarmAdaptDue(state, data, ai, SWARM_MEMORY_WINDOW[profile]).map((due) =>
    swarmAdapt(ai, due.moduleId, due.fleetId),
  );
  // Маяк задачи (заказ владельца 2026-09-24): флот игрока на маяке — разведчик Роя зовёт
  // силы. Правило одно на оба хоста (`beaconCallouts`, общее с серверным оркестратором);
  // флот, ушедший отвечать на маяк, в этот тик других приказов от бота не получает, а
  // дозорный на самом маяке не получает их вовсе (`beaconSentinels`).
  const callouts = beaconCallouts(state, ai, new Set([...net.held, ...counter.held]));
  const held = new Set(pinned);
  for (const c of callouts) held.add(c.fleetId);
  const netOrders = [
    ...muster.moves
      .filter((m) => !counter.held.has(m.fleetId))
      .map((m) => moveFleet(ai, m.fleetId, m.to)),
    ...counter.moves.map((m) => moveFleet(ai, m.fleetId, m.to)),
    ...net.moves.map((m) => moveFleet(ai, m.fleetId, m.to)),
    ...net.splits.map((sp) => splitFleet(ai, sp.fleetId, sp.take)),
    ...net.builds.map((b) =>
      b.unit ? buildUnit(ai, b.planetId, b.unit, 1) : buildBuilding(ai, b.planetId, b.building!),
    ),
  ];
  if (held.size === 0) return [...out, ...netOrders, ...adapt];
  // Приказ касается флота, если называет его хоть в одном поле: слияние несёт `from` и
  // `into`, а не `fleetId`. Пропусти фильтр слияния — и главный флот Роя, проходя через
  // маяк, вбирал бы дозорного в себя (или сливался в него) и замирал там навсегда.
  const touchesHeld = (a: Action): boolean => {
    const p = a.payload as { fleetId?: unknown; from?: unknown; into?: unknown } | undefined;
    return [p?.fleetId, p?.from, p?.into].some((id) => typeof id === 'string' && held.has(id));
  };
  return [
    ...out.filter((a) => !touchesHeld(a)),
    ...callouts.map((c) => moveFleet(ai, c.fleetId, c.to)),
    ...netOrders,
    ...adapt,
  ];
}

/** Потолок флота пиратского клана (`decisions/pirateReach.ts`): заказы кораблей сверх
 *  него снимаются, остальные приказы идут как есть. Снимаем на выходе, а не в каждой из
 *  веток постройки: веток у бота несколько, а потолок один. */
function capPirateFleet(state: GameState, ai: string, orders: Action[]): Action[] {
  const isShip = (u: string): boolean => !!data.units[u] && !data.units[u]!.traits.includes('ground');
  let room = pirateShipCap(state) - pirateShipCount(state, ai, isShip);
  return orders.filter((a) => {
    if (a.type !== 'unit.build') return true;
    const p = a.payload as { unit?: string; count?: number };
    if (!p.unit || !isShip(p.unit)) return true;
    const n = p.count ?? 1;
    if (n > room) return false;
    room -= n;
    return true;
  });
}

/**
 * Житель-союзник главы IV (PVR-7.4): операция — приказ игрока или своя задача — ведётся по
 * плану `planAllyOperation` (то же решение показывает игроку карточка операции), а его
 * флоты общий бот не трогает: не сливает, не уводит и не отзывает на оборону. Остальное —
 * стройка, найм, оборона дома — прежний бот жителя («активная оборона»). Нет операции —
 * прежний бот целиком.
 *
 * Пленный главы V (PVR-9.5) важнее операции: взявший убежище союзник грузит его на флот и
 * ведёт носитель в безопасную зону (`allyCaptiveOrders`), и этот флот не трогает ни план, ни
 * общий бот.
 */
function allySeatOrders(
  state: GameState,
  ai: string,
  posture: StewardPosture | 'expand',
  profile: AiProfile,
): Action[] {
  const captive = allyCaptiveOrders(state, ai);
  const plan = planAllyOperation(state, ai, data);
  if (plan.step === 'idle' && captive.held.length === 0)
    return baseAiOrders(state, ai, posture, profile, new Set());
  const touches = (a: Action, fleets: ReadonlySet<string>): boolean => {
    const p = a.payload as { fleetId?: unknown; from?: unknown; into?: unknown } | undefined;
    return [p?.fleetId, p?.from, p?.into].some((id) => typeof id === 'string' && fleets.has(id));
  };
  const carrying = new Set(captive.held);
  const planActions = plan.step === 'idle' ? [] : plan.actions.filter((a) => !touches(a, carrying));
  const held = new Set([...(plan.step === 'idle' ? [] : plan.group), ...carrying]);
  // Флоты, которым план отдаёт приказ (сведение, погрузка), тоже его: общий бот их не трогает.
  for (const a of planActions) {
    const p = a.payload as { fleetId?: unknown; from?: unknown; into?: unknown } | undefined;
    for (const id of [p?.fleetId, p?.from, p?.into]) if (typeof id === 'string') held.add(id);
  }
  const out = baseAiOrders(state, ai, posture, profile, held).filter((a) => !touches(a, held));
  return [...out, ...planActions, ...captive.actions];
}

function baseAiOrders(
  state: GameState,
  ai: string,
  posture: StewardPosture | 'expand',
  profile: AiProfile,
  /** Флоты, которые общий бот не сливает (дозорный маяка, посты сети Роя). */
  pinned: ReadonlySet<string>,
): Action[] {
  // Ход по фазам (SLIM-3): подготовка хода, флоты, хозяйство и наука — в `aiTurn/`, порядок
  // фаз прежний.
  const bot = openTurn(state, ai, posture, profile, pinned);
  if (bot === null) return [];
  consolidateFleets(bot);
  if (bot.skilled) retreatLosingFleets(bot);
  expansionMoves(bot);
  if (!bot.defensive) declareWarOnLeader(bot);
  const {
    out,
    skilled,
    army,
    defensive,
    isShipUnit,
    capturable,
    d,
    warFooting,
    base,
    ownFleets,
  } = bot;
  // Build + launch from this AI's home base (its first developed owned world).
  const pl = state.players[ai];
  if (base && pl) {
    // Хозяйство, наука и производство дома (SLIM-3) — в `aiTurn/`, порядок прежний.
    const home = openHome(bot, base, pl);
    economyOrders(bot, home);
    researchOrders(bot, home);
    lineOrders(bot, home);
    warFootingOrders(bot, home);
    if (skilled) strongCampaign(bot, home);
    // ═══ ВЫЛЕТ ЧЕЛНОКОВ (SHU-3.2) ═══
    // Без этого правила весь пласт челноков не участвовал в замерах ВООБЩЕ: бот их
    // строил, они ложились в порт и лежали там до конца матча. Ни удара, ни ответки
    // (ROS-2.2), ни зонального ПВО, ни высадки плацдарма (ROS-1.5) отчёт не видел.
    //
    // Правило нарочно короткое, той же формы, что и постройка: ОДИН вылет с порта за
    // тик (топливо у порта общее, вторым приказом его не растянуть), цель — БЛИЖАЙШАЯ
    // в радиусе, тай-брейк по id. Ближайшая, а не «лучшая»: выбор цели — это стратегия,
    // а кирпичу нужно, чтобы механика заработала и попала в измерение.
    if (skilled && warFooting) {
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
      const launchpads: Array<{
        key: string;
        ref: StrikeBase;
        base: { planetId: string } | { fleetId: string };
        at: { x: number; y: number };
        hangar: Squadron[];
      }> = [];
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
      let sortied = false;
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
          sortied = true;
          launched.add(pad.key);
          taken.add(plan.squadronId);
          break;
        }
      }

      // ═══ УДАР СТРАЙКЕРОМ ═══
      // Один вылет за тик: топливо у базы общее, вторым приказом его не растянуть.
      // Цель — чужой ФЛОТ (бомбардировщик бьёт корпуса) либо чужой МИР, ближайшая в
      // радиусе, тай-брейк по id: иначе выбор зависел бы от порядка ключей объекта.
      // SHU-5.6: машин две — тяжёлый и ударный страйкер (`STRIKERS`), и пробуются они
      // по порядку: первая, у которой есть и эскадра на базе, и цель в СВОЁМ радиусе,
      // поднимается, остальные ждут следующего тика. Базы перебираются все по порядку
      // (SHU-6.8): эскадра в тылу без цели не держит удар эскадры у фронта.
      strike: for (const unit of sortied ? [] : STRIKERS) {
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
          break strike;
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
      if (!defensive && foeWorlds.length > 0) {
        const front = foeWorlds.map((p) => p.position);
        const strikerTargets = [...front, ...foeFleets.map(foeFleetPos)];
        const landerTargets = foeWorlds.filter(capturable).map((p) => p.position);
        rebase: for (const pad of launchpads) {
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
            break rebase;
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
      if (!defensive) {
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
    }
    // (marine retired: the AI no longer cheap-builds a ground trooper. Its home keeps its
    //  seeded infantry garrison + orbital-AA building for defence; mobile ground via divisions.)
    const baseHasShip = base.garrison.some((st) => isShipUnit(st.unit));
    if (ownFleets < (warFooting ? 4 : 2) && baseHasShip) out.push(launchFleet(ai, base.id));
  }
  // ═══ СИЛЬНЫЙ БОТ (AI-BAL-8): ГЕРОЙ ВХОДИТ В ИЗМЕРЕНИЕ ═══
  // Диагноз кирпича: герой ПОСЕЯН во флоте каждого места (`matchSetup`) и исправно
  // дерётся как корпус — но это и всё, что он делал. Бот не звал ни `hero.spawn`, ни
  // `hero.skill.unlock`, ни `hero.fit`, ни `hero.ability`, поэтому целая ветка контента
  // — три спящих героя ростера, два дерева навыков по четыре узла, три фитинга и весь
  // диспетчер способностей — не участвовала в балансе НИ ОДНОЙ цифрой.
  //
  // Правила ниже намеренно минимальные, той же формы, что и правило технологий
  // (AI-BAL-1): бот не «строит билд» — он просто не оставляет пустыми слоты, которые
  // матч ему выдал. Что именно можно взять, решает САМО ЯДРО (ветка архетипа, `requires`,
  // казна, кэп активных, кулдаун) — копии этих правил здесь нет, иначе первая же
  // расходимость с модулем обернулась бы не ошибкой, а тихо изменившимся балансом.
  if (skilled && pl) {
    // Порядок обхода — по id инстанса, а не по раскладке объекта: `hero:{место}:{n}`
    // сеет `matchSetup`, так что сортировка стабильна и один сид разыгрывается
    // одинаково (инвариант #1).
    // Павший босс (PVR-4.7) не возвращается: ядро отбивает о нём любой приказ
    // (`E_HERO_FALLEN`), и бот слал бы его каждый тик — подъём, оснащение, навыки.
    const roster = Object.values(state.heroes ?? {})
      .filter((x) => x.owner === ai && !bossFallen(x, data))
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    // «Развёрнут» ровно в том смысле, в каком это считает ядро (`activeHeroCount`):
    // жив И командует ЖИВЫМ кораблём. Протухший `fleetId` не считается — иначе бот
    // держал бы место в кэпе за героем, которого нет.
    const deployed = (x: Hero): boolean =>
      x.alive !== false && x.fleetId !== undefined && state.fleets[x.fleetId] !== undefined;
    const affordableCost = (cost: Record<string, number> = {}): boolean =>
      Object.keys(cost).every((r) => (pl.resources[r] ?? 0) >= (cost[r] ?? 0) + 60);
    // Дешёвое вперёд, id последним ключом — тот же ДЕТЕРМИНИРОВАННЫЙ (а не «оптимальный»)
    // порядок, что у выбора технологии: перебор объекта дал бы разный порядок на разных
    // движках.
    const byPrice = (costOf: (id: string) => Record<string, number> | undefined) =>
      (a: string, b: string): number => {
        const sum = (c: Record<string, number> = {}): number =>
          Object.values(c).reduce((n, v) => n + v, 0);
        return sum(costOf(a)) - sum(costOf(b)) || (a < b ? -1 : a > b ? 1 : 0);
      };

    // 1. ПОДЪЁМ РОСТЕРА. Матч раздаёт каждому месту четырёх героев, но кораблём
    //    командует только главный — остальные лежат неразвёрнутыми и ждут `hero.spawn`.
    //    Кэп активных берётся из ядра (`HERO_ACTIVE_CAP`), а не переписывается числом:
    //    иначе бот либо держал бы вторую копию правила, либо сыпал `E_HERO_CAP` каждые
    //    два часа. Респаун-кулдаун читается по тому же гроссбуху, что и гейт.
    if (base) {
      let room = HERO_ACTIVE_CAP - roster.filter(deployed).length;
      for (const x of roster) {
        if (room <= 0) break;
        if (deployed(x) || (x.cooldowns?.respawn ?? 0) > state.time) continue;
        out.push(spawnHero(ai, x.id, base.id));
        room -= 1;
      }
    }

    // 2. ДЕРЕВО НАВЫКОВ — один узел за тик, как одна стройка за тик в экономике.
    //    Ветку узла против ветки архетипа и цепочку `requires` судит ядро; здесь их
    //    ЗЕРКАЛО ровно в той мере, чтобы не отдавать заведомо отбиваемый приказ.
    //    Изученное — купленное И врождённое (AUD-22): набор считает то же `knownSkillNodes`.
    for (const x of roster) {
      if (x.alive === false) continue;
      // Босс штурма (PVR-4.7) навыков ростера не учит: набор у него свой, объявленный
      // владельцем. Общий узел дерева (без ветки) ядро приняло бы, и бот за казну Роя
      // учил бы Левиафана чужим навыкам.
      if (x.archetype !== undefined && data.heroes[x.archetype]?.boss === true) continue;
      const branch = x.archetype !== undefined ? data.heroes[x.archetype]?.branch : undefined;
      const taken = knownSkillNodes(x.skills ?? [], x.archetype, data);
      const node = Object.keys(data.heroSkillTrees)
        .filter((id) => {
          const def = data.heroSkillTrees[id];
          if (!def || taken.has(id)) return false;
          if (def.branch !== undefined && def.branch !== branch) return false;
          if (!(def.requires ?? []).every((parent) => taken.has(parent))) return false;
          return affordableCost(def.cost);
        })
        .sort(byPrice((id) => data.heroSkillTrees[id]?.cost))[0];
      if (node !== undefined) {
        out.push(unlockHeroSkill(ai, x.id, node));
        break;
      }
    }

    // 3. ЖЕЛЕЗО КОРАБЛЯ — тоже по одному за тик (HPR-1.5.2, бывшие фиттинги). Ядро
    //    переоснащает героя только ВНЕ ПОЛЯ (`E_HERO_DEPLOYED`), поэтому здесь тот же
    //    отбор: развёрнутого не трогаем — иначе бот сыпал бы заведомо отбиваемые приказы
    //    каждый тик. Отсеки типизированы, допуск модуля судит его собственное правило;
    //    здесь их ЗЕРКАЛО ровно в той мере, чтобы приказ был законным.
    //    Цены у установки пока нет (её ставит HPR-1.6) — порядок «дешёвое вперёд»
    //    остаётся приоритетом «сначала простое», а не проверкой кошелька.
    //    Исключение — ракетный минёр (решение владельца 2026-10-08): пока его не везёт ни
    //    один герой места, ставится он (при ракетной доктрине — каждому герою,
    //    `minerEveryHero`). Самый дорогой модуль отсека по правилу «дешёвое
    //    вперёд» не доставался никому, а ветка ракетных техов (`damageScope: missile`)
    //    усиливает только мины — без минёра она для бота пуста. Проба `canOrder` — потому
    //    что на месте игрока (Хранитель) решает его арсенал: без модуля бот ставит прежнее.
    const minerAboard = roster.some((y) =>
      (y.modules ?? []).some((m) => data.modules[m]?.rocketMine !== undefined),
    );
    for (const x of roster) {
      if (x.fleetId !== undefined && state.fleets[x.fleetId] !== undefined) continue;
      const hull = (x.archetype !== undefined ? data.heroes[x.archetype]?.ship.unit : undefined) ?? 'hero';
      const hullDef = data.units[hull];
      if (!hullDef) continue;
      const bonus = x.grade !== undefined ? data.heroGrades[x.grade]?.moduleSlots : undefined;
      const installed = (x.modules ?? []).filter((m) => !!data.modules[m]);
      const used = slotUsage(installed, data);
      const fits = Object.keys(data.modules)
        .filter((id) => {
          const md = data.modules[id];
          if (!md || installed.includes(id) || !ownsModule(state, ai, id)) return false;
          if (!moduleAllowed(hull, hullDef, md)) return false;
          return used[md.slot] < hullDef.slots[md.slot] + (bonus?.[md.slot] ?? 0);
        })
        .sort(byPrice((id) => data.modules[id]?.cost));
      const miner =
        minerAboard && !army.minerEveryHero
          ? undefined
          : fits.find(
              (id) =>
                data.modules[id]?.rocketMine !== undefined &&
                canOrder(state, installHeroModule(ai, x.id, id)) === null,
            );
      const mod = miner ?? fits[0];
      if (mod !== undefined) {
        out.push(installHeroModule(ai, x.id, mod));
        break;
      }
    }

    // 4. СПОСОБНОСТИ. Диспетчер ядра data-driven — значит и правило каста здесь по
    //    ТИПУ способности, а не по её id: новая способность того же типа поедет сама.
    //    Одна способность на героя за тик.
    for (const x of roster) {
      if (!deployed(x) || x.alive !== true) continue;
      const fleet = x.fleetId !== undefined ? state.fleets[x.fleetId] : undefined;
      const node = fleet ? state.planets[heroNode(state, x)] : undefined;
      if (!fleet || !node) continue;
      const fighting = fleet.battleId != null;
      for (const id of x.abilities ?? []) {
        if (typeof id !== 'string') continue;
        const def = data.heroAbilities[id];
        if (!def) continue;
        // Кулдаун читается ТЕМ ЖЕ ключом, что ведёт гейт (`heroCooldownKey`): ключ
        // общий на ТИП, поэтому rally и bulwark делят одно окно — и бот, не зная
        // этого, спамил бы `E_COOLDOWN` второй аурой каждый тик.
        if ((x.cooldowns?.[heroCooldownKey(def.type)] ?? 0) > state.time) continue;
        if (!affordableCost(def.cost)) continue;
        const reach = abilityRange(def);
        // Куда кастовать — решает ТИП:
        //  · `aura` (rally/bulwark) и `reveal` (scan) — боевые: они стоят чего-то
        //    только пока рядом дерутся, и оба бьют по узлу героя. У скана это не про
        //    туман (бот читает состояние целиком — та же причина, по которой ему не
        //    нужен `radar`, AI-BAL-2), а про ПСИ-ЛЕСТНИЦУ: взятые ступени превращают
        //    просвеченную зону в боевую (+урон врагу, −урон себе);
        //  · `annihilate` — по миру, который бот ОСАЖДАЕТ и всё равно не может взять
        //    (AI-BAL-7): размен «мир противника на мёртвый мир, богатый металлом» —
        //    единственный способ, которым в матче вообще появляется `dead_world`;
        //  · `devour` (PVR-4.7, «Поглощение мира» Левиафана) — осада чужого мира, который
        //    флот героя уже бомбардирует; идущую осаду заново не начинают, а флот
        //    осаждающего держит на месте обёртка Роя (`besieging`);
        //  · `temp_lane` — дорога туда, куда дороги нет: коридор к захватываемой цели
        //    в радиусе, не связанной с узлом героя ребром графа;
        //  · `recall` (домой) и маркеры `spawn_*` — НЕ кастуются. Отзыв выдёргивает
        //    героя с фронта ровно тогда, когда он нужнее всего, а маркеры вообще не
        //    кастуемы: ядро читает их наличием (`hero.spawn`), и каст ответил бы
        //    `E_NO_EFFECT`.
        let target: string | undefined;
        if (def.type === 'aura' || def.type === 'reveal') {
          if (!fighting) continue;
          target = reach > 0 ? node.id : undefined;
        } else if (def.type === 'annihilate') {
          if (!fleet.bombarding || node.owner === null || node.owner === ai) continue;
          target = node.id;
        } else if (def.type === 'devour') {
          if (x.siege || fighting || !fleet.bombarding || node.owner === null || node.owner === ai)
            continue;
          target = node.id;
        } else if (def.type === 'temp_lane') {
          const linked = new Set(node.links ?? []);
          const to = Object.values(state.planets)
            .filter(
              (p) =>
                p.id !== node.id &&
                p.owner !== ai &&
                capturable(p) &&
                !linked.has(p.id) &&
                canTraverse(state, ai, p.owner) &&
                d(node.position, p.position) <= reach,
            )
            .sort((a, b) => d(node.position, a.position) - d(node.position, b.position))[0];
          if (!to) continue;
          target = to.id;
        } else {
          continue;
        }
        out.push(castHeroAbility(ai, x.id, id, target));
        break;
      }
    }

    // 5. РАКЕТНЫЕ МИНЫ (решение владельца 2026-10-08). Мину ставит носитель минёра,
    //    стоящий посреди дороги, — и бот ставит её там, где герой и так едет: на дороге
    //    между своим миром и миром противника, с которым он воюет. Остановка и установка
    //    уходят ОДНИМ тиком и одной пробой (`canOrderAll`): тик бота — два часа, а мина
    //    взводится за четверть часа, так что к следующему тику она уже стоит. Тогда
    //    носитель едет дальше — общий бот ведёт флоты только из узлов, и вставший посреди
    //    дороги стоял бы там вечно. Режим `confirmed`: мина бьёт только опознанного
    //    противника, с которым война, — режим `any` стрелял бы по сигналу в тумане, то есть
    //    и по флоту соседа, с которым мир, и по приманке.
    //    Одна мина за тик: кулдаун и потолок держит ядро, а одна дорога — одна мина.
    if (!defensive) {
      const ord = state.ordnance;
      const atWarWith = (owner: string | null | undefined): boolean =>
        typeof owner === 'string' && owner !== ai && getStance(state, ai, owner) === 'war';
      const frontLane = (a: string, b: string): boolean => {
        const pa = state.planets[a]?.owner;
        const pb = state.planets[b]?.owner;
        return (pa === ai && atWarWith(pb)) || (pb === ai && atWarWith(pa));
      };
      const mined = (a: string, b: string): boolean =>
        Object.values(state.fleets).some((f) => {
          const e = f.edge;
          return (
            f.owner === ai &&
            !!e &&
            ((e.from === a && e.to === b) || (e.from === b && e.to === a)) &&
            isRocketMineFleet(f, data)
          );
        });
      let laid = false;
      for (const x of roster) {
        if (!deployed(x)) continue;
        const fleet = state.fleets[x.fleetId!]!;
        const layer = rocketMinelayer(fleet, data);
        if (!layer || fleet.battleId) continue;
        if (ord?.installations.some((m) => m.fleetId === fleet.id)) continue;
        const mv = fleet.movement;
        if (!mv) {
          const e = fleet.location === null ? fleet.edge : null;
          const on = e
            ? [moveFleet(ai, fleet.id, e.to), moveFleet(ai, fleet.id, e.from)].find(
                (a) => canOrder(state, a) === null,
              )
            : undefined;
          if (on) out.push(on);
          continue;
        }
        if (laid || !frontLane(mv.from, mv.to) || mined(mv.from, mv.to)) continue;
        if ((ord?.cooldowns[ai] ?? 0) > state.time || !affordableCost(layer.def.cost)) continue;
        const span = mv.arrivesAt - mv.departedAt;
        const t = span > 0 ? (state.time - mv.departedAt) / span : 0;
        if (t < 0.25 || t > 0.75) continue;
        const pair = [stopFleet(ai, fleet.id), deployRocketMine(ai, fleet.id, 'confirmed')];
        if (canOrderAll(state, pair) !== null) continue;
        out.push(...pair);
        laid = true;
      }
    }
  }
  // Trade on the session market: a passive bot liquidates the surplus goods it never
  // uses (food/energy/microelectronics) into the credits it always needs, and — when
  // flush — bids for the goods it burns fastest. One open lot per resource so it doesn't
  // spam. Prices and working stocks come from ONE table (`TRADE_BOOK`).
  if (pl) {
    const lots = state.market ?? [];
    const hasLot = (side: MarketSide, resource: string): boolean =>
      lots.some((l) => l.owner === ai && l.side === side && l.resource === resource);
    const stock = (good: string): number => pl.resources[good] ?? 0;
    // Порядок обхода — по ключам таблицы, а не по перебору казны: раскладка объекта
    // `resources` зависит от истории начислений, и один сид разыгрался бы по-разному.
    const goods = Object.keys(TRADE_BOOK);
    for (const good of goods) {
      const book = TRADE_BOOK[good]!;
      const have = stock(good);
      // NPC на слабом профиле получает прежний набор лотов: излишки на продажу и заявка на
      // металл. Заявка на микроэлектронику — из блока AI-BAL, она у обычных мест.
      const bid = skilled || good === 'metal' ? book.bid : undefined;
      if (book.ask !== undefined && have >= book.keep + 40 && !hasLot('sell', good)) {
        out.push(marketList(ai, 'sell', good, Math.floor((have - book.keep) / 2), book.ask));
      }
      if (
        bid !== undefined &&
        have < book.keep &&
        stock('credits') > TRADE_CREDIT_FLOOR &&
        !hasLot('buy', good)
      ) {
        out.push(marketList(ai, 'buy', good, 30, bid));
      }
    }
    // ═══ СИЛЬНЫЙ БОТ (AI-BAL-9): БОТ СНИМАЕТ ЧУЖИЕ ЛОТЫ ═══
    // Диагноз кирпича: `market.take` не звал НИКТО — за прогон ровно ноль сделок. Лоты
    // выставлялись, книга наполнялась и умирала нетронутой, а значит межигроковая
    // экономика (торговля, ценовое давление, эмбарго, комиссия-сток) не меряется вовсе.
    //
    // Правило симметрично собственным лотам и берёт цены из той же таблицы: чужой `sell`
    // снимается, когда товар нужен и просят не дороже своего `bid`; чужой `buy`
    // исполняется, когда товар в излишке и ЧИСТАЯ выручка не ниже своего `ask`. «Чистая»
    // тут не педантизм: комиссия ядра (`MARKET_COMMISSION`, 15% и она СГОРАЕТ) снимается
    // с получателя кредитов, поэтому сравнение с валовой ценой систематически завышало бы
    // выгоду — бот отдавал бы товар дешевле, чем сам его оценивает.
    //
    // Эмбарго зеркалится ЗДЕСЬ, хотя судит его ядро: `market.take` от игрока, на которого
    // владелец лота обиделся, отбивается `E_EMBARGO` — и без проверки бот сыпал бы этим
    // отказом каждые два часа на один и тот же лот. Правило то же самое (`botEmbargoes`),
    // взятое из общего места, а не переписанное здесь второй копией.
    let best: { id: string; qty: number; gain: number } | null = null;
    for (const lot of skilled ? lots : []) {
      if (lot.owner === ai || lot.amount <= 0) continue;
      if (botEmbargoes(state, lot.owner, ai)) continue;
      const book = TRADE_BOOK[lot.resource];
      if (!book) continue;
      const have = stock(lot.resource);
      let qty: number;
      let gain: number;
      if (lot.side === 'sell') {
        if (book.bid === undefined || lot.price > book.bid || have >= book.keep) continue;
        const affordable = Math.floor((stock('credits') - TRADE_CREDIT_FLOOR) / lot.price);
        qty = Math.min(lot.amount, book.keep - have, affordable);
        gain = (book.bid - lot.price) * qty;
      } else {
        if (book.ask === undefined) continue;
        const net = lot.price * (1 - MARKET_COMMISSION);
        if (net < book.ask) continue;
        qty = Math.min(lot.amount, have - book.keep);
        gain = (net - book.ask) * qty;
      }
      if (qty <= 0) continue;
      // Одна сделка за тик — как одна стройка за тик. Тай-брейк по id: выгода легко
      // совпадает у двух лотов, а порядок массива книги зависит от истории заказов.
      if (best === null || gain > best.gain || (gain === best.gain && lot.id < best.id)) {
        best = { id: lot.id, qty, gain };
      }
    }
    if (best !== null) out.push(marketTake(ai, best.id, best.qty));
  }
  return finishTurn(bot);
}
