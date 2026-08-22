# PvE и командные режимы — roadmap реализации

> Порядок сборки PvE-механики и командных форматов (1v1..5v5). Спутник
> `docs/game-modes-roadmap.md` (дизайн режимов GM-0..GM-4) — здесь **план
> реализации**, не дизайн: фазы, кирпичики, зависимости, «готово, когда».
> Парные доки: `game-modes-roadmap.md` (GM-0.1 каркас, GM-4.5 командные
> варианты, GM-4.6 PvE волны), `matchmaking-roadmap.md` (MM-1.1/1.2 — где
> режим выбирается), `CODE-MAP.md` (карта модулей), `docs/explanations/05`/`06`
> (ADR: AI-размещение, спавн-волн-через-schedule).
>
> Формат — кирпичики: *зона · статус · зависимости · «Готово, когда».*
> Статусы: ✅ · ⏳ · 🔒(dep).

## Текущее состояние (факт)

- **`victoryModule`** (`packages/shared-core/src/modules/victory.ts`) — 4 исхода
  (score/domination/elimination/timeout), data-driven через `config.victory`,
  коалиции через `alliance` clique (боты исключены `E_BOT_ALLIANCE`).
- **`Player.ai?: boolean`** (`gameState.ts:92`) — флаг AI-места уже есть.
- **`diplomacyModule`** — `DEFAULT_STANCE='war'`, `E_BOT_ALLIANCE` (боты не
  приглашаются в альянс). Рой в `war` со всеми — без правок дипломатии.
- **Team-aware карты** (`data/mapSchema.ts`): `MatchMap.slots` с полем `team`,
  `avaShape(map)` → `{sides, slotsPerSide}`. `buildStateFromMap` сеет
  `alliance` внутри команды, `war`/`peace` между (`seedTeamDiplomacy`).
- **`NetworkMatchMode`** (`prototype/src/matchSetup.ts:110`): `'ffa'|'2v2'|
  '5v5'` + `networkSeats(mode)`. Нет 1v1/3v3/4v4.
- **Серверный AI** (`prototype/src/ai.ts`): `seatAiDecision`/`aiOrders` —
  pure-функция, генерирует действия, подаёт через `applyAction`.
- **`schedule(at, type, payload)`** (`kernel/module.ts`) — планирование
  детерминированных будущих событий (реплеируемо).
- **`events.json`** — тёмные события (аналог PvE-воздействий по шаблону).
- **`swarm` УЖЕ в `data/factions.json`** — шесть фракций: четыре лор-дома
  (azure/crimson/amber/violet) плюс `vanguard` и `swarm` (`The Swarm`, трейт
  `consume_biomass`, `productionBonus` 0.15, полный `startingLoadout`,
  `uniqueUnits` пуст). Первая редакция этого документа утверждала обратное —
  проверено 2026-08-22 чтением файла, Фаза 2 от этого схлопывается (см. ниже).
- **`modes` в `GameData`** (`data/modes.json`, `GameModeDefSchema`) — каталог
  режимов-пресетов загружается и валидируется вместе с остальным контентом.

**Чего нет:** `modeId` в `MatchConfig` и консервации режима (PVE-0.2), 1v1/3v3/4v4 в
`NetworkMatchMode`, `pveModule`, механики волн, кооп-условия победы,
AI-оркестратора PvE.

## Принципы (из `CLAUDE.md` + ADR)

- **Data-driven, kernel неизменен** — режим = `GameModeDef` (данные) + опц.
  модуль + хуки. Новое условие победы не редактирует ядро.
- **Детерминизм** — спавн волн через `schedule()` в `GameState`, считается от
  `ctx.now` (seeded, реплеируемо). Тактика NPC — на сервере (ADR 05/06).
- **Server-authority + fail-secure** — выбор режима консервируется при старте;
  невалидный/несовместимый с картой режим — отклоняется сервером (A10).
- **Async / 24-7** — условия работают по серверному времени через
  offline-планировщик; победа не требует, чтобы кто-то был онлайн.
- **Коалиции — явный статус** — командное правило считает только формальный
  альянс (`diplomacyModule`), не «мы не воюем».
- **Surgical changes** (`CLAUDE.md:241`) — не трогаем `diplomacyModule`,
  `buildFromMap.ts`/`seedTeamDiplomacy`, `mapSchema.ts`/`avaShape`,
  существующие исходы `victoryModule`, существующие значения `NetworkMatchMode`.

