# Состояние проекта — снимок

> Что есть в коде сейчас и как оно устроено: пакеты, ядро, состояние, модули, данные,
> клиенты, статус. Снимок, а не журнал: факт — одна-три строки, подробности — в тематическом
> доке или в коде по ссылке, история — в PR и роадмапах; устаревшее переписывают на месте.
> Потолок — 650 строк (`scripts/docs-check.mjs`). Прежние полные тексты:
> [до 2026-10-19](archive/state-2026-10-19.md), [до 2026-11-09](archive/state-2026-11-09.md).

**Гейт:** `pnpm run check` (lint + typecheck + test + docs-check).
**Последний полный локальный прогон: 15 409 тестов прошли**
(236 skip; 1272 файла прошли, 10 skip; на основе `main` `c2c28fc4`,
с готовой сборкой прототипа, без PostgreSQL). CI и merge queue проверяют PR вместе с `main`.

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
(`prototype/src/mapCatalog.ts`); у 1×1 и 2×2 режимы `capital_duel` / `capital_2v2` (захват
вражеских столиц), у остальных очковые пороги из одной таблицы ядра (`mapVictoryRules`).
Главы Sector Zero — `data/maps/pve-1…6.json`, режим `pve_waves` (10 волн); архив под Яндекс
Игры собирает `prototype/platformBuild.mjs`.

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
| `localization/` | тексты игрока (`ru.ts` — источник, `en`, `de`, `pl`, `es`) и рантайм `core.ts` |
| `data/` | контент в JSON, карты в `data/maps/`, версия бандла в `data/manifest.json` |
| `mobile/` | Capacitor-обёртка: Android APK, подготовка к RuStore |
| `desktop/` | Electron-обёртка ПК: архив Sector Zero в окне, без Яндекс SDK |
| `deploy/` | Compose (сервер + Postgres), Caddy/TLS, preflight, бэкапы, автодеплой, мониторинг |
| `docs/` | дизайн, роадмапы, бэклог, этот снимок |

Серверных входов два, оба на общих частях `packages/server`: `prototype/netserver.ts`
(`pnpm host`, его запускает образ) и `packages/server/src/main.ts` (`pnpm dev:server`).
Правка только `main.ts` игроков не меняет.

**Эксплуатация** — ранбуки: [развёртывание](../deploy/README.md) (автодеплой раз в 5 минут,
стенд ботов, root-юниты управляют Docker, приложения — под своим UID),
[transport-профиль](../deploy/transport/README.md) (HTTPS до приложения, PostgreSQL
`verify-full`), [ресурсы](../deploy/resources/README.md) (лимиты, root guard диска),
[аудит безопасности](../deploy/security/README.md) (локальный, без защиты от захвата VPS),
[пины образов](security/image-pinning.md); мониторинг читает отдельный
`METRICS_READER_TOKEN` ([проверка границ](security/colluding-attackers-2026-10-25.md)).

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
  общий цикл догона `runUntil` пока зовёт только реплей, у `MatchRoom` свой. Шаг, завершивший
  матч, последний: часы и очередь дальше не исполняются.
- **Копии.** `advanceTo` берёт одну копию мира на ход; черновик приказа (`lazyDraft`) копирует
  только тронутое, итог делит нетронутое со входом — состояние от ядра на месте не правят.
- **Детерминизм.** Кости — `Rng` (sfc32) в `state.rng`, поток закреплён золотым `rng.test.ts`.
  ESLint запрещает в ядре `Math.random`, `Date` и неточные `Math.sin`/`pow`/`atan2`/…
  У проекции под туманом (`visibleState`) костей нет: бросок на ней — отказ `E_NO_RNG`.
- **Сверка и реплей.** `hashState` — cyrb53 по каноническому JSON (золотой тест); `runReplay`
  проигрывает `ReplayLog` до того же хеша (живая комната — `replayDeterminism.test.ts`).
- **Правила сетевого матча** — неизменяемая капсула (ESM с ядром, модулями, каталогом и
  туманом), её SHA-256 — в `matches.ruleset` и `state.version.manifest`; новые матчи берут пакет
  текущего выпуска, старые доигрывают на своём, перевод — только операторским CLI.
  [Контракт](versioning.md), [выкатка и восстановление](../deploy/RULESETS.md).
- **Движок эффектов** (`modules/effects.ts`) исполняет правила `data/events.json`
  (`planet_captured`, `province_captured`, `schedule`): эффект ищется сначала как
  возможность `effect.<name>`, затем среди встроенных `add_trait` и `modify_resource`.

Инварианты — [CLAUDE.md](../CLAUDE.md); шина и деградация — [modulesystem.md](modulesystem.md).

## 3. Карта файлов

Дерево верхнего уровня. Подробная карта кода (модули, хуки, события, файлы пакетов) —
[CODE-MAP.md](../CODE-MAP.md), индекс всех документов — [index.md](index.md).

```text
packages/
  shared-core/src/     ядро: kernel/ (createKernel), modules/ (механики, GAME_MODULES в
                       gameModules.ts), state/ (GameState, туман, посев), actions/ (схемы
                       приказов), data/ (zod-схемы, loadGameData.ts), util/, rng/, replay/
  action-layer/src/    gate.ts: конверт → схема → права → квитанция → clientSeq; errors.ts
  protocol/src/        index.ts: сообщения сервер↔клиент; inputPolicy.ts: правила ввода
  server/src/          matchRoom.ts, store/, auth, API (общие с прото-хостом); main.ts не в проде
  client/src/          PWA: main.ts, session.ts (вход), matchHud.ts + hudView.ts, multiplayer.ts
prototype/             то, во что играют: клиент и игровой хост
  src/main.ts          клиент: мир, кадр и проводка; окна — модули init*(host)
  src/protoKernel.ts   ядро прототипа на GAME_MODULES и проба приказов canOrder
  src/matchSetup.ts    newGame: посев партии; src/game.ts — фасад реэкспортов
  netserver.ts         хост HTTP+WS; bundle-netserver.mjs → packages/server/dist/proto-server.mjs
  build.mjs            сборка клиента в HTML-файлы prototype/dist/
  styles/              листы CSS игры; номер в имени листа — его место в каскаде
  *.mjs                харнесы: selfplay.mjs, perf.mjs, report.mjs, смоуки *test.mjs
decisions/             чистые решения обоих клиентов, тест рядом (README.md)
localization/          ru.ts, en.ts, de.ts, pl.ts, es.ts (ключ → текст), core.ts, runtime.ts
data/                  контент *.json, manifest.json (версия), bundle.ts (сборка), maps/
scripts/               docs-check.mjs (гейт доков), server.ts (вход сервера пакета), генераторы
deploy/                Compose, Caddy, бэкап и восстановление, обновление, проверка образа
mobile/, desktop/      обёртки Capacitor (APK, RuStore) и Electron (архив Sector Zero на ПК)
testclient/            минимальный браузерный клиент для pnpm dev:server
docs/                  дизайн, роадмапы, бэклог; ADR — docs/explanations/
.github/workflows/     ci.yml (гейт), security.yml, image.yml, android.yml, pages.yml и др.
Dockerfile             прод-образ: запускает packages/server/dist/proto-server.mjs
wrangler.jsonc         сайт на Cloudflare: статические страницы клиента
```

