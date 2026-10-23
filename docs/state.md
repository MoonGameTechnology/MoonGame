# Состояние проекта — снимок

> Что есть в коде сейчас и как оно устроено: пакеты, ядро, состояние, модули, данные,
> клиенты, статус. Снимок, а не журнал: факт — одна-три строки, история — в PR и
> тематических роадмапах; устаревшее переписывают на месте, а не дописывают рядом.
> Прежний полный текст с историей правок — [архив до 2026-10-19](archive/state-2026-10-19.md).

**Гейт:** `pnpm run check` (lint + typecheck + test + docs-check).
**Тесты: 13274 зелёных** (166 skip; 1062 файлов прошли, 6 skip; локально без PostgreSQL, 2026-10-23).

**Быстрый старт сессии** (только указатели, факты живут в секциях):

- Правила, инварианты, локализация — корневой [CLAUDE.md](../CLAUDE.md); где какой код —
  [CODE-MAP.md](../CODE-MAP.md).
- Что это — §1, ядро — §2, файлы — §3, состояние и модули — §4–§5, данные — §6.
- Прототип (клиент игроков) — §7, метаигра — §8, статус и счётчики модулей — §9,
  команды и качество — §10, как возобновить работу — §11.
- Готовность по этапам — [readiness.md](readiness.md); что держит выход к игрокам —
  [release-path.md](release-path.md).
- Что брать в работу — [backlog.md](backlog.md) (1 кирпич ≈ 1 PR); какой док про что —
  [index.md](index.md).

## 1. Что это

Космическая стратегия **реального времени** в жанре Bytro. Это не пошаговая игра: часы идут
непрерывно, приказы занимают реальные часы, на сервере мир живёт 24/7 и тогда, когда все
игроки офлайн (в соло есть пауза и скорость). Ставка — расширяемое ядро: механики, юниты и
фракции добавляются данными и модулями, а не переписыванием логики. Код носит прежнее имя
Void Dominion (`@void/*`); название продукта — Averion или Void Dominion — ещё не выбрано.

Две игры на одном ядре:

| Игра | Что это |
| --- | --- |
| **Galactic War** | основная стратегия: соло с ботами и сетевые партии на 2–50 мест |
| **Sector Zero** | PvE-кампания против Роя: 6 глав, свой прогресс, своя сборка |

Карты Galactic War — `duel-1`, `ffa-4`, `team-2v2`, `team-3v3`, `ffa-20`, `ffa-50`
(`prototype/src/mapCatalog.ts`). Главы Sector Zero — `data/maps/pve-1…6.json`, режим
`pve_waves` (10 волн); архив под Яндекс Игры собирает `prototype/platformBuild.mjs`.

**Где играют игроки.** Клиент игроков — `prototype/` (имя историческое). Его раздают образ
сервера (`packages/server/dist/proto-server.mjs` — это `prototype/netserver.ts`, собранный
`prototype/bundle-netserver.mjs`), сайт на Cloudflare (`wrangler.jsonc`), GitHub Pages
(`pages.yml`) и два APK (`android.yml`: `alpha` и `player`). `packages/client` игрокам не
отдаётся. Адреса и готовность по этапам — [readiness.md](readiness.md).

| Путь | Роль |
| --- | --- |
| `packages/shared-core` | детерминированная симуляция: микроядро, модули, схемы данных, реплей |
| `packages/action-layer` | гейт `ActionGate` перед ядром: `action.v1`, квитанции, `clientSeq` |
| `packages/protocol` | провод сервер↔клиент, объявленный один раз; клиент берёт из него типы |
| `packages/server` | авторитетный сервер: `MatchRoom`, WS, Postgres, аккаунты, офлайн-часы |
| `packages/client` | PWA-клиент (Vite): вход, обзор партий, место, HUD; догоняет прототип |
| `prototype/` | клиент игроков: сборки dev, player и Sector Zero; хост `netserver.ts` |
| `decisions/` | чистые клиентские решения с тестом рядом, общие обоим клиентам; не пакет |
| `localization/` | тексты игрока (`ru.ts`, `en.ts`) и единый рантайм `core.ts`; в коде ключи |
| `data/` | контент в JSON, карты в `data/maps/`, версия бандла в `data/manifest.json` |
| `mobile/` | Capacitor-обёртка: Android APK, подготовка к RuStore |
| `deploy/` | Compose (сервер + Postgres), Caddy/TLS, preflight, бэкапы, автодеплой, мониторинг |
| `docs/` | дизайн, роадмапы, бэклог, этот снимок |

Серверных входов два, оба на общих частях `packages/server`: `prototype/netserver.ts`
(`pnpm host`, его запускает образ) и `packages/server/src/main.ts` (`pnpm dev:server`).
Правка только `main.ts` игроков не меняет.

