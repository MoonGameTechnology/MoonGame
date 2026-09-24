import { readFileSync, readdirSync } from 'node:fs';
import {
  type Action,
  armyModule,
  arsenalSyncModule,
  autoRallyModule,
  salvageModule,
  captureOnArrivalModule,

  combatModule,
  constructionModule,
  createInitialState,
  createKernel,
  diplomacyModule,
  capitalModule,
  economyModule,
  effectsModule,
  espionageModule,
  factionModule,
  fleetOpsModule,
  fleetRepairModule,
  forcedMarchModule,
  hashGameDataBundle,
  heroModule,
  heroEffectsModule,
  shuttleModule,
  instantRepairModule,
  interceptModule,
  marketModule,
  movementModule,
  loadGameData,
  parseMatchMap,
  orbitalModule,
  planetTypeModule,
  fleetBroodModule,
  pveModule,
  swarmMemoryModule,
  swarmNetModule,
  swarmAdaptModule,
  swarmJournalModule,
  missionFactsModule,
  scientistModule,
  sectorModule,
  standingOrdersModule,
  stationModule,
  stewardModule,
  seatClaimModule,
  taxModule,
  technologyModule,
  promotionModule,
  veteranModule,
  victoryModule,
  visibilityModule,
  type Fleet,
  type GameData,
  type GameModule,
  type GameState,
  type Hero,
  type MatchConfig,
  type MatchMap,
  type Planet,
  type Player,
  buildingLevel,
} from '@void/shared-core';
import type { ActionGate } from '@void/action-layer';
import { MatchRoom, type ActionReceipt, type RoomObservation } from './matchRoom';
import type { ArsenalStore, MatchSnapshot, StoredReceipt } from './store';
import { validateStarterArsenal, type StarterArsenalTemplate } from './arsenal';
import { validateDropTables, type DropTables } from './dropRoller';

/**
 * A runnable dev match on the *real* simulation core — the smallest faithful
 * scenario two players can connect to and act in (used by `main.ts` and the
 * end-to-end test). It is not a balanced map; it exists to exercise the wire:
 * connect → authoritative `applyAction` → delta broadcast to every peer.
 */

/** The shipped game-content bundle, composed + validated by the shared `loadGameData`
 *  (CP0.3 — one composer for server/tests/client); we only inject the Node file reader. */
export function loadShippedData(): GameData {
  return loadGameData((name) =>
    JSON.parse(readFileSync(new URL(`../../../data/${name}`, import.meta.url), 'utf8')),
  );
}

/** The shipped starter-arsenal templates (ARS-2), validated against the shipped
 *  catalogs — a template naming content that does not ship fails the boot
 *  (fail-secure; the set itself is data — balancing it is a JSON edit). */
export function loadStarterArsenal(data: GameData): StarterArsenalTemplate[] {
  const templates = JSON.parse(
    readFileSync(new URL('../../../data/starterArsenal.json', import.meta.url), 'utf8'),
  ) as StarterArsenalTemplate[];
  const issues = validateStarterArsenal(templates, data);
  if (issues.length > 0) throw new Error(`E_INVALID_STARTER_ARSENAL: ${issues.join('; ')}`);
  return templates;
}

/** The shipped drop tables (ARS-4), validated against the shipped catalogs at boot —
 *  a pool line naming content that does not ship, or a malformed chance/weight,
 *  refuses to start (fail-secure; balancing the loop is a JSON edit). */
export function loadDropTables(data: GameData): DropTables {
  const tables = JSON.parse(
    readFileSync(new URL('../../../data/dropTables.json', import.meta.url), 'utf8'),
  ) as DropTables;
  const issues = validateDropTables(tables, data);
  if (issues.length > 0) throw new Error(`E_INVALID_DROP_TABLES: ${issues.join('; ')}`);
  return tables;
}

/** The AvA-eligible map pool (AVA-5/7): every validated map in `data/maps` tagged
 *  `avaEligible`, the candidate set the orchestrator picks from by requested shape. */