Ещё в корне: `art/`, `examples/`; `playtest-logs/` (JSONL событий) хост создаёт на ходу, в git его нет.

## 4. Модель состояния (`GameState`)

Тип — `packages/shared-core/src/state/gameState.ts`, 65 полей. Обязательные 11 (без `?`) и
`startedAt` создаёт `createInitialState`, прочие — модули и посев с карты, если механика есть.

| Поле | Что хранит |
| --- | --- |
| `version`, `mapId?`, `modeId?` | родные версия/хэш данных, SHA-256 капсулы в manifest; карта и режим |
| `sight?`, `techRules?`, `pricing?` | правила партии: радиусы зрения, техдерево, множители цен |
| `time`, `startedAt?`, `match` | часы; статус, победители, очки, награды; публичные цели `capitalObjectives`, закреплённый `buildingScoreDivisor` |
| `rng` | состояние сидированного генератора sfc32 `{a, b, c, d}` |
| `players` | места: дом, `ai`/`npc`/`team`, казна `resources`, исследования, учёные, арсенал |
| `planets` | провинции: владелец, лейны и дороги, вид, постройки, гарнизон, очередь стройки |
| `fleets`, `fleetSeq?` | флоты: место или курс, стеки `units`, десант, ангар, орбита; счётчик id |
| `battles`, `battleSeq` | бои: место, фаза `orbital`/`ground`, стороны `sides`, раунд; счётчик id |
| `scheduled`, `scheduleSeq` | будущие события `{id, at, type, payload, seq}` для `advanceTo` |
| `fog?`, `surveyed?`, `seenPatrols?`, `seenSorties?`, `sensorView?` | память тумана по игрокам; тип провинций, где побывали их корабли; видимые чужие патрули и эскадры; готовые круги сенсоров (последние три — только в проекции) |
| `heroes?`, `tempLanes?`, `topology?`, `heroSeq?` | герои, их временные лейны, версия графа |
| `diplomacy?`, `mapShares?` | стойки пар (нет записи — `war`), договоры обмена картами |
| `coalitions?`, `coalitionSeq?`, `coalitionJoinAfter?`, `coalitionClock?` | состав коалиций и ожидаемые выходы; счётчик id; UTC-сроки запрета вступления; серверная привязка реального времени к часам матча |
| `diplomacyOffers?`, `mapShareOffers?`, `intel?`, `spies?`, `scouted?` | предложения о стойках и картах; окна шпионажа; именные шпионы игроков: где каждый, что делает и до какого мига (перевербованные — со сроком службы); чьими шпионы нашли разведанные миры |
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
- **Развитость мира** — не поле, а вычисление `planetDevelopment` (`state/development.ts`):
  каждый уровень постройки даёт `Σцены / 20 + часы стройки`; шапка карточки мира — значок `⬢`.
- **`version`** — пин правил партии: кто и где его сверяет — §2, пробел хоста игроков — §9.
- **Клиенту** — проекция `visibleState`: без `rng`, `fog`, `salvage`, счётчиков id и памяти Роя;
  чужие казна, агенты, исследования, герои и приказы срезаны. После конца матча открываются
  карта и счёт (`viewCoverage`), но туман, разведка и карьера прогресса за просмотр не получают.

## 5. Модули ядра

59 модулей в `packages/shared-core/src/modules`, по файлу на механику; порядок исполнения —
`GAME_MODULES` (`packages/shared-core/src/gameModules.ts`), один на оба хоста, счётчик — §9.
Модули не импортируют друг друга: события, хуки и возможности, а без модуля работает базовый
дефолт ([modulesystem.md](modulesystem.md)). Значение из соседнего модуля запрещает ESLint, тип —
можно (SLIM-7); общие чистые функции лежат в `state/` и `util/`. Действия, события и хуки по
модулям — [CODE-MAP.md](../CODE-MAP.md); здесь — что каждая механика делает.

- **Приказы.** Модули обрабатывают 86 типов действий, игрок может прислать 74: у каждого есть
  zod-схема в `actionPayloadSchemas` (`packages/shared-core/src/actions/payloadSchemas.ts`),
  тип без схемы гейт `@void/action-layer` отклоняет с `E_BAD_PAYLOAD`. Остальные 12 подаёт
  сам хост: `seat.*`, `arsenal.sync`, `chain.stamp`, `steward.report`, `pve.abandon`,
  `pve.supply`, `swarm.adapt`, `fleet.premiumRepair`, `coalition.clock.rebase`.
- **Отказ** — `h.reject('E_…')` со стабильным кодом; брошенное исключение становится `E_INTERNAL`.

**Экономика и торговля.**
- `economy` — доход миров и содержание войск по формуле за отрезок `time.advanced` (хук
  `economy.production`; мир со стройкой за порогом 50% — правилом Симпсона, точно при любой
  нарезке); хук `economy.unitUpkeep` множит содержание войск владельца, хук `economy.upkeep`
  дополняет весь дневной счёт игрока (так платится зарплата шпионов).
