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

Порядок = порядок в `DEV_MODULES` (`packages/server/src/scenario.ts:106`).
`MODULE_MANIFEST_VERSION = '4'` — bump при изменении состава/порядка (инвариант #6).

| # | id | файл | onAction | on (events) | hook (name) | emit |
|---|---|---|---|---|---|---|
| 1 | `sector` | `sector.ts` | — | — | `fleet.speed`, `combat.damage` | — |
| 2 | `planet-type` | `planetType.ts` | — | — | `economy.production`, `combat.damage` | — |
| 3 | `tax` | `tax.ts` | — | — | `economy.production` | — |
| 4 | `economy` | `economy.ts` | — | `time.advanced` | — | — |
| 5 | `movement` | `movement.ts` | `fleet.move`, `fleet.stop` | — | — | `fleet.leg`, `fleet.departed` |
| 6 | `hero` | `hero.ts` | `hero.move`, `planet.annihilate`, `hero.ability` | `fleet.arrived`, `hero.path.expire` | `fleet.speed`, `combat.damage` | `hero.died`, `hero.path.created`, `hero.path.expired`, `planet.destroyed`, `hero.moved`, `hero.ability.used` |
| 7 | `diplomacy` | `diplomacy.ts` | `diplomacy.declare` | — | — | `diplomacy.changed`, `diplomacy.offered` |
| 8 | `orbital` | `orbital.ts` | — | `fleet.arrived` | — | `aa.fired`, `planet.bombarded` |
| 9 | `combat` | `combat.ts` | — | `fleet.arrived`, `fleet.transit` | `fleet.speed` | `battle.started`, `planet.captured`, `fleet.destroyed`, `battle.resolved` |
| 10 | `artillery` | `artillery.ts` | `fleet.barrage` | `time.advanced` | — | `artillery.fired` |
| 11 | `intercept` | `intercept.ts` | — | `fleet.leg`, `fleet.parked` | — | — |
| 12 | `capture-on-arrival` | `captureOnArrival.ts` | — | `fleet.arrived` | — | `planet.captured` |
| 13 | `construction` | `construction.ts` | `building.construct`, `building.upgrade`, `unit.build`, `construction.cancel` | — | `combat.damage`, `construction.requirement` | `building.destroyed`, `construction.started` |
| 14 | `arsenal-sync` | `arsenalSync.ts` | `arsenal.sync` | — | — | — |
| 15 | `station` | `station.ts` | `station.deploy` | — | — | `station.deployed` |
| 16 | `technology` | `technology.ts` | `technology.research`, `technology.boost` | — | `construction.requirement`, `economy.production`, `fleet.speed`, `combat.damage` | `technology.research.started`, `technology.research.boosted` |
| 17 | `scientist` | `scientist.ts` | — | — | `research.slots` | — |
| 18 | `faction` | `faction.ts` | — | — | `economy.production`, `fleet.speed`, `combat.damage` | — |
| 19 | `market` | `market.ts` | `market.list`, `market.buy`, `market.cancel` | — | — | `market.listed` |
| 20 | `army` | `army.ts` | `army.load`, `army.unload` | — | — | `army.loaded` |
| 21 | `fleet-ops` | `fleetOps.ts` | `fleet.launch`, `fleet.merge`, `fleet.split` | — | — | `fleet.launched` |
| 22 | `squadron` | `squadron.ts` | `squadron.strike`, `squadron.return` | — | — | `squadron.launched`, `squadron.returning` |
| 23 | `capital` | `capital.ts` | `capital.designate` | — | — | `capital.designated` |
| 24 | `standing-orders` | `standingOrders.ts` | `order.auto`, `order.scramble`, `patrol.stamp` | — | — | — |
| 25 | `instant-repair` | `instantRepair.ts` | `fleet.instantRepair` | — | — | `fleet.instantRepaired` |
| 26 | `fleet-repair` | `fleetRepair.ts` | `fleet.repair` | — | — | `fleet.repaired` |
| 27 | `forced-march` | `forcedMarch.ts` | `fleet.forcemarch` | — | `fleet.speed` | — |
| 28 | `victory` | `victory.ts` | — | `time.advanced` | — | `match.ended`, `player.eliminated` |
| 29 | `visibility` | `visibility.ts` | — | `time.advanced` | — | — |

### Модули вне `DEV_MODULES` (опциональные / capability-based)

| id | файл | onAction | on | hook | capability | emit |
|---|---|---|---|---|---|---|
| `effects` | `effects.ts` | — | — | — | `effect.<name>` (contract) | `effect.applied` |
| `espionage` | `espionage.ts` | `espionage.spy` | — | `espionage.cost`, `espionage.chance`, `espionage.detect` | — | `espionage.failed`, `espionage.detected`, `espionage.stolen` |
| `hero-effects` | `heroEffects.ts` | — | `hero.died` | `combat.damage` | — | `hero.recalled` |
| `steward` | `steward.ts` | `steward.delegate`, `steward.holdpoint` | `player.eliminated`, `planet.captured` | — | `steward.delegated`, `steward.holdpoint` |

### Карта хуков (кто регистрирует → кто вызывает)

| hook name | регистрируют (порядок в `DEV_MODULES`) | вызывает |
|---|---|---|
| `economy.production` | `planet-type` → `tax` → `faction` → `technology` | `economy.ts` |
| `fleet.speed` | `sector` → `combat` → `faction` → `forced-march` → `hero` → `technology` | `movement.ts`, `combat.ts` |
| `combat.damage` | `sector` → `planet-type` → `construction` (×2) → `faction` → `hero` → `hero-effects` → `technology` | `combat.ts`, `construction.ts` |
| `construction.requirement` | `technology` | `construction.ts` |
| `research.slots` | `scientist` | `technology.ts` |
| `victory.score` | (внешние модули) | `victory.ts` |
| `espionage.cost` / `espionage.chance` / `espionage.detect` | (внешние модули) | `espionage.ts` |

### Карта событий (кто эмитит → кто слушает)

| event | эмитят | слушают (`api.on`) |
|---|---|---|
| `time.advanced` | kernel (`advanceTo`) | `economy`, `artillery`, `victory`, `visibility` |
| `fleet.arrived` | `movement` (через scheduled) | `hero`, `orbital`, `combat`, `capture-on-arrival` |
| `fleet.leg` | `movement` | `intercept` |
| `fleet.parked` | `movement` | `intercept` |
| `fleet.transit` | `movement` | `combat` |
| `fleet.departed` | `movement` | — |
| `planet.captured` | `combat`, `capture-on-arrival` | `steward` |
| `planet.destroyed` | `hero` | — |
| `hero.died` | `hero` | `hero-effects` |
| `hero.path.expire` | `hero` (через scheduled) | `hero` |
| `player.eliminated` | `victory` | `steward` |
| `match.ended` | `victory` | — |
| `battle.started` / `battle.resolved` | `combat` | — |
| `fleet.destroyed` | `combat` | — |
| `building.destroyed` | `construction` | — |
| `diplomacy.changed` / `diplomacy.offered` | `diplomacy` | — |
| `technology.research.started` / `...boosted` | `technology` | — |
| `market.listed` | `market` | — |
| `army.loaded` | `army` | — |
| `fleet.launched` | `fleet-ops` | — |
| `squadron.launched` / `squadron.returning` | `squadron` | — |
| `capital.designated` | `capital` | — |
| `station.deployed` | `station` | — |
| `steward.delegated` / `steward.holdpoint` | `steward` | — |
| `fleet.repaired` / `fleet.instantRepaired` | `fleet-repair`, `instant-repair` | — |
| `artillery.fired` | `artillery` | — |
| `aa.fired` / `planet.bombarded` | `orbital` | — |
| `espionage.failed` / `espionage.detected` / `espionage.stolen` | `espionage` | — |
| `hero.recalled` | `hero-effects` | — |
| `hero.moved` / `hero.ability.used` / `hero.path.created` / `hero.path.expired` | `hero` | — |
| `effect.applied` | `effects` | — |

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