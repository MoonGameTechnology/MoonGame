---
name: determinism-audit
description: Аудит инварианта детерминизма симуляционного ядра Void Dominion — проверка, что shared-core остаётся чистой функцией (state, action, context) и что реплей/hashState/анти-чит не сломаны. Запускай, когда просят "аудит детерминизма", "проверь детерминизм", "не сломали ли реплей", "почему разъезжается hashState / desync", "audit determinism", "determinism check", "replay/desync investigation", "is the RNG stream still stable", а также перед мержем PR, который трогает packages/shared-core/src (kernel, rng, hash, replay, modules), список модулей (GAME_MODULES) или форму GameState; и при обновлении золотых значений RNG/hash.
---

# Аудит детерминизма ядра

## Почему это контроль целостности, а не чистоплюйство

Инвариант #1 (`CLAUDE.md`) звучит просто: одинаковые `(state, action, context)` →
одинаковый результат. На нём держатся три вещи, которых иначе просто нет:

- **Реплей.** `ReplayLog` (`packages/shared-core/src/replay/replay.ts`) хранит полный
  стартовый стейт (RNG внутри `state.rng`) и шаги `{at, action?}`; прогон через
  `runReplay` обязан дать тот же `hashState`. Одна недетерминированная строчка — и
  разбор жалобы «меня ограбили» становится невозможен.
- **Детект десинка.** `hashState` (`packages/shared-core/src/state/hash.ts`) — канонический
  дайджест мира; сервер и клиент сравнивают его, расхождение = миры разъехались. Если
  хеш нестабилен сам по себе, сигнал тонет в шуме.
- **Античит-пересчёт.** Золотое правило (`docs/architecture.md` §5): клиент только
  просит, сервер решает. Проверить намерение пересчётом можно, только если пересчёт
  воспроизводим бит-в-бит.

Поэтому находка «здесь недетерминизм» — дефект целостности, а не стилистика.

## Что уже держит инвариант машинно (не дублируй руками)

- **ESLint** (`eslint.config.js`, блок «Determinism guardrails»): для
  `packages/shared-core/src/**/*.ts` кроме `*.test.ts` запрещены `Math.random`,
  `Date.now`, глобальный `Date` и список **приближённых** `Math`-функций
  (`NON_DETERMINISTIC_MATH`: sin/cos/tan/exp/log/pow/hypot/cbrt/atan2 …) — они
  «implementation-approximated» в ECMA-262 и расходятся побитово между движками
  (сервер vs браузер/WebView). Ядро живёт в корректно округляемом подмножестве
  IEEE-754 (`+ − × ÷ √ min max floor ceil` + целочисленные операции); `Math.sqrt`
  разрешён намеренно.
- **Semgrep** (`.semgrep/rules/core-no-math-random.yaml`, `core-no-date-now.yaml`,
  `core-no-node-builtins.yaml`) — те же запреты плюс запрет Node-встроек, с теми же
  `paths: include: **/packages/shared-core/src`, `exclude: *.test.ts`. Гоняются в
  `.github/workflows/security.yml` (блокирующий сканер).
- **Тесты:** золотой RNG-стрим (`packages/shared-core/src/rng/rng.test.ts`), золотой
  дайджест (`packages/shared-core/src/state/hash.test.ts`), фаззы инвариантов
  (`kernel/applyAction.property.test.ts`, `kernel/advanceTo.property.test.ts`),
  контракт реплея (`replay/replay.test.ts`) и живой record→replay→hash на полном
  dev-стеке (`packages/server/src/replayDeterminism.test.ts`).

