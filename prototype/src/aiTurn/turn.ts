/**
 * ХОД БОТА — общее для всех его фаз (SLIM-3). `openTurn` собирает это один раз за ход из
 * состояния мира, как раньше это делало начало одной функции `baseAiOrders` в `ai.ts`, а фазы
 * (`aiTurn/*.ts`) дописывают приказы в общий `out` в прежнем порядке. Состояние мира ход не
 * меняет: все поля ниже — чтение, кроме `out`, `saving` и `skipMove`.
 */
import {
  isOrdnanceFleet,
  isReconFleet,
  getStance,
  matchCost,
  technologiesUnlocking,
  scientistsOf,
  uncontrolledPlanets,
  isIntegrating,
  type Action,
  type Fleet,
  type GameState,
  type Planet,
  type StewardPosture,
} from '../../../packages/shared-core/src/index';
import { provinceScore } from '../../../packages/shared-core/src/state/sectorKind';
import { garrisonNeed } from '../../../decisions/garrisonPolicy';
import { canTraverse } from '../../../decisions/actions';
import { isPirateClan, pirateRaidZone } from '../../../decisions/pirateReach';
import { seatDoctrine } from '../botDoctrine';
import { controlLimitOf } from '../economy';
import { data } from '../gameData';
import { SECTOR_TYPES } from '../map';
import { stewardGuardOrders } from '../stewardGuard';
import { NO_HANDICAP, WEAK_HANDICAP, weakTurn, type Handicap } from './rules';

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
 *   челноков; перехватчиков — прежний). `missileCap` — потолок крылатых ракет: по трейту
 *   они тоже челнок, но их потолок — залп, а не звено ударных (без поля — `SHUTTLE_CAP`).
 * - `minerEveryHero` — ракетный минёр в отсеке у каждого героя, а не у одного.
 */
export interface DoctrineArmy {
  lineHulls?: readonly string[];
  warHulls?: readonly string[];
  heavyYard?: true;
  siegeCap?: number;
  strikeCap?: number;
  missileCap?: number;
  minerEveryHero?: true;
}
const DOCTRINE_ARMY: Readonly<Record<string, DoctrineArmy>> = {
  // Космос: орбитальный бой и обстрел — тяжёлые крейсеры и третий осадный.
  space: { heavyYard: true, lineHulls: ['heavy_cruiser'], siegeCap: 3 },
  // Земля: наземный бой — на войне танк вместо крейсера; носители возят войска.
  ground: { heavyYard: true, warHulls: ['tank'] },
  // Шаттлы: удары челноков — на войне ударный челнок вместо крейсера, их вдвое больше;
  // носители поднимают эскадры у фронта.
  shuttle: { heavyYard: true, warHulls: ['heavy_striker', 'bomber'], strikeCap: 6 },
  // Ракеты: урон ракетной ветки идёт минам и ракетам; на войне — крылатая ракета вместо
  // крейсера, до залпа в ангаре.
  missile: { minerEveryHero: true, warHulls: ['cruise_missile'], missileCap: 12 },
};