export function loadAvaMaps(): MatchMap[] {
  const dir = new URL('../../../data/maps/', import.meta.url);
  return readdirSync(dir)
    .filter((name) => name.endsWith('.json'))
    .sort()
    .map((name) => parseMatchMap(JSON.parse(readFileSync(new URL(name, dir), 'utf8'))))
    .filter((map) => map.avaEligible);
}

/** Full base-module manifest, in a fixed order (invariant #6: execution order =
 *  array order, recorded in the kernel manifest and versioned per match). */
export const DEV_MODULES: GameModule[] = [
  sectorModule,
  planetTypeModule,
  taxModule, // FND-2: civic tax on inhabited worlds (hooks economy.production, after planetType)
  economyModule,
  movementModule,
  heroModule, // per-player hero: redeploy, temp public lanes, planet annihilation
  // Сразу за героем, как в прототипе: провайдеры `hero.effect.<type>` (recall/aura/reveal)
  // + два хука `combat.damage` (аура). Без него dispatcher `hero.ability` отвечает
  // `E_NO_EFFECT` на всё, что не встроено в heroModule (`temp_lane`/`annihilate`).
  heroEffectsModule,
  diplomacyModule, // declarations + consent offers + the `diplomacy` capability combat consults
  espionageModule, // SPY-1/2: espionage.spy → окна краденого intel + контрразведка
  // The combat family, split along the bus seams. Order matters (invariant #6):
  // `orbital` stamps orbit on `fleet.arrived` BEFORE `combat` engages — the exact
  // sequence the old single module had internally. (The third member of that span,
  // `artillery`, is gone: standoff fire was removed whole, see manifest 14 below.)
  orbitalModule, // the single near-orbit: stationing, AA fire, bombardment
  combatModule, // melee battles: engage / tick / assault / retreat / capture
  // PERK-3.1: надбавка за пережитые бои. Сразу за combat и это не про порядок хуков —
  // все вклады в `combat.damage` перемножаются, так что порядок внутри группы на число
  // не влияет (см. `hookedDamage`). Место выбрано ради читателя: модуль не имеет смысла
  // в отрыве от `combatModule`, который единственный и начисляет счётчик боёв.
  veteranModule,
  interceptModule, // schedules lane-crossing meetings (resolved by combat)
  captureOnArrivalModule, // walk-in capture of undefended neutral sectors (after combat)
  // EVT-2: трофеи победителю. ПЕРЕД `construction` намеренно и это единственное его
  // ребро по порядку — оба слышат `station.destroyed`, и стройка сносит постройки,
  // по которым салваж считает цену погибшей крепости. Место зеркалит прототип.
  salvageModule,
  constructionModule,
  arsenalSyncModule, // LARS-1: server-driver refresh of live build-catalog ownership (bypasses gate)
  stationModule, // deploy void stations on empty nodes (then build radar/fort there)
  technologyModule,
  scientistModule, // per-player research leader: +slot via research.slots + has_scientist gates
  stewardModule, // «Хранитель»: место играет серверный ИИ, пока игрок офлайн (гейт — техно ai_stewardship)
  factionModule, // always-on faction passives (production / speed / combat) via hooks
  marketModule, // session resource bourse: list / buy (15% burn) / cancel
  armyModule,
  fleetOpsModule, // fleet.launch/merge/split: garrison → mobile fleet, the missing link
  // PERK-3.2: бросок промоушена. СТРОГО ПЕРЕД `autoRally` — оба слушают `unit.built`,
  // и авто-сбор уносит свежие корабли из гарнизона во флот; отметить надо до переезда.
  promotionModule,
  autoRallyModule, // CONV-10: построенный корабль сам уходит на орбиту в RALLY-флот (BF-29)
  shuttleModule, // SQ: free-space movement for shuttles (strike/return off the lane graph)
  capitalModule, // capital.designate: re-point the hero respawn anchor
  standingOrdersModule, // order.auto/order.scramble/order.chain: standing-order intent storage
  instantRepairModule, // fleet.instantRepair: paid-in-credits hull top-up, anywhere
  fleetRepairModule, // fleet.repair: paid-in-metal hull top-up, at an owned dock
  forcedMarchModule, // fleet.forcemarch: +50% speed for hull wear while in transit
  pveModule, // PVE-3: NPC wave assault, armed by the mode's `pve` section (inert in PvP)
  fleetBroodModule, // paid onboard growth of ground organisms; after wave creation
  swarmMemoryModule, // PVR-4.2: наблюдения завершённых столкновений; только пишет факты
  swarmNetModule, // сеть Роя: знание течёт только по связи ретрансляторов и центров данных
  swarmAdaptModule, // PVR-4.3: проект развития модуля Роя; читает память, платит, растит
  swarmJournalModule, // PVR-4.5: что игрок ВИДЕЛ про ответы Роя; зеркало swarmMemory
  missionFactsModule, // факты для задач забега: удержание, потери, эвакуация
  victoryModule,
  visibilityModule, // fog-of-war memory (variant B): records last-seen worlds
  // H4's `divisionModule` used to sit here, at the END. It is GONE (H4-REVERT): the
  // game is back to individual ground units — `armyModule` moves `UnitStack`s between
  // a planet's garrison and a fleet's hold, `combatModule` resolves the landing. That
  // path never went away; divisions were a PARALLEL ground system layered beside it,
  // and the seam was documented as such in `gameState.ts`. Removing the layer is the
  // whole change — no mechanic is being rewritten.
  effectsModule, // EFX-1: интерпретатор `data.events` (trigger→effect); инертен, пока events пуст
  seatClaimModule, // ENTRY-3: заявка на место (дом + совет учёных) действием, а не мутацией
  // мимо редьюсера — иначе выбор не попадает в лог и реплей воспроизводит партию иначе.
  // В КОНЕЦ намеренно: модуль не вешает ни хуков, ни подписок на чужие события, поэтому
  // относительный порядок всех остальных остаётся нетронутым (инвариант #6).
];

