# Defense-in-Depth — анализ защиты в глубину — 2026-07-26

> Оценка того, **построена ли** защита в глубину (defense-in-depth) в приложении
> Void Dominion — не только в пайплайне сканеров (это `scanner-coverage-2026-07-26.md`
> и `pipeline-architecture-2026-07-26.md`), а в самом приложении: от периметра к ядру.
> Сверено с кодом: `packages/shared-core/src/**`, `packages/action-layer/src/**`,
> `packages/server/src/**`, `packages/client/src/**`, `docs/security/security-master-plan.md`.
>
> **Контекст стадии:** альфа, нет прода/пользователей, крит-путь к играбельности.
> Auth/gate/TLS/seat-lock — opt-in через env, off по умолчанию (осознанно, см. §4).

---

## 1. Карта слоёв (от периметра к ядру)

```
┌─ Периметр / транспорт ──────────────────────────────────┐
│  Origin allowlist · JWT join-token · TLS (opt-in)        │  wsServer.ts
├─ AuthN ─────────────────────────────────────────────────┤
│  scrypt пароли · session-JWT → короткий join-JWT         │  auth.ts, authApi.ts
│  per-IP rate-limit · uniform 401 · decoy timing          │
├─ AuthZ / сессии ────────────────────────────────────────┤
│  seat-lock (ticket hash) · single-peer-per-player        │  wsServer, matchRoom
│  entry window · E_SLOT_TAKEN · E_FORBIDDEN               │
├─ Action gate (action-layer) ────────────────────────────┤
│  envelope v1 → zod payload → session authz →            │  action-layer
│  idempotency receipts (FIFO) → strict clientSeq (LRU)   │
├─ Редьюсер (shared-core) ────────────────────────────────┤
│  fail-secure E_* · deepClone (immutable) · seeded RNG    │  kernel, modules
│  determinism (ESLint + golden) · JSON-serializable      │
├─ Туман войны (security boundary) ───────────────────────┤
│  visibleState per-player · fog-on-send (не на клиенте)  │  visibility, matchRoom
│  event visibility filter · radar signatures             │
├─ Persistence ───────────────────────────────────────────┤
│  commit-before-broadcast · Postgres JSONB ·             │  matchRoom, persistence
│  optimistic seq · hashGameDataBundle (MP-4)             │
├─ Integrity / anti-cheat ────────────────────────────────┤
│  hashState (desync detect) · replay (RPL-1..4) ·        │  hash, replay
│  property/fuzz-тесты · dataHash на загрузке матча       │
└─ Game logic ────────────────────────────────────────────┘
```

**8 слоёв, ~30 контролов** — от сетевого периметра до игровой логики.

---

## 2. Что построено (сверено с кодом)

### Слой 1. Периметр / транспорт — 3 контроля

- **Origin allowlist** (`wsServer.ts` `allowedOrigins`) — CSWSH-защита: upgrade с
  незнакомым `Origin` отвергается (403) до открытия сокета. При `auth` — обязательно.
- **JWT join-token** (`auth.ts` `verifyJoinToken`) — `?token=` единственная identity
  при `auth`; `?player=`/`?nick=` отказываются. Claim `matchId`/`playerId` сверяется.
- **TLS** (`tlsFromEnv`, `RS-5.1`) — native TLS (`TLS_KEY_FILE`/`TLS_CERT_FILE`) или
  прокси; `PROD=1` требует его. Частичный конфиг — fail-secure (throw, не silent downgrade).

### Слой 2. AuthN — 5 контролов

- **scrypt** (`password.ts`) — memory-hard KDF, не bcrypt/MD5. Настраиваемые параметры.
- **Session-JWT → короткий join-JWT** (`authApi.ts`) — разделение токенов по времени
  жизни: длинная session для API, короткий join для WS-handshake.