/** Один ход одного места: что знают о нём все фазы хода. */
export interface AiTurn {
  readonly state: GameState;
  readonly ai: string;
  /** Флоты, которые общий бот не сливает (дозорный маяка, посты сети Роя). */
  readonly pinned: ReadonlySet<string>;
  /** Приказы хода — по порядку фаз. */
  readonly out: Action[];
  readonly pad: (res: string, n: number) => number;
  readonly pirate: boolean;
  readonly raidZone: ReadonlySet<string> | null;
  readonly inReach: (p: Planet) => boolean;
  readonly swarmInhabitant: boolean;
  readonly hand: Handicap;
  readonly skilled: boolean;
  readonly lineUnit: string;
  readonly scoutUnit: string;
  readonly militiaUnit: string;
  readonly doctrine: string | undefined;
  readonly army: DoctrineArmy;
  /** Что место копит на узел своей ветки (копилка доктрины, блок исследований). */
  saving: ReadonlySet<string>;
  readonly groundRoster: readonly string[];
  readonly groundDefenders: readonly string[];
  readonly defensive: boolean;
  readonly isShipUnit: (u: string) => boolean;
  readonly capturable: (p: Planet) => boolean;
  readonly orbitalLayer: (p: Planet) => boolean;
  readonly assaultTargetFor: (fl: Fleet) => Planet | undefined;
  readonly neediestWorld: (from: { x: number; y: number }) => Planet | undefined;
  readonly d: (a: { x: number; y: number }, b: { x: number; y: number }) => number;
  readonly warFooting: boolean;
  /** Свои планеты за лимитом управления и в освоении (BAL-19): юниты на них не заказываются. */
  readonly outside: ReadonlySet<string>;
  /** Есть свои планеты за лимитом управления (BAL-19): узел, поднимающий лимит, идёт вперёд. */
  readonly beyondLimit: boolean;
  /** Свои планеты, которые другая сторона ещё осваивает (BAL-19): флот места выбирает их
   *  охотнее прочих целей (`retakeWeight`). */
  readonly claims: ReadonlySet<string>;
  readonly base: Planet | undefined;
  readonly shipCount: (f: Fleet) => number;
  readonly reconBare: (f: Fleet) => boolean;
  readonly expandFleets: Fleet[];
  readonly neutralGuarded: boolean;
  readonly provinceTotal: (who: string) => number;
  readonly myProvinces: number;
  readonly trailing: boolean;
  readonly ownFleets: number;
  /** Флоты, которым в этот ход курс не дают: они сливаются (`consolidateFleets`). */
  readonly skipMove: Set<string>;
}

