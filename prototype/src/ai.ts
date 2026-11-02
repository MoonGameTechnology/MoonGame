/**
 * Server-side seat AIs (REFP-26) — which AI (if any) plays a seat this tick
 * (`seatAiDecision`, SES-2.2: Steward delegation ⊳ substitute-after-grace ⊳ none)
 * and the full expansion bot / delegated-posture driver (`aiOrders`). Extracted
 * from `game.ts` as a pure move. Pure builders: both hosts (solo frame loop /
 * netserver driver) apply the returned actions through the kernel. `game.ts`
 * re-exports for main.ts / netserver.ts / tests (until REFP-28).
 */
import {
  beaconCallouts,
  beaconSentinels,
  counterattackPlan,
  swarmAdaptDue,
  swarmNetPlan,
  musterPlan,
  SWARM_MEMORY_WINDOW,
  type GameState,
  type Action,
  type StewardPosture,
} from '../../packages/shared-core/src/index';
// Опознанные узлы считаются ОДИН раз на тик и передаются в `knownGarrison`: покрытие
// сенсоров — проход по всему флоту, а спрашивают про него десятки миров подряд.
import { isForkSite } from '../../packages/shared-core/src/state/forkSite';
import {
  moveFleet,
  buildBuilding,
  buildUnit,
  splitFleet,
  swarmAdapt,
} from '../../decisions/actions';
// ПРАВИЛА НАЗЕМНОЙ ВОЙНЫ БОТА (решение владельца 2026-09-16) живут в `/decisions`, а не
// здесь: «возьму ли я этот мир», «сколько оставить дома» и «что известно о гарнизоне» —
// чистые решения, которые завтра захочет показать и клиент. Своей копии у бота нет.
import { data } from './gameData';
import { planAllyOperation } from '../../decisions/allyOperation';
import { allyCaptiveOrders } from '../../decisions/captive';
import { openTurn, type AiProfile } from './aiTurn/turn';
import { consolidateFleets, expansionMoves, retreatLosingFleets } from './aiTurn/fleets';
import { declareWarOnLeader } from './aiTurn/war';
import { finishTurn } from './aiTurn/finish';
import { openHome } from './aiTurn/home';
import { economyOrders } from './aiTurn/economy';
import { researchOrders } from './aiTurn/research';
import { launchHomeFleet, lineOrders, warFootingOrders } from './aiTurn/production';
import { shuttleSorties } from './aiTurn/shuttles';
import { heroOrders } from './aiTurn/heroes';
import { marketOrders } from './aiTurn/market';
import { strongCampaign } from './aiTurn/campaign';
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
  // Ход по фазам (SLIM-3): каждая фаза живёт в `aiTurn/`, порядок фаз прежний.
  const bot = openTurn(state, ai, posture, profile, pinned);
  if (bot === null) return [];
  consolidateFleets(bot);
  if (bot.skilled) retreatLosingFleets(bot);
  expansionMoves(bot);
  if (!bot.defensive) declareWarOnLeader(bot);
  const { skilled, warFooting, base } = bot;
  // Build + launch from this AI's home base (its first developed owned world).
  const pl = state.players[ai];
  if (base && pl) {
    const home = openHome(bot, base, pl);
    economyOrders(bot, home);
    researchOrders(bot, home);
    lineOrders(bot, home);
    warFootingOrders(bot, home);
    if (skilled) strongCampaign(bot, home);
    if (skilled && warFooting) shuttleSorties(bot, home);
    launchHomeFleet(bot, home);
  }
  if (skilled && pl) heroOrders(bot, pl);
  if (pl) marketOrders(bot, pl);
  return finishTurn(bot);
}