- `tax` — налог с обитаемых миров, убывающий с ростом державы. `control` (BAL-19) — лимит
  управления: 5 планет, ближайших к столице, работают полностью, остальные дают половину и не
  строят юниты; хук `control.limit` поднимают технологии «Командования» и линия «Наместника»
  (до 16). `integration` — взятая у другой стороны планета 3 игровых дня выходит с 25% на
  полный выход и не строит юниты. В PvE оба правила не действуют.
- `salvage` — победителям боя доля стоимости погибших; `effects` — правила `data/events.json` (§2).
- `market` — книга заявок партии с эскроу; `trader` — торговец забега, цена отвечает на сделки.

**Мир, стройка, наука.**
- `sector`, `planet-type`, `faction` — бонусы местности, типа планеты и фракции через хуки.
- `capital` — столица и место возрождения героев; `visibility` — память тумана: последний
  виденный снимок мира и тип провинции, чью границу пересёк корабль игрока (`surveyed`).
- `construction` — стройка зданий и юнитов, отмена и возобновление; оплата вперёд, готовность
  событием `construction.complete`; возможность `building.damage` (саботаж). Раны войск лечит
  только госпиталь (`healRate`), корпус чинят док (`shipRepair`) и ремонтные модули.
- `technology` — исследования и их очередь (RQ-1, до 8 тем, повтор раз в игровой час); узел с
  `has_scientist` открыт одному учёному; возможность `technology.grant` — кража исследований.
  `scientist` — учёные места, «+слот» хуком `research.slots`.
- `arsenal-sync` — что место может строить; `promotion` — «отмеченная» партия; `veteran` —
  надбавка за пережитые бои.

**Флоты.**
- `movement` — путь Дейкстрой по линиям, остановка в любой точке линии; курс отменяет только
  разведанная территория мирного владельца без права прохода. `visibility` режет шаг по
  `time.stop` при контакте сенсора; большой офлайн-шаг и малые шаги дают одну точку остановки
  ([аудит движения](reviews/2026-10-24-movement-logic-audit.md)).
- `fleet-ops` — запуск, слияние, деление, вступление в бой; `auto-merge` — прибывший флот
  вливается в стоявший свой (приказы обстрела и автоштурма и часы кораблей переходят, срок —
  поздний); `auto-rally` — построенный корабль уходит во флот сбора.
- `capture-on-arrival` — свободный узел берётся прилётом; `army` — наземные войска ездят только
  грузом флота, раненые — своим стеком с долей ран, оснасткой и выслугой.
- `forced-march` — +50% скорости, износ 5% корпуса в час; `instant-repair` — ремонт за кредиты
  вне боя (в забеге — за Суверены); ремонта за металл у дока нет.
- `standing-orders` — автоштурм, автоотход, цепочки приказов; `steward` — место ведёт ИИ,
  пока игрок офлайн.

