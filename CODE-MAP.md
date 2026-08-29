# CODE-MAP.md — карта модулей Void Dominion

> Индекс-справочник навигации по коду. Сверено из исходников (grep по `api.onAction`/
> `api.on`/`api.hook`/`api.provideCapability`/`h.emit`), не из памяти. Обновлять при
> изменении `DEV_MODULES` или добавлении/удалении модуля — см. `CLAUDE.md` «Working
> agreements» (code first, docs after). Не дизайн-док — для дизайна см.
> `docs/architecture.md`, `docs/modulesystem.md`.

## Принципы проекта (кратко — полный текст в `CLAUDE.md`)

- **Surgical changes** (`CLAUDE.md:241`) — трогай только то, что требует задача.
- **Тесты как страховка** — `pnpm run check` (lint + typecheck + test + docs-check)
  перед коммитом; TDD-цикл для новых модулей.
- **Детерминизм** — ядро = чистая функция, no `Math.random`/`Date.now` в
  `shared-core/src/**` (ESLint).
- **Модули говорят через шину** — модули не импортируют друг друга (инвариант #3);
>  события (pub/sub), хуки (value pipelines), capabilities (optional links).

---

## packages/shared-core — детерминированное ядро

`createKernel(modules)` компилирует immutable kernel. Две чистые точки входа:
- `applyAction(state, action, ctx)` — применить намерение игрока в `ctx.now`.
- `advanceTo(state, ctx)` — сдвинуть мировые часы, запустить scheduled events.

### Модули ядра (`packages/shared-core/src/modules/`)

Порядок = порядок в `DEV_MODULES` (`packages/server/src/scenario.ts:113`).
`MODULE_MANIFEST_VERSION = '9'` — bump при изменении состава/порядка (инвариант #6);
сторож — `moduleManifest.test.ts`. Каталог модулей и `DEV_MODULES` совпадают: канон
грузит ВСЕ **36** (CORE-PARITY 2026-08-26 внёс последнюю четвёрку — `heroEffects`,
`espionage`, `steward`, `effects`, — до неё они были написаны, но в графе не стояли).
Прототип (`protoKernel.ts`) собирает свой набор: 33 из этих плюс два своих
(`hunger`, `botDiplomacy`), без `pve`, `station`, `visibility` — счётчик и разбор
живут в `docs/state.md` §9, здесь их копии нет.

Звёздочка в колонке emit (`sched:`) — событие ставится в `state.scheduled` через
`h.schedule`, а не эмитится сразу.

| # | id | файл | onAction | on (события) | hook | emit · schedule |
|---|---|---|---|---|---|---|
| 1 | `sector` | `sector.ts` | — | — | `combat.damage`, `fleet.speed` | — |
| 2 | `planet-type` | `planetType.ts` | — | — | `combat.damage`, `economy.production` | — |
| 3 | `tax` | `tax.ts` | — | — | `economy.production` | — |
| 4 | `economy` | `economy.ts` | — | `time.advanced` | — | — |
| 5 | `movement` | `movement.ts` | `fleet.move`, `fleet.stop` | `fleet.arrival` | — | `fleet.arrived`, `fleet.departed`, `fleet.leg`, `fleet.parked`, `fleet.stranded`, `fleet.transit` · sched: `fleet.arrival` |
| 6 | `hero` | `hero.ts` | `hero.ability`, `hero.fit`, `hero.move`, `hero.skill.unlock`, `hero.spawn`, `planet.annihilate` | `fleet.arrived`, `fleet.destroyed`, `fleet.transit`, `hero.path.expire`, `hero.respawn`, `unit.died` | `combat.damage`, `fleet.speed` | `hero.ability.used`, `hero.died`, `hero.fitted`, `hero.moved`, `hero.path.created`, `hero.path.expired`, `hero.respawned`, `hero.skill.unlocked`, `hero.spawned`, `planet.destroyed` · sched: `hero.path.expire`, `hero.respawn` |
| 7 | `heroEffects` | `heroEffects.ts` | — | — | `combat.damage` | `hero.aura`, `hero.recalled`, `hero.revealed` |
| 8 | `diplomacy` | `diplomacy.ts` | `diplomacy.declare`, `diplomacy.mapshare` | `player.eliminated` | — | `diplomacy.changed`, `diplomacy.mapshare.changed`, `diplomacy.mapshare.offered`, `diplomacy.offered` |
| 9 | `espionage` | `espionage.ts` | `espionage.spy` | `time.advanced` | — | `espionage.detected`, `espionage.failed`, `intel.stolen` |
| 10 | `orbital` | `orbital.ts` | `fleet.bombard`, `fleet.orbit` | `fleet.arrived`, `time.advanced` | — | `aa.fired`, `fleet.bombard`, `fleet.orbit`, `planet.bombarded` |
| 11 | `combat` | `combat.ts` | `fleet.assault`, `fleet.retreat` | `combat.tick`, `fleet.arrived`, `fleet.intercept`, `fleet.transit` | `fleet.speed` | `battle.resolved`, `battle.started`, `combat.round`, `fleet.destroyed`, `fleet.retreated`, `planet.captured`, `unit.died` · sched: `combat.tick` |
| 12 | `artillery` | `artillery.ts` | `fleet.barrage`, `fleet.barrageMode` | `time.advanced` | — | `artillery.fired`, `fleet.barrage`, `fleet.barrageMode` |
| 13 | `intercept` | `intercept.ts` | — | `fleet.leg`, `fleet.parked` | — | sched: `fleet.intercept` |
| 14 | `capture-on-arrival` | `captureOnArrival.ts` | — | `fleet.arrived`, `fleet.transit` | — | `planet.captured` |
| 15 | `construction` | `construction.ts` | `building.construct`, `building.upgrade`, `construction.cancel`, `construction.resume`, `unit.build` | `combat.round`, `construction.complete`, `planet.bombarded`, `time.advanced` | `combat.damage` | `building.constructed`, `building.destroyed`, `building.upgraded`, `construction.cancelled`, `construction.resumed`, `construction.started`, `unit.built` · sched: `construction.complete` |
| 16 | `arsenal-sync` | `arsenalSync.ts` | `arsenal.sync` | — | — | — |
| 17 | `station` | `station.ts` | `station.deploy` | — | — | `station.deployed` |
| 18 | `technology` | `technology.ts` | `technology.boost`, `technology.research` | `technology.complete` | `combat.damage`, `construction.requirement`, `economy.production`, `fleet.speed` | `technology.research.boosted`, `technology.research.started`, `technology.researched` · sched: `technology.complete` |
| 19 | `scientist` | `scientist.ts` | — | — | `research.slots` | — |
| 20 | `steward` | `steward.ts` | `steward.delegate`, `steward.holdpoint`, `steward.recall`, `steward.report` | `planet.captured`, `planet.destroyed`, `time.advanced` | — | `steward.delegated`, `steward.expired`, `steward.holdpoint`, `steward.recalled`, `steward.reported` |
| 21 | `faction` | `faction.ts` | — | — | `combat.damage`, `economy.production`, `fleet.speed` | — |
| 22 | `market` | `market.ts` | `market.cancel`, `market.list`, `market.take` | — | — | `market.cancelled`, `market.listed`, `market.traded` |
| 23 | `army` | `army.ts` | `army.load`, `army.unload` | — | — | `army.loaded`, `army.unloaded` |
| 24 | `fleet-ops` | `fleetOps.ts` | `fleet.engage`, `fleet.launch`, `fleet.merge`, `fleet.split` | — | — | `battle.started`, `fleet.launched`, `fleet.merged`, `fleet.split` · sched: `combat.tick` |
| 25 | `auto-rally` | `autoRally.ts` | — | `unit.built` | — | — |
| 26 | `squadron` | `squadron.ts` | `squadron.return`, `squadron.strike` | `squadron.arrived`, `time.advanced` | — | `fleet.arrived`, `pd.fired`, `squadron.docked`, `squadron.launched`, `squadron.returning` · sched: `squadron.arrived` |
| 27 | `capital` | `capital.ts` | `capital.designate` | — | — | `capital.designated` |
| 28 | `standing-orders` | `standingOrders.ts` | `chain.stamp`, `order.auto`, `order.chain`, `order.scramble`, `patrol.stamp` | `time.advanced` | — | — |
| 29 | `instant-repair` | `instantRepair.ts` | `fleet.instantRepair` | — | — | `fleet.instantRepaired` |
| 30 | `fleet-repair` | `fleetRepair.ts` | `fleet.repair` | — | — | `fleet.repaired` |
| 31 | `forced-march` | `forcedMarch.ts` | `fleet.forcemarch` | `fleet.arrived`, `time.advanced` | `fleet.speed` | — |
| 32 | `pve` | `pve.ts` | — | `pve.wave`, `time.advanced` | — | `pve.started`, `pve.wave.spawned` · sched: `pve.wave` |
| 33 | `victory` | `victory.ts` | — | `battle.resolved`, `fleet.destroyed`, `planet.captured`, `time.advanced`, `unit.built` | — | `match.ended`, `player.eliminated` |
| 34 | `visibility` | `visibility.ts` | — | `fleet.arrived`, `planet.captured`, `time.advanced` | — | — |
| 35 | `effects` | `effects.ts` | — | `planet.captured`, `time.advanced` | — | `effect.applied` |
| 36 | `seatClaim` | `seatClaim.ts` | `seat.claim`, `seat.confirm`, `seat.release` | — | — | `seat.claimed`, `seat.released`, `seat.seated` |

### Карта хуков (кто регистрирует → кто вызывает)

| hook | регистрируют (в порядке `DEV_MODULES`) | вызывает |
|---|---|---|
| `combat.damage` | `sector` → `planet-type` → `hero` → `heroEffects` → `construction` (×2) → `technology` → `faction` | `combat.ts:545,556` |
| `construction.requirement` | `technology` | `construction.ts:201` |
| `economy.production` | `planet-type` → `tax` → `technology` → `faction` | `economy.ts:282` |
| `fleet.speed` | `sector` → `hero` → `combat` → `technology` → `faction` → `forced-march` | `movement.ts:98` |
| `research.slots` | `scientist` | `technology.ts:246` |
| `victory.score` | — (шов, никто не регистрирует) | `victory.ts:72` |
| `espionage.cost` / `espionage.chance` / `espionage.detect` / `espionage.duration` | — (швы) | `espionage.ts:93,103,117,141` |

Последние два — **швы для будущих модулей**: их зовут, но никто не регистрирует, и
пайплайн честно возвращает базу (инвариант #3 — «нет модуля → базовый дефолт»).

### Карта событий (кто эмитит → кто слушает)

| событие | эмитят | слушают (`api.on`) |
|---|---|---|
| `aa.fired` | `orbital` | — |
| `army.loaded` | `army` | — |
| `army.unloaded` | `army` | — |
| `artillery.fired` | `artillery` | — |
| `battle.resolved` | `combat` | `victory` |
| `battle.started` | `combat`, `fleet-ops` | — |
| `building.constructed` | `construction` | — |
| `building.destroyed` | `construction` | — |
| `building.upgraded` | `construction` | — |
| `capital.designated` | `capital` | — |
| `combat.round` | `combat` | `construction` |
| `combat.tick` | `combat`*, `fleet-ops`* | `combat` |
| `construction.cancelled` | `construction` | — |
| `construction.complete` | `construction`* | `construction` |
| `construction.resumed` | `construction` | — |
| `construction.started` | `construction` | — |
| `diplomacy.changed` | `diplomacy` | — |
| `diplomacy.mapshare.changed` | `diplomacy` | — |
| `diplomacy.mapshare.offered` | `diplomacy` | — |
| `diplomacy.offered` | `diplomacy` | — |
| `effect.applied` | `effects` | — |
| `espionage.detected` | `espionage` | — |
| `espionage.failed` | `espionage` | — |
| `fleet.arrival` | `movement`* | `movement` |
| `fleet.arrived` | `movement`, `squadron` | `hero`, `orbital`, `combat`, `capture-on-arrival`, `forced-march`, `visibility` |
| `fleet.barrage` | `artillery` | — |
| `fleet.barrageMode` | `artillery` | — |
| `fleet.bombard` | `orbital` | — |
| `fleet.departed` | `movement` | — |
| `fleet.destroyed` | `combat` | `hero`, `victory` |
| `fleet.instantRepaired` | `instant-repair` | — |
| `fleet.intercept` | `intercept`* | `combat` |
| `fleet.launched` | `fleet-ops` | — |
| `fleet.leg` | `movement` | `intercept` |
| `fleet.merged` | `fleet-ops` | — |
| `fleet.orbit` | `orbital` | — |
| `fleet.parked` | `movement` | `intercept` |
| `fleet.repaired` | `fleet-repair` | — |
| `fleet.retreated` | `combat` | — |
| `fleet.split` | `fleet-ops` | — |
| `fleet.stranded` | `movement` | — |
| `fleet.transit` | `movement` | `hero`, `combat`, `capture-on-arrival` |
| `hero.ability.used` | `hero` | — |
| `hero.aura` | `heroEffects` | — |
| `hero.died` | `hero` | — |
| `hero.fitted` | `hero` | — |
| `hero.moved` | `hero` | — |
| `hero.path.created` | `hero` | — |
| `hero.path.expire` | `hero`* | `hero` |
| `hero.path.expired` | `hero` | — |
| `hero.recalled` | `heroEffects` | — |
| `hero.respawn` | `hero`* | `hero` |
| `hero.respawned` | `hero` | — |
| `hero.revealed` | `heroEffects` | — |
| `hero.skill.unlocked` | `hero` | — |
| `hero.spawned` | `hero` | — |
| `intel.stolen` | `espionage` | — |
| `market.cancelled` | `market` | — |
| `market.listed` | `market` | — |
| `market.traded` | `market` | — |
| `match.ended` | `victory` | — |
| `pd.fired` | `squadron` | — |
| `planet.bombarded` | `orbital` | `construction` |
| `planet.captured` | `combat`, `capture-on-arrival` | `steward`, `victory`, `visibility`, `effects` |
| `planet.destroyed` | `hero` | `steward` |
| `player.eliminated` | `victory` | `diplomacy` |
| `pve.started` | `pve` | — |
| `pve.wave` | `pve`* | `pve` |
| `pve.wave.spawned` | `pve` | — |
| `seat.claimed` | `seatClaim` | — |
| `seat.released` | `seatClaim` | — |
| `seat.seated` | `seatClaim` | — |
| `squadron.arrived` | `squadron`* | `squadron` |
| `squadron.docked` | `squadron` | — |
| `squadron.launched` | `squadron` | — |
| `squadron.returning` | `squadron` | — |
| `station.deployed` | `station` | — |
| `steward.delegated` | `steward` | — |
| `steward.expired` | `steward` | — |
| `steward.holdpoint` | `steward` | — |
| `steward.recalled` | `steward` | — |
| `steward.reported` | `steward` | — |
| `technology.complete` | `technology`* | `technology` |
| `technology.research.boosted` | `technology` | — |
| `technology.research.started` | `technology` | — |
| `technology.researched` | `technology` | — |
| `time.advanced` | kernel (`advanceTo`) | `economy`, `espionage`, `orbital`, `artillery`, `construction`, `steward`, `squadron`, `standing-orders`, `forced-march`, `pve`, `victory`, `visibility`, `effects` |
| `unit.built` | `construction` | `auto-rally`, `victory` |
| `unit.died` | `combat` | `hero` |

`*` у эмитента — событие ПЛАНИРУЕТСЯ (`h.schedule`), то есть срабатывает позже, в
`advanceTo`, в порядке `(at, seq)`. Пустой столбец «слушают» — событие существует для
клиента/логов, ядро на него не реагирует.

### Точки входа ядра

| файл | экспорт | назначение |
|---|---|---|
| `kernel/kernel.ts` | `createKernel(modules)` | компиляция immutable kernel |
| `kernel/applyAction.ts` | `applyAction(state, action, ctx)` | чистое применение действия |
| `kernel/advanceTo.ts` | `advanceTo(state, ctx)` | сдвиг часов + scheduled events |
| `state/gameState.ts` | `GameState`, `createInitialState`, `Player`, `Planet`, `Fleet`, `MatchState` | типы состояния |
| `state/buildFromMap.ts` | `buildStateFromMap(map, data, opts)` | посев матча из карты |
| `state/diplomacy.ts` | `getStance`, `setStance`, `pairKey`, `DEFAULT_STANCE` | дипломатия |
| `data/schemas.ts` | `GameDataSchema`, `parseGameData`, `FactionDef`, `UnitDef` | zod-схемы контента |
| `data/mapSchema.ts` | `MatchMapSchema`, `MatchMap`, `avaShape`, `MapSlot` | zod-схемы карт |
| `action/types.ts` | `Action`, `Context`, `MatchConfig`, `VictoryConfig`, `timeScaleOf` | типы действий |
| `util/time.ts` | `MS_PER_DAY`, `MS_PER_HOUR` | константы времени |
| `util/combat.ts` | `isHostile`, `posAt`, `laneOccupancy` | утилиты боя |

---

## packages/action-layer — гейт действий

| файл | экспорт | назначение |
|---|---|---|
| `gate.ts` | `ActionGate`, `createActionGate` | гейт: envelope validation → zod payload → auth → idempotency → sequence |
| `envelope.ts` | `createActionEnvelope`, `parseActionEnvelope` | обёртка `action.v1` |
| `payloadSchemas.ts` | per-type zod schemas | валидация payload по типу действия |
| `receipts.ts` | `ReceiptStore`, idempotency receipts | идемпотентность (durable, bounded, rate-limited) |
| `sequence.ts` | per-session `clientSeq` gate | строгая последовательность |
| `errors.ts` | `E_*` stable error codes | fail-secure коды |

---

## packages/server — авторитетный сервер

| файл | экспорт | назначение |
|---|---|---|
| `main.ts` | `main()` | точка входа: Fastify + WS + persist + clockDriver |
| `matchRoom.ts` | `MatchRoom` | advance → applyAction → per-player fog deltas; durable persist |
| `scenario.ts` | `DEV_MODULES`, `MODULE_MANIFEST_VERSION`, `createDevMatch`, `loadShippedData` | модуль-манифест + посев матча |
| `matchRegistry.ts` | `LazyRoomRegistry` | multi-match registry + hibernation |
| `matchApi.ts` | `GET /matches` | match-browser read-model |
| `matchFactory.ts` | `createMatch` | фабрика матчей |
| `clockDriver.ts` | `clockDriver` | v1 offline scheduler (`msUntilNextEvent` → tick) |
| `standingOrderDriver.ts` | `standingOrderDriver` | драйвер постоянных приказов |
| `pveOrchestrator.ts` | `pveOrders(state, data, {session, seq})` | PVE-5: тактика волн Роя — ЧИСТАЯ функция → `Action[]`, подаётся через `serverOrders` (ADR `docs/explanations/05-pve-ai-placement.md`: тактика NPC не входит в контракт реплея, поэтому живёт на сервере, а не в модуле ядра) |
| `matchId.ts` | `newMatchId()` | ADDR-1: `m-<uuid>` — один источник идентификатора партии |
| `joinSeat.ts` / `matchRoster.ts` / `seatExpiry.ts` | посадка на место, ростер, истечение брони | ENTRY/REL-5 |
| `store/` | `PostgresStore`, `MatchSnapshot`, `StoredReceipt` | Postgres JSONB persistence |
| `auth.ts` | `verifyJoinToken`, `AUTH_JWT_SECRET` | JWT join-token + Origin allowlist |
| `authApi.ts` | password auth, `pwFingerprint` | аутентификация |
| `protocol.ts` | `VisibilityFields`, wire protocol | сериализация/десериализация |
| `wsServer.ts` | `WsServer` | WebSocket-сервер |
| `serverWiring.ts` | wiring | сборка сервера: manifest check, dataHash |
| `serverConfig.ts` | `ServerConfig` | конфигурация (env: `GATE`, `ALLOWED_ORIGINS`) |
| `rateLimit.ts` | `slidingWindowIpLimiter` | rate limiting |
| `arsenal.ts` | `StarterArsenalTemplate`, `validateStarterArsenal` | ARS-2 starter arsenal |
| `arsenalApi.ts` | `ArsenalApiDeps` | API арсенала |
| `dropRoller.ts` | `DropTables`, `validateDropTables` | ARS-4 salvage/shards |
| `avaOrchestrator.ts` | `AvaSessionSpec` | AvA-оркестратор |
| `avaMapPool.ts` | `pickAvaMap` | AvA-карты |
| `avaApi.ts` / `avaService.ts` | AvA API/service | AvA-логика |
| `corpApi.ts` / `corpService.ts` | corp API/service | корпорации |
| `corpArsenalApi.ts` / `corpArsenalService.ts` | corp arsenal | арсенал корпораций |
| `friendApi.ts` / `friendService.ts` | friend API/service | друзья |
| `leaderboardApi.ts` | `GET /leaderboard` | лидерборд |
| `medalApi.ts` / `medalService.ts` / `medalCatalog.ts` | medals | медали |
| `push.ts` / `pushApi.ts` | `VapidConfig`, push API | push-уведомления |
| `metrics.ts` | `SeriesStat` | метрики |
| `password.ts` | `ScryptParams` | scrypt hashing |
| `ephemeral.ts` | `EphemeralStore` | ephemeral state |
| `roomRegistry.ts` | `RoomRegistry` | интерфейс реестра |
| `persistence.ts` | persistence tests | — |

---

## packages/client — PWA-клиент

| файл | экспорт | назначение |
|---|---|---|
| `main.ts` | entry | Vite app shell: welcome + live map + `?join=` deep-link |
| `welcomeScreen.ts` | `welcomeScreen` | welcome screen view-model |
| `matchHud.ts` | `matchHud` | status bar / fleet selection / battle panel |
| `matchInput.ts` | `matchInput` | ввод в матче |
| `multiplayer.ts` | `MultiplayerClient` | transport adapter (`action.v1` envelope) |
| `net.ts` | net | сетевой слой |
| `theme.ts` | theme tokens | дизайн-токены |
| `mapRender.ts` | `mapRender` | отрисовка карты |
| `territory.ts` | `territory` | границы территорий |
| `camera.ts` | `camera` | камера |
| `holoDraw.ts` | `holoDraw` | holographic drawing |
| `loadoutEditor.ts` | `loadoutEditor` | редактор лоадаута |
| `gameData.ts` | `gameData` | загрузка данных игры |

---

## data/ — игровой контент (JSON)

| файл | содержимое |
|---|---|
| `manifest.json` | версия контент-бандла |
| `units.json` | юниты (корабли, пехота) |
| `buildings.json` | здания |
| `factions.json` | фракции (azure, crimson, amber, violet) |
| `technologies.json` | технологии |
| `scientists.json` | научные лидеры |
| `heroes.json` | архетипы героев |
| `heroAbilities.json` | способности героев |
| `heroPassives.json` | пассивки героев |
| `heroSkillTrees.json` | деревья скиллов |
| `heroFittings.json` | фитинги героев |
| `modules.json` | модули кораблей |
| `planetTypes.json` | типы планет |
| `sectorKinds.json` | типы секторов |
| `sectors.json` | сектора (террейн) |
| `resources.json` | ресурсы |
| `rewards.json` | награды по итогам сессии |
| `medals.json` | медали |
| `events.json` | тёмные события |
| `dropTables.json` | таблицы дропа (ARS-4) |
| `starterArsenal.json` | starter arsenal (ARS-2) |
| `maps/` | карты (MatchMap JSON) |

---

## Навигация по докам

| док | назначение |
|---|---|
| `CLAUDE.md` | оперативный гайд + инварианты (короткая версия) |
| `docs/architecture.md` | полный дизайн архитектуры |
| `docs/modulesystem.md` | модульная система (events/hooks/capabilities) |
| `docs/gdd.md` | Game Design Document |
| `docs/state.md` | живой якорь контекста (снапшот состояния) |
| `docs/backlog.md` | кирпичики (задачи) |
| `docs/roadmap.md` | роадмап |
| `docs/game-modes-roadmap.md` | режимы игры (GM-0..GM-4) |
| `docs/explanations/` | ADR-библиотека решений |