/** Bumped whenever `DEV_MODULES`' membership or order changes (invariant #6: module
 *  execution order is part of the determinism contract). Stamped into every fresh
 *  match's `version.manifest` and checked back on load (`serverWiring.ts`) — a match
 *  created under an older manifest must not silently resume on a different module
 *  graph (same fail-secure posture as `dataHash`, MP-4). Bump this alongside any
 *  `DEV_MODULES` edit.
 *
 *  Bump it ALSO when a module changes the SHAPE it persists, even though membership
 *  and order are untouched: the guard exists so a match cannot resume on rules that
 *  differ from the ones it started with, and a reducer that now reads `owner` where
 *  the saved order says `seller` is exactly that (CONV-9). Refusing the load is the
 *  cheap, honest outcome; silently misreading the book is not. */
export const MODULE_MANIFEST_VERSION = '35'; // Сеть Роя (`docs/swarm-behavior.md`): добавлен
// swarmNetModule — знание Роя течёт только по связи ретрансляторов и центров данных. Изменилось
// ЧЛЕНСТВО графа, и порядок значим: сеть стоит между памятью (она рождает наблюдение) и
// адаптацией (она читает знание части). `swarmAdapt` 2.0.0 — проекты по одному на часть сети
// (`state.swarmAdapts`), `swarmMemory` 1.1.0 называет свидетеля, `pve` 1.2.0 несёт `waveFixed`.
// export const MODULE_MANIFEST_VERSION = '34'; // AUD-20: адаптация Роя ожила. Членство и
// порядок не тронуты; сменились ПРАВИЛА `swarmAdapt` 1.1.0 и форма состояния: готовый
// проект пишется в рецепт (`state.swarmRecipes`), покров вырастает на матках, где его не
// было, волна рождается по рецепту, а проект едет вместе с органом, влитым в другой флот.
// Партия на 33 доросла бы проект по старому правилу — уровень только на стеках с модулем.
// export const MODULE_MANIFEST_VERSION = '33'; // Задачи забега владельца 2026-09-24:
// добавлен missionFactsModule (память фактов: удержание провинций, потерянные миры,
// доставленные беженцы) и `capture-on-arrival` 0.2.0 передаёт прежнего владельца. Изменилось
// ЧЛЕНСТВО графа и форма состояния (`state.missionFacts`): партия на 32 не несёт фактов, и
// задача «держать маяк подряд» считала бы серию с начала матча, а не с захвата.
// export const MODULE_MANIFEST_VERSION = '32'; // PERK-3.2: добавлен promotionModule —
// случайный промоушен. Изменилось ЧЛЕНСТВО графа, и порядок значим: модуль стоит ПЕРЕД
// `autoRally`, потому что оба слушают `unit.built`, а авто-сбор уносит свежие корабли из
// гарнизона во флот. Партия, поднятая под графом с лишним модулем, молча получила бы
// другие боевые числа и другой поток RNG посреди игры.
// export const MODULE_MANIFEST_VERSION = '31'; // PERK-1.2: массовые перки — в параллельную
// корзину. Состав и порядок модулей те же; сменились ПРАВИЛА УРОНА: техи, пассив фракции и
// аура героя больше не перемножаются друг с другом, а складываются очками. У лидера с полным
// древом это ×2.10 → ×1.77. Подняв старую партию под новым кодом, мы молча сменили бы ей
// боевую математику посреди игры — тот же случай, что CORE-DMG-3 ниже.
// export const MODULE_MANIFEST_VERSION = '30'; // PERK-3.1: добавлен veteranModule —
// надбавка за пережитые бои. Тут изменилось ЧЛЕНСТВО графа, а не только правила, так что
// бамп обязателен по самому правилу выше. Номер новый, а не повторно 29: 29 уже лежит в
// `main`, партии на нём создаются, и поднять такую партию под графом с лишним модулем
// значило бы молча сменить ей боевые числа посреди игры. Отказ загрузки стоит перезапуска
// дев-матча, тихая подмена правил — доверия к реплею.
// export const MODULE_MANIFEST_VERSION = '29'; // CORE-DMG-3: ауры и пассивы героя — на все каналы огня.
// Состав и порядок модулей те же. Бамп — потому что сменились ПРАВИЛА УРОНА: бонусы героя,
// которые до сих пор действовали только в ближнем бою, теперь доходят до обстрела с
// орбиты, корабельного ПВО, удара челноков и ответки. Поднятая под новым кодом старая
// партия молча получила бы другой урон посреди игры — ровно то, от чего бамп и стережёт.
// export const MODULE_MANIFEST_VERSION = '28'; // ROADS-2/3: флоты летают по дорогам, развилка — место встречи.
// Состав и порядок модулей те же. Бамп — потому что партия, СОЗДАННАЯ после ROADS-1, уже
// несёт сеть дорог в `Planet.roads`, а летала по прямым: подняв её под новым кодом, мы
// молча сменили бы ей правила движения, захвата и боя посреди игры. Партии без сети дорог
// (собранные до ROADS-1) и так летают по прямым — откат по инварианту 3, — но ROADS-3
// меняет правила и им: бой на дороге больше не втягивает стоящих у мира. Оба кирпича едут
// под одним номером — 28 ещё не выпущен.
// export const MODULE_MANIFEST_VERSION = '27'; // Added salvage (EVT-2): трофеи победителю боя.
// export const MODULE_MANIFEST_VERSION = '26'; // Added swarmJournal: что игрок видел про Рой.
// export const MODULE_MANIFEST_VERSION = '25'; // Added swarmAdapt: Рой растит уровень модуля.
// export const MODULE_MANIFEST_VERSION = '24'; // Added swarmMemory: Рой копит наблюдения боёв.
// export const MODULE_MANIFEST_VERSION = '23'; // Added fleetBrood: paid onboard ground growth.
// Previous manifest 22: // PVR-1.4: у `state.pve` появился долг по усилениям.
// Форма состояния изменилась ДОБАВЛЕНИЕМ: у `UnitStack` два новых необязательных поля —
// `damageDealt` и `battles` (оба «на юнит»). Старый матч читается без ошибки: полей нет,
// значит ветеранов нет. Бампаю всё равно, и вот почему это не перестраховка. Счётчики
// растут ТОЛЬКО в бою, а выплата за них (VET-4) считается по состоянию на конец матча:
// матч, поднятый с манифеста 20, вошёл бы в неё с нулевой заслугой у всех, кто уже
// отвоевал свои бои под старыми правилами. Игрок берёг бы ветеранов, которых механика
// не считает ветеранами. Отказ загрузки честнее, чем молча обнулённая заслуга.
//
// Бампается ОДИН раз на всю цепочку медалей: VET-3/4/5 читают эти же два поля и своей
// формы не добавляют. (До 21:)
// export const MODULE_MANIFEST_VERSION = '20'; // MSB-4: у каждого штурмующего СВОЙ берег.
// Форма состояния изменилась дважды: `planet.beachhead` (одно поле) стал списком
// `planet.beachheads`, а ссылка стороны `{kind:'beachhead'}` получила обязательное поле
// `owner`. Матч на манифесте 19 несёт плацдарм СТАРОЙ формы: новый граф его не увидит
// вовсе (читается другое имя), то есть идущий штурм молча исчезнет с земли, а ссылка без
// владельца не найдёт войск и сторона окажется пустой. Отказ загрузки честнее. (До 20:)
// export const MODULE_MANIFEST_VERSION = '19'; // MSB-3: бой ВТЯГИВАЕТ стоящих рядом.
// Форма состояния НЕ менялась — и это тот случай, когда бампать всё равно надо. Правило
// изменилось так, что идущий матч разницу УВИДИТ: флот, стоящий на узле с чужим боем,
// раньше оставался зрителем сколько угодно долго, а теперь втягивается в бой — и это
// решение владельца (2026-09-11), а не починка. Матч, сохранённый на манифесте 18, мог
// встать на паузу ровно в такой расстановке: игрок оставил флот рядом с чужой дракой
// намеренно, по правилам, которые тогда действовали. Поднять его на новом графе значит
// отнять сделанный ход задним числом. Отказ загрузки честнее.
//
// Соседнее следствие того же кирпича, тоже видимое матчу: закрытие боя теперь отпускает
// ВСЕ стороны, а не пару. Матч на 18 мог сохраниться с флотом, у которого `battleId`
// указывает на уже удалённый бой (та самая утечка): новый граф такой флот освободит,
// старый — нет. (До 19:)
// export const MODULE_MANIFEST_VERSION = '18'; // SHU-4.4: удар ДОГОНЯЕТ движущуюся цель.
// Форма состояния изменилась: у `ShuttleStrike` появился живой след погони (`at` —
// точка последнего пересчёта), а `to` из снимка, снятого на вылете, стал НЫНЕШНИМ
// прицелом; вылет по флоту больше не назначает себе прибытие, он ведётся собственным
// событием `shuttle.chase`. Матч на манифесте 17 несёт вылеты старой формы: у них нет
// ни следа, ни назначенного пересчёта — новый граф не довёл бы такой удар ни до цели,
// ни домой, а старый прочитал бы живой прицел как точку удара и ударил бы по пустоте.
// Отказ загрузки честнее. (До 18:)
// export const MODULE_MANIFEST_VERSION = '17'; // Две смены формы сразу: MSB-1 + SHU-2.2.
// ПОЧЕМУ 17, А НЕ 16: версию подняли ДВА кирпича независимо — MSB-1 (бой стал списком
// сторон) в `main` и SHU-2.2 (дежурство армится на БАЗУ) здесь, оба до 16. Слитая ветка
// несёт ОБЕ смены формы, поэтому число одно и оно следующее: две разные формы под одним
// номером — ровно то, от чего страж манифеста и защищает.
//
// MSB-1: у `Battle` больше нет полей `attacker`/`defender` — есть `sides: BattleSide[]` в
// порядке вступления, и каждая сторона несёт свою `role` ('attacker' | 'defender'), от
// которой зависит, бьёт она `attack` или отвечает `defense`.
//
// SHU-2.2: дежурный вылет (CC-4) армится не на ФЛОТ, а на БАЗУ — в состоянии
// `patrols: Record<baseId, {kind}>` вместо `PatrolEntry`, у флота исчезли мёртвые
// `freePosition`/`freeMovement`/`homeBase`, а `wingSorties` снят целиком.
//
// Матч на манифесте 15 несёт бои старой формы и старые дежурства: новый читатель увидел
// бы у них `sides: undefined` и уронил бы первый же такт. Отказ загрузки честнее. (До 17:)
// export const MODULE_MANIFEST_VERSION = '16'; // (номер пропущен — см. выше)
// export const MODULE_MANIFEST_VERSION = '15'; // SHU-4.2: ангар — список ЭСКАДР.
// Форма состояния изменилась: `planet.hangar`/`fleet.hangar` больше не плоские стеки, а
// список эскадр (`{id, units, cargo}`), у вылета появился `squadronId`, а в состоянии —
// счётчик `squadronSeq`. Матч на манифесте 14 несёт ангары старой формы: новый читатель
// увидел бы у них `units: undefined` и уронил бы и вылет, и подсчёт вместимости. Отказ
// загрузки честнее.
//
// ПОЧЕМУ 15, А НЕ 14: до 14 версию подняли ДВА кирпича сразу и независимо — ART-0 (снял
// артиллерию) в `main` и этот. Слитая ветка несёт ОБЕ смены формы, поэтому число одно и
// оно следующее: две разные формы под одним номером — ровно то, от чего страж манифеста
// и защищает. (До 15:)
// export const MODULE_MANIFEST_VERSION = '14'; // Артиллерия снята целиком.
// Подсистема огня с дистанции убрана по решению владельца: модуль `artillery` вышел из
// графа, действий `fleet.barrage`/`fleet.barrageMode` больше нет, у флота исчезли поля
// `barrageTarget`/`barrageMode`/`barrageProvoked`, а из словаря цепочек — шаги `barrage`
// и `strike`. Матч на манифесте 13 несёт и поля, и шаги, которых новый граф не понимает.
// (До 14:)
// export const MODULE_MANIFEST_VERSION = '13'; // MRG-1: слияние ждёт встречи в мире.
// Форма состояния изменилась: у флота появилось поле `mergeInto` — намерение слиться,
// которое созревает на прилёте. Матч на манифесте 12 несёт приказы, у которых вторую
// половину держал клиент, — то есть играет по ДРУГИМ правилам. (До 13:)
// export const MODULE_MANIFEST_VERSION = '12'; // CARGO-1: подъём десанта занимает час.
// Форма состояния изменилась: у флота появилось поле `loading` — ЗАЯВКИ на подъём
// (`{unit,count,from,startAt,doneAt}`), и `army.load` больше не переносит войска сразу,
// а планирует событие `army.load.done`. Матч, начатый на манифесте 11, несёт заказы
// старой формы (их там просто нет) и играет по правилу «погрузка мгновенна» — то есть
// по ДРУГИМ правилам. Отказ загрузки честнее. (До 12:)
// export const MODULE_MANIFEST_VERSION = '11'; // SHU-2.1: носитель — мобильный космопорт.
// Форма состояния изменилась: у вылета вместо `from: PlanetId` размеченная база
// `base: {kind,id}` (мир ИЛИ носитель), у флота появились `hangar`/`sortie`, и модуль
// `shuttle` принимает два новых действия (`shuttle.load`/`shuttle.unload`). Матч,
// начатый на манифесте 10, несёт вылеты со старым полем — новый обработчик прочитал бы
// у них базу как `undefined` и уронил бы возврат. Отказ загрузки честнее. (До 11:)
// SHU-0.1: эскадрильи → челноки — модуль
// `squadron` переименован в `shuttle` вместе с типами своих действий (`shuttle.strike` /
// `shuttle.return`). Членство и порядок графа не изменились, но ИМЕНА, которые матч
// пишет в свою историю, изменились: матч, начатый на манифесте 9, содержит действия
// `squadron.*`, для которых в графе 10 обработчика больше нет. Отказ загрузки — честный
// исход; тихо прочитать старую книгу новым словарём — нет. (До 9: CORE-PARITY —
// heroEffects/steward/espionage/effects внесены в граф.)

