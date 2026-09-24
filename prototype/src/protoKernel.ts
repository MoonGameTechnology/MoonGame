import { mapPreset, scoreLimitFor } from './mapCatalog';
/**
 * The prototype's kernel assembly point (REFP-21) — the ordered module list, the
 * compiled kernel, the match config (`SCORE_LIMIT`), and the two pure step helpers
 * (`advance`/`order`) both hosts drive the world with. Extracted from `game.ts` as a
 * pure move: module ORDER is the determinism contract (invariant #6) — do not
 * reorder here without understanding replay invalidation. `game.ts` re-exports
 * everything for `main.ts`/`netserver.ts`/tests (until REFP-28).
 */
import {
  createKernel,
  economyModule,
  effectsModule,
  salvageModule,
  seatClaimModule,
  visibilityModule,
  movementModule,
  factionModule,
  heroModule,
  heroEffectsModule,
  combatModule,
  orbitalModule,
  interceptModule,
  captureOnArrivalModule,
  sectorModule,
  planetTypeModule,
  constructionModule,
  arsenalSyncModule,
  stationModule,
  armyModule,
  promotionModule,
  veteranModule,
  victoryModule,
  technologyModule,
  espionageModule,
  stewardModule,
  diplomacyModule,
  shuttleModule,
  forcedMarchModule,
  instantRepairModule,
  fleetRepairModule,
  taxModule,
  capitalModule,
  scientistModule,
  standingOrdersModule,
  fleetOpsModule,
  autoRallyModule,
  marketModule,
  fleetBroodModule,
  pveModule,
  swarmMemoryModule,
  swarmAdaptModule,
  swarmJournalModule,
  missionFactsModule,
  resolveMatchConfig,
  type GameModule,
  type GameState,
  type Action,
  type Context,
  type MatchConfig,
  type DomainEvent,
} from '../../packages/shared-core/src/index';
import { data } from './gameData';
import { hungerModule } from './hunger';
import { botDiplomacyModule } from './botDiplomacy';