---

## Фаза 0 · Каркас режимов (GM-0.1) `[core][data]`

> Фундамент, без которого PvE и командные форматы = частные случаи. См.
> `docs/game-modes-roadmap.md` GM-0.1.

### PVE-0.1 · `GameModeDef` zod-схема + `modes` в `GameData` `[core]` `[data]` ✅ — M
**Сделано:** `GameModeDefSchema` в `packages/shared-core/src/data/schemas.ts` —
`name` (английское ИМЯ данных, локализуется `tData()` → `data.<слаг>`, как весь
остальной каталог; отдельного `mode.*`-ключа нет), `description?`, `victory`
(`ModeVictorySchema`), `teamFormat` (`TeamFormatSchema`, дефолт `'ffa'`),
`modules: string[]` (id опциональных mode-модулей), `pve?` (`ModePveSchema`).
`modes: z.record(z.string(), GameModeDefSchema).default({})` в `GameDataSchema`,
фрагмент `data/modes.json` в `composeGameDataBundle` + в браузерном `FRAGMENTS`
(`packages/client/src/gameData.ts`), версия бандла `0.1.5` → `0.1.6`.

**Три решения, разошедшиеся с первой редакцией плана — и почему:**
- **`id` поля нет:** id режима — КЛЮЧ записи, как у любого каталога здесь.
- **`requiredMap` не заведён.** Тегов карт нет, а значит и проверки нет: поле,
  которое объявляет требование и ничего не исполняет, — это отказ с виду
  настроенного режима (нарушение fail-secure), а не задел. Завести вместе с
  инфраструктурой тегов карт (см. «Открытые вопросы»).
- **`victory` — это `VictoryConfig` МИНУС `endsAt`, и схема `.strict()`.**
  `endsAt` — абсолютная метка времени матча, контентом она быть не может. Без
  `.strict()` zod молча срезал бы её, оставив режим, который читается как
  настроенный и таковым не является; теперь это громкий отказ валидации.

**Заодно закрыт PVE-0.3** (пресет `standard`) — не по желанию, а вынужденно:
`packages/client/src/gameData.test.ts` («composes catalogues that are actually
populated») роняет гейт на ЛЮБОМ пустом record-каталоге бандла, поэтому фрагмент
`modes.json` физически не мог приехать пустым. См. PVE-0.3 ниже.

**Тесты:** 7 в `schemas.test.ts` (шипнутый каталог, дефолты, PvE-секция во всех
шести форматах, referential integrity по `pve.npcFaction`, отказ на неизвестном
`teamFormat`/кривой `pve`, отказ на `endsAt` и `scoreLimit: 0`).

### PVE-0.2 · `modeId` в `MatchConfig` + консервация `[core]` ⏳ — S
**Цель:** матч стартует с `modeId`, конфиг победы берётся из пресета, смена
режима на лету отклоняется (fail-secure).
**Подзадачи:**
- `MatchConfig.modeId?: string` в `packages/shared-core/src/action/types.ts:44`.
- `createDevMatch`/`MatchRoom` читают пресет из `data.modes[modeId]`, мержат
  `victory` в `config.victory`.
- Смена `modeId` после старта — отклоняется сервером (стабильный код).
**Готово, когда:** матч стартует с `modeId`, конфиг победы из пресета, смена
отклоняется. Тест.

### PVE-0.3 · Пресет `standard` `[data]` ✅ — S
**Сделано (вместе с PVE-0.1 — иначе гейт красный, см. выше):** запись `standard`
в `data/modes.json` — `teamFormat: 'ffa'`, `victory` = сегодняшние базовые правила
(`dominationPercent` 0.6, `scoreLimit` 600, `coalitionFactor` 0.7; timeout остаётся
за скоростью сессии, потому что `endsAt` в контенте не живёт). Ключ локали
`data.standard` заведён в `ru.ts` + `en.ts`.

Один факт теперь лежит в двух местах — в данных и константами в `victory.ts`, — и
удержать их вместе может только пин: `DEFAULT_DOMINATION_PERCENT`/
`DEFAULT_SCORE_LIMIT`/`DEFAULT_COALITION_FACTOR` **экспортированы**, тест сверяет
пресет с ними, а не со списанными литералами. Больше в `victoryModule` ничего не
менялось. Пресет пока НИКУДА не подключён — это PVE-0.2.

---