export interface DevMatchOptions {
  /** Match/room id (default `'dev'`). Distinct ids let a registry hold many matches. */
  id?: string;
  /** Server clock. Defaults (in `MatchRoom`) to wall time; pinned in tests. */
  now?: () => number;
  /** World time the scenario starts at. Match it to the first `now` so the
   *  opening `advanceTo` is a no-op rather than a jump across epoch zero. */
  time?: number;
  /** Player ids to seat (default `['green', 'red']`). Each gets a homeworld and
   *  one idle fleet, all joined through a neutral `nexus` — lets soak/load tests
   *  seat N players against one room. */
  players?: string[];
  /** Ruleset for this match (time scale + victory conditions). Defaults in `MatchRoom`
   *  to `{ timeScale: 1 }`; the match browser shows it as the match's "rules". */
  config?: MatchConfig;
  /** Map identity stamped on the seeded state (`GameState.mapId`). The dev scenario
   *  builds its own nexus layout regardless — this only names it, so a test can seat
   *  two matches on distinguishable maps the way the hosts do. Absent ⇒ unnamed. */
  mapId?: string;
  /** Observation stream (persistence / metrics wiring — see `main.ts` F8). */
  observe?: (event: RoomObservation) => void;
  /** Deterministic-replay recorder (see `MatchRoom.record`, RPL-2). */
  record?: (step: { at: number; action?: Action }) => void;
  /** Resume from a durable snapshot instead of seeding a fresh match: the passed
   *  state replaces the freshly-seeded one (the seed still runs, cheaply, and is
   *  discarded). The clock keeps running from `state.time`. */
  initialState?: GameState;
  /** Rehydrate idempotency receipts on resume (see `MatchRoom.initialReceipts`),
   *  so an action deduped before a restart stays deduped after it. */
  initialReceipts?: ActionReceipt[];
  /** Resume the action counter from a persisted snapshot (see `MatchRoom.initialSeq`). */
  initialSeq?: number;
  /** Strict commit-before-broadcast durable write (see `MatchRoom.persist`). */
  persist?: (snapshot: MatchSnapshot, receipt: StoredReceipt) => Promise<void>;
  /** Opt-in `@void/action-layer` front-door (see `MatchRoom.gate`). */
  gate?: ActionGate;
  /** Per-player action rate limit (see `MatchRoom.actionRateMax` / `actionRateWindowMs`);
   *  pinned in tests to exercise throttling deterministically. */
  actionRateMax?: number;
  actionRateWindowMs?: number;
  /** Player-action deny-list (see `MatchRoom.denyPlayerActions`) — e.g. an AvA room
   *  refuses `diplomacy.declare` because the orchestrator owns the stances (AVA-8). */
  denyPlayerActions?: (type: string) => string | null | undefined;
  /** LARS-1 live ownership read (see `MatchRoom.arsenalStore`). */
  arsenalStore?: ArsenalStore;
}