- **Per-IP rate-limit — ДВА слоя**, а не один (строка выше раньше называла их одним,
  сверено с кодом 2026-08-04):
  1. `@fastify/rate-limit` в **инкапсулированном scope** (`main.ts`: `scope.register(
     rateLimit, { max: 100, timeWindow: '1 minute' })`) — общий потолок на auth-поверхность;
  2. `slidingWindowIpLimiter` (`rateLimit.ts`) **внутри каждого обработчика** — свой,
     более тесный бюджет на `/auth/login`, `/auth/register`, `/auth/recover`, `/auth/reset`
     (и отдельно в `avaApi`, `corpApi`, `matchApi`, `pushApi`). Проверка РЕГИСТРИРУЕТ
     попытку: отклонённый запрос тоже тратит бюджет.

  > **CodeQL считает это отсутствием rate-limit — ложное срабатывание.** Запрос
  > `js/missing-rate-limiting` показывает `authApi.ts:188` и `:264` (`/auth/login`,
  > `/auth/reset`). Причина: его модель ищет известную мидлварь, применённую на пути,
  > который она умеет проследить, а у нас потолок ставится через `scope.register` в
  > инкапсулированном контексте, а per-endpoint проверка — самописная и вызывается первым
  > оператором обработчика. Ни то, ни другое модель не связывает с конкретным маршрутом.
  > Покрытие есть и проверено тестом `authApi.test.ts:151` («rate-limits per IP across
  > register+login, and the window resets»).
  >
  > Подавлять НЕ стали осознанно: `codeql-action` инлайн-комментарии `// codeql[...]`
  > не применяет (github/codeql#3293, #4511, #9383 — CLI умеет, действие нет), а
  > исключать правило целиком в конфиге значило бы потерять его на РЕАЛЬНО незащищённом
  > маршруте в будущем. CodeQL информационный, цена находки — две строки в отчёте;
  > цена неверного подавления — необнаруженная дыра.
- **Uniform 401** — одинаковый ответ на «нет пользователя» и «неверный пароль»
  (anti-enumeration).
- **Decoy timing** — одинаковая задержка на оба пути (anti-timing attack).

### Слой 3. AuthZ / сессии — 4 контроля

- **Seat-lock** (`wsServer.ts` `seatLock`) — sha256 ticket, `?ticket=` на реконнекте;
  `?player=` отказ. Только hash хранится, plaintext только у клиента.
- **Single-peer-per-player** (`matchRoom.ts` `singlePeerPerPlayer`) — два человека не
  могут командовать одним empire одновременно.
- **Entry window** (`admitNewSeat`, SES-2.3) — поздний приход ограничен реальным
  временем; реконнект своих не гейтится.
- **`E_FORBIDDEN`** — cross-player spoofing отвергается на action-уровне
  (`action.playerId !== playerId`).

### Слой 4. Action gate (`@void/action-layer`) — 5 контролов

Отдельный слой вне ядра — ядро остаётся чистым, gate стоит перед редьюсером.

- **Envelope v1** (`envelope.ts`) — структурная валидация конверта (schemaVersion,
  matchId, playerId, sessionId, clientSeq, actionId, action).
- **Per-type zod payload** (`payloadSchemas.ts`) — каждый action-тип имеет схему;
  неизвестный тип → `E_BAD_PAYLOAD`. 40+ схем.
- **Session authorization** (`authorizeActionEnvelope`) — match/player/session
  должны совпадать с session-claim.
- **Idempotency receipts** (`receipts.ts`) — FIFO-capped (10000), дедуп по `actionId`.
- **Strict clientSeq** (`sequence.ts`) — LRU-capped (50000), 1,2,3…;
  `E_REPLAY`/`E_OUT_OF_ORDER`.

### Слой 5. Редьюсер (`shared-core`) — 4 инварианта

- **Fail-secure** — любая ошибка → `{ok:false, code}` со стабильным `E_*`, без деталей
  наружу (`Rejection`, `E_INTERNAL`). Dead-letter для упавших scheduled events.
- **Immutability** — `applyAction` работает на `deepClone`, не мутирует вход;
  `GameState` переживает JSONB.
- **Determinism** — seeded sfc32 RNG (golden-тест), `ctx.now` вместо `Date.now()`,
  ESLint банит `Math.random`/`Date.now`/трансцендентные `Math.*` в `shared-core/src/**`.
- **JSON-serializable** — `GameState` без классов/Map/Date (переживает JSONB round-trip).

### Слой 6. Туман войны как security boundary — 3 контроля

- **`visibleState`** (`visibility.ts`) — per-player проекция; сервер физически не
  отправляет невидимое. Не «шлёт всё и прячет на клиенте» — а режет на отправке.
- **Fog-on-send** (`matchRoom.ts` `broadcastState`) — delta считается per-player от
  своей baseline; скрытые миры/флоты не едут по проводу.
- **Event visibility filter** (`eventVisibleTo`) — события тоже fog-фильтруются по
  audience-ключам (`owner`/`playerId`/`a`/`b`/`from`/`to`/`buyer`/`seller`/
  `location`/`planetId`/`at`/`fleetId`).

### Слой 7. Persistence — 3 контроля

- **Commit-before-broadcast** (`matchRoom.ts` `persist`) — durable write → ack →
  broadcast; crash не теряет acked action. Actor-mailbox сериализует per-room.
- **Optimistic seq** (`initialSeq`) — восстановление счётчика при рестарте;
  optimistic-by-seq store не дропает пост-рестартные сохранения.
- **`hashGameDataBundle`** (MP-4) — fingerprint контента при создании матча
  (`GameVersion.dataHash`); при загрузке — сверка, отказ при подмене `data/*.json`.

### Слой 8. Integrity / anti-cheat — 4 контроля

- **`hashState`** (`hash.ts`) — детект десинка клиент↔сервер; клиент сверяет свою
  реконструкцию, при mismatch — `desync`-репорт + resync.
- **Replay** (`replay.ts`, RPL-1..4) — воспроизведение матча из лога; детерминизм =
  античит (одинаковый `(state, action, ctx)` → одинаковый результат).
- **Property/fuzz-тесты** (`applyAction.property.test.ts`,
  `advanceTo.property.test.ts`, `economyConservation.property.test.ts`) — fail-secure
  на враждебном мусоре, чистота/детерминизм frozen-vs-thawed, conservation.
- **`dataHash` на загрузке** (`serverWiring.ts`) — матч отказывается резюмироваться
  при подмене `data/*.json` (отказ, не краш).

---

## 3. Свойства глубины

**Graceful degradation.** Каждый слой деградирует: нет модуля → base default, не
краш. `diplomacyModule` отсутствует → `getStance` возвращает `DEFAULT_STANCE` (war).
`radarRange` нет → 0. `arsenal` нет → нет ограничения. Это инвариант #3 («только через
шину») — и он работает как defense-in-depth: падение одного контроля не открывает систему.