## Фаза 1 · Командные форматы (1v1..5v5) `[core][data][proto]`

> Модификатор `teamFormat` — любой режим может быть 1v1..5v5. См. GM-4.5.
> Карты уже team-aware (`MatchMap.slots.team`, `seedTeamDiplomacy`).

### PVE-1.1 · `TeamFormat` тип + расширение `NetworkMatchMode` `[proto]` ⏳ — S
**Цель:** 6 форматов: 1v1/2v2/3v3/4v4/5v5 + ffa.
**Подзадачи:**
- `NetworkMatchMode` в `prototype/src/matchSetup.ts:110` расширить до
  `'1v1'|'2v2'|'3v3'|'4v4'|'5v5'|'ffa'` (существующие значения не меняем).
- `parseNetworkMatchMode` принимает все 6.
- `networkSeats(mode)` генерит слоты: 1v1=2, 2v2=4, 3v3=6, 4v4=8, 5v5=10;
  team A/B.
**Готово, когда:** `networkSeats('1v1')` = 2 слота (team A/B), `'3v3'` = 6,
`'4v4'` = 8; `parseNetworkMatchMode` принимает все 6. Тест в
`networkSeats.test.ts`.

### PVE-1.2 · Пресеты командных режимов `[data]` ⏳ — S
**Цель:** пресет на каждый командный формат.
**Подзадачи:**
- `data/modes/duel.json` (1v1, `teamFormat: '1v1'`, victory = standard).
- `data/modes/team_2v2.json` (2v2, `teamFormat: '2v2'`, victory = coalition).
- `data/modes/team_3v3.json` (3v3).
- `data/modes/team_4v4.json` (4v4).
- `data/modes/team_5v5.json` (5v5).
**Готово, когда:** все 5 пресетов валидируются `GameModeDefSchema`, `teamFormat`
корректный. Тест в `schemas.test.ts`.

### PVE-1.3 · Локализация режимов `[data]` ⏳ — S
**Цель:** ключи имён режимов в обеих локалях.
**Ключи НЕ `mode.*`** (правка PVE-0.1): режим — обычный игровой каталог, поэтому
имя в JSON английское, а ключ строит `tData()` слагом от ИМЕНИ — `data.duel`,
`data.team-2v2`, … Своего механизма заводить нельзя: гейт (`i18n.test.ts`, тест
«у каждого имени шипнутого контента есть ключ `data.*`») обходит ВСЕ
record-каталоги бандла и потребует именно `data.<слаг>`.
**Подзадачи:** `data.duel`, `data.team-2v2`, `data.team-3v3`, `data.team-4v4`,
`data.team-5v5`, `data.pve-waves` (`data.standard` уже заведён в PVE-0.3) в
`/localization/ru.ts` + `en.ts` — в ТОМ ЖЕ PR, что и пресеты PVE-1.2, иначе гейт
красный на первом же новом имени.
**Готово, когда:** гейт `prototype/src/i18n.test.ts` зелёный (ключи в обеих
локалях).

---

## Фаза 2 · NPC-фракция «Рой» `[data]` — фазы фактически нет

> Вся фаза держалась на утверждении «`swarm` в данных нет». Утверждение было
> ложным (проверено 2026-08-22): фракция, её локализация и версия бандла уже на
> месте. Ничего писать не нужно — остаётся только не написать это второй раз.

### PVE-2.1 · `swarm` в `data/factions.json` `[data]` ✅ — уже в контенте
`swarm` = `The Swarm`, `traits: ['consume_biomass']`, `passives:
{ productionBonus: 0.15 }`, полный `startingLoadout`, `uniqueUnits: []` (ссылок
на несуществующих юнитов нет — держит `factions.test.ts`). Балансировать лоадаут
под волны — это тюнинг контента (Фаза 3+), а не заведение фракции.

### PVE-2.2 · Локализация Роя `[data]` ✅ — уже в обеих локалях
`data.the-swarm` → «Рой» / “The Swarm”. Ключ строится слагом от ИМЕНИ (`The
Swarm`), а не от id, поэтому он `data.the-swarm`, а не `data.swarm`. Описания у
фракции нет вовсе, так что и ключа `*.desc` не нужно.

### PVE-2.3 · Bump `data/manifest.json` `[data]` ✅ — сделано в PVE-0.1
`0.1.5` → `0.1.6` (контент изменился — появился `modes.json`). Исходное «с
`0.1.4`» было устаревшим: до этого кирпича бандл уже стоял на `0.1.5`.