Автодеплой раз в 5 минут очищает старые опубликованные образы: хранит пять ревизий
каждого компонента, checkpoint текущей/предыдущей версии и образы всех контейнеров.
Правила и ручной dry-run — [эксплуатация](../deploy/README.md#очистка-старых-образов).

Образ сервера использует исправленные CA Debian; Node и worker удаления аккаунтов
наследуют `--use-openssl-ca`. Доверие проверяется TLS-smoke перед публикацией;
правила обновления — [image-pinning](security/image-pinning.md).

## 2. Архитектура ядра

`createKernel(modules)` (`packages/shared-core/src/kernel/kernel.ts`) собирает неизменяемое
микроядро: порядок массива модулей — порядок исполнения, `kernel.manifest` хранит `{id, version}`.

- **Входы — чистые функции.** `applyAction(state, action, ctx)` — приказ в `ctx.now`, отказ —
  `{ ok: false, code }`; `advanceTo(state, ctx)` — часы мира до `ctx.now`, сервер зовёт его
  перед приказом. `canApply`/`canApplyAll` — «можно ли?» для приказа и связки тем же прогоном
  (код `E_*` или `null`); `traceHooks` — какой модуль как сдвинул хук (надбавки окна флота).
- **Модуль** в `setup(api)` регистрирует `onAction(type, h)` (один на тип), `on(event, h)`,
  `hook(name, fn)`, `provideCapability(name, impl)`. Обработчику — `HandlerContext`: `state`
  (черновик), `ctx`, `rng`, `emit`, `schedule(at, type, payload)`, `hook`, `capability`, `reject`.
- **Время.** `schedule` ставит событие в очередь по `(at, seq)`; `advanceTo` исполняет её, а
  между событиями шлёт `time.advanced {from, to}` — накопление по формуле, без тиков. Хук
  `time.stop` режет отрезок шагом `time.stopped` (ракетная мина). Упавшее событие уходит в
  `failures` (dead-letter), мир идёт дальше. Сверх `MAX_ADVANCE_STEPS` — `partial: true`;
  общий цикл догона `runUntil` пока зовёт только реплей, у `MatchRoom` свой.
- **Копии.** `advanceTo` берёт одну копию мира на ход; черновик приказа (`lazyDraft`) копирует
  только тронутое, итог делит нетронутое со входом — состояние от ядра на месте не правят.
- **Детерминизм.** Кости — `Rng` (sfc32) в `state.rng`, поток закреплён золотым `rng.test.ts`.
  ESLint запрещает в ядре `Math.random`, `Date` и неточные `Math.sin`/`pow`/`atan2`/…
  У проекции под туманом (`visibleState`) костей нет: бросок на ней — отказ `E_NO_RNG`.
- **Сверка и реплей.** `hashState` — cyrb53 по каноническому JSON (золотой тест), кусками —
  `hashStateJob`. `runReplay` проигрывает `ReplayLog` до того же хеша; живую комнату пишет
  опция `record` у `MatchRoom`, сверяет `replayDeterminism.test.ts`.
- **Версия правил** — `state.version`: `data`, `manifest` (`MODULE_MANIFEST_VERSION` в
  `packages/server/src/scenario.ts`; растёт, когда партия пошла бы иначе: состав, порядок,
  форма состояния, правила модуля) и `dataHash`. `createMatchLoader` (`serverWiring.ts`)
  не поднимает партию при расхождении, `runReplay` не играет лог чужой версии данных; хост
  игроков `netserver.ts` не сверяет ничего (долг в §9). Список модулей закреплён в
  `moduleManifest.test.ts`.
- **Движок эффектов** (`modules/effects.ts`) исполняет правила `data/events.json`
  (`planet_captured`, `province_captured`, `schedule`): эффект ищется сначала как
  возможность `effect.<name>`, затем среди встроенных `add_trait` и `modify_resource`.

Инварианты — [CLAUDE.md](../CLAUDE.md); шина и деградация — [modulesystem.md](modulesystem.md).

## 3. Карта файлов

Дерево верхнего уровня. Подробная карта кода (модули, хуки, события, файлы пакетов) —
[CODE-MAP.md](../CODE-MAP.md), индекс всех документов — [index.md](index.md).

```text
packages/
  shared-core/src/     ядро: детерминированная симуляция без сети и БД
    kernel/            kernel.ts: createKernel, applyAction, advanceTo, canApply; module.ts
    modules/           54 модуля механик; порядок ядра — DEV_MODULES в server/src/scenario.ts
    state/             gameState.ts (GameState), visibility.ts (туман), buildFromMap.ts (посев)
    action/, actions/  types.ts (Action, Context, MatchConfig), matchMode.ts; payloadSchemas.ts
    data/              schemas.ts (zod-схемы GameData), mapSchema.ts, loadGameData.ts
    util/, rng/, replay/  общие расчёты (pricing.ts, clone.ts…), rng.ts (sfc32), replay.ts
    index.ts           публичный API пакета
  action-layer/src/    gate.ts: конверт → схема → права → квитанция → clientSeq; errors.ts
  protocol/src/        index.ts: сообщения сервер↔клиент; inputPolicy.ts: правила ввода
  server/src/          matchRoom.ts, store/, auth, API (общие с прото-хостом); main.ts не в проде
  client/src/          PWA: main.ts, session.ts (вход), matchHud.ts + hudView.ts, multiplayer.ts
prototype/             то, во что играют: клиент и игровой хост
  src/main.ts          клиент: карта, HUD, окна, ввод
  src/protoKernel.ts   MODULES прототипа (56) и проба приказов canOrder
  src/matchSetup.ts    newGame: посев партии; src/game.ts — фасад реэкспортов
  netserver.ts         хост HTTP+WS; bundle-netserver.mjs → packages/server/dist/proto-server.mjs
  build.mjs            сборка клиента в HTML-файлы prototype/dist/
  *.mjs                харнесы: selfplay.mjs, perf.mjs, report.mjs, смоуки *test.mjs
decisions/             чистые решения обоих клиентов, тест рядом (README.md)
localization/          ru.ts, en.ts (ключ → текст), core.ts (t, tData), runtime.ts, bundles.ts
data/                  контент *.json, manifest.json (версия), bundle.ts (сборка), maps/
scripts/               docs-check.mjs (гейт доков), server.ts (вход сервера пакета), генераторы
deploy/                Compose, Caddy, бэкап и восстановление, обновление, проверка образа
mobile/                обёртка Capacitor: APK, выпуск в RuStore
testclient/            минимальный браузерный клиент для pnpm dev:server
docs/                  дизайн, роадмапы, бэклог; ADR — docs/explanations/
.github/workflows/     ci.yml (гейт), security.yml, image.yml, android.yml, pages.yml и др.
Dockerfile             прод-образ: запускает packages/server/dist/proto-server.mjs
wrangler.jsonc         сайт на Cloudflare: статические страницы клиента
```

Ещё в корне: `art/`, `examples/`, `engagements/` (отчёт аудита), `playtest-logs/`.

## 4. Модель состояния (`GameState`)

Тип — `packages/shared-core/src/state/gameState.ts`, 56 полей. Обязательные 11 (без `?`) и
`startedAt` создаёт `createInitialState`, прочие — модули и посев с карты, если механика есть.

| Поле | Что хранит |
| --- | --- |
| `version`, `mapId?`, `modeId?` | версии данных и манифеста модулей, хэш бандла; карта и режим |
| `sight?`, `techRules?`, `pricing?` | правила партии: радиусы зрения, техдерево, множители цен |
| `time`, `startedAt?`, `match` | часы и старт партии, мс; статус, победители, очки, награды |
| `rng` | состояние сидированного генератора sfc32 `{a, b, c, d}` |
| `players` | места: дом, `ai`/`npc`/`team`, казна `resources`, исследования, учёные, арсенал |
| `planets` | провинции: владелец, лейны и дороги, вид, постройки, гарнизон, очередь стройки |
| `fleets`, `fleetSeq?` | флоты: место или курс, стеки `units`, десант, ангар, орбита; счётчик id |
| `battles`, `battleSeq` | бои: место, фаза `orbital`/`ground`, стороны `sides`, раунд; счётчик id |
| `scheduled`, `scheduleSeq` | будущие события `{id, at, type, payload, seq}` для `advanceTo` |
| `fog?`, `surveyed?`, `seenPatrols?` | память тумана по игрокам; тип провинций, где побывали их корабли; видимые чужие патрули (только в проекции) |
| `heroes?`, `tempLanes?`, `topology?`, `heroSeq?` | герои, их временные лейны, версия графа |
| `diplomacy?`, `mapShares?` | стойки пар (нет записи — `war`), договоры обмена картами |
| `diplomacyOffers?`, `mapShareOffers?`, `intel?`, `spyAgents?` | предложения о стойках и картах; окна шпионажа; занятые агенты |
| `market?`, `marketSeq?`, `trader?` | книга заявок биржи и счётчик; курс торговца экспедиции |
| `capital?`, `rallyPoints?` | столица (возрождение героев), точки сбора миров-верфей |
| `orders?`, `autoAssault?`, `autoRetreat?`, `forcedMarch?` | цепочки и постоянные приказы флотов |
| `strikes?`, `strikeSeq?`, `squadronSeq?` | удары шаттлов в полёте; счётчики ударов и эскадрилий |
| `minefields?`, `ordnance?`, `salvage?` | минные поля; ракетные мины и ракеты; трофеи идущего боя |
| `pve?`, `missionFacts?` | волны PvE; факты для задач забега: удержание, потери, эвакуация |
| `extraction?`, `operation?`, `captive?`, `allyOps?` | сценарии глав Sector Zero |
| `swarmMemory?`, `swarmAdapts?`, `swarmRecipes?`, `swarmNet?` | память, рост модулей и сеть Роя |
| `swarmIntel?`, `swarmJournal?` | что о Рое знает каждый игрок: виденные составы, журнал ответов |

- **Только JSON**: без `Map`, `Date`, классов и функций; с `DATABASE_URL` — в `matches.state jsonb`.
- **`version`** — пин правил партии: кто и где его сверяет — §2, пробел хоста игроков — §9.
- **Клиенту** — проекция `visibleState`: без `rng`, `fog`, `salvage`, счётчиков id и памяти Роя;
  чужие казна, сеть агентов, исследования, герои и приказы срезаны.

## 5. Модули ядра

54 модуля в `packages/shared-core/src/modules`, по файлу на механику; порядок исполнения —
`DEV_MODULES` (`packages/server/src/scenario.ts`), счётчики сборок — §9. Модули не импортируют
друг друга: события, хуки и возможности, а без модуля работает базовый дефолт
([modulesystem.md](modulesystem.md)). События и хуки по модулям — [CODE-MAP.md](../CODE-MAP.md).

- **Приказы.** Модули обрабатывают 79 типов действий, игрок может прислать 68: у каждого есть
  zod-схема в `actionPayloadSchemas` (`packages/shared-core/src/actions/payloadSchemas.ts`),
  тип без схемы гейт `@void/action-layer` отклоняет с `E_BAD_PAYLOAD`. Остальные 11 подаёт
  сам хост: `seat.*`, `arsenal.sync`, `chain.stamp`, `steward.report`, `pve.abandon`,
  `pve.supply`, `swarm.adapt`, `fleet.premiumRepair`.
- **Отказ** — `h.reject('E_…')` со стабильным кодом; брошенное исключение становится `E_INTERNAL`.
- **Хуки-значения**: `economy.production`, `fleet.speed`, `combat.damage` (и `.parallel`),
  `combat.mitigation`, `construction.requirement`, `research.slots`, `salvage.share` и другие.

**Экономика и торговля.**
- `economy` — доход миров и содержание войск по формуле за отрезок `time.advanced`.
- `tax` — налог с обитаемых миров, убывающий с ростом державы; `sprawl` — сверх порога
  провинций слабеет всё хозяйство державы.
- `salvage` — победителям боя доля стоимости погибших обеих сторон; `effects` — правила
  `data/events.json` (§2).
- `market` — книга заявок партии с эскроу (`market.list/take/cancel`); `trader` — торговец
  забега, цена отвечает на сделки (`trader.buy/sell/swap`).
- **Цены основной игры** — `util/pricing.ts`, решение владельца 2026-10-18. Каталог общий с
  Sector Zero, поэтому дорожает партия: шесть карт основной игры объявляют `pricing`
  (кредиты ×3, металл ×1,5, микроэлектроника ×2, сроки ×2, стартовый запас ×1,5–2), посев
  кладёт его в `GameState.pricing`. Одно правило `matchCost`/`matchHours` читают ядро, окна и
  бот; нет поля — цены каталога. Ремонт и содержание не множатся.

**Мир, стройка, наука.**
- `sector`, `planet-type`, `faction` — бонусы местности, типа планеты и фракции через хуки.
- `capital` — столица и место возрождения героев (`capital.designate`); `visibility` — память
  тумана: последний виденный снимок мира и тип провинции, чью границу пересёк корабль игрока
  (`surveyed`, проекция отдаёт игроку только его записи).
- `construction` — `building.construct/upgrade`, `unit.build`, `construction.cancel/resume`:
  оплата вперёд, готовность событием `construction.complete`; возможность `building.damage` —
  прицельный урон по выбранным постройкам (им бьёт саботаж шпиона).
- `technology` — `technology.research/boost`; урон боевой ветки идёт только своему каналу огня;
  возможность `technology.grant` выдаёт технологию мимо лаборатории (кража исследований).
  `scientist` — учёные, выбранные местом на старте; «+слот» идёт хуком `research.slots`.
- `arsenal-sync` — сервер обновляет, что место может строить; `promotion` — изредка партия
  выходит «отмеченной»; `veteran` — надбавка за пережитые бои.

**Флоты.**
- `movement` — `fleet.move/stop`: путь Дейкстрой по линиям, остановка в любой точке линии.
- `fleet-ops` — `fleet.launch/merge/split/engage`; `auto-merge` — прибывший флот вливается в
  стоявший свой; `auto-rally` — построенный корабль уходит в флот сбора (`rally.point`).
- `capture-on-arrival` — свободный узел берётся прилётом; `army` — `army.load/unload`:
  наземные войска ездят только грузом флота.
- `forced-march` — `fleet.forcemarch`: +50% скорости, износ 5% корпуса в час пути;
  `fleet-repair` — `fleet.repair` за металл в своём доке; `instant-repair` — за кредиты.
- `standing-orders` — `order.auto` (автоштурм), `order.retreat` (автоотход), `order.chain`;
  `steward` — `steward.delegate/recall/holdpoint`: место ведёт ИИ, пока игрок офлайн.

**Бой.**
- `combat` — `battle.attack/retreat`, `fleet.assault/retreat`: раунд раз в игровой час, фазы
  `orbital` и `ground`, штурм с высадкой, захват мира.
- `intercept` — встречи флотов на линиях и дорогах; без него бой бывает только в узлах.
- `orbital` — `fleet.orbit/bombard`: одна орбита, бомбардировка и ПКО (залп орбитальных
  батарей раз в час, ближних зениток — раз в 15 минут). Орбита есть у видов с `orbit` в
  `data/sectorKinds.json`: `planet`, `void_station`, `pirate_base`, `neutral_base`.
- `station` — `station.deploy`: свой узел без планеты становится крепостью `void_station`.
- `minefield` — `fleet.layMines`, мина — неподвижный отряд в `fleets`; `rocketMines` —
  `fleet.deployRocketMine`, `rocketMine.mode/disarm`.
- `shuttle` — 10 приказов `shuttle.*`: шаттлы стоят в космопорте мира и бьют от своего узла.
- `loadoutEffects` — модули кораблей, которые меняют правило, а не число корпуса.

**Герои, дипломатия, места.**
- `hero` — `hero.spawn`, `hero.ability` (один диспетчер способностей из данных),
  `hero.skill.unlock`, `hero.equip/unequip`, `hero.install/uninstall`; `heroEffects` — эффекты
  `hero.effect.*`: `aura`, `decoy`, `jump`, `recall`, `reveal`.
- `diplomacy` — `diplomacy.declare/mapshare/decline`: к войне — сразу, к миру — по согласию
  (возможность `diplomacy.declareWar` — та же эскалация по раскрытию шпиона),
  от чужого предложения можно отказаться; `coalition.create/leave/edit` — коалиция как
  сущность (`state/coalition.ts`): активный человек вне командного режима создаёт её один,
  принятый союз создаёт её или вводит в неё. Одиночка сохраняется, пустая распускается;
  уходящий основатель передаёт подпись первому оставшемуся по id. Вместимость — 15% мест
  карты, не меньше двух (карта на 20 — 3), сверх неё ядро отбивает `E_COALITION_FULL`;
  `espionage` — `espionage.spy { planetId, op }`: агент уходит на МИР, операция длится 12 ч и
  решается против того, кто владеет миром в этот час; разведка (`recon`) открывает окно на
  мир на 24 ч, саботаж (`sabotage`) бьёт 3–5 построек на 10–20% прочности, кража (`theft`)
  уносит 5–15% одного ресурса владельца, не больше 500, кража исследований (`research`) даёт
  технологию, которую владелец изучил, а вор нет (сеть из 3 агентов); раскрытый агент гибнет с шансом 0.5; бюро контрразведки (`spyDetectBonus`/`spyKillBonus`
  здания) поднимает жертве шанс раскрыть шпиона и убить раскрытого; контрразведчик
  (`counter`, отзыв — `espionage.recall`) стоит на мире до отзыва и усиливает раскрытие;
  раскрытая операция объявляет войну владельцу мира и хозяину шпиона.
- `seatClaim` — `seat.claim/confirm/kick/release`: место в идущей сетевой партии.

**PvE и Sector Zero.**
- `pve` — волны NPC-врага; включается режимом с секцией `pve` в `data/modes.json`.
- Рой: `fleetBrood` (десант растёт на корабле), `swarmMemory`, `swarmAdapt`, `swarmJournal`,
  `swarmNet` — что Рой узнал боем, как усиливает модули и как знание идёт по связи.
- Главы: `rendezvous` (союзник глав IV–VI), `extraction` (архив главы IV), `operation`
  (контракт глав V–VI), `captive` (пленный главы V), `missionFacts` (факты для задач забега).
- `victory` — господство на карте, выбывание, лимит очков, таймаут; хук `victory.score`. Режим со `victory.scripted` (полигон, TRN-3) гонок не судит: исход объявляет сценарий хоста, остаётся только предел сессии.

**Туман — граница безопасности.** `visibleState` (`state/visibility.ts`) режет мир до того,
что видит игрок; сервер шлёт каждому дельты своей проекции (§4).

## 6. Данные (`data/*.json`, версия `0.1.66`)

Контент — данные: новая сущность или число — правка JSON, а не кода (скилл `add-game-content`).
Имя в JSON английское, текст — ключ `data.<слаг>` в обеих локалях (`prototype/src/i18n.test.ts`).

| Фрагмент бандла `GameData` | Что в нём | Записей |
| --- | --- | --: |
| `units` | корабли и наземка домов, флагман, Рой, пираты, служебные (мины, ракета) | 35 |
| `technologies` | технологии; 6 из них только выдаются (`grantOnly`) | 54 |
| `buildings` `modules` `factions` `scientists` | постройки, модули, фракции, учёные | 25·21·7·7 |
| `heroes` и ещё 4 `hero*` | архетипы, способности, пассивки, узлы дерева, грейды | 6·12·13·19·4 |
| `sectorKinds` `sectors` `planetTypes` | виды узлов, местность, типы планет | 17·11·12 |
| `modes` `events` `resources` | режимы, правила событий, ресурсы | 8·6·6 |
| `sectorZeroShop` `sectorZeroStars` | Sector Zero: предложения магазина, ступени звёзд | 18·6 |
| `rewards` `medalGrades` `veteran` `promotion` `market` | XP за партию, ветеран, биржа | — |

- **Сборка.** Список фрагментов один — `composeGameDataBundle`
  (`packages/shared-core/src/data/loadGameData.ts`), разбор — `parseGameData` (zod).
  `packages/server` читает фрагменты с диска, браузерам и хосту игроков их вшивает сборщик через
  `data/bundle.ts`. У большинства каталогов дефолт `{}`: пропавший фрагмент не роняет загрузку, а
  пустеет — ловит `data/bundle.test.ts`. Форму и ссылки держит `schemas.test.ts`, поведение
  контента — 44 теста `data/*.test.ts`. Вне бандла — серверные `starterArsenal`, `dropTables`,
  `metaEconomy`, `medals`, `corpBuildings` (§8): своя проверка, кривой файл — отказ запуска.
- **Пин.** Партия хранит `version.data` и отпечаток бандла `version.dataHash`; сверка — §2.
- **Как менять.** Правка бандла — `version` в `data/manifest.json`, пин в `schemas.test.ts` (гейт)
  и заголовок раздела. Новый фрагмент: `GameDataSchema`, `composeGameDataBundle`, `data/bundle.ts`.
- **Карты `data/maps`.** Основная игра (`techRules.ruleset: main`): `duel-1` (2 места, 19
  провинций), `ffa-4` (4/31), `team-2v2` (4/85), `team-3v3` (6/121), `ffa-20` (20/320),
  `ffa-50` (50/800). Sector Zero — `training-1` и главы `pve-1`…`pve-6` (`pve_waves`, 10 волн).
  Пул AvA — `ava-duel-1`, `ava-2v2-1`. Служебные — `proving-ground` (скрытый «Полигон»),
  `duel-testbed`, `skirmish-1`; `data/frontier-50|100.json` — снятый «Фронтир» для старых партий.
- **Цены основной игры** — поле `pricing` её шести карт, одно на все; правило — §5.
- **Баланс** — [balance-history.md](balance-history.md); основную игру меряют окном 28 дней.

## 7. Прототип (`prototype/`)

Клиент, в который играют игроки (§1): соло, сетевая партия и Sector Zero — один код, сборки
различают флаги `__PLAYER_BUILD__` и `__SECTOR_ZERO_ONLY__`.

**Сборка и страницы.**
- `pnpm run prototype` (`prototype/build.mjs`) пишет в `prototype/dist/` дев `void-dominion.html`,
  `void-dominion-player.html`, `void-dominion-admin.html`, `sector-zero.html` и его дев-вариант,
  `served/`, `yandex/`; в сборке игрока (`__PLAYER_BUILD__`) нет тест-режима, песочницы, дев-забега.
- Хост `prototype/netserver.ts`: игрок на `/` и `/game/:matchId`, дев на `/dev`; из `dist/served/`
  арт идёт файлами `/assets/<имя>`, однофайловые HTML открываются с диска и едут в APK.
- `src/bootstrap.ts` до импорта `main.ts` поднимает площадку, ставит её язык и флаги баланса;
  плашка и окно «игра в разработке» — `#dev-badge`, `#dev-notice` (`decisions/devNotice.ts`).

**Карта и рендер.**
- Кадр — `frame()` в `prototype/src/main.ts`; карта разложена по `map*.ts`: `mapCamera`, `mapInput`,
  `mapFog` (зрение и разведка), `mapWorlds`, `mapFleets`, слои `mapOverlays`/`mapAim`/`mapEffects`.
- Рисование общее с `packages/client/src` (его импортируют 36 файлов `prototype/src`): провинции —
  power diagram (`territory.ts`, кэш `territoryGeometry.ts`), `holoDraw.ts`, LOD `mapLod.ts`.
- Политическая карта печётся в offscreen-холст (`mapLayer.ts`, правила —
  `decisions/mapLayerView.ts`): пан сдвигает выпечку, зум растягивает, чёткость — фоновой
  перепечкой полосами. До первого кадра заставка `mapLoading.ts` готовит карту порциями.
- Местность — общая среда в мировых координатах (`decisions/terrainEnvironment.ts`); правило —
  [map-visual-continuity-rule.md](map-visual-continuity-rule.md).
- Разведанный мир вне обзора рисуется по снимку памяти тем же рисунком, что вживую, только
  приглушённым и неподвижным, с пометкой «старые данные» (`decisions/worldLook.ts`). Неопознанная
  провинция, где побывал корабль, подписывает у знака «?» свой тип.
- Корабль — контур по фракции владельца и id юнита (`shipGlyphs.ts`), флот — силуэт доминанта с
  плашкой числа (`decisions/fleetTally.ts`); портреты WebP — `shipArt.ts`, `prototype/art/`.
- Кадр жеста не мусорит в куче холста: слои флотов и миров держат один `save()` на слой, блоки
  на объект возвращают свойства руками, ширины текста берутся из кэша (`fleetCountBadge.ts`).
  С `save()` на каждый флот мусор при быстром зуме рос быстрее, чем слабый телефон его убирал,
  и вкладка падала. Свежесть выпечки карты кадр сверяет номером знания игрока о мирах
  (`staticLayerCache.ts`), а не строкой по всем мирам.

**Окна и HUD.**
- `main.ts` — хозяин мира и проводки; интерфейс разнесён по модулям `init*(host)` (больше 80) с
  чистыми `*Html`, состояние им даёт `main.ts` хуками. Окно боя — `battleScreen.ts`, прогноз —
  `decisions/battleForecast.ts`, урон и бафы — `packages/shared-core/src/state/battleReadout.ts`.
- Боковая панель выбора — `sidePanel.ts` (REFM-225): чья карточка открыта, лист с кэшем и
  дверью перерисовки, живые сроки, досье, нажатия по листу, окно деления, подъём камеры на телефоне.
- Жизненный цикл матча — `matchLifecycle.ts` (REFM-219): установка любой партии гасит
  состояние прошлой дверями владельцев, запуски схватки, забега, полигонов и сетевой партии,
  выход одной дверью `leaveMatch`, уход с итогового экрана, ⌂ и «Покинуть сессию».
- От 720 px — голографическая консоль ПК и планшета (`holographicUi.ts`, `holographic.css`,
  `bridge-shell.css`; окна переносит `floatingWindows.ts`, масштаб — `decisions/pcScale.ts`).
  Уже 720 px или ниже 520 px на сенсорном — телефон: `mobileHud.ts`, `mobile-*.css`.
- Телефон: нижняя панель «Карта · три окна на выбор · Ещё» (`decisions/phoneNav.ts`), скорость
  одной кнопкой (`decisions/phoneSpeed.ts`), приказ — черновик цели и отправка (`mobileOrders.ts`).
  Свой мир с одним своим флотом — одна карточка с вкладками «Флот» / «Мир», открытая на
  вкладке прошлого раза (`decisions/worldFleetTabs.ts`, `worldFleetCard.ts`).
- Открытие чатов, справочника, меток, аукциона и форм аккаунта не ставит фокус в поле ввода:
  клавиатуру вызывает нажатие на поле. Enter между полями и фокус на ошибке формы сохранены.
- Клавиши ПК по `KeyboardEvent.code` — `decisions/hotkeys.ts` и `pcHotkeys.ts`. Back и Escape:
  стопка слоёв — `backLayers.ts`, Back без слоёв (предупредить, выйти вторым) — `backGesture.ts`.
- Вид: текст 12/14/16/20 px (`typeScale` в `packages/client/src/theme.ts` = `--fs-*` в
  `prototype/build.mjs`), кнопки `.btn-main`/`.btn-second`/`.btn-quiet`/`.btn-x`. Палитра
  `--sf-*` — копия `surfaceTheme` из того же `theme.ts`, равенство держит `surfaceTokens.test.ts`.
- Хаб: вкладки Домой, Игры, Арсенал, Корпорация, Ещё; дверь — `decisions/hubDoor.ts`.
  На телефоне бренд собран в компактную строку высотой 36 px при обычном размере текста.
  На «Домой» —
  лента новостей `newsScreen.ts` (решения — `decisions/newsFeed.ts`): на широкой панели
  колонкой рядом с партиями, на узкой — превью под дверью и вся лента шторкой. Арсенал
  (`arsenalScreen.ts`, решения — `decisions/arsenalView.ts`): модули и корабли с недостающими,
  цель мастерской, сборка и разбор, способы получить модуль с шансами наград; на телефоне
  карточка открывается шторкой. «Снабжение» (материалы, сезон) и аукцион —
  `metaEconomyScreen.ts`, `metaMarketScreen.ts`, общая сессия экономики — `metaEconomyClient.ts`.
  «Магазин» (`shopScreen.ts`, решения — `decisions/shopView.ts`): Суверены, Премиум, Модули,
  Материалы; покупка за ◆, пакеты ◆ ждут провайдера оплаты.
  «Корпорация» (`corpHubView.ts`, решения — `decisions/corpHub.ts`, `corpBase.ts`,
  `corpMembers.ts`, `corpTreasury.ts`): База (голограммы зданий `corpSprites.ts`, лист здания
  шторкой), Битвы, Состав, Казна; без корпорации — создание и список с заявкой. Окно
  корпорации в партии — `corpScreen.ts`, 7 вкладок; постройки — `data/corpBuildings.json`.
- «Производство» (`shipyard.ts`): Корабли, Поддержка, Шаттлы, Пехота, Техника, Герои; отсеки —
  `packages/client/src/loadoutEditor.ts` и `decisions/slotCallouts.ts`. «Герои» — `heroStaff.ts`:
  `hero.spawn`, `hero.ability`, `hero.skill.unlock`, `hero.equip/unequip`, `hero.install/uninstall`.
- Флот: карточка `fleetCard.ts`, десант «кого и сколько» `troopsMenu.ts`, цепочка «◎ Приказ»
  `chainPlanner.ts` (`order.chain`); шаттлы — ангар `hangarPanel.ts`, эскадры `squadronPanel.ts`.
- «Коалиции» (`coalitionWindow.ts`): «Создать коалицию» отправляет `coalition.create`;
  карточка с эмблемой и описанием открывается после принятого состояния. Доступность —
  `decisions/coalitionCreation.ts`; на телефоне окно доступно через «Ещё».
- Обучение: подсветка `spotlight.ts`, гайд-матч без ботов на ×300 (`firstMatchTour.ts`,
  чек-лист `firstGoals.ts`): шахта → исследование → фрегат → свободный сектор.
  Подсветка карточек/карты, «Показать», сворачивание, повтор без повторной награды;
  подробности — [ONB-12](onboarding-roadmap.md). Полигон Sector Zero (`trainingTour.ts`) ведёт
  по 12 этапам до штурма цели, подсвечивает команды и ставит часы на паузу при выборе действия;
  ожидание результата идёт в реальном ядре. 10 разовых вводных `intros.ts`. Сводка «пока тебя не было» —
  `buildRecap` (`packages/shared-core/src/util/recap.ts`) над лентой `eventFeed.ts`.
  Проводка — у двух владельцев (REFM-221): `guideFlow.ts` держит лаунчер туров, флаг
  пройденного обучения, гайд-матч и список целей; `helpCenter.ts` — справочник с поиском,
  карточку корабля, вводные и сводку.
- Слово-термин (`termTip.ts`) открывает статью `GLOSSARY` справочника (`codexIndex.ts`).

**Соло и ИИ.**
- Ядро в браузере: `protoKernel.ts` `MODULES` — весь каталог плюс `hunger.ts` и `botDiplomacy.ts`;
  ИИ мест — `ai.ts`; карты — `mapCatalog.ts` (`MAP_IDS`; `nexus`, `frontier-*` — для старых).
- Соло-мир шагает в кадре (поток `simWorker.ts` — лишь дев-флаг `?sim=worker`): ядро, затем
  `soloDrivers.ts` — ИИ, авто-штурм, сведение флотов, авто-отход, цепочки; отлучку не догоняет.
- ИИ ходит раз в 2 игровых часа со сдвигом фаз мест (`StaggeredAi`, `aiScheduler.ts`): кадр
  строит один план, выдаёт до 32 порций; зависимая пара приказов — одна порция (`aiOrderSlices.ts`).
- Базы `pirate_base`/`neutral_base` ведёт ИИ своих NPC `npc-<узел>` (`matchSetup.ts`), без мест.
- Схватка сохраняется в слот `void.solo.v1` (`soloCheckpoint.ts`, формат — `decisions/soloSave.ts`)
  раз в 15 с и при уходе со страницы; сеть, PvE и песочница слот не пишут.

**Сеть (netserver).**
- Партия хоста — `createHostedMatch`; на старте список из стора (`bootRoster`), новая —
  `hostNewMatch`, до 64 на процесс. Сокет и переподключение в клиенте — `netSession.ts`.
- Остановка закрывает HTTP/WS и таймеры, ждёт начатые действия/обновления арсенала и
  запись снимка; `snapshotWriter.ts` затем сохраняет свежий мир и результаты ботов до
  закрытия БД. Ошибка финальной записи даёт ненулевой выход, не отменяя попытки сохранить другие комнаты.
- Номер партии — 8 цифр (`packages/server/src/matchId.ts`, `decisions/matchNumber.ts`), адрес
  `/game/<id>` (`decisions/matchAddress.ts`); вход — экран `#setup` в сетевом режиме
  (`matchJoin.ts`); «Мои партии» — `decisions/myMatches.ts`, отказ по ссылке — `joinLanding.ts`.
  Кнопка «Описание» в ленте и «Моих партиях» открывает `matchDescription.ts`: параметры и
  фактические условия победы с сервера, без занятия места; закрывается также Escape и Back.
- Хост гонит тот же `StaggeredAi` при подключённых людях или постоянных ботах, с паузой
  16 мс между порциями; один план либо связка приказов за порцию. Неактивные места не
  получают отдельных порций, пропущенные циклы не накапливаются.
- Постоянные боты: 100 профилей с разными латинскими никами без общего префикса
  (`botNicknames.ts`, `botRoster.ts`); старые имена и места переименовываются атомарно,
  без потери опыта/истории. Ники зарезервированы от регистрации. Опциональное заполнение
  PvP-партий (`botPopulation.ts`, `BOT_FILL_PERCENT=0`, `BOT_ACTIVE_LIMIT=20`).
  При включении 35%: 20 мест → максимум 7, с округлением вниз. По одному через 5–15
  реальных минут, без пачки после рестарта, только пока открыт вход. Выбывшие входят в лимит.
  Один профиль — одна активная партия; PvE/фиксированные команды исключены.
  В публичном профиле нет отметки ИИ; опыт/прогресс/10 последних результатов — из завершённых партий.
  Назначения и результаты сохраняются в PostgreSQL; восстановление и начисления идемпотентны.
  Прерванная концом матча посадка освобождается без выдуманного результата; опыт выдаётся
  только при подтверждённом владении местом, пустые отменённые резервы не остаются активными.
- Стиль постоянного бота устойчиво определяется его seed: экспансия, активная оборона или
  экономика (`prototype/src/botBehavior.ts`). `botSocial.ts` отвечает короткими английскими
  репликами: индивидуальное окно 5 минут за 90, пауза 12–45 секунд и ограничения частоты.
  Чужой/нераспознанный язык вызывает просьбу писать по-английски; отношения меняются
  только по явным английским предложениям через обычную дипломатию и приватный чат.
  Завершение матча, кик и отзыв доступа отменяют отложенный ответ.
- В комнате без людей один таймер ждёт ближайшее решение активного бота либо событие мира,
  а не опрашивает все места карты. Нет активного ИИ — нет дополнительного пробуждения.
  Планировщик сохраняет фазы мест при подключениях. Порядок внедрения и границы замера —
  [эксплуатация](../deploy/README.md#постоянные-боты-для-заполнения-карт).
- Корпорации — `registerCorpApi` с `features: { ava: false, medals: false }`.
- Правила ввода аккаунтов у сервера и обоих клиентов — `packages/protocol/src/inputPolicy.ts`.
  Формы прототипа выделяют неверные поля через `formFeedback.ts`: требования пароля,
  несовпадение повтора и занятый ник; исправление соответствующего поля снимает ошибку.

**Sector Zero и прогресс между забегами.**
- Хозяева: `sectorZeroShell.ts` (меню, подготовка, магазин, ролики, комиксы, карточка ухода
  из забега, инструменты экрана), `sectorRun.ts` (забег, засчёт, «Продолжить», разметка
  геймплея для площадки, пауза, задачи и цепочка главы), `sectorProfile.ts` (профиль, облако,
  вкладка-хозяйка).
- Профиль `sector-zero.progress.v1` с печатью (`decisions/profileSeal.ts`), правила —
  `decisions/sectorZeroProgress.ts` (полка `shelf`, снимок в забег `prepareSectorZeroRun`);
  заточка детерминирована (`decisions/sectorZeroForge.ts`), витрина — `decisions/sectorZeroShop.ts`.
- Забег: снимок `void.run.v1` и дескриптор `void.run.portable.v1` запечатаны для сида профиля
  (`decisions/runSeal.ts`); неподписанные старые забеги не продолжаются, засчитанный прогресс
  сохраняется. Журнал конца удаляется только после подтверждённой записи основной копии
  профиля; при отказе меню повторяет идемпотентный расчёт и не оживляет завершённый мир.
  Если профиль ещё не записался ни в основную копию, ни в тень, проверенная печать полного
  снимка восстанавливает его сид и позволяет засчитать первую попытку после перезагрузки.
  «Идёт» меняет только `setRunActive`; спрятанное — `decisions/sectorZeroTools.ts`.
- В игру принимаются только целые подписанные профиль или тень. Неподписанный исходник
  резервируется в `sector-zero.progress.unverified.v1`; без подтверждения резервной записи
  основная не заменяется. Его баланс не переносится в игру/облако. Облачный конверт
  запечатан целиком; из старого конверта принимается только подписанный профиль без забега.

**Площадки: Яндекс Игры, APK, RuStore.**
- Контракт `GamePlatform` (`src/platform/types.ts`), адаптеры `web.ts` и `yandex.ts`; `host.ts`
  берёт Яндекс, только если поднят лоадер SDK, иначе и при сбое SDK — веб.
- Архив `dist/yandex/` (`platformBuild.mjs`, `__SECTOR_ZERO_ONLY__`) — только Sector Zero и один
  язык; реклама только rewarded (`decisions/adPlacements.ts`), облако — `decisions/cloudSync.ts`.
- APK — Capacitor (`mobile/`), ленты `alpha` и `player` в `android.yml`; RuStore — `rustore.yml`,
  выпуск закрыт до решений оператора ([rustore-preparation.md](security/rustore-preparation.md)).

**Локализация, пульт, телеметрия.**
- Рантайм `localization/core.ts`, прототип берёт `runtime.ts` (все языки), локали `ru` и `en`.
  Гейт — `prototype/src/i18n.test.ts` и `localization/canon.test.ts`.
- Пульт `src/admin.ts` — своя сборка на `/admin` (только с `ADMIN_LOGINS`): состав партии и «Снять».
- События `TELEMETRY_EVENTS` (`packages/protocol/src/telemetry.ts`) уходят в `POST /telemetry`
  (`playtest-logs/client-*.jsonl`); сводка — `pnpm run analytics`.
- Авторизованный foreground pulse и union интервалов дают уникальные аккаунты/время по
  суткам UTC; источник `/metrics/activity`, экран Grafana `/d/moongame-player-activity`.
  30-дневное хранение, erasure и точность — [runbook](../deploy/observability/PLAYER-ACTIVITY.md).

**Харнесы и проверки.**
- `prototype/uitest.mjs` (настоящий бандл на фейковом DOM/canvas) идёт в гейте через
  `entryFlow.test.ts`.
- `pnpm smoke:*` — Chromium-харнесы на общей `harnessKit.mjs` (`smoke:all` — 19): `startup`,
  `bootfail` (экран `E_CLIENT_STARTUP`), `mobile`, `sizes` (порог `sizeBaseline.json`), `aloft`…
  Семь из них (`smoke:yandex`, `smoke:net`…) идут в CI, не блокируя.
- Перф: `pnpm run perf` (`perf.mjs`, CPU кадра на фейковом canvas; `PERF_STRICT=1` — порог p95),
  `pnpm perf:pan` (`panperf.mjs`, настоящий canvas), `motionperf.mjs`.

## 8. Метаигра (north-star)

Замысел — [metagame.md](metagame.md): обычные партии плюс AvA корпораций за сектора галактики;
мета-карты нет. Мета-слой — сервер; хост игроков включает его с учётками (`AUTH_JWT_SECRET`).

| Срез | Код (`packages/server/src`) | Хост игроков |
| --- | --- | --- |
| Корпорации: роли, влияние, стройка | `corpService.ts`, `corpConstruction.ts` | вкл. |
| Лента новостей: жизнь корпораций, битвы, объявления администратора | `corpNews.ts`, `newsApi.ts`, `newsScreen.ts` | вкл. (`GET /news`, «Домой» в хабе) |
| Арсенал: стартовый набор, дроп, гейт `E_NOT_OWNED` | `mainGameArsenal.ts`, `arsenal.ts` | вкл. |
| Мета-экономика: материалы, крафт, выплаты, сезон, Суверены, витрина за ◆, перки премиума | `metaEconomy*.ts` | вкл. |
| Аукцион `MetaMarket`: комиссия 8%, до 20 лотов | `metaMarket.ts` | вкл., от 100 XP |
| Сессионная AvA, медали, аренда корп-арсенала | `avaService.ts`, `medalService.ts` и др. | выкл. |
| Магазин Commerce: 4 товара и 6 пакетов Суверенов, провайдеров нет | `commerceMain.ts`, свой процесс и БД | недоступны |

- AvA ([corporation-wars.md](corporation-wars.md)) и медали монтируют только `main.ts` пакета
  сервера и процесс корпораций ([corporation-service.md](corporation-service.md)). Там битва
  проходит путь от вызова до итога: партия идёт по своим часам, победу решает сумма очков
  стороны (сквозной тест `avaBattle.test.ts`).
- Этапы партии платят накопительно 25% и 50% бюджета (очки участия и 3 / 7 дней своих приказов),
  финал — остаток, бонус места, дроп; сезон «Пограничный флот» ([meta-economy.md](meta-economy.md)).
- Решение владельца 2026-10-12: дальнейший разнос на сервисы, staff-сервис и SIEM — на паузе
  до живых игроков ([release-path.md](release-path.md)).

## 9. Статус

Готовность по этапам и продуктам — [readiness.md](readiness.md), путь к выпуску —
[release-path.md](release-path.md). Здесь — состав ядра и технические долги.

**54 модуля** на микроядре: столько файлов в `packages/shared-core/src/modules` (без тестов).
Оба хоста собирают весь каталог; прототип сверх него грузит два своих модуля из
`prototype/src` (`hunger`, `botDiplomacy`): в ядре их нет, и серверу они не нужны.

| Сборка | Модулей | Состав |
| --- | --: | --- |
| `DEV_MODULES` (канонический сервер, `scenario.ts`) | **54** | весь каталог ядра |
| `MODULES` (ядро прототипа, `protoKernel.ts`) | **56** | каталог + `hunger`, `botDiplomacy` |

§9 — единственный дом этих чисел: `scripts/docs-check.mjs` сверяет их с кодом (файлы каталога,
закреплённый список `moduleManifest.test.ts`, массив `MODULES`), другие доки ссылаются сюда.
Состав и порядок `DEV_MODULES` — инвариант 6: правка без подъёма `MODULE_MANIFEST_VERSION`
(`scenario.ts`) роняет `moduleManifest.test.ts`. У `MODULES` прототипа такого сторожа нет.

### ⚠️ Известные стопгапы и долги

- **Прото-хост не сверяет правила сохранённой партии.** `prototype/netserver.ts` поднимает
  партию из стора без проверок `createMatchLoader` (`serverWiring.ts`): хэш данных и версия
  манифеста не сравниваются, а версию манифеста прототип не ведёт (`newGame` в
  `matchSetup.ts` пишет `manifest: '1'`). Деплой с другим составом модулей или данными молча
  доиграет идущие партии по новым правилам. Соло-сохранение такую сверку делает
  (`soloCheckpoint.ts`).
- **Режим сетевой партии игроку не выбрать (GM-0.3 ⏳).** Прото-хост принимает `modeId` в
  `POST /matches` и сверяет с `data.modes`, но клиент шлёт только `{ mapId }` (`main.ts`).
- **`teamFormat` пресетов режима никто не читает** — поле есть только в схеме (`schemas.ts`).
  Стороны сетевой партии задаёт карта каталога, а на «Нексусе» — env `TEAMS` (`matchSetup.ts`).
- **id модулей ядра в двух стилях:** десять в camelCase (`heroEffects`, `seatClaim`,
  `fleetBrood`, `swarm*`, `rocketMines`…), остальные — kebab-case. Переименование — это подъём
  `MODULE_MANIFEST_VERSION` и отказ поднимать сохранённые партии, поэтому стиль не выравнивают.
- **Браузерные роботы в CI не блокируют** (`continue-on-error`, сбой виден аннотацией, §10).
- **`pnpm run audit` мёртв:** npm закрыл audit-эндпоинты, а скрипт остался в `package.json`.
  Зависимости проверяет OSV-Scanner в `ci.yml`.
- Продуктовые пробелы (push, баланс основной игры, два клиента, аналитика, эксплуатация) —
  «Главные пробелы» в [readiness.md](readiness.md).

## 10. Команды и качество

Гейт `pnpm run check` = `lint` + `typecheck` (пакеты, затем `tsc -p prototype`) + `test` +
`docs-check`; его же гоняет хук `.githooks/pre-push`. Счётчик тестов — в шапке.

```bash
pnpm test               # Vitest; test:watch, test:coverage
pnpm run prototype      # prototype/dist: dev/player HTML, Sector Zero, served/, yandex/, админка
pnpm run site           # сборка + stage-site.mjs → prototype/dist/site (Cloudflare, GAME_SERVER)
pnpm run host           # прото-сервер с клиентом для теста в LAN; doctor — виден ли порт снаружи
pnpm run dev:server     # канонический сервер; dev:proto-server — прото-сервер; stack — Compose
pnpm run rehearsal      # WS-репетиция: гейт, дубли, реконнект, рестарт, туман, хэш (env PLAYERS…)
pnpm run perf           # цена кадра рендера headless (PERF_STRICT=1 — с порогом); perf:pan
pnpm run selfplay       # баланс AI-vs-AI на ядре (ниже); meritscan — заслуга ветерана
pnpm run metrics        # отчёт по журналу матча; analytics — поведение тестеров сетевого теста
pnpm run smoke:<имя>    # 23 браузерных робота, smoke:all — 19 из них; ui:shot — снимок экрана
```

**`docs-check`** сверяет: ссылки на md-файлы (кроме `docs/reviews/` и `docs/archive/`); зоны,
статусы и `🔒(ID)` кирпичей в бэклоге и роадмапах; счётчики модулей §9 с кодом;
`docs/bricks-index.md` и `docs/index.md` с генерацией (`--write-index`); что на каждый док
`docs/` ссылается живой док.

**Тесты.** Юнит — рядом с кодом (`*.test.ts`, `*.test.mjs`; охват — `vitest.config.ts`),
Postgres-контракты — только при `DATABASE_URL`. Property/fuzz-слой ядра (fast-check,
`testkit/arbitraries.ts`, падение печатает seed) — четыре `*.property.test.ts`: `applyAction`
(fail-secure, чистота), `advanceTo` (разбиение интервала: бит-в-бит на дискретном ядре,
coarse ≈ fine на полном стеке), `delta` (`applyDelta∘diffState = id`), `economyConservation`
(на узком наборе действий ресурсы с эскроу не растут). Детерминизм: golden `rng.test.ts`,
`hash.test.ts`, `replayDeterminism.test.ts` (живая комната → реплей → тот же `hashState`).

**CI** — разбор в [security/pipeline.md](security/pipeline.md):
- `ci.yml` (push не в `main`, PR, очередь): гейт и OSV-Scanner блокируют, `perf` и 7 смоуков — нет.
- `security.yml`: 16 сканеров и сводка, блокируют Semgrep, Gitleaks, OSV, Trivy fs/image; крон.
- `image.yml` (push в `main`): образы сервера и Caddy → проверки → GHCR → подпись cosign.
- `automerge.yml`: зелёный PR сам встаёт в merge queue — руками не включать.
- `pages.yml`: GitHub Pages с `main`; `android.yml`: два APK, dev и player.
- `rustore.yml` (вручную): кандидат под RuStore без публикации; `rustore-smoke.yml` — на PR.

**Баланс.** `pnpm run selfplay N сид дней карта` (по умолчанию 20, `sp`, 14 дней, «Нексус»;
карта — `duel-1` или `ffa-4`): боты профиля `strong`; победы по слоту, фракции и старту,
длина, snowball, мёртвый контент, неисследованные техи, строка `SELFPLAY_JSON`. Прибор меряет
то, что умеет сильный бот, а не игру. Основную игру с ценами партии мерят окном 28 дней:
`pnpm run selfplay 120 base 28 duel-1`. История замеров — [balance-history.md](balance-history.md),
порядок разбора — скилл `balance-analysis`.

## 11. Как возобновить работу

1. Прочитать корневой [CLAUDE.md](../CLAUDE.md), затем этот снимок и нужный док по
   [index.md](index.md); задачу — в [backlog.md](backlog.md), поиск по ID — `bricks-index.md`.
2. Ветка от свежего `main`, перед коммитом — `pnpm run check`, публикация — скилл `publish-pr`
   и [CONTRIBUTING.md](../CONTRIBUTING.md); в очередь слияния PR ставит `automerge.yml`.
3. Новая механика — модуль в `packages/shared-core/src/modules` плюс данные; ядро не трогают.
   Модуль подключают в `DEV_MODULES` и `MODULES`, поднимают `MODULE_MANIFEST_VERSION` и
   перезакрепляют список в `moduleManifest.test.ts`. Текст игрока — ключ в `localization/`.
4. После правки переписать устаревший факт здесь, а не дописывать рядом; закрытый этап —
   «Статус реализации» в [roadmap.md](roadmap.md). Порядок — скиллы `brick` и `sync-state-doc`.