**Бой.**
- `combat` — раунд раз в игровой час, фазы `orbital` и `ground`, штурм с высадкой, захват
  мира; выжившие уходят с ранами. Эшелоны 50/30/20, множители силы — доля HP корпуса и
  `min(1, L/N)`. Формулы и примеры — [GDD §7](gdd.md#7-боевая-система).
- `intercept` — встречи флотов на линиях и дорогах; без него бой бывает только в узлах.
- `orbital` — одна орбита, бомбардировка залпом раз в игровой час по часам флота
  (`bombardNextAt`), ПКО; орбита есть у видов с `orbit` в `data/sectorKinds.json`.
- `station` — космическая крепость: площадка `station_site` на непланетарном узле или развилке,
  корпус с модулями, свой ростер построек; ручной ремонт станций и построек
  ([fortress-roadmap.md](fortress-roadmap.md)). Карты основной игры крепость не кладут.
- `minefield` — минные поля, мина — неподвижный отряд в `fleets`; `rocketMines` — ракетные мины; их
  ракета наводится на флот за сигналом с запасом `guidanceReserve`.
- `missiles` — крылатая ракета стоит эскадрой в ангаре порта или трюме, `missile.launch` пускает
  её по одной или залпом; промах — только когда цель-флот дальше дальности от точки пуска.
  Бот ракетной доктрины строит их на войне и пускает залпом по флоту в дальности.
- `shuttle` — шаттлы стоят в космопорте мира и бьют от своего узла; эскадры, патрули, перелёты
  ([shuttles-roadmap.md](shuttles-roadmap.md)).
- `loadoutEffects` — модули кораблей, которые меняют правило, а не число корпуса;
  `cloak-field` — поле флагмана героя (§«Туман» ниже).

**Герои, дипломатия, места.**
- `hero` — призыв, способности из данных (один диспетчер), дерево навыков, оснащение;
  `heroEffects` — `aura`, `decoy`, `jump`, `recall`, `reveal`. В основной игре мобилизация
  героя идёт одной FIFO-линией с наземкой мира; лимит героев 1 → 2 → 3 открывают технологии.
- `diplomacy` — стойки (к войне — сразу, к миру и союзу — по согласию), обмен картами,
  коалиции (`state/coalition.ts`): выход и исключение — через 24 обычных часа, затем 48 часов
  запрета вступления; вместимость — 15% мест карты, не меньше двух.
- `espionage` — 3 именных шпиона живут в столице. Шпион летит к миру по лейнам
  (`state/spyTravel.ts`: скорость 640, ¾ над нейтральными мирами, ½ над вражескими), там
  12 ч работает и возвращается в столицу; не может начать — ждёт приказа на мире (рискуя
  вполовину), `relocate` только переезжает. Без столицы шпионы «на дне». Операции: разведка
  (остаётся на посту и открывает слои), саботаж, срыв стройки, подрыв экономики,
  кража ресурсов и исследований, контрразведка; бюро контрразведки раскрывает, убивает или
  перевербовывает. Раскрытие войны не объявляет, но публично. Приказ сверяется с тем, что
  игрок ЗНАЕТ о мире (`state/spyKnowledge.ts`): в обзоре, мир коалиции или мир, где побывал
  его шпион (`state.scouted`: шпион узнаёт хозяина каждого мира на пути); остальным — только
  разведка и переезд (`E_UNSCOUTED`).
  Разведка идёт и на ничейный мир: без бросков — суточное окно, запись и домой.
  Шанс в карточке — `decisions/spyOdds.ts`; цены — `SPY_OP_COST`. Зарплата —
  `SPY_SALARY` (24 кредита в сутки) каждому шпиону сети, кроме пустого слота в ожидании
  замены; хук `espionage.salary`; неоплата — долг по кредитам, как у армии.
- `spyLevels` — опыт и уровни шпионов (`state/spyLevel.ts`, `Spy.xp`): уровни 1/2/3 на
  1/3/7 очках. Очко за успешную кражу, саботаж, срыв стройки или экономики; 0,25 за каждые
  полные сутки разведки на посту; контрразведке 0,5 / 1 / 1,25 за поимку / убийство /
  перевербовку, делёж между всеми охранниками мира, союзными тоже (`splitGuardXp`: больше
  опытному); бюро без охранника опыта не даёт. Уровень: +5% к успеху, −5% к раскрытию,
  +10% к качеству (`espionage.quality`: доля кражи, урон саботажа, часы срыва, темп слоёв
  разведки, поимка чужого охранника) и +10% к скорости (`espionage.speed`).
- `seatClaim` — место в идущей сетевой партии.

**PvE и Sector Zero.**
- `pve` — волны NPC-врага; включается режимом с секцией `pve` в `data/modes.json`.
- Рой: `fleetBrood` (десант растёт на корабле), `swarmMemory`, `swarmAdapt`, `swarmJournal`,
  `swarmNet` — что Рой узнал боем, как усиливает модули и как знание идёт по связи.
- Главы: `rendezvous` (союзник глав IV–VI), `extraction` (архив главы IV), `operation`
  (контракт глав V–VI), `captive` (пленный главы V), `missionFacts` (факты для задач забега).
- `victory` — `capital_duel` / `capital_2v2`: только захват всех вражеских столиц; прочие
  режимы — господство, выбывание, очки, таймаут (хук `victory.score`); `victory.scripted`
  (полигон) отдаёт исход сценарию хоста.

**Туман — граница безопасности.** `visibleState` (`state/visibility.ts`) режет мир до того,
что видит игрок; сервер шлёт каждому дельты своей проекции (§4), союзные сенсоры приходят
готовыми кругами (`sensorView`). Флот на линии опознаётся по своей текущей позиции, а не по
ближайшему узлу — одинаково в соло, на сервере и на радаре. Маскировочное поле флагмана
(`state/cloak.ts`, модуль `cloak-field`) сжимает чужие круги опознания на `1 − cloak`;
срывается боем, обстрелом и вылетом шаттлов (`Fleet.cloakBrokenUntil`), видно шпиону и скану.

## 6. Данные (`data/*.json`, версия `0.1.86`)

Контент — данные: новая сущность или число — правка JSON, а не кода (скилл `add-game-content`).
Имя в JSON английское, текст — ключ `data.<слаг>` в обеих локалях (`prototype/src/i18n.test.ts`).

| Фрагмент бандла `GameData` | Что в нём | Записей |
| --- | --- | --: |
| `units` | корабли и наземка домов, флагман, Рой, пираты, служебные (мины, ракета мины, крылатая ракета) | 36 |
| `technologies` | технологии основной игры | 56 |
| `buildings` `modules` `factions` `scientists` | постройки, модули, фракции, учёные | 34·27·7·8 |
| `heroes` и ещё 4 `hero*` | архетипы, способности, пассивки, узлы дерева, грейды | 6·12·13·19·4 |
| `sectorKinds` `sectors` `planetTypes` | виды узлов, местность, типы планет | 19·11·12 |
| `modes` `events` `resources` | режимы, правила событий, ресурсы | 15·6·6 |
| `scoring` | делитель очков построек `buildingDivisor: 3` для новых партий | — |
| `sectorZeroShop` `sectorZeroStars` | Sector Zero: предложения магазина, ступени звёзд | 18·6 |
| `rewards` `medalGrades` `veteran` `promotion` `market` | XP за партию, ветеран, биржа | — |

- **Сборка.** Список фрагментов один — `composeGameDataBundle`
  (`packages/shared-core/src/data/loadGameData.ts`), разбор — `parseGameData` (zod); браузерам
  и хосту игроков бандл вшивает `data/bundle.ts` (пропажу фрагмента ловит `data/bundle.test.ts`).
  Вне бандла — серверные `starterArsenal`, `dropTables`, `metaEconomy`, `medals`,
  `corpBuildings` (§8): своя проверка, кривой файл — отказ запуска.
- **Пин.** Партия хранит `version.data` и отпечаток бандла `version.dataHash`; сверка — §2.
- **Как менять.** Правка бандла — `version` в `data/manifest.json`, пин в `schemas.test.ts` (гейт)
  и новая пара в `decisions/soloSaveMigration.ts`: без неё локальная схватка прежнего каталога
  не откроется (сторож — `soloSaveMigrationWiring.test.ts`). Новый фрагмент:
  `GameDataSchema`, `composeGameDataBundle`, `data/bundle.ts`.
- **Карты `data/maps`.** Основная игра (`techRules.ruleset: main`): `duel-1` (2 места, 19
  провинций), `ffa-4` (4/31), `team-2v2` (4/85), `team-3v3` (6/121), `ffa-20` (20/320),
  `ffa-50` (50/800, квадратное поле, заполненное до углов: `shape: 'square'` в
  `scripts/generate-ffa.mjs`; чёрная дыра «Бездны» в центре размером в две провинции
  (`size: 2`) за сплошным кольцом из 10 провинций `accretion_disk` — непроходимый
  аккреционный диск, `disk` в генераторе, решение владельца 2026-11-10). Sector Zero — `training-1` и главы `pve-1`…`pve-6`. Битвы корпораций берут
  карту по формату (`data/avaFormats.json`, CORP-8). Служебные — `proving-ground` (скрытый
  «Полигон»), `duel-testbed`, `skirmish-1`; `data/frontier-50|100.json` — для старых партий.
- **Край карты** — `mosaicClip` ядра, один на проходы и на оба рендера: по умолчанию рамка по
  границам карты; `edge: "hull"` в карте даёт выпуклый обод вокруг крайних центров. Край
  закреплён в `GameState.mapEdge`, стекло голограммы и его кайма идут по нему (`glassFrame`).
  Сейчас обод не включён ни на одной карте: `ffa-50` вместо него стала квадратной (решение
  владельца 2026-11-09), партии, начатые с ободом, сохраняют его.
- **Цены и сроки основной игры** (решение владельца 2026-10-18) — поле `pricing` её шести карт,
  посев закрепляет его в `GameState.pricing`; расчёт — `util/pricing.ts` (`matchUnitCost` для
  корпусов, `matchCost` для прочего), одинаково для UI, бота, оплаты и отмены. Новые партии
  строят вдвое дольше каталога, исследования стоят ×3 к ценам до 2026-11-06; принятые заказы
  хранят срок в `durationHours`. Sector Zero и старые партии сохраняют свои цены и сроки.
- **Металлодобыча** — одна цепочка `mine` (12/18/27 металла в игровой час); `mine_t1/mine_t2`
  помечены `retired`: новые заказы запрещены, старые постройки работают.
- **Очки построек.** `provinceBuildingScore` делит `scoreValue × level` планеты на закреплённый
  в партии делитель (новые — 3, старые снимки — 1).
- **Баланс** — [balance-history.md](balance-history.md); основную игру меряют окном 28 дней.

## 7. Прототип (`prototype/`)

Клиент, в который играют игроки (§1): соло, сетевая партия и Sector Zero — один код, сборки
различают флаги `__PLAYER_BUILD__` и `__SECTOR_ZERO_ONLY__`. Чистые правила экранов — в
`decisions/` (тест рядом); здесь — кто чем владеет, подробности — в коде и доках по ссылкам.

**Сборка и страницы.**
- `pnpm run prototype` (`prototype/build.mjs`) пишет в `prototype/dist/` дев `void-dominion.html`,
  `void-dominion-player.html`, `void-dominion-admin.html`, `sector-zero.html` и его дев-вариант,
  `served/`, `yandex/`; в сборке игрока нет тест-режима, песочницы, дев-забега.
- Хост `prototype/netserver.ts`: игрок на `/` и `/game/:matchId`, дев на `/dev`; из `dist/served/`
  арт идёт файлами `/assets/<имя>`, однофайловые HTML открываются с диска и едут в APK.
- `src/bootstrap.ts` до импорта `main.ts` поднимает площадку, язык и флаги баланса; плашка
  «игра в разработке» — `decisions/devNotice.ts`.

**Карта и рендер.**
- Кадр — `frame()` в `main.ts`; карта разложена по `map*.ts` (`mapCamera`, `mapInput`, `mapFog`,
  `mapWorlds`, `mapFleets`, слои `mapOverlays`/`mapAim`/`mapEffects`). Рисование провинций общее
  с `packages/client/src` (power diagram `territory.ts`, `holoDraw.ts`, LOD `mapLod.ts`).
- Политическая карта печётся в offscreen-холст (`mapLayer.ts`, правила —
  `decisions/mapLayerView.ts`), живые границы — готовым слоем (`borderLayer.ts`,
  `decisions/livingBorderLayer.ts`); растры рельефа — на холстах процессора
  (`terrainRasterCache.ts`); до первого кадра карту порциями готовит `mapLoading.ts`.
- Слабое устройство: вердикт по медиане кадров снимает чёткость и «Движение слоёв»
  (`decisions/mapSharpness.ts`), на Android включает «Совместимость отрисовки»
  (`canvasCompatibility.ts`); тумблеры «Графики» сильнее вердикта. Лимит FPS —
  `decisions/frameRate.ts`; за полноэкранным меню мир стоит, кадр раз в 200 мс
  (`decisions/simClock.ts`, сторож — `menuIdle.test.ts`). «Отчёт об отрисовке» — чёрный ящик
  зависаний (`decisions/renderBlackBox.ts`).
- Местность — общая среда в мировых координатах (`decisions/terrainEnvironment.ts`, правило —
  [map-visual-continuity-rule.md](map-visual-continuity-rule.md)); мир вне обзора — снимок
  памяти с пометкой «старые данные» (`decisions/worldLook.ts`, `scanMemory.ts`).
- Корабль — контур по фракции (`shipGlyphs.ts`), флот — силуэт доминанта с плашкой числа
  (`decisions/fleetTally.ts`); портреты WebP — `shipArt.ts`, `prototype/art/`.

**Окна и HUD.**
- `main.ts` — хозяин мира и проводки; интерфейс разнесён по модулям `init*(host)` с чистыми
  `*Html`. Владельцы: экран подключения — `connectScreen.ts`, настройки — `settingsView.ts` /
  `settingsOverlay.ts`, выбор — `sidePanel.ts`, жизненный цикл матча — `matchLifecycle.ts`,
  бой — `battleScreen.ts` + `battleView.ts` (прогноз — `decisions/battleForecast.ts`),
  окна экспедиции — `expeditionWindows.ts`.
- От 720 px — голографическая консоль ПК и планшета (`holographicUi.ts`, окна —
  `floatingWindows.ts`, масштаб — `decisions/pcScale.ts`); уже — телефон (`mobileHud.ts`,
  нижняя панель — `decisions/phoneNav.ts`, приказ — черновик цели `mobileOrders.ts`).
- Шапка матча (`matchTopBar.ts`) с чипом лимита управления (`decisions/controlCounter.ts`);
  карточки мира и флота (`worldFleetCard.ts`, `fleetCard.ts`), окно «i» мира только сообщает
  (`decisions/planetDossier.ts`); приказы флота показываются, только если ядро их примет
  (`decisions/bombardCommand.ts` и соседи). Интерфейс в целом — [hud-inmatch.md](hud-inmatch.md).
- Эскадры: значок «◇ N» у мира и носителя (`mapHangars.ts`, `decisions/hangarBadge.ts`),
  список «◇ Авиация» (`aviationPanel.ts`); приказы эскадре — только в её карточке
  (`squadronCardView.ts`), плитками, как у флота (`wingOrders.ts`).
- «Производство» (`shipyard.ts`): открывается списком четырёх линий мира, каталог линии —
  по нажатию на неё (`decisions/productionSections.ts`), над каталогом очередь линии строками со сроком каждого заказа, свёрнутая до «+N»
  (`decisions/laneQueue.ts`); мир с
  простаивающей линией отмечен у выбора мира в шапке (`idleProductionLanes`);
  шаблоны сборок (`decisions/buildTemplates.ts`), требования —
  `decisions/productionRequirements.ts` ([production-workbench.md](production-workbench.md)).
  «Герои» — `heroStaff.ts`, «Развитие» плитками (`decisions/heroTreeRows.ts`). Обновления
  (`productionRefresh.ts`) сохраняют список планет и фокус при начислении ресурсов; запас,
  линии и таймеры обновляются без замены списка.
- Флот: погрузка и высадка — `troopsWindow.ts` (`decisions/armyTransferRows.ts`), плашки и дуги
  перевозки на карте (`decisions/troopTransferTimers.ts`, `mapTransfers.ts`), цепочка приказов
  `chainPlanner.ts`, шаттлы — `hangarPanel.ts`, `squadronPanel.ts`.
- Дипломатия, коалиции (`coalitionWindow.ts`), метки (`pingUi.ts`,
  [ping-system.md](ping-system.md)), шпионаж с архивом донесений (`decisions/spyArchive.ts`).
- Клавиши ПК — `decisions/hotkeys.ts`, `pcHotkeys.ts`; Back и Escape — `backLayers.ts`,
  `backGesture.ts`. Вид: размеры текста `typeScale` в `packages/client/src/theme.ts` =
  `--fs-*` в `prototype/styles/01-base.css`, палитра `--sf-*` (сторож — `surfaceTokens.test.ts`);
  единица дохода (в час или в сутки) — `decisions/rateUnit.ts`.

**Хаб и аккаунт.**
- Вкладки Домой, Игры, Арсенал, Корпорация, Ещё (`hubScreen.ts`, `decisions/hubDoor.ts`);
  шапка с профилем и валютами — только на «Домой». Карьера — `meta.ts`
  ([account-level.md](account-level.md)); лента новостей — `newsScreen.ts`,
  `decisions/newsFeed.ts`, `decisions/newsPreferences.ts`.
- «Игры»: «Мои партии» (`decisions/myMatches.ts`, карточка — `decisions/matchCard.ts`,
  описание — `matchDescription.ts`), личный архив (`seats.archived`), битвы корпораций отдельной
  вкладкой. Создавать онлайн-сессии в проде могут UUID из `MATCH_CREATOR_ACCOUNT_IDS`
  (`GET /matches/capabilities`).
- Арсенал (`arsenalScreen.ts`, `decisions/arsenalView.ts`), «Снабжение» и аукцион
  (`metaEconomyScreen.ts`, `metaMarketScreen.ts`, `decisions/auctionHouse.ts`: купить, торги
  со ставками, продать, заказы на покупку), магазин (`shopScreen.ts`, `decisions/shopView.ts`).
- «Корпорация» (`corpHubView.ts`, `decisions/corpHub.ts`): база-сцена (`corpSprites.ts`,
  `corpArt.ts`), битвы, состав, казна, настройки ([corporation-ui.md](corporation-ui.md)).
- Аккаунт — `accountSession.ts`, `accountDeletion.ts`, «Восстановить доступ» — `signInPages.ts`;
  ошибки форм — `formFeedback.ts`; позднее пришедший ответ не стирает новую сессию.

**Обучение.** Гайд-матч (`firstMatchTour.ts`, цели `firstGoals.ts`, операция
`firstMatchOperation.ts`) и полигон Sector Zero (`trainingTour.ts`, 12 этапов); проводка —
`guideFlow.ts`, справочник — `helpCenter.ts`, термины — `termTip.ts`; сводка «пока тебя не
было» — `buildRecap` (`packages/shared-core/src/util/recap.ts`). План и шаги —
[onboarding-roadmap.md](onboarding-roadmap.md).

**Соло и ИИ.**
- Ядро в браузере: `protoKernel.ts` на `GAME_MODULES`; ИИ мест — `ai.ts`, ход по фазам —
  `aiTurn/` (сверка правок бота — `prototype/aitrace.mjs`); карты — `mapCatalog.ts`.
- Мир соло-схватки считает отдельный поток (`simWorker.ts`, `simLink.ts`, `simDriver.ts`,
  протокол `simProtocol.ts`): шаг ядра, затем `soloDrivers.ts` — ИИ и автоприказы. Забег,
  обучение, полигон и песочница считают в кадре.
- ИИ ходит раз в 2 игровых часа со сдвигом фаз мест (`StaggeredAi`, `aiScheduler.ts`), план
  режется на порции (`aiOrderSlices.ts`); производство заранее спрашивает ядро.
- Базы `pirate_base`/`neutral_base` ведёт ИИ своих NPC (`matchSetup.ts`); пираты вне PvE
  нападают только рядом с логовом (`decisions/pirateReach.ts`, BAL-17).
- Схватка сохраняется в слот `void.solo.v1` (`soloCheckpoint.ts`, формат — `decisions/soloSave.ts`)
  раз в 15 с и при уходе со страницы; сеть, PvE и песочница слот не пишут.

**Сеть (netserver).**
- Партия хоста — `createHostedMatch`, до 64 комнат на процесс; сокет и переподключение
  клиента — `netSession.ts`. Номер партии — 8 цифр (`decisions/matchNumber.ts`), адрес
  `/game/<id>` (`decisions/matchAddress.ts`), вход — `matchJoin.ts`.
- Остановка ждёт начатые действия и пишет снимки (`snapshotWriter.ts`); завершённая комната не
  тикает. Завершённые сессии 7 реальных суток лежат в архиве участников (`matchArchive.ts`,
  просмотр без ИИ и часов — `ArchiveRoomCache`).
- Хост гонит тот же `StaggeredAi`; связку приказов перед отправкой проверяет `canApplyAll`.
  Комната без людей спит до ближайшего решения бота или события мира; Хранителя будит
  `serverAiClock.ts`.
- Постоянные боты: 100 профилей (`botRoster.ts`, `botNicknames.ts`), необязательное заполнение
  партий (`botPopulation.ts`, `BOT_FILL_PERCENT`), стиль по seed (`botBehavior.ts`), короткие
  реплики в чате (`botSocial.ts`) ([эксплуатация](../deploy/README.md#постоянные-боты-для-заполнения-карт)).
- Карьера места — серверный ledger в снимке матча (`playerCareer.ts`); битва корпораций —
  комната `ava-<вызов>` с закрытым входом и замороженным арсеналом (`avaSweeps.ts`).
- Правила ввода аккаунтов — `packages/protocol/src/inputPolicy.ts`, двойники позывных
  отклоняет `loginIdentity.ts`.
- Модерация публичного текста — общий `inputPolicy.ts`: RU/EN + словари DE/FR/ES/PT/IT/PL/UK/TR/JA/KO/ZH/AR/HI,
  нормализация регистра, диакритики, цифр и похожих символов. Ники аккаунтов и
  названия корпораций отвергаются при создании; буквенные подстроки внутри обычных слов не блокируются.
  Сервер комнаты маскирует ругательства в сессионном/коалиционном чате, личных сообщениях,
  серверных репликах и подписях пингов **до** рассылки, истории и callback.
  Описания коалиций отвергаются при `coalition.edit` до изменения мира.
  Названия коалиций пока формируются из имени основателя, отдельного поля произвольного
  названия нет. Это словарный фильтр, не семантическая модерация; автоматических наказаний нет.

**Sector Zero и прогресс между забегами.**
- Хозяева: `sectorZeroShell.ts` (меню, подготовка, магазин, ролики), `sectorRun.ts` (забег,
  засчёт, задачи главы), `sectorProfile.ts` (профиль, облако).
- Профиль `sector-zero.progress.v1` с печатью (`decisions/profileSeal.ts`), правила —
  `decisions/sectorZeroProgress.ts`; забег `void.run.v1` запечатан для сида профиля
  (`decisions/runSeal.ts`). Неподписанный профиль в игру не принимается.

**Площадки: Яндекс Игры, APK, RuStore, ПК.**
- Контракт `GamePlatform` (`src/platform/types.ts`), адаптеры `web.ts` и `yandex.ts`; `host.ts`
  берёт Яндекс, только если поднят лоадер SDK ([platform-adapters.md](platform-adapters.md)).
- Архив `dist/yandex/` — только Sector Zero и один язык; реклама только rewarded
  (`decisions/adPlacements.ts`), облако — `decisions/cloudSync.ts`.
- APK — Capacitor (`mobile/`): обновления с VPS по манифесту, подписанному в CI (Ed25519,
  `mobile/distribution.json`), с прогрессом по байтам ([ранбук](../deploy/apk/README.md));
  кнопка «Скачать APK» — `decisions/apkOffer.ts`. RuStore закрыт до решений оператора
  ([rustore-preparation.md](security/rustore-preparation.md)).
- ПК — Electron (`desktop/`, [README](../desktop/README.md)): тот же архив Sector Zero, без
  CI-ленты и Steam.

**Локализация, пульт, телеметрия.**
- Локали и гейт — §1 и скилл `localization`; прототип берёт все языки (`runtime.ts`).
- Пульт `src/admin.ts` — своя сборка на `/admin` (только с `ADMIN_LOGINS`).
- События `TELEMETRY_EVENTS` (`packages/protocol/src/telemetry.ts`) уходят в `POST /telemetry`;
  сводка — `pnpm run analytics` ([телеметрия](playtest-telemetry-roadmap.md)). Активность
  игроков — `/metrics/activity` ([runbook](../deploy/observability/PLAYER-ACTIVITY.md)).

**Харнесы и проверки.**
- `prototype/uitest.mjs` (настоящий бандл на фейковом DOM/canvas) идёт в гейте через
  `entryFlow.test.ts`.
- `pnpm smoke:<имя>` — Chromium-харнесы на общей `harnessKit.mjs`; какие из них обязательны в
  CI — `.github/workflows/ci.yml`.
- Перф — `perf.mjs`, `panperf.mjs` (настоящий canvas), `motionperf.mjs` (команды — §10).

## 8. Метаигра (north-star)

Замысел — [metagame.md](metagame.md): обычные партии плюс AvA корпораций за сектора галактики;
мета-карты нет. Мета-слой — сервер; хост игроков включает его с учётками (`AUTH_JWT_SECRET`).

| Срез | Код (`packages/server/src`) | Хост игроков |
| --- | --- | --- |
| Корпорации: роли, влияние, стройка, пять уровней штаба | `corpService.ts`, `corpConstruction.ts` | вкл. |
| Лента новостей: корпорации, битвы, медали игроков, объявления администратора | `corpNews.ts`, `newsApi.ts`, `newsScreen.ts` | вкл. (`GET /news`, кнопка в шапке хаба) |
| Арсенал: стартовый набор, дроп, гейт `E_NOT_OWNED` | `mainGameArsenal.ts`, `arsenal.ts` | вкл. |
| Мета-экономика: материалы, крафт, выплаты, сезон, Суверены, витрина за ◆, перки премиума, награды за медали | `metaEconomy*.ts`, `medalRewards.ts` | вкл. |
| Аукцион `MetaMarket`: комиссия 8%, торги, заказы на покупку | `metaMarket.ts`, `metaAuction.ts`, `metaOrders.ts` | вкл., от 700 XP (5-й уровень) |
| Сессионная AvA в форматах от 2 на 2 до 10 на 10, медали, аренда корп-арсенала | `avaService.ts`, `avaFormats.ts`, `medalService.ts` и др. | вкл. |
| Магазин Commerce: 4 товара и 6 пакетов Суверенов, провайдеров нет | `commerceMain.ts`, свой процесс и БД | недоступны |

- AvA ([corporation-wars.md](corporation-wars.md)) и медали монтируют оба хоста; с
  `CORPORATIONS_URL` их состояние держит процесс корпораций
  ([corporation-service.md](corporation-service.md)). Битва идёт по своим часам, победу решает
  сумма очков стороны (`avaBattle.test.ts`); на хосте игроков сценарий проверяет
  `pnpm run smoke:ava` (Postgres).
- Новые обычные партии фиксируют правила наград `match-final-1` (◆, варранты, материалы, шанс
  модуля), этапы платят 25% и 50% бюджета; старые матчи и AvA — на прежней политике
  ([meta-economy.md](meta-economy.md)).
- Корпоративные материалы, казна и стройка зданий с атомарным резервом —
  [corp-building-materials.md](corp-building-materials.md); склад, зал славы и монумент —
  шторки зданий (CORP-11); новости о медалях (`player_medal_news`) — CORP-12.
- Решение владельца 2026-10-12: дальнейший разнос на сервисы, staff-сервис и SIEM — на паузе
  до живых игроков ([release-path.md](release-path.md)).

## 9. Статус

Готовность по этапам и продуктам — [readiness.md](readiness.md), путь к выпуску —
[release-path.md](release-path.md). Здесь — состав ядра и технические долги.

**59 модулей** на микроядре: столько файлов в `packages/shared-core/src/modules` (без тестов).
Оба хоста собирают весь каталог одним списком (SLIM-4): `MODULES` прототипа и `DEV_MODULES`
канонического сервера — это `GAME_MODULES` из ядра.

| Сборка | Модулей | Состав |
| --- | --: | --- |
| `GAME_MODULES` (оба хоста, `gameModules.ts`) | **59** | весь каталог ядра |

§9 — единственный дом этих чисел: `scripts/docs-check.mjs` сверяет их с кодом и закреплённым
списком `moduleManifest.test.ts` (правка состава без подъёма `MODULE_MANIFEST_VERSION` его роняет).

### ⚠️ Известные стопгапы и долги

- **Режим сетевой партии игроку не выбрать (GM-0.3 ⏳).** Прото-хост принимает `modeId` в
  `POST /matches` и сверяет с `data.modes`, но клиент шлёт только `{ mapId, timeScale?,
  goldActions? }` (`createOnlineMatch` в `matchLifecycle.ts`).
- **`teamFormat` пресетов режима никто не читает** — поле есть только в схеме (`schemas.ts`).
  Стороны сетевой партии задаёт карта каталога, а на старых картах — env `TEAMS` (`matchSetup.ts`).
- **id модулей ядра в двух стилях:** десять в camelCase (`heroEffects`, `seatClaim`,
  `fleetBrood`, `swarm*`, `rocketMines`…), остальные — kebab-case. Переименование — это подъём
  `MODULE_MANIFEST_VERSION` и отказ поднимать сохранённые партии, поэтому стиль не выравнивают.
- **Часть браузерных роботов пока не блокирует CI** (например, `smoke:net`, `smoke:yandex`).
- **Локали `de`, `pl`, `es` без сторожа полноты:** гейт `i18n.test.ts` сверяет только `ru` и `en`.
- Продуктовые пробелы (push, баланс основной игры, два клиента, аналитика, эксплуатация) —
  «Главные пробелы» в [readiness.md](readiness.md).

## 10. Команды и качество

Гейт `pnpm run check` = `lint` + `typecheck` (пакеты, затем `tsc -p prototype`) + `test` +
`docs-check`; его же гоняет хук `.githooks/pre-push`. Счётчик тестов — в шапке.

Сторож размеров — `scripts/codeSize.test.ts` с бюджетом `scripts/code-size-budget.json` (правило —
в `CLAUDE.md`); инструменты агента — [agent-tools.md](agent-tools.md).

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
pnpm run smoke:<имя>    # браузерные роботы; smoke:all — основной набор; ui:shot — снимок экрана
```

**`docs-check`** сверяет ссылки на md-файлы, зоны и статусы кирпичей, счётчики §9, потолок строк
этого снимка и сгенерированные индексы (`--write-index`); подробно — скилл `sync-state-doc`.

**Тесты.** Юнит — рядом с кодом (`*.test.ts`, `*.test.mjs`; охват — `vitest.config.ts`),
Postgres-контракты — только при `DATABASE_URL`. Property/fuzz-слой ядра (fast-check,
`testkit/arbitraries.ts`, падение печатает seed) — четыре `*.property.test.ts`: `applyAction`
(fail-secure, чистота), `advanceTo` (разбиение интервала: бит-в-бит на дискретном ядре,
coarse ≈ fine на полном стеке), `delta` (`applyDelta∘diffState = id`), `economyConservation`
(на узком наборе действий ресурсы с эскроу не растут). Детерминизм: golden `rng.test.ts`,
`hash.test.ts`, `replayDeterminism.test.ts` (живая комната → реплей → тот же `hashState`).

**CI** ([security/pipeline.md](security/pipeline.md)): `ci.yml` — гейт, OSV-Scanner, загрузка
бандла и основные UI-сценарии; `security.yml` — сканеры, блокируют Semgrep, Gitleaks, OSV и
Trivy; `image.yml` — подписанный образ; `automerge.yml` — зелёный PR сам встаёт в очередь
(руками не включать); `pages.yml`, `android.yml`, `rustore.yml`.

**Баланс.** `pnpm run selfplay N сид дней карта` — боты профиля `strong`: победы по слоту,
фракции и старту, длина, snowball, мёртвый контент, строка `SELFPLAY_JSON`. Прибор меряет
сильного бота, а не игру; основную игру мерят окном 28 дней (`pnpm run selfplay 120 base 28
duel-1`). История — [balance-history.md](balance-history.md), порядок — скилл `balance-analysis`.

## 11. Как возобновить работу

1. Прочитать корневой [CLAUDE.md](../CLAUDE.md), затем этот снимок и нужный док по
   [index.md](index.md); задачу — в [backlog.md](backlog.md), поиск по ID — `bricks-index.md`.
2. Ветка от свежего `main`, перед коммитом — `pnpm run check`, публикация — скилл `publish-pr`
   и [CONTRIBUTING.md](../CONTRIBUTING.md); в очередь слияния PR ставит `automerge.yml`.
3. Новая механика — модуль в `packages/shared-core/src/modules` плюс данные; ядро не трогают.
   Модуль подключают в `GAME_MODULES` (`gameModules.ts`), поднимают `MODULE_MANIFEST_VERSION` и
   перезакрепляют список в `moduleManifest.test.ts`. Текст игрока — ключ в `localization/`.
4. После правки переписать устаревший факт здесь, а не дописывать рядом; закрытый этап —
   «Статус реализации» в [roadmap.md](roadmap.md). Порядок — скиллы `brick` и `sync-state-doc`.
