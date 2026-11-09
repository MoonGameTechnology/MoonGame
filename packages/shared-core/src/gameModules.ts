import type { GameModule } from './kernel/module';
import { sectorModule } from './modules/sector';
import { planetTypeModule } from './modules/planetType';
import { taxModule } from './modules/tax';
import { factionModule } from './modules/faction';
import { controlModule } from './modules/control';
import { integrationModule } from './modules/integration';
import { hungerModule } from './modules/hunger';
import { economyModule } from './modules/economy';
import { movementModule } from './modules/movement';
import { heroModule } from './modules/hero';
import { heroEffectsModule } from './modules/heroEffects';
import { orbitalModule } from './modules/orbital';
import { combatModule } from './modules/combat';
import { veteranModule } from './modules/veteran';
import { interceptModule } from './modules/intercept';
import { captureOnArrivalModule } from './modules/captureOnArrival';
import { salvageModule } from './modules/salvage';
import { constructionModule } from './modules/construction';
import { arsenalSyncModule } from './modules/arsenalSync';
import { stationModule } from './modules/station';
import { technologyModule } from './modules/technology';
import { scientistModule } from './modules/scientist';
import { stewardModule } from './modules/steward';
import { armyModule } from './modules/army';
import { pveModule } from './modules/pve';
import { fleetBroodModule } from './modules/fleetBrood';
import { swarmMemoryModule } from './modules/swarmMemory';
import { swarmNetModule } from './modules/swarmNet';
import { swarmAdaptModule } from './modules/swarmAdapt';
import { swarmJournalModule } from './modules/swarmJournal';
import { missionFactsModule } from './modules/missionFacts';
import { victoryModule } from './modules/victory';
import { fleetOpsModule } from './modules/fleetOps';
import { promotionModule } from './modules/promotion';
import { autoRallyModule } from './modules/autoRally';
import { diplomacyModule } from './modules/diplomacy';
import { espionageModule } from './modules/espionage';
import { botDiplomacyModule } from './modules/botDiplomacy';
import { marketModule } from './modules/market';
import { capitalModule } from './modules/capital';
import { standingOrdersModule } from './modules/standingOrders';
import { shuttleModule } from './modules/shuttle';
import { forcedMarchModule } from './modules/forcedMarch';
import { instantRepairModule } from './modules/instantRepair';
import { effectsModule } from './modules/effects';
import { seatClaimModule } from './modules/seatClaim';
import { visibilityModule } from './modules/visibility';
import { traderModule } from './modules/trader';
import { loadoutEffectsModule } from './modules/loadoutEffects';
import { minefieldModule } from './modules/minefield';
import { rocketMinesModule } from './modules/rocketMines';
import { missilesModule } from './modules/missiles';
import { rendezvousModule } from './modules/rendezvous';
import { extractionModule } from './modules/extraction';
import { operationModule } from './modules/operation';
import { captiveModule } from './modules/captive';
import { autoMergeModule } from './modules/autoMerge';
import { cloakFieldModule } from './modules/cloakField';

/**
 * ОДИН СПИСОК МОДУЛЕЙ ИГРЫ (SLIM-4) — состав и порядок ядра для ОБОИХ хостов: прототипа
 * (`prototype/src/protoKernel.ts`; его крутит прод-хост `prototype/netserver.ts`) и
 * канонического сервера (`packages/server/src/scenario.ts`). Порядок массива — порядок
 * выполнения (инвариант #6), он пишется в `kernel.manifest`.
 *
 * До SLIM-4 списков было два, и они расходились: модуль, который был у сервера и не был у
 * прототипа, на живом хосте не срабатывал ни разу (крепость FORT-0.2, волны Роя PVR-0.2,
 * память тумана FOG-10). За эталон взят порядок прод-хоста: на нём идут партии игроков, и
 * для них не поменялось ничего. Канонический сервер получил этот порядок и два модуля,
 * которых у него не было (`hunger`, `botDiplomacy`), и поднял `MODULE_MANIFEST_VERSION`.
 *
 * Правка состава или порядка — подъём `MODULE_MANIFEST_VERSION` (`scenario.ts`) и новый
 * закреплённый список в `moduleManifest.test.ts`; сторожа обоих хостов проверяют, что
 * они берут именно этот массив.
 */