function player(id: string, name: string, faction: string): Player {
  return { id, name, faction, status: 'active', resources: { credits: 300, metal: 300 } };
}

function planet(
  id: string,
  owner: string | null,
  x: number,
  y: number,
  links: string[],
  planetType: string,
  kind = 'planet', // every node is a province; planets are one province type among many
): Planet {
  return {
    id,
    owner,
    position: { x, y },
    links,
    terrain: 'empty_space',
    planetType,
    kind,
    resources: {},
    buildings: [],
    garrison: [],
    traits: [],
  };
}

function fleet(id: string, owner: string, location: string, units: Array<[string, number]>): Fleet {
  return {
    id,
    owner,
    location,
    movement: null,
    units: units.map(([unit, count]) => ({ unit, count })),
    // freshly placed → not yet in orbit (a single orbit; entered via fleet.orbit / arrival)
    traits: [],
  };
}

const DEV_FACTIONS = ['vanguard', 'swarm'];

/** N homeworlds joined through a neutral junction, one idle fleet each (default
 *  two players: green/red). Homeworlds are spread evenly around the nexus. */
export function createDevMatch(data: GameData, options: DevMatchOptions = {}): MatchRoom {
  const ids = options.players ?? ['green', 'red'];
  const base = createInitialState({
    seed: 'dev-match',
    version: { data: data.version, manifest: MODULE_MANIFEST_VERSION, dataHash: hashGameDataBundle(data) },
    time: options.time ?? 0,
  });
  const players: Record<string, Player> = {};
  const planets: Record<string, Planet> = {
    nexus: planet(
      'nexus',
      null,
      0,
      0,
      ids.map((id) => `home_${id}`),
      'barren',
    ),
  };
  const fleets: Record<string, Fleet> = {};
  const heroes: Record<string, Hero> = {};
  ids.forEach((id, i) => {
    // `|| 0` normalizes -0 (Math.round of a tiny negative, e.g. cos(3π/2)) → +0:
    // GameState must be JSON-stable, and JSON has no -0, so a -0 here desyncs a
    // client's reconstruction (server in-memory -0 vs the client's JSON-parsed +0).
    const angle = (2 * Math.PI * i) / ids.length;
    const x = Math.round(Math.cos(angle) * 240) || 0;
    const y = Math.round(Math.sin(angle) * 240) || 0;
    players[id] = player(
      id,
      id.charAt(0).toUpperCase() + id.slice(1),
      DEV_FACTIONS[i % DEV_FACTIONS.length] ?? 'vanguard',
    );
    const home = planet(`home_${id}`, id, x, y, ['nexus'], 'terran');
    // A starting SHIPYARD — space-domain hulls need one standing to be laid down at
    // all (enablesShipConstruction); without it, turn-1 fleet-building would be
    // impossible in every dev/test match. The SPACEPORT is deliberately NOT here: it
    // is the shuttle side of the split, and the player builds it (YARD-1).
    // HP берётся ИЗ ДАННЫХ, а не вписывается числом: с двумя ярусами верфи (YARD-2)
    // прочность первого уровня стала другой, и вписанное 30 посеяло бы дом с корпусом
    // крепче, чем у здания, которое он на самом деле несёт.
    home.buildings = [
      // Верфь родного мира — ВТОРОГО уровня (FORT-5.5). Классы корпусов запирают
      // крейсер за вторым стапелем, и на верфи первого уровня старт лишился бы основного
      // боевого корабля — то есть правка контента молча переписала бы дебют, который
      // мерили девять кирпичей BAL. Второй уровень оставляет минуту первую ровно такой,
      // какой её мерили; новым гейтом становится только ТЯЖЁЛЫЙ корпус (третий стапель).
      { type: 'shipyard', level: 2, hp: buildingLevel(data.buildings.shipyard!, 2).hp },
    ];
    planets[`home_${id}`] = home;
    fleets[`${id}_1`] = fleet(`${id}_1`, id, `home_${id}`, [
      ['cruiser', 2],
      ['scout_drone', 1],
    ]);
    const heroId = `hero:${id}`;
    heroes[heroId] = { id: heroId, owner: id, location: `home_${id}`, cooldowns: {} };
  });
  const state: GameState = options.initialState ?? {
    ...base,
    ...(options.mapId !== undefined ? { mapId: options.mapId } : {}),
    players,
    planets,
    fleets,
    heroes,
  };
  return new MatchRoom({
    id: options.id ?? 'dev',
    initialState: state,
    kernel: createKernel(DEV_MODULES),
    data,
    now: options.now,
    observe: options.observe,
    record: options.record,
    initialReceipts: options.initialReceipts,
    initialSeq: options.initialSeq,
    persist: options.persist,
    gate: options.gate,
    actionRateMax: options.actionRateMax,
    actionRateWindowMs: options.actionRateWindowMs,
    ...(options.denyPlayerActions ? { denyPlayerActions: options.denyPlayerActions } : {}),
    ...(options.config ? { config: options.config } : {}),
    ...(options.arsenalStore ? { arsenalStore: options.arsenalStore } : {}),
  });
}