**Где машины не хватает — ради этого аудит и существует.** Правила ESLint и semgrep
ловят вызовы, но не смысл: порядок обхода `Record`, прямую запись в `state.scheduled`,
нефинитные числа в стейте, перестановку модулей. Всё, что исполняется в ядре, живёт в
`packages/shared-core/src`: с SLIM-4 оба хоста собирают ядро из одного `GAME_MODULES`
(`gameModules.ts`), своих модулей у прототипа нет. Код вне ядра (`prototype/src`,
`decisions/`) правилами детерминизма не покрыт: стейт он не правит, а шлёт действия.
Исключение по смыслу — боты (`prototype/src/ai.ts` и соседи): self-play воспроизводим по
сиду, только пока они не читают `Math.random`/часы, и это проверяется глазами.

## Процедура

### 0. Базовая линия

`pnpm run check` (lint + typecheck + test + docs-check). Красный гейт = аудит
бессмысленен, сначала чини гейт.

### 1. Источники недетерминизма в исполняемом ядре

```bash
grep -rn "Math\.random\|Date\.now()\|new Date(" packages/shared-core/src --include=*.ts | grep -v "\.test\.ts"
grep -rn "from 'node:\|require('node:" packages/shared-core/src --include=*.ts | grep -v "\.test\.ts"
```

В `shared-core` попадания ожидаются только в комментариях; живой вызов — находка
(линтер его уже должен был поймать, значит, кто-то обошёл правило). Время в ядро приходит только через
`Context.now`, случайность — только через `h.rng` (сид лежит в `state.rng`, поэтому
реплей воспроизводит стрим). Там же проверь приближённую математику
(`Math.pow/exp/log/sin/...`) в новых формулах боя и экономики — та же категория дефекта.

**Порядок ключей — тоже недетерминизм.** `hashState` сортирует ключи, но игровая логика,
зависящая от порядка вставки в `Record` (итерация `Object.keys`/`for...in` с побочными
эффектами), разойдётся между сервером и стейтом, восстановленным из JSONB или из дельты
(`applyDelta` порядок не сохраняет — см. комментарий в `state/hash.ts`). Итерируй по
явно отсортированному списку id, если от порядка зависит результат.

### 2. Золотые значения

- `packages/shared-core/src/rng/rng.test.ts` — `GOLDEN_VOID_DOMINION` пиннит первые 5
  значений sfc32-стрима для сида `'void-dominion'`.
- `packages/shared-core/src/state/hash.test.ts` — золотой дайджест фикстуры.

Оба должны быть **зелёными и неизменными в диффе**. Правка золотых значений — не
«обновил снапшот», а осознанный ломающий шаг: смена алгоритма RNG инвалидирует реплеи
всех существующих матчей, смена дайджеста — кросс-версийное сравнение хешей (десинк).
Изменены в PR — требуй явного обоснования в описании (в `hash.test.ts` для этого уже
ведётся строка «Last deliberate change»).

### 3. JSON-сериализуемость состояния (инвариант #2)

`GameState` persist-ится как JSONB, а `deepClone` (`packages/shared-core/src/util/clone.ts`)
умеет только JSON-формы. Значит `Map`, `Set`, `Date`, классы и функции в стейте не просто
«не рекомендуются» — они молча теряются при клоне/персисте и разводят миры.

Проверь новые поля `GameState`: сериализуются ли и не могут ли принять `NaN`/`Infinity`
(в JSONB → `null`). Прецедент защиты — `h.schedule` отвергает нефинитный `at` кодом
`E_BAD_SCHEDULE` (`kernel/kernel.ts`). Свойство «хеш переживает JSON-round-trip» уже
проверяется в `kernel/applyAction.property.test.ts` — новое поле подведи под ту же фикстуру.

### 4. Порядок событий — только `(at, seq)`

`advanceTo` при входе сортирует `scheduled` по `at`, затем `seq`, а `h.schedule` делает
вставку бинарным поиском (`scheduledInsertPos`) с `seq = draft.scheduleSeq++`, так что
голова массива — всегда ближайшее событие. Порядок `seq` — единственный тай-брейк для
событий одного инстанта; без него равные `at` дают произвольный порядок обработки.