export const GAME_MODULES: GameModule[] = [
  sectorModule,
  planetTypeModule,
  taxModule, // FND-2: civic tax on inhabited worlds (hooks economy.production, after planetType)
  factionModule, // always-on faction passives (production / fleet.speed / combat.damage) via hooks
  // BAL-19: лимит управления (вместо налога на рост `sprawl`). После `tax` обязательно —
  // половина выхода планеты вне лимита должна задеть и гражданский налог, который тот
  // кладёт в `economy.production`; с остальными вкладами (чистые множители) порядок на
  // число не влияет.
  controlModule,
  // BAL-19: освоение взятой у другой стороны планеты — 3 дня с 25% выхода до полного, без
  // юнитов. Чистый множитель выхода, как и лимит: с ним доли перемножаются.
  integrationModule,
  hungerModule, // ECON-1: food в arrears → наземный урон ×0.75 (корабли едят кредиты)
  economyModule,
  movementModule,
  heroModule, // per-player hero: redeploy, temp public lanes, planet annihilation, fleet aura
  // Сразу за героем: провайдеры `hero.effect.<type>` (recall/aura/reveal) + два хука
  // `combat.damage` (аура). Без него dispatcher `hero.ability` отвечает `E_NO_EFFECT` на всё,
  // что не встроено в heroModule (`temp_lane`/`annihilate`).
  heroEffectsModule,
  // The combat family, split along the bus seams. Order matters (invariant #6):
  // `orbital` stamps orbit on `fleet.arrived` BEFORE `combat` engages — the exact
  // sequence the old single module had internally. (The third member of that span,
  // `artillery`, is gone: standoff fire was removed whole, manifest 14.)
  orbitalModule, // the single near-orbit: stationing, AA fire, bombardment
  combatModule, // melee battles: engage / tick / assault / retreat / capture
  // PERK-3.1: надбавка за пережитые бои. Сразу за combat, и это не про порядок хуков —
  // все вклады в `combat.damage` перемножаются, так что порядок внутри группы на число
  // не влияет (см. `hookedDamage`). Место выбрано ради читателя: модуль не имеет смысла
  // в отрыве от `combatModule`, который единственный и начисляет счётчик боёв.
  veteranModule,
  interceptModule, // schedules lane-crossing meetings (resolved by combat)
  captureOnArrivalModule, // walk-in capture of undefended neutral sectors (after combat)
  // EVT-2: трофеи победителю. ПЕРЕД `construction` намеренно, и это единственное его
  // ребро по порядку: гибель крепости оба модуля слышат одним событием
  // (`station.destroyed`), и стройка сносит постройки, по которым салваж считает цену.
  salvageModule,
  constructionModule,
  arsenalSyncModule, // LARS-1: server-driver refresh of live build-catalog ownership (no gate)
  stationModule, // station.deploy: свой узел → крепость, дальше на ней строят
  technologyModule, // session research: branch/day-gated techs → effect bonuses + content unlocks
  // CONV-5: совет учёных (+слот исследований от Полимата). Сразу за technologyModule:
  // модуль вешает только хук `research.slots`, других рёбер у него нет.
  scientistModule,
  stewardModule, // «Хранитель»: место играет ИИ, пока игрок офлайн (гейт — техно ai_stewardship)
  armyModule,
  // PVE-3: волны NPC, вооружается секцией `pve` режима матча (в PvP инертен). Вместе с
  // семейством Роя — вплотную перед `victory`: `victoryModule` ЧИТАЕТ `state.pve` и судит
  // кооп-исход (`pve-failed`/`pve-cleared`), и встань `pve` после него, первая волна попала
  // бы в вердикт только следующим ходом часов.
  pveModule,
  fleetBroodModule, // paid onboard growth of ground organisms; after wave creation
  swarmMemoryModule, // PVR-4.2: наблюдения завершённых столкновений; только пишет факты
  swarmNetModule, // сеть Роя: знание течёт только по связи ретрансляторов и центров данных
  swarmAdaptModule, // PVR-4.3: проект развития модуля Роя; читает память, платит, растит
  swarmJournalModule, // PVR-4.5: что игрок ВИДЕЛ про ответы Роя; зеркало swarmMemory
  missionFactsModule, // факты для задач забега: удержание, потери, эвакуация
  victoryModule, // terminal match state (domination / elimination / score / timeout)
  fleetOpsModule, // fleet.launch/merge/split/engage: garrison → mobile fleet (CONV-8)
  // PERK-3.2: бросок промоушена. СТРОГО ПЕРЕД `autoRally` — оба слушают `unit.built`,
  // и авто-сбор уносит свежие корабли из гарнизона во флот; отметить надо до переезда.
  promotionModule,
  autoRallyModule, // CONV-10: построенный корабль сам уходит на орбиту в RALLY-флот (BF-29)
  diplomacyModule, // declarations + consent offers + the `diplomacy` capability combat consults
  espionageModule, // SPY-1/2: espionage.spy → окна краденого intel + контрразведка
  botDiplomacyModule, // bots: friendly-by-default favour meter → embargo/war only when provoked
  marketModule, // session resource market: two-sided order book (sell/buy lots), embargo-gated
  capitalModule, // capital.designate: re-point the hero respawn anchor
  standingOrdersModule, // order.auto/order.retreat/order.chain: standing-order intent storage
  shuttleModule, // SQ: free-space movement for shuttles (strike/return off the lane graph)
  forcedMarchModule, // BOOST-1 форс-марш: +50% скорости за 5% max-HP износа в час хода
  instantRepairModule, // fleet.instantRepair: paid-in-credits hull top-up, anywhere
  effectsModule, // EFX-1: интерпретатор `data.events` (trigger→effect); инертен, пока events пуст
  seatClaimModule, // ENTRY-3: заявка на место (дом + совет учёных) действием, а не мутацией
  // мимо редьюсера — иначе выбор не попадает в лог и реплей воспроизводит партию иначе.
  // В КОНЕЦ намеренно: модуль не вешает ни хуков, ни подписок на чужие события, поэтому
  // относительный порядок всех остальных остаётся нетронутым (инвариант #6).
  //
  // FOG-10. Память тумана (вариант B): пишет `state.fog` — последний известный снимок
  // каждого опознанного мира, а `visibleState` показывает по нему серые «последние
  // известные» миры. Тоже в КОНЕЦ и по той же причине: подписки у него только на СВОИ
  // поводы (`time.advanced`, `planet.captured`, `fleet.arrived`), хуков нет.
  visibilityModule,
  // Торговец экспедиции («живой курс», решение владельца 2026-09-26): оживает только в
  // режиме с разделом `trader`. В КОНЕЦ: ни хуков, ни подписок — только свои действия.
  traderModule,
  // Фаза 3 модулей кораблей (`ship-modules-roadmap.md`). В КОНЕЦ, чтобы не сдвинуть чужой
  // порядок. `loadoutEffects` вешает только хуки со сложением (`salvage.share`,
  // `combat.retreatToll`), и место в конвейере на число не влияет. `minefield` слушает
  // `fleet.arrived`/`fleet.transit` ПОСЛЕ combat: бой на узле завязывается как прежде, а
  // мины бьют входящий флот следом.
  loadoutEffectsModule,
  minefieldModule,
  rocketMinesModule, // isolated road-weapon timers; preserve all existing module order
  // Сценарный союзник главы IV (PVR-7.2): по `fleet.arrived` в месте встречи ставит факт
  // контакта и стойку `alliance`. В КОНЕЦ: хуков нет, на прибытие отвечает последним, так
  // что бой, захват и мины на узле завязываются как прежде.
  rendezvousModule,
  // Накопитель архива главы IV (PVR-7.3): после союзника — слушает его `ally.contact`;
  // свои поводы (`time.advanced`, прибытие, слияние, гибель флота), хуков нет.
  extractionModule,
  // Контракт операции главы VI (PVR-8.3): следит за главными соединениями Роя через
  // слияние и деление, судит три результата и шлёт `operation.completed`/`operation.lost`.
  // Хуков нет. Вплотную перед автослиянием: слияние на прибытии он слышит событием
  // `fleet.merged`.
  operationModule,
  // Пленный главы V (PVR-9.5): своё действие `captive.load` и свои поводы (захват и гибель
  // укрытия, слияние, гибель и прибытие носителя), хуков нет. Перед автослиянием, как и
  // контракт: прибытие носителя в зону он слышит до слияния, а само слияние — событием.
  captiveModule,
  // Маскировочное поле (SM-4.3): только отмечает срыв поля по бою, обстрелу и вылету
  // шаттлов. Хуков нет, свои поводы; перед автослиянием, как и прочие поздние слушатели.
  cloakFieldModule,
  // Ракеты из ангара (missiles-roadmap, 2026-11-09): только своё действие `missile.launch`,
  // ни хуков, ни подписок; полёт и попадание ведёт `rocketMines`. Перед автослиянием, как
  // и прочие поздние.
  missilesModule,
  // Автослияние на прибытии (заказ владельца 2026-10-03): долетевший флот вливается в свой,
  // стоящий в узле. В САМЫЙ КОНЕЦ: прибытие сначала слышат все (бой, захват, мины, союзник,
  // архив), и только потом флот исчезает в стоявшем.
  autoMergeModule,
];