/** Открыть ход места: `null` — место вне игры или слабый бот молчит в этом окне. */
export function openTurn(
  state: GameState,
  ai: string,
  posture: StewardPosture | 'expand',
  profile: AiProfile,
  pinned: ReadonlySet<string>,
): AiTurn | null {
  const out: Action[] = [];
  // Пороги бота — в ценах ПАРТИИ (резолюция владельца 2026-10-18): в основной игре всё
  // дороже, и «хватит на крейсер с запасом» значит больше металла, чем по каталогу. Правило
  // пересчёта то же, что у ядра (`matchCost`); без цен партии порог прежний.
  const pad = (res: string, n: number): number => matchCost(state, { [res]: n })[res] ?? n;
  if (!state.players[ai] || state.players[ai]!.status === 'defeated') return null; // seat not in play / eliminated
  // The defensive family: both Steward postures HOLD (no expansion, no war
  // declarations); «Активная оборона» merely adds the counterstrike/fire-watch
  // inside the guard-duty tick below.
  if (state.players[ai]!.npc === 'neutral') posture = 'active_defend';
  if (state.players[ai]!.npc === 'pirate') posture = 'expand';
  // NPC pirates replenish their own roster; ordinary and legacy seats retain theirs.
  const pirate = state.players[ai]!.faction === 'pirates';
  // Угодья клана (`decisions/pirateReach.ts`): набег только в пределах двух переходов от
  // логова. Sector Zero и прочий PvE держат свой сценарий и сюда не попадают.
  const raidZone = isPirateClan(state, ai) && !state.pve ? pirateRaidZone(state, ai) : null;
  const inReach = (p: Planet): boolean => raidZone === null || raidZone.has(p.id);
  const swarmInhabitant = state.players[ai]!.npc === 'swarm';
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
  if (turn === 'skip') return null;
  const skilled = capable && turn === 'full';
  const cruiserLocked = technologiesUnlocking(data, 'unit', 'cruiser', state).some(
    (id) => !state.players[ai]!.technologies?.completed.includes(id),
  );
  const lineUnit = pirate ? 'pirate_cruiser' : swarmInhabitant ? 'swarm_brood_mother' : cruiserLocked ? 'frigate' : 'cruiser';
  const scoutUnit = pirate ? 'pirate_skiff' : swarmInhabitant ? 'swarm_relay_small' : 'scout';
  const militiaUnit = pirate ? 'pirate_boarder' : swarmInhabitant ? 'swarm_lander' : 'militia';
  // Доктрина — ветка учёного совета места (`botDoctrine.ts`); у NPC совета нет.
  const doctrine = skilled
    ? seatDoctrine(scientistsOf(state.players[ai]), data.scientists, data.technologies)
    : undefined;
  const army: DoctrineArmy = (doctrine !== undefined ? DOCTRINE_ARMY[doctrine] : undefined) ?? {};
  /** Что место копит на узел своей ветки (копилка доктрины, блок исследований). */
  const saving: ReadonlySet<string> = new Set();
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
      .filter((p) => p.owner !== ai && capturable(p) && canTraverse(state, ai, p.owner) && inReach(p))
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
  //
  // Якорь — ПОД УПРАВЛЕНИЕМ во всех трёх ветках (BAL-19): на планете за лимитом юниты не
  // строятся, и якорь на захваченной верфи вдали от столицы снова отбивал бы каждый заказ
  // корабля. Свой мир под управлением есть всегда: за лимит выходят только планеты сверх него.
  // Взятая у другой стороны планета, пока осваивается, юнитов тоже не строит; держава из одних
  // таких планет остаётся без якоря, пока первая не освоится.
  const outside = uncontrolledPlanets(state, data, ai, state.modeId, controlLimitOf(state, ai));
  const beyondLimit = outside.size > 0;
  // Тот же проход собирает и обратную сторону освоения: свои планеты, которые другая сторона
  // ещё осваивает. Отбитая до конца освоения планета сразу возвращается целиком (`fleets.ts`).
  const claims = new Set<string>();
  for (const p of Object.values(state.planets)) {
    if (!isIntegrating(p, state.time)) continue;
    if (p.owner === ai) outside.add(p.id);
    else if (p.integration?.claim === ai) claims.add(p.id);
  }
  const ruled = (p: Planet): boolean => p.owner === ai && !outside.has(p.id);
  const base =
    Object.values(state.planets).find(
      (p) =>
        ruled(p) &&
        p.buildings.some(
          (b) => b.hp > 0 && data.buildings[b.type]?.enablesShipConstruction === true,
        ),
    ) ??
    Object.values(state.planets).find((p) => ruled(p) && p.buildings.length > 0) ??
    Object.values(state.planets).find(ruled);
  const shipCount = (f: Fleet): number =>
    f.units.reduce((n, s) => n + (isShipUnit(s.unit) ? s.count : 0), 0);
  // Флот из одних разведчиков без десанта ничего не берёт: пустой мир ядро ему не отдаёт
  // ни прилётом, ни с орбиты (`E_RECON_NO_CAPTURE`, решение владельца 2026-10-16), а
  // гарнизонный и подавно. Без этой проверки бот слал такой флот к ближайшей пустой
  // провинции и повторял отбиваемый штурм каждые два часа: 117 отказов за дуэль.
  const reconBare = (f: Fleet): boolean =>
    isReconFleet(f, data) && !(f.landing ?? []).some((st) => st.count > 0);
  const expandFleets: Fleet[] = defensive ? [] : Object.values(state.fleets);
  // Ничьи планеты держит ополчение (`NEUTRAL_PLANET_MILITIA`), и брать их надо десантом
  // даже в мирное время. Пока такая планета есть, флот грузится дома и без войны.
  const neutralGuarded = Object.values(state.planets).some(
    (p) => p.owner === null && capturable(p) && p.garrison.some((st) => st.count > 0),
  );
  // Отстаю ли я по очкам провинций от кого-то из живых соперников (охота отстающего,
  // см. `huntWeight`). Тот же счёт ниже решает объявление войны.
  // Счёт всех владельцев одним проходом по карте, в том же порядке сложения: прежде карту
  // обходили заново на каждого соперника, и на FFA-50 это было ~6 мс кадра на ×10.
  const provinceTotals = new Map<string, number>();
  for (const p of Object.values(state.planets)) {
    if (p.owner !== null)
      provinceTotals.set(p.owner, (provinceTotals.get(p.owner) ?? 0) + provinceScore(data, p));
  }
  const provinceTotal = (who: string): number => provinceTotals.get(who) ?? 0;
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
  const skipMove = new Set<string>();
  return {
    state,
    ai,
    pinned,
    out,
    pad,
    pirate,
    raidZone,
    inReach,
    swarmInhabitant,
    hand,
    skilled,
    lineUnit,
    scoutUnit,
    militiaUnit,
    doctrine,
    army,
    saving,
    groundRoster,
    groundDefenders,
    defensive,
    isShipUnit,
    capturable,
    orbitalLayer,
    assaultTargetFor,
    neediestWorld,
    d,
    warFooting,
    outside,
    beyondLimit,
    claims,
    base,
    shipCount,
    reconBare,
    expandFleets,
    neutralGuarded,
    provinceTotal,
    myProvinces,
    trailing,
    ownFleets,
    skipMove,
  };
}