export const MODULES: GameModule[] = [
  sectorModule,
  planetTypeModule,
  taxModule, // civic tax on inhabited worlds (hooks economy.production, after planetType)
  factionModule, // H3: чисто пассивные бонусы дома (production / fleet.speed / combat.damage)
  hungerModule, // ECON-1: food в arrears → наземный урон ×0.75 (корабли едят кредиты)
  economyModule,
  movementModule,
  heroModule, // projection hero: fleet combat aura (+5%) + death/respawn
  heroEffectsModule, // first hero.effect.<type> capability provider: recall (warp ship home)
  // The combat family (split along the bus seams). Order matters (invariant #6):
  // orbital stamps orbit on fleet.arrived BEFORE combat engages, and runs its
  orbitalModule, // the single near-orbit: stationing, AA fire, bombardment
  combatModule, // melee battles: engage / tick / assault / retreat / capture
  // PERK-3.1: надбавка за пережитые бои. Место то же, что в серверном `DEV_MODULES`, и
  // оно не про порядок хуков — все вклады в `combat.damage` перемножаются, так что
  // порядок внутри группы на число не влияет. Списков два, и разъезжались они тут уже не
  // раз (PVR-0.2/FORT-0.2/FOG-10 ниже): модуль, который есть у сервера и нет здесь, на
  // живом хосте не сработает НИ РАЗУ.
  veteranModule,
  interceptModule, // schedules lane-crossing meetings (resolved by combat)
  captureOnArrivalModule, // walk-in capture now a kernel rule (was client-side seizeSector)
  // EVT-2: трофеи победителю. Стоит ПЕРЕД `construction` намеренно и это единственное
  // его ребро по порядку: гибель крепости оба модуля слышат одним событием
  // (`station.destroyed`), и стройка сносит постройки, по которым салваж считает цену.
  salvageModule,
  constructionModule,
  arsenalSyncModule, // LARS-1: server-driver refresh of live build-catalog ownership (bypasses gate)
  // FORT-0.2: КОСМИЧЕСКАЯ КРЕПОСТЬ наконец достижима на хосте, где играют. Модуль давно
  // был и в ядре, и в серверном `DEV_MODULES`, но не здесь — то есть механика существовала
  // и при этом не могла сработать НИ РАЗУ. Место то же, что у сервера (сразу за
  // `arsenalSync`), чтобы два списка читались одинаково.
  stationModule, // station.deploy: свой узел → крепость, дальше на ней строят
  technologyModule, // session research: branch/day-gated techs → effect bonuses + content unlocks
  // CONV-5: совет учёных наконец влияет на партию, а не только на пилюлю слотов.
  // Врезка в `techTree.ts` рисовала «+1 слот» от Полимата, но модуля, который его
  // даёт, в этом ядре не было — редьюсер отказывал третьему исследованию
  // (`E_RESEARCH_SLOTS_FULL`). Сразу за technologyModule, как в `DEV_MODULES`:
  // модуль вешает только хук `research.slots`, других рёбер у него нет.
  scientistModule,
  stewardModule, // «Хранитель»: delegate the seat to the AI while you sleep (gated by the Steward tech)
  armyModule,
  // PVR-0.2: волны Роя наконец достижимы на хосте, где играют. Тот же класс, что FORT-0.2
  // и FOG-10: модуль был и в ядре, и в серверном `DEV_MODULES`, но не здесь — механика
  // существовала, была покрыта тестами и не могла сработать НИ РАЗУ. Место то же, что у
  // сервера (вплотную перед `victory`), потому что `victoryModule` ЧИТАЕТ `state.pve` и
  // судит кооп-исход (`pve-failed`/`pve-cleared`) первым — встань `pve` после него, и
  // первая волна попала бы в вердикт только следующим ходом часов.
  pveModule, // PVE-3: волны NPC, вооружается секцией `pve` режима матча (в PvP инертен)
  fleetBroodModule, // paid onboard growth of ground organisms; after wave creation
  swarmMemoryModule, // PVR-4.2: наблюдения завершённых столкновений; только пишет факты
  swarmAdaptModule, // PVR-4.3: проект развития модуля Роя; читает память, платит, растит
  swarmJournalModule, // PVR-4.5: что игрок ВИДЕЛ про ответы Роя; зеркало swarmMemory
  missionFactsModule, // факты для задач забега: удержание, потери, эвакуация
  victoryModule, // terminal match state from authoritative state (domination / elimination / score / timeout)
  fleetOpsModule, // fleet.launch/merge/split/engage — модуль ЯДРА (CONV-8)
  // PERK-3.2: бросок промоушена. СТРОГО ПЕРЕД `autoRally` — оба слушают `unit.built`,
  // и авто-сбор уносит свежие корабли из гарнизона во флот; отметить надо до переезда.
  promotionModule,
  // CONV-10: авто-сбор построенного (BF-29) переехал В ЯДРО — это последняя
  // механика, которую прототип держал один; канон её теперь тоже грузит.
  autoRallyModule,
  diplomacyModule, // CORE D2+D3 (D4): escalation/consent offers; combat reads state.diplomacy
  espionageModule, // SPY-1 core module: espionage.spy → time-boxed intel windows (state.intel)
  botDiplomacyModule, // bots: friendly-by-default favour meter → embargo/war only when provoked
  marketModule, // session resource market: two-sided order book (sell/buy lots), embargo-gated
  capitalModule, // designatable capital (hero respawn / module re-fit anchor)
  standingOrdersModule, // CC-2/CC-4 standing orders (auto-storm / дежурный вылет), server-driven
  shuttleModule, // SQ: free-space movement for shuttles (strike/return off the lane graph)
  forcedMarchModule, // BOOST-1 форс-марш: +50% скорости за 5% max-HP износа в час хода
  instantRepairModule, // платный мгновенный ремонт корпуса (кредиты как премиум-валюта)
  fleetRepairModule, // ECON-3: экспресс-ремонт корпуса за metal у своего дока
  effectsModule, // EFX-1: интерпретатор data.events (trigger→effect); инертен, пока events: {} пуст
  seatClaimModule, // ENTRY-3: заявка на место (дом + совет учёных) действием, а не мутацией
  // мимо редьюсера — иначе выбор не попадает в лог и реплей воспроизводит партию иначе.
  // В КОНЕЦ намеренно: модуль не вешает ни хуков, ни подписок на чужие события, поэтому
  // относительный порядок всех остальных остаётся нетронутым (инвариант #6).
  //
  // FOG-10. Память тумана (вариант B): пишет `state.fog` — последний известный снимок
  // каждого опознанного мира, а `visibleState` показывает по нему серые «последние
  // известные» миры. Модуль был в списке `packages/server`, но НЕ в этом, а живой хост
  // (`prototype/netserver.ts`) крутит именно этот список — значит на сервере `state.fog`
  // не писался никогда. Прототип этого не замечал, потому что держал свою память в
  // браузере (`scanMemory.ts`): пока вкладка жива, карта рисуется верно, а перезагрузил
  // страницу — вся разведка забыта, разведанные лично миры снова «?».
  // Тоже в КОНЕЦ и по той же причине: подписки у него только на СВОИ поводы
  // (`time.advanced`, `planet.captured`, `fleet.arrived`), хуков нет, чужого порядка он
  // не трогает.
  visibilityModule,
];