```bash
grep -rn "scheduled\.push\|scheduled\.sort\|scheduled\.splice" packages/shared-core/src prototype/src --include=*.ts | grep -v "\.test\.ts"
```

Ожидаемое единственное попадание — сортированная вставка в `kernel/kernel.ts`. Любая
прямая запись в `state.scheduled` из модуля в обход `h.schedule` — находка: она обходит
и `seq`, и клэмп «событие не может уехать в прошлое».

### 5. Порядок модулей (инвариант #6)

Порядок исполнения = порядок массива, и только он: `Kernel` проходит модули `forEach` в
порядке массива и записывает `manifest`. Список один — `GAME_MODULES` в
`packages/shared-core/src/gameModules.ts`; `DEV_MODULES` (`scenario.ts`) и `MODULES`
(`protoKernel.ts`) — его псевдонимы. Ищи в диффе сортировку/фильтрацию массива, сборку
списка из `Set`/`Map`/`Object.keys`, условное добавление модуля по env: всё это делает
порядок неявным, а исход матча — зависящим от среды. Порядок смысловой (`orbitalModule`
штампует орбиту до `combatModule`), поэтому перестановка меняет исход боёв и должна быть
осознанным решением с подъёмом `MODULE_MANIFEST_VERSION`, а не побочкой рефакторинга.

### 6. Контрольный прогон

```bash
pnpm vitest run \
  packages/server/src/replayDeterminism.test.ts \
  packages/shared-core/src/replay/replay.test.ts \
  packages/shared-core/src/kernel/advanceTo.property.test.ts \
  packages/shared-core/src/kernel/applyAction.property.test.ts \
  packages/shared-core/src/state/hash.test.ts \
  packages/shared-core/src/rng/rng.test.ts
```

`replayDeterminism.test.ts` — самый сильный сигнал: живая `MatchRoom` на полном
dev-стеке и шипнутых данных, 48 игровых часов, затем реплей и сверка `hashState`
бит-в-бит (плюс JSON-round-trip лога). Если он зелёный, а подозрение осталось —
воспроизводи гипотезу отдельным тестом, а не рассуждением.

## Что находкой НЕ является

- `Date.now()`, `randomUUID`, `setTimeout` в `packages/server` и в UI-слое
  (`prototype/src/main.ts`) — это хост вокруг ядра: он и обязан читать часы и подавать
  время в ядро через `Context.now`.
- `Math.random`/`Date` в `*.test.ts` — правила их намеренно исключают.
- Расхождение накопленных ресурсов в float-пыль при разном членении интервала: движок
  обещает `coarse ≈ fine`, а не бит-равенство (см. шапку `replay/replay.ts` и
  `kernel/advanceTo.property.test.ts`). Именно поэтому границы `advance` пишутся в
  реплей-лог. Бит-равенство обязателен только для дискретного скелета.

## Формат отчёта

По каждой находке — четыре пункта, без воды:

1. **Где:** `путь/файл.ts:строка`.
2. **Инвариант:** #1 детерминизм / #2 чистота и JSON-сериализуемость / #6 порядок
   модулей (+ смежные: `(at, seq)`, приближённая математика).
3. **Почему ломает:** конкретный механизм расхождения — «реплей даст другой `hashState`»,
   «сервер и клиент разойдутся на этом движке», «события одного инстанта обработаются в
   произвольном порядке».
4. **Минимальная правка:** самая узкая, какая закрывает дыру (`Math.random()` → `h.rng`,
   `Date.now()` → `ctx.now`, `Math.pow(x, 2)` → `x * x`, запись в `scheduled` → `h.schedule`).

В конце — вердикт: чисто / находки с приоритетом. Аудит — это отчёт: не чини вне зоны
текущей задачи, правка идёт отдельным кирпичиком (`docs/backlog.md`) и отдельным PR по
регламенту `CONTRIBUTING.md`.
