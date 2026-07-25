---
name: add-game-content
description: Добавление и правка игрового контента в data/*.json — юниты, здания, фракции, технологии, модули кораблей, герои, планеты/сектора, ресурсы, награды. Используй, когда просят «добавить юнит/здание/фракцию/технологию/героя/модуль», «новый контент», «завести ресурс», «поправить поле в data/*.json», «взять кирпичик [data]» из docs/backlog.md — и так же для «add a unit/building/faction/tech/hero/ship module», «new game content», «add a resource», «edit data/*.json», «take a [data] brick». Триггерься и на бытовые формулировки («хочу корабль-разведчик», «пусть будет здание-ремонтник») — в этом проекте такой контент почти всегда JSON, а не код. Если же просят ОТБАЛАНСИРОВАТЬ и проверить прогоном (нерф/бафф, «сделай крейсер слабее», balance pass), начни со скилла `balance-analysis` — харнесы читают другой каталог.
---

# Контент в `data/*.json`

Движок ничего не знает о конкретных юнитах, зданиях и ресурсах — он знает только
формы из `packages/shared-core/src/data/schemas.ts` и работает поверх данных. Это и
есть главная ставка проекта: **новый контент = новая запись в JSON, без правок
логики**. Если задача заставляет писать `if (unitId === 'cruiser')`, остановись:
либо нужного поля не хватает в схеме, либо это новый модуль (см. skill `new-module`),
но не хардкод.

Зона `[data]` — самая малоконфликтная: почти всё правится в одиночку и параллельно
чужим PR.

## 0. Сначала пойми, КАКОЙ каталог ты правишь — их два

В репозитории два независимых каталога контента, и это главная ловушка зоны:

- **`data/*.json`** — shipped-бандл (собирается `loadGameData.ts`). Его читают
  `packages/server`, `packages/client` и тесты `shared-core`. Это предмет данного скилла.
- **инлайновый `parseGameData({ ... })` в `prototype/src/game.ts`** (~строка 113) —
  рукописное **зеркало** тех же каталогов (в комментариях так и написано: «mirror of
  data/modules.json»). Его читают прототип и все харнесы: `pnpm run selfplay`,
  `econplaytest`, `netserver`, играбельный клиент.

Практическое следствие: правка `data/units.json` **не изменит вывод `pnpm run selfplay`**
и не будет видна в прототипе — харнесы туда не смотрят. Поэтому:

- задача сформулирована как «добавить/поправить контент в бандле» → правь `data/*.json`;
- задача сформулирована как «отбалансировать, проверить прогоном» → правка нужна в
  каталоге `game.ts`, и работать надо по скиллу **`balance-analysis`** (там же описано,
  как читать вывод харнесов);
- меняешь правило игры для обоих — синхронизируй оба и скажи об этом в PR явно,
  иначе зеркала разъедутся молча.

## 1. Сначала прочитай схему, потом пиши JSON

`packages/shared-core/src/data/schemas.ts` — единственный источник правды о форме.
**Никогда не пиши поле по памяти**: у половины полей есть `.default(...)`, и
опечатка в имени не упадёт — она молча превратится в дефолт (либо, наоборот, улетит
в `.catchall(z.number())` у `UnitStatsSchema` как «ещё один стат»).

Что где лежит (список фрагментов задан в `loadGameData.ts` — он же и есть контракт):

| Файл | Схема | Про что |
| --- | --- | --- |
| `resources.json` | `z.array(z.string()).min(1)` | плоский список id ресурсов |
| `units.json` | `UnitDefSchema` | `faction, stats{…}, domain, line, cost, upkeep, slots{…}` |
| `buildings.json` | `BuildingDefSchema` | `cost, produces, upkeep, hp, upgrades[]` (уровни 2..N) |
| `factions.json` | `FactionDefSchema` | `startingLoadout`, `passives`, `uniqueUnits` |
| `technologies.json` | `TechnologyDefSchema` | `tier, branch, dayGate, conditions[], prerequisites, unlocks, effects` |
| `sectors.json` / `sectorKinds.json` / `planetTypes.json` | `SectorTypeDefSchema` / `SectorKindDefSchema` / `PlanetTypeDefSchema` | бонусы местности, `allowedBuildings`, `appearance` |
| `modules.json` | `ModuleDefSchema` | `slot('weapon'\|'defense'\|'utility'), tag('horizontal'\|'vertical'), effects` |
| `heroes.json`, `heroAbilities.json`, `heroPassives.json`, `heroSkillTrees.json`, `heroFittings.json` | `Hero*Schema` | 5 связанных каталогов героев |
| `scientists.json`, `events.json`, `rewards.json` | `ScientistDefSchema`, `EffectRuleSchema`, `RewardsDefSchema` | учёные, trigger→effect, XP-шкала |

Вне общего бандла (у них свои валидаторы, их читает сервер, а не `loadGameData`):
`starterArsenal.json`, `dropTables.json`, `medals.json` (см. `packages/server/src/`
— `scenario.ts`, `arsenal.ts`, `dropRoller.ts`, `medalCatalog.ts`) и `data/maps/*.json`
(схема `packages/shared-core/src/data/mapSchema.ts`).

Ориентируйся на соседнюю запись того же файла — она уже прошла схему и балансную
правку. Поля с дефолтом можно просто не писать: `cruiser` не объявляет `domain`,
потому что `'space'` — дефолт.

## 2. zod v4 — мелочи, на которых спотыкаются

- `z.record(keySchema, valueSchema)` — **два аргумента** (v4). Односложная форма не
  скомпилируется.
- Часть схем — не голые объекты, а `.refine(...)`: модуль не может расширять
  собственную вместимость слотов и `vertical`-модуль не может быть `soulbound`
  (анти-pay-to-win); фиттинг героя тоже не растит `slots`. Стоимости героического
  контента (`heroAbilities`/`heroSkillTrees`/`heroFittings`) — `nonnegative`:
  отрицательная цена печатала бы ресурсы через `payCost`.
- Enum'ы fail-closed: неизвестная ветка героя (`transhuman|psionic`), ветка техов
  (`ground|space|squadron|missile|command`) или `hook` пассивки роняют парс целиком.
  Это правильно (инвариант 4, fail-secure): битые данные не должны доехать до ядра.

## 3. Перекрёстные ссылки должны резолвиться

Данные — граф: стоимость ссылается на ресурс, техи открывают юниты/здания,
`sectorKinds.allowedBuildings` перечисляет здания, герой ссылается на способности,
пассивки и юнит-корабль. Валидация внешних данных происходит **на границе**, до
попадания в ядро (OWASP A05/A08) — схема ловит форму, а связность стерегут тесты:

- `schemas.test.ts` — «every resource referenced by content exists in the resource
  list», плюс referential integrity для героев (способности/пассивки/`ship.unit`),
  дерева навыков и фиттингов.
- `factions.test.ts` — юниты/здания/ресурсы стартового лоадаута фракции.

Осторожно: часть ссылок тестами **не** покрыта (`technologies.unlocks`,
`sectorKinds.allowedBuildings`). Ссылаешься оттуда на новый id — проверь глазами и
подумай, не стоит ли расширить тест в том же PR.

Добавляешь новый ресурс в `resources.json` — сразу дай ему производителя: тест
«ships producers for every economy resource» требует, чтобы каждый ресурс, кроме
`credits`, производился хотя бы одним зданием на каком-то уровне.

## 4. Именование и локализация

Поле `name` в `data/*.json` пишется **по-английски** (`"Sensor Array I"`), а русский
перевод живёт в `prototype/src/locale/ru.ts` под ключом `data:<name>` и достаётся
через `tData()` (см. шапку `prototype/src/i18n.ts`). Без записи в локали прототип
покажет английское имя — это не крэш, но и не то, что увидит плейтестер.
Id (ключ записи) — `snake_case`, как у всех существующих (`mine_t1`, `strike_carrier`).

## 5. Подними версию бандла

Изменил содержимое бандла — подними `version` в `data/manifest.json`.

Версия **пинуется в матч**: `buildStateFromMap` кладёт её в `state.version.data`, а
`runReplay` (`packages/shared-core/src/replay/replay.ts`) отказывается проигрывать
лог, если версия бандла разошлась с пином — «would silently diverge». Без бампа
изменённый контент незаметно подменяется под уже идущими матчами и реплеями: тот же
лог даёт другой результат, и детерминизм (инвариант 1) перестаёт быть проверяемым.

Версия зашита в двух местах, которые надо поправить вместе с манифестом:

- `packages/shared-core/src/data/schemas.test.ts` — `expect(data.version).toBe(...)`.
- заголовок `## 6. Данные (data/*.json, версия …)` в `docs/state.md`.

## 6. Новый top-level каталог (редко)

Если контент не влезает в существующие файлы, добавь фрагмент — это три
согласованные правки, иначе он просто не доедет до потребителей:

1. схема + запись в `GameDataSchema` в `schemas.ts` (с `.default({})`, чтобы старые
   бандлы оставались валидными);
2. строка в `composeGameDataBundle` (`loadGameData.ts`) — один список фрагментов на
   сервер, тесты и клиент;
3. импорт + запись в `FRAGMENTS` в `packages/client/src/gameData.ts` (Vite инлайнит
   JSON на сборке). Там сейчас перечислены не все фрагменты — отсутствующие
   схлопываются в дефолт `{}`, то есть в вебе каталог просто пуст. Если твой контент
   нужен веб-клиенту, добавь его туда явно.

## 7. Гейт и доки

```bash
pnpm test schemas            # быстрый цикл: schemas.test.ts + arsenalSchema.test.ts
pnpm run check               # lint + typecheck + test + docs-check — перед коммитом
```

Балансные правки часто ломают тесты, которые **намеренно** прибиты к числам
(`fort` HP 35→65, `radar` radarRange 180/300/420, «ровно две фракции» в
`factions.test.ts`). Красный тест здесь — не помеха, а сигнал: обнови ожидание
вместе с данными в том же PR, чтобы было видно, что число поменяли осознанно.

Дальше — рабочее соглашение «код первый, доки следом»: зелёный гейт → обнови
раздел «6. Данные» в `docs/state.md` (не дописывай абзац рядом со старым фактом —
перепиши устаревшее утверждение) и отметь кирпичик в `docs/backlog.md`. Ветка от
`main`, один кирпич — одна зона, PR в `main` (`CONTRIBUTING.md`).