**Fail-secure на каждом слое.** Периметр: неизвестный Origin → 403. AuthN: ошибка → 401.
Gate: malformed envelope → `E_BAD_PAYLOAD`. Редьюсер: throw → `E_INTERNAL`. Persistence:
write fail → transient reject (no commit). Туман: не идентифицирован → не отправлен.
Integrity: hash mismatch → отказ загрузки. **Ни один слой не «пропускает» при ошибке.**

**Перекрытие слоёв.** AuthZ проверяется на 3 уровнях: gate (session authz) → matchRoom
(`action.playerId !== playerId`) → редьюсер (модули проверяют ownership). Даже если
gate пропустит (bug), matchRoom поймает; если matchRoom пропустит — модуль редьюсера
(`requireOwnedIdleFleet` и т.д.) отвергнёт. Это и есть depth — не один контроль, а
несколько независимых.

**Туман войны как граница доверия.** Сервер не отправляет невидимое — это не «клиент
прячет», а «сервер физически не шлёт». Значит: скомпрометированный клиент не может
прочитать то, что ему не положено, потому что он это **не получает**. Это сильнее
любого client-side obfuscation.

---

## 4. Что НЕ построено (честно)

| Контроль | Статус | Где зафиксировано |
|---|---|---|
| Auth/gate/TLS/seat-lock — **opt-in, off по умолчанию** | ⚠️ «построено ≠ включено» | `security-master-plan.md` §2 |
| Anti-cheat rate-shaping / anomaly detection | 🔒 не построено | `GI-0.1`, `GI-1.x` |
| Anti-мультиаккаунт / боты | 🔒 не построено | `GI-2.x` |
| Durable action-log для audit-replay | 🔒 не построено | `RPL-5`, `PE-1.1` |
| Секрет-стор / ротация | 🔒 не построено | `SE-2.x` |
| БД-хардненинг / бэкапы / DR | 🔒 не построено | `SE-3.x`, `SE-9.x` |
| Alerting | 🔒 не построено | `SE-8.x` |
| OIDC-identity | 🔒 не построено | `accounts-roadmap` |
| CSP / Trusted Types | 🔒 не построено | `SE-7.x` |

**Главный разрыв — не «нет слоёв», а «построено ≠ включено».** Auth, gate, TLS,
seat-lock — opt-in через env (`AUTH_JWT_SECRET`, `GATE=1`, `SEAT_LOCK=1`, `PROD=1`),
по умолчанию off. Реально играбельный путь (`pnpm host`) пускает по нику без пароля.
Это **приоритет №1** перед продом — не «достроить слои», а «включить существующие».

---

## 5. Оценка

**Defense-in-depth построена для application-слоя (ядро → сервер → транспорт) —
8 слоёв, ~30 контролов.** Это **реальная** глубина, не декларация:

- каждый слой деградирует (нет модуля → base default, не краш),
- каждый слой fail-secure (ошибка → отказ, не пропуск),
- слои перекрывают друг друга (AuthZ на 3 уровнях),
- туман войны — граница доверия на отправке, не на клиенте.

**Слабость — не в глубине, а во включённости.** `security-master-plan.md` честно
фиксирует: «построено ≠ включено». Auth/gate/TLS/seat-lock — opt-in, off по умолчанию.
До прода — включить то, что уже построено (env-свичи), а не строить новые слои.

**Вердикт: defense-in-depth построена — 8 слоёв, ~30 контролов, с graceful
degradation и fail-secure.** Для альфы — выше среднего. До прода — включить
существующее (приоритет №1), потом достроить anti-cheat/detection (GI-*, SE-*).

---

_Сверено с кодом: `packages/shared-core/src/kernel/kernel.ts` (fail-secure,
dead-letter), `packages/shared-core/src/rng/rng.ts` (seeded sfc32), `packages/shared-core/src/state/visibility.ts`
(visibleState), `packages/action-layer/src/gate.ts` (envelope→payload→authz→dedup→seq),
`packages/server/src/wsServer.ts` (Origin allowlist, JWT, seat-lock),
`packages/server/src/matchRoom.ts` (commit-before-broadcast, fog-on-send, event filter),
`packages/server/src/auth.ts` (scrypt, JWT), `packages/server/src/password.ts` (scrypt),
`docs/security/security-master-plan.md` (разрыв «построено ≠ включено»)._