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
  beaconCallouts,
  beaconSentinels,
  counterattackPlan,
  swarmAdaptDue,
  swarmNetPlan,
  musterPlan,
  SWARM_MEMORY_WINDOW,
  isRocketMineFleet,
  rocketMinelayer,
  type GameState,
  type Action,
  type Hero,
  type StewardPosture,
} from '../../packages/shared-core/src/index';
import { bossFallen, heroNode } from '../../packages/shared-core/src/state/heroes';
// Опознанные узлы считаются ОДИН раз на тик и передаются в `knownGarrison`: покрытие
// сенсоров — проход по всему флоту, а спрашивают про него десятки миров подряд.
import { canOrder, canOrderAll } from './protoKernel';
import { isForkSite } from '../../packages/shared-core/src/state/forkSite';
import {
  moveFleet,
  buildBuilding,
  buildUnit,
  canTraverse,
  marketList,
  marketTake,
  splitFleet,
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
import { launchHomeFleet, lineOrders, warFootingOrders } from './aiTurn/production';
import { shuttleSorties } from './aiTurn/shuttles';
import { strongCampaign } from './aiTurn/campaign';
import { ownsModule } from './aiTurn/rules';
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
  const { out, skilled, army, defensive, capturable, d, warFooting, base } = bot;
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
    if (skilled && warFooting) shuttleSorties(bot, home);
    launchHomeFleet(bot, home);
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
