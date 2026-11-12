---
name: new-module
description: Каркас новой игровой механики как модуля ядра (shared-core) — GameModule, onAction/on/hook/provideCapability, детерминизм, чистота, fail-secure, payload-схема, co-located тест и регистрация в MODULES/DEV_MODULES. Используй, когда просят «новую механику», «новый модуль», «добавить правило/фичу в ядро», «новый action игрока», «новый хук», «capability», «взять кирпичик [core]» из docs/backlog.md — и так же для «new game mechanic», «new core module», «add a module/feature to the core», «new action type», «add a hook», «take a [core] brick». Триггерься даже если запрос звучит просто («сделай, чтобы станция давала +10% добычи») — в этом проекте такие правила живут в модулях, а не в ядре. Для голого «взять кирпичик» без зоны используй скилл `brick` — он выберет задачу и при необходимости приведёт сюда.
---

# Новый модуль ядра

Новая механика = новый модуль + (возможно) новые данные в `data/*.json`; ядро
(`packages/shared-core/src/kernel/`) не трогается — это главная ставка проекта
(`docs/modulesystem.md`). Если задача заставляет править `kernel.ts`, остановись и
обсуди: почти всегда нужен новый хук/событие, а не новая машинерия.

## 1. Сначала прочитай, потом пиши

- `packages/shared-core/src/kernel/module.ts` — контракты `GameModule`,
  `ModuleSetupApi`, `HandlerContext` (это ~80 строк, читаются целиком).
- `docs/modulesystem.md` — три механизма шины и правило изящной деградации.
- Образец под задачу: `modules/station.ts` (короткий `onAction` + `emit`),
  `modules/sector.ts` (чистые хуки), `modules/heroEffects.ts` (`provideCapability`),
  `modules/movement.ts` (`h.schedule` + `api.on` на отложенное событие).
- Проверь, что механика не принадлежит существующему модулю: в
  `packages/shared-core/src/modules/` их уже больше пятидесяти (таблица — `CODE-MAP.md`).

## 2. Форма модуля

```ts
export const myModule: GameModule = { id: 'my', version: '1.0.0', setup(api) { … } };
```

`setup(api)` вызывается один раз при сборке ядра; после этого таблицы диспетчера
заморожены. `id` + `version` попадают в `kernel.manifest` — версионируемую запись
матча, по которой replay воспроизводится байт в байт. Меняешь поведение модуля
несовместимо — поднимай `version`.

## 3. Четыре механизма регистрации (и только они)

| Механизм | Для чего | Что будет без модуля |
| --- | --- | --- |
| `api.onAction(type, h)` | намерение игрока | ядро вернёт `E_UNKNOWN_ACTION` |
| `api.on(eventType, h)` | реакция на событие | событие безвредно гаснет |
| `api.hook<T>(name, fn)` | вклад в вычисление значения | вернётся base-значение |
| `api.provideCapability(name, impl)` | опциональная связь | `h.capability()` → `undefined` |

**Модули никогда не импортируют друг друга.** Нужны данные соседа — спрашивай
`h.capability('diplomacy')` и имей запасной путь; нужно повлиять на его расчёт —
подпишись на его хук (`fleet.speed`, `combat.damage`, `economy.production`,
`research.slots`, `construction.requirement`, `victory.score`). Именно отсутствие
прямых связей даёт свойство «нет модуля → база, а не падение»; прямой импорт
превращает опциональный модуль в обязательный и ломает манифесты режимов игры.
ESLint это ловит: из соседнего модуля можно взять только ТИПЫ, общие чистые хелперы
живут в `state/` или `util/`.

Ядро подстраховывает это само: `hook` без контрибьюторов возвращает `base`
(`Kernel` в `kernel.ts`), событие без подписчиков гаснет. Дубликаты запрещены — второй
`onAction` на тот же тип или второй `provideCapability` на то же имя бросают
исключение при сборке ядра (см. конструктор `Kernel`). Один тип действия — один
обработчик; расширяют его хуками и событиями, а не вторым обработчиком.

## 4. Скелет (по образцу `modules/station.ts`)

```ts
import type { GameModule, HandlerContext } from '../kernel/module';

const COOLDOWN_MS = 3_600_000; // час игрового времени

export const beaconModule: GameModule = {
  id: 'beacon',
  version: '1.0.0',
  setup(api) {
    api.onAction('beacon.light', (action, h: HandlerContext) => {
      const { planetId } = action.payload as { planetId?: string };
      if (typeof planetId !== 'string') return h.reject('E_BAD_PAYLOAD');
      const node = h.state.planets[planetId];
      // Отсутствует ИЛИ не твой → ОДИН код: разные коды дают клиенту side-channel
      // «существует ли объект» (A06 — см. util/fleet.ts, requireOwnedIdleFleet).
      if (!node || node.owner !== action.playerId) return h.reject('E_NO_PLANET');

      node.traits.push('beacon');                    // правка идёт в draft, не в вход
      h.emit('beacon.lit', { planetId, owner: action.playerId });
      h.schedule(h.ctx.now + COOLDOWN_MS, 'beacon.expire', { planetId });
    });

    api.on('beacon.expire', (event, h) => {
      const { planetId } = event.payload as { planetId: string };
      const node = h.state.planets[planetId];
      if (!node) return;                             // мир изменился — молча выходим
      node.traits = node.traits.filter((t) => t !== 'beacon');
    });

    api.hook<number>('fleet.speed', (speed, args, h) => {
      const to = (args as { to?: string }).to;
      const node = to ? h.state.planets[to] : undefined;
      return node?.traits.includes('beacon') ? speed * 1.1 : speed; // иначе — база
    });
  },
};
```

Обрати внимание: у хука всегда есть выход «верни `speed` как есть» — хук, который
не умеет ничего не делать, ломает деградацию.

## 5. Инварианты, которые обязан держать обработчик

- **Детерминизм.** Никаких `Math.random()` и `Date.now()`: случайность — `h.rng`,
  время — `h.ctx.now`. Запрещены и неточно-округляемые `Math.*` (`pow`, `log`,
  `sin`, `hypot`, …) — они расходятся между движками и десинхронизируют превью
  клиента с сервером. Всё это ловится `eslint.config.js` (секция для
  `packages/shared-core/src/**`) и правилами `.semgrep/rules/core-no-math-random.yaml`,
  `core-no-date-now.yaml`, `core-no-node-builtins.yaml` в CI (`security.yml`).
  Node-встроенные модули в non-test коде ядра тоже под запретом.
- **Чистота.** `h.state` — это уже клон входного состояния; правь его свободно, но
  никогда не тяни настоящий вход. `GameState` уходит в БД как JSONB, поэтому в него
  кладут только JSON: без `Map`, `Set`, `Date`, классов и функций.
- **Fail-secure.** Любая проверка не прошла → `h.reject('E_…')` со стабильным кодом
  и без деталей: код уходит клиенту, подробности — в лог сервера. Неожиданный throw
  ядро превратит в `E_INTERNAL` (`kernel.ts`) — это страховка, а не рабочий путь.
  Отложенное событие, чей обработчик бросил, dead-letter'ится в `failures`, поэтому
  таймлайн не встаёт: пиши обработчики событий терпимыми к исчезнувшим сущностям.

## 6. Действие игрока → схема payload

Новый клиентский action не пройдёт шлюз, пока для него нет схемы: добавь запись в
`packages/shared-core/src/actions/payloadSchemas.ts` (zod v4) и имя типа в
`CLIENT_ACTION_TYPES` в `payloadSchemas.test.ts`. Тип без схемы
`isValidActionPayload` считает несабмиттабельным — так внутренние отложенные события
недоступны клиенту by design. Схема покрывает только поля, которые читает
обработчик: она не строже handler'а, лишние ключи игнорируются.

## 7. Имена ключей в payload события — это контракт фога

Сервер решает, кому показать событие, **по именам ключей payload**
(`eventVisibleTo`, `packages/server/src/eventFog.ts`):
адресат — `owner`/`playerId`/`a`/`b`/`from`/`to`/`buyer`/`seller`; место —
`location`/`planetId`/`at`; владение флотом — `fleetId`; бой — `battleId`. Назовёшь
адресата `target` или `recipient` — событие скроется от игрока (fail-closed: утечки нет,
но и уведомления нет). Гейт это ловит: `packages/server/src/eventFogContract.test.ts`
сканирует `h.emit` во всех модулях и краснеет на событии без маршрутизируемого ключа.

## 8. Тест рядом с исходником

Клади `modules/<name>.test.ts` рядом (`vitest.config.ts` в корне их находит).
Опирайся на `modules/station.test.ts`: собери мини-`GameData` через `parseGameData`,
подними kernel из **одного** своего модуля (это и есть доказательство изоляции),
проверь happy path, каждый код отказа и — обязательно — что вход не мутирован:
`kernel.applyAction(deepFreeze(world()), act, ctx())` (`deepFreeze` из `../util/clone`).
Если механика раскрывается в связке, добавь кейс с `createKernel([myModule, other])` —
так проверяется шина, а не импорт.

Прогон одного файла: `pnpm vitest run packages/shared-core/src/modules/<name>.test.ts`.

## 9. Регистрация: порядок — это поведение

Экспортируй модуль из `packages/shared-core/src/index.ts` (секция «Base modules») и
впиши в **один** список модулей игры — `GAME_MODULES` в
`packages/shared-core/src/gameModules.ts` (SLIM-4). Его берут оба хоста: прод-хост
игроков через `prototype/src/protoKernel.ts` и канонический сервер через
`packages/server/src/scenario.ts`; своих списков у них больше нет.

Позиция в массиве = приоритет исполнения (инвариант #6): в этом порядке идут
подписчики событий и звенья хук-конвейера, и он же записан в `kernel.manifest`.
Вставка в середину меняет результат уже идущих матчей — выбирай место осознанно и
объясни его комментарием рядом, как это сделано для `orbital → combat`.

Правка состава или порядка — это ещё две обязательные правки в том же PR:

- подними `MODULE_MANIFEST_VERSION` в `packages/server/src/scenario.ts` (комментарий
  рядом — что поменялось) и перезакрепи список в `moduleManifest.test.ts`;
- добавь пару соло-сохранений в `decisions/soloSaveMigration.ts`: новый граф модулей
  меняет отпечаток правил, и без пары локальная схватка прошлого выпуска перестанет
  читаться. Сторож — `prototype/src/soloSaveMigrationWiring.test.ts`. То же нужно,
  когда модуль меняет правила без смены состава (поднял `version`).

## 10. Финал

Прогони `pnpm run check` (lint + typecheck + test + docs-check). Затем, по правилу
«code first, docs after», обнови `docs/state.md` — переписав устаревшее утверждение,
а не дописав абзац рядом. Один модуль ≈ один кирпичик из `docs/backlog.md` ≈ один PR
в отдельной ветке от `main` (регламент — `CONTRIBUTING.md`).
