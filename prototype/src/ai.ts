/**
 * Server-side seat AIs (REFP-26) — which AI (if any) plays a seat this tick
 * (`seatAiDecision`, SES-2.2: Steward delegation ⊳ substitute-after-grace ⊳ none)
 * and the full expansion bot / delegated-posture driver (`aiOrders`). Extracted
 * from `game.ts` as a pure move. Pure builders: both hosts (solo frame loop /
 * netserver driver) apply the returned actions through the kernel. `game.ts`
 * re-exports for main.ts / netserver.ts / tests (until REFP-28).
 */
import {
  BASE_RESEARCH_SLOTS,
  buildingLevel,
  buildingMaxLevel,
  HERO_ACTIVE_CAP,
  abilityRange,
  getStance,
  heroCooldownKey,
  knownSkillNodes,
  MARKET_COMMISSION,
  moduleAllowed,
  previewBattle,
  slotUsage,
  technologyLock,
  techInMatch,
  scientistsOf,
  hangarMachines,
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
  isOrdnanceFleet,
  isRocketMineFleet,
  mineFleetVisible,
  rocketMinelayer,
  type GameState,
  type Action,
  type Battle,
  type CombatantRef,
  type Hero,
  type StewardPosture,
  type Planet,
  type Squadron,
  type StrikeBase,
  type Fleet,
  type UnitStack,
} from '../../packages/shared-core/src/index';
import { bossFallen, heroByFleet, heroNode } from '../../packages/shared-core/src/state/heroes';
import { fleetHangarRepairRate } from '../../packages/shared-core/src/util/repair';
// Опознанные узлы считаются ОДИН раз на тик и передаются в `knownGarrison`: покрытие
// сенсоров — проход по всему флоту, а спрашивают про него десятки миров подряд.
import { identifiedNodes } from '../../packages/shared-core/src/state/visibility';
import { canOrder, canOrderAll } from './protoKernel';
import { doctrineRanks, seatDoctrine } from './botDoctrine';
import { provinceScore } from '../../packages/shared-core/src/state/sectorKind';
import { isForkSite } from '../../packages/shared-core/src/state/forkSite';
import {
  moveFleet,
  launchFleet,
  buildBuilding,
  upgradeBuilding,
  buildUnit,
  buildShip,
  declareWar,
  canTraverse,
  marketList,
  marketTake,
  mergeFleet,
  loadArmy,
  unloadArmy,
  researchTech,
  assaultFleet,
  retreatFleet,
  bombardFleet,
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
import { confidentGroundWin } from '../../decisions/groundForecast';
import {
  garrisonDefense,
  garrisonFloor,
  garrisonNeed,
  pickForGarrison,
  spareGround,
} from '../../decisions/garrisonPolicy';
import { freshIntel, knownGarrison } from '../../decisions/garrisonIntel';
import { planDrop } from '../../decisions/dropPlan';
import { pickHoldFleet } from '../../decisions/holdPick';
import { holdsPatrol } from '../../decisions/patrolMarks';
import { frontRebase } from '../../decisions/frontRebase';
import { isLander, landerTroopCandidates } from '../../decisions/landerTroops';
import { botEmbargoes } from './botFavour';
import { netIncome } from './economy';
import { SECTOR_TYPES } from './map';
import { data } from './gameData';
import type { MarketSide } from '../../packages/shared-core/src/index';
import { stewardGuardOrders } from './stewardGuard';
import { planAllyOperation } from '../../decisions/allyOperation';
import { allyCaptiveOrders } from '../../decisions/captive';

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

/**
 * СЛОЖНОСТЬ бота — насколько хорошо он играет (AI-BAL-1.1, пересмотрено AIDIFF-1).
 *
 * `weak` — прежний простой соперник и ДЕФОЛТ: он не исследует, не торгует всерьёз, не
 * возит десант и ходит предсказуемо. Против него изучают мир, ищут баги и щупают
 * механики.
 *
 * `strong` — бот с полными эвристиками (блок AI-BAL): исследования, наземная армия и
 * десант, оборона, артиллерия, крылья, рынок, разброс решений. Он же — прибор балансных
 * прогонов (`selfplay.mjs`, `econplaytest.mjs`): без этих эвристик батч мерил бы не
 * баланс игры, а гонку двух построек.
 *
 * **Где сложность выбирается, а где её нет.** Исторически (AI-BAL-1.1) сильный бот жил
 * ТОЛЬКО в headless-харнесах: он назывался `test`, и сторож не пускал его ни в один
 * игровой путь. Заказ владельца 2026-09-07 отменил это для ОДИНОЧНОЙ игры: строка бота на
 * экране настройки переключается «выкл → слабый → сильный», и соло-драйвер зовёт
 * `aiOrders` с выбранным профилем.
 *
 * **Слабый — тот же репертуар с гандикапом (заказ владельца 2026-09-28).** Прежде всё из
 * блока AI-BAL доставалось только сильному, а слабый оставался простым ботом, который не
 * исследует и не штурмует. Теперь у обычного места оба профиля умеют одно и то же, а
 * слабый медленнее и чаще ошибается (`WEAK_HANDICAP`). NPC на слабом профиле — прежние.
 *
 * Что НЕ изменилось и меняться не должно: профиль остаётся ПАРАМЕТРОМ ФУНКЦИИ, а не полем
 * `GameState`, не сообщением протокола и не частью сохранения. Поэтому в СЕТЕВОМ матче
 * подделать его нечем — там сложность мест решает сервер, а не клиент; выбор игрока живёт
 * ровно там, где он и так владеет всем процессом, — в его собственной соло-игре.
 *
 * Сторож `aiProfile.test.ts` держит эту границу структурно: `'strong'` разрешён соло-пути
 * и харнесам, но не `netserver.ts`, и понятие по-прежнему не появляется ни в состоянии,
 * ни в payload-схемах.
 */
export type AiProfile = 'weak' | 'strong';

/**
 * Наземный ростер В ФИКСИРОВАННОМ порядке «тяжёлое → дешёвое» (AI-BAL-3).
 *
 * Порядок здесь — не вкус, а требование инварианта #1: перебор `data.units` дал бы
 * порядок, зависящий от раскладки объекта, и один сид разыгрался бы по-разному.
 * Сильный бот берёт ПЕРВОЕ, что по карману, поэтому список заодно задаёт приоритет:
 * ранняя казна тянет только ополчение, поздняя — танки.
 */
const GROUND_ROSTER = ['tank', 'special_forces', 'heavy_infantry', 'militia'] as const;

/** То же для ОБОРОНЫ: гарнизон держит тот, у кого выше `defense`, а не `attack` —
 *  тяжёлая пехота (20) стоит насмерть лучше танка (14) и втрое дешевле. */
const GROUND_DEFENDERS = ['heavy_infantry', 'tank', 'militia'] as const;

/** Наземные цеха дома, в порядке постройки (ROS-1.1): казармы дают пехоту, завод —
 *  технику. Порядок фиксирован — как и у ростера выше, ради инварианта #1. */
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
/** Предел челноков КАЖДОГО рода — картонные, дорогие по микроэлектронике, конкурируют
 *  с крейсерами за тот же дефицитный ресурс. Считаются все машины места: в ангарах
 *  портов и кораблей и в воздухе (`shuttlesOwned`), но не в составе флотов — челнок с
 *  SHU-1.1 живёт в ангаре базы и во флот не попадает никогда. */
const SHUTTLE_CAP = 3;

/** Носителей — два (решение владельца 2026-09-26 слило авианосец и десантный корабль в
 *  один корабль): столько бот держал десантных кораблей, и столько трюма ударной группе
 *  хватало на штурм. */
const CARRIER_CAP = 2;

/**
 * АРМИЯ ПОД ВЕТКУ (решение владельца 2026-10-08). Доктрина места (`botDoctrine.ts`) —
 * ветка его учёного, и после BAL-6 боевой бонус ветки идёт только своему роду войск
 * (`damageScope`). Поэтому место строит то, что его ветка усиливает, и строит ВМЕСТО
 * крейсера, а не сверх: каждый тик бот заказывает один линейный корабль, и этот слот
 * получает корпус ветки, пока таких корпусов у места меньше, чем крейсеров. Добавлять
 * сверх нельзя — казна бота и так упирается в кредиты и микроэлектронику, и лишние войска
 * съели бы её содержанием. Поле, которого нет, — прежнее общее правило.
 *
 * - `lineHulls` — корпус слота линейного корабля, по порядку: первое, что примет ядро
 *   (стапель, казна, ворота техов); `warHulls` — то же, но только на войне и первым.
 *   Ничего не принято — крейсер.
 * - `heavyYard` — улучшить верфь дома до верха: тяжёлый корпус (тяжёлый крейсер,
 *   носитель) требует стапель третьего уровня, а без улучшения ядро отбивало носитель
 *   `E_YARD_TOO_SMALL` каждый тик, и его не строил никто.
 * - `siegeCap`, `strikeCap` — потолки вместо `SIEGE_CAP` и `SHUTTLE_CAP` (у ударных
 *   челноков; перехватчиков — прежний).
 * - `minerEveryHero` — ракетный минёр в отсеке у каждого героя, а не у одного.
 */
interface DoctrineArmy {
  lineHulls?: readonly string[];
  warHulls?: readonly string[];
  heavyYard?: true;
  siegeCap?: number;
  strikeCap?: number;
  minerEveryHero?: true;
}
/** Сколько часов дохода бот готов копить на узел своей ветки (копилка доктрины). Полсуток
 *  оказались много: космос отдавал стройку узлам и проигрывал середину партии (`selfplay
 *  200` sp/alt: побед 45/41%). Без копилки вершину ветки брали 8–23% мест, с 4 часами —
 *  15–56%, а побед у космоса 48/40%. */
const DOCTRINE_SAVE_HOURS = 4;
const DOCTRINE_ARMY: Readonly<Record<string, DoctrineArmy>> = {
  // Космос: орбитальный бой и обстрел — тяжёлые крейсеры и третий осадный.
  space: { heavyYard: true, lineHulls: ['heavy_cruiser'], siegeCap: 3 },
  // Земля: наземный бой — на войне танк вместо крейсера; носители возят войска.
  ground: { heavyYard: true, warHulls: ['tank'] },
  // Шаттлы: удары челноков — на войне ударный челнок вместо крейсера, их вдвое больше;
  // носители поднимают эскадры у фронта.
  shuttle: { heavyYard: true, warHulls: ['heavy_striker', 'bomber'], strikeCap: 6 },
  // Ракеты: урон ракетной ветки идёт только минам.
  missile: { minerEveryHero: true },
};

/**
 * Ударный ростер челноков (SHU-3.2) — кого бот СТРОИТ и кого ПОСЫЛАЕТ.
 *
 * Перехватчика в списке нет намеренно, и это не пропуск: его работа — встречать чужие
 * вылеты (база поднимает звено сама, SHU-1.3) и держать патруль над базой (SHU-6.8,
 * `PATROL_WING`). Строит его бот отдельным правилом ниже; послать его бить корпуса
 * значило бы измерить не ту роль — у него `attack` 4 против 20 у бомбардировщика (ROS-1.4).
 *
 * Тяжёлый страйкер (SHU-5.6) стоит ПЕРВЫМ: заказы идут по порядку списка, и дефицитная
 * микроэлектроника достаётся сперва ему — его `strikeRange` 260 против 150 у ударного
 * достаёт соседнюю провинцию (§0.5). Пока «Ударные векторы» не изучены, ядро его заказ
 * отбивает, проба `canOrder` это видит, и очередь просто переходит к ударному.
 */
const STRIKE_SHUTTLES = ['heavy_striker', 'bomber', 'landing_shuttle'] as const;
/** Ударные машины вылета «по корпусам и мирам» — в порядке дальности: тяжёлый достаёт
 *  дальше, поэтому поднимается первым; нечем или некого — очередь ударного. */
const STRIKERS = ['heavy_striker', 'bomber'] as const;
/** Кем бот держит патруль над своей базой (SHU-6.8): перехватчиками. Патруль бьёт и
 *  флоты, и чужие вылеты, но ударные машины нужнее в ударе с базы у фронта, а дело
 *  перехватчика — чужие вылеты, которые идут к его базе. */
const PATROL_WING = ['interceptor'] as const;
/** Кандидаты в бойцы десантного челнока (SHU-5.2), от самого ударного — общее правило
 *  `/decisions/landerTroops.ts`. Строить ли их на ЭТОМ мире — спрашивается у ядра
 *  (`canOrder`) в момент заказа. */
const GROUND_BY_ATTACK: readonly string[] = landerTroopCandidates(data);

/** Запас казны сверх цены заказа (мера та же, что у построек бота). */
const ORDER_RESERVE: Record<string, number> = { metal: 60, credits: 60 };
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
/** На сколько часов минуса по кредитам должно хватать казны, чтобы бот заказал новые
 *  войска: каждое из них добавляет содержание, а кредитов оно не приносит. */
const CREDIT_RUNWAY_HOURS = 48;
/** С какого запаса металла не отстающее место вкладывает лишнее в доход (а не в армию). */
const LEADER_METAL_SURPLUS = 600;
/** Что ведущее место улучшает дома, по порядку: кредиты, налог, микроэлектроника. */
const LEADER_UPGRADES = ['refinery', 'tax_office', 'fabricator'] as const;

/** С какого размера кулак сильного бота делится надвое при отплытии (AI-BAL-7). Ниже —
 *  ударная группа и так на пределе: её порог выхода в рейд равен трём корпусам. */
const SPLIT_MIN = 6;
/** …и до какого числа флотов у места это вообще разрешено. Потолок ниже боевого предела
 *  постройки (8): деление не должно возвращать рой одиночек, вылеченный в self-play M4. */
const SPLIT_FLEET_CAP = 6;

/**
 * ОХОТА ОТСТАЮЩЕГО (снежный ком, 2026-09-28) — сколько «весит» цель, когда её выбирает
 * флот места, которое ОТСТАЁТ по очкам на войне. Курс берётся по «расстояние ÷ вес», а
 * не просто к ближайшему.
 *
 * Зачем. Во второй половине матча территория у бота ходит по кругу: миры без гарнизона
 * лидер и отстающий отбирают друг у друга ПОРОВНУ (замер: ~31 мир за матч каждый), и
 * отставание не сокращается никогда. Отстающий, который идёт к ближайшему, меняет свою
 * 10-очковую туманность на чужую такую же. Отстающий, который идёт к ценному, отбирает
 * планеты (50 очков) — и ком тает: snowball 79/73% → 60/64%, разрыв ~420 → ~280.
 *
 * Почему только отстающий. То же правило у ОБОИХ дало 68/69% при растущем разрыве:
 * лидер тоже начинает охотиться, и его большее хозяйство опять решает. Асимметрия — не
 * поблажка, а доктрина: кто впереди, держит; кто позади, бьёт туда, где больнее.
 *
 * Вес = очки провинции / 10 в коридоре [1, 5] (планета 5, прочее 1). Мир с гарнизоном,
 * который этим десантом наверняка не взять, весит в пять раз меньше: лететь к нему —
 * значит встать на орбите и ждать.
 */
export function huntWeight(target: Planet, landing: readonly UnitStack[]): number {
  let w = Math.min(5, Math.max(1, provinceScore(data, target) / 10));
  const guarded = target.garrison.some((st) => st.count > 0);
  if (guarded && !confidentGroundWin(landing, target.garrison, data)) w /= 5;
  return w;
}

/**
 * ГАНДИКАП СЛАБОГО ПРОФИЛЯ (заказ владельца 2026-09-28, ритм пересмотрен 2026-10-01). Слабый
 * бот знает всё то же, что сильный, но хуже этим пользуется:
 * - `skipTurn` — шанс пропустить ход целиком: ход — двухчасовое окно (`AI_STEP_MS`, та же
 *   каденция у соло-драйвера, сервера и self-play). Жребий свой у каждого бота и каждого
 *   окна (`decisionNoise`), поэтому слабые молчат вразнобой. Прежний строгий ритм «через
 *   окно» был общим для всех слабых: отстающий не успевал ответить, и в партиях слабых между
 *   собой лидер середины партии выигрывал 58–66% матчей (self-play, 2026-10-01);
 * - `simpleTurn` — шанс сыграть сделанный ход прежним простым ботом (`skilled` выключен):
 *   он строит, летит и воюет себе на пользу, но без эвристик блока AI-BAL;
 * - `wrongTarget` — шанс увести флот ко второй по близости цели вместо лучшей;
 * - `missRetreat` — шанс не заметить проигранный бой и остаться в нём.
 * «Хранитель» игрока (оборонительные позы) гандикапа не получает: это его собственный
 * автопилот, а не соперник.
 */
const WEAK_HANDICAP = {
  skipTurn: 0.5,
  simpleTurn: 0.5,
  wrongTarget: 0.6,
  missRetreat: 0.5,
} as const;
const NO_HANDICAP = { wrongTarget: 0.35, missRetreat: 0 } as const;

/**
 * ДЕТЕРМИНИРОВАННЫЙ ШУМ РЕШЕНИЯ (AI-BAL-5) — [0, 1).
 *
 * Зачем. Прогоны баланса не давали статистики: семьи сидов `base` и `alt` совпадали до
 * последней цифры, то есть 300 матчей были 4 конфигурациями (слот × фракция) по 75
 * повторов. Разброс терялся НЕ в карте и не в ядре, а здесь: `aiOrders` выбирала строго
 * ближайшую цель, держала фиксированные пороги и обходила миры в порядке раскладки
 * объекта — при одинаковых стартах два матча просто не могли разойтись.
 *
 * Откуда берётся энтропия. Из `state.rng` — того самого потока ядра, который seedRng
 * развёл по сидам ЕЩЁ НА СТАРТЕ матча и который дальше движется от каждого броска в бою.
 * Мы его только ЧИТАЕМ: мутировать поток снаружи ядра нельзя (это сдвинуло бы бои и
 * сломало реплей), поэтому четыре слова состояния смешиваются в отдельный хеш вместе с
 * часом мира, местом и «солью» конкретного решения.
 *
 * Почему это не ломает инвариант #1. Здесь нет ни `Math.random`, ни `Date.now`: результат
 * — чистая функция от (сид матча, история бросков, время, место, соль), то есть один сид
 * по-прежнему разыгрывается байт-в-байт одинаково. Арифметика та же, что в `rng.ts`
 * (`Math.imul` + сдвиги), — bit-exact на любом движке.
 *
 * Это НЕ «случайная игра»: бот остаётся жадным и предсказуемым, шум лишь разводит
 * равноценные ветки — вторая по близости цель вместо первой, порог войны в коридоре
 * ±20%, точка входа в обход миров. Слабому боту тем же шумом бросаются жребии гандикапа
 * (`WEAK_HANDICAP`, `weakTurn`).
 */
function decisionNoise(state: GameState, ai: string, salt: string): number {
  const r = state.rng;
  let h = (r.a ^ r.b ^ r.c ^ r.d) >>> 0;
  h = Math.imul(h ^ Math.floor(state.time / 3_600_000), 2246822507) >>> 0;
  const key = `${ai}|${salt}`;
  for (let i = 0; i < key.length; i++) {
    h = Math.imul(h ^ key.charCodeAt(i), 3432918353) >>> 0;
    h = ((h << 13) | (h >>> 19)) >>> 0;
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507) >>> 0;
  h = (h ^ (h >>> 13)) >>> 0;
  return h / 4294967296;
}

/**
 * Ход слабого бота в этом двухчасовом окне (`WEAK_HANDICAP`): пропуск, ход простым ботом
 * или полный. Экспорт — для тестов: умения слабого проверяются в его полном ходе.
 */
export function weakTurn(state: GameState, ai: string): 'skip' | 'simple' | 'full' {
  const turn = Math.floor(state.time / (2 * 3_600_000));
  if (decisionNoise(state, ai, `turn:${turn}`) < WEAK_HANDICAP.skipTurn) return 'skip';
  return decisionNoise(state, ai, `simple:${turn}`) < WEAK_HANDICAP.simpleTurn ? 'simple' : 'full';
}

/**
 * Порядок обхода миров, ПОВЁРНУТЫЙ на seeded смещение (AI-BAL-5, точка разброса №3).
 *
 * Блоки развития выписывают одну стройку за тик и выходят по `break`, поэтому решает не
 * весь список, а его ПЕРВЫЙ подходящий элемент — а он до сих пор определялся раскладкой
 * объекта `state.planets`, одинаковой во всех матчах. Ротация сохраняет относительный
 * порядок (это не перемешивание: жадность бота не страдает), но сдвигает точку входа,
 * так что развиваться первым начинает разный мир. Игровой профиль обходит как раньше.
 */
function worldsInOrder(state: GameState, ai: string, salt: string, skilled: boolean): Planet[] {
  const all = Object.values(state.planets);
  if (!skilled) return all;
  // Ротируются именно СВОИ миры, а не весь список: чужих и нейтральных на карте вчетверо
  // больше, и они лежат вперемешку, так что поворот всего массива почти всегда возвращал
  // к тем же двум-трём своим в его начале — точка входа не менялась. Прочие миры едут
  // следом нетронутым хвостом: вызывающие всё равно фильтруют по владельцу.
  const own: Planet[] = [];
  const rest: Planet[] = [];
  for (const p of all) (p.owner === ai ? own : rest).push(p);
  if (own.length < 2) return all;
  const shift = Math.floor(decisionNoise(state, ai, `order:${salt}`) * own.length) % own.length;
  return own.slice(shift).concat(own.slice(0, shift), rest);
}

/** Стоит ли на мире ЖИВОЕ здание, в котором можно заложить ИМЕННО ЭТОТ юнит: пехоте
 *  нужны казармы, технике — завод (ROS-1.1). Зеркало ядерного `hasGroundFacility`
 *  (`construction.ts`), того самого гейта, который отбивает `unit.build` кодами
 *  `E_NO_BARRACKS` / `E_NO_FACTORY`.
 *
 *  Род войск читается из ДАННЫХ (`UnitDef.kind`), а не из списка id: иначе новый
 *  наземный юнит молча выпал бы из репертуара бота и снова стал «мёртвым контентом»
 *  в замерах — ровно тот диагноз, ради которого писался AI-BAL-3. */
function hasFacilityFor(p: Planet, unit: string): boolean {
  const flag =
    data.units[unit]?.kind === 'vehicle'
      ? 'enablesVehicleConstruction'
      : 'enablesInfantryConstruction';
  return p.buildings.some((b) => b.hp > 0 && data.buildings[b.type]?.[flag] === true);
}

/** Сколько НАЗЕМНЫХ юнитов стоит в гарнизоне мира (корабли в гарнизоне не в счёт). */
function groundCount(p: Planet): number {
  return p.garrison.reduce((n, s) => n + (data.units[s.unit]?.domain === 'ground' ? s.count : 0), 0);
}

/** Свободный трюм флота: Σ cargoCapacity кораблей − Σ cargoSize уже погруженного
 *  десанта. Та же формула, что у ядра (`army.ts`), иначе погрузка сыпала бы
 *  `E_NO_CAPACITY`. */
function liftFree(f: Fleet): number {
  const cap = f.units.reduce(
    (n, s) => n + (data.units[s.unit]?.stats.cargoCapacity ?? 0) * s.count,
    0,
  );
  const used = (f.landing ?? []).reduce(
    (n, s) => n + (data.units[s.unit]?.stats.cargoSize ?? 1) * s.count,
    0,
  );
  return cap - used;
}

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
  const state = provincesOnly(full);
  if (state.players[ai]?.npc === 'neutral') return allySeatOrders(state, ai, posture, profile);
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
  const out: Action[] = [];
  if (!state.players[ai] || state.players[ai]!.status === 'defeated') return out; // seat not in play / eliminated
  // The defensive family: both Steward postures HOLD (no expansion, no war
  // declarations); «Активная оборона» merely adds the counterstrike/fire-watch
  // inside the guard-duty tick below.
  if (state.players[ai]!.npc === 'neutral') posture = 'active_defend';
  if (state.players[ai]!.npc === 'pirate') posture = 'expand';
  // NPC pirates replenish their own roster; ordinary and legacy seats retain theirs.
  const pirate = state.players[ai]!.faction === 'pirates';
  // ОДИН РЕПЕРТУАР, РАЗНАЯ РУКА (заказ владельца 2026-09-28: «слабый бот тоже умный, но
  // менее шустрый и чаще ошибается»). Эвристики блока AI-BAL достаются ОБОИМ профилям
  // обычного места; слабость — это `WEAK_HANDICAP`, а не отсутствие умений. NPC (пираты,
  // нейтральные союзники, Рой забега) на слабом профиле играют прежним простым ботом: это PvE-контент,
  // и его баланс здесь не трогается.
  const capable =
    profile === 'strong' || (!state.players[ai]!.npc && state.pve?.npcPlayerId !== ai);
  const hand = profile === 'weak' && capable && posture === 'expand' ? WEAK_HANDICAP : NO_HANDICAP;
  // Медленнее и неровнее: слабый бот молчит в части двухчасовых окон, а в части играет
  // простым ботом. Оба жребия — от сида и часов мира, так что реплей не страдает.
  const turn = hand === WEAK_HANDICAP ? weakTurn(state, ai) : 'full';
  if (turn === 'skip') return out;
  const skilled = capable && turn === 'full';
  const lineUnit = pirate ? 'pirate_cruiser' : 'cruiser';
  const scoutUnit = pirate ? 'pirate_skiff' : 'scout';
  const militiaUnit = pirate ? 'pirate_boarder' : 'militia';
  // Доктрина — ветка учёного совета места (`botDoctrine.ts`); у NPC совета нет.
  const doctrine = skilled
    ? seatDoctrine(scientistsOf(state.players[ai]), data.scientists, data.technologies)
    : undefined;
  const army: DoctrineArmy = (doctrine !== undefined ? DOCTRINE_ARMY[doctrine] : undefined) ?? {};
  /** Что место копит на узел своей ветки (копилка доктрины, блок исследований). */
  let saving: ReadonlySet<string> = new Set();
  const groundRoster: readonly string[] = pirate
    ? ['pirate_tank', 'pirate_marauder', 'pirate_boarder'] : GROUND_ROSTER;
  const groundDefenders: readonly string[] = pirate
    ? ['pirate_marauder', 'pirate_tank', 'pirate_boarder'] : GROUND_DEFENDERS;
  const defensive = posture === 'defend' || posture === 'active_defend';
  // Steward guard duty (ST-3.2/3.3): a delegated defensive seat watches its worlds,
  // evacuates a wing the forecast says it would lose ≥ STEWARD_LOSS_LIMIT of, and —
  // under «Активная оборона» — counterstrikes what it beats cheaply on own soil.
  if (defensive) out.push(...stewardGuardOrders(state, ai, posture as StewardPosture));
  const isShipUnit = (u: string): boolean => !data.units[u]?.traits.includes('ground');
  const capturable = (p: Planet): boolean => SECTOR_TYPES[p.kind ?? '']?.capturable ?? false;
  /** ORB-1: бомбардировать можно только узел с орбитальным слоем (планета и
   *  космическая крепость). Без этой проверки ИИ вставал бы над туманностью и
   *  выдавал `fleet.bombard` каждый цикл, получая `E_WRONG_SECTOR` до конца матча —
   *  та же вечная стоянка, что описана выше про `E_SAME_LOCATION`. */
  const orbitalLayer = (p: Planet): boolean => SECTOR_TYPES[p.kind ?? '']?.orbit ?? true;
  /** Ближайшая ЧУЖАЯ цель, которую этот флот, скорее всего, и будет штурмовать. Тем же
   *  правилом («ближайший захватываемый, тай-брейк по id») ниже выбирается курс, поэтому
   *  «сколько десанта мне ещё нужно» спрашивается про ту самую цель, а не про абстрактную. */
  const assaultTargetFor = (fl: Fleet): Planet | undefined => {
    const at = fl.location ? state.planets[fl.location] : undefined;
    if (!at) return undefined;
    return Object.values(state.planets)
      .filter((p) => p.owner !== ai && capturable(p) && canTraverse(state, ai, p.owner))
      .sort(
        (a, b) =>
          d(at.position, a.position) - d(at.position, b.position) ||
          (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
      )[0];
  };
  /** Свой мир, которому подкрепление нужнее всего и ближе всего. Сортировка по паре
   *  «расстояние, id» — решение бота обязано быть чистой функцией состояния. */
  const neediestWorld = (from: { x: number; y: number }): Planet | undefined =>
    Object.values(state.planets)
      .filter((p) => p.owner === ai && p.kind === 'planet' && garrisonNeed(p, data) > 0)
      .sort(
        (a, b) =>
          d(from, a.position) - d(from, b.position) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
      )[0];
  const d = (a: { x: number; y: number }, b: { x: number; y: number }): number =>
    Math.hypot(a.x - b.x, a.y - b.y);
  // Send each idle AI fleet toward the nearest capturable world it can reach — only
  // neutral worlds or territory of someone it's at WAR with (peace = off-limits).
  // Steward «Оборона» (a delegated human seat, posture 'defend') HOLDS: it skips this
  // offensive sweep entirely and only builds / reinforces / trades below — repelling an
  // attacker is automatic in combat. "Autopilot keeps you alive; active play wins."
  // Named `warFooting` (not `atWar`) so the module-level pair helper stays visible.
  const warFooting = Object.keys(state.players).some(
    (pid) =>
      pid !== ai && state.players[pid]?.status === 'active' && getStance(state, ai, pid) === 'war',
  );
  // The home base (build/launch anchor, and the rally point ships pool at during war).
  //
  // ЯКОРЬ — ВЕРФЬ, а не «первый застроенный мир» (баг, найденный при AI-BAL-3, чинится
  // ОБОИМ профилям). Стоило боту поставить шахту на призовом мире — и `find` начинал
  // возвращать ЕГО: «дом» переезжал на мир без космопорта. Дальше каждый заказ корабля
  // отбивался `E_NO_SHIPYARD` (в пробном матче — 102 отказа за матч), экономическая
  // цепочка строилась не дома, а на призовом мире, и флот переставал пополняться вовсе.
  // Обе прежние ветки оставлены запасными: у мира без верфи якорь тот же, что и был.
  const base =
    Object.values(state.planets).find(
      (p) =>
        p.owner === ai &&
        p.buildings.some(
          (b) => b.hp > 0 && data.buildings[b.type]?.enablesShipConstruction === true,
        ),
    ) ??
    Object.values(state.planets).find((p) => p.owner === ai && p.buildings.length > 0) ??
    Object.values(state.planets).find((p) => p.owner === ai);
  const shipCount = (f: Fleet): number =>
    f.units.reduce((n, s) => n + (isShipUnit(s.unit) ? s.count : 0), 0);
  const expandFleets: Fleet[] = defensive ? [] : Object.values(state.fleets);
  // Ничьи планеты держит ополчение (`NEUTRAL_PLANET_MILITIA`), и брать их надо десантом
  // даже в мирное время. Пока такая планета есть, флот грузится дома и без войны.
  const neutralGuarded = Object.values(state.planets).some(
    (p) => p.owner === null && capturable(p) && p.garrison.some((st) => st.count > 0),
  );
  // Отстаю ли я по очкам провинций от кого-то из живых соперников (охота отстающего,
  // см. `huntWeight`). Тот же счёт ниже решает объявление войны.
  const provinceTotal = (who: string): number =>
    Object.values(state.planets).reduce(
      (s, p) => (p.owner === who ? s + provinceScore(data, p) : s),
      0,
    );
  const myProvinces = provinceTotal(ai);
  const trailing = Object.keys(state.players).some(
    (pid) =>
      pid !== ai && state.players[pid]?.status === 'active' && provinceTotal(pid) > myProvinces,
  );
  // Сколько флотов у места СЕЙЧАС — потолок и на постройку кораблей, и на деление кулака
  // (AI-BAL-7). Считается один раз: `state` внутри `aiOrders` не меняется (чистый builder).
  // Стоящая мина и летящая ракета — тоже отряды во `fleets`, но не флоты: посчитай их —
  // и шесть мин минёра закрыли бы боту постройку кораблей.
  const ownFleets = Object.values(state.fleets).filter(
    (fl) => fl.owner === ai && !isOrdnanceFleet(fl, data),
  ).length;
  // Consolidate BEFORE moving (self-play M4): two idle fleets sharing a location fuse
  // into one — without this, battle remnants and rally leftovers accumulate into a
  // hundreds-strong swarm of one-ship fleets that grinds the whole sim (and feeds
  // enemy AA one hull at a time). The merged fleet sorties on the next tick.
  const skipMove = new Set<string>();
  {
    // Дозорный маяка и посты сети стоят особняком: слей бот такой флот с проходящим — и
    // якорь ждал бы слияния, которое обёртка `aiOrders` не пропустит, то есть стоял бы вечно.
    const byLoc = new Map<string, Fleet[]>();
    for (const f of expandFleets) {
      if (f.owner !== ai || f.location == null || f.movement || f.battleId) continue;
      if (pinned.has(f.id)) continue;
      const group = byLoc.get(f.location);
      if (group) group.push(f);
      else byLoc.set(f.location, [f]);
    }
    for (const group of byLoc.values()) {
      if (group.length < 2) continue;
      group.sort((a, b) => shipCount(b) - shipCount(a));
      const anchor = group[0]!;
      // Считается НАРАСТАЮЩИМ итогом, а не по состоянию на начало тика: приказы
      // применяются подряд, и первый же влившийся геройский флот делает якорь
      // геройским. Снимок пропустил бы второе слияние — оно отбилось бы при уже
      // поставленном `skipMove`, то есть вернуло бы ту же вечную стоянку.
      let anchorHasHero = !!heroByFleet(state, anchor.id);
      let merged = false;
      for (let k = 1; k < group.length; k++) {
        const from = group[k]!;
        // ПРАВИЛО «ОДИН ГЕРОЙ НА ФЛОТ» (HERO-10, резолюция владельца «как в HoMM»): ядро
        // отбивает слияние ДВУХ геройских флотов кодом `E_TWO_HEROES`. Безгеройский к
        // герою присоединить можно — это обычное усиление, герой в итоге один.
        //
        // Бот про это правило не знал, и цена оказалась не косметической (AI-BAL-13): два
        // геройских флота в одной точке отбивались каждый тик, а `skipMove` ставился им
        // ВСЁ РАВНО — оба стояли навсегда. Замер при CONV-12b: боёв 12370 → 119, наземных
        // 7073 → 0. Остановка боевой части игры, а не дрейф баланса.
        const fromHasHero = !!heroByFleet(state, from.id);
        if (anchorHasHero && fromHasHero) continue;
        out.push(mergeFleet(ai, from.id, anchor.id));
        skipMove.add(from.id);
        merged = true;
        if (fromHasHero) anchorHasHero = true; // герой переехал в якорь вместе с флотом
      }
      // Ход гасится ТОЛЬКО тому, чьё слияние действительно отправлено: якорь, в который
      // никто не влился, обязан лететь сам, а не ждать роста, которого не будет.
      if (merged) skipMove.add(anchor.id); // вырастет сейчас, вылетит на следующем тике
    }
  }
  // ═══ СИЛЬНЫЙ БОТ (AI-BAL-7): ФЛОТ УМЕЕТ ПРОИГРАТЬ БОЙ ═══
  // Диагноз кирпича: из боевого репертуара ядра бот звал только `fleet.engage` и
  // `fleet.assault`, а `fleet.retreat` — НИКОГДА. Значит каждый бой в измерении шёл до
  // полного уничтожения одной из сторон: размен всегда полный, «потрёпанный флот» как
  // состояние не существовал, и вся ветка ядра вокруг отступления (пошлина в 40%
  // ТЕКУЩЕГО корпуса, скоростная фора беглеца `retreatHasteUntil`, освобождение
  // противника) не участвовала в балансе ни одной цифрой.
  //
  // Правило одно и БЕЗ порога-настройки: проигрываю — ухожу. Пошлина забирает 40% того,
  // что осталось, и по построению никого не добивает (`applyRetreatToll`: 0.6 × живой
  // пул остаётся живым), а проигранный бой забирает 100% — выбор между ними не требует
  // ни коэффициента, ни калибровки. Выигранный бой держится даже дорогой ценой: размен,
  // который заканчивается взятым узлом, это и есть плата за узел.
  //
  // Прогноз — тот самый `previewBattle`, которым уже судит «Хранитель»
  // (`stewardGuard.ts`), а не вторая копия правила: базовая модель без хуков
  // `combat.damage`, то есть эвристика, а не оракул. Роли в прогнозе сохраняются
  // (атакующий бьёт `attack`, стоящая сторона отвечает `defense`) — перепутать их
  // значило бы прогнозировать другой бой.
  //
  // Уход в том же тике ОБЯЗАТЕЛЕН, и это не украшение. `fleet.retreat` только распускает
  // бой: флот остаётся стоять там же, рядом с тем же противником, который в тот же миг
  // освобождён. Оставшийся стоять беглец был бы втянут заново и платил бы пошлину каждые
  // два часа, пока не сточится в ноль, — ровно та «драка до нуля», от которой уводит
  // кирпич, только медленнее. Скоростная фора беглеца выдана ядром именно под этот шаг.
  if (skilled) {
    const sideUnits = (ref: CombatantRef): UnitStack[] => {
      if (ref.kind === 'garrison') return state.planets[ref.planetId]?.garrison ?? [];
      // ROS-1.5: плацдарм держит мир, а не флот — оценивается так же, как гарнизон.
      if (ref.kind === 'beachhead')
        return (
          state.planets[ref.planetId]?.beachheads?.find((b) => b.owner === ref.owner)?.units ?? []
        );
      const other = state.fleets[ref.fleetId];
      if (!other) return [];
      return ref.kind === 'landing' ? (other.landing ?? []) : other.units;
    };
    const isThisFleet = (ref: CombatantRef, fleetId: string): boolean =>
      ref.kind === 'fleet' && ref.fleetId === fleetId;
    for (const f of Object.values(state.fleets)) {
      if (f.owner !== ai || f.battleId == null) continue;
      const battle: Battle | undefined = state.battles[f.battleId];
      if (!battle) continue;
      // Отступить может только ОРБИТАЛЬНАЯ сторона: сошедший на грунт десант ядро не
      // выпускает (`E_CANNOT_RETREAT`), так что приказ был бы чистым отказом.
      // MSB-1: своя сторона ищется СРЕДИ СТОРОН, враг — то, что не она. На двух это
      // прежнее «атакующий или обороняющийся», при N — единственная верная форма вопроса.
      const mine = battle.sides.find((s) => isThisFleet(s.ref, f.id));
      if (!mine) continue;
      const weAttack = mine.role === 'attacker';
      const foeSide = battle.sides.find((s) => s !== mine);
      if (!foeSide) continue;
      const foe = sideUnits(foeSide.ref);
      if (!foe.some((s) => s.count > 0)) continue; // добивать уже некого — бой наш
      const forecast = weAttack
        ? previewBattle(f.units, foe, data)
        : previewBattle(foe, f.units, data);
      if (forecast.outcome !== (weAttack ? 'defender' : 'attacker')) continue;
      // Слабый профиль замечает проигранный бой не всегда (`WEAK_HANDICAP.missRetreat`).
      if (decisionNoise(state, ai, `retreat:${f.id}`) < hand.missRetreat) continue;
      out.push(retreatFleet(ai, f.id));
      // Куда бежать: ближайший СВОЙ мир, а при перехвате на лейне (узла под флотом нет)
      // — домой. Некуда — флот всё равно выходит из боя: пошлина дешевле уничтожения.
      const from = f.location != null ? state.planets[f.location] : undefined;
      let haven: Planet | null = null;
      let havenD = Infinity;
      if (from) {
        for (const p of Object.values(state.planets)) {
          if (p.owner !== ai || p.id === from.id) continue;
          const dd = d(from.position, p.position);
          if (dd < havenD) {
            havenD = dd;
            haven = p;
          }
        }
      }
      const refuge = haven ?? (base && base.id !== f.location ? base : null);
      if (refuge) out.push(moveFleet(ai, f.id, refuge.id));
    }
  }
  for (const f of expandFleets) {
    if (f.owner !== ai || f.location == null || f.movement || f.battleId) continue;
    // Высадка штурмом и выгрузка идут по таймеру (решение владельца 2026-09-26): флот стоит,
    // пока десант не сошёл, — любой приказ ему был бы отказом, а курс отменил бы выгрузку.
    if (f.assaultLanding || (f.unloading ?? []).length > 0) continue;
    if (skipMove.has(f.id)) continue;
    // ═══ СИЛЬНЫЙ БОТ (AI-BAL-3): десант и штурм ═══
    // Игровой бот не делает НИ ТОГО, НИ ДРУГОГО, и вот почему вторая фаза захвата
    // (орбита → высадка, GDD §7.4) в измерении баланса не участвовала вовсе:
    //   • приказ `fleet.assault` бот не отдавал НИКОГДА. В сети штурм ведёт драйвер
    //     `serverAutoAssaultActions`, а тот ходит только по флотам, которым ИГРОК
    //     включил авто-штурм (`order.auto`) — у бота такого флага нет ни одного;
    //   • трюм он грузил только на войне и только двумя ополченцами.
    // Итог в батче: гарнизонный мир для бота просто НЕПРОХОДИМ — флот прилетает,
    // `captureOnArrival` пропускает защищённый мир, и флот стоит на орбите до конца
    // матча. Игровой профиль не тронут: это лаборатория.
    if (skilled && base) {
      const here0 = state.planets[f.location];
      // (а) Погрузка ДОМА — ТОЛЬКО ПОД АТАКУ (правило владельца №5, 2026-09-16:
      //     «загружает наземные юниты только когда целенаправленно нападает на планеты
      //     врага»). Раньше грузили и в мирное время; довод был «пустой трюм у стены
      //     гарнизона означает, что флот долетит и встанет». Довод верен, а цена его —
      //     войска, которые месяцами катаются в трюме и пропадают ВМЕСТЕ с флотом:
      //     гибель корпусов стирает `fleet.landing` целиком (`combat.ts`, удаление
      //     флота), отдельного броска у десанта нет. В мирное время брать нечего —
      //     пустой мир занимается прилётом, и войска ему не нужны. Исключение — ничья
      //     планета под ополчением (BAL-10, `NEUTRAL_PLANET_MILITIA`): её тоже берут
      //     штурмом, поэтому, пока такие есть, флот грузится и без войны.
      //
      //     СКОЛЬКО БРАТЬ, решает `spareGround` (правило №6: досуха не вычёрпывать,
      //     пол растёт с развитостью мира). Отдаёт он УДАРНЫЕ рода, оставляя дома
      //     оборонительные, — танк полезнее на чужой земле, ополченец на своей.
      //     ПОДЪЁМ ЗАНИМАЕТ ЧАС (CARGO-1), а вылет его ОТМЕНЯЕТ: флот, который
      //     грузится, этот тик СТОИТ дома, иначе улетел бы с пустым трюмом.
      if (here0 && here0.id === base.id && (warFooting || neutralGuarded)) {
        if ((f.loading ?? []).length > 0) continue; // подъём идёт — ждём его
        let free = liftFree(f);
        let ordered = false;
        for (const st of spareGround(here0, data)) {
          if (free <= 0) break;
          const size = data.units[st.unit]?.stats.cargoSize ?? 1;
          const take = Math.min(st.count, Math.floor(free / size));
          if (take > 0) {
            out.push(loadArmy(ai, f.id, st.unit, take));
            free -= take * size;
            ordered = true;
          }
        }
        if (ordered) continue; // час подъёма — вылет следующим тиком
      }
      // (а2) ГАРНИЗОН НА ЗАНЯТОМ МИРЕ (AI-BAL-2, доращено подвозом 2026-09-16). Мир без
      //      войск берётся ПРИЛЁТОМ — `captureOnArrival` не смотрит ни на здания, ни на
      //      их оборонный бонус, только на `garrison.some(count > 0)`. Отсюда карусель
      //      базовой линии: 113 захватов прилётом за матч, миры перекидываются без
      //      единого выстрела.
      //
      //      РАНЬШЕ ССАЖИВАЛИ РОВНО ОДНОГО, и довод был «остальной десант нужен самому
      //      флоту». Довод верен только наполовину: нужен ровно тот десант, которым флот
      //      РЕАЛЬНО возьмёт свою цель, а всё сверх того он просто возит — и теряет
      //      вместе с корпусами. Поэтому ссаживается столько, сколько мир не добирает до
      //      пола (правило владельца №4), но не глубже, чем позволяет уверенность в
      //      ближайшей цели: ту же `confidentGroundWin` спрашивает и сам штурм, так что
      //      разойтись эти два ответа не могут.
      if (here0 && here0.owner === ai && here0.id !== base.id && capturable(here0)) {
        const need = garrisonNeed(here0, data);
        const carried = (f.landing ?? []).filter((st) => st.count > 0);
        if (need > 0 && carried.length > 0) {
          const target = assaultTargetFor(f);
          let gave = false;
          for (const give of pickForGarrison(carried, need, data)) {
            // Оставшееся обязано взять цель. Нет цели — отдаём без оглядки: возить
            // десант некуда, а мир без гарнизона перекидывают прилётом.
            const left = carried.map((st) =>
              st.unit === give.unit ? { ...st, count: st.count - give.count } : { ...st },
            );
            if (target && !confidentGroundWin(left, target.garrison, data)) break;
            out.push(unloadArmy(ai, f.id, give.unit, give.count));
            gave = true;
          }
          // ВЫГРУЗКА ЗАНИМАЕТ ЧАС (как подъём), а вылет её ОТМЕНЯЕТ: флот, отдавший войска
          // миру, этот тик стоит, иначе улетел бы с ними же на борту.
          if (gave) continue;
        }
      }
      // (а3) ПОДВОЗ ПОДКРЕПЛЕНИЯ — вторая половина правила владельца №4 (2026-09-16).
      //      Замер показал, что войска у бота ЕСТЬ, они просто лежат не там: за 78
      //      суточных срезов 179 миров стояли ниже пола на 2432 очка обороны суммарно,
      //      при излишке 23004 очка на 1619 других миров. Строить на месте умеет не
      //      каждый — 63 из 179 миров были без казармы вовсе.
      //
      //      Грузится ИЗЛИШЕК со своего мира, и только НЕ ДОМА: дома трюм наполняет
      //      правило (а) под атаку, и два правила на один трюм передрались бы за него.
      //      Пустой трюм в условии — граница, из-за которой подвоз не может разоружить
      //      ударную группу: флот с десантом на борту он не трогает вовсе.
      if (
        here0 &&
        here0.owner === ai &&
        here0.id !== base.id &&
        !(f.landing ?? []).some((st) => st.count > 0) &&
        (f.loading ?? []).length === 0 &&
        neediestWorld(here0.position) !== undefined
      ) {
        let free = liftFree(f);
        let ordered = false;
        for (const st of spareGround(here0, data)) {
          if (free <= 0) break;
          const size = data.units[st.unit]?.stats.cargoSize ?? 1;
          const take = Math.min(st.count, Math.floor(free / size));
          if (take > 0) {
            out.push(loadArmy(ai, f.id, st.unit, take));
            free -= take * size;
            ordered = true;
          }
        }
        if (ordered) continue; // час подъёма — курс следующим тиком
      }
      // (б) Штурм с орбиты. Правила штурма называет ЯДРО (`assaultPlanet`), здесь
      //     только повод не сыпать заведомо отбиваемым приказом: чужой захватываемый
      //     мир, война/нейтралитет и чем его брать.
      //     «Чем брать» — ДВА разных случая, и раньше учитывался только первый:
      //     живой гарнизон берётся десантом из трюма, а ПУСТОЙ занимается и без него
      //     (`assaultPlanet`: `undefined → occupy`). Второй случай не выдумка — мир
      //     пустеет уже под флотом (гарнизон добит наземным боем или ПКО-разменом), а
      //     `captureOnArrival` больше не сработает: он судит по ПРИЛЁТУ, а флот давно
      //     прилетел. Без этой ветки такой мир не берёт никто, и осада ниже подменила
      //     бы собой бесплатный захват.
      if (
        here0 &&
        f.orbit === 'near' &&
        here0.owner !== ai &&
        capturable(here0) &&
        canTraverse(state, ai, here0.owner) &&
        (!here0.garrison.some((st) => st.count > 0) ||
          // ПРАВИЛО ВЛАДЕЛЬЦА №2 (2026-09-16): штурмовать, только будучи УВЕРЕННЫМ, что
          // наземные силы возьмут гарнизон. Раньше хватало любого бойца в трюме — и
          // десант из двух ополченцев ложился под ротой тяжёлой пехоты, не сдвинув
          // ничего. Гарнизон читается ПРЯМО: флот стоит в ближней орбите, мир опознан,
          // и разведданные здесь — само наблюдение (правило №1 соблюдено по построению).
          confidentGroundWin(f.landing ?? [], here0.garrison, data))
      ) {
        out.push(assaultFleet(ai, f.id));
        continue; // берём ЭТОТ мир, а не улетаем к следующему
      }
      // (в) ОСАДА (AI-BAL-7). Мир под флотом взять нечем — но стоять над ним МОЛЧА
      //     нельзя: ПКО бьёт по всему враждебному в near-орбите независимо от того,
      //     бомбит гость или нет (`runOrbital` — залп ищет `nearOrbitHostile`, а не
      //     бомбардировщика), так что молчащий флот платит ту же цену и не получает
      //     ничего. Бомбардировка — единственное, что он может сделать имеющимся
      //     оружием: она крошит постройки под собой (`planet.bombarded` →
      //     `damageBuildings`) и морозит владельцу производство и стройку
      //     (`bombardedPlanets`). Целый пласт ядра — осада — до сих пор не участвовал
      //     в измерении ни разу.
      //     Это не НОВАЯ стоянка, а смысл уже существующей: флоту, которому нечем взять
      //     мир, целеуказание и раньше выдавало ближайшую чужую цель — ту самую, под
      //     которой он стоит (расстояние 0), — и `fleet.move` в собственную клетку
      //     возвращался `E_SAME_LOCATION` каждые два часа до конца матча.
      if (
        here0 &&
        f.orbit === 'near' &&
        here0.owner !== null &&
        here0.owner !== ai &&
        capturable(here0) &&
        orbitalLayer(here0) && // ядро бомбит только планету и космическую крепость
        getStance(state, ai, here0.owner) === 'war' && // ядро бомбит только врага
        f.units.some((st) => st.count > 0)
      ) {
        if (f.bombarding !== true) out.push(bombardFleet(ai, f.id, true));
        continue; // осада — это стоянка НАД целью, а не пауза перед перелётом
      }
    }
    // Strike groups, not dribbles (self-play M4): auto-rally pools each new ship into
    // the IDLE rally fleet at its build world — but only while one is parked there.
    // Sending every single-ship fleet out at once therefore orphaned the rally point,
    // spawned a fresh one-ship fleet per build (hundreds of fleets, the sim ground to
    // a halt) and fed hulls into enemy AA one at a time. At war, ships HOLD at the
    // home rally point until a strike group has formed; peacetime keeps the old
    // race-to-claim behaviour (speed is everything, there is nothing to fight).
    if (warFooting && f.location === base?.id) {
      if (shipCount(f) < 3) continue;
      // Lift a landing party before the sortie: only ground troops can take a
      // garrisoned world (two-phase capture), so a strike group without a landing
      // can raid provinces but never resolve the war.
      // ПОДЪЁМ ЗАНИМАЕТ ЧАС (CARGO-1), и вылет его ОТМЕНЯЕТ — поэтому «погрузить и
      // улететь одним тиком» больше не работает: группа ждёт свой десант дома и
      // уходит следующим тиком уже с ним. Без ожидания она улетала бы пустой и до
      // конца матча не могла бы взять ни одного гарнизонного мира.
      if ((f.loading ?? []).length > 0) continue; // подъём идёт — стоим
      // ПОЛ ГАРНИЗОНА (правило владельца №6) держит и этот путь: пара бойцов эскорта
      // не должна опустить мир ниже того, что он обязан оставить себе. Двойка здесь —
      // не доктрина, а минимальный эскорт, и её кап остаётся как был.
      const spareMilitia = spareGround(base, data).find((s) => s.unit === militiaUnit);
      const hasLanding = (f.landing ?? []).some((s) => s.count > 0);
      if (!hasLanding && spareMilitia) {
        out.push(loadArmy(ai, f.id, militiaUnit, Math.min(2, spareMilitia.count)));
        continue; // час подъёма — вылет следующим тиком
      }
    }
    const here = state.planets[f.location];
    if (!here) continue;
    let best: Planet | null = null;
    let bestD = Infinity;
    let second: Planet | null = null;
    let secondD = Infinity;
    // ТАЙ-БРЕЙК ПРИ РАВНЫХ ЦЕЛЯХ (BAL-1). На прежней, кривой карте равные расстояния были
    // редкостью, и «кто первый в переборе, тот и цель» ничего не решало. Карта-«колесо»
    // симметрична, поэтому равенство стало ОБЫЧНЫМ делом — и скрытый тай-брейк по порядку
    // `Object.values(state.planets)` превратился в систематическую фору: узлы сектора 0
    // лежат в этом порядке первыми, так что место, стартующее в нулевом секторе, всегда
    // забирало спорную цель. Замер: при идентичных по метрикам стартах сектор 0 брал 70%
    // побед. Идеальная карта не создала перекос, она ОБНАЖИЛА его в боте.
    // Лечение — seeded тай-брейк (только тест-профиль, как и весь разброс AI-BAL-5):
    // среди равных целей выбор идёт по шуму, а не по раскладке объекта.
    const tieBreak = (p: Planet): number =>
      skilled ? decisionNoise(state, ai, `tie:${f.id}:${p.id}`) : 0;
    // Охота отстающего — у обоих профилей обычного места (игровой бот, 2026-09-28).
    const hunting = skilled && warFooting && trailing;
    const weight = (p: Planet): number => (hunting ? huntWeight(p, f.landing ?? []) : 1);
    for (const p of Object.values(state.planets)) {
      if (p.owner === ai || !capturable(p)) continue;
      if (!canTraverse(state, ai, p.owner)) continue; // a peace-locked target — leave it be
      // Ничью планету с гарнизоном, которую этот десант наверняка не возьмёт, не
      // выбирают, иначе флот повиснет на её орбите до конца матча.
      if (
        p.owner === null &&
        p.garrison.some((st) => st.count > 0) &&
        !confidentGroundWin(f.landing ?? [], p.garrison, data)
      )
        continue;
      // Равные цели (в пределах пикселя) разводятся шумом, а не порядком перебора.
      const dd = d(here.position, p.position) / weight(p) + tieBreak(p);
      if (dd < bestD) {
        secondD = bestD;
        second = best;
        bestD = dd;
        best = p;
      } else if (dd < secondD) {
        secondD = dd;
        second = p;
      }
    }
    // AI-BAL-5, точка разброса №1: ТЕСТ-бот иногда идёт ко ВТОРОЙ по близости цели.
    // Строгий выбор ближайшей — главная причина, по которой два матча с разных сидов
    // разыгрывались одинаково: пути флотов совпадали с первого тика. Вторая цель берётся
    // только если она сопоставима по дальности (не дальше 2×), то есть бот остаётся
    // жадным — расходятся лишь РАВНОЦЕННЫЕ ветки, а не качество игры.
    if (
      skilled &&
      second &&
      secondD <= bestD * 2 &&
      decisionNoise(state, ai, `target:${f.id}`) < hand.wrongTarget
    ) {
      best = second;
    }
    // ═══ СИЛЬНЫЙ БОТ (AI-BAL-7): КУЛАК УМЕЕТ ДЕЛИТЬСЯ ═══
    // `fleet.split` бот не звал никогда, и следствие было структурным, а не «забыли
    // правило»: блок слияния выше сводит всё стоящее на узле в ОДИН флот (без него рой
    // одиночек кладёт симуляцию — self-play M4), а обратной операции у бота не
    // существовало. Поэтому вся тактика измерения свелась к одному кулаку: сколько бы
    // кораблей у места ни было, они ходили одной стопкой на одну цель, а вторая,
    // равноценная по дальности, ждала своей очереди.
    //
    // Делить осмысленно ровно в один момент — когда кулак ОТЧАЛИВАЕТ со своего мира и
    // целей у него две. Тогда отделённая половина остаётся стоять, исходный флот в этом
    // же тике уходит, и слить их обратно в следующем тике уже некому: слияние берёт
    // только стоящие рядом флоты, а первый из них в пути. Половина, оставшаяся дома,
    // выберет цель сама — расстояния для неё считаются заново.
    // Обе границы стоят против роя, который лечил M4: делится только КРУПНЫЙ кулак и
    // только пока флотов у места немного.
    if (
      skilled &&
      best &&
      here.owner === ai &&
      second &&
      shipCount(f) >= SPLIT_MIN &&
      ownFleets < SPLIT_FLEET_CAP
    ) {
      const take: Array<{ unit: string; count: number }> = [];
      for (const st of f.units) {
        // Флагман героя не отделяется: сущность героя привязана к ИСХОДНОМУ флоту по
        // `fleetId`, и ядро такой раскол отбивает (`E_HERO_UNIT`). Одиночный корпус
        // тоже остаётся — делить нечего.
        if (st.count < 2 || !isShipUnit(st.unit)) continue;
        if (data.units[st.unit]?.traits.includes('hero')) continue;
        take.push({ unit: st.unit, count: Math.floor(st.count / 2) });
      }
      if (take.length > 0) out.push(splitFleet(ai, f.id, take));
    }
    // ═══ КУРС ПОДВОЗА (правило владельца №4, вторая половина) ═══
    // ЗАВОЗ ПО ДОРОГЕ, а не отдельная экспедиция. Первая версия правила разворачивала
    // флот, только если он НЕ возьмёт ближайшую цель, — и замер показал, почему этого
    // мало: гружёный флот стоял на нуждающемся мире 19 раз за 1002 тика, а в пути с
    // десантом был 1574 раза. Возить было чем и что, но маршруты туда не вели.
    //
    // Теперь крюк делается, когда свой голодный мир БЛИЖЕ цели: флот завозит гарнизон
    // и следующим тиком идёт дальше — цена крюка ограничена тем, что он короче пути,
    // который флот и так собирался пройти. Второй случай прежний: цель, которую этим
    // десантом всё равно не взять, перестаёт быть целью.
    //
    // Роли «подвоз» нет, и памяти о задании тоже: оба условия выводятся из состояния
    // КАЖДЫЙ тик, а «хватит ли на цель» спрашивает ту же `confidentGroundWin`, которой
    // меряет себя сам штурм. Уверенный флот с далёким голодным миром идёт воевать.
    if (skilled && best && (f.landing ?? []).some((st) => st.count > 0)) {
      const needy = neediestWorld(here.position);
      if (needy && needy.id !== here.id) {
        const closer = d(here.position, needy.position) < d(here.position, best.position);
        if (closer || !confidentGroundWin(f.landing ?? [], best.garrison, data)) best = needy;
      }
    }
    // Взять нечего тем, что в трюме, — домой, за десантом.
    if (!best && neutralGuarded && base && f.location !== base.id && skilled)
      best = base;
    if (best) out.push(moveFleet(ai, f.id, best.id));
  }
  // War when the race is being LOST (self-play M4 finding): a passive bot loses the
  // score race to whoever expands faster — every bot-vs-bot match ended as a 2-day
  // race with zero battles, and the military (and combat factions) never played. So
  // a bot falling a planet's worth (≥ 50) behind the score leader — or merely behind
  // once no capturable neutral is left — declares war on that leader; the expansion
  // loop above then targets war territory (traversable/capturable) and contested
  // provinces swing back. A bot that IS ahead stays quiet — it wins by holding.
  // Declared only from a clean 'peace' stance: pacts/alliances are never betrayed,
  // and favour-driven war (botDiplomacyModule) keeps working on top unchanged.
  if (!defensive) {
    const scoreOf = provinceTotal;
    const mine = myProvinces;
    let leader: string | null = null;
    let leaderScore = -1;
    for (const pid of Object.keys(state.players)) {
      if (pid === ai || state.players[pid]?.status !== 'active') continue;
      const sc = scoreOf(pid);
      if (sc > leaderScore) {
        leaderScore = sc;
        leader = pid;
      }
    }
    const neutralLeft = Object.values(state.planets).some((p) => p.owner === null && capturable(p));
    // AI-BAL-5, точка разброса №2: порог войны у ТЕСТ-бота плавает в коридоре ±20%
    // (50 → 40..60 очков отставания). Фиксированные 50 означали, что война объявляется
    // в один и тот же игровой час при одинаковых стартах — а момент объявления решает,
    // кто успел развернуться. Коридор узкий: бот по-прежнему воюет, когда проигрывает
    // гонку, просто не секунда-в-секунду с самим собой из другого матча.
    const warGap = skilled ? 50 * (0.8 + 0.4 * decisionNoise(state, ai, 'war')) : 50;
    const losingRace = leaderScore - mine >= warGap || (!neutralLeft && leaderScore >= mine);
    if (leader && losingRace && getStance(state, ai, leader) === 'peace') {
      out.push(declareWar(ai, leader));
    }
  }
  // Build + launch from this AI's home base (its first developed owned world).
  const pl = state.players[ai];
  if (base && pl) {
    // Keep the lights on first: a bot whose energy/food NET flow is negative (or already
    // in arrears) raises a plant/farm before anything else — brownouts halve its economy.
    // One plant is not a cap (owner's decision 2026-10-07): the bot used to stop at the
    // first farm/reactor of the match and then lived in arrears, which no player would
    // do — so self-play reported a food/energy pressure that only the bot felt. Like a
    // player, it adds the next one on its first own world that lacks it (home first,
    // then by id — a stable order, invariant #1), but keeps ONE of a kind in the queue,
    // so the flow it reads next tick already counts the plant it ordered.
    const flow = netIncome(state, ai);
    const has = (b: string): boolean =>
      Object.values(state.planets).some(
        (p) => p.owner === ai && p.buildings.some((x) => x.type === b),
      );
    for (const [need, b] of [
      ['energy', 'power_plant'],
      ['food', 'farm'],
    ] as const) {
      if ((flow[need] ?? 0) >= 0 && !(pl.arrears ?? []).includes(need)) continue;
      const queued = state.scheduled.some((e) => {
        if (e.type !== 'construction.complete') return false;
        const q = e.payload as { kind?: string; planetId?: string; building?: string };
        return (
          q.kind === 'building' && q.building === b && state.planets[q.planetId ?? '']?.owner === ai
        );
      });
      if (queued) continue;
      const cost = data.buildings[b]?.cost ?? {};
      if (!Object.keys(cost).every((r) => (pl.resources[r] ?? 0) >= (cost[r] ?? 0) + 60)) continue;
      const site = [
        base,
        ...Object.values(state.planets)
          .filter((p) => p.owner === ai && p.id !== base.id)
          .sort((x, y) => (x.id < y.id ? -1 : x.id > y.id ? 1 : 0)),
      ].find(
        (p) =>
          !p.buildings.some((x) => x.type === b) &&
          canOrder(state, buildBuilding(ai, p.id, b)) === null,
      );
      if (site) out.push(buildBuilding(ai, site.id, b));
    }
    // Economy chain (self-play M4: mine/refinery/tax office were DEAD content for the
    // bot — it bought all its metal on the market): raise the first missing credit
    // engine at the home base (refinery → tax office), and put a metal mine on each
    // captured PRIZE world — one link at a time, only when comfortably affordable,
    // and never over the same build already queued (no reject spam).
    const pendingBuild = (planetId: string, b: string): boolean =>
      state.scheduled.some((e) => {
        if (e.type !== 'construction.complete') return false;
        const q = e.payload as { kind?: string; planetId?: string; building?: string };
        return q.kind === 'building' && q.planetId === planetId && q.building === b;
      });
    const affordable = (b: string): boolean => {
      const cost = data.buildings[b]?.cost ?? {};
      return Object.keys(cost).every((r) => (pl.resources[r] ?? 0) >= (cost[r] ?? 0) + 60);
    };
    /** Разрешает ли ЯДРО это здание здесь и сейчас, если отвлечься от денег.
     *
     *  Спрашиваем, а не переводим правило заново (RULES-1): ядро может запретить
     *  постройку по причине, о которой бот не знает — например, орбитальное ПКО до
     *  `orbital_defense_grid` (ORB-1). Звено цепочки, которое нельзя построить, надо
     *  ПРОПУСТИТЬ: критерий «не построено и не в очереди» держал бы его вечно, и до
     *  следующего звена бот не дошёл бы никогда. Деньги спрашиваются отдельно, потому
     *  что нехватка средств — это «подожди», а не «нельзя». `canOrder` мемоизирован по
     *  состоянию, так что цепочка стоит один прогон на здание за тик. */
    const buildAllowed = (planetId: string, b: string): boolean => {
      const code = canOrder(state, buildBuilding(ai, planetId, b));
      return code === null || code === 'E_INSUFFICIENT';
    };
    // ECON-7: fabricator joins the chain — microelectronics gates warships now
    // (cruiser/siege cost micro), so a bot without a fab eventually can't build a
    // fleet. Built once the credit/tax engine is up; keeps micro produced AND spent.
    // YARD-1: `spaceport` встал в цепочку вторым звеном. Он больше не приезжает даром
    // вместе с домом (дом несёт ВЕРФЬ), а без него у бота нет ни ангара, ни челноков —
    // то есть целый пласт боя выпал бы из измерения. Место в цепочке не случайное:
    // сперва чистые деньги (`refinery`), потом порт, который и торгует, и открывает
    // ангар, и только затем множитель с микроэлектроникой.
    const incomeChain = ['refinery', 'spaceport', 'tax_office', 'fabricator'] as const;
    for (const b of incomeChain) {
      if (has(b)) continue;
      if (affordable(b) && !pendingBuild(base.id, b)) out.push(buildBuilding(ai, base.id, b));
      break; // one link at a time — wait out the current one either way
    }
    // Тяжёлый стапель (армия под ветку, `heavyYard`) — звено после цепочки дохода: верфь
    // дома улучшается до верха. Идущее улучшение ядро отбивает `E_ALREADY_QUEUED`.
    const yard = base.buildings.find((x) => x.type === 'shipyard' && x.hp > 0);
    const yardDef = data.buildings['shipyard'];
    if (
      army.heavyYard &&
      yard &&
      yardDef &&
      yard.level < buildingMaxLevel(yardDef) &&
      incomeChain.every(has)
    ) {
      const cost = buildingLevel(yardDef, yard.level + 1).cost;
      const order = upgradeBuilding(ai, base.id, 'shipyard');
      if (
        Object.keys(cost).every((r) => (pl.resources[r] ?? 0) >= (cost[r] ?? 0) + 60) &&
        canOrder(state, order) === null
      )
        out.push(order);
    }
    for (const p of worldsInOrder(state, ai, 'mine', skilled)) {
      if (p.owner !== ai || p.kind !== 'planet' || p.id === base.id) continue;
      if (p.buildings.some((x) => x.type === 'mine') || pendingBuild(p.id, 'mine')) continue;
      if (!affordable('mine')) break;
      out.push(buildBuilding(ai, p.id, 'mine'));
      break; // spread the economy one world per tick
    }
    // МЁРТВЫЙ МИР — тоже экономика (AI-BAL-8). До аннигиляции ни одного `dead_world` на
    // карте прототипа не существовало, поэтому `metal_station` числилась мёртвым
    // контентом «по УСЛОВИЮ» (AI-BAL-10, случай «в»). Теперь герой их создаёт — но обычная
    // шахта на пустыре запрещена (`allowedBuildings: ['metal_station']`), а правило шахты
    // выше берёт только `kind === 'planet'`, так что без этой ветки аннигиляция оставляла
    // бы после себя ровно пустырь. Салвага и есть плата за разрушенный мир: 30 металла в
    // час против 10 базовых.
    if (skilled) {
      for (const p of worldsInOrder(state, ai, 'salvage', skilled)) {
        if (p.owner !== ai || p.kind !== 'dead_world') continue;
        if (
          p.buildings.some((x) => x.type === 'metal_station') ||
          pendingBuild(p.id, 'metal_station')
        ) {
          continue;
        }
        if (!affordable('metal_station')) break;
        out.push(buildBuilding(ai, p.id, 'metal_station'));
        break; // одна стройка за тик — как и с шахтой
      }
    }
    // Ведущее место вкладывает лишний металл в доход (решение владельца 2026-10-08:
    // «если впереди, может думать, куда ещё потратить, кроме лишней армии»). Металл к
    // 30-му дню копился до ~44k, а кредитов не было. Порядок: улучшить дома
    // переработку, налоговую и фабрикатор, потом поставить переработку на своём мире без
    // неё — она стоит один металл и даёт кредиты. Одна стройка за тик, как у шахт.
    if (!trailing && (pl.resources.metal ?? 0) >= LEADER_METAL_SURPLUS) {
      const pendingUpgrade = (planetId: string, b: string): boolean =>
        state.scheduled.some((e) => {
          if (e.type !== 'construction.complete') return false;
          const q = e.payload as { kind?: string; planetId?: string; building?: string };
          return q.kind === 'upgrade' && q.planetId === planetId && q.building === b;
        });
      const invest = (): Action | null => {
        for (const b of LEADER_UPGRADES) {
          const def = data.buildings[b];
          const inst = base.buildings.find((x) => x.type === b);
          if (!def || !inst || inst.level >= buildingMaxLevel(def)) continue;
          if (pendingUpgrade(base.id, b)) continue;
          const cost = buildingLevel(def, inst.level + 1).cost;
          if (!Object.keys(cost).every((r) => (pl.resources[r] ?? 0) >= (cost[r] ?? 0) + 60))
            continue;
          const order = upgradeBuilding(ai, base.id, b);
          if (canOrder(state, order) === null) return order;
        }
        if (!affordable('refinery')) return null;
        for (const p of worldsInOrder(state, ai, 'refinery', skilled)) {
          if (p.owner !== ai || p.kind !== 'planet' || p.id === base.id) continue;
          if (p.buildings.some((x) => x.type === 'refinery') || pendingBuild(p.id, 'refinery'))
            continue;
          const order = buildBuilding(ai, p.id, 'refinery');
          if (canOrder(state, order) === null) return order;
        }
        return null;
      };
      const order = invest();
      if (order) out.push(order);
    }
    // ТОЛЬКО СИЛЬНЫЙ (AI-BAL-1.1): технологии исследует сильный профиль, слабый — нет.
    // Слабый и есть «прежний простой соперник»; сильного игрок выбирает сам в соло
    // (AIDIFF-1), и его же берёт прогон баланса — ему нужна работающая ветка эффектов.
    //
    // Технологии: игровой бот не исследует НИ ОДНОЙ из 25 (self-play: 0 за 300 матчей),
    // поэтому вся ветка эффектов — бонусы к добыче, скорости и урону, гейты контента —
    // не участвовала в измерении баланса вовсе. Правило намеренно минимальное: бот не
    // «строит билд», он просто не оставляет исследовательские слоты пустыми.
    //
    // Что можно взять, решает САМО ЯДРО — `technologyLock` (prerequisites / day-gate /
    // conditions), а не копия правил здесь: разъедься копия с модулем, бот начал бы
    // спамить отказами, и первым признаком была бы не ошибка, а тихо изменившийся баланс.
    // Слоты считаем по базовой константе, а не по хуку `research.slots` (хук живёт внутри
    // ядра и снаружи не вызывается): с учёным слотов может быть больше, тогда бот
    // недоиспользует лишний — это честный недобор, а не отказ.
    const techState = pl.technologies;
    const activeTech = techState?.active ?? [];
    const doneTech = techState?.completed ?? [];
    if (skilled && activeTech.length < BASE_RESEARCH_SLOTS) {
      const costOf = (id: string): Record<string, number> => data.technologies[id]?.cost ?? {};
      /** Чего не хватает на узел — с запасом `ORDER_RESERVE`, как у заказов войск. Прежний
       *  запас 60 на всё держал и микроэлектронику, а её у бота 40–150, и узлы второго
       *  тира (30–80 микроэлектроники) за 14 дней не брались почти никогда. */
      const shortOf = (id: string): string[] =>
        Object.entries(costOf(id))
          .filter(([r, v]) => (pl.resources[r] ?? 0) < v + (ORDER_RESERVE[r] ?? 0))
          .map(([r]) => r);
      // Доктрина: узлы своей ветки идут вперёд цены (ранг `doctrineRanks`). Без доктрины
      // ранг у всех один, и порядок прежний — по цене.
      const ranks =
        doctrine !== undefined
          ? doctrineRanks(data.technologies, doctrine, (id) => techInMatch(state, id))
          : undefined;
      const rank = (id: string): number => ranks?.get(id) ?? 2;
      const open = Object.keys(data.technologies)
        .filter((id) => {
          const def = data.technologies[id];
          if (!def) return false;
          if (doneTech.includes(id) || activeTech.some((a) => a.technology === id)) return false;
          return technologyLock(def, state, ai, data, id) === null;
        })
        // Дешёвое и быстрое вперёд — это не «оптимальный порядок», а ДЕТЕРМИНИРОВАННЫЙ:
        // id последним ключом сортировки, чтобы порядок не зависел от перебора объекта
        // (иначе один и тот же сид разыгрался бы по-разному, инвариант #1).
        .sort((a, b) => {
          const da = data.technologies[a]!;
          const db = data.technologies[b]!;
          const sum = (c: Record<string, number> = {}): number =>
            Object.values(c).reduce((n, v) => n + v, 0);
          return (
            rank(a) - rank(b) ||
            sum(da.cost) - sum(db.cost) ||
            (da.researchTimeHours ?? 0) - (db.researchTimeHours ?? 0) ||
            (a < b ? -1 : a > b ? 1 : 0)
          );
        });
      const pick = open.find((id) => shortOf(id).length === 0);
      // КОПИЛКА ДОКТРИНЫ. Узел своей ветки, на который не хватает, бот не меняет на дешёвое
      // чужое, а копит: если доход закрывает нехватку за `DOCTRINE_SAVE_HOURS`, место ничего
      // другого не исследует, а заказы войск, тратящие недостающее, ждут (конец функции).
      // Без копилки ветка не шла: стройка съедала металл и кредиты каждый тик, и шаттловое
      // место за 14 дней не доходило до «Ударных векторов», а с ними и до тяжёлого страйкера.
      // Доход не закроет нехватку за этот срок — узел не цель, и бот берёт что по карману.
      const goal = open.find(
        (id) =>
          rank(id) < Math.min(2, pick !== undefined ? rank(pick) : 2) &&
          shortOf(id).every((r) => {
            const gap = (costOf(id)[r] ?? 0) + (ORDER_RESERVE[r] ?? 0) - (pl.resources[r] ?? 0);
            return (flow[r] ?? 0) > 0 && gap <= (flow[r] ?? 0) * DOCTRINE_SAVE_HOURS;
          }),
      );
      if (goal !== undefined) saving = new Set(shortOf(goal));
      else if (pick !== undefined) out.push(researchTech(ai, pick));
    }
    // Сколько машин рода `unit` у места. Предел спрашивают и слот линейного корабля (армия
    // под ветку), и заказ челноков ниже.
    // СЧЁТ ИДЁТ ПО АНГАРАМ И ВОЗДУХУ, а не по флотам. `shipsOwned` смотрит в состав
    // флотов и в гарнизон, а челнок с SHU-1.1 не бывает ни там, ни там — он лежит в
    // ангаре базы. Пока предел считался тем счётчиком, он не срабатывал НИКОГДА: бот
    // заказывал челнок каждый тик до упора в `E_HANGAR_FULL` и платил за это отказами
    // весь матч. SHU-6.8: в счёт входят и ангары кораблей, и эскадры в воздухе.
    // Перехватчики теперь держат патруль, а ударные эскадры перелетают к фронту, и предел
    // по одному ангару порта стал бы конвейером: эскадра ушла — порт заказывает новую.
    const shuttlesOwned = (unit: string): number => {
      const count = (stacks: readonly UnitStack[]): number =>
        stacks.reduce((k, st) => k + (st.unit === unit ? st.count : 0), 0);
      let n = 0;
      for (const p of Object.values(state.planets)) if (p.owner === ai) n += count(hangarMachines(p));
      for (const f of Object.values(state.fleets)) if (f.owner === ai) n += count(hangarMachines(f));
      for (const st of state.strikes ?? []) if (st.owner === ai) n += count(st.units);
      return n;
    };
    // Ship production is CAPPED by the fleet count (self-play M4: endless building
    // fed an ever-growing swarm — hundreds of fleets by mid-match). Enough fleets
    // out ⇒ the metal flows to economy/garrisons instead.
    if (
      ownFleets < (warFooting ? 8 : 4) &&
      (pl.resources.metal ?? 0) > 220 &&
      (pl.resources.credits ?? 0) > 120 &&
      (pl.resources.microelectronics ?? 0) >= 3 // ECON-7: warships need the hi-tech good
    ) {
      // Корпус ветки в слот линейного корабля (армия под ветку): первое, что примет ядро,
      // пока таких у места меньше, чем крейсеров, — армия выходит смешанной. Целиком своим
      // родом бот проигрывал: земля на войне строила одни танки, отдавала бой за орбиту и
      // выигрывала 49/35% партий (`selfplay 200` sp/alt). Челнок вдобавок держит потолок
      // своего рода. Иначе крейсер.
      const strikeCap = army.strikeCap ?? SHUTTLE_CAP;
      const owned = (unit: string): number => {
        if (data.units[unit]?.traits.includes('shuttle')) return shuttlesOwned(unit);
        const count = (stacks: readonly UnitStack[] = []): number =>
          stacks.reduce((k, st) => k + (st.unit === unit ? st.count : 0), 0);
        let n = 0;
        for (const f of Object.values(state.fleets))
          if (f.owner === ai) n += count(f.units) + count(f.landing);
        for (const p of Object.values(state.planets)) if (p.owner === ai) n += count(p.garrison);
        return n;
      };
      const cruisers = owned(lineUnit);
      const hull =
        [...(warFooting ? (army.warHulls ?? []) : []), ...(army.lineHulls ?? [])].find(
          (u) =>
            owned(u) < cruisers &&
            (!data.units[u]?.traits.includes('shuttle') || owned(u) < strikeCap) &&
            canOrder(state, buildUnit(ai, base.id, u, 1)) === null,
        ) ?? lineUnit;
      out.push(buildUnit(ai, base.id, hull, 1));
    }
    // Wartime posture (self-play M4: wars were free walk-in raids — the leader had no
    // garrisons, so whoever attacked always came back and won): at war the bot
    // (a) garrisons its undefended PRIZE worlds with militia — a garrisoned planet
    // can't be walk-in captured, it takes a ground assault; the 10-point provinces
    // stay an open raid zone by design; (b) adds fast scouts to the build mix
    // (capture runners for that raid zone); (c) fields more fleets — and a launched
    // fleet lifts home-built militia aboard as landing troops (fleet.launch), which
    // is exactly what lets it assault a garrisoned world back.
    if (warFooting) {
      // ГАРНИЗОН ПРИЗОВЫХ МИРОВ ПЕРЕЕХАЛ ОТСЮДА (2026-09-16). Здесь стояло правило
      // «на войне занять ПУСТЫЕ призовые миры ополчением», и оно стало вторым живым
      // ответом на тот же вопрос: пустой мир — частный случай мира ниже ПОЛА, а пол
      // (правило владельца №4) считается ниже, в блоке призовых миров, и не только на
      // войне. Две копии разошлись бы на первой же правке — эта уже расходилась капом
      // (2 против 3) и условием (пусто против недобора).
      // A landing stock at home: strike groups lift militia on sortie (above), so
      // the base keeps a few spare beyond its seeded defenders.
      const baseMilitia = base.garrison
        .filter((s) => s.unit === militiaUnit)
        .reduce((n, s) => n + s.count, 0);
      if (baseMilitia < 4 && (pl.resources.metal ?? 0) > 120 && hasFacilityFor(base, militiaUnit)) {
        out.push(buildUnit(ai, base.id, militiaUnit, 2));
      }
      if (ownFleets < 8 && (pl.resources.metal ?? 0) > 140) {
        out.push(buildUnit(ai, base.id, scoutUnit, 1));
      }
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
    if (skilled) {
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
        const hull = data.units[unit]?.cost ?? {};
        const extra = troop !== undefined ? (data.units[troop]?.cost ?? {}) : {};
        return Object.keys({ ...hull, ...extra }).every(
          (r) =>
            (pl.resources[r] ?? 0) >=
            ((hull[r] ?? 0) + (extra[r] ?? 0)) * count + (ORDER_RESERVE[r] ?? 0),
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
            const cost = buildingLevel(def, yard.level + 1).cost;
            const order = upgradeBuilding(ai, base.id, 'shipyard');
            if (
              Object.keys(cost).every(
                (r) => (pl.resources[r] ?? 0) >= (cost[r] ?? 0) + (ORDER_RESERVE[r] ?? 0),
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
      const siegeCost = data.modules[SIEGE_MODULE]?.cost ?? {};
      if (
        warFooting &&
        data.modules[SIEGE_MODULE] &&
        shipsOwned(lineUnit, SIEGE_MODULE) < (army.siegeCap ?? SIEGE_CAP) &&
        !pendingSiege(base.id) &&
        Object.keys({ ...(data.units[lineUnit]?.cost ?? {}), ...siegeCost }).every(
          (r) =>
            (pl.resources[r] ?? 0) >=
            (data.units[lineUnit]?.cost[r] ?? 0) + (siegeCost[r] ?? 0) + (ORDER_RESERVE[r] ?? 0),
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
      const repairCost = data.modules[REPAIR_MODULE]?.cost ?? {};
      if (
        warFooting &&
        data.modules[REPAIR_MODULE] &&
        shipsOwned(lineUnit, REPAIR_MODULE) < REPAIR_BAY_CAP &&
        !pendingSiege(base.id, REPAIR_MODULE) &&
        Object.keys({ ...(data.units[lineUnit]?.cost ?? {}), ...repairCost }).every(
          (r) =>
            (pl.resources[r] ?? 0) >=
            (data.units[lineUnit]?.cost[r] ?? 0) + (repairCost[r] ?? 0) + (ORDER_RESERVE[r] ?? 0),
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
          // Мину бот бьёт челноками, только когда видит её — вблизи (SM-3.6).
          (!isMineFleet(fl, data) || mineFleetVisible(state, fl, ai, data)),
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
          return machines.length > 0 && machines.every((st) => PATROL_WING.includes(st.unit as never));
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
          if (!md || installed.includes(id)) return false;
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
  // Копилка доктрины: войска, которые тратят то, на что место копит узел ветки, ждут.
  const held =
    saving.size === 0
      ? out
      : out.filter((a) => {
          if (a.type !== 'unit.build') return true;
          const p = a.payload as { unit: string; modules?: string[]; troop?: string };
          const costs = [
            data.units[p.unit]?.cost,
            ...(p.modules ?? []).map((m) => data.modules[m]?.cost),
            p.troop !== undefined ? data.units[p.troop]?.cost : undefined,
          ];
          return !costs.some((c) => [...saving].some((r) => (c?.[r] ?? 0) > 0));
        });
  // Ведущий не строит войска в долг (решение владельца 2026-10-08). Лишний металл бот
  // переводил в ополчение и разведчиков, их содержание съедало кредиты, и после 20-го дня
  // место жило в долгах треть партии (`econplaytest 30 4 3`: медиана 274 ч из ~721), а в
  // долге постройки, содержащиеся кредитами, работают вполсилы (`BROWNOUT`). Пока кредиты
  // в долге или казны не хватит на CREDIT_RUNWAY_HOURS минуса, заказы `unit.build`
  // снимаются — но только у того, кто не отстаёт: отстающему надо защищаться, и он строит
  // до последнего. Постройки и рынок правило не трогает.
  if (trailing) return held;
  const me = state.players[ai]!;
  const creditFlow = netIncome(state, ai).credits ?? 0;
  const creditsDry =
    (me.arrears ?? []).includes('credits') ||
    (creditFlow < 0 && (me.resources.credits ?? 0) < -creditFlow * CREDIT_RUNWAY_HOURS);
  return creditsDry ? held.filter((a) => a.type !== 'unit.build') : held;
}
