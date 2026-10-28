# CODE-MAP.md — карта модулей Void Dominion

> Индекс-справочник навигации по коду. Сверено из исходников (grep по `api.onAction`/
> `api.on`/`api.hook`/`api.provideCapability`/`h.emit`), не из памяти. Обновлять при
> изменении `DEV_MODULES` или добавлении/удалении модуля — см. `CLAUDE.md` «Working
> agreements» (code first, docs after). Не дизайн-док — для дизайна см.
> `docs/architecture.md`, `docs/modulesystem.md`.

## Принципы проекта (кратко — полный текст в `CLAUDE.md`)

- **Surgical changes** (`CLAUDE.md`, «Behavioral guidelines», п. 3) — трогай только то, что требует задача.
- **Тесты как страховка** — `pnpm run check` (lint + typecheck + test + docs-check)
  перед коммитом; TDD-цикл для новых модулей.
- **Детерминизм** — ядро = чистая функция, no `Math.random`/`Date.now` в
  `shared-core/src/**` (ESLint).
- **Модули говорят через шину** — модули не импортируют друг друга (инвариант #3):
  события (pub/sub), хуки (value pipelines), capabilities (optional links).

---

## Точки входа: что где запускается

> **Читай это первым, если ищешь «где живёт поведение сервера».** Хостов ДВА, и в
> контейнере крутится не тот, который выглядит каноническим. На этом уже спотыкались:
> поиск процессного предохранителя шёл по `packages/server/src/main.ts`, не нашёл его и
> сделал вывод «в сервере такого нет» — а прод исполняет совсем другой файл.

| Что запускается | Кто это на самом деле | Когда |
|---|---|---|
| `packages/server/dist/proto-server.mjs` | **прод**: `Dockerfile` `CMD`; собирается на этапе build из `prototype/netserver.ts` (`RUN node prototype/bundle-netserver.mjs`, `Dockerfile:71`) | контейнер, `moongame`/compose |
| `prototype/netserver.mjs` | тот же хост для разработки: собирает бандл и запускает его | `pnpm dev:proto-server` |
| `prototype/host.mjs` | одной командой для живого теста: собирает HTML, поднимает хост на 0.0.0.0 и печатает LAN-адрес для друзей | `pnpm host` |
| `scripts/server.ts` → `packages/server/src/main.ts:startServer` | **канонический** сервер пакета (Fastify + WS + persist + clockDriver); `packages/server/dev.mjs` собирает внешний entry, который инъецирует почтовый адаптер. В проде пока НЕ запускается | `pnpm dev:server` |
| `prototype/build.mjs` | сборка играбельного клиента в один HTML (`prototype/dist/*.html`) | `pnpm prototype` |
| `packages/client` (Vite) | PWA-оболочка: welcome + живая карта + `?join=` | `pnpm --filter @void/client dev` |
| `deploy/backup.sh` / `deploy/restore.sh` | отдельные задания PostgreSQL backup/restore; опциональный подписанный age-комплект `.vdbak` | backup/restore worker |
| `deploy/backup-repository/s3.mjs` | независимая S3-доставка `.vdbak` и получение конкретной версии с проверкой подписи; SDK исключён из production-зависимостей игры | отдельный worker, [runbook](deploy/backup-repository/README.md) |
| `deploy/observability/game-exporter.mjs` | отдельный bounded JSON→Prometheus collector; источники и HTTP listener только literal loopback, без чтения GameState/JSONL/БД | локальный процесс, [runbook](deploy/observability/GAME-EXPORTER.md); Compose wiring отдельно |

**Практическое следствие.** Правку серверного поведения, которая должна доехать до
игроков, кладут в `prototype/netserver.ts` (или в общий код `packages/server/src/**`,
который он импортирует напрямую по относительному пути). Правка ТОЛЬКО в
`packages/server/src/main.ts` до прода сегодня не доезжает.

Recovery-письма обоих хостов форматирует `scripts/recoveryMailer.ts` под локаль
получателя. Серверный `authApi` передаёт структурный `RecoveryMail`, а `mailer.ts`
отвечает за SMTP/TLS; каталогов локализации в графе серверного пакета нет.

Постоянные боты игрового хоста: `packages/server/src/botRoster.ts` — 100 системных
профилей, атомарные назначения и история; `botNicknames.ts` — ники и их резервирование;
`botPopulation.ts` — посадка, реальные
итоги и восстановление. Подключение — `prototype/netserver.ts`, публичная карточка —
`profileApi.ts` → `decisions/playerProfile.ts` → `prototype/src/profileScreen.ts`.
`prototype/src/botBehavior.ts` выбирает стратегию и политику переговоров по постоянному seed;
`packages/server/src/botSocial.ts` отвечает на принятые личные сообщения, а
`scripts/botChatText.ts` форматирует английские реплики без изменения протокола.
Реальный HTTP/WS: `pnpm run smoke:bots:chat`; CPU/RSS: `pnpm run perf:bots:load`.
Параметры включения описаны в [runbook](deploy/README.md#постоянные-боты-для-заполнения-карт).

---

## prototype/ — играбельный клиент и хост плейтестов

> Это не «прототип, который выкинут»: `prototype/` — то, во что играют игроки сегодня, и
> он линтуется наравне с пакетами (`REFM-0.1`). Клиент `packages/client` — направление на
> будущее (PWA), но полный внутриматчевый интерфейс пока здесь.

| файл | роль |
|---|---|
| `netserver.ts` | хост плейтеста: HTTP+WS, комнаты, гейт действий, persist, метрики (`/metrics/summary`), офлайн-пробуждение. Собирается в прод-бандл |
| `bundle-netserver.mjs` | ОДНА конфигурация сборки бандла на дев и прод — чтобы они не разъехались |
| `src/main.ts` | клиент целиком: карта, HUD, панели, ввод. Большой (см. блок `REFM` в бэклоге) |
| `src/protoKernel.ts` | сборка ядра прототипа: список модулей (порядок = контракт детерминизма) + `canOrder`/`canOrderAll` — проба правил с памятью ответов |
| `src/rocketMinesUi.ts` · `minestest.mjs` | карточка ракетной мины и браузерный smoke; `packages/client/src/ordnanceView.ts` рисует отфильтрованные мины и ракеты |
| `build.mjs` | сборка клиента в самодостаточный HTML; `data-i18n` подставляется из `/localization` |
| `selfplay.mjs` · `econplaytest.mjs` | боты друг против друга: баланс и экономика |
| `perf.mjs` · `report.mjs` · `doctor.mjs` | профиль кадра; разбор JSONL-лога матча (`pnpm metrics`); проверка СВЯЗНОСТИ хоста — «почему не подключаются»: занят ли порт, какие адреса видны снаружи, не слушает ли он только loopback |
| `rehearsal.mjs` | репетиция сетевого слоя: конкурентность, дубли, реконнект, перезапуск |
| `browsertest.mjs` | смоук в настоящем браузере |

---

## packages/shared-core — детерминированное ядро

`createKernel(modules)` компилирует immutable kernel. Две чистые точки входа:
- `applyAction(state, action, ctx)` — применить намерение игрока в `ctx.now`.
- `advanceTo(state, ctx)` — сдвинуть мировые часы, запустить scheduled events.

### Модули ядра (`packages/shared-core/src/modules/`)

Полный актуальный порядок — `DEV_MODULES` в `packages/server/src/scenario.ts`;
версия манифеста меняется при изменении состава/порядка (инвариант #6), сторож —
`moduleManifest.test.ts`. Счётчики канона и прототипа живут в `docs/state.md` §9.
Таблица идёт в порядке `DEV_MODULES` (номер — место в массиве) и собрана grep'ом по
`api.onAction`/`api.on`/`api.hook`/`api.provideCapability`/`h.emit`/`h.schedule` в файле
модуля (имена из констант и циклов раскрыты); события, которые модуль шлёт через общие
утилиты, сюда не попадают.

Пометка `sched:` в колонке emit — событие ставится в `state.scheduled` через
`h.schedule`, а не эмитится сразу.

| # | id | файл | onAction | on (события) | hook | capability | emit · schedule |
|---|---|---|---|---|---|---|---|
| 1 | `sector` | `sector.ts` | — | — | `fleet.speed`, `economy.production`, `combat.damage`, `combat.mitigation` | — | — |
| 2 | `planet-type` | `planetType.ts` | — | — | `economy.production`, `combat.mitigation` | — | — |
| 3 | `tax` | `tax.ts` | — | — | `economy.production` | — | — |
| 4 | `economy` | `economy.ts` | — | `time.advanced` | — | — | — |
| 5 | `movement` | `movement.ts` | `fleet.move`, `fleet.stop` | `fleet.split`, `fleet.arrival` | — | `fleet.course` | `fleet.halted`, `fleet.leg`, `fleet.parked`, `fleet.departed`, `fleet.fork`, `fleet.arrived`, `fleet.transit`, `fleet.stranded` · sched: `fleet.arrival` |
| 6 | `hero` | `hero.ts` | `hero.ability`, `hero.spawn`, `hero.skill.unlock`, `hero.equip`, `hero.unequip`, `hero.install`, `hero.uninstall` | `fleet.arrived`, `fleet.departed`, `fleet.bombard`, `battle.started`, `planet.captured`, `hero.siege.due`, `hero.path.expire`, `unit.died`, `fleet.destroyed`, `fleet.transit`, `fleet.fork`, `hero.respawn` | `fleet.speed`, `combat.damage`, `salvage.share` | — | `hero.spawned`, `hero.recruited`, `hero.died`, `hero.siege.broken`, `hero.path.created`, `hero.path.expired`, `planet.destroyed`, `hero.siege.started`, `hero.siege.done`, `hero.ability.used`, `hero.respawned`, `hero.skill.unlocked`, `hero.equipped`, `hero.unequipped`, `hero.installed`, `hero.uninstalled` · sched: `hero.respawn`, `hero.path.expire`, `hero.siege.due` |
| 7 | `heroEffects` | `heroEffects.ts` | — | — | `combat.damage.parallel`, `combat.damage` | `hero.effect.recall`, `hero.effect.aura`, `hero.effect.reveal`, `hero.effect.jump`, `hero.effect.decoy` | `hero.recalled`, `hero.jumped`, `hero.decoyed`, `hero.aura`, `hero.revealed` |
| 8 | `diplomacy` | `diplomacy.ts` | `diplomacy.declare`, `coalition.create`, `diplomacy.decline`, `coalition.clock.rebase`, `coalition.leave`, `coalition.kick`, `coalition.edit`, `diplomacy.mapshare` | `coalition.departure.due`, `player.eliminated` | — | `diplomacy` | `diplomacy.changed`, `coalition.left`, `coalition.departure.scheduled`, `coalition.joined`, `diplomacy.offered`, `diplomacy.declined`, `coalition.updated`, `diplomacy.mapshare.changed`, `diplomacy.mapshare.offered` · sched: `coalition.departure.due` |
| 9 | `espionage` | `espionage.ts` | `espionage.spy`, `espionage.recall` | `espionage.resolve`, `espionage.sweep`, `time.advanced` | — | — | `espionage.sent`, `espionage.aborted`, `espionage.posted`, `espionage.failed`, `espionage.detected`, `espionage.succeeded`, `intel.stolen`, `espionage.counter.caught`, `espionage.counter.lost`, `espionage.recalled` · sched: `espionage.resolve` |
| 10 | `orbital` | `orbital.ts` | `fleet.orbit`, `fleet.bombard` | `fleet.arrived`, `time.advanced` | — | — | `aa.fired`, `planet.bombarded`, `fleet.orbit`, `fleet.bombard` |
| 11 | `combat` | `combat.ts` | `fleet.assault`, `fleet.retreat`, `battle.retreat`, `battle.attack` | `fleet.arrived`, `fleet.transit`, `diplomacy.changed`, `fleet.intercept`, `fleet.meet`, `player.eliminated`, `assault.landed`, `beachhead.landed`, `combat.tick` | `fleet.speed` | `battle.pullIn` | `battle.started`, `battle.joined`, `assault.landing`, `assault.interrupted`, `assault.ashore`, `beachhead.landed`, `planet.captured`, `fleet.destroyed`, `battle.resolved`, `fleet.retreated`, `combat.round` · sched: `combat.tick`, `assault.landed` |
| 12 | `veteran` | `veteran.ts` | — | — | `combat.damage`, `combat.mitigation` | — | — |
| 13 | `intercept` | `intercept.ts` | — | `fleet.leg`, `fleet.parked`, `battle.started` | — | — | sched: `fleet.intercept`, `fleet.meet` |
| 14 | `capture-on-arrival` | `captureOnArrival.ts` | — | `fleet.arrived`, `fleet.transit` | — | — | `planet.captured` |
| 15 | `salvage` | `salvage.ts` | — | `unit.died`, `battle.resolved`, `station.destroyed`, `time.advanced` | — | — | `salvage.paid` |
| 16 | `construction` | `construction.ts` | `building.construct`, `building.upgrade`, `unit.build`, `construction.cancel`, `construction.resume` | `construction.complete`, `construction.queue.pump`, `station.destroyed`, `planet.captured`, `combat.round`, `planet.bombarded`, `time.advanced` | `combat.mitigation` | `building.damage` | `construction.queued`, `construction.queue.dropped`, `construction.started`, `building.destroyed`, `construction.cancelled`, `construction.resumed`, `building.constructed`, `building.upgraded`, `unit.built` |
| 17 | `arsenal-sync` | `arsenalSync.ts` | `arsenal.sync` | — | — | — | — |
| 18 | `station` | `station.ts` | `station.deploy` | `building.constructed`, `building.upgraded`, `building.destroyed`, `fleet.destroyed`, `planet.captured`, `player.eliminated` | `combat.mitigation` | — | `fleet.parked`, `station.destroyed`, `station.deployed` |
| 19 | `technology` | `technology.ts` | `technology.research`, `technology.boost` | `time.advanced`, `technology.complete` | `construction.requirement`, `economy.production`, `fleet.speed`, `combat.damage.parallel` | `technology.grant` | `technology.research.started`, `technology.research.boosted`, `technology.researched` · sched: `technology.complete` |
| 20 | `scientist` | `scientist.ts` | — | — | `research.slots` | — | — |
| 21 | `steward` | `steward.ts` | `steward.delegate`, `steward.holdpoint`, `steward.report`, `steward.recall` | `planet.captured`, `planet.destroyed`, `station.destroyed`, `time.advanced` | — | — | `steward.delegated`, `steward.holdpoint`, `steward.reported`, `steward.recalled`, `steward.expired` |
| 22 | `faction` | `faction.ts` | — | — | `construction.requirement`, `economy.production`, `fleet.speed`, `fort.garrisonCap`, `combat.damage.parallel` | — | — |
| 23 | `sprawl` | `sprawl.ts` | — | — | `economy.production` | — | — |
| 24 | `market` | `market.ts` | `market.list`, `market.take`, `market.cancel` | — | — | — | `market.listed`, `market.traded`, `market.cancelled` |
| 25 | `army` | `army.ts` | `army.load`, `army.unload` | `army.load.done`, `fleet.departed`, `army.unload.done` | — | — | `army.loading`, `army.loaded`, `army.load.cancelled`, `army.unload.cancelled`, `army.unloading`, `army.unloaded` · sched: `army.load.done`, `army.unload.done` |
| 26 | `fleet-ops` | `fleetOps.ts` | `fleet.launch`, `fleet.merge`, `fleet.split`, `fleet.engage` | `fleet.arrived`, `assault.landed`, `assault.interrupted`, `battle.resolved` | — | — | `fleet.launched`, `fleet.merge.pending`, `fleet.leg`, `fleet.split`, `mine.contact`, `battle.started` · sched: `fleet.arrival`, `combat.tick` |
| 27 | `promotion` | `promotion.ts` | — | `unit.built` | `combat.damage` | — | — |
| 28 | `auto-rally` | `autoRally.ts` | `rally.point` | `planet.captured`, `unit.built` | — | — | — |
| 29 | `shuttle` | `shuttle.ts` | `shuttle.strike`, `shuttle.patrol`, `shuttle.recall`, `shuttle.redirect`, `shuttle.hold`, `shuttle.relocate`, `shuttle.split`, `shuttle.merge`, `shuttle.load`, `shuttle.unload` | `shuttle.arrived`, `shuttle.patrol.resume`, `shuttle.chase`, `shuttle.patrol.tick`, `time.advanced`, `planet.captured`, `pd.reload` | — | `missile.flew` | `shuttle.repelled`, `beachhead.landed`, `planet.captured`, `shuttle.landed`, `shuttle.lost`, `shuttle.diverted`, `shuttle.launched`, `fleet.destroyed`, `shuttle.missileDowned`, `shuttle.hit`, `shuttle.mineCleared`, `pd.mineCleared`, `shuttle.hold.ended`, `shuttle.intercepted`, `planet.bombarded`, `squadron.split`, `squadron.merged`, `shuttle.loaded`, `shuttle.unloaded`, `pd.fired` · sched: `shuttle.arrived`, `shuttle.chase`, `shuttle.patrol.tick`, `shuttle.patrol.resume`, `pd.reload` |
| 30 | `capital` | `capital.ts` | `capital.designate` | — | — | — | `capital.designated` |
| 31 | `standing-orders` | `standingOrders.ts` | `order.auto`, `order.retreat`, `order.chain`, `chain.stamp` | `time.advanced` | — | — | — |
| 32 | `instant-repair` | `instantRepair.ts` | `fleet.instantRepair`, `fleet.premiumRepair` | — | — | — | `fleet.instantRepaired` |
| 33 | `fleet-repair` | `fleetRepair.ts` | `fleet.repair` | — | — | — | `fleet.repaired` |
| 34 | `forced-march` | `forcedMarch.ts` | `fleet.forcemarch` | `time.advanced`, `fleet.arrived` | `fleet.speed` | — | — |
| 35 | `pve` | `pve.ts` | `pve.boon`, `pve.abandon`, `pve.supply` | `time.advanced`, `pve.wave`, `hero.died`, `unit.died`, `shuttle.repelled`, `pd.fired`, `shuttle.intercepted`, `shuttle.lost` | `fleet.speed` | — | `diplomacy.changed`, `pve.boss.spawned`, `pve.started`, `fleet.merged`, `pve.wave.spawned`, `pve.boss.slain`, `pve.boon.taken`, `pve.abandoned`, `pve.supply.delivered` · sched: `pve.wave`, `pve.hold` |
| 36 | `fleetBrood` | `fleetBrood.ts` | — | `time.advanced`, `pve.wave.spawned`, `fleet.launched`, `fleet.brood.cycle` | — | — | `fleet.brood.grown` |
| 37 | `swarmMemory` | `swarmMemory.ts` | — | `shuttle.hit` | — | — | `swarm.observed` |
| 38 | `swarmNet` | `swarmNet.ts` | — | `pve.started`, `swarm.observed`, `swarm.adapt.done`, `fleet.merged`, `fleet.split`, `building.destroyed`, `pve.wave.spawned`, `fleet.arrived`, `fleet.transit`, `fleet.departed`, `fleet.destroyed`, `building.constructed`, `planet.captured`, `unit.built` | — | — | `swarm.net.cut` |
| 39 | `swarmAdapt` | `swarmAdapt.ts` | `swarm.adapt` | `swarm.adapt.ripe`, `pve.wave.spawned`, `fleet.merged`, `fleet.destroyed` | — | — | `swarm.adapt.started`, `swarm.adapt.done`, `swarm.adapt.lost` · sched: `swarm.adapt.ripe` |
| 40 | `swarmJournal` | `swarmJournal.ts` | — | `shuttle.repelled` | — | — | `swarm.journal.entry` |
| 41 | `missionFacts` | `missionFacts.ts` | — | `planet.captured`, `fleet.arrived`, `time.advanced` | — | — | `fleet.joined`, `refuge.found`, `evac.delivered` |
| 42 | `victory` | `victory.ts` | — | `time.advanced`, `planet.captured`, `fleet.destroyed`, `battle.resolved`, `unit.built`, `pve.hold`, `pve.abandoned`, `extraction.delivered`, `extraction.lost`, `operation.completed`, `operation.lost` | — | — | `match.ended`, `player.eliminated` |
| 43 | `visibility` | `visibility.ts` | — | `time.advanced`, `planet.captured`, `fleet.arrived` | — | — | — |
| 44 | `effects` | `effects.ts` | — | `planet.captured`, `time.advanced` | — | — | `effect.applied` |
| 45 | `seatClaim` | `seatClaim.ts` | `seat.claim`, `seat.confirm`, `seat.release`, `seat.kick` | — | — | — | `seat.claimed`, `seat.seated`, `seat.released`, `seat.kicked` |
| 46 | `trader` | `trader.ts` | `trader.buy`, `trader.sell`, `trader.swap` | — | — | — | `trader.bought`, `trader.sold`, `trader.swapped` |
| 47 | `loadoutEffects` | `loadoutEffects.ts` | — | — | `combat.retreatToll`, `salvage.share` | — | — |
| 48 | `minefield` | `minefield.ts` | `fleet.layMines` | `mines.armed`, `fleet.leg`, `fleet.arrived`, `fleet.transit`, `fleet.intercept`, `fleet.meet`, `mine.contact`, `time.advanced` | — | — | `unit.died`, `mines.triggered`, `fleet.destroyed`, `mines.installing`, `mines.laid`, `fleet.parked` · sched: `mines.armed` |
| 49 | `rocketMines` | `rocketMines.ts` | `fleet.deployRocketMine`, `rocketMine.mode`, `rocketMine.disarm` | `rocketMine.armed`, `rocketMine.scan`, `time.stopped`, `time.advanced`, `rocketMine.flight`, `rocketMine.impact`, `fleet.leg`, `fleet.destroyed`, `fleet.merged`, `battle.started`, `fleet.parked` | `time.stop` | — | `fleet.destroyed`, `rocketMine.launched`, `rocketMine.intercepted`, `rocketMine.installing`, `rocketMine.modeChanged`, `rocketMine.disarmed`, `rocketMine.cancelled`, `rocketMine.ready`, `rocketMine.hit`, `rocketMine.detonated` · sched: `rocketMine.impact`, `rocketMine.scan`, `rocketMine.flight`, `rocketMine.armed` |
| 50 | `rendezvous` | `rendezvous.ts` | `ally.order`, `ally.cancel` | `fleet.arrived`, `planet.captured`, `fleet.destroyed`, `fleet.merged`, `player.eliminated` | — | — | `diplomacy.changed`, `ally.contact`, `ally.ordered`, `ally.order.cancelled` |
| 51 | `extraction` | `extraction.ts` | `extraction.start` | `time.advanced`, `fleet.merged`, `fleet.destroyed`, `fleet.arrived`, `ally.contact` | — | — | `extraction.delivered`, `extraction.started`, `extraction.lost`, `extraction.completed` |
| 52 | `operation` | `operation.ts` | — | `fleet.merged`, `fleet.split`, `time.advanced`, `planet.captured`, `battle.resolved`, `fleet.destroyed`, `evac.delivered` | — | — | `operation.force.broken`, `operation.lost`, `operation.completed` |
| 53 | `captive` | `captive.ts` | `captive.load` | `planet.captured`, `planet.destroyed`, `fleet.merged`, `fleet.destroyed`, `time.advanced`, `fleet.arrived` | — | — | `captive.lost`, `captive.taken`, `captive.loaded`, `captive.delivered` |
| 54 | `auto-merge` | `autoMerge.ts` | — | `fleet.arrived` | — | — | — |


### Карта хуков (кто регистрирует → кто вызывает)

| hook | регистрируют (в порядке `DEV_MODULES`) | вызывает (`packages/shared-core/src/`) |
|---|---|---|
| `combat.damage` | `sector` → `hero` → `heroEffects` → `veteran` → `promotion` | `util/combat.ts` |
| `combat.damage.parallel` | `heroEffects` → `technology` → `faction` | `util/combat.ts` |
| `combat.mitigation` | `sector` → `planet-type` → `veteran` → `construction` → `station` | `util/combat.ts` |
| `combat.retreatToll` | `loadoutEffects` | `modules/combat.ts` |
| `construction.requirement` | `technology` → `faction` | `modules/construction.ts`, `modules/hero.ts`, `modules/station.ts` |
| `economy.production` | `sector` → `planet-type` → `tax` → `technology` → `faction` → `sprawl` | `modules/economy.ts` |
| `espionage.agents` | — (шов, никто не регистрирует) | `modules/espionage.ts` |
| `espionage.chance` | — (шов, никто не регистрирует) | `modules/espionage.ts` |
| `espionage.cost` | — (шов, никто не регистрирует) | `modules/espionage.ts` |
| `espionage.detect` | — (шов, никто не регистрирует) | `modules/espionage.ts` |
| `espionage.duration` | — (шов, никто не регистрирует) | `modules/espionage.ts` |
| `espionage.kill` | — (шов, никто не регистрирует) | `modules/espionage.ts` |
| `fleet.speed` | `sector` → `hero` → `combat` → `technology` → `faction` → `forced-march` → `pve` | `modules/movement.ts` |
| `fort.garrisonCap` | `faction` | `modules/construction.ts` |
| `research.slots` | `scientist` | `modules/technology.ts` |
| `salvage.share` | `hero` → `loadoutEffects` | `modules/salvage.ts` |
| `time.stop` | `rocketMines` | `kernel/kernel.ts` (режет отрезок `advanceTo` шагом `time.stopped`) |
| `victory.score` | — (шов, никто не регистрирует) | `modules/victory.ts` |

Хуки без регистраций — **швы для будущих модулей**: их зовут, но никто не регистрирует, и
пайплайн честно возвращает базу (инвариант #3 — «нет модуля → базовый дефолт»).

### Карта событий (кто эмитит → кто слушает)

| событие | эмитят | слушают (`api.on`) |
|---|---|---|
| `aa.fired` | `orbital` | — |
| `ally.contact` | `rendezvous` | `extraction` |
| `ally.order.cancelled` | `rendezvous` | — |
| `ally.ordered` | `rendezvous` | — |
| `army.load.cancelled` | `army` | — |
| `army.load.done` | `army`* | `army` |
| `army.loaded` | `army` | — |
| `army.loading` | `army` | — |
| `army.unload.cancelled` | `army` | — |
| `army.unload.done` | `army`* | `army` |
| `army.unloaded` | `army` | — |
| `army.unloading` | `army` | — |
| `assault.ashore` | `combat` | — |
| `assault.interrupted` | `combat` | `fleet-ops` |
| `assault.landed` | `combat`* | `combat`, `fleet-ops` |
| `assault.landing` | `combat` | — |
| `battle.joined` | `combat` | — |
| `battle.resolved` | `combat` | `salvage`, `fleet-ops`, `victory`, `operation` |
| `battle.started` | `combat`, `fleet-ops` | `hero`, `intercept`, `rocketMines` |
| `beachhead.landed` | `combat`, `shuttle` | `combat` |
| `building.constructed` | `construction` | `station`, `swarmNet` |
| `building.destroyed` | `construction` | `station`, `swarmNet` |
| `building.upgraded` | `construction` | `station` |
| `capital.designated` | `capital` | — |
| `captive.delivered` | `captive` | — |
| `captive.loaded` | `captive` | — |
| `captive.lost` | `captive` | — |
| `captive.taken` | `captive` | — |
| `coalition.departure.due` | `diplomacy`* | `diplomacy` |
| `coalition.departure.scheduled` | `diplomacy` | — |
| `coalition.joined` | `diplomacy` | — |
| `coalition.left` | `diplomacy` | — |
| `coalition.updated` | `diplomacy` | — |
| `combat.round` | `combat` | `construction` |
| `combat.tick` | `combat`*, `fleet-ops`* | `combat` |
| `construction.cancelled` | `construction` | — |
| `construction.complete` | — | `construction` |
| `construction.queue.dropped` | `construction` | — |
| `construction.queue.pump` | — | `construction` |
| `construction.queued` | `construction` | — |
| `construction.resumed` | `construction` | — |
| `construction.started` | `construction` | — |
| `diplomacy.changed` | `diplomacy`, `pve`, `rendezvous` | `combat` |
| `diplomacy.declined` | `diplomacy` | — |
| `diplomacy.mapshare.changed` | `diplomacy` | — |
| `diplomacy.mapshare.offered` | `diplomacy` | — |
| `diplomacy.offered` | `diplomacy` | — |
| `effect.applied` | `effects` | — |
| `espionage.aborted` | `espionage` | — |
| `espionage.counter.caught` | `espionage` | — |
| `espionage.counter.lost` | `espionage` | — |
| `espionage.detected` | `espionage` | — |
| `espionage.failed` | `espionage` | — |
| `espionage.posted` | `espionage` | — |
| `espionage.recalled` | `espionage` | — |
| `espionage.resolve` | `espionage`* | `espionage` |
| `espionage.sent` | `espionage` | — |
| `espionage.succeeded` | `espionage` | — |
| `espionage.sweep` | — | `espionage` |
| `evac.delivered` | `missionFacts` | `operation` |
| `extraction.completed` | `extraction` | — |
| `extraction.delivered` | `extraction` | `victory` |
| `extraction.lost` | `extraction` | `victory` |
| `extraction.started` | `extraction` | — |
| `fleet.arrival` | `movement`*, `fleet-ops`* | `movement` |
| `fleet.arrived` | `movement` | `hero`, `orbital`, `combat`, `capture-on-arrival`, `fleet-ops`, `forced-march`, `swarmNet`, `missionFacts`, `visibility`, `minefield`, `rendezvous`, `extraction`, `captive`, `auto-merge` |
| `fleet.bombard` | `orbital` | `hero` |
| `fleet.brood.cycle` | — | `fleetBrood` |
| `fleet.brood.grown` | `fleetBrood` | — |
| `fleet.departed` | `movement` | `hero`, `army`, `swarmNet` |
| `fleet.destroyed` | `combat`, `shuttle`, `minefield`, `rocketMines` | `hero`, `station`, `swarmNet`, `swarmAdapt`, `victory`, `rocketMines`, `rendezvous`, `extraction`, `operation`, `captive` |
| `fleet.fork` | `movement` | `hero` |
| `fleet.halted` | `movement` | — |
| `fleet.instantRepaired` | `instant-repair` | — |
| `fleet.intercept` | `intercept`* | `combat`, `minefield` |
| `fleet.joined` | `missionFacts` | — |
| `fleet.launched` | `fleet-ops` | `fleetBrood` |
| `fleet.leg` | `movement`, `fleet-ops` | `intercept`, `minefield`, `rocketMines` |
| `fleet.meet` | `intercept`* | `combat`, `minefield` |
| `fleet.merge.pending` | `fleet-ops` | — |
| `fleet.merged` | `pve` | `swarmNet`, `swarmAdapt`, `rocketMines`, `rendezvous`, `extraction`, `operation`, `captive` |
| `fleet.orbit` | `orbital` | — |
| `fleet.parked` | `movement`, `station`, `minefield` | `intercept`, `rocketMines` |
| `fleet.repaired` | `fleet-repair` | — |
| `fleet.retreated` | `combat` | — |
| `fleet.split` | `fleet-ops` | `movement`, `swarmNet`, `operation` |
| `fleet.stranded` | `movement` | — |
| `fleet.transit` | `movement` | `hero`, `combat`, `capture-on-arrival`, `swarmNet`, `minefield` |
| `hero.ability.used` | `hero` | — |
| `hero.aura` | `heroEffects` | — |
| `hero.decoyed` | `heroEffects` | — |
| `hero.died` | `hero` | `pve` |
| `hero.equipped` | `hero` | — |
| `hero.installed` | `hero` | — |
| `hero.jumped` | `heroEffects` | — |
| `hero.path.created` | `hero` | — |
| `hero.path.expire` | `hero`* | `hero` |
| `hero.path.expired` | `hero` | — |
| `hero.recalled` | `heroEffects` | — |
| `hero.recruited` | `hero` | — |
| `hero.respawn` | `hero`* | `hero` |
| `hero.respawned` | `hero` | — |
| `hero.revealed` | `heroEffects` | — |
| `hero.siege.broken` | `hero` | — |
| `hero.siege.done` | `hero` | — |
| `hero.siege.due` | `hero`* | `hero` |
| `hero.siege.started` | `hero` | — |
| `hero.skill.unlocked` | `hero` | — |
| `hero.spawned` | `hero` | — |
| `hero.unequipped` | `hero` | — |
| `hero.uninstalled` | `hero` | — |
| `intel.stolen` | `espionage` | — |
| `market.cancelled` | `market` | — |
| `market.listed` | `market` | — |
| `market.traded` | `market` | — |
| `match.ended` | `victory` | — |
| `mine.contact` | `fleet-ops` | `minefield` |
| `mines.armed` | `minefield`* | `minefield` |
| `mines.installing` | `minefield` | — |
| `mines.laid` | `minefield` | — |
| `mines.triggered` | `minefield` | — |
| `operation.completed` | `operation` | `victory` |
| `operation.force.broken` | `operation` | — |
| `operation.lost` | `operation` | `victory` |
| `pd.fired` | `shuttle` | `pve` |
| `pd.mineCleared` | `shuttle` | — |
| `pd.reload` | `shuttle`* | `shuttle` |
| `planet.bombarded` | `orbital`, `shuttle` | `construction` |
| `planet.captured` | `combat`, `capture-on-arrival`, `shuttle` | `hero`, `construction`, `station`, `steward`, `auto-rally`, `shuttle`, `swarmNet`, `missionFacts`, `victory`, `visibility`, `effects`, `rendezvous`, `operation`, `captive` |
| `planet.destroyed` | `hero` | `steward`, `captive` |
| `player.eliminated` | `victory` | `diplomacy`, `combat`, `station`, `rendezvous` |
| `pve.abandoned` | `pve` | `victory` |
| `pve.boon.taken` | `pve` | — |
| `pve.boss.slain` | `pve` | — |
| `pve.boss.spawned` | `pve` | — |
| `pve.hold` | `pve`* | `victory` |
| `pve.started` | `pve` | `swarmNet` |
| `pve.supply.delivered` | `pve` | — |
| `pve.wave` | `pve`* | `pve` |
| `pve.wave.spawned` | `pve` | `fleetBrood`, `swarmNet`, `swarmAdapt` |
| `refuge.found` | `missionFacts` | — |
| `rocketMine.armed` | `rocketMines`* | `rocketMines` |
| `rocketMine.cancelled` | `rocketMines` | — |
| `rocketMine.detonated` | `rocketMines` | — |
| `rocketMine.disarmed` | `rocketMines` | — |
| `rocketMine.flight` | `rocketMines`* | `rocketMines` |
| `rocketMine.hit` | `rocketMines` | — |
| `rocketMine.impact` | `rocketMines`* | `rocketMines` |
| `rocketMine.installing` | `rocketMines` | — |
| `rocketMine.intercepted` | `rocketMines` | — |
| `rocketMine.launched` | `rocketMines` | — |
| `rocketMine.modeChanged` | `rocketMines` | — |
| `rocketMine.ready` | `rocketMines` | — |
| `rocketMine.scan` | `rocketMines`* | `rocketMines` |
| `salvage.paid` | `salvage` | — |
| `seat.claimed` | `seatClaim` | — |
| `seat.kicked` | `seatClaim` | — |
| `seat.released` | `seatClaim` | — |
| `seat.seated` | `seatClaim` | — |
| `shuttle.arrived` | `shuttle`* | `shuttle` |
| `shuttle.chase` | `shuttle`* | `shuttle` |
| `shuttle.diverted` | `shuttle` | — |
| `shuttle.hit` | `shuttle` | `swarmMemory` |
| `shuttle.hold.ended` | `shuttle` | — |
| `shuttle.intercepted` | `shuttle` | `pve` |
| `shuttle.landed` | `shuttle` | — |
| `shuttle.launched` | `shuttle` | — |
| `shuttle.loaded` | `shuttle` | — |
| `shuttle.lost` | `shuttle` | `pve` |
| `shuttle.mineCleared` | `shuttle` | — |
| `shuttle.missileDowned` | `shuttle` | — |
| `shuttle.patrol.resume` | `shuttle`* | `shuttle` |
| `shuttle.patrol.tick` | `shuttle`* | `shuttle` |
| `shuttle.repelled` | `shuttle` | `pve`, `swarmJournal` |
| `shuttle.unloaded` | `shuttle` | — |
| `squadron.merged` | `shuttle` | — |
| `squadron.split` | `shuttle` | — |
| `station.deployed` | `station` | — |
| `station.destroyed` | `station` | `salvage`, `construction`, `steward` |
| `steward.delegated` | `steward` | — |
| `steward.expired` | `steward` | — |
| `steward.holdpoint` | `steward` | — |
| `steward.recalled` | `steward` | — |
| `steward.reported` | `steward` | — |
| `swarm.adapt.done` | `swarmAdapt` | `swarmNet` |
| `swarm.adapt.lost` | `swarmAdapt` | — |
| `swarm.adapt.ripe` | `swarmAdapt`* | `swarmAdapt` |
| `swarm.adapt.started` | `swarmAdapt` | — |
| `swarm.journal.entry` | `swarmJournal` | — |
| `swarm.net.cut` | `swarmNet` | — |
| `swarm.observed` | `swarmMemory` | `swarmNet` |
| `technology.complete` | `technology`* | `technology` |
| `technology.research.boosted` | `technology` | — |
| `technology.research.started` | `technology` | — |
| `technology.researched` | `technology` | — |
| `time.advanced` | kernel (`advanceTo`) | `economy`, `espionage`, `orbital`, `salvage`, `construction`, `technology`, `steward`, `shuttle`, `standing-orders`, `forced-march`, `pve`, `fleetBrood`, `missionFacts`, `victory`, `visibility`, `effects`, `minefield`, `rocketMines`, `extraction`, `operation`, `captive` |
| `time.stopped` | kernel (`advanceTo`, по хуку `time.stop`) | `rocketMines` |
| `trader.bought` | `trader` | — |
| `trader.sold` | `trader` | — |
| `trader.swapped` | `trader` | — |
| `unit.built` | `construction` | `promotion`, `auto-rally`, `swarmNet`, `victory` |
| `unit.died` | `minefield` | `hero`, `salvage`, `pve` |

`*` у эмитента — событие ПЛАНИРУЕТСЯ (`h.schedule`), то есть срабатывает позже, в
`advanceTo`, в порядке `(at, seq)`. Пустой столбец «слушают» — событие существует для
клиента/логов, ядро на него не реагирует.

### Точки входа ядра

| файл | экспорт | назначение |
|---|---|---|
| `kernel/kernel.ts` | `createKernel(modules)` | компиляция immutable kernel |
| `kernel/kernel.ts` | `Kernel.applyAction(state, action, ctx)` | чистое применение действия |
| `kernel/kernel.ts` | `Kernel.advanceTo(state, ctx)` | сдвиг часов + scheduled events |
| `kernel/kernel.ts` | `Kernel.canApply` / `canApplyAll` | «можно ли?» ЗАРАНЕЕ (RULES-1/3) — тот же прогон, результат выброшен |
| `state/radarSignals.ts` | `detectSignals`, `signatureSize`, `radarThreshold` | сила сигнала группы и чувствительность радара; `visibility.ts:radarSignatures` собирает источники и скрытые контакты |
| `state/gameState.ts` | `GameState`, `createInitialState`, `Player`, `Planet`, `Fleet`, `MatchState` | типы состояния |
| `state/buildFromMap.ts` | `buildStateFromMap(map, data, opts)` | посев матча из карты |
| `state/diplomacy.ts` | `getStance`, `setStance`, `pairKey`, `DEFAULT_STANCE` | дипломатия |
| `data/schemas.ts` | `GameDataSchema`, `parseGameData`, `FactionDef`, `UnitDef` | zod-схемы контента |
| `data/mapSchema.ts` | `MatchMapSchema`, `MatchMap`, `avaShape`, `MapSlot` | zod-схемы карт |
| `action/types.ts` | `Action`, `Context`, `MatchConfig`, `VictoryConfig`, `timeScaleOf` | типы действий |
| `util/time.ts` | `MS_PER_DAY`, `MS_PER_HOUR` | константы времени |
| `state/battleReadout.ts` | `inspectBattle` | урон и бафы/дебафы участников через `traceHooks` |
| `util/combat.ts` | `isHostile`, `posAt`, `laneOccupancy` | утилиты боя |

---

## packages/action-layer — гейт действий

| файл | экспорт | назначение |
|---|---|---|
| `gate.ts` | `ActionGate` | гейт: envelope validation → zod payload → auth → idempotency → sequence |
| `envelope.ts` | `createActionEnvelope`, `validateActionEnvelope`, `authorizeActionEnvelope` | обёртка `action.v1` |
| `shared-core/src/actions/payloadSchemas.ts` | `actionPayloadSchemas`, `isValidActionPayload`, `CLIENT_ACTION_TYPES` | zod-схема payload по типу действия; гейт получает валидатор параметром |
| `receipts.ts` | `ActionReceiptStore`, `InMemoryActionReceiptStore` | квитанции идемпотентности; durable-стор — `packages/server/src/store/` |
| `sequence.ts` | `InMemorySequenceGate` | строгая последовательность per-session `clientSeq` |
| `errors.ts` | `E_*` stable error codes | fail-secure коды |

---

## packages/protocol — общий контракт и правила ввода

| файл | экспорт | назначение |
|---|---|---|
| `src/index.ts` | `MatchSummary`, `Ping`, `ChatMessage`, `ServerErrorCode`, `parseClientMessage`/`serializeServerMessage` | провод сервер↔клиент, объявленный один раз (NETA2-4); клиент берёт отсюда только типы |
| `src/inputPolicy.ts` | `passwordIssue`, `validLoginPassword`, `blockedPublicName`, `closedInput`, `parseRecoveryEmail`, `sanitizeChatText` | общая политика создания пароля, legacy-входа, публичных имён и текстовых полей; серверная проверка и подсказки обоих клиентов |
| `src/telemetry.ts` | `TELEMETRY_EVENTS` | словарь событий клиентской телеметрии (`POST /telemetry`) |
| `src/news.ts`, `metaEconomy*.ts`, `commerce.ts`, `corpInfrastructure.ts`, `playerProfile.ts` | типы | контракты ленты, мета-экономики, магазина, корпораций и профиля |

---

## packages/server — авторитетный сервер

| файл | экспорт | назначение |
|---|---|---|
| `main.ts` | `startServer({sendRecoveryMail})` | запуск сервера: Fastify + WS + persist + clockDriver; адаптеры и fatal handlers подключает внешний `scripts/server.ts` |
| `matchRoom.ts` | `MatchRoom` | advance → applyAction → per-player fog deltas; durable persist |
| `scenario.ts` | `DEV_MODULES`, `MODULE_MANIFEST_VERSION`, `createDevMatch`, `loadShippedData` | модуль-манифест + посев матча |
| `matchRegistry.ts` | `LazyRoomRegistry` | multi-match registry + hibernation |
| `matchApi.ts` | `GET /matches` | match-browser read-model |
| `matchFactory.ts` | `createMatch` | фабрика матчей |
| `operatorMatchApi.ts` | `POST /metrics/matches` | создание сессии с картой и скоростью; полный операторский ключ |
| `sessionSpeed.ts` | `sessionSpeed` | скорость из сохранённых часов либо настройка новой сессии |
| `clockDriver.ts` | `clockDriver` | v1 offline scheduler (`msUntilNextEvent` → tick) |
| `standingOrderDriver.ts` | `standingOrderDriver` | драйвер постоянных приказов |
| `pveOrchestrator.ts` | `pveOrders(state, data, {session, seq})` | PVE-5: тактика волн Роя — ЧИСТАЯ функция → `Action[]`, подаётся через `serverOrders` (ADR `docs/explanations/05-pve-ai-placement.md`: тактика NPC не входит в контракт реплея, поэтому живёт на сервере, а не в модуле ядра) |
| `matchId.ts` | `newMatchId()`, `freeMatchId` | ADDR-1: номер партии — 8 случайных цифр, один источник для обоих хостов; старые `m-<uuid>`/`proto` остаются действительными |
| `joinSeat.ts` / `matchRoster.ts` / `seatExpiry.ts` | посадка на место, ростер, истечение брони | ENTRY/REL-5 |
| `store/` | `PostgresStore`, `MatchSnapshot`, `StoredReceipt` | Postgres JSONB persistence |
| `auth.ts` | `verifyJoinToken`, `signJoinToken`, сессионный JWT | join-токен и сессия (`AUTH_JWT_SECRET`), Origin allowlist |
| `authApi.ts` | password auth, `pwFingerprint` | аутентификация |
| `protocol.ts` | реэкспорт `@void/protocol` | сам провод объявлен в `packages/protocol` (NETA2-4) |
| `wsServer.ts` | `WsServer` | WebSocket-сервер |
| `serverWiring.ts` | wiring | сборка сервера: manifest check, dataHash |
| `serverConfig.ts` | `ServerConfig`, `configFromEnv`, `checkProductionReadiness` | конфигурация из env (`GATE`, `ALLOWED_ORIGINS`…); `PROD=1` не стартует без секретов и TLS |
| `rateLimit.ts` | `slidingWindowIpLimiter` | rate limiting |
| `arsenal.ts` | `StarterArsenalTemplate`, `validateStarterArsenal` | ARS-2 starter arsenal |
| `arsenalApi.ts` | `ArsenalApiDeps` | API арсенала |
| `dropRoller.ts` | `DropTables`, `validateDropTables` | ARS-4 salvage/shards |
| `metaEconomy.ts` / `metaEconomyCatalog.ts` | `MetaEconomy`, строгий каталог v0 | награды, крафт, разбор, сезон, entitlements вне ядра |
| `metaEconomyStore.ts` / `memoryEconomyLock.ts` | общий transaction boundary | inventory/drop/wallet/materials/receipt: Memory + PostgreSQL |
| `metaEconomyDelivery.ts` / `metaEconomyObservation.ts` / `metaEconomyActivity.ts` | durable факты и доставка | baseline + события сохраняются со snapshot; повтор/рестарт без новой выдачи |
| `metaEconomyApi.ts` / `metaCommerce.ts` | session API / внутренний signed API | supply goal, craft, season, read-only receipts; Commerce grant отдельно от клиента |
| `metaMarket.ts` / `metaMarketApi.ts` | Auction внутри Meta/Economy | предметы и material escrow, кошельки/комиссия/receipt одной транзакцией |
| `mainGameArsenal.ts` | ordinary match initialization/sync | владение ограничивает новые постройки; существующие корабли неизменны |
| `commerceMain.ts` / `commerceMigrateMain.ts` | отдельный процесс и миграция | собственная БД/роль; [runbook](docs/meta-economy.md) |
| `commerceService.ts` / `commerceStore.ts` / `commercePostgres.ts` | orders, proof, outbox | verified provider adapters, retry/status/refund; runtime adapters отключены |
| `commerceServer.ts` / `commerceTransport.ts` / `commerceCatalog.ts` | HTTP / подпись / предложения | отдельные ключи, audience/capability, nonce, четыре известных состава |
| `avaOrchestrator.ts` | `AvaSessionSpec` | AvA-оркестратор |
| `avaMapPool.ts` | `pickAvaMap` | AvA-карты |
| `avaApi.ts` / `avaService.ts` | AvA API/service | AvA-логика |
| `corpApi.ts` / `corpService.ts` | corp API/service | корпорации и инфраструктура; оба серверных входа |
| `corporationMain.ts` / `corporationServer.ts` | самостоятельный corporate entrypoint | бандл `corporation-server.mjs`, отдельная PostgreSQL; [карта](docs/corporation-service.md) |
| `corporateTransport.ts` / `corporateRemote.ts` | signed gateway / RPC | оба игровых входа, проверка личности в Game, подпись ответов и durable nonce |
| `dependencyGuard.ts` | ограничение нагрузки / circuit breaker | общий исходящий предохранитель; применяется к Corp HTTP/RPC, без очереди и автоповтора; [роадмап](docs/service-resilience-roadmap.md) |
| `corporateTransactions.ts` | `createCorporateServices` | SERIALIZABLE операция: права, изменение, аудит; savepoints стора |
| `corporateMigration.ts` / `corporateMigrationMain.ts` | `CORPORATE_TABLES`, dry run / apply | перенос десяти корпоративных таблиц без игровых данных |
| `corpConstruction.ts` | каталог и атомарный переход инфраструктуры | `data/corpBuildings.json`, очередь, влияние, аудит; Memory/Postgres |
| `corpArsenalApi.ts` / `corpArsenalService.ts` | corp arsenal | арсенал корпораций |
| `friendApi.ts` / `friendService.ts` | friend API/service | друзья |
| `leaderboardApi.ts` | `GET /leaderboard` | лидерборд |
| `medalApi.ts` / `medalService.ts` / `medalCatalog.ts` | medals | медали |
| `push.ts` / `pushApi.ts` | `VapidConfig`, push API | push-уведомления |
| `metrics.ts` | `SeriesStat` | метрики |
| `playerActivity.ts` / `playerActivityApi.ts` | account-day intervals, pulse, operator snapshot | Foreground presence и union времени; [runbook](deploy/observability/PLAYER-ACTIVITY.md) |
| `password.ts` | `ScryptParams` | scrypt hashing |
| `ephemeral.ts` | `EphemeralStore` | ephemeral state |
| `roomRegistry.ts` | `RoomRegistry` | интерфейс реестра |
| `persistence.ts` | `createStores`, `snapshotOf` | выбор стора по env (Postgres при `DATABASE_URL`, иначе память), снимок комнаты |

---

## packages/client — PWA-клиент

| файл | экспорт | назначение |
|---|---|---|
| `main.ts` | entry | Vite app shell: вход, обзор партий, живая карта, `?join=` deep-link |
| `session.ts` | `createSession` | HTTP-половина клиента (MIG-2): вход, список партий, занятие места |
| `hudView.ts` | рендер HUD | рисует то, что проецирует `matchHud.ts` (MIG-3); `matchHud` про DOM не знает |
| `snapshotCache.ts` · `appUpdate.ts` · `locale.ts` | кэш снимка, обновление PWA, загрузка одной локали (LOC-6) | |
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
| `factions.json` | семь фракций: четыре дома (azure, crimson, amber, violet), легаси-пара vanguard, swarm и NPC pirates |
| `technologies.json` | технологии |
| `modes.json` | режимы игры — восемь пресетов (`standard`, `pve_waves`, `training`, `duel`, `team_2v2`…`team_5v5`): `victory` + `teamFormat` + опц. `modules[]`/`pve` |
| `market.json` | список товаров сессионной биржи (`goods`) |
| `scientists.json` | научные лидеры |
| `heroes.json` | архетипы героев |
| `heroAbilities.json` | способности героев |
| `heroPassives.json` | пассивки героев |
| `heroSkillTrees.json` | деревья скиллов |
| `heroGrades.json` | грейды героев (`heroFittings.json` удалён — `docs/hero-progression-roadmap.md` §0.35) |
| `modules.json` | модули кораблей |
| `planetTypes.json` | типы планет |
| `sectorKinds.json` | типы секторов |
| `sectors.json` | сектора (террейн) |
| `resources.json` | ресурсы |
| `rewards.json` | награды по итогам сессии |
| `medals.json` · `medalGrades.json` | медали (серверный каталог) и их степени |
| `veteran.json` · `promotion.json` | надбавка ветерана и бросок «отмеченной» партии |
| `sectorZeroShop.json` · `sectorZeroStars.json` | Sector Zero: витрина магазина, ступени звёзд |
| `corpBuildings.json` | постройки базы корпорации; серверный каталог вне `GameData` |
| `events.json` | тёмные события |
| `dropTables.json` | таблицы дропа (ARS-4) |
| `metaEconomy.json` | серверный каталог v0: материалы, рецепты, сезон, лимиты; вне `GameData` |
| `starterArsenal.json` | starter arsenal (ARS-2) |
| `maps/` | карты (MatchMap JSON); `frontier-50.json`/`frontier-100.json` в корне `data/` — снятый «Фронтир» для старых партий |
| `bundle.ts` | вшивает фрагменты в бандл для браузера и хоста игроков (`composeGameDataBundle`) |

---

## Навигация по докам

| док | назначение |
|---|---|
| `CLAUDE.md` | оперативный гайд + инварианты (короткая версия) |
| `docs/architecture.md` | полный дизайн архитектуры |
| `docs/modulesystem.md` | модульная система (events/hooks/capabilities) |
| `docs/gdd.md` | Game Design Document |
| `docs/state.md` | живой якорь контекста (снапшот состояния) |
| `docs/index.md` | **генерируемый индекс документов**: какой док про что |
| `docs/backlog.md` | кирпичики (задачи) |
| `docs/bricks-index.md` | **генерируемый индекс кирпичей**: ID → статус, зона, файл (без номера строки — WIKI-2: с ним индекс конфликтовал почти в каждом параллельном PR; кирпич ищется в файле по своему id). Отвечает на «есть ли уже кирпич про X?» одним поиском вместо перебора бэклога |
| `docs/roadmap.md` | роадмап |
| `docs/game-modes-roadmap.md` | режимы игры (GM-0..GM-4) |
| `docs/explanations/` | ADR-библиотека решений |