export const kernel = createKernel(MODULES);

// Win at 1100 of the board's ~2410 base points (30 planets×50 + 91 provinces×10). Set
// below the ~60% domination line so a decisive-but-not-total lead — a fistful of planets
// plus built-up infrastructure — can win the SCORE race first, making the score/building
// system (scoreValue) meaningful instead of vestigial vs conquest. Tunable single source
// of truth, also read by the HUD score readout.
export const SCORE_LIMIT = mapPreset().scoreLimit;

/**
 * Режим ТЕКУЩЕГО матча (PVR-1.1). Лежит здесь, а не в `GameState`, потому что
 * `matchMode.ts` формулирует это прямо: режим потребляется ОДИН раз, при рождении матча,
 * и «подменить его нечем» — у сервера тот же факт живёт приватным полем комнаты, а у
 * прототипа комната и есть этот модуль (матч на вкладку всегда один).
 *
 * `undefined` — обычная соло-партия: конфиг едет без `modeId`, и модули, вооружаемые
 * режимом (`pve`), остаются инертными ровно как до этого кирпича.
 */
let matchModeId: string | undefined;

/** Вооружить матч режимом (или снять режим, `undefined`). Незнакомый id — ОТКАЗ на месте,
 *  а не тихий откат к базовым правилам: матч, который считает себя PvE, а исполняется по
 *  базовым правилам, — это ровно та подмена правил под матчем, которую `matchMode.ts`
 *  отвергает (fail-secure, инвариант №4). Зовётся при установке матча, до первого хода
 *  часов, поэтому ниже `ctx` уже может не перепроверять. */
export function setMatchMode(modeId: string | undefined): void {
  if (modeId !== undefined && !data.modes[modeId]) throw new Error('E_UNKNOWN_MODE');
  matchModeId = modeId;
}

/** Режим, под которым идёт текущий матч (или `undefined` — обычная партия). Читают
 *  те, кому нужны ЕГО данные, а не правила: окно усиления забега берёт отсюда пул
 *  (PVR-1.4). Правила по-прежнему разворачивает `ctx` — второго дома у них нет. */
export function matchMode(): string | undefined {
  return matchModeId;
}

/**
 * Темп перемещения ТЕКУЩЕГО матча (PVR-2.3): множитель на все скорости карты. Лежит рядом
 * с режимом по той же причине — это правило, которое матч получает при рождении. Ставит
 * его ХОСТ забега, а не режим: онлайн-партия на том же `pve_waves` летает на ×1.
 */
let matchTravelSpeed = 1;

/** Задать темп перемещения матча (`1` — обычный). Зовётся при установке матча, до первого
 *  хода часов; каждая оценка пути на клиенте читает его через тот же `ctx`, что и ядро. */
export function setMatchTravelSpeed(factor: number): void {
  matchTravelSpeed = factor;
}

export function ctx(now: number, state?: Pick<GameState, 'mapId'>): Context {
  const config: MatchConfig = {
    timeScale: 1,
    victory: { scoreLimit: scoreLimitFor(state ?? {}) },
    ...(matchModeId !== undefined ? { modeId: matchModeId } : {}),
    ...(matchTravelSpeed !== 1 ? { travelSpeedFactor: matchTravelSpeed } : {}),
  };
  // Единственный дом правила «режим → правила»: пресет победы режима подстилается ПОД
  // победу матча, свою копию слоения здесь не заводим. Отказать он может только на
  // незнакомом режиме, а его отверг `setMatchMode`.
  const resolved = resolveMatchConfig(data, config);
  return { now, data, config: resolved.ok ? resolved.config : config };
}

export interface StepOut {
  state: GameState;
  events: DomainEvent[];
  error?: string;
}

/** Advance the world to `now`, collecting events. */
export function advance(state: GameState, now: number): StepOut {
  if (now <= state.time) return { state, events: [] };
  // Chain partial catch-ups (mirrors matchRoom.computeAdvance): a long-idle world
  // may exceed MAX_ADVANCE_STEPS per call; stopping short would leave due events in
  // the queue and `order()` would then hit the kernel's E_TIME_GAP guard. A chunk
  // that makes NO progress (same-instant runaway) breaks out — the frame loop
  // retries next tick rather than spinning here.
  let cur = state;
  const events: StepOut['events'] = [];
  for (let i = 0; i < 10; i++) {
    const r = kernel.advanceTo(cur, ctx(now, cur));
    if (!r.ok) return { state: cur, events, error: r.code };
    const progressed = r.state.time > cur.time;
    cur = r.state;
    events.push(...r.events);
    if (!r.partial || !progressed) break;
  }
  return { state: cur, events };
}

/** Apply a player order at the current world time (advancing first if needed). */
export function order(state: GameState, action: Action, now: number): StepOut {
  const advanced = advance(state, now);
  const r = kernel.applyAction(advanced.state, action, ctx(Math.max(now, advanced.state.time), advanced.state));
  if (!r.ok) return { state: advanced.state, events: advanced.events, error: r.code };
  return { state: r.state, events: [...advanced.events, ...r.events] };
}

/**
 * RULES-1 — «можно ли?» по правилам игры: код отказа (`E_*`) или `null`.
 *
 * Тот же вердикт, что вернул бы `order()`, но без применения — и БЕЗ второго описания
 * правил: под капотом `kernel.canApply`, то есть буквально те же обработчики модулей.
 * Спрашивают отсюда интерфейс (гасит кнопку и печатает причину) и автоматика
 * (покадровые циклы, драйверы), чтобы не издавать заведомо отвергаемый приказ.
 *
 * Спрашивается на `state.time`, а не на «сейчас»: вопрос про МИР В ЕГО ЧАСЕ. Спросить
 * на будущем `now` значило бы сперва прокрутить время (advance) — то есть изменить мир
 * ради вопроса, чего проба делать не должна. Гейты `E_TIME_*` при этом заведомо чисты.
 */
export function canOrder(state: GameState, action: Action): string | null {
  // Память ответов на ОДНО состояние. Ключ — сам объект состояния: `GameState`
  // неизменяем по инварианту №2 (редьюсер возвращает новый объект, а не правит старый),
  // поэтому «другой мир» — это всегда другая ссылка, и устареть ответ не может.
  // Без памяти проба стоила бы дорого не из-за себя, а из-за частоты: панель собирает
  // HTML каждый кадр (dirty-check сравнивает уже готовую строку), и меню стройки
  // спрашивало бы ядро семь раз в кадр — ~2 мс, 12% бюджета, за один только серый цвет.
  if (memoState !== state) {
    memoState = state;
    memo.clear();
  }
  // Разделитель — `\u0000` ЭКРАНИРОВАННЫМ, а не сырым байтом. Символ выбран верно (в
  // id, типе и JSON он не встречается, так что склейка ключа однозначна), но записанный
  // в файл как есть он делает файл БИНАРНЫМ для инструментов: `file` зовёт его `data`,
  // а `grep` молча пропускает с «binary file matches» — то есть поиск по репозиторию
  // этот файл не видит. Строка на рантайме та же самая, escape меняет только исходник.
  const key = `${action.playerId}\u0000${action.type}\u0000${JSON.stringify(action.payload)}`;
  const hit = memo.get(key);
  if (hit !== undefined) return hit;
  const verdict = kernel.canApply(state, action, ctx(state.time, state));
  memo.set(key, verdict);
  return verdict;
}
let memoState: GameState | null = null;
const memo = new Map<string, string | null>();

/**
 * RULES-3 — «прошла бы вся СВЯЗКА приказов?»: первый код отказа или `null`.
 *
 * Тот же вопрос, что `canOrder`, но про последовательность — `kernel.canApplyAll`.
 * Нужен автоматике, которая издаёт связки, а не одиночные приказы: авто-штурм — это
 * «встать на низкую орбиту → штурм», и спросить можно только про пару целиком. Про
 * один штурм ответом был бы `E_WRONG_ORBIT` (орбита ещё не выставлена), про одну
 * орбиту — «можно», после чего применилась бы половина обречённой связки.
 *
 * Без памяти: связки спрашивают драйверы (раз в тик), а не покадровый рендер, и ключ
 * по массиву действий стоил бы дороже самой пробы.
 */
export function canOrderAll(state: GameState, actions: readonly Action[]): string | null {
  return kernel.canApplyAll(state, actions, ctx(state.time, state));
}