---

## Фаза 3 · `pveModule` — общий враг + волны `[core]`

> Скелет модуля: спавн волн через `schedule()`, счётчик в `state.pve`.
> Референс: `modules/capital.ts` (ближайший аналог простого модуля с
> mode-состоянием). ADR 06.

### PVE-3.1 · `state.pve` в `GameState` `[core]` ⏳ — S
**Цель:** mode-состояние PvE в `GameState` (JSON-сериализуемо, инвариант #2).
**Подзадачи:**
- `PveState` интерфейс: `{ waveNumber: number, totalWaves: number,
  npcPlayerId: string, nextWaveAt?: number }`.
- `state.pve?: PveState` в `GameState` (`gameState.ts`).
**Готово, когда:** `state.pve` сериализуется, тип проверен. Тест.

### PVE-3.2 · `pveModule` — спавн волн `[core]` ⏳ — M
**Цель:** детерминированный спавн NPC-флотов по расписанию.
**Подзадачи:**
- `packages/shared-core/src/modules/pve.ts` — `GameModule` с `id: 'pve'`.
- `onAction('pve.spawnWave', ...)` — создаёт NPC-флот у периферии карты (через
  `armyModule`/`fleetOpsModule` паттерны), инкремент `state.pve.waveNumber`.
- `on('time.advanced', ...)` — планирование следующей волны через
  `h.schedule(now + waveInterval, 'pve.spawnWave', {wave: N+1})`.
- Первая волна планируется при старте (первый `time.advanced` или
  `match.started`).
- Деградация без модуля: base default, никогда краш (инвариант #3).
**Готово, когда:** спавн волны инкрементит `waveNumber`, schedule планирует
следующую, детерминизм (seeded — одинаковый seed = одинаковый спавн),
деградация без модуля. Тест в `pve.test.ts`.

### PVE-3.3 · Регистрация в `DEV_MODULES` + bump манифеста `[core]` ⏳ — S
**Цель:** `pveModule` в составе ядра, манифест версионирован.
**Подзадачи:**
- Добавить `pveModule` в `DEV_MODULES` (`server/src/scenario.ts:106`) — после
  `victoryModule`, перед `visibilityModule`.
- Bump `MODULE_MANIFEST_VERSION` → '5' (инвариант #6: порядок модулей — часть
  детерминизма).
- Экспорт `pveModule` из `packages/shared-core/src/index.ts`.
**Готово, когда:** `pveModule` в `DEV_MODULES`, `MODULE_MANIFEST_VERSION = '5'`,
`pnpm run check` зелёный. Аудит детерминизма (скилл `determinism-audit`).

### PVE-3.4 · Кооп-враждебность NPC `[core]` ⏳ — S
**Цель:** Рой в `war` со всеми людьми, люди в `alliance` между собой.
**Подзадачи:**
- NPC-игрок создаётся с `ai: true` (уже есть).
- `DEFAULT_STANCE='war'` — Рой в war со всеми по умолчанию (дипломатию НЕ
  трогаем — surgical changes).
- Люди в `alliance` через существующую `seedTeamDiplomacy` (team-aware slots).
**Готово, когда:** NPC в war со всеми, люди в alliance; `diplomacyModule` не
тронут. Тест.

---

## Фаза 4 · Кооп-условие победы `[core]`

> PvE-исход в `victoryModule` — без GM-0.2 (мульти-исход/приоритет), PvE-чек
> первым в `evaluateVictory`.

### PVE-4.1 · `MatchEndReason` расширение `[core]` ⏳ — S
**Цель:** новые причины завершения матча для PvE.
**Подзадачи:** `MatchEndReason` += `'pve-cleared' | 'pve-failed'` в
`gameState.ts`.
**Готово, когда:** тип расширен, typecheck зелёный.

### PVE-4.2 · PvE-чек в `victoryModule` `[core]` ⏳ — M
**Цель:** победа по зачистке волн, поражение по гибели всех людей.
**Подзадачи:**
- В начало `evaluateVictory` (до score/domination/elimination/timeout):
  - `state.pve` есть и `waveNumber >= totalWaves` и NPC `defeated` →
    `endMatch(h, null, 'pve-cleared')` (победа всех живых людей).
  - Все люди `defeated` → `endMatch(h, npcId, 'pve-failed')`.
- Существующие исходы НЕ переписываем (surgical changes) — только добавляем
  чек в начало.
**Готово, когда:** победа по зачистке волн, поражение по гибели всех людей,
сосуществование с score-victory. Тест в `victory.test.ts` + регрессионный
(существующие исходы не сломаны).

### PVE-4.3 · Пресет `pve_waves` `[data]` ⏳ — S
**Цель:** пресет PvE-режима «волны».
**Подзадачи:** `data/modes/pve_waves.json`: `pve.waves: N` (например 10),
`npcFaction: 'swarm'`, `waveIntervalHours: 6`, victory = «пережить N волн»,
`modules: ['pve']`.
**Готово, когда:** пресет валидируется, `modeId: 'pve_waves'` запускает матч с
`pveModule`. Тест.

---

## Фаза 5 · Серверный AI-оркестратор (скелет) `[srv]`

> Тактика NPC — на сервере (ADR 05). Без неё волны спавнятся, но не атакуют.

### PVE-5.1 · `pveOrchestrator` скелет `[srv]` ⏳ — M
**Цель:** по тику генерирует действия NPC, подаёт через `applyAction`.
**Подзадачи:**
- `packages/server/src/pveOrchestrator.ts` — pure-функция (паттерн
  `prototype/src/ai.ts` `aiOrders`): читает state, возвращает список действий.
- Базовая тактика: экспансия (захват нейтральных), атака ближайшего игрока,
  отступление при превосходстве.
- Без тактической сложности в первой итерации — простые правила.
**Готово, когда:** оркестратор генерирует валидные действия, не нарушает
детерминизм (seeded). Тест.

### PVE-5.2 · Интеграция в `MatchRoom` `[srv]` ⏳ — S
**Цель:** `MatchRoom` тикает оркестратор для NPC-места в PvE-режиме.
**Подзадачи:**
- В `MatchRoom`: если `config.modeId === 'pve_waves'`, clockDriver тикает
  `pveOrchestrator` для NPC-игрока.
- Действия подаются через `applyAction` — та же шина, что и игроковые.
**Готово, когда:** NPC действует в PvE-матче, действия проходят гейты. Тест.

---

## Фаза 6 · Документация и синхронизация `[docs]`

> Code first, docs after — после реализации.

### PVE-6.1 · Обновить `docs/game-modes-roadmap.md` `[docs]` ⏳ — S
**Цель:** отметить статус реализации.
**Подзадачи:** GM-0.1 ✅, GM-4.5 ⏳ (форматы реализованы), GM-4.6 ⏳ (фундамент).
**Готово, когда:** статусы актуальны (сверить с кодом — скилл `sync-state-doc`).

### PVE-6.2 · Обновить `docs/state.md` `[docs]` ⏳ — S
**Цель:** синхронизировать якорь контекста.
**Подзадачи:** добавить секцию про PvE/командные режимы (что готово, как
работает). Сверить с кодом.
**Готово, когда:** `state.md` актуален, `pnpm run docs-check` зелёный.

### PVE-6.3 · Обновить `CODE-MAP.md` `[docs]` ⏳ — S
**Цель:** добавить `pveModule` в карту модулей.
**Подзадачи:** добавить строку в таблицу модулей ядра, обновить `MODULE_MANIFEST_VERSION`.
**Готово, когда:** `CODE-MAP.md` актуален.

### PVE-6.4 · ADR 05/06 → `accepted` `[docs]` ⏳ — S
**Цель:** сменить статус ADR с `proposed` на `accepted` после реализации.
**Подзадачи:** обновить `docs/explanations/05-pve-ai-placement.md` и `06-pve-
wave-spawn-via-schedule.md` — статус `accepted`, сверить текст с кодом.
**Готово, когда:** ADR актуальны, `docs-check` зелёный.

---

## Зависимости и последовательность

```
PVE-0.1 GameModeDef схема          ✅ каркас — разблокировал всё
PVE-0.3 пресет standard            ✅ (пришлось в том же PR — гейт пустых каталогов)
PVE-2.* NPC-фракция Рой            ✅ фракция и локаль были в контенте с самого начала
PVE-0.2 modeId в MatchConfig       ← СЛЕДУЮЩИЙ: консервация режима в матче
   │
   ├─ PVE-1.* Командные форматы    ← teamFormat, networkSeats, пресеты
   │     PVE-1.1 TeamFormat тип
   │     PVE-1.2 пресеты 1v1..5v5
   │     PVE-1.3 локализация (в одном PR с 1.2)
   │
   ├─ PVE-3.* pveModule            ← 🔒 PVE-0.2
   │     PVE-3.1 state.pve
   │     PVE-3.2 спавн волн
   │     PVE-3.3 регистрация + bump манифеста
   │     PVE-3.4 кооп-враждебность
   │
   ├─ PVE-4.* Кооп-условие победы  ← 🔒 PVE-3.2
   │     PVE-4.1 MatchEndReason
   │     PVE-4.2 PvE-чек в victoryModule
   │     PVE-4.3 пресет pve_waves
   │
   ├─ PVE-5.* AI-оркестратор       ← 🔒 PVE-3.3, PVE-4.3 (опц.)
   │     PVE-5.1 pveOrchestrator
   │     PVE-5.2 интеграция в MatchRoom
   │
   └─ PVE-6.* Документация         ← после реализации
         PVE-6.1 game-modes-roadmap
         PVE-6.2 state.md
         PVE-6.3 CODE-MAP.md
         PVE-6.4 ADR 05/06 → accepted
```

**Порядок сборки (остаток):** PVE-0.2 (консервация `modeId`) → PVE-1.*
(командные форматы) → PVE-3.* (`pveModule`) → PVE-4.* (победа) → PVE-5.*
(AI, опц.) → PVE-6.* (доки).

## Что НЕ трогаем (surgical changes — `CLAUDE.md:241`)

- **`diplomacyModule`** — `DEFAULT_STANCE='war'` и `E_BOT_ALLIANCE` уже
  работают. Не добавляем ничего.
- **`buildFromMap.ts` / `seedTeamDiplomacy`** — team-aware slots уже работают.
  Не переписываем.
- **`victoryModule` существующие исходы** — score/domination/elimination/
  timeout не переписываем; только добавляем PvE-чек в начало. _Единственная
  правка на сегодня (PVE-0.3): три константы базовых правил получили `export`,
  чтобы тест пинил к ним пресет `standard`. Логика не тронута._
- **`NetworkMatchMode` существующие значения** — `'ffa'|'2v2'|'5v5'` не меняем;
  только расширяем enum.
- **`mapSchema.ts` / `avaShape`** — уже team-aware; не трогаем.
- **Существующие тесты** — не правим; добавляем новые и регрессионные.

## Тесты как страховка

- **Перед изменением** `victoryModule`/`NetworkMatchMode` — запустить
  существующие `victory.test.ts`/`networkSeats.test.ts`, убедиться зелёные.
- **После каждого изменения** — `pnpm run check` (lint + typecheck + test +
  docs-check).
- **Регрессионные тесты** — в `victory.test.ts` проверить, что существующие
  исходы не сломаны добавлением PvE-чека.
- **TDD-цикл** — для каждого нового модуля/схемы сначала тест, потом
  реализация.
- **Аудит детерминизма** (скилл `determinism-audit`) — после PVE-3.3
  (добавление `pveModule` в `DEV_MODULES`, bump манифеста).

## Открытые вопросы

```
□ GM-0.2 (мульти-исход/приоритет) — пока PvE-чек первым; отложить до режима с
  конфликтующими исходами.
□ AI-тактика — Фаза 5 опциональна; без неё волны спавнятся, но не атакуют.
  Рекомендация: скелет в этой итерации, тактику — следующей.
□ requiredMap — поле НЕ заведено (PVE-0.1): пока нет тегов карт, объявленное и
  никем не проверяемое требование хуже отсутствующего. Заводить поле и валидацию
  ОДНИМ кирпичом, когда теги карт появятся.
□ Баланс волн (N, intervalHours, сила спавна) — данные, тюнятся плейтестами,
  не код.
□ Награды по режиму: одинаковая ли мета-отдача за PvE и PvP (иначе фарм
  лёгкого).
□ uniqueUnits Роя — первая итерация переиспользует базовые; позже завести
  сигнатурные юниты (дроны, ульи).
□ Карта для PvE — нужна периферия для спавна волн; пока нет тегов карт,
  requiredMap опционален.
```

---

_Документ описывает план реализации PvE и командных режимов. Дизайн режимов —
в `docs/game-modes-roadmap.md`; ADR решений — в `docs/explanations/05`/`06`;
карта модулей — в `CODE-MAP.md`._