# CLAUDE.md

Guidance for working in this repository. This file is loaded into every session, so it holds
only the invariants and the non-obvious traps; the step-by-step rituals live in skills
(`.claude/skills/`, table in `CONTRIBUTING.md`). Where code lives and what actually runs —
`CODE-MAP.md`; what is already built — `docs/state.md`; how to find the rest — «Fast
navigation» in `AGENTS.md`.

## Язык общения

**Отвечай пользователю по-русски.** Это про ОБЩЕНИЕ: сообщения в чате, объяснения,
вопросы, отчёты о сделанном, тексты коммитов и описания PR. Правило не меняет язык
самого репозитория: комментарии и doc-строки в коде пишутся в стиле файла, который
правишь (в `packages/**` это английский), а текст для игрока живёт только в
`/localization` по ключу — см. раздел «Локализация» ниже.

## What this is

Void Dominion — a mobile, **real-time**, massively-multiplayer space grand strategy
(Bytro-style genre, original everything). Real-time means continuous wall-clock time
that runs 24/7 even while the player is offline — **not turn-based**; "asynchronous"
describes the play pattern (drop in, issue orders that take real hours, drop out). The
whole bet is a **flexible, extensible core**: add mechanics/units/factions through data,
not by rewriting logic.

Monorepo (pnpm workspaces):

- `packages/shared-core` — the deterministic, data-driven simulation (no server, DB or
  network) — the foundation the rest builds on.
- `packages/action-layer` — the action gate in front of the reducer: envelope validation →
  per-type zod payload schemas → session authorization → idempotency receipts → strict
  per-session `clientSeq`; stable `E_*` codes.
- `packages/server` — the authoritative server (`MatchRoom`, Postgres store, offline
  scheduler, JWT auth; switched by env `AUTH_JWT_SECRET`, `GATE=1`, `ALLOWED_ORIGINS`).
  Players actually reach the prototype host `prototype/netserver.ts`, which carries the same
  slice: the Docker image runs it as `packages/server/dist/proto-server.mjs`.
- `packages/client` — the PWA-first client meant to replace the prototype (decision record:
  `docs/cross-platform-roadmap.md`). Players still play `prototype/`. `mobile/` — the thin
  Capacitor wrapper (APK).
- `packages/protocol` — the server↔client wire contract, declared ONCE (NETA2-4). The client
  imports it and never `@void/server`, so no server code reaches the browser bundle.
- `decisions/` — **корневая папка, НЕ пакет**: чистые решения, общие обоим клиентам
  («что показать вместо списка», «можно ли нажимать кнопку»): чистая функция + типы + тест
  рядом, без DOM, сети и таймеров (`decisions/README.md`). Клиенты импортируют её
  относительным путём, как `/localization`. **Заводя клиентское решение, клади его СЮДА, а
  не внутрь `prototype/src`**: решение внутри прототипа улучшает ровно тот клиент, который
  планируется заменить. Правила МИРА сюда не кладут: они в `packages/shared-core`.
- `data/` — game content as JSON. `docs/` — design docs.

## Commands

```bash
pnpm install
pnpm run check        # lint + typecheck + test + docs-check — run this before committing
pnpm test             # Vitest
pnpm run lint         # ESLint (flat config)
pnpm run typecheck    # tsc --noEmit, all packages
pnpm run format       # Prettier --write
```

`pnpm run check` is the gate CI mirrors. Its docs-check (`scripts/docs-check.mjs`) is the
executable part of «verify docs against reality»: `.md` links in `docs/`, backlog zones,
brick statuses, live `🔒(ID)` blockers and the generated indexes. `main` is protected:
changes land via PR with green required checks and the merge queue. Workflows in
`.github/workflows/`: `ci.yml` (the gate against a service Postgres), `security.yml` (the
scanners), `image.yml` (the signed prod image), `android.yml` (the APK). Required checks and
the queue — `CONTRIBUTING.md`; scanners and image signing — `docs/security/pipeline.md`.

## Non-negotiable invariants

These come straight from the design docs. Breaking them is a bug, not a style choice.

1. **Determinism.** `shared-core` is a pure function: same `(state, action, context)`
   → same result. No `Math.random()` and no `Date.now()` anywhere in the core — use
   the seeded `Rng` and take time via `Context.now`; implementation-approximated `Math.*`
   (`sin`, `exp`, `pow`…) is banned too. ESLint enforces this in
   `packages/shared-core/src/**` (non-test). The RNG stream is locked by a golden
   test (`rng.test.ts`); if you intentionally change the algorithm, update the golden
   values, and understand it invalidates replays of existing matches.
2. **Purity / immutability.** `applyAction` never mutates its input `state`. It works
   on a `deepClone` draft and returns a new state. `GameState` must stay
   JSON-serializable (it is persisted as JSONB) — no class instances, Maps, Dates, or
   functions inside it.
3. **Modules talk only through the bus.** No module imports another module. The three
   mechanisms are events (pub/sub reactions), hooks (value pipelines with a base
   default), and the capability registry (optional links with a fallback). Every
   extension point must degrade gracefully: no module present → base default, never a
   crash. See `docs/modulesystem.md`.
4. **Fail-secure (OWASP A10).** Any error → rejection, never a silent pass. The reducer
   returns `{ ok: false, code }` with a stable error code only — no internal detail
   leaks to the caller (details belong in server logs). `h.reject(code)` is the
   intended path; unexpected throws become `E_INTERNAL`.
5. **Server-authority.** The client sends intent, never state. Validation/authorization/
   idempotency live in the action layer (`@void/action-layer`, wired in front of the reducer
   on gated servers); the core reducer assumes an action already cleared those gates.
6. **Determinism of module order.** Module execution order = their order in the one list
   `GAME_MODULES` (`packages/shared-core/src/gameModules.ts`) passed to `createKernel`,
   recorded in `kernel.manifest` and versioned per match. Don't introduce order-dependent
   behavior that isn't driven by that fixed order.

## Architecture quick map

`createKernel(modules)` compiles an immutable kernel from an ordered module list. It
exposes two pure entry points:

- `applyAction(state, action, ctx)` — apply a player's intent at `ctx.now`.
- `advanceTo(state, ctx)` — move the world clock to `ctx.now`, firing due scheduled
  events in `(at, seq)` order and emitting a contiguous `time.advanced` { from, to }
  event for each continuous span (so modules accrue resources by formula, not ticks).
  Real-time server flow: `advanceTo` to the present, then `applyAction`.

A module's `setup(api)` registers: `onAction(type, h)` (one handler per type),
`on(event, h)`, `hook(name, fn)`, `provideCapability(name, impl)`. Handlers receive a
`HandlerContext` with the draft `state`, `ctx` (now + validated game data), the `rng`,
`emit`, `schedule(at, type, payload)` (express a future occurrence / real-time
duration), `hook`, `capability`, and `reject`. A scheduled event whose handler throws is
dead-lettered (dropped, recorded in `failures`) so the timeline never gets stuck.

New game mechanic = new module (subscribe to events + register hooks) + maybe new JSON
data. You should not need to touch the kernel. Skills: `new-module` (module list, manifest
version, old saves), `add-game-content` (data).

## Toolchain notes / gotchas

- **zod v4** is installed. Use the two-arg `z.record(keySchema, valueSchema)` form.
  `safeParseGameData` returns `z.ZodSafeParseResult<GameData>`.
- **`shared-core/tsconfig.json` sets `types: ["node"]`** so tests can read `data/*.json`
  via `node:fs`. This is for typechecking convenience only — the core's no-Node/
  no-`Date` discipline is enforced by ESLint, not by withholding the types. Don't import
  Node built-ins from non-test `shared-core/src` files.
- Game data is split into `data/*.json` fragments + `data/manifest.json` (version).
  `composeGameDataBundle` (`packages/shared-core/src/data/loadGameData.ts`) composes them
  into one bundle that goes through `parseGameData`. All external data is validated before
  it reaches the core (A05/A08).
- Tests live next to source as `*.test.ts`. The root `vitest.config.ts` discovers them.
- **Size guard** (`scripts/codeSize.test.ts`, brick SLIM-1): a source file over 1000 lines or a
  function over 300 lines passes the gate only through `scripts/code-size-budget.json`, whose
  ceilings are today's sizes. Don't add to a monster: put new code in its own module. Raising a
  ceiling is an explicit budget edit with the reason in the PR body; when code shrinks by 100+
  lines (functions: 50+), lower the ceiling in the same PR. Tests, `.d.ts` and locale files are
  not measured. A function already on the budget list is cut when a feature touches it, in that
  same PR (SLIM-6), not in a separate refactoring campaign.

## Локализация — читай ДО того, как напишешь игроку хоть одно слово

**Правило: в коде нет человекочитаемого текста. В коде есть КЛЮЧ.** Весь текст, который
видит игрок, живёт в корневой папке `/localization`: одна локаль = один файл (`ru.ts` —
источник, `en.ts`, `de.ts`, `pl.ts`, `es.ts`), плоская карта `ключ → текст`. Рантайм один
на прототип и клиент — `localization/core.ts`; своей копии `t()` не заводи. Порядок работы,
канон формулировок и что ловит каждый тест гейта — скилл `localization`: он нужен на ЛЮБУЮ
задачу, где игрок что-то читает, даже если слово «локализация» не прозвучало.

```ts
t('err.no-capacity')            // → «трюм полон» / “the hold is full”
t('fleet.eta', { n: 3 })        // '{n}' подставляет живое значение
t('side.world.fleet-ships', { n: 5 })  // '{n} {n|корабль|корабля|кораблей}' — слово по числу
tData('Metal Mine')             // ИМЯ игровых данных → ключ data.metal-mine
```

- **Новый текст = сначала ключ в `ru.ts` + `en.ts`, потом `t('ключ')` в коде.** Гейт
  (`prototype/src/i18n.test.ts`) роняет сборку на ключе, которого нет в обеих локалях, и на
  русском литерале внутри `t()`: такая строка доехала бы до игрока как есть.
- **Формат ключа:** `домен.сущность.аспект`, kebab-case внутри сегмента.
- **Слово при числе — формами в строке локали** (`{n|корабль|корабля|кораблей}`), а не
  одной: «{n} кораблей» — это «1 кораблей» у игрока.
- **Имена игровых ДАННЫХ остаются английскими** (`name: 'Metal Mine'`), русский текст —
  ключом `data.*`: `dataKey()` вырезает всё, кроме `[a-z0-9]`, и русское имя схлопнется в
  недостижимый ключ `data.`.
- **Канон формулировок** (резолюция владельца 2026-09-21, TXT-0.1): функциональный текст
  несёт только нужную информацию — число, радиус, длительность, а не прозу. Обязателен для
  НОВОГО текста и не мандат переписывать старый попутно. Шесть правил и эталоны — §3 скилла.
- **В `packages/server` нет `t()` и `/localization`.** Текст, который увидит игрок
  (push, письмо), сервер не сочиняет: только строка, уже локализованная под этого игрока,
  числа без слов (`+3`, а не «ещё 3 события») или ключ, который адаптер хоста в `scripts/`
  переводит на язык получателя. Подробно — §5 скилла.

## Working agreements

- **Code first, docs after (current experiment).** Before changing anything, sync with
  the code you'll touch (read the relevant modules/data). Make the change and get the
  gate green, _then_ update the state artifact (`docs/state.md`) so it matches what
  actually landed — documentation follows the working code, not the other way around.
- **Reconcile, don't append.** When updating `docs/state.md` (or any living doc),
  RESOLVE what the new text supersedes — rewrite or delete the stale claim — instead
  of appending a fresh paragraph next to an old truth. Two live versions of one fact
  are worse than none: the anchor only works while every claim in it is current.
- **Verify docs against reality before writing them.** Any documentation change or new
  doc is gated on checking it against the actual code/behaviour first: read the source,
  run the gate, confirm names / counts / signatures. Never document from memory or
  assumption; if a claim can't be verified against the codebase, don't write it.
- When you finish a roadmap milestone, update the "Статус реализации" section in
  `docs/roadmap.md`.
- **Publication.** On any request to push/publish/create a PR, follow the `publish-pr`
  skill: one write transport (in hosted sessions the connected GitHub API/app; after one
  auth or MCP transport failure, no retry), a final sync with fresh `main` right before the
  PR, the preflight, a draft while edits are expected. **Never enable generic auto-merge or
  enqueue a normal PR by hand**: `.github/workflows/automerge.yml` queues eligible ready PRs
  after required checks, and a queued branch is frozen (`docs/pr-merge-rule.md`).
- **Subscribe to every PR you open, right after opening it** (`subscribe_pr_activity`),
  and stay on it until it is merged or closed. Owning a PR means driving it to green:
  on a CI failure either push a fix or reply in the thread with the concrete blocker —
  never end a red-CI wake silently. Same for review comments: address them or say why
  not. Webhooks don't reliably deliver CI success, new pushes, or merge-conflict
  transitions, so also schedule a self check-in (`send_later`, ~1h) and re-arm it
  quietly while nothing changes — a check-in that finds no news must not ping the owner
  or comment on the PR. Unsubscribe once it merges or closes.
- **Team workflow & tasks.** `main` is the only integration point — branch off it,
  keep PRs small and single-zone, get the gate green, PR back to `main`. Full regimen
  is in `CONTRIBUTING.md`. The assignable task list ("кирпичики", one brick ≈ one PR ≈
  one session) is `docs/backlog.md` — take a brick scoped to one package/module so
  parallel work can't collide (skill `brick`).

## Behavioral guidelines

Accepted team rules (guards against common LLM coding mistakes). They bias toward
caution over speed; use judgment on trivial tasks.

1. **Think before coding.** State assumptions. If multiple interpretations exist,
   surface them instead of picking silently. If a simpler approach exists, say so.
   If something is unclear, stop and ask.
2. **Simplicity first.** Minimum code that solves the problem — nothing speculative:
   no abstractions for single-use code, no unrequested configurability, no error
   handling for impossible cases. _Project nuance:_ the architecture's extensibility
   (data-driven content, modules, hooks) is an explicit requirement — those designed
   extension points are "asked for"; the rule bars speculative complexity _within_ a
   unit, not the planned seams.
3. **Surgical changes.** Touch only what the task requires. Don't refactor or
   reformat unrelated code; match existing style; mention unrelated dead code rather
   than deleting it. Remove only orphans your own change created.
4. **Goal-driven execution.** Turn the task into a verifiable goal and loop until it
   passes — usually: write/extend tests, then make them green. `pnpm run check` is the
   gate.
