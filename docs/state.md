# Состояние проекта — снапшот

> Живой «якорь контекста»: что готово, как работает, что дальше. Обновляется по
> мере разработки (после крупных изменений). Парные документы: `architecture.md`,
> `modulesystem.md`, `gdd.md`, `roadmap.md`, `backlog.md` (кирпичики задач),
> `deep-technical-roadmap.md`, `multiplayer.md`, `metagame.md`, `map-roadmap.md`, `security-a06.md` (модель угроз/A06), корневой `CLAUDE.md` / `CONTRIBUTING.md`.
>
> **Ветка:** feature-ветка · **PR:** создаётся после изменений.
> **Гейт:** `pnpm run check` (lint + typecheck + test + docs-check). **Тесты: 4368 зелёных** (58 skip, 338 файлов).

**Быстрый старт сессии** (навигация — факты живут в секциях и не дублируются здесь):

- Возобновить работу → **§11** (внизу) · статус этапов → **§9** · команды/качество → **§10**.
- Что брать в работу → `backlog.md` (кирпичики со статусами и зонами; 1 кирпич ≈ 1 PR).
- Инварианты и рабочие правила → корневой `CLAUDE.md` (Claude Code подгружает его сам).
- Как устроено ядро/сервер/прототип → §2–§7 этого файла; полный индекс доков → `README.md`.

---

## 1. Что это

Void Dominion — мобильная/браузерная **real-time** (непрерывное wall-clock время,
24/7, асинхронная игра) 4X космо-стратегия в духе Bytro (Iron Order). Ставка —
**гибкое, расширяемое ядро**: новые механики/юниты/фракции добавляются **данными
и модулями**, не переписыванием логики.

Монорепо (pnpm workspaces):

- `packages/shared-core` — детерминированная, data-driven симуляция. Без сервера/БД/сети.
- `packages/action-layer` — Stage 2 security gate: `ActionEnvelope`, validation, authorization, idempotency receipts, per-session `clientSeq`.
- `packages/server` — авторитетный сервер (Этап 3). WebSocket multiplayer slice: `MatchRoom`, `createMultiplayerServer`, action/state sync, per-player туман. Персистентность: `MatchStore`/`AccountStore`/`ReceiptStore` (in-memory + Postgres JSONB) — durable-матч переживает рестарт, durable receipts дедупят повтор после рестарта, ник-логин лобби. Offline-«будилка» (PA-4.1 v1): `MatchRoom.tick()`/`msUntilNextEvent()` + одно-процессный `setTimeout`-драйвер — отложенные события (прибытия/бои/захваты) срабатывают без подключённых игроков (мир идёт 24/7). Есть в обоих серверах: прото-сервер (`netserver.ts`, APK) с PA-4.1, боевой вход `packages/server/src/main.ts` — с F8 (`persistence.ts`+`clockDriver.ts`, паритет). Баг-фикс F8: `MatchRoom.initialSeq` восстанавливает счётчик действий при рестарте, иначе optimistic-by-seq store дропал пост-рестартные сохранения — прокинут в оба сервера. **Стоячие приказы, серверно (CC-2/CC-4):** `standingOrderDriver.ts` (`autoAssaultActions`/`patrolActions`) закрывает разрыв, который `clockDriver.ts`'s собственный doc-комментарий отмечал явно («the prototype host reads [onTick's `progressed`] to skip its AI/standing-order drivers on a stalled tick» — а канонический сервер до этого драйвер вообще не гонял); `serverWiring.ts`'s `onTick` вызывает его на каждом непроваленном (`progressed`) тике через `room.submitServerAction` (тот же путь, что AI/AvA-драйверы — мимо `ActionGate`, но через durable-mailbox на persist-пути), с `standingOrdersBusy`-флагом реэнтерабельности (зеркалит прототипный `driversBusy` из `netserver.ts`). CC-1 (`serverChainActions`, потребление головы цепочки) не портирован — отдельный, более крупный follow-up. Строгий commit-before-broadcast (risk14, опция `MatchRoom.persist`): действие идёт async-путём через актор-**mailbox** (сериализован per-room; туда же lobby-`start`), ждёт durable-запись снапшота+квитанции ДО коммита/рассылки (`computeAdvance` считает догон мира чисто, не трогая `stateValue` до ack); провал записи → транзиентный reject, ретрай доезжает; синхронный `submitAction` не тронут; прошёл 3-линзовый состязательный ревью. **SV-0.2 match-actor:** `RoomRegistry` (роутинг по matchId — N изолированных матчей/процесс, `InMemoryRoomRegistry` eager) + `LazyRoomRegistry` (lifecycle/risk13: ленивая загрузка по запросу + гибернация простаивающих в стор после idle-окна → live-память ∝ активным матчам; **пробуждение спящего матча к его следующему событию** — реорганизует+персистит+снова спит, мир идёт 24/7 при всех офлайн; таймер инжектируемый = шов под pg-boss; reconnect детерминированно догоняет). Рядом — браузерный `MatchRegistry` (`matchRegistry.ts`, main-menu §2): meta-состояние матчей (карта/правила/архив) с read-model `GET /matches` + archive-интентами (`registerBrowserApi` в `matchApi.ts`); структурно совместим с `RoomRegistry`, так что служит и источником комнат для транспорта (прото-сервер). DoS-границы (аудит F-03/F-04): карта `receipts` капается с FIFO-эвикцией (`maxReceipts`), действия — per-player rate-limit (`actionRateMax`/`actionRateWindowMs`, флуд → транзиентный `E_RATE_LIMIT` без квитанции, ретрай переживает). **SV-1.1 action-layer front-door (опционально):** `MatchRoom.gate?` подключает `@void/action-layer` `ActionGate` — gated-сообщение `action.v1` (конверт) проходит validate→authorize→sequence→dedup ДО редьюсера (стабильные `E_*` без утечки), а bare-`action` на gated-комнате отклоняется (нет обхода гейта); rate-limit стоит ДО резервации seq, поэтому троттлинг не сжигает `clientSeq` (ретрай доезжает, не `E_REPLAY`). `submitAction`/`admitEnvelope` делят общее ядро `applyAndBroadcast`, не перепроверяя чужие гейты. Абьюз-e2e (E3) зелёный (невалид/несанкц/replay/out-of-order → безопасный отказ; дубль → реплей без повторного применения). **Боевой вход (Fastify, SV-0.1):** `/health` без утечки id (**F-13**), `/ready` со стор-probe `MatchStore.ping`, pino, graceful drain — заменил голый node:http. **Аутентификация handshake (SE-0.1, **F-01**):** опция `auth` требует верифицированный join-токен (`?token=`); при ней `?player=`/`?nick=` игнорируются, `matchId`/`playerId` токена сверяются с матчем и местом; `allowedOrigins` (**F-06**) режет cross-site upgrade. Токены — `verifyJoinToken`/`signJoinToken` на `jose` с пином алгоритма (нет `none`/alg-confusion), `typ`, iss/aud/exp, опц. max-age (SE-2.1, прошёл состязательное ревью — verified против исходников jose). **Живой гейт:** транспорт минтит серверный `sessionId` (randomUUID — не клиентский, это ключ курсора seq), отдаёт в `welcome` и в `receive`; gated-envelope авторизуется против него, end-to-end (SV-1.1-live-A). Стора гейта ограничены — FIFO receipts + LRU cursors (SV-1.1-live-B, закрыл MAJOR из ревью). **Payload-схемы (SV-1.2 + REL-2, инвариант #5):** zod-схема на каждый из **45** клиентских типов действий — ПОЛНЫЙ интент-набор прототипа (вкл. артиллерию/отступление/рынок обоих хостов (`market.take`/`side`)/дипломатию/`fleet.launch`/`split`/`merge`/`engage`/капиталь/Хранителя/стоячие приказы/`unit.build{modules}`); `patrol.stamp` намеренно НЕ клиентский (рантайм-штамп серверного драйвера — клиентский штамп заправлял бы своё крыло); паритет закреплён `prototype/src/gateparity.test.ts` (сэмплы через реальные билдеры) (`shared-core/actions/payloadSchemas` + `isValidActionPayload`) инжектится в гейт как `payloadValidator` — кривой payload или не-клиентский тип → `E_BAD_PAYLOAD` до редьюсера. **Гейт на durable-пути (gate+persist):** принятое gated-действие коммитится-до-broadcast на durable-пути; весь admit→commit сериализован в mailbox (резервация seq и persist атомарны), при транзиентном сбое `SequenceGate.rollback` отпускает курсор → тот же `clientSeq` ретраится (не `E_REPLAY`). Прошло состязательное ревью (дизайн звучит; закрыт MAJOR — broadcast теперь per-player изолирован, не может застрять на throw). **Боевой вход:** `main.ts` включает auth/гейт по env (`AUTH_JWT_SECRET`, `GATE=1`, `ALLOWED_ORIGINS`), default off (live-C). **Мульти-матч (SV-4.0):** вход хостит N матчей через `LazyRoomRegistry` — матч грузится из стора по первому коннекту, гибернируется в простое, будится к событиям; `dev` сидируется на буте (реальный create — SV-2.4). **Вход игроков (SV-2.4 + SE-1.x, логин+пароль):** аккаунты `users` (Memory/Postgres, логин уникален без регистра), пароли scrypt (`node:crypto`, параметры вшиты в хеш), `POST /auth/register`/`/auth/login` → сессионный JWT (`typ session+jwt`, отдельная audience — невзаимозаменяем с join-токеном); uniform-401 + decoy-hash (не раскрываем существование аккаунта ни телом, ни таймингом), per-IP rate-limit. `POST /matches` и `GET /matches/:id/join` требуют `Authorization: Bearer <session>` — ник места = логин сессии (никем другим не зайдёшь), `accountId` штампуется в join-токен (15 мин); оба маршрута пишут durable-состояние (сид матча / занятие места), поэтому оба за per-IP sliding-window rate-limit (общий бюджет create+join, `E_RATE_LIMIT`/429, ограниченная FIFO-карта), как auth-эндпоинты. Сверх точечных лимитеров весь account+match-контур в `main.ts` обёрнут `@fastify/rate-limit` в инкапсулированном scope — грубый per-IP бэкстоп (health/ready на родительском app не троттлятся). Всё выставляется **только при включённом auth**; e2e прогнан вживую: register → login → Bearer-join → WS welcome. **Восстановление пароля (SE-1.x):** опц. email при регистрации (уникален по `lower(email)`); `POST /auth/recover` анти-энумерационен (всегда 200, письмо — только на реальный адрес), `POST /auth/reset` тратит single-use токен (`typ reset+jwt`, 15 мин, привязан к отпечатку `pwfp` текущего хэша — сменился пароль, токен мёртв, без серверного стора). Доставка — сменный `Mailer`: деф. пишет в stderr только `to`/`subject`, тело со ссылкой захвата — лишь под `MAILER_LOG_BODY=1`; реальный SMTP/API — отдельный env. Клиент вычищает `?reset=<token>` из URL/истории. **Ревокация при сбросе:** session-JWT несёт `pwfp`, `liveSession` сверяет его с текущим хэшем на гейте identity (create/join + corp/ava/medal/arsenal, оба сервера) → сброс пароля инвалидирует все прежние сессии (угнанную в т.ч.); `verify` требует непустой `pwfp` (fail-secure); остаток — уже открытый WS живёт до обрыва по 15-мин join-токену. Дальше по треку: refresh-токены (AC-0.2), OIDC как второй провайдер (AC-1.1). **Фабрика матчей (SV-2.5):** `MatchKeeper` держит `OPEN_MATCHES` (env, деф. 3) открытых матчей — как только один заполнился/закончился, засевается новый, так лента не пустеет и игрок всегда может зайти в свежую игру. Счёт открытых берётся из durable-стора (`MatchStore.ongoingMatchIds` + `occupiedSeats`), а не из in-process счётчика → рестарт реконсилит по реальному миру, не переплождая; кап на конкурентные матчи (`max`), reentrancy-guard, ошибка create/read проглатывается и ретраится следующим тиком. Реконсиляция на буте + интервал 30с. Публичная read-only лента `GET /matches/open` (id/seated/capacity из стора, переживает гибернацию — видит и спящие матчи) — браузинг до логина, join по-прежнему требует сессию. Прогнано вживую: `OPEN_MATCHES=3` → сервер добил до 3 открытых (посчитал `dev`, создал 2), все в `/matches/open`. **Метрики (OPS-0.1):** `/metrics` — агрегатные gauge'ы (число матчей/коннектов, без id). **Метрики M1 (metrics-roadmap):** observe-поток комнаты расширен наблюдениями `events` (доменные события коммита, без `time.advanced`), `broadcast` (ms + размер дельты per-player), `timing` (submit/advance) и `desync` (клиентский репорт); `MetricsAggregator` (`metrics.ts`) сводит их в счётчики/avg/max; на `desync`-сообщение комната отвечает полным `state`-ресинком с cool-down 2 с per-player (репорт наблюдается всегда — шторм виден в метриках, но не DoS). **Метрики M2:** клиентское сообщение `perf` `{fps,rttMs?,memMb?}` (клампы при parse, per-player rate-limit 5 с, только наблюдается — `client_perf`); headless перф-харнес `pnpm run perf` (CPU-стоимость кадра idle/pan/zoom против бюджета p95, нон-блок шаг в CI, `PERF_STRICT=1` — гейт). **Крит-путь до онлайн-сессии закрыт.** Пройден 3-линзовый ревью (корректность/безопасность/чистота): починен HIGH-баг живости (драйвер часов не пере-armился после committed-действия — вынес эмиссию `action`-наблюдения за окно `committing`); добавлен Fastify error-handler (инвариант #4, без утечки); ядро gate/session/JWT подтверждено безопасным. **Вектор 2 (надёжность) сделан:** durable-места (`createStores` отдаёт `PostgresAccountStore` при `DATABASE_URL` — ник→место переживает рестарт, 2.2); CI-workflow (`ci.yml`) с сервис-Postgres гоняет durable-адаптеры в CI + `configFromEnv` вынесен из `main.ts` и покрыт тестом round-trip mint↔verify (2.3). **Durable-стора гейта — НЕ нужны (2.1, verified):** они ключуются по per-connection `sessionId` (серверный, неповторимый), теряются ровно когда отслеживаемые сессии заканчиваются → переподключение минтит свежий `sessionId` → свежий курсор; персистить нечего. **Деплой одной командой (REL-3):** `pnpm stack` (= `docker compose -f deploy/docker-compose.yml up -d --build`) поднимает игровой сервер (distroless-образ: игра на `/`, WS, `/health`) + Postgres; отказоустойчивость — `restart: unless-stopped` на обоих, durable-резюме матчей из PG, healthchecks (server ждёт healthy-PG), bounded-логи, PG на loopback; runbook (обновление/бэкап+cron/восстановление/границы) — `deploy/README.md`. **Гейт на играбельном пути (REL-4):** прото-хост `prototype/netserver.ts` принимает `GATE=1|true` — комната получает тот же `ActionGate({payloadValidator: isValidActionPayload})`, что и боевой вход (зеркало serverConfig); в compose релиз-постура — `GATE` по умолчанию **ON** (`${GATE:-1}`, `GATE=0` — дев-откат к голым actions). Прогнано вживую в обе стороны: gated — `welcome{gated,sessionId}` → голый `action` отклонён (`E_BAD_MESSAGE`), `action.v1`-конверт того же клиента применён (delta); ungated — голый `action` применён (обратная совместимость). Серверные драйверы (ИИ/Хранитель/стоячие приказы) идут через `room.submitAction` МИМО гейта — так и задумано: гейт стоит на проводе, не внутри хоста. **Замок мест (REL-5, `SEAT_LOCK=1`, в compose по умолчанию ON):** ник-логин без аккаунтов защищён «посадочным билетом» — первый вход ника минтит случайный тикет (`randomBytes(24)`), транспорт хранит ТОЛЬКО его sha256 в `AccountStore` (`bindSeatTicket` — первый bind атомарно выигрывает, Memory и Postgres; колонка `seats.ticket_hash`, `ALTER … IF NOT EXISTS` — старые ряды дозамыкаются при следующем входе владельца), плэйнтекст едет клиенту один раз в `welcome.seatTicket` (`addPeer welcomeExtras`); каждый последующий вход обязан предъявить `?ticket=` (сравнение constant-time), иначе 401; прямой `?player=` под замком отклоняется (обход невозможен). Клиент самонастраивается: `MultiplayerClient.onSeatTicket` → прототип кладёт билет в `localStorage` (`void.ticket.<base>|<match>|<nick>`) и добавляет `&ticket=` при коннекте. Проверено: юнит-e2e транспорта (`seatLock.test.ts`), стор-контракт на Memory+Postgres 16 (включая миграцию старой схемы), живой raw-ws прогон и БРАУЗЕРНЫЙ CDP-прогон реального клиента (билет ложится в localStorage → реконнект пускает; удалили билет → тот же ник заперт). Потеря билета не запирает место навечно (NETA2-10): `AccountStore.resetSeatTicket(room, nick)`
(Memory+Postgres, store-контракт `store.test.ts`) чистит `ticket_hash` — следующий вход того
же ника минтит свежий билет тем же путём, что «место занято до появления замка». Без
самообслуживания: nick+ticket — единственная личность на этом безаккаунтном пути, так что
несанкционированный сброс = кража чужого места, а не восстановление своего — сброс
остаётся действием оператора (`deploy/README.md`, раздел «Замок мест — восстановление»). **`SEAT_LOCK` теперь и на боевом входе (MP-1):** `wsServer.ts` уже нёс опцию `seatLock` — `packages/server/src/main.ts` её просто не подключал (`createMultiplayerServer` шёл без неё); портирован тот же `SEAT_LOCK=1|true`-паттерн, что в `netserver.ts`, + строка `seats` в boot-логе. **Верификация целостности game-data (MP-4):** матч пинит `GameVersion.dataHash` (`hashGameDataBundle` — `shared-core`, тот же order-independent `hashJson`-примитив, что у `hashState`) при СОЗДАНИИ (`buildStateFromMap`/`createDevMatch` — единые точки создания, накрывают dev-матчи/фабрику/AvA/клиентский `skirmishState`); `serverWiring.ts` `createMatchLoader` при ЗАГРУЗКЕ пересчитывает хэш текущего задеплоенного бандла и сверяет с запиненным — расхождение (данные подменили под живым матчем) → отказ (`null`, тот же путь, что «матча нет» — без краша) + громкий stderr + опц. `onIntegrityFailure`; снапшоты без хэша (до MP-4) деградируют мягко. **Верификация манифеста модулей (инвариант #6, PR #434):** рядом с `dataHash` тот же загрузчик сверяет `state.version.manifest` с задеплоенным `MODULE_MANIFEST_VERSION` (`scenario.ts`) — состав/порядок `DEV_MODULES` и есть контракт детерминизма, и матч, созданный под другим графом модулей, не поднимается (`null` + stderr + `onIntegrityFailure`). В отличие от опционального `dataHash` мягкой деградации тут НЕТ: `manifest` в `GameVersion` обязателен, значит его отсутствие — не «снапшот до проверки», а повреждение. **Сторож манифеста (`moduleManifest.test.ts` + 3 теста загрузчика в `f8-persistence.test.ts`):** сама-то константа себя не знает — правка `DEV_MODULES` без подъёма версии проходила бы проверку насквозь. Поэтому граф модулей закреплён списком id **в порядке выполнения** (29 модулей) рядом с версией, за которую он отвечает; любая правка состава/порядка красит гейт и чинится ровно подъёмом `MODULE_MANIFEST_VERSION` с перезакреплением списка. Версии отдельных модулей намеренно вне охвата — правило рядом с константой говорит про членство и порядок. **Сессии Iron Order (SES-2):** автостарт без лобби (SES-2.1 — `MatchRoom.initiallyStarted` работает и без `manualStart`); два ИИ разведены `seatAiDecision` (SES-2.2 — Хранитель по делегированию vs `expand`-заместитель после `AI_GRACE_MS`=3 реальных дня); окно входа `ENTRY_WINDOW_MS` (SES-2.3, деф. 4 реальных дня): `wsServer.admitNewSeat?` отклоняет ПЕРВЫЙ вход ника (проверка `seatOf` до `resolveSeat`, 403) после `MatchRegistry.entryOpen` (возраст = `state.time/timeScale`, переживает рестарт), реконнект своих не гейтится; закрытая сессия выпадает из «Доступных». **Аккаунты на игровом пути (SES-2.5):** с `AUTH_JWT_SECRET` прото-хост монтирует SE-1.x-контур (`registerAuthApi` + общий `registerMatchApi` — NETA2-7 свёл джойн-хендшейк в одно место с боевым хостом: per-IP rate-limit + identity-гейт + error→status; `createMatch` опционален, `POST /matches` не монтируется. Bearer-сессия → seat логина → join-токен, окно входа `seatOf`-до-`resolveSeat` в netserver-`join`-депе → 403 `E_ENTRY_CLOSED`) и передаёт `auth` транспорту — nick/ticket отклоняются; без секрета — прежний nick+ticket. Клиент самонастраивается по `GET /auth/status`: поле «Пароль», zero-friction login→register, session-JWT per-server в localStorage, реконнект минтит свежий join-токен. Живой e2e 10/10 + окно на auth-пути. Плейтест-постура компоуза (SES-2.6): `TIME_SCALE` деф. ×24 (окна отсутствия/входа — реальные); полный цикл прогнан живьём 7/7 (регистрация → лента → вход → gated-игра, часы ≈×24.0). ⏳ Дальше: OIDC-идентичность, полные аккаунты на прото-пути (JWT join-токены в транспорте готовы), контейнер-хардненинг. **Реплей-детерминизм (playtest-hardening RPL-1..3):** shared-core `replay/replay.ts` — самодостаточный `ReplayLog` (полный стартовый стейт, RNG внутри; шаги `{at, action?}`) + чистый `runReplay` с fail-secure пинами версии/порядка; **границы advance — часть лога** (спановое начисление float-чувствительно к членению — движок обещает coarse ≈ fine, не бит-в-бит). `MatchRoom.record` пишет каждую исполненную границу advance и каждое успешно применённое действие (sync + durable пути, серверные драйверы включительно); CI-тест `replayDeterminism.test.ts` — живая комната на полном dev-стеке (шипнутые данные, 48 игровых часов) → реплей → `hashState` бит-в-бит, плюс JSON-round-trip лога (паритет гибернации). Остаток: durable action-log (PE-1.1) → аудит-реплей (GI-1.3). _Известный нюанс (клиентская сверка, не серверная durability):_ acked-но-недоставленное действие + рестарт + наивный ресенд может примениться дважды (`actionId` session-scoped) — закрывается сверкой клиента с полным `welcome`-состоянием на реконнекте, не durable-стора́ми гейта.
- `packages/client` — клиент (Этап 4): направление **PWA-first веб-клиент** (TWA Android + Capacitor iOS, не React Native — см. `cross-platform-roadmap.md`). Есть `MultiplayerClient` transport adapter — **закрывает SV-1.1-петлю**: ловит `sessionId`+`gated` из `welcome` и на gated-комнате оборачивает намерение в `action.v1` конверт (`createActionEnvelope`, strict per-session `clientSeq` 1,2,…, `actionId=sessionId:playerId:clientSeq`, сброс на реконнекте), иначе — голый `action`; сервер отдаёт `gated:true` в welcome → клиент самонастраивается по рукопожатию. Прогнано вживую: gated-сервер → welcome`{gated,sessionId}` → конверт принят → delta; юнит-тесты прогоняют вывод клиента через те же `validateActionEnvelope`+`authorizeActionEnvelope`, что и гейт. **Реконнект и резюме (CP1.4/G1):** неожиданный обрыв сокета → авто-реконнект с экспоненциальным бэкоффом (1с→30с cap, сброс на успешном open) в `net.ts`; клиент флипается в `connecting` и складывает интенты в ограниченный outbox (64, переполнение → `E_OUTBOX_FULL`), флаш после реконнект-`welcome` под свежей сессией (в очереди только никогда-не-отправленные действия → без дублей); дельта с `seq` назад (вперёд-гэпы/повторы легальны) дропается как desync и форсит немедленный ресинк-реконнект; deliberate `close()` финален. **Hash-desync (M1):** на дельте с `hash` клиент сверяет свою реконструкцию (`hashState`), при mismatch шлёт `desync`-репорт и получает полный `state`-ресинк без реконнекта (один запрос за раз; UI-хук `onHashDesync`). **Локализация (LOC-3, рантайм общий с LOC-5):** текст берётся из `localization/runtime.ts` — ОДНОГО рантайма на клиент и прототип (`t()`/`tData()`/`lookup()`/`hasKey()`; собственная копия `packages/client/src/i18n.ts` удалена, третьей системы не заводилось); `welcomeScreen.ts`'s `defaultStrings`/`CALLSIGNS`, `loadoutEditor.ts`'s `STAT_LABELS` (новый ключевой домен `loadout.stat.*`) и `main.ts`'s статус/сетевые строки (новый домен `client.*` + `err.unknown-provider`) больше не хардкодят текст. `prototype/src/i18n.test.ts` теперь сканирует и `packages/client/src` — общий гейт покрывает обоих потребителей. Токены темы (`theme.ts`) и framework-agnostic view-models (паттерн: чистая фабрика + fail-secure, JSON-сериализуемо): `welcomeScreen.ts` (экран входа — pre-auth: маршруты только `browse`, соло-входа в модели нет) и `matchHud.ts` (внутриматчевый HUD: зоны A+D — `createStatusBarModel` стат-бар, `createSelectionModel` панель флота; **боевая зона** — `createBattleModel` + `resolveBattleAction` панель активного боя с единственным действием «Отступить»; **боевой прогноз (G4/ONB-6)** — `createBattlePreviewModel`: тонкая обёртка над чистым `previewBattle` из `shared-core` — форкаст десанта пристыкованного флота против гарнизона враждебного (data-driven `sectorKinds.capturable`) мира под ним; фог структурно безопасен (пристыкованный флот уже опознал свой мир); fail-secure отказы на чужом/непристыкованном флоте, своём/некапчурабельном мире, пустом десанте/гарнизоне; всё поверх fog-проекции `visibleState`; см. `hud-inmatch.md`). App shell — рабочий
  Vite-каркас: welcome-экран, живая карта на общем рендер-ките (камера/holoDraw/territory),
  подключение к серверу по `?join=`-диплинку (снапшоты/дельты + приказ движения через
  `action.v1`) — **единственный** вход в карту: оффлайн-скирмиш с welcome-экрана снят,
  до авторизации матч не запускается; полный игровой HUD в shell — впереди, играбельный
  клиент игроков — `prototype/`.
  **Контент в браузере (AUD-1):** `gameData.ts`'s `FRAGMENTS` — клиентская копия списка
  фрагментов — несла 11 позиций из 18; не хватало `modules` и всего геройского слоя
  (`heroes`/`heroAbilities`/`heroPassives`/`heroSkillTrees`/`heroFittings`) плюс `rewards`.
  Молчал баг из-за схемы: у каталогов стоит `.default({})`, поэтому неподанный фрагмент
  превращался в пустой объект, и `shippedGameData()` отдавал ВАЛИДНЫЙ бандл без контента.
  Починено; сторож `gameData.test.ts` (3 теста) держит три пути регрессии: паритет ключей
  со списком, снятым с самого `composeGameDataBundle` записывающим ридером (новый фрагмент
  покрывается сам); запрет `undefined`-значения при живом ключе; запрет пустого
  record-каталога в собранном бандле (список каталогов выводится из бандла, не перечисляется).
  **Устанавливаемость (CP2.1):** `public/manifest.webmanifest` (`standalone`, тема/фон
  `#03141a`) + иконки 192/512/maskable-512 (сгенерированы из уже существующего
  Android-брендинга `mobile/assets/icon-*.png`, не новый плейсхолдер) + `<link
  rel="manifest">`/`apple-touch-icon` в `index.html`; Vite-ребейзинг (`--base=./`)
  проверен реальной сборкой. Service Worker/офлайн-шелл/сплэш — CP2.2, следующий кирпич.
- `data/` — контент в JSON, вкл. карты `data/maps/*` (skirmish-1, ava-duel-1 2×1,
  ava-2v2-1 2×2). **AvA-пул карт (AVA-5):** тег `MatchMapSchema.avaEligible`, форма
  выводится из slots (`avaShape` → `{sides, slotsPerSide}`, `E_AVA_SHAPE` на кривой
  eligible-карте), seeded-выбор — `pickAvaMap` (`packages/server/src/avaMapPool.ts`).
  `docs/` — дизайн. `prototype/` — играбельный
  single-file HTML на реальном ядре (для «пощупать»).
  **Песочница (dev-only, `prototype/src/sandbox.ts`):** галочка «🧪 Песочница» в
  сетапе одиночной игры включает панель тренировочных читов (как demo-режим в
  Dota 2 / LoL). Тумблеры оформлены как переключатели в «Настройках»
  (`.set-switch`) и держатся каждый кадр: туман войны (**вкл по умолчанию** —
  именно выключение открывает всю карту) · моментальная постройка · бесплатная
  прокачка · бессмертный дом · заморозка очередей у всех · мгновенная перезарядка
  скиллов командиров · управление скоростью (перенесено из «Настроек» — ручка
  внутриматчевой панели времени, `devSpeedControl`). Разовые команды: +2000 любого
  ресурса · прекратить все войны → нейтралитет. Панель закрывается кнопкой «Закрыть»
  и кликом вне окна. Самодостаточна как `testmode.ts` (fenced-хуки в
  `main.ts`/`build.mjs`, strip'ается из player-сборки); трогает только ЛОКАЛЬНЫЙ
  solo-стейт, в NET не работает (сервер авторитетен). Тесты — `sandbox.test.ts` (9).

## 2. Архитектура ядра

`createKernel(modules)` компилирует неизменяемое ядро из упорядоченного списка
модулей (порядок = приоритет, версионируется per-match). Четыре **чистых** входа:

- `applyAction(state, action, ctx)` — применить намерение игрока в `ctx.now`.
- `canApply(state, action, ctx)` — **RULES-1**, «можно ли?» ЗАРАНЕЕ: код отказа `E_*`
  или `null`. Это тот же `applyAction` с выброшенным результатом, поэтому второго
  описания правил не появляется ПО ПОСТРОЕНИЮ. Спрашивают интерфейс (гасит кнопку и
  называет причину) и автоматика (не издаёт заведомо отвергаемый приказ). Границы:
  это вопрос ПРАВИЛ ИГРЫ — сессия/`clientSeq`/идемпотентность живут в `action-layer`;
  клиент под туманом отвечает по своей проекции, авторитет остаётся у сервера.
  Прототип зовёт через `canOrder(state, action)` (`protoKernel.ts`) с памятью ответов
  по идентичности состояния — она корректна ровно из-за инварианта неизменяемости.
- `canApplyAll(state, actions, ctx)` — **RULES-3**, тот же вопрос про СВЯЗКУ приказов:
  первый код отказа или `null`. Каждый следующий приказ спрашивается по черновику,
  который оставили предыдущие; состояние вызывающего не меняется. Нужен автоматике,
  которая издаёт не одиночные приказы, а пары: авто-штурм — это «встать на низкую
  орбиту → штурм», и спросить про него можно только целиком (про один штурм ответом
  будет `E_WRONG_ORBIT` — орбита ещё не выставлена; про одну орбиту — «можно», после
  чего применится половина обречённой пары). Зовут: прототип — `canOrderAll`
  (`protoKernel.ts`, без памяти — спрашивают драйверы раз в тик, не рендер),
  сервер — `MatchRoom.canApplyAll(state, actions, now)`.
- `advanceTo(state, ctx)` — продвинуть мировые часы до `ctx.now`: исполняет
  запланированные события в порядке `(at, seq)` и эмитит непрерывные спаны
  `time.advanced {from,to}` (накопление по формуле, а не по тикам).
  Реальный поток сервера: `advanceTo` до настоящего → затем `applyAction`.
  При переполнении `MAX_ADVANCE_STEPS` возвращает **частичный** прогресс
  (`partial:true`), а не выбрасывает работу — комната догоняет чанками и детектит
  same-instant runaway (стойло), драйверы делают backoff (отказоустойчивость,
  `infra-sizing-roadmap.md` блокер #3).
- `runUntil(kernel, state, ctx, opts?)` (AUD-5) — **не третий вход ядра, а общая копия
  цикла** «звать `advanceTo`, пока `partial:true` и часы двигаются». Раньше этот цикл был
  переписан от руки трижды (`MatchRoom.computeAdvance`, `protoKernel.advance`,
  `replay.ts`). Отдаёт `{ok, state, events, failures}` либо стабильный код:
  `E_ADVANCE_STUCK` (частичный проход без движения часов — стойло) и `E_ADVANCE_BUDGET`
  (исчерпан необязательный `maxChunks`; без него цикл не ограничен). Переведён пока
  только `replay.ts`; `MatchRoom` оставлен как есть — там на пути `observe`-хуки.

  **Оптимизация:** `scheduled` поддерживается в отсортированном порядке `(at, seq)` —
  вставка через binary search (`O(log N)`), извлечение ближайшего события `O(1)` вместо
  линейного сканирования. Нормализация при входе в `advanceTo`.

Модуль в `setup(api)` регистрирует: `onAction(type,h)` (один обработчик на тип),
`on(event,h)`, `hook(name,fn)`, `provideCapability(name,impl)`. Обработчик
получает `HandlerContext`: `state` (черновик-клон), `ctx` (now + данные), `rng`,
`emit`, `schedule(at,type,payload)`, `hook`, `capability`, `reject(code)`.

**Инварианты** (нарушение = баг):

1. **Детерминизм.** Никаких `Math.random`/`Date.now` в ядре (ESLint-гард);
   seeded `Rng` (sfc32, golden-тест), время — параметр `ctx.now`.
2. **Чистота/иммутабельность.** `applyAction` не мутирует вход (работает на
   `deepClone`); `GameState` — JSON-сериализуемый (JSONB), без классов/Map/Date.
3. **Только через шину.** Модули не импортируют друг друга. Три механизма:
   события (pub/sub), хуки (конвейеры с базовым дефолтом), реестр возможностей
   (опц. связи с фолбэком). Любая точка расширения деградирует мягко.
4. **Fail-secure (A10).** Любая ошибка → отказ `{ok:false, code}` со стабильным
   кодом, без утечки деталей; `h.reject(code)`, неожиданный throw → `E_INTERNAL`.
   Упавшее запланированное событие — dead-letter (мир не зависает).
5. **Server-authority.** Клиент шлёт намерение, не состояние.
6. **Детерминизм порядка модулей** (фиксирован в манифесте).

## 3. Карта файлов

```
packages/shared-core/src/
packages/action-layer/src/
  kernel/        kernel.ts (createKernel/applyAction/advanceTo, шина/хуки/расписание), module.ts (контракт)
  state/         gameState.ts (типы GameState), orbit.ts (isBombarded, bombardedPlanets), visibility.ts (visibleState — туман войны + общая видимость союза), previewBattle.ts (ONB-6 — чистый прогноз боя + hullPool/damageFraction), threat.ts (ST-3.1 — fog-honest скан угроз узлу), groundCombat.ts (FND-4 движок — тип-матрица наземного боя, порт прототипа, ПОКА не подключён к живому combat.ts), squadron.ts (CA-1 чистая математика — sortie/rearm/strikeRange, порт прототипа, ПОКА не подключён к action/reducer)
  action/        types.ts (Action, Context, MatchConfig.timeScale/victory, ApplyResult/AdvanceResult, Rejection, timeScaleOf)
  data/          schemas.ts (zod-схемы + parseGameData, buildingLevel/buildingMaxLevel)
  rng/           rng.ts (sfc32)
  util/          clone.ts (deepClone/deepFreeze), treasury.ts (canAfford/payCost — shared by construction & technology), fitting.ts (генерик-гейт «слоты+предметы», SHIP-4) + loadout.ts (ship-обёртка над ним)
  modules/       army, arsenalSync, artillery, capital, captureOnArrival, combat, construction, diplomacy, economy, effects, espionage, faction, fleetOps, fleetRepair, forcedMarch, hero, heroEffects, instantRepair, intercept, market, movement, orbital, planetType, scientist, sector, standingOrders, station, steward, tax, technology, victory, visibility  (32 модуля, + *.test.ts)
  examples/      skirmish.test.ts (демо-сценарий + SVG)
  index.ts       баррель (экспорт публичного API)
data/            manifest, resources, units, buildings, factions, events, sectors, sectorKinds, planetTypes, technologies, scientists, rewards, heroes, heroAbilities, heroFittings, heroPassives, heroSkillTrees, modules, medals, dropTables, starterArsenal (.json)
localization/    ВЕСЬ текст для игрока: index.ts (LOCALES/DEFAULT_LOCALE/dataKey), ru.ts, en.ts (плоские карты ключ→текст, 1704 ключа), runtime.ts (ОДИН на прототип и клиент: t/tData/lookup/hasKey/setLocale/localizeStaticDom, LOC-5) + runtime.test.ts. Мост старых msgid снят вместе с LOC-2 — в коде только ключи
docs/            architecture, modulesystem, roadmap, deep-technical-roadmap, multiplayer, engineering-risks, gdd, metagame, state(этот)
prototype/       src/game.ts (чистый index-фасад реэкспортов, REFP-28: 5289→207 строк, логики нет), src/prototypeData.ts, src/map.ts, src/fleetStacks.ts, src/tax.ts, src/botFavour.ts, src/squadron.ts (механика крыла: запуск, топливо вылета, дальность удара; там же — ЧТО ТАКОЕ действующее крыло, REFM-135: флот с базой И с эскадрильями на борту, только свой, вне боя и вне перелёта, а вернуться можно лишь из свободного пространства. Панель и обработчики приказов отвечали на это по-разному — обработчики знали только про базу, и опустевшее или чужое крыло слало приказ, который ядро отклоняло отказом вместо неактивной кнопки; локальная копия `fleetHasSquadron` из `main.ts` убрана — она дублировала эту же), src/chain.ts, src/hunger.ts, src/botDiplomacy.ts, src/sessionMarket.ts, src/capital.ts, src/fleetLaunch.ts, src/standingOrders.ts, src/forcedMarch.ts, src/instantRepair.ts, src/econScrews.ts, src/economy.ts, src/matchSetup.ts, src/actions.ts, src/patrol.ts, src/serverDrivers.ts, src/protoKernel.ts, src/stewardGuard.ts, src/ai.ts, src/time.ts (вынесены из game.ts; Block REFP закрыт 28/28, обратных рёбер на фасад ноль), src/main.ts (UI), src/format.ts (презентационные форматтеры, REFM-2; там же ЧАСЫ ИГРОВОГО ВРЕМЕНИ — `gameDay`/`dayHour`/`clockHM`/`countdownHMS`, REFM-136: день игрока считается с единицы, часы и минуты берутся от остатка суток и часа, минуты — в миллисекундах, время суток дополняется нулём до двух цифр, а обратный отсчёт это остаток, а не показание часов, и час в нём без ведущего нуля. Раньше этот перевод стоял четырьмя разными выражениями: штамп журнала, строка разведки, часы статусной полосы и отсчёт до конца суток), src/icons.ts (словарь иконок, REFM-3), src/dossiers.ts + src/buildQueue.ts (досье объектов и кодекс + словарь очереди стройки, REFM-4), src/arsenalScreen.ts (витрина «Арсенал», REFM-5), src/marketScreen.ts (окно рынка, REFM-6), src/stewardScreen.ts (окно «Хранителя», REFM-7), src/techTree.ts (дерево технологий, REFM-9), src/profileScreen.ts (профиль командира, REFM-10), src/corpScreen.ts (корпоративный кабинет, REFM-11), src/chatWindow.ts (плавающее окно чата, REFM-12), src/shipyard.ts (окно «Верфь», REFM-13), src/heroStaff.ts (штаб героев, REFM-14), src/conversations.ts (вкладка сообщений, REFM-15), src/sciPick.ts (выбор совета учёных, REFM-18; там же СТРОКА СОВЕТА на экране настройки — `sciCouncilRowHtml`, REFM-126.1: окно открывается ровно раз за вход в настройку и закрывается в том числе Back'ом мимо запертого подтверждения, поэтому выбор обязан быть виден И перевыбираем на самом экране, а неполный совет помечен янтарём. Порядок экранов оставлен прежним — окно поверх карты расстановки, это осознанный первый шаг с преднабранной парой), src/passwordReset.ts (сброс пароля, REFM-19), src/endScreen.ts (экран итогов матча, REFM-20), src/graphicsPrefs.ts (графические настройки, REFM-21; плотная подача секторной панели на ПК больше НЕ тумблер — она единственная, `void.compactPanel`/`compactUi()`/класс `body.compact-panel` сняты, ПК-сокращения строк идут по `pcUi()`. Со-локальный тест сторожит ещё и список ПК-зума: каждое окно с оболочкой `.twbox` обязано быть в нём — `#buildwin` там не было, и «Здания → Построить» ехало 1× посреди 1.5×), src/settingsOverlay.ts (оверлей настроек, REFM-22), src/apkUpdate.ts (самообновление APK над `updater.ts`, REFM-23), src/viewport.ts (замер вьюпорта: потолок DPR + признак телефонной раскладки, и детерминированный звёздный фон, REFM-24), src/pingUi.ts (витрина меток: композер, список, попап маркера — поверх модели прав `pingPanel.ts`, REFM-25; попап садится тем же `screenAnchor.stickToPoint`, что и меню «Приказа», ширину окна берёт у хоста — `viewportW()`, REFM-133), src/soloDrivers.ts (соло-драйверы: ходы ИИ, авто-штурм, сведение флотов, дежурные вылеты, цепочки — в сети это делает сервер, REFM-26), src/matchEnd.ts (конец матча: исход из авторитетного `match` + однократная награда с долговечной меткой, REFM-27), src/intel.ts (окна краденой разведки: живые гранты, их вклад в туман, журнал шпионажа, REFM-28), src/alerts.ts (политика оповещений: часовой дроссель, эпизоды тревог, геометрия развёртки и жизнь радарной отметки, REFM-29), src/diploEvents.ts (сравнение снимков дипломатии: сдвиги стоек и предложения, которые не проходят фог-фильтр сервера, REFM-30), src/buildProgress.ts (ход стройки: голова расписания по `(at, seq)`, длительность по данным, проценты полосы, REFM-31), src/buildOrders.ts (клиентская очередь стройки: цена головы, её приказ, «ждём только денег», REFM-32), src/pointerPick.ts (геометрия ввода: пороги тапа, ближайшая цель, щипок, рамка выделения, REFM-33; там же попадание в ОТРЕЗОК — марш «на дорогу» целится в ближайшую точку трассы, а не в её конец: проекция прижата к отрезку, вырожденная трасса отсекается явно, REFM-128), src/mapShapes.ts (геометрия фигур карты: многоугольники, уголки прицела, детерминированное поле астероидов, REFM-34), src/panelKit.ts (кирпичики боковой панели: кнопка, шапка, вкладка, колонки, строки состава — одно место экранирования, REFM-35; строка состава — КНОПКА той же формы, что строка здания (тап → карточка кодекса, удержание → подпись), и весь состав идёт одним столбиком `blist`: раньше состав был мёртвым `div`, и привычный по зданиям тап по земле и флоту не давал ничего, ONB-9), src/conveyorView.ts (конвейер стройки в панели мира: идущая стройка якорями `data-at`/`data-dur` без живых чисел, очередь с ценой вместо ложного простоя, приостановленное, REFM-36), src/fleetSummary.ts (арифметика сводки армии и карточки флота: залп по линии боя против полной суммы, зажатые пулы корпуса и щита, трюм объёмом груза, радар максимумом, порог хромоты LIMP_PCT общий с ядром, REFM-37/40), src/planetSummary.ts (числа сводки мира: выход с нулями, бонусы типа, разбор гарнизона на землю/корабли/крылья, очки победы из ядра, орбита без транзитных, REFM-38), src/panelSelect.ts (кого показывает панель: приоритет группа→флот→мир→пусто с отсевом мёртвых ссылок, положение флота орбита/транзит/дуга, итоги группы, REFM-39), src/planetTabs.ts (вкладки карточки мира: разбор гарнизона, счётчик «Флота» вместе с орбитой, ростер стройки тем же делением, REFM-41), src/catalogTile.ts (каталог в ДВУХ подачах — плитка сетки и строка списка — с одними правилами заказа: какие коды отказа гасят повторный заказ, запертая плитка/строка без обоих якорей заказа, REFM-42; построенное здание рисуется СТРОКОЙ «иконка · имя · доход в час · L1», а не плиткой сетки — на русской локали и ширине 360 px сетка переносила четвёртую постройку на второй ряд, UI-BLD2; строками же идёт каталог заказа на вкладках ФЛОТ и КРЫЛЬЯ, а удержание на любой строке открывает краткую сводку вместо подсказки с именем — имя в строке и так подписано, UI-BLD3), src/scanMemory.ts (память разведки: снимок опознанного мира копией, радарные узлы не пишутся, память живёт один матч, REFM-43), src/setupSeats.ts (раскладка мест сетапа: раздача домов по кругу с нумерацией второго круга, бонусы дома из данных, счёт соперников, REFM-44), src/setupMap.ts (мини-карта сетапа: рамка с отступом, каждое ребро один раз, кандидаты поверх фона, REFM-45; там же тап по карте, REFM-126: точка переводится в координаты viewBox (SVG растянут preserveAspectRatio=meet, и в экранных пикселях снап промахивался бы тем сильнее, чем сильнее вытянуто окно), а промах засчитывается ближайшему кандидату — кружок на телефоне около восьми пикселей; та же `lanes()` раскладывает трассы БОЛЬШОЙ карты матча — дважды нарисованный полупрозрачный штрих просто светлее соседних и читается как магистраль, которой нет, REFM-127; тот же перечень теперь берёт и поиск точки на трассе под пальцем, так что нарисованная дорога и дорога, на которую встаёт марш, — одна и та же, REFM-128), src/sessionStore.ts (хранение сессии: токен привязан к позывному, ключ на адрес сервера, пароль не хранится, REFM-46), src/authRules.ts (правила логина и пароля зеркалом серверных + разбор пары ответов auth: 401 на входе и 409 на регистрации = неверный пароль, REFM-47), src/joinRules.ts (обмен сессии на место в матче: 401 стирает сохранённую сессию, 403/409 остаются разными причинами, пустые slot/faction не попадают в запрос, REFM-48), src/seatPicker.ts (выбор дома при входе: кресло — первое свободное дома, полный дом не выбирается, порядок домов по первому появлению, дом и кресло двумя полями, REFM-49), src/matchRow.ts (строка обозревателя матчей: окно входа только на «доступных», бесконечное окно и отсутствующее поле не занимают строку, порог «скоро» в сутки, вторая кнопка по вкладке, REFM-50), src/pendingJoin.ts (отложенный вход в матч: намерение переживает экран логина целиком — матч вместе с креслом и домом, take() читает и забывает одним вызовом, пустой выбор не запоминается, REFM-51), src/registerForm.ts (форма регистрации: каждая беда называет своё поле, длина пароля до совпадения, пустая почта не уходит вовсе, детерминированная подсказка позывного, REFM-52), src/commanderSync.ts (зеркало опыта командующего: берётся максимум местного и серверного — уровень не отбирается, пока сервер не зачёл награду; непонятный ответ прогресс не трогает, REFM-53), src/panelSlack.ts (припуск камеры под открытой панелью: сторону выбирает измеренная ширина панели, припуск равен закрытой полосе и не бывает отрицательным, REFM-54), src/pressIntent.ts (разбор нажатия на карту: Shift над своим флотом — добор, а не рамка; добирают Ctrl/⌘/Shift, рамку открывает только Shift по пустому; удержание только для пальца и не при вооружённом приказе, REFM-55), src/openingView.ts (стартовый вид карты: дом — свой застроенный мир, без своих остаётся обзор, приближение к дому только на телефоне и множителем к вписыванию, REFM-56), src/warPrompt.ts (сборка окна войны: стоящий в цели не летит, штурм берёт всех, виновники без повторов и в стабильном порядке, владелец цели — собственный виновник штурма, REFM-57), src/assaultQueue.ts (очередь «штурм по прилёте»: перенаправленный вручную теряет приказ по конечной цели маршрута, бой по прилёте приказ не снимает, вставший не в цели протухает, пропавший флот забирает приказ, REFM-58), src/warOrders.ts (подтверждение войны: объявления идут первыми и каждому виновнику, затем ровно один шаг движения; марш по лейну проверяется по обоим концам ребра, REFM-59), src/staticLayerCache.ts (перепечка статического слоя: подпись по знанию игрока, а не по правде — скрытый захват не выдаёт себя перерисовкой; размер, DPR и сдвиг камеры входят в решение, REFM-60), src/provinceMap.ts (мозаика провинций: пустой узел не даёт клетки, вес семени растёт квадратично по масштабу — доли территорий не плывут при зуме, обрезка по границе карты с полом отступа, REFM-61; мозаика тут ОДНА на всех, кто её строит — вспышка захвата обрезает волну по клетке и собирала её своей копией тех же формул, а разъехались бы они — волна показала бы захват не той территории, REFM-124), src/fogView.ts (видимость узла И ФЛОТА под туманом: пустой узел не секрет и сетка путей цела, неопознанный показывается памятью, никогда не виденный — знаком вопроса, свой виден без опознания, REFM-62; флоты живут по тому же закону и в том же файле, а не отдельным модулем: свой флот виден всегда, чужой — по опознанному узлу, а не по радару, потому что засечка это место и размер, а не состав эскадры, и отдельно по купленному окну разведки, которое продаётся на ВЛАДЕЛЬЦА и потому показывает его флоты где угодно, REFM-103), src/radarSources.ts (источники радарного покрытия: только свои и только с положительным радиусом, кольцо флота в его фактическом месте, радиус опознания — доля засечки, REFM-63; там же дальномер ВЫБРАННОГО мира, REFM-109: подписанные окружности рисуются только по видимому в деталях миру с ненулевой дальностью — дальность считается по постройкам, поэтому без гейта тумана тап по чужой неисследованной системе был бы мгновенной разведкой одним касанием; внутренний радиус берётся тем же `identifyRadius`, а не второй формулой; там же лучи развёртки, REFM-119: совпавшие по месту источники сливаются в один луч и остаётся ДАЛЬНИЙ — радарный корабль у радарного мира иначе дал бы два луча из одной точки, а ближний обрезал бы дальний обзор до себя; место сравнивается округлённым до пикселя, иначе корабль на орбите никогда не слился бы с миром; механика и хром РАЗДЕЛЕНЫ — настройка прозрачности гасит только картинку, а лучи и засветка контактов считаются всегда), src/tapPriority.ts (приоритет тапа по карте: режим «Приказ» глушит всё, вооружённый приказ важнее выделения, выделение последнее, набор группы уступает ходу; радиусы попадания шире у пальца, REFM-64; радиус захвата узла ОДИН на прицел и на коммит — превью вооружённого приказа искало мир своей копией чисел, а разъехались бы они, превью обещало бы путь, которого отпускание не отправит, REFM-125), src/tapCycle.ts (выбор под тапом: мир идёт после флотов, но идёт — флот на своей орбите больше не закрывает свой мир навсегда; повторный тап берёт следующего по кругу, тап по новому месту начинается с верхнего, единственный кандидат не сбрасывается, пусто — снять выделение; на телефоне перебора нет, REFM-65), src/chainTarget.ts (прицел точки плана в режиме «Приказ»: мир приоритетнее флота — наоборот к обычному выделению, иначе штурм мира недостижим тапом; огонь по флоту остаётся для флотов без узла под пальцем; вид точки решает владелец; «Домой» — ближайший СВОЙ мир, кроме точки отсчёта, а без своих миров пункт гаснет, REFM-66), src/travelEta.ts (время в пути с форс-маршем, одно на карточку флота и таймлайн «Приказа»: текущий лейн авторитетен по arrivesAt и бустом не ускоряется, ускоряется только остаток маршрута за ним, «нет маршрута» остаётся null, а просроченное прибытие — ноль, не минус, REFM-67), src/heroCasts.ts (способности героя-флагмана одним правилом на кнопку ✨, её поповер и меню точки «Приказа»: герой должен быть жив и на борту выбранного флота, отсутствие поля alive значит «жив», кастуемые типы приходят снаружи, кулдаун не бывает отрицательным, прицел нужен только дальнобойным, REFM-68), src/screenAnchor.ts (якорь DOM над точкой карты одним правилом на меню «Приказа», попап метки и dev-пробу: проекция от измеренного прямоугольника холста со своим масштабом по каждой оси, плавающая коробка зажимается на полширины от края и опускается из-под верхнего хрома на разницу, а не в абсолютные 96 px, REFM-69; обе поправки применяет `stickToPoint` — общий для ОБЕИХ коробок над картой, REFM-133: раньше их применяло только меню, а всплывашка метки ставилась в сырую проекцию и у края экрана её срезало, под хромом прятало; порядок «поставить в округлённое → измерить → поправить» тоже здесь, врозь эти шаги разъезжались на пиксель; обратный перевод `fromScreen` — точная пара `toScreen`, одна на палец и на колесо, REFM-134: две копии одной формулы это два зума, которые начнут целиться в разные места; перевод для РАСТЯНУТОГО холста матча, у вписанной с полями SVG-карты сетапа он свой — `setupMap.ts`), src/flashFx.ts (жизнь экранной вспышки одной шкалой на кольцо «сюда» и волну захвата: прогресс по часам и зажатый в [0,1] — метка кадра rAF может опередить постановку, а отрицательный радиус роняет arc(); истёкшая снимается, а не рисуется прозрачной; затухание — тот же прогресс с другого конца, REFM-70), src/chainPathLayout.ts (раскладка плана на карте: линия идёт по лейнам, а без маршрута ставится хотя бы цель; шаги-не-перелёты точку не двигают, а перелёт «сюда же» пропускается; несколько шагов в одной точке ложатся капсулами стопкой вправо, подпись «~T» — под последней из них, REFM-71), src/pingPulse.ts (пульс метки и сонарные кольца: фаза от X — соседние метки не мигают в унисон, двойной модуль держит прогресс кольца положительным даже за левым краем экрана (иначе отрицательный радиус роняет кадр), кольца идут парой со сдвигом полпериода, молодое вспыхивает заливкой, а радиус/толщина/прозрачность берутся из одного прогресса, REFM-72), src/chainBadges.ts (слой отправленных планов: показываются только свои и не редактируемые сейчас (иначе план нарисуется дважды), обход по id флота ради устойчивого порядка бейджей, группировка по якорю — несколько флотов в один мир дают один бейдж со счётчиком, а счётчик появляется только при 2+, REFM-73), src/awayBrief.ts (политика брифинга возвращения ONB-5: уход засекается только в матче, короткий отскок брифинга не даёт, точка отсчёта — игровое время ухода, метка одноразовая, пустой дайджест не показывается, «внимание» идёт впереди рутины, REFM-74), src/tipPlacement.ts (размещение подсказок и политика удержания: подсказка отступает от курсора и переворачивается у края, не прижимаясь вплотную; пузырь долгого нажатия центрируется над плиткой и зажимается по экрану; движущийся палец — это скролл, а не удержание, REFM-75), src/splitPlan.ts (арифметика деления флота: отбор зажат наличным и пересчитывается под живой состав на каждой перерисовке, «всё» берёт ровно наличное, а подтверждение гаснет и на нуле, и когда уводят всё — иначе это переименование флота, а не новый, REFM-76), src/buildProgress.ts дополнен barPct — полосой от готовых чисел «когда закончится» и «сколько длится», чтобы живой патчер панели не держал свою копию формулы, а строка «в пути» в патчере зовёт travelEta.arrivalHours (REFM-77), src/cmdAvailability.ts (доступность командных кнопок: «слить» групповая, «разделить» и «десант» строго однофлотовые, одиночке для слияния нужен напарник, делить можно только стоящий флот с 2+ кораблями, штурм с орбиты — только чужой захватываемый мир с ближней, а общий режим огня показывается лишь при единогласии, REFM-78), src/chainStripState.ts (состояние полоски режима «Приказ»: погибшие и чужие флоты выпадают из режима, а опустевший режим гаснет сам; «Отменить» живёт по жестам, «Домой» — только пока план влезает и у финиша есть свой мир; пустой черновик поверх живого плана превращает отправку в очистку, а разные планы у выбранных флотов дают предупреждение о перезаписи, REFM-79), src/holdPress.ts (жизнь долгого нажатия — ОДНА на две поверхности, плитку каталога и КАРТУ, REFM-80 + REFM-131: нажатие взводит ожидание, поехавший палец его снимает, а созревшее удержание съедает хвостовой тап — иначе за одно касание игрок получит два действия; право съесть одноразовое, чтобы следующий честный тап не пропал; условия перепроверяются в момент созревания, а не только на взводе — за 350 мс палец успевает поехать, а на карте прийти второй; у карты была своя копия этой механики, и `MAP_HOLD_MS` теперь живёт здесь же), src/troopsSources.ts (источники ⇅-меню десанта: на своём мире их два — гарнизон и трюм, а на союзном поднимать нечего, поэтому и типы, и «в гарнизоне» берутся только из трюма и счётчик выходит односторонним сам собой; типы идут в порядке первого появления без повторов, чтобы строки не прыгали от перерисовки; стеков одного типа может быть несколько, и «всего» складывает их все, тогда как поднять или высадить ядро даст только здоровый, REFM-81), src/dossierHover.ts (досье под указателем: уровень здания живёт в самом ключе `b:<id>:<lvl>`, поэтому заголовок одинаков во всех трёх местах показа; всплывашка у курсора гаснет на промежутке, а пристыкованная панель наоборот держит показанное — иначе она мигала бы пустой, пока курсор идёт между строками; досье без тела показывает только заголовок, REFM-82), src/sheetLift.ts (подъём камеры из-под нижнего листа на телефоне: двигаем только в момент открытия листа, иначе камера ползла бы каждый кадр, и только на телефоне — на ПК панель сбоку и карту не закрывает; объект над порогом не трогаем, а тот, что под листом, поднимается в верхнюю половину, причём порог и цель — доли высоты экрана, а не пиксели, REFM-83), src/popoverLife.ts (время жизни всплывающих меню командного ряда: поповер живёт ровно пока живо его основание — 🔥 пока в выделении есть артиллерия, ✨ пока есть флагман с применимой способностью, ⇅ пока это ТОТ ЖЕ одиночный флот, иначе набранный план отправит чужой гарнизон; пустое выделение гасит всё разом вместе с прицелами, а набор группы держит ряд живым и на нуле выделенных, чтобы ⊕ осталась достижима, REFM-84), src/mergeChase.ts (догоняющее слияние флотов: приказ живёт в клиентской очереди и каждый кадр решает судьбу заново — пропавший флот его снимает, бой приостанавливает, а не отменяет, потому что после боя уцелевшие всё ещё рядом; сливаются только стоящие в одном узле, иначе догоняющий идёт к узлу цели или к её назначению, если она сама в пути; отвергнутый догоняющий ход выбрасывает приказ, иначе стоящий флот пережимал бы его каждый кадр, REFM-107), src/mapJump.ts (переход камеры к точке карты: две дороги, и различия намеренные — прыжок из ТЕКСТА (всплывашка, строка разбора, пинг в диплоокне) приближает всегда, переключает выделение на мир и закрывает диплоокно, потому что игрок пришёл из текста и карты перед глазами у него нет; переход по ССЫЛКЕ из панели (мир из интела) не отдаляет, выделения не трогает — панель обязана остаться открытой — и отмечает точку короткой вспышкой, своим единственным способом сказать «вот здесь»; по мёртвой ссылке не двигаемся вовсе, REFM-108), src/backdropGrid.ts (координатная сетка фона: шаг растёт с масштабом, но не мельче порога; смещение — камера по модулю шага, приведённая к неотрицательной, иначе на переходе камеры через ноль сетка прыгала бы на клетку; линии кладутся до края включительно, иначе у правого и нижнего края оставалась бы непрокрашенная полоса. Порог шага сейчас недостижим — камера зажата снизу `MIN_SCALE = 1`; замечено, не чинил, REFM-110), src/mapRadius.ts (дальность карты в пикселях — ОДИН перевод на весь рендер, REFM-132: множитель это подгон карты под экран × зум камеры, взять один зум значит рисовать круг меньше настоящей дальности; проекция равномерна по осям — круг остаётся кругом, поэтому дальномер выбранного мира рисуется дугой, а не эллипсом, обещавшим неравномерность, которой нет; считать радиус проекцией смещённой точки — окольный путь к тому же числу, и таких копий было пять), src/socketFate.ts (чей сокет и что значит его закрытие, REFM-143: устаревший сокет не трогает общее состояние — его позднее закрытие погасило бы таймеры живой сессии, а снимок переписал бы игру закрытой сессией, поэтому проверка стоит в каждом обработчике; «сокет открылся» ещё не значит «впустили» — подтверждение это первый снимок; закрытие читается по трём признакам и даёт пять исходов, причём выход игрока и обрыв связи путать нельзя; отказ во входе не стирает причину из строки статуса), src/netWelcome.ts (приветственный снимок как ВХОД в матч, REFM-144: вход подтверждает первый снимок и обрабатывается ровно один раз на сокет — иначе игрок получал бы фанфару и сброс выбора на каждом снимке; переподключение это НЕ новый матч, поэтому фанфара звучит только при первом входе, а приветственный снимок закрывает цикл переподключения — обнуляет счётчик попыток и снимает свой баннер; чужой баннер вход не трогает; хвосты прошлой сессии — выбор, черновик цепочки, очередь грузов, экран итога — на входе сбрасываются), src/reconnectCycle.ts (политика цикла переподключения поверх расписания задержек `reconnect.ts`, REFM-145: одна назначенная попытка за раз — к одному обрыву приходит несколько сигналов, и параллельные таймеры сожгли бы бюджет за секунду; счётчик попыток растёт сквозь дозвоны, иначе цикл не кончился бы никогда; исчерпанный бюджет заканчивается честной сдачей — баннер снят, «войдите заново», экран подключения, а не молчаливой остановкой перед замершим миром; в режиме аккаунтов дозвон начинается с чеканки свежего join-токена, а протухшая сессия ведёт на экран входа), src/snapshotIngest.ts (что каждый входящий снимок делает с миром, REFM-146: снимок приходит уже в тумане, поэтому «объекта нет в снимке» ≠ «объекта нет в мире» — радар-контакты живут ровно один снимок, отсутствие списка означает пустой, а не «прежний»; десинк считается только при присланном хеше, свой хеш иначе не считается; одиночный выбор снимается лишь при исчезновении объекта, групповой оставляет только свои флоты — приказ чужому отдать нельзя; баннер ожидания снимает тот, кто его поставил), src/orderRoute.ts (куда уходит приказ игрока, REFM-147: в сети — намерение серверу без локального редьюсера, иначе следующий снимок сотрёт «принятый» приказ; при живом цикле переподключения — честный отказ с сообщением, потому что сервер о приказе не узнает; в соло — локальный редьюсер; возврат значит «не отвергнут сейчас», а не «исполнен»; обучение в сети учится на намерении, в соло — на принятом приказе), src/relayIntake.ts (что делать с ретранслированной строкой ленты — меткой и репликой чата, REFM-148: личность строки назначает сервер, своё эхо и повтор истории при входе не удваивают её — сверка по серверному id, строку без провинции не берём вовсе, снимается строка тоже по id, а не по тексту или автору), src/errorRoute.ts (куда попадает отказ сервера, REFM-149: отказ устаревшего сокета игнорируется, отказ после входа идёт тостом — экран подключения уже скрыт, отказ до входа пишется в строку этого экрана, а причина называется словами из /localization, а не кодом E_*), src/matchQuery.ts (адреса запросов к серверу матчей и разбор ответа, REFM-150: всё уходящее в адрес экранируется — позывной набирает человек, а идентификатор матча приходит по ссылке; HTTP-адрес выводится из адреса сокета заменой схемы, чтобы игрок вводил один адрес; «сервер ответил отказом» и «до сервера не дошли» — разные беды и разные сообщения; неразобранный ответ считается неудачей, а не «список не изменился»), src/browserFallback.ts (что показать вместо списка матчей, REFM-151: никогда не тупик — соло без сервера остаётся на экране в любом случае и в обеих сборках; «сервер не ответил» и «ещё не спрашивали» — разные сообщения, у сборки игрока свои тексты; строка адреса сервера всплывает ровно пока список не загрузился; дубль сообщения гасит строку статуса), src/tourGate.ts (что обучение позволяет нажимать на шаге, ONB-10: шаг «Далее» модальный, запертый шаг пропускает нажатия только в подсвеченное окно — «нажмите сюда» должно быть шагом, а не советом, — но запереть можно лишь пока цель найдена, иначе перерисовка панели запирает игрока насмерть; остальные шаги оставляют HUD свободным); правило 5 — шаг «попробуй руками» (`hands`) не запирает экран и пропускает жесты даже сквозь тело подсказки), src/navHint.ts (первый шаг обучения — как смотреть на мир, ONB-11: текст подстраивается под устройство по `pcUi()` — колесо против щипка, закрывается только «Далее» без проверок жеста, экран не запирается, стоит первым до всех дел), src/netDial.ts (чем клиент представляется серверу при дозвоне, REFM-142: два способа не смешиваются — в режиме аккаунтов идёт короткий токен матча, а позывной и билет места сервер там отвергнет; билет привязан к тройке «сервер + матч + позывной», иначе клиент предъявит билет от чужого матча и получит «место занято»; пустой билет в адрес не кладётся; всё уходящее в адрес экранируется — позывной вводит человек, и `&` в нём расклеил бы адрес), src/assaultOrder.ts (связка приказов штурма, REFM-141: штурмуют с БЛИЖНЕЙ орбиты, поэтому перевод на неё идёт в паре со штурмом и только если флот не там — разорви пару, и ядро откажет без объяснения; годность самого штурма спрашивают у ядра, а не проверяют руками, иначе рукописный список условий отстанет от него молча), src/joinGate.ts (развилка «пустить в матч или послать на вход», REFM-140: просьбу вступить не теряют — её запоминают и доигрывают после входа, иначе пришедший по ссылке после пароля окажется в хабе и приватный матч уже не найдёт; пароль спрашивают только при известном сервере; сессия проверяется НАЛИЧИЕМ, а не совпадением позывного — поле ввода бывает пустым сразу после входа, и старая проверка молча уводила на карточку входа при живом токене; отказ в токене это два разных случая — пропала сессия значит вход просрочен, а уцелела значит закрыт сам матч, и карточка входа тут ни при чём), src/diploClick.ts (разбор дипломатического клика — один на КАРТОЧКУ игрока и ОКНО дипломатии, REFM-139: намерение и перерисовка это разные дела, поэтому модуль отвечает только «что попросил игрок», а что обновить после — знает экран; место читается с самой кнопки (`seat` у позиции и шпиона, `mapseat` у обмена картой, `msgseat` у письма), первое совпадение выигрывает, и «не наша кнопка» честно даёт null, чтобы экран продолжил свой разбор), src/hubAuth.ts (право вкладки хаба ходить в сеть от имени аккаунта — ОДИН ответ на пять вкладок, REFM-138: нужны сервер, подтверждённый сервером режим аккаунтов и живая сессия; любой из трёх отказов читается одинаково — гостевое состояние, и пароль ради просмотра не спрашивают, иначе игрока выгоняют из хаба за любопытство. Раньше этот ответ стоял пятью байт-в-байт копиями в `main.ts`), src/pulseFx.ts (дыхание объектов на карте, REFM-137: фаза берётся от САМОГО объекта, иначе все экземпляры слоя мигают синхронно и десяток живых объектов читается как один щёлкающий слой; источник фазы обязан различать соседей — длина идентификатора не различает, у `p1-1` и `p2-3` она одна, поэтому фаза считается хэшем строки или координатами; период и размах остаются делом слоя, а хэш обязан быть устойчивым, иначе объект дёргается, а не дышит), src/volleyFx.ts (расписание баллистического залпа осадной артиллерии: время жизни складывается из фаз, а не задаётся числом; снаряды уходят с задержкой и видны строго в полёте; разрыв начинается там же, где кончается полёт своего снаряда, — это продолжение тех же часов, а не свои; углы искр считаются от сида залпа, иначе попадание дрожало бы каждый кадр. Жизнь ОДНОЙ вспышки сюда не копируется — снятие отгоревшей записи делает `flashFx.flashDone`, REFM-111; там же ФОРМА дуги (`arcLift`/`arcPoint`/`arcPolyline`, REFM-130): лоб поднимается по экрану пропорционально дальности, но с полом и потолком — без пола выстрел в упор вырождается в прямую и навесной огонь не читается, без потолка дальний залп выгибается за край экрана; подъём ужимается вместе с артом узла; след рисуется ломаной ДО головного снаряда, иначе он читается как линия связи, обещающая ещё не случившееся попадание), src/flakTiers.ts (два тира зенитного огня одной таблицей: тир решает весь вид разом — цвет трассы, яркость, толщину, штрих, сияние, цвет и размер вспышки, — а ближняя зенитка тише орбитального залпа по всем осям сразу, потому что случается вчетверо чаще и иначе утопила бы редкое тяжёлое событие в шуме; вспышка попадания растёт от стартового радиуса, трасса ползёт от поверхности. Жизнь и затухание сюда не копируются — ими заведует `flashFx` (до выноса в кадре лежала их третья копия), REFM-112), src/sweepFx.ts (послесвечение радарной развёртки: яркость считается по углу ОТСТАВАНИЯ от луча, а не по расстоянию, — засветка показывает «когда контакт видели в последний раз»; угол приводится к неотрицательному, иначе узел позади луча вспыхивал бы на переходе через ноль; кривая квадратичная, чтобы момент пересечения читался; из нескольких лучей берётся самый яркий, а не сумма. Кого подсвечивать, выводится из `fogView.nodeView`, а не решается заново: помнимый узел горит НЕЙТРАЛЬНО, потому что владелец в памяти может быть устаревшим, REFM-113), src/fleetTally.ts (три числа эмблемы флота: пока во флоте есть хоть один КОРПУС, эскадрильи считаются грузом и едут ромбиками в хвосте, иначе носитель с полным трюмом читался бы втрое большим флотом; корпусов нет — крыло САМО есть флот и считается кораблями, иначе ударное крыло показало бы «0 кораблей»; десант считается отдельно, REFM-115), src/nodeCallout.ts (подпись узла на карте: мир подписан ярче и крупнее прочих секторов — он приз, а не участок маршрута; цвет подписи несёт владельца и только у опознанного узла, потому что цвет владельца и есть разведданные, а ничейный опознанный красится своим оттенком — «здесь никого» это тоже сведение; строка телеметрии живёт только на детальном зуме, и у тихого сектора лишь когда в нём что-то есть. Ветка «нет телеметрии» перенесена дословно, но СЕЙЧАС НЕДОСТИЖИМА — до подписи неопознанный узел не доходит, его перехватывает фог-маркер выше по циклу; замечено, не чинил, REFM-117), src/battleMark.ts (отметка боя на карте: якорь берётся у ВОЮЮЩЕГО флота и только при его отсутствии у узла — перехват идёт там, где корабли встретились, а не в ближайшем мире; под туманом отметки нет вовсе, иначе кольцо работало бы бесплатной разведкой; две фазы непохожи по ВСЕМ признакам, а не по одному цвету — аудит нашёл их неразличимыми; три кольца со сдвигом на треть читаются как расходящаяся волна, а не как мигание; таймер живёт только по назначенному ядром раунду, REFM-118), src/sightFrontier.ts (сводная граница видимости: круги радаров сводятся в ОДНУ границу — каждый круг отдельным подпутём, иначе два разнесённых радара стянуло бы хордой; контур это заливка МИНУС её сжатая копия, поэтому круг внутри другого своего кольца не даёт; сжатие не может съесть круг целиком — вывернутая дуга выела бы дыру посреди зоны обзора; внутренний тир читается сильнее внешнего по всем трём признакам, иначе растворится граница ОПОЗНАНИЯ; у выбранного источника внешнее кольцо пунктирное, внутреннее сплошное, REFM-120), src/kindBadge.ts (голографический бейдж типа сектора: метка ВИСИТ над узлом, а не лежит на нём — иначе сливается с собственным искусством сектора; раз висит, к узлу тянется луч проектора от КРАЯ узла до НИЗА капсулы, иначе на плотной карте непонятно, чей бейдж; покачивание фазируется координатами узла — с общей фазой карта дрожала бы целиком как одна деталь; нет знака типа — нет и бейджа; на схематичном виде растворяется вместе с LOD, REFM-121), src/buildChips.ts (ряд значков построек под узлом — единственное место, где виден состав системы без панели: ряд ЦЕНТРИРОВАН под миром, иначе узел будто съезжает вбок при каждой достройке; шаг, плитка, отступ и кегль масштабируются вместе с маркером, но у кегля есть пол в 7px — мельче буква читается как сор; под туманом ряда нет вовсе (состав чужой системы это разведданные), на схематичном виде он гаснет вместе с LOD; незнакомый тип рисуется заглушкой, а не пропускается — пропуск соврал бы о количестве построек, REFM-122), src/combatRanges.ts (RANGE-UX: радиусы артиллерии и эскадрильи берутся из тех же функций ядра, по которым идёт огонь, у ПВО радиуса нет вовсе — только отметка на мире; там же ВИД кольца, REFM-123: дальность артиллерии рисовалась ДВАЖДЫ — этим слоем и маркером выбранного флота, разным цветом и пунктиром, — дом остался один, а из дубля забрано правило «взведённый обстрел делает границу ярче»), src/assaultRings.ts (какие миры обводятся при взведённом штурме: вне приказа колец нет вовсе, свой мир не обводится, ничейный тоже — у пустого узла нет обороны, которую ломать, и только захватываемый сектор, потому что кольцо это обещание приказа; правило про ничейный мир СТРОЖЕ, чем cmdAvailability.canAssaultFromOrbit, где `worldOwner !== fleetOwner` для null истинно — расхождение записано и не тронуто, REFM-106), src/toastView.ts (всплывающее уведомление над картой: обратная связь не живёт только в скрытом журнале, поэтому событие видно поверх карты; держатся не больше трёх разом, потому что стопка выше перекрывает саму карту; живут около пяти секунд и уходят сами короткой фазой затухания, иначе тост становится модальным окном; тост с якорем ведёт к месту события и помечен стрелкой, REFM-105), src/freeBuild.ts (когда песочница возвращает ресурсы за стройку: бесплатность сделана не скидкой в ядре, а откатом — слепок кошелька снимается перед приказом и кладётся обратно после успеха; в игроцкой сборке песочницы нет вовсе, нужны обе галочки и только приказы стройки, а возврат привязан к УСПЕХУ, потому что слепок поверх отказа затёр бы доход, содержание и чужие события того же шага, REFM-104), src/selectionPrune.ts (что теряет силу вместе с флотом при смене состояния: ссылка на исчезнувший флот снимается, иначе панель и меню указывают на то, чего нет; групповое выделение чистится дважды — выпадают и пропавшие, и переставшие быть своими, потому что захваченный флот жив, но приказы ему отскочат; одиночная ссылка о владельце не спрашивает, ведь панель чужого флота это осмотр, а не приказ, REFM-102), src/noteLog.ts (как сообщение попадает в журнал матча: дословный повтор глушится на две секунды РЕАЛЬНОГО времени, потому что отскакивающий каждый кадр приказ иначе застрочит пулемётом, а игровое время на 120× пролетает мгновенно и защита отключилась бы; глушится только тот же текст — другое сообщение это другое событие; метка ставится игровая, день и час мира, ведь журнал читают как хронику матча; обе ленты режутся с головы, но пределы разные — девять строк на экране против восьмидесяти записей памяти, которую читает дайджест возвращения, REFM-101), src/introTrigger.ts (когда принятый приказ поднимает обучающую вставку ONB-3: учим на первом настоящем применении, потому что отказ ядра ничему не научит, а заранее объяснять нечего; во время тура вставки молчат — экран принадлежит его шагу, и вторая всплывашка перебила бы обучение; список «приказ → вставка» закрыт, REFM-100), src/goalTally.ts (чем меряется прогресс первых целей ONB-7: сравнение идёт с базой на момент запуска списка, а не абсолютом — у игрока на старте уже есть и мир, и флот, и шахта, поэтому абсолютный счёт отметил бы половину списка сразу; шахты считаются суммой уровней, а не числом зданий, ведь домашняя шахта уже стоит и «построить» её значит поднять уровень; считается только своё, и нужно строго больше базы, REFM-99), src/stanceToggle.ts (постановка стоек авто-штурма и дежурного вылета: кнопка ☰-ряда задаёт СОСТОЯНИЕ на всю группу, а не переключает каждый флот, иначе один тап оставил бы группу разнородной; чужие флоты стоек не имеют, а уже выставленная стойка приказа не порождает — сеть получала бы пустой приказ на каждый тап; дежурство только у флота с крылом и только с прикола вне боя, зеркалом гейта редьюсера, иначе соло поднимет патруль, который сеть отвергнет; снятие дежурства — отдельный исход, потому что при нём запоминается остаток вылета, REFM-98), src/loadQueue.ts (очередь часовой погрузки десанта: погрузка занимает игровой час, а не мгновение, и записи ставятся поштучно, потому что ядро грузит «всё или ничего» — партия одним действием отскочила бы целиком, если за этот час гарнизон обмелел; идущая погрузка занимает место в трюме заранее, а резерв гарнизона считается по МИРУ, ведь у пришвартованных к одному миру флотов он общий; ушедший, вступивший в бой или исчезнувший носитель заказ отменяет, а созревшая погрузка уходит приказом ровно один раз, REFM-97), src/radarContacts.ts (кто может стать радарной отметкой: в сети засечки приходят готовыми, потому что чужих флотов в фог-состоянии физически нет, а в соло тот же отбор делается вручную и так же строго, иначе одиночная игра покажет больше сетевой; свой флот отметкой не бывает, опознанный узел тоже — там флот виден сам, и отметка была бы его призраком; вне радарного покрытия засекать нечем, а серверные контакты покрытием не перепроверяются; ключ памяти различает источник, иначе две отметки в одном узле склеятся, REFM-96), src/fleetRoute.ts (пунктирный маршрут идущего флота: виден только свой и только у идущего — чужой план это разведка, которой у игрока нет; линия начинается с фактического места флота, а не с покинутого узла; приказ «встать на лейне» кончается точкой, а не узлом, иначе карта обещала бы прибытие, которого в приказе нет; пропавший узел маршрут не рвёт; выделенный ярче и толще. Диапазон доли остановки намеренно НЕ зажимается — его держит ядро (`targetsOf` схлопывает края в узел), REFM-95), src/orbitRing.ts (геометрия орбитального кольца: слой открывается только вблизи, и один порог держит ширину кольца, вращение и разворот шеврона; вдали кольцо ужато вдвое, вблизи распускается до 2.4×; радиус зажат сорока процентами зазора до ближайшего связанного мира, чтобы кольцо не залезло на соседа, а узлу без связей потолок не нужен; флоты разложены веером от «12 часов» симметрично центру; вращение идёт по игровому времени и замирает на паузе; на живом кольце нос шеврона по касательной, вдали радиальный, REFM-94; там же, у кого кольцо ВООБЩЕ ЕСТЬ: город имеет орбиту по типу, а узел-развязка получает её только укреплённым — крепостью или ЖИВЫМ гарнизоном (нулевые записи остаются после потерь и укреплением не считаются), — потому что такой узел приходится штурмовать, а штурм идёт с орбиты; пустая орбита не рисуется и считается по ВИДИМЫМ флотам, иначе кольцо выдало бы чужую стоянку под туманом; на схематичном виде колец нет вовсе, REFM-114), src/semanticZoom.ts (семантический зум карты: схема и детализация — кросс-фейд по масштабу камеры, а не порог, и доля зажата в [0,1], потому что ею умножают globalAlpha; арт узла и залп осады ужимаются по одному закону до 45%, иначе маркер размером с провинцию проглотит саму провинцию; свой мир подписан всегда, не ниже 0.9 даже на полной схеме — якорь игрока на любом зуме, а чужая подпись уходит с детализацией; шеврон флота и полная выкладка гасят друг друга встречно, суммой в единицу; гало планеты живёт по масштабу и не гаснет ниже 0.3, REFM-93), src/spyOffer.ts (предложение шпионажа на панели мира: свой мир не шпионят, потому что про него и так всё известно, а ничейный — потому что красть сведения не у кого; пока купленное окно живо, вместо кнопки идёт отсчёт, чтобы за уже оплаченное не платили второй раз; нехватка кредитов кнопку гасит, но не прячет — цена должна остаться на виду; остаток окна не бывает отрицательным, REFM-92), src/worldOrders.ts (что панель предлагает сделать с миром: чужой не предлагает ничего, столицей можно сделать только обитаемый мир, потому что в столице возрождается герой, а текущая столица показывает метку вместо кнопки; точки удержания Хранителя за техгейтом и без технологии там пусто, отмеченный мир предлагает снять, а лимит гасит кнопку постановки, но снять можно всегда, REFM-91), src/repairOffer.ts (условия кнопок ремонта: общая часть «свой, вне боя, есть что чинить» одна на два ремонта, а привязка к своему доку — только у экспресса за металл; док не отменяет платного за кредиты, выбор чем платить остаётся за игроком, REFM-90), src/arrearsWarnings.ts (пометки о долгах владельца: долг показывается только своему, голод отмечается лишь там, где есть кому голодать, блэкаут — свойство владельца и висит на всех его мирах, а долги независимы и одна метка не заменяет другую, REFM-89), src/armedTap.ts (судьба вооружённого приказа при тапе: приказ одноразовый — тап его исполняет или снимает, промах по пустоте это отмена, но ШТУРМ прощает неподходящую ЦЕЛЬ и остаётся взведённым, потому что промах по цели не отказ от приказа, REFM-88), src/simClock.ts (часы кадра: местная симуляция крутится только в соло — в сети часы у сервера; пауза, баннер и решённый матч останавливают мир; игровое время растёт от реального, помноженного на скорость, поэтому просадка FPS мир не замедляет; абсурдный разрыв кадра не считается ни в FPS, ни в спин орбит, REFM-87), src/eventVisibility.ts (что игрок узнаёт из журнала: своё видно всегда, чужое — только на опознанном узле; бой, в котором игрок участвовал, виден до конца, даже если узел ушёл под туман; выстрел по дуге виден по любому опознанному концу; местная симуляция повторяет серверный фог, иначе соло показывает больше сети, REFM-86), src/quickBuild.ts (быстрый заказ стройки правым кликом по плитке: он обходит окно подтверждения, поэтому зеркалит ровно те же гейты, что кнопка «Построить здесь» — свой мир, разрешение сектора, незанятое место; обрезанный якорь `kind:id` заказом не становится, а гейты сектора и занятости — только про здания, у юнитов своя очередь без лимита на мир; ветка зданий сегодня недостижима, каталог зданий живёт в окне `#buildwin` вне `#side`, REFM-85), src/friendsScreen.ts (вкладка «Друзья»: список и заявки, FRIENDS-1), src/resourceCard.ts (карточка ресурса, RC-1), src/troopsMenu.ts (модель и разметка ⇅-меню десанта, GRND-1), src/chainPlanner.ts (модель режима «Приказ», CHAIN-UX), src/abilityRings.ts (радиусы способностей на карте: живые ауры героя и висящие сканы, ABIL-RING), src/sound.ts (синтезированные звуки интерфейса, SND-1), src/hudDock.ts (низ экрана: видимость листа в прицельных режимах + привязка ряда команд к листу, HUD-DOCK; со-локальный тест сторожит ещё и CSS: докованные слои ПК — секторная панель и список инструментов рейла — меряют потолок от `--vph` = `100dvh / var(--pcz)`, видимой высоты окна при ЖИВОМ зуме, а не от зашитой догадки «66.7vh»; с догадкой на 1920×935 панель уезжала на 36px под нижний край окна вместе с концом очереди стройки), src/backLayers.ts (лестница слоёв Android-Back/Escape + опись всех оверлеев, BACK-1), src/markerTail.ts (геометрия хвоста маркера флота; там же раскладка рядов пипсов (REFM-116): ряды делятся по ФОРМЕ — ромбы это крыло, квадраты десант, и грузящаяся единица встаёт в ряд своей формы, иначе пипс «прыгнет» по окончании погрузки; ряд обрезан восемью, остаток назван числом «+N» и входит в ширину при центровке; второй ряд опускается только под непустой первый, а счётчик «×N» — только когда рядов два; доля погрузки зажата в [0, 1]), src/smoke.ts, tsconfig.json (REFM-0: typecheck в гейте), build.mjs, uitest.mjs, dist/ (артефакт, в .gitignore)```
## 4. Модель состояния (`GameState`)

- `version {data, manifest}`, `time`, `rng`.
- `players: Record<id, Player>` — `Player.resources: ResourceBag` = **казна
  игрока** (производство копится сюда, содержание/стоимости списываются),
  `technologies?` = сессионные исследования (`completed[]`, `active`).
- `planets: Record<id, Planet>` — `owner|null`, `position{x,y}`, `links?`
  (лейны графа), `terrain?` (террейн → `sectors`) и `kind?` (тип провинции → `sectorKinds`:
  capturable/buildable/orbit + ростер `allowedBuildings` + вид `appearance`), `size?`, `resources`,
  **`buildings: BuildingInstance[]`**
  (`{type, level, hp}`), `garrison: UnitStack[]` (наземная армия мира), `traits`.
- `fleets: Record<id, Fleet>` — `owner`, `location|null`, `movement|null`,
  `units: UnitStack[]` (корабли), **`landing?: UnitStack[]`** (перевозимая
  наземная армия = десант), **`orbit?: 'near'`** (одна орбита: `'near'` = стоит на
  орбите, `undefined` = в перелёте/не на орбите), **`bombarding?: boolean`**,
  `battleId?`, **`retreatHasteUntil?`** (мир-время, до которого действует баф скорости
  после отступления — читает хук `fleet.speed`).
- `battles: Record<id, Battle>` — `location`, `phase:'orbital'|'ground'`,
  `attacker/defender {ref: CombatantRef, owner}`, `round`, **`nextRoundAt?`**
  (время следующего почасового раунда — таймер боя для клиента). `CombatantRef` =
  `fleet` | `landing` | `garrison`.
- `scheduled: ScheduledEvent[]` `{id, at, type, payload, seq}`, счётчики
  `battleSeq`, `scheduleSeq`.
- `UnitStack {unit, count, hp?, shieldHp?, modules?}` (`hp` — пул корпуса, `shieldHp` — пул
  **аблятивного щита**, shields-roadmap SH-0.1). Для наземных стеков оба пула живут
  только во время боя (после — сброс в `undefined` = полное HP/щит). Для
  **корабельных** стеков (`fleet.units`) оба **сохраняются и вне боя**; вне боя
  щит регенит сам, корпус чинится только в порту (see construction, SH-1.1/2.1).
- `heroes?: Record<id, Hero>` (`{owner, location, cooldowns}`), `tempLanes?: TempLane[]`
  (временные публичные трассы), `topology?` (версия графа для инвалидации `RouteCache`),
  `heroSeq?` (счётчик id лейнов) — модуль `hero`.
- `intel?: Record<PlayerId, IntelGrant[]>` — **шпионаж (SPY-1)**: украденные «окна
  разведданных» `{kind: treasury|planet|fleets, target, until}`. `espionage.spy` платит
  (150¤ база, хук `espionage.cost`), бросает seeded-шанс (0.6 база, хук, кламп 0.05–0.95)
  и на успех даёт окно на 24ч×timeScale (хук `espionage.duration`); плата сгорает и при
  провале. `visibleState` уважает только ЖИВЫЕ гранты зрителя: казна цели / контент
  одного мира / флоты цели читаются сквозь туман; чужие гранты вырезаются (кто за кем
  шпионит — тайна вора), истечение проверяется на границе безопасности, не только
  чисткой `time.advanced`. События `intel.stolen`/`espionage.failed` адресованы вору
  (`owner` в payload — серверный фильтр событий не отдаёт их жертве). Кап 8 окон.
  **Играбельно в прототипе (H5)**: `espionageModule` подключён в `MODULES` (значит и в
  netserver); билдер `spyOn` в `game.ts`; UI — «🕵 казна»/«🕵 флоты» в развёрнутой строке
  ростера дипломатии + «🕵 Разведать мир · 150¤» на карточке чужого мира (включая
  fogged-«LAST KNOWN» — цель берётся из памяти; протухший владелец честно отбивается
  ядром). Клиентский туман уважает живые окна: `planet` добавляет узел в identify (и в
  память), `fleets` показывает флоты цели на карте (`fleetSeen`), `treasury` печатает
  ресурсы жертвы в ростере с остатком окна. Тосты `intel.stolen`/`espionage.failed`
  фильтруются по `owner === ME` (зеркало серверного фильтра). 4 e2e-теста
  (`prototype/src/espionage.test.ts`).
  **Контрразведка (SPY-2)**: каждый оплаченный `espionage.spy` бросает и ОБНАРУЖЕНИЕ
  (пайплайн `espionage.detect`; база 0.5 после провала — агент наследил, 0.25 после
  чистого успеха; кламп [0,1]; бросок всегда, чтобы форма RNG-потока не зависела от
  исхода/хуков). Обнаружение → событие `espionage.detected`, адресованное ЖЕРТВЕ:
  провал несёт `spy` (пойман с поличным), успех — только `kind` (утечка без вора);
  шпион о срабатывании контрразведки не узнаёт. В прототипе жертва-человек получает
  тост «🛡 Контрразведка…», жертва-бот роняет одобрение к пойманному шпиону на
  `FAVOUR_SPY_CAUGHT_HIT` (=20; `botDiplomacyModule` слушает событие — анонимная
  утечка никого не винит). +4 core-теста + 1 proto favour-e2e.
- `diplomacy?: Record<pairKey, DiplomaticStance>` — попарные дип-отношения (`war`/`peace`/
  `pact`/`alliance`), симметрично и **публично** (туман не режет). Дефолт пары без записи —
  `war` (= FFA). Примитивы в `state/diplomacy.ts`. **Общая видимость союза/коалиции:**
  `alliance` (в этой модели коалиция = именно эта стойка, ср. `victory.ts`) ещё и ПУЛИТ
  разведку — `coverageFor` объединяет покрытие по «блоку зрения» (сам зритель + все, с кем
  у него `alliance`), поэтому союзник видит миры/контент/флоты/бои глазами союзника. Это
  ПРЯМОЕ соседство, а не клика победы и не связная компонента: делёжка попарная, так что
  при A–B и B–C (A–C война) B видит обе стороны, а A и C — ничего друг о друге (компонента
  утекла бы картой A её врагу через B). **MAPSHARE-1:** карту делит ещё и отдельный
  ДОГОВОР `state.mapShares` — он ортогонален лестнице стоек (заключают и при мире, и при
  пакте), даёт ровно два права (общая разведка + чужой десант на свою землю через
  `army.unload`) и НЕ делает союзниками: `stanceToRelation` не трогается, в коалицию для
  победы участники не объединяются. Заключается по взаимному согласию (тот же
  consent-протокол, что смягчение стойки: `diplomacy.mapshare {target, on}` — первое
  согласие кладёт предложение, встречное коммитит), расторгается односторонне и рвётся
  сам при объявлении войны. Сам договор ПУБЛИЧЕН (как стойка), предложения — приватны
  для двоих (`mapShareOffers`, режется проекцией). Коды: `E_ALREADY_SHARED`,
  `E_ALREADY_OFFERED`, `E_NO_MAPSHARE`, `E_FORBIDDEN` (при войне), `E_NO_PLAYER`.
  Сами по себе `pact`/`peace` разведку НЕ делят. Делится только
  КАРТА: казна/техи/герои/приказы союзника остаются приватными (`project` по-прежнему
  режет по `viewerId`). Одна точка — `coverageFor`, поэтому общая видимость одинаково
  работает в проекции, памяти тумана (`visibilityModule`), фильтре событий broadcast'а
  (`matchRoom`) и скане угроз; сервер не менялся. **Посев при сборке с карты (AVA-1):**
  `buildStateFromMap` сеет стойки из `slot.team` (хелпер `seedTeamDiplomacy`, тот же посев,
  что прото-`newGame`): карта без команд → peace-FFA; та же сторона → `alliance` (seeded —
  минует `E_BOT_ALLIANCE`); между сторонами — `BuildFromMapOptions.crossTeamStart`
  (`war` дефолт / `peace` — мирный старт AvA); пары из отсортированных id — канонический
  JSON. **`combat.isHostile` читает стойку прямо из
  `state.diplomacy`** (`getStance(...) === 'war'`) — бой идёт только при объявленной войне. **ПВО бьёт залпами, двумя ярусами** (не непрерывно):
  **орбитальное** (здания-батареи, Σ их `aaDamage`) — полный залп раз в игровой час;
  **ближняя** (юниты гарнизона, Σ их `aaDamage`) — залп раз в 15 игровых минут по четверти
  часовой ставки (часовой выход тот же, окно уклонения — 15 минут). Сетки — мировое время
  ×timeScale (`roundIntervalMs`; четвертная сетка содержит часовую — на общей границе
  тяжёлый залп ложится первым), перецеливание на каждом залпе; флот, нырнувший в орбиту
  МЕЖДУ залпами, уходит невредимым — тайминг рейда мимо ПВО имеет смысл. Каждый залп — событие `aa.fired {planetId, owner, fleetId,
by, damage}` (эмит до применения урона; прототип рисует трассер+вспышку; фазы боя
  различимы: красные кольца орбиты vs янтарный пунктир десанта).
  **Ядровой `diplomacyModule` (D2+D3, `modules/diplomacy.ts`)**: ОДНО действие
  `diplomacy.declare {target, stance}` на оба направления. К войне (эскалация) —
  односторонне: стойка флипается сразу, офферы пары стираются (объявление войны
  обрывает переговоры). К дружбе — consent-протокол: первый дружественный declare
  кладёт НАПРАВЛЕННЫЙ оффер в `state.diplomacyOffers` (`from>to` → stance, новее
  замещает, точный повтор — `E_ALREADY_OFFERED`); встречный declare той же стойки
  коммитит пару и стирает офферы. На `player.eliminated` офферы павшего (в обе
  стороны) свипаются. **Коалиция — только между людьми**: alliance-ward declare с
  ИИ-игроком (`Player.ai === true`, сеется картой/слотом/`newGame` прототипа)
  отклоняется с `E_BOT_ALLIANCE` (ни оффером не встанет, ни коммитом); мир/пакт с
  ботом разрешены. События `diplomacy.changed {a,b,stance,from}` /
  `diplomacy.offered {from,to,stance}`; capability `diplomacy` `{getRelation}` —
  принимает `state` параметром (war→hostile, peace/pact→neutral, alliance→ally);
  `getStance`/`setStance`/офферные примитивы — чистый state-слой
  (`state/diplomacy.ts`). Офферы фог-чувствительны: `visibleState` отдаёт
  только пары с участием зрителя; `diplomacyOffers` — в `delta`-META. **Прототип
  использует этот же ЯДРОВЫЙ модуль (D4 ✅):** собственная реализация
  `diplomacy.declare` из `game.ts` удалена, в `MODULES` подключён ядровый (эскалация
  односторонняя и стирает офферы; смягчение — оффер (`diplomacy.offered`), встречное
  объявление коммитит (`diplomacy.changed`); повтор — `E_ALREADY_OFFERED`, тот же
  станс — `E_SAME_STANCE`, кривой target — `E_BAD_PAYLOAD`; `stance` обязателен —
  дефолт 'war' остался в билдере `declareWar`). Одна реализация на репозиторий.
  Бот отвечает в том же приказе по favour-шкале: peace принимает при
  ≥ `FAVOUR_PEACE_ACCEPT` (=15, линия войны), pact при ≥ 55, иначе отклоняет
  (`diplomacy.declined`) и стирает оффер — «висящий» оффер бывает только у людей.
  Прототип сеет всем парам `peace` в `newGame` и держит клиентский
  гейт: маршрут через чужую территорию без войны блокируется, ручной тык по ней открывает
  предупреждение «это объявит войну», ИИ объявляет войну, когда нейтралы кончились.
  **Сеть честна (№10 + NETP0-4/5)**: сессионный чат ходит через сервер (см. ниже), пинги 📍
  сетевые; смены стоек И офферы между снапшотами диффаются клиентом —
  «⚔ X объявил вам войну!» / «🕊 X предлагает: мир» всплывают тостом + бейдж
  непрочитанного на ✉ рейла; в ростере входящий оффер подсвечивает кнопку станса
  «✓ принять» (пульс), свой отправленный — «⏳» (задизейблена).
  **APK-удобство**: аппаратная кнопка «Назад» закрывает верхний слой интерфейса
  (history-sentinel: попапы → окна → меню → выделение → сетап; пустая карта → подсказка
  «ещё раз — выход»), ландшафтный телефон определяется по coarse-pointer (не только
  ширине), выбор стартового мира в сетапе ловит тап по ближайшему кандидату, cmdbar
  влезает в узкий экран (подписи 10px, перенос), пинч-зум страницы разрешён (a11y —
  жесты карты и так живут на canvas/touch-action:none).
  **Автообновление (плейтест):** APK сравнивает свой baked `window.__BUILD__`
  (versionCode = счётчик коммитов, инжект CI) с маркером СВОЕГО rolling-релиза —
  `alpha` для дев-APK, `player` для player-APK (`updater.ts` резолвит лейн из
  `__PLAYER_BUILD__`-define; GitHub REST, все отказы → «нет обновления»); `#updbar` —
  **глобальный fixed-баннер** (z-96, поверх welcome/хаба/матча — раньше жил внутри
  `#connect`, и путь возвращающегося игрока через хаб его никогда не видел), «Обновить»
  отдаёт APK-ассет системному браузеру через `window.VoidNative.open`
  (`mobile/patch-updater.mjs`), подпись стабильна (закоммиченный debug.keystore).
  Тихая проверка: на старте, при возврате приложения в форграунд
  (`visibilitychange`) и раз в 4ч — с троттлингом 15 мин; ручная — кнопка на
  `#connect` (диагностика в `cver`) и **тайл «Обновления» в хабе** (диагностика в
  `hub-note`). Браузерная «автообновляемость» — GitHub Pages
  (`pages.yml` → https://moongametechnology.github.io/MoonGame/ — ссылка всегда на свежий main);
  ⚠ требует ОДНОГО ручного включения: Settings → Pages → Source **«GitHub Actions»**
  (без него job гибнет до шагов — см. runbook-комментарий в `pages.yml`).
  **Тач-управление (№12 аудита)**: при взведённом Move палец ТЯНЕТ прицел (живое
  превью, камера не панится), отпускание = приказ, второй палец = отмена; радиус снапа
  превью равен радиусу коммита (24px мышь / 30px тач). Лонг-тап (~350мс) по своему
  флоту = добавить/убрать из группы (Ctrl-клик телефона), по пустому месту = бокс-выбор
  (Shift-драг телефона), с вибро-откликом. Нижняя панель при открытии автопанорамит
  карту, чтобы выделенный объект не прятался под ней.
  **Сессионное меню дипломатии/сообщений** (прототип, рейл → Дипломатия/Dispatches):
  ростер всех участников (иконка человек ☻ / ИИ ⌬, сорт. по имени/провинциям/отношению +
  фильтры-чипы по отношению и типу человек/ИИ — AND между категориями, OR внутри),
  смена стойки консент-офферами (NETP0-5): повышение до мира/пакта/союза записывает
  предложение, вторая сторона принимает встречным объявлением (кнопка «✓», пульс);
  бот отвечает сразу по favour-шкале; **союз с ИИ невозможен** (кнопка погашена,
  «Боты не вступают в коалиции»), понижение/война односторонни. Признак бота UI
  читает из state (`Player.ai`; в NET-режиме сервер снимает флаги — место, занятое
  человеком, не бот).
  Вкладка «Сообщения» — переписки master-detail: слева список чатов (групповой
  «⚡ Коалиция» = вы + союзники, закреплён сверху; ниже личные DM по участникам),
  справа открывается выбранный тред + composer. Живёт в `conversations.ts` (REFM-15,
  `initConversations(host)`): туда же уехали тип `SessionMsg` и словарь каналов
  (`GROUP_CHANNELS` — единственное место, где различаются групповая комната и личка), а
  открытая переписка стала внутренним состоянием (`open`/`current`). Сам журнал
  `sessionMessages` остался у хоста — его пишет сеть и читает плавающее окно чата, —
  и приходит модулю хуком `messages()`. Системные дип-события с твоим участием
  ложатся в DM с этой стороной (через `diplomacy.changed`). В чате коалиции — **пинги**:
  выделил провинцию → 📍 шлёт метку; тык по метке → камера летит туда (`centerOn`) и
  меню закрывается. **Пинг виден и на карте** как маркер-булавка (цвет владельца) с
  сонарными волнами от узла и дышащим свечением: тык по
  нему → попап с автором и **коротким описанием, которое пишет ставящий** (текст из
  composer'а) + «↪ камера» и «убрать» (для своих). Тумблер «Свои метки на карте» в
  настройках (хаб → Ещё) прячет ТОЛЬКО свои булавки (метки союзников видны всегда;
  чат-строка и серверный relay не затрагиваются; `void.showOwnPings`). Сообщения живут
  в клиенте (не в ядре — на симуляцию не влияют). **Сеть (пинги):** `MultiplayerClient` теперь шлёт `ping.place`/
  `ping.clear` и принимает `ping.added`/`ping.removed` (`onPingAdded`/`onPingRemoved`); в
  NET-режиме прототип ставит/убирает пинг через сервер (авторитетный — штампует id/TTL,
  раздаёт владельцу+союзникам, прячет от врагов), а эхо `ping.added` рисует
  маркер. **Сеть (чат, NETP0-4):** текстовый чат ходит тем же relay-узором —
  `chat.send` → сервер штампует id/время, режет текст (240), rate-limit по wall-clock
  (6/4с, работает и в замороженном лобби) и раздаёт `chat.msg` по каналу: `session` —
  всем, `coalition` — себе + живому альянсу (`areAllied` читает статические team'ы ИЛИ
  alliance из state.diplomacy), `dm` — двоим; ограниченный бэклог (100) реплеится на
  (ре)джойне, клиент дедупит по id и рендерит с серверного эха (свои строки тоже).
  Плавающее окно чата — desktop-only; на телефоне ВСЕ сетевые каналы доступны из
  Дипломатии → Сообщения: закреплённые «△ Сессия» (весь матч) и «⚡ Коалиция»
  сверху списка бесед + DM по участникам («Глобальный» — только в плавающем окне,
  ждёт глобального сервера).

**Время:** все длительности — через `schedule(at,…)`; `timeScale` (MatchConfig)
делит реальные длительности (×1/×2/×4). `time.advanced` спаны дают накопление.

## 5. Модули ядра (что делают)

Порядок в кернелах обычно: `sector, planet-type, technology, economy, movement, combat, construction, army`.

### economy (`economy`)

На `time.advanced`: **производство** каждого своего мира → казну владельца
(хук `economy.production`, масштаб по часам×timeScale); **содержание** юнитов/
гарнизонов **и зданий** (`BuildingLevel.upkeep`, ECON-5) — суточный дрейн из казны
(clamp ≥0). Неоплаченный ресурс попадает в `Player.arrears` (приватно, срезается в
fog как казна): пока долг висит, здания-потребители ЭТОГО ресурса производят на
**×`BROWNOUT`(0.5)** — свет тускнеет, не гаснет; погасил счёт — флаг снят. Формула
непрерывна (arrears прошлого расчёта тускнят следующий спан — детерминизм на любом
разбиении). **Бомбардируемый мир не производит** (`isBombarded`). Действий нет.

### market (`market`) — сессионная биржа ресурсов

Публичный per-match ордербук `GameState.market` (не путать с мета-аукционом из
`economy-roadmap.md`). Действия: **`market.list {resource, amount, price}`** —
выставить ресурс (эскроу: `amount` списывается из казны в ордер); **`market.buy
{orderId, amount}`** — купить (частично) за деньги (`credits`); **`market.cancel
{orderId}`** — продавец забирает непроданный остаток. **Комиссия 15% сжигается**
(сток против инфляции): покупатель платит `amount×price`, продавец получает 85%.
Коды: `E_BAD_PAYLOAD, E_UNKNOWN_RESOURCE, E_FORBIDDEN, E_INSUFFICIENT, E_ORDER_LIMIT
(≤20 открытых на игрока, A06), E_NO_ORDER, E_OWN_ORDER, E_BAD_AMOUNT`. Публичен (туман не режет); в `delta` META.

### movement (`movement`)

**Непрерывная позиция (как у Bytro).** Флот — это уже не «узел или в пути»: третье
состояние — **припаркован НА лейне** (`Fleet.edge {from,to,t}`, `t∈(0,1)`), взаимно
исключающее с `location`/`movement`. Лега несёт `startT`/`endT` — под-отрезок
`[startT,endT]` лейна (частичная лега из/в припаркованную точку).

Действие **`fleet.move {fleetId, to}` ИЛИ `{fleetId, toEdge:{from,to,t}}`** — маршрут
Дейкстрой по лейнам, многохоп, планирует `fleet.arrival`; на узле эмитит
`fleet.transit` (промежуточный) или `fleet.arrived` (финал). Начало **каждой** леги
(старт пути И каждый промежуточный хоп) эмитит **`fleet.leg {fleetId}`** — чтобы
combat считал перехват двух флотов, пересекающихся **на лейне**, а не только на узле.
`toEdge` — марш в **точку
на дороге**: маршрут до ближайшего конца лейна + финальная частичная лега, паркуется
(`fleet.parked`). Припаркованный флот **перемаршрутизируется** из своей точки (выбирает
дешёвый конец, может пойти назад); репозиция вдоль того же лейна — одна прямая лега.
Событие `fleet.arrival` несёт `departedAt` → устаревшее прибытие брошенной леги (после
stop + re-route) игнорируется (без телепорта). Хук `fleet.speed` (скорость = по
медленному кораблю). **Оптимизация:** `RouteCache` — ленивый кэш узловых маршрутов.
Коды: `E_BAD_PAYLOAD, E_NO_FLEET (и «не твой флот» — один код, A06), E_FLEET_BUSY,
E_SAME_LOCATION, E_NO_DESTINATION, E_NO_ROUTE, E_NOT_A_LANE, E_FLEET_IMMOBILE`.
Действие **`fleet.stop {fleetId}`** — припарковать летящий флот в его **текущей
непрерывной точке** на лейне (доля по прошедшему времени леги), эмит `fleet.parked`
— не на следующем узле, а где стоит; в глубоком космосе не зависает.

### sector (`sector`)

Хуки: `fleet.speed` (×(1+speedBonus) сектора назначения), `combat.damage`
(делит урон на (1+hpBonus) — живучесть в секторе; ×1.25 урона в своём секторе).
Типы секторов — данные. Действий нет.

### planet-type (`planet-type`)

Тип планеты (`planetType`, данные `data/planetTypes.json`, 11 типов — полный список
только в данных, не хардкодить здесь) даёт модификаторы через хуки — как сектор, но
про сам мир. `economy.production`: сначала прибавляется `baseOutput` (FND-1,
game-vision-roadmap.md — пассивный почасовой доход мира БЕЗ зданий, порт ECON-7-
констант прототипа: terran ~6 credits/3 energy/5 food/4 metal и т.д.; 10 типов
портированы 1:1, `energy_nexus` — канон-эксклюзивный, значения подобраны отдельно),
потом весь бакет (produces зданий + baseOutput) множится на ×(1+productionBonus) и
по-ресурсно на `productionByResource`; `combat.damage` (наземная фаза: урон по
гарнизону владельца ÷(1+defenseBonus); знак учитывается — защищённый мир делит,
открытый усиливает), складывается со зданиями. Без модуля — без эффекта (мягкая
деградация). Действий нет. Тесты: `planetType.test.ts` — синтетическая фикстура +
блок на РЕАЛЬНОМ шипнутом бандле (FND-1: terran без зданий → >0 credits/food/energy;
ни один шипнутый тип не «мёртв» — пустой baseOutput).

### tax (`tax`)

Гражданский налог (FND-2, game-vision-roadmap.md) — второй источник credits,
которого канону не хватало рядом с пассивным `baseOutput`. Каждый **обитаемый**
мир игрока (`isInhabited` — есть орбита И роспись построек не сужена явным
`allowedBuildings`, т.е. не астероид/мёртвый мир) добавляет `civicTax(n)` credits/ч
через хук `economy.production`, где `n` — число обитаемых миров владельца; ставка
**TAX_PER_HOUR=20** делится на `(1 + 0.06·(n−1))` — налог с одного мира падает по
мере роста империи, но суммарный доход всё равно растёт (сублинейно, не даёт снежному
кому). **RULES-2:** прибавка здания больше не константа `TAX_OFFICE_BONUS` с проверкой
по id в коде — её объявляет само здание полем `creditsBonus` (суммируется по всем
постройкам мира, уровень учитывается). Здание `tax_office` умножает ВЕСЬ кредитный доход мира (produces+baseOutput+
налог) на ×1.25. Регистрация в `DEV_MODULES` (`scenario.ts`) — сразу после
`planetTypeModule`, до `economyModule` (тот же относительный порядок, что в
прототипном `MODULES`). Порт прототипной `taxModule`/`civicTax` (`prototype/src/
game.ts`) — переиспользует уже общие `hasOrbit`/`allowedBuildings`
(`state/sectorKind.ts`), поэтому это не форк формулы, а её включение в канон.
Тесты: `tax.test.ts` — 12 (чистая математика диминишинга, `isInhabited`/
`inhabitedWorldCount`, kernel-интеграция: голый обитаемый мир/астероид/два мира/
tax_office/без модуля).

`economy-parity.test.ts` (`packages/server/src`, FND-7) — постоянный гейт против
повторного дрейфа прототип↔канон: на ШИПНУТОМ бандле через полный `DEV_MODULES`
проверяет окупаемость `mine_t1` (3–8ч по `resource-economy.md` §4 — реально ~5ч) и
что каждый из 11 canonical `planetType` (+ мир без типа) даёт >0 credits/ч. 15
тестов.

### technology (`technology`) — сессионное дерево технологий

Действие **`technology.research {technology}`** запускает исследование игрока в
рамках матча — до **2 одновременных** (база; поднимается хуком `research.slots`,
напр. учёным-«+слот», до максимума **3**). Стоимость списывается из казны сразу,
завершение планируется как `technology.complete` с учётом `timeScale`. Состояние
лежит в `Player.technologies` (`completed[]`, `active[]` — по записи на слот).

**Гейтинг данными — `technologyLock(def, state, playerId, data)`** (чистая,
экспортируется для сервера/UI): техно доступно, когда все `prerequisites` завершены
**И** наступил день `dayGate` (мировой клок: `state.time − startedAt ≥
dayGate·MS_PER_DAY`, совпадает с «Day N» матч-браузера) **И** выполнены все
`conditions`. Условия — курируемый каталог (`own_sectors` / `has_building` /
`controls_planet_type` / `has_unit` с count-порогом `min`; `has_scientist
{branch?, minLevel?}` — учёный), диспетч по `type`, fail-secure на неизвестный тип.
**RULES-4:** сам предикат одного условия — `conditionMet(cond, state, playerId, data)` —
тоже экспортируется, потому что дереву технологий надо рисовать галочку у КАЖДОЙ строки
требований, а `technologyLock` отвечает только про узел целиком. Клиентская копия этого
перебора снята: она покрывала 2 типа из 5, то есть узел с `has_building` /
`controls_planet_type` / `has_unit` читался бы как запертый навсегда, хотя ядро
исследование разрешает (в живом каталоге таких условий нет — баг был латентным).
Коды: `E_BAD_PAYLOAD, E_FORBIDDEN, E_UNKNOWN_TECHNOLOGY,
E_ALREADY_RESEARCHED, E_RESEARCH_SLOTS_FULL, E_PREREQUISITE, E_TOO_EARLY,
E_CONDITIONS_UNMET, E_INSUFFICIENT`.

Данные `data/technologies.json` задают **branch** (4 ветки-вкладки), **dayGate**,
**conditions**, tier, cost, researchTimeHours, prerequisites, unlocks и effects.
Модуль подключается только через хуки: `construction.requirement` закрывает
юниты/здания из unlocks, пока технология не завершена; `economy.production`,
`fleet.speed` и `combat.damage` применяют сессионные бонусы; `research.slots`
поднимает число слотов. Без модуля unlock-гейт мягко деградирует: строительство
остаётся открытым. **Предматчевый выбор (C3):** `SlotAssignment.technologies`
(`buildStateFromMap`) выдаёт посаженному в слот игроку стартовые технологии как
`completed` — бонусы/анлоки действуют с первой секунды; неизвестный id валит сборку
(`E_UNKNOWN_TECHNOLOGY`, fail-secure), дубли схлопываются, prerequisites намеренно
не проверяются (стартовый кит может дарить узел из середины дерева).
**Премиум-слив (SES-3, GDD §4.3):** `technology.boost {technology}` — платит
`data.researchBoost.cost` (деф. **50 energy** — решение владельца: премиум = energy,
добывается на редких мирах `energy_nexus` из `planetTypes.json`: +100% energy,
+30% обороны — горячая точка) и режет ОСТАВШЕЕСЯ время активного исследования на
`initialPercent × decay^boosts` (деф. 25% с затуханием ×0.5 за буст — убывающая
эффективность, мгновенного завершения не купить; юниты/бой/герои не трогаются).
Ускорение = решедул: `completesAt` двигается раньше + новое `technology.complete`;
старое событие делается no-op штатным stale-гардом (несовпавший `completesAt`).
Счётчик `ActiveResearch.boosts`; конфиг `GameData.researchBoost`
(`ResearchBoostDefSchema`, zod-default — старые бандлы не тронуты); событие
`technology.research.boosted`. Коды: `E_NOT_ACTIVE`, `E_TOO_LATE`, `E_INSUFFICIENT`,
`E_BAD_PAYLOAD`.

### scientist (`scientist`) — research-лидер (учёный)

Выбирается на старте и снапшотится в совет `Player.scientists[{id, level}]` (≤2;
legacy-поле `scientist` только читается через `scientistsOf`) через слот-ассайнмент
`buildStateFromMap`; `E_UNKNOWN_SCIENTIST` при неизвестном id; приватен в тумане —
у чужих проекций стрипаются ОБА поля, и совет, и legacy (2026-07-30 закрыта утечка:
`project` резал только legacy-`scientist`, а состав совета противника уезжал сквозь
туман). Каталог `data/scientists.json`
(`ScientistDef {name, branch?, slotBonus}`) — НЕ юнит, НЕ hero-модуль. Эффекты идут
через существующие швы: **`+слот`-лидер** добавляет `slotBonus` в хук
`research.slots` (клампится к 3); **фокус ветки и лейт-капстоун** — data-driven через
условие `has_scientist` (качественный доступ, **не % скорости**). `+слот`
INSTEAD-of-фокус — opportunity-cost (лидер-«+слот» branchless). Уровень — мета (из
аккаунта; пока параметр сборки — `account-level` ещё docs-only).

### combat (`combat`) — бой, орбиты, ПВО, бомбардировка

- На `fleet.arrived`/`fleet.transit`: флот встаёт на **орбиту** (одна орбита, `'near'`);
  `engageFleets` авто-завязывает **орбитальный бой флот-vs-флот** при встрече
  враждебных флотов **на узле** (прибытие само по себе **не** захватывает).
- **Перехват на лейне** (`fleet.leg`/`fleet.parked` → `fleet.intercept`): два
  враждебных флота, пересекающиеся **на одном лейне** (а не на узле), сводятся
  «встречей по формуле» — позиция каждого линейна по времени, момент пересечения
  решается аналитически (интерполяция позиций 0..1 на концах окна перекрытия), и в
  эту точку планируется `fleet.intercept`. Событие **самопроверяется** при срабатывании
  (оба ещё на лейне, враждебны, живы, свободны), так что переприказ до контакта
  делает устаревший перехват безвредным no-op. На встрече оба флота пинятся к точке
  на лейне (`edge`) и начинается орбитальный бой; победитель остаётся припаркован на
  лейне (без телепорта на узел).
- `combat.tick` — почасовые раунды: атакующая сторона бьёт `attack`, стоящий
  защитник — `defense` (ответный огонь). **Кап линии огня** (Bytro-стиль): урон
  стороны суммируют максимум **`COMBAT_UNIT_CAP` = 10 юнитов** — сильнейшие по
  эффективному стату первыми (тай-брейк по id юнита; `cappedUnitStat`,
  `util/stacks.ts`); все сверх капа только впитывают урон (пулы корпуса/щита —
  без капа). Кап действует на обе стороны любого рода (флот/десант/гарнизон),
  на бомбардировку и артиллерию; ПВО (`aaDamage`) и карго — вне капа.
  `previewBattle` считает с тем же капом (паритет закреплён тестом). Линии
  `front/mid/rear/artillery`
  (артиллерия — трейт `artillery`, в ближнем бою бьёт `attack` и получает урон
  последней; вне боя бьёт **на расстоянии** — см. `runArtillery` ниже). Пул HP стека с переносом, `unit.died`. **Это же — сейчас — и наземная фаза** (десант/гарнизон),
  плоской моделью, той же, что флот/орбита. `state/groundCombat.ts` (FND-4,
  game-vision-roadmap.md) — готовый, протестированный тип-матричный движок
  (`GROUND_ROSTER` militia/heavy_infantry/special_forces/tank, пер-цель atk/def,
  `COMBAT_WIDTH`=12 — порт прототипа 1:1) ЛЕЖИТ РЯДОМ как самостоятельный чистый
  модуль (как `previewBattle.ts`), но **ещё не подключён** — наземная фаза здесь
  резолвится через тот же общий путь, что ниже. Замена флага `battle.phase ===
  'ground'` на матричный движок — отдельный, более рискованный шаг (детерминизм/
  replay/RNG golden-тесты), сознательно отделён. Интервал раунда =
  `MS_PER_HOUR / timeScale`; `battle.nextRoundAt` несёт время следующего раунда
  (таймер боя). Урон через хук **`combat.damage`** (args: battleId, phase, location,
  attacker, defender). Исход → `battle.resolved`.
- **Аблятивный щит (shields SH-0.2):** `applyDamage` сначала снимает `shieldHp` стека,
  остаток — в корпус (`hp`); корабль гибнет **по корпусу** (щит не убивает), павшие
  корабли уносят щит (пул капается `newCount × shield`). Наземным `finishBattle` сбрасывает
  оба пула, корабли — сохраняют. Реген вне боя — `construction` на `time.advanced`
  (SH-1.1): щит регенит бесплатно, корпус — только в порту.
- Действие **`fleet.orbit {orbit:'near'}`** — «выйти на орбиту» (одна орбита,
  единственное значение — `'near'`; прибытие на объект ставит флот на неё само).
- Действие **`fleet.assault`** — стоя **на орбите**: штурм гарнизона десантом
  (`landing`) или оккупация необоронённого враждебного мира. Победа десанта →
  `capturePlanet` (десант становится гарнизоном, `planet.captured`). Коды:
  `E_WRONG_ORBIT, E_ORBIT_CONTESTED, E_NO_TROOPS, E_OWN_PLANET, E_NO_PLANET, E_FLEET_BUSY,
  E_NOT_CAPTURABLE,…`. **RULES-3:** незахватываемая цель (пустота) теперь отбивается
  кодом на входе, а не «успешно» ничего не делает — раньше приказ проходил, а
  `capturePlanet` молча выходил по `isCapturable`, и правило было неспрашиваемым
  (`canApply` отвечал «можно» на заведомо пустой приказ), из-за чего каждый драйвер
  постоянных приказов держал свою копию проверки.
- Действие **`fleet.bombard {on}`** — тумблер бомбардировки (стоя на орбите,
  враждебный мир, есть корабли; `E_NO_SHIPS`).
- На `time.advanced` — **орбитальный тик** (`runOrbital`): (а) **ПВО** —
  гарнизонный `aaDamage` бьёт по враждебному флоту **на орбите**, **если
  нет наземного штурма** (иначе ПВО просто обороняет гарнизон как наземный
  юнит); обнулённый флот уничтожается. (б)
  **Бомбардировка** — каждый бомбящий флот эмитит `planet.bombarded
{planetId, power, owner}` (`power = Σ attack × 0.5 × часы`, Σ — по капу
  10 юнитов, как в ближнем бою).
  **Оптимизация `runOrbital`:** пре-индекс флотов по локации + сет наземных штурмов;
  стоимость O(planets + fleets + battles) вместо O(planets × fleets).
- На `time.advanced` — **артиллерийский залп на расстоянии** (`runArtillery`,
  GDD §7.2 «бьёт на расстоянии»): каждый **свободный, СТОЯЩИЙ** флот (не в бою, без
  `movement`) с юнитами-трейтом `artillery` обстреливает **ОДНУ** враждебную
  **стоящую** цель-флот в радиусе `range` (евклид, единицы карты; макс. среди
  артиллерии флота). **Чистый стэндофф** — без ответного огня и без входа в бой;
  урон `= Σ(artillery count × attack) × часы`. Два инварианта: (1) только стоящие
  стрелок+цель — их позиции постоянны на отрезке, так что разовая проверка радиуса и
  биллинг за весь отрезок ТОЧНЫ (урон не зависит от дробности шага времени; летящий
  флот вместо этого дерётся столкновением-перехватом). (2) **Одновременность** — все
  залпы считаются из снимка до отрезка, затем применяются, так что две артиллерии,
  выбивающие друг друга, обе успевают выстрелить (как пред-раундовая модель
  `combat.tick`, без форы по id). Авто-цель — **ближайший** враждебный флот
  (тай-брейк по id); событие `artillery.fired`. Обнулённая цель → `fleet.destroyed`.
- Действие **`fleet.barrage {fleetId, targetId|null}`** — фокус-огонь: навести
  артиллерию на конкретный враждебный флот (`barrageTarget` на флоте) или сбросить
  (`null` → авто-ближайший). Устаревшая цель (погибла / вышла из радиуса) сбрасывается
  сама. Коды: `E_NO_FLEET (вкл. «не твой»), E_NO_ARTILLERY, E_NO_TARGET (вкл. «не враг» —
не течёт стойка, A06), E_BAD_PAYLOAD`. Поиск флота по цели — **own-key** (`__proto__`/`constructor` не
  проходят, защита от отравления `barrageTarget` → тихий DoS отрезка).
- **Режимы огня артиллерии** (`barrageMode` на флоте, лестница агрессии; действие
  **`fleet.barrageMode {fleetId, mode}`**): **`passive`** — не стреляет; **`return`**
  — только после того, как флот получил урон (флаг `barrageProvoked`, ставится в
  `applyDamageToSide`); **`standard`** (дефолт) — по тем, с кем **война**;
  **`aggressive`** — по любому флоту, кроме **пакта/союза** (т.е. война ИЛИ мир —
  открывает огонь по несоюзным соседям). Стойка читается из `state.diplomacy`.
- Действие **`fleet.retreat {fleetId}`** — выйти из орбитального боя. Плата: **−40%
  ТЕКУЩЕГО корпуса и щита** на стек (`applyRetreatToll`; израненный флот теряет 40% остатка,
  корабли гибнут при усадке пула, но **сам отход флот не добивает** — 0.6×остаток > 0, десант
  в трюме уходит вместе с кораблями); награда: **баф скорости** ×1.5 на 3ч (`retreatHasteUntil`,
  хук `fleet.speed`). Уход с орбиты ВНЕ боя — обычный `fleet.move`, бесплатен. Бой 1-на-1
  распускается, противник освобождается (`releaseOrDestroyFleet`).
  Только орбитальный корабль-сторона (не десант/гарнизон). Событие `fleet.retreated {escaped}`.
  Коды: `E_BAD_PAYLOAD, E_NO_FLEET (вкл. «не твой»), E_NOT_IN_BATTLE, E_CANNOT_RETREAT`.

### construction (`construction`) — здания + наземная стройка

- Действия **`building.construct`**, **`building.upgrade`**, **`unit.build
{count}`** — оплата вперёд из казны, отложенное завершение через
  `construction.complete` (`buildTimeHours`×timeScale). Сколько экземпляров здания
  может стоять на мире, объявляет каталог полем **`maxPerPlanet`** (дефолт 1 — «одно
  каждого типа, уровень растят улучшением»; RULES-2: раньше это была строка в редьюсере,
  причём в ТРЁХ местах: заказ, возобновление паузы и обработчик `construction.complete`
  — последний барьер против дубля завершения); юниты идут в гарнизон. Коды: `E_BAD_PAYLOAD, E_NO_PLANET,
E_FORBIDDEN, E_UNKNOWN_BUILDING/UNIT, E_ALREADY_BUILT, E_ALREADY_QUEUED,
E_NO_BUILDING, E_MAX_LEVEL, E_INSUFFICIENT, E_BOMBARDED, E_WRONG_SECTOR,
E_NO_SHIPYARD`.
- **Верфь-гейт на постройку кораблей (bugfix, `enablesShipConstruction`):**
  `unit.build` для юнита с `domain: 'space'` требует хотя бы одно ЖИВОЕ (`hp>0`)
  здание с флагом `BuildingDef.enablesShipConstruction` (`shipyard`/`spaceport`
  в `data/buildings.json`) на планете — иначе `E_NO_SHIPYARD`; наземные юниты
  (`domain: 'ground'`) гейт не проверяет. Проверяется ПОСЛЕ тех-лока
  (`requireUnlocked`), так что заблокированный технологией юнит всё ещё даёт
  `E_TECH_LOCKED`, не маскируется отсутствием верфи. Каждый домашний мир
  (`prototype/src/game.ts newGame`, `packages/server/src/scenario.ts
  createDevMatch`, `data/maps/*.json`) стартует с `spaceport`, иначе постройка
  флота с хода 1 была бы невозможна.
- **Ростер по типу провинции (province-centric):** `sectorKinds[kind].allowedBuildings`
  — единый источник «что здесь строится», редактируется в одном месте. `building.construct`
  проверяет `building ∈ allowedBuildings`, иначе `E_WRONG_SECTOR`. Отсутствует/`undefined`
  = любое здание (kind не задан → пермиссивно); явный `[]` = строить нельзя (empty/debris).
  Так у каждого типа свои постройки: **планета** — всё; **астероид** — шахты/радар/форт;
  **туманность** — радар/форт; **`void_station`** — верфь/космопорт/радар/форт (без шахт/казарм).
- **`sectorKinds` = единый реестр типов провинций** (планета — тоже провинция): на каждый kind
  — структурные флаги (`capturable/buildable/orbit`) + ростер (`allowedBuildings`) + вид на карте
  (`appearance{color,label,shape}`, резолвится по kind на клиенте, в `GameState` не хранится).
  Аксессоры: `allowedBuildings(data, planet)`, `sectorAppearance(data, planet)`. Экономические
  слои (`terrain`/`planetType`: производство/защита/скорость/HP/очки) остаются ортогональными.
  `PlanetSnapshot.kind` снапшотится в тумане → неразведанный узел не утекает истинным типом,
  а вспомненный показывает запомненный. Прототип красит провинцию по `appearance.color` и
  показывает тип + ростер в панели.
  планетой** (иначе вложение сгорает); **под бомбардировкой — пауза\*\* (re-defer).
- Хук `combat.damage`: **бонус обороны гарнизона** = сумма `defenseBonus`
  зданий (наземная фаза). На `combat.round` (наземный штурм) и на
  `planet.bombarded` — **износ/разрушение зданий** (`building.destroyed`).
- **Лечение/ремонт на `time.advanced`:** (а) **гарнизон** лечится по сумме
  `healRate` зданий (госпиталь). (б) **Корабли флота** (`fleet.units`) — **два пула**
  чинятся по-разному (shields SH-1.1): **щит** (`shieldHp`) регенит **бесплатно где угодно
  вне боя** (`SHIELD_REGEN` 6%/ч), после **задержки** от последнего урона (`lastDamagedAt` +
  `SHIELD_REGEN_DELAY`, реген только на части спана после окна); **корпус** (`hp`) **не** регенит
  бесплатно — чинится только пока флот стоит над **своим** миром **с ремонтной верфью** (SH-2.1:
  Σ `BuildingDef.shipRepair`; `shipyard` 0.1/ч, `spaceport` 0.05/ч; госпиталь корпус НЕ чинит), и до
  ремонта **тянет скорость вниз** (`route.ts fleetBaseSpeed` — штраф <30%). Флот в бою (`battleId`) не
  регенит ничего.
- События: `construction.started, building.constructed/upgraded/destroyed,
unit.built`.

### station (`station`) — аванпосты в пустом космосе

Контекст: корабли теперь **почти слепые** (`visibility.ts`: identify-флуд флота = 0
прыжков, видит только свой узел; миры — 1 прыжок). Разведка — через **радар**
(постройка `radar` или юнит с `radarRange`). Чтобы вынести радар/форт **в пустоту**,
нужен аванпост: пустой космос нельзя ни захватить, ни застраивать (`sectorKinds.empty`).

Действие **`station.deploy {planetId}`** — закрепить станцию на **пустом** узле из
стоящего там своего флота: узел становится владеемым застраиваемым **`void_station`**
(`sectorKinds`: capturable/buildable), оплата вперёд из казны. Дальше обычной
`building.construct` на нём поднимается радар/форт/прочее. Станция — настоящий узел:
оставишь без гарнизона — враг заходит (capture-on-arrival). Коды: `E_BAD_PAYLOAD,
E_NO_PLANET, E_NOT_EMPTY, E_FORBIDDEN, E_NO_ANCHOR, E_INSUFFICIENT`. Событие
`station.deployed`. Новый модуль + данные, ядро не тронуто.

### army (`army`) — разделение флота и наземной армии + транспорт

Действия **`army.load`** / **`army.unload {fleetId, unit, count}`** — перекладка
наземных юнитов между гарнизоном и трюмом флота, в пределах **вместимости**
(`Σ cargoCapacity` кораблей; груз занимает `cargoSize`). Корабли (`domain:space`)
возить нельзя; юниты с трейтом **`immobile`** (стационарные установки — орбитальное
ПВО) грузить нельзя (`E_IMMOBILE`). Коды: `E_NO_CAPACITY, E_NO_ARMY, E_NOT_GROUND,
E_IMMOBILE, E_FLEET_BUSY, E_FORBIDDEN, E_NO_PLANET, E_UNKNOWN_UNIT, E_BAD_PAYLOAD`.
События `army.loaded/unloaded`.

**ALLY-LAND — куда можно высаживаться.** У погрузки и высадки правила РАЗНЫЕ, поэтому
владельца мира проверяет каждое действие само, а не общий `resolve`:
- **`army.load` — только свой мир.** Союзный гарнизон не твой ресурс: иначе «помощь»
  превращалась бы в вывоз чужой обороны. Идущий наземный бой погрузку запирает
  (`E_UNDER_ASSAULT`) — иначе защитник уплыл бы небитым, уклонившись от размена.
- **`army.unload` — свой мир, мир СОЮЗНИКА (`alliance` = коалиция) и мир того, с кем
  заключён ОБМЕН КАРТАМИ (`state.mapShares`, MAPSHARE-1).** Оба права даны по взаимному
  согласию, поэтому чужие войска никого не пускают молча; мир/пакт без договора закрыт.
  Идущий бой высадку НЕ запирает — подкрепление осаждённого союзника и есть главный
  сценарий, а ссылка защитника (`kind: 'garrison'`) адресует мир, а не снимок стеков,
  так что подошедшие войска считаются со следующего раунда.
Союзность спрашивается через `isAllied(h, a, b)` (`util/combat.ts`) — тот же путь, что
у `isHostile`: capability `diplomacy`, а без модуля дипломатии честное чтение D1-стойки.

**Общий запрос:** `isBombarded(state, planetId)` / `bombardedPlanets(state)` (`state/orbit.ts`) —
есть ли враждебный бомбящий флот на near; используют economy и construction.
**Оптимизация:** `bombardedPlanets(state)` строит `Set<PlanetId>` за один проход O(fleets),
затем O(1) на проверку; economy вызывает один раз на `time.advanced` вместо O(fleets) на планету.

### fleetOps (`fleet-ops`) — формирование флота из гарнизона

Закрывает разрыв между «построено» (`constructionModule` кладёт готовый корабль в
гарнизон) и «играбельно» (до этого модуля ничего не выводило построенный корабль ИЗ
гарнизона — на живом мультиплеерном сервере поднять флот было нельзя вообще). Порт
прототипного `fleetLaunchModule` (`prototype/src/fleetLaunch.ts`, REFP-10).

- **`fleet.launch {planetId}`** — поднимает гарнизон в новый флот: корабли (`domain:
  space`) → `units`, поднимаемые наземные (`domain: ground`, не `immobile`) → `landing`
  в пределах `Σ cargoCapacity`; `immobile`-установки (орбитальное ПВО) остаются.
  Заблокирован, пока гарнизон держит бой (`garrisonUnderAssault`). Коды: `E_NO_PLANET,
  E_FORBIDDEN, E_EMPTY_GARRISON, E_UNDER_ASSAULT, E_NO_SHIPS, E_BAD_PAYLOAD`.
- **`fleet.merge {from, into}`** — сливает два стоящих на месте флота (`mergeStacks` —
  коалесцирует только одинаковый юнит+лоадаут+полное здоровье, повреждённые/разно
  оснащённые стеки остаются раздельными); герой на поглощённом флоте перевязывается
  на `into.fleetId`, чтобы не осиротеть. Коды: `E_SAME_FLEET, E_NO_FLEET, E_FORBIDDEN,
  E_IN_BATTLE, E_NOT_COLOCATED, E_BAD_PAYLOAD`.
- **`fleet.split {fleetId, take[]}`** — отделяет выбранные корабли в новый флот на том
  же месте (`takeFromStacks` — апорционирует пул `hp`/`shieldHp` пропорционально, не
  дублирует корпус); héro-юнит нельзя отделить отдельно от сущности героя. Коды:
  `E_NO_FLEET, E_FORBIDDEN, E_IN_BATTLE, E_IN_TRANSIT, E_HERO_UNIT, E_NOT_ENOUGH,
  E_SPLIT_EMPTY, E_SPLIT_ALL, E_BAD_PAYLOAD`.
- **`fleet.engage {fleetId, targetId}`** — намеренная атака на совместно стоящий
  враждебный флот (прибытие уже авто-резолвит столкновение через `combatModule`'s
  `fleet.arrived`; это путь для двух флотов, УЖЕ делящих узел без боя — например один
  прибыл в мирное время, войну объявили после). Самодостаточная сборка боя (не
  переиспользует приватный `startBattle` из `combat.ts` — «модули не импортируют друг
  друга», инвариант #3), но раунд той же каденции (`hoursToMs`). Коды: `E_SAME_FLEET,
  E_NO_FLEET, E_FORBIDDEN, E_NOT_HOSTILE, E_IN_BATTLE, E_NOT_COLOCATED, E_BAD_PAYLOAD`.

Портирован С АДАПТАЦИЕЙ (не 1:1, в отличие от чистых REFP-переносов): прототип
проверяет наземный домен трейтом `'ground'`, канон — полем `domain: 'ground'`
(`UnitDefSchema`); поиск флота по id из недоверенного payload — `ownFleet` (own-key,
A06/A08 — отравленный id вроде `__proto__` читается как отсутствие флота); перевязка
carrier-дивизий при merge из прототипа НЕ портирована — и после H4-REVERT перевязывать
нечего: концепция дивизий снесена в обеих реализациях. Новые переиспользуемые утилиты — `loadoutKey`/
`takeFromStacks`/`mergeStacks` в `util/stacks.ts` (были только в прототипном
`fleetStacks.ts`, REFP-3). Не портирован авто-рэлли на `unit.built` (прототипная
UX-удобность — только что построенный корабль сам летит в общий флот на орбите) —
сознательно отложено: `fleet.launch` уже даёт игроку способ вывести весь гарнизон
одним действием, авто-рэлли не блокер, а полировка.

### capital (`capital`) — назначаемая столица (якорь возрождения героя)

Порт прототипного `capitalModule` (`prototype/src/capital.ts`, REFP-14). `heroModule`
уже читал `hero.home` как fallback-точку возрождения (`[home, location].find(owned)`),
но ничто не позволяло игроку ПЕРЕНАЗНАЧИТЬ его после старта матча — этот модуль закрывает
разрыв.

- **`capital.designate {planetId}`** — назначает свой обитаемый мир столицей;
  перевязывает `home` у ВСЕХ героев игрока разом. `isInhabited` реализован инлайн
  (`hasOrbit` + нет `allowedBuildings`-ограничения) — не импортирован из `modules/tax.ts`
  («модули не импортируют друг друга», инвариант #3); `hasOrbit`/`allowedBuildings`
  сами по себе утилиты `state/sectorKind.ts`, не модуль. Коды: `E_NO_PLANET,
  E_FORBIDDEN, E_NOT_INHABITED, E_BAD_PAYLOAD`. Событие `capital.designated`.
- `GameState.capital?: Record<PlayerId, PlanetId>` — новое опциональное поле (тот же
  паттерн, что `market`/`intel`/`diplomacy`); `capitalsOf`/`capitalOf` — чтение.
  **Приватно в тумане** (2026-07-30): чужая столица — якорь возрождения героя, та же
  targeting-интел, что hold points Хранителя; `visibleState` оставляет только свою
  запись (UI и так читает лишь `capitalOf(s, ME)`).

### standingOrders (`standing-orders`) — стоячие приказы + очередь приказов (CC-1/CC-2/CC-4)

Порт прототипного `standingOrdersModule` (`prototype/src/standingOrders.ts`, REFP-15) —
модуль хранит и валидирует ТОЛЬКО намерение игрока и подчищает его для мёртвых флотов
(`time.advanced`). Сам драйвер (кто и когда решает «пора штурмовать»/«пора скремблить») —
это НЕ функция ядра (много раз вызывает `applyAction`/`submitServerAction` СНАРУЖИ одного
прохода событий), поэтому живёт вне `shared-core`: **CC-2 (авто-штурм) и CC-4 (дежурный
вылет) теперь портированы на канонический сервер** — `packages/server/src/
standingOrderDriver.ts` (`autoAssaultActions`/`patrolActions`/`standingOrderTickActions`),
подключён в `clockDriver`'s `onTick` через `serverWiring.ts` (см. секцию сервера ниже).
**CC-1 (потребление головы цепочки, `order.chain`) всё ещё НЕ портирован** — заход
специально не брал `serverChainActions` (больше видов шагов, слежение за кулдауном
способности героя), это отдельный, более крупный follow-up. Ни один из портированных
драйверов не завязан на ИИ/бота — чистые функции над явным состоянием, применяемые
предсказуемо через `submitServerAction`.

**RULES-3 — авто-штурм спрашивает ядро, а не переписывает правила.** Оба драйвера
(`packages/server/src/standingOrderDriver.ts` и прототипный
`prototype/src/serverDrivers.ts`) больше не повторяют условия штурма своими словами:
захватываемость, владельца, дипломатию, чужой флот на узле, наличие десанта и уже
идущий наземный бой называет ядро через `canApplyAll` — тем же кодом, каким отбило бы
сам приказ. Серверный драйвер получает пробу параметром (`probe`, из `MatchRoom`) и
делает это НЕ опционально: дефолт «нет ядра — решай сам» вернул бы вторую копию правил
через чёрный ход. Флаг игрока (`state.autoAssault`) остаётся местной политикой — это
согласие, а не правило. Что это починило: рукописные условия не знали `E_NO_TROOPS` и
`E_UNDER_ASSAULT`, поэтому драйвер выдавал обречённую пару каждое пробуждение, а её
первая половина (орбита) успевала примениться. Заодно у прототипного драйвера обход
флагов стал сортированным — несортированный делал ПОРЯДОК выдачи приказов зависимым от
порядка ключей JSONB, то есть от хоста и гибернации (инвариант №6).

- **`order.auto {fleetId, on}`** — взводит/снимает флаг `state.autoAssault[fleetId]`
  (авто-штурм при простое у враждебного мира). Коды: `E_NO_FLEET, E_BAD_PAYLOAD`.
- **`order.scramble {fleetId, on}`** — взводит/снимает дежурный вылет
  `state.patrols[fleetId]` (центр = текущая позиция, радиус = `squadronStrikeRange`,
  запас вылетов — свежий или подхваченный из `wingSorties`, если снимали и взводят
  заново). Требует крыло (`fleetHasSquadron`) и простой (`fleetIdle`). Коды:
  `E_NO_FLEET, E_NO_SHIPS, E_CONDITIONS_UNMET, E_BAD_PAYLOAD`.
- **`patrol.stamp {fleetId, sortie, rearmAt?}`** — рантайм-штамп СЕРВЕРНОГО драйвера
  (тратит/восстанавливает запас вылетов дежурного крыла); гейт-схемы намеренно НЕТ
  (`actions/payloadSchemas.ts`) — с провода недостижим, штамп своего крыла заправил бы
  топливо бесплатно. Коды: `E_NO_FLEET, E_NO_TARGET, E_BAD_PAYLOAD`.
- **`order.chain {fleetId, steps[]}`** — атомарно ставит/снимает (`steps: []`) весь план
  флота `state.orders[fleetId]={steps}`; шаги валидируются `validateChainSteps`
  (`state/chain.ts`, порт `prototype/src/chain.ts`) — только известные виды
  (`move`/`wait`/`assault`/`barrage`/`strike`/`ability`, ровно набор гейт-схемы и
  прототипного словаря; `ability` требует реальный `abilityId` из `data.heroAbilities`
  — валидатор берёт каталог через `ctx.data`), только известные миры, кап
  8 шагов. Коды: `E_NO_FLEET, E_BAD_PAYLOAD`. _Исторический разъезд закрыт:_ первый
  порт «обрезал» `ability` («под него нет гейт-схемы»), из-за чего соло принимал шаг,
  а gated-сервер отбрасывал весь план `E_BAD_PAYLOAD`; теперь все три копии словаря
  (гейт-zod / `state/chain.ts` / `prototype/src/chain.ts`) совпадают и запинены тестами.
- **`chain.stamp {fleetId, steps[], waitUntil?}`** — рантайм-штамп СЕРВЕРНОГО драйвера
  (потреблённая голова / взведённый дедлайн ожидания); гейт-схемы тоже намеренно нет.
  Коды: `E_NO_FLEET, E_NO_TARGET, E_BAD_PAYLOAD`.
- Подчистка на `time.advanced`: любая запись в `autoAssault`/`patrols`/`wingSorties`/
  `orders`, чей `fleetId` больше не существует, удаляется; опустевшая карта убирается
  целиком (та же гигиена дельт, что у `diplomacyOffers`).
- Новые поля `GameState`: `autoAssault?/patrols?/wingSorties?/orders?` (тот же паттерн
  опциональных карт, что `market`/`capital`); `PatrolEntry` — форма записи дежурства.
  `state/visibility.ts` уже заранее (до этого модуля) знала стричь `orders`/`autoAssault`/
  `patrols` как приватное намерение владельца флота — при порте добавлен `wingSorties` в
  тот же список (тот же принцип: чужой запас топлива дежурного крыла не публичен).
  `state/delta.ts` не требует правки — новые ключи верхнего уровня уже покрыты его
  общим механизмом HOST-EXTENSION (`extensionKeys`), как и `capital` до них.

### instantRepair (`instant-repair`) / fleetRepair (`fleet-repair`) / forcedMarch (`forced-march`)

Три маленьких, независимых экономических действия флота — закрывают последнюю
тройку разрывов «гейт-схема есть, обработчика нет» (`fleet.instantRepair`/
`fleet.repair`/`fleet.forcemarch`), тем же методом diff схем/обработчиков, что
`fleetOps`/`capital`/`standingOrders`. Порты прототипных `instantRepairModule`
(`prototype/src/instantRepair.ts`, REFP-17), `econScrewsModule`
(`prototype/src/econScrews.ts`, REFP-18) и `forcedMarchModule`
(`prototype/src/forcedMarch.ts`, REFP-16).

- **`fleet.instantRepair {fleetId}`** — мгновенный топ-ап корпуса ВСЕХ стеков
  (корабли + десант) за кредиты, из любого места («золотой ремонт»). Коды:
  `E_BAD_PAYLOAD, E_NO_FLEET, E_IN_BATTLE, E_NO_PLAYER, E_NOTHING_TO_REPAIR,
  E_NO_FUNDS`. Событие `fleet.instantRepaired`.
- **`fleet.repair {fleetId}`** — тот же топ-ап, но за metal и ТОЛЬКО у своего дока
  (`fleetAtOwnDock` — стоит на месте над своим миром, здание с `shipRepair > 0`
  живо). Коды те же + `E_NO_DOCK`. Событие `fleet.repaired`.
  `missingHull`/`instantRepairCost`/`dockRepairCost`/`fleetAtOwnDock` живут в
  `util/repair.ts` (утилита, не модуль — «модули не импортируют друг друга»,
  инвариант #3), общие для обоих действий.
- **`fleet.forcemarch {fleetId, on}`** — взводит/снимает флаг форс-марша: пока
  флот В ПУТИ и флаг взведён, `fleet.speed`-хук множит скорость на `×1.5`, а
  `time.advanced` начисляет износ корпуса `5%` max-hp в игровой час (последняя
  единица корпуса не гасится — стек не исчезает от одного форс-марша); флаг
  снимается сам на `fleet.arrived`. Коды: `E_BAD_PAYLOAD, E_NO_FLEET`.
- Новые поля `GameState`: `forcedMarch?: Record<FleetId, true>` (тот же паттерн,
  что `autoAssault`); `state/visibility.ts` уже заранее знала стричь `forcedMarch`
  как приватное намерение владельца флота (заготовлено вместе с `orders`/
  `autoAssault`/`patrols`) — правка не потребовалась.
- Own-key `ownFleet` (A06/A08) — отравленный id вроде `__proto__` читается как
  отсутствие флота, тот же паттерн, что `fleetOps`/`standingOrders`.

### victory (`victory`) — победа и счёт

`victoryModule` слушает `time.advanced`, `planet.captured`, `fleet.destroyed`,
`battle.resolved`, `unit.built`; пересчитывает `GameState.match.scores` и завершает
матч событием `match.ended`. Гонка триггеров (GDD §3.2): **доминирование** по доле
**КАПЧУРНЫХ** провинций (некапчурный void в знаменатель не идёт; по умолчанию 60%,
`MatchConfig.victory.dominationPercent`), **уничтожение** соперников (0 провинций →
`defeated` + флот распускается), **счёт** (порог `scoreLimit`, **по умолчанию 600**
— GDD §3.2) и **тайм-аут** (`endsAt`, **по умолчанию** кап сессии по скорости:
×1→100 / ×2→60 / ×4→30 игровых дней; победитель = лучший счёт, ничья = `winner:null`).
Все пороги переопределяются через `MatchConfig.victory`. **Коалиции (SES-1, GDD §3.3):**
score-гонка идёт по «юнитам победы» — соло-игрок или alliance-компонента активных
(коалиция — только люди), порог коалиции = `scoreLimit × N × coalitionFactor` (деф. 0.7,
сублинейный) и **замещает** соло-порог участникам; коалиция побеждает вместе —
`match.winners[]` + топ-скорер в `winner`, `winners` едет в `match.ended`; прототип
начисляет XP каждому победителю.
**Награды по итогам (SES-2, первый срез):** `endMatch` пишет детерминированную
таблицу `state.match.rewards` (`Record<PlayerId, {place, xp}>`) и кладёт её в payload
`match.ended`: place — standard competition ranking (1224) по финальным очкам,
XP = участие + капнутая доля счёта + win-бонус каждому члену победившей клики;
участие платится и побеждённым. Масштаб — данными: `data/rewards.json` →
`GameData.rewards` (`RewardsDefSchema`, дефолты = прото-`matchXp`: 40 / ÷10 /
cap 100 / победа 160 — бандл без блока получает их через zod-default). Ядро только
СЧИТАЕТ таблицу; **зачисление на аккаунт сделано (EC-*):** на observe-`end` прото-хост
маппит место→аккаунт (`AccountStore.seatedNicks` → `UserStore` по нику-логину) и банкует
XP в durable `CommanderStore.creditMatch` — **идемпотентно по matchId** (маркер
`commander_credits` переживает рестарт, повторно наблюдённый конец не платит дважды);
только при включённых аккаунтах. `GET /commander/me` отдаёт накопленный XP сессии, клиент
зеркалит его в локальную мету (`syncCommanderFromServer` на входе в хаб; берётся max, XP
монотонен — сетевой тотал не роняет оптимистичное начисление устройства). Прото-хост
также логирует таблицу в JSONL: observe-`end` несёт `rewards`.
**Экран конца матча** (прототип): при `match.status==='ended'` вместо тонкого баннера
открывается полноэкранный оверлей `#endscreen` (`endScreen`/`renderEndScreen`) —
исход (ПОБЕДА/ПОРАЖЕНИЕ/НИЧЬЯ, цвет по исходу) + причина, итоговый счёт и **место** (N-е
из M), провинции/флоты/юниты, длительность, начисленный XP + лэвел-ап. Числа читаются
из авторитетного `match.scores`, поэтому экран одинаков в соло и в сети. Кнопки честны
по режиму: соло — «⟳ Играть ещё» (новый сетап) · «⌂ В меню» · «Смотреть доску»
(скрыть оверлей, глядеть на замороженную доску); NET — «⟳ Новый матч» (браузер
матчей — рематч того же стола требует серверной части, отдельный кирпич) · «В меню» ·
«Смотреть доску». Мир замораживается (соло-симуляция стоит, пока оверлей активен),
`xpAwarded` метит конец обработанным (не открывается повторно над хабом), сброс — на
свежем матче / реджойне. Дев-хук `__vdFx.endMatch('win'|'lose'|'draw')` под `?dev`.
**Профиль командира (main-menu.md §4.2, первый срез):** `MetaState` расширен карьерными
счётчиками `stats: MetaStats` (matches/wins/placeSum+placed/streak/bestStreak/score —
суммы, не средние; парсер чинит невозможные пары: wins ≤ matches, средн. место ≥ 1;
блоб без `stats` читается как свежая карьера с сохранённым XP). Копятся в `checkEnd`
за тем же once-per-match маркером, что и XP; **место берётся из авторитетного
`match.rewards[ME].place`** (ядро, ранжирование 1224), матч без него (дев-хук)
считается, но среднее не искажает. Экран `#profile` — полноэкранный оверлей с двумя
дверями: шапка хаба (`.hub-who`) и кнопка «Досье командира» во внутриматчевой карточке
(`.pc-dossier` — матчевое досье и карьерное не смешаны, переход в один тап). Показывает:
аватар-букву, ник, «Корпорация · Лига» (лига — косметическая полоса от уровня,
`leagueKey`, силы не даёт), капсулу Суверенов ЗОЛОТОМ (#ffd45e — канон `dl-donate`),
6 stat-плиток (матчи/winrate/ср. место/влияние корпы/очки сезона/серия; недоступное —
«—», не ноль) и витрину медалей (cache-first по образцу арсенала: localStorage
`vd.medals.<ник>` + фоновый `GET /medals` + `/medals/me`; прото-хост `/medals/*` не
монтирует — витрина честно пустая с подсказкой). Ключи `profile.*`/`card.dossier` в
обеих локалях; +15 тестов меты (recordMatch/winRate/averagePlace/leagueKey/ремонт
счётчиков). `nfmt` переведён в hoisted function (тот же TDZ-класс, что `httpBase`).

**Счёт — data-driven, только территория** (GDD §8.1). База очков узла задаётся его
**видом** (`sectorKinds[kind].scoreValue`): **планета — 50** (приз), любой другой вид —
**10** (дефолт схемы; «мёртвый мир» — тоже 10). Поверх базы — Σ `building.scoreValue ×
level` (вложение в апгрейды растит счёт, разрушение — снижает; здания дают очки по тиру).
Тип планеты (`planetType`) и террейн (`sector`) теперь кормят экономику/защиту, но **в
счёт не идут** — так баланс карты считается «30 планет × 50 + остальное × 10». **Армия
очков НЕ даёт** (только headcount в `units`). Поверх базы — **хук `victory.score`** на
провинцию (args `{planetId, owner}`): модули (тех/фракции/улучшения) добавляют очки
данными. «Жив ли игрок» для elimination считается по владению провинцией (0 провинций →
выбыл), **независимо** от `total`.

### hero (`hero`) — герой-сущность игрока + способности

**Инстанс-ключёванная** сущность: `GameState.heroes: Record<HeroId, Hero>` (ключ —
инстанс-id `Hero.id`, **не** `playerId`; фильтр по `owner` — до нескольких героев на
игрока). Запись: `{id, owner, name?, location, cooldowns, alive?, grade?, abilities?,
home?, fleetId?}` — `grade` (редкость, число слотов в клиентском ростере), `abilities`
(надетые «модули», по слоту на градацию), `home` (якорь респауна = столица), `fleetId`
(корабль, которым герой командует, пока жив). **Позиция героя = нода его корабля**
(HERO-2, `heroNode`): развёрнутый герой действует от `fleets[fleetId].location`; в полёте
(`location: null`) и без корабля — фолбэк `Hero.location`, которая теперь **память
последней подтверждённой ноды** (синкается на `fleet.transit`/`fleet.arrived`) и якорь
респауна после `home`. `hero.move` развёрнутому герою → `E_HERO_DEPLOYED` (кораблём
ходит обычный `fleet.move`); телепорт-редеплой остаётся только бескорабельному герою.
Смерть — **два идемпотентных сигнала** (общий `killHero`, гард по `alive`): `unit.died`
(пал стек-герой) и `fleet.destroyed` (флот снесён целиком, стек не дренировался).
Состояние JSON-сериализуемо, длительности через `schedule`, бонус — через хук;
ядро не меняется. (До миграции — один герой на игрока с ключом `playerId`.)

- Действие **`hero.move {to}`** — передислокация героя в **свой** мир. Коды:
  `E_BAD_PAYLOAD, E_NO_HERO, E_NO_PLANET, E_FORBIDDEN`.
- Действие **`hero.path.create {to}`** — открыть **временную публичную трассу** от узла
  героя к ближайшему (≤ `PATH_RANGE` = 600): **реальное ребро графа** (добавляется в
  `Planet.links` в обе стороны, маршрутизируемо всеми) на `PATH_DURATION_HOURS` = 6 ч, по
  которому **флоты владельца** идут с бонусом скорости `PATH_SPEED_BONUS` = +50%. Лейн
  лежит в `GameState.tempLanes[]`, истечение — отложенный `hero.path.expire`; кэш
  маршрутов инвалидируется через **`GameState.topology`** (версия топологии, бампится при
  любой смене `links`). Кулдаун `PATH_COOLDOWN_HOURS` = 12 ч. Коды: `E_BAD_PAYLOAD,
E_NO_HERO, E_SAME_LOCATION, E_NO_PLANET, E_OUT_OF_RANGE, E_COOLDOWN`.
- Событие **`hero.path.expire`** снимает лейн и **убирает ребро только если его добавил
  именно этот лейн** (`addedLink`) и его не держит другой живой лейн; бампит `topology`.
- Действие **`planet.annihilate {planetId}`** — уничтожение мира в радиусе
  (`ANNIHILATE_RANGE` = 500): узел **остаётся** (сквозь него можно лететь), `kind`/
  `planetType` → **`dead_world`**, гарнизон+здания снесены, владелец сброшен (нейтрал).
  Мёртвый мир — **захватываемый и застраиваемый**, но стоит лишь **10** очков (вместо 50)
  и **богат металлом (+30%)**; единственная доступная постройка — **`metal_station`**
  (салвага). Повторно «убить» dead_world нельзя (гард по `kind`). Кулдаун
  `ANNIHILATE_COOLDOWN_HOURS` = 48 ч. Коды: `E_BAD_PAYLOAD, E_NO_HERO, E_NO_PLANET,
E_NOT_DESTRUCTIBLE, E_OUT_OF_RANGE, E_COOLDOWN`.
- Хук `fleet.speed`: ×(1+`speedBonus`) для леги, идущей вдоль активного лейна владельца
  флота. Без модуля способностей/лейнов нет (мягкая деградация).
- Действие **`hero.spawn {heroId, at}`** (HERO-3) — ручной подъём корабля героя на
  **своём** мире. Гейты: `E_HERO_ALIVE` (уже командует живым кораблём; stale-`fleetId`
  не блокирует) · `E_RESPAWN_COOLDOWN` · `E_NO_PLANET`/`E_BAD_SPAWN` (только свой мир) ·
  `E_HERO_CAP` (кэп **3 активных**/игрок, `activeHeroCount`). Корпус — из архетипа:
  `Hero.archetype` → `data.heroes[..].ship.unit`, фолбэк — юнит `hero`. Общий
  деплой-путь `formHeroShip` с авто-респауном; **авто-респаун уважает тот же кэп**
  (переполнен — герой остаётся мёртв). Ручной спавн — путь спасения: бездомно-мёртвый
  или удержанный кэпом герой поднимается вручную, когда мир/слот появился. Событие
  `hero.spawned` (авто-путь по-прежнему `hero.respawned`). **HERO-8:** ноская способность
  маркер-типа `spawn_fleet`/`spawn_allied` (не кастуемая — «носится» в `Hero.abilities`)
  расширяет цели спавна: **свой флот** (герой абордажится в стек хоста — `addUnits`, аура
  кроет весь флот, `fleetId`→хост, событие с `aboard: true`; чужой флот — `E_BAD_SPAWN`)
  и **союзный мир** (D1-дипломатия, только `alliance`; нейтрал/война — `E_BAD_SPAWN`).
  Шипованы «Абордажная транслокация» (ravager) и «Дипломатическая высадка» (commander).
- Действие **`hero.fit {heroId, fitting}`** (HERO-6) — установка фитинга из
  `data/heroFittings.json` (`HeroFittingDef {statMods, grants{ability?|passive?}, cost}`,
  анти-self-expansion рефайн) в слот архетипа (`slots`; `Hero.fittings`, **без refit** —
  owner-правило ship-модулей). Гейты: владение/живость → `E_NO_FITTING` →
  `E_ALREADY_FITTED` → `E_NO_SLOTS` (безархетипный герой слотов не имеет) → казна.
  **Инсталл-гейт — общий генерик-механизм «слоты+предметы»** (`util/fitting.ts`, SHIP-4):
  `canInstall`/`validateInstalled(spec)` — каталог → дубль → `allowed` → бюджет
  по категории, generic-причины, которые каждый потребитель мапит в СВОИ стабильные
  `E_*`-коды; ship-лоадаут (`canEquip`/`validateLoadout`) и `hero.fit` — обёртки над ним
  (герои = одно-категорийный бюджет без предиката), поведение и коды не изменились.
  `grants` — живые (общий `applyGrants` с дедупом, HERO-4/5); `statMods` — данные без
  шва эффективных статов героя (свой будущий кирпич; «designed, not live» — SHIP-4
  унифицировал только слот-гейт, не статы). Событие `hero.fitted`. Шипованы
  «Пси-усилитель» (scan), «Матрица „Эгида"» (rally_beacon), «Абляционная обшивка»
  (hp+40, не live).
- **Пред-матч ростер (HERO-9, buildFromMap):** `SlotAssignment.heroes?: string[]` — до
  **3 разных** архетипов (решение по прецедентам C3/совета учёных: снапшот при сборке;
  `E_UNKNOWN_HERO`/`E_DUPLICATE_HERO`/`E_TOO_MANY_HEROES`; ростер без владеемого мира —
  `E_HERO_NO_HOMEWORLD`). Сеются **неразвёрнутыми** (`hero:{player}:{n}`, `home` =
  первый владеемый мир слота, лоадаут из `startAbilities`/`startPassives`); корабли
  поднимает `hero.spawn`.
- Действие **`hero.skill.unlock {heroId, node}`** (HERO-7) — прокачка дерева навыков из
  `data/heroSkillTrees.json` (`HeroSkillNode {branch?, requires[], cost, grants
{ability?|passive?}}`, ветки `transhuman|psionic`). Гейты: владение/живость →
  `E_NO_NODE` → `E_ALREADY_UNLOCKED` → ветка узла против ветки архетипа героя
  (`E_WRONG_BRANCH`; безветочный узел — общий) → `E_REQUIRES` (родители в `Hero.skills`)
  → казна (`E_INSUFFICIENT`, `payCost` на драфте). Грант дописывается в лоадаут инстанса
  (`abilities`/`passives`, с дедупом) — HERO-4/5 применяют его штатно; `Hero.skills`
  ведёт разблокированные узлы. Событие `hero.skill.unlocked`. Шипованы 2 ветки × 2 узла
  (рут-пассивка + дитя-способность за ресурсы).
- **Пассивки (HERO-5, `data/heroPassives.json`):** `HeroPassiveDef {hook, scope,
params{bonus, radius}}`, хуки — enum `fleet.speed|combat.damage` (fail-closed, новый
  хук = запись в enum + кейс-интерпретатор), scope — `heroFleet` (флот героя) |
  `ownFleetsNear` (свои флоты в `radius` от ноды героя, `heroNode`). Живой герой
  множит значение хука на ×(1+Σ применимых бонусов) ПОВЕРХ лейн-бонуса и базовой
  +5% ауры; мёртвый герой и неизвестный id пассивки — ноль. Несёт `Hero.passives?`
  (сеется из `startPassives` архетипа). Шипованы: `vanguard_impulse` (+10% скорость
  флота героя), `rally_beacon` (+8% урона своих флотов в 300 от героя).
- Действие **`hero.ability {heroId, abilityId, target?}`** (HERO-4) — **обобщённый
  data-driven диспетчер**: способность берётся из каталога `data.heroAbilities`
  (`HeroAbilityDef {type, cooldownHours, range, cost, params}`), гейты выводятся из
  данных генерически — владение (`E_FORBIDDEN`), живость (`E_HERO_DEAD`), каталог
  (`E_NO_ABILITY`), экипировка `Hero.abilities` (`E_NOT_EQUIPPED`), кулдаун
  (`E_COOLDOWN`), дальность от узла героя (`E_NO_PLANET`/`E_OUT_OF_RANGE`;
  ranged ⇒ обязателен `target`, иначе `E_BAD_PAYLOAD`; для встроенных типов пропущенный
  `range` **фолбэчится на движковую константу** (600/500) — никогда не «безлимит»),
  стоимость `cost` из казны (nonnegative в схеме — каталог не может минтить)
  (`E_NO_PLAYER`/`E_INSUFFICIENT`, `payCost` на драфте — реджект отменяет всё).
  Диспетчеризация по `type`: встроенные **`temp_lane`** / **`annihilate`** исполняются
  **теми же телами эффектов** (`castTempLane`/`castAnnihilate`), что и legacy-действия
  `hero.path.create`/`planet.annihilate` (поведение последних сохранено 1:1); прочие
  типы — через **capability `hero.effect.<type>`** (контракт `HeroEffect`, экспортирован
  из пакета; impl обязан `h.reject` на своих отказах); тип без capability →
  `E_NO_EFFECT` (fail-secure: данные обещают только то, что движок умеет).
  **Провайдеры шва — `heroEffectsModule`** (`modules/heroEffects.ts`):
  `hero.effect.recall` мгновенно телепортирует корабль героя в столицу (`Hero.home`),
  гейты `E_HERO_NOT_DEPLOYED`/`E_FLEET_BUSY` (не выдёргивать из боя)/`E_NO_CAPITAL`/
  `E_SAME_LOCATION`; событие `hero.recalled`. `hero.effect.aura` (rally/bulwark) —
  **таймбоксед** боевая аура: каст кладёт `{bonus, radius, until}` в `Hero.activeAuras`
  (прунинг истёкших на касте), а собственный хук `combat.damage` модуля бафает флоты
  владельца в `radius` от ноды героя, пока `until > now` — временный близнец пассивки
  HERO-5 `rally_beacon`; кривая аура → `E_BAD_EFFECT`; событие `hero.aura`.
  `hero.effect.reveal` (scan) — **таймбоксед fog-шов**: ranged-каст (диспетчер уже
  проверил цель в радиусе) кладёт `{center, radius, until}` в `Hero.activeReveals`
  (прунинг на касте), а проекция тумана `coverageFor` (`state/visibility.ts`) читает
  активные раскрытия **только своих** героев (per-viewer) и поднимает полный identify
  на миры в `radius` от `center`, пока `until > state.time` — раскрытие не течёт
  сопернику; кривой reveal (0-радиус/0-длит.) → `E_BAD_EFFECT`; событие `hero.revealed`.
  Окна `until` обоих эффектов считаются через `hoursToMs(ctx, durationHours)` — сжатие
  timeScale, как у всех остальных геройских длительностей (фикс 2026-07-30: было голое
  `MS_PER_HOUR` — на сжатом матче аура переживала бы собственный кулдаун).
  Эффекты приходят добавлением провайдера, ядро/диспетчер не трогаются — трилогия
  recall/aura/reveal закрывает все не-встроенные эффекты (спавн-маркеры не кастуются).
  **Кулдаун-ключи**: встроенные типы делят ключ с legacy (`path`/`annihilate`) — generic
  и legacy маршруты нельзя скомбинировать в double-fire; кастомные типы — ключ `fx:<type>`
  (два каталожных id одного эффекта делят кулдаун; префикс не коллидирует с `respawn`).
  Гейт живости распространён и на legacy-действия (`hero.move`/`hero.path.create`/
  `planet.annihilate` мёртвым героем → `E_HERO_DEAD` — обход через legacy закрыт). `params`-оверрайды `durationHours`/`speedBonus` (числовые, с движковыми
  фолбэками). Успех → кулдаун + событие `hero.ability.used {heroId, owner, abilityId,
type, target?}`. Payload-схема `hero.ability` добавлена в гейт (SV-1.2). 7 тестов; дифф прошёл 4-линзовый состязательный ревью (все находки закрыты).

**Проекция-герой (развёрнутый герой игрока).** Особый **юнит-корабль** `hero` (трейт
`hero`, высокий HP) в стеке флота. Хук **`combat.damage`**: флот, несущий героя,
бьёт и держит на **+5%** (`HERO_COMBAT_BONUS`) — баф применяется к стороне,
наносящей урон, поэтому покрывает и атаку, и ответный огонь. На гибель героя
(`unit.died` с `unit:'hero'`; событие несёт `fleetId` павшего стека и `owner`, т.к.
опустевший флот удаляется до дренажа) heroModule находит героя **по его `fleetId`**
(чтобы при нескольких героях одного владельца смерть приписалась нужному; фолбэк — по
`owner`), зануляет `fleetId` и через `HERO_RESPAWN_HOURS` = 24 ч **возрождает** героя
свежим одно-корабельным флотом в **столице** (`Hero.home`, если ещё своя), иначе на
последнем узле, иначе на любом своём мире — и **перепривязывает** `fleetId` к новому
кораблю; без территории остаётся мёртв (`Hero.alive`). Развёрнут — **главный** (градация
`main`) герой ростера; имя (`Hero.name`) — ник игрока. В прототипе сидируется в стартовый
флот со своим лоадаутом, `home` = столица (на старте — родной мир); `capital.designate`
перенацеливает `home` героев владельца на новую столицу — есть и в ядре
(`modules/capital.ts`, `capitalModule`, порт прототипного `capital.ts`/REFP-14), и в
прототипе. Развёртывание **остальных** героев ростера отдельными кораблями — следующий
кирпич.

Герой **приватен**: `visibleState` отдаёт игроку только его собственного (позиция +
кулдауны), чужих вырезает; `tempLanes` остаются — это публичная топология (реальные
`links`). `dead_world` есть в `data/sectorKinds.json` (захватываемый/застраиваемый,
очки 10, ростер `[metal_station]`) и `data/planetTypes.json`
(`productionByResource.metal` = 0.3). Сидируется в dev-сценарии (`scenario.ts`):
по герою на игрока в его `home_*`.

### видимость / туман войны (`state/visibility.ts`) — граница безопасности

`visibleState(state, viewerId, data)` — **чистая проекция** (не модуль, не редьюсер):
сервер прогоняет её перед отправкой клиенту, **физически** убирая невидимое (а не
«шлём всё, прячем на клиенте»). Не влияет на симуляцию — read-only вид, детерминизм
не трогает. Текущая видимость: **identify** (полное опознание, дальность 1 прыжок по
графу от своих миров/флотов) + **radar** — по **физическому расстоянию** (евклидово, от
`BuildingDef.radarRange`/`UnitDef.radarRange` в координатных единицах), **не по прыжкам**:
узел близкий в космосе, но далёкий/недостижимый по лейнам, всё равно ловится радаром.
Враг в радаре, но не опознан → **сигнатура** `{location, size:S/M/L}`
(грубое «что-то есть», ведро по `Σ count × UnitDef.signature`), а не сам флот. Прячет:
чужую казну/технологии, контент невидимых миров (топология остаётся), невидимые
флоты/бои, **всё расписание** (утечка планов) и **чужие дип-офферы** (`diplomacyOffers`
остаются только у пар с участием зрителя; сами стойки публичны), а также **`rng`** —
поток костей мира: клиент, держащий состояние sfc32, предсказывал бы будущие броски
раньше сервера. Вырезан как `fog` и без последствий: кернел на клиенте не гоняется
(net-режим только рисует снапшоты), в `hashState` поле не входит, `applyDelta` снимает
его у уже подключённых через `removedMeta`. Покрыто тестами, включая anti-leak по JSON.

**Сторож тумана (`state/fogInventory.test.ts`, 12 тестов).** Проекция — ЧЁРНЫЙ список,
поэтому новое поле `GameState` публично **по умолчанию**: так утекли `player.scientists`,
`state.capital`, `divisions`/`divisionTemplates` (закрыты в PR #434) и `rng`. Опись
типизирована как `Record<keyof GameState, …>` / `Record<keyof Player, …>` — новое поле
роняет ТИПИЗАЦИЮ, пока автор не выберет `public` / `stripped` / `filtered`. Дальше тесты
бьют по решению: `stripped` в проекции нет, `public` доехало бит в бит, `filtered`
ОТЛИЧАЕТСЯ от исходного (поле, помеченное «фильтруется», но забытое в `project()`, красит
гейт). Сверх карты — ловушка на канарейку: всё соперниково засеяно строками `CANARY_*`,
и готовая проекция сканируется на них целиком, так что утечка ловится и там, где
структурная опись её пропустила бы.
**`visibleView`** — та же проекция + её identify-набор за **один** проход
покрытия: рассылка (`MatchRoom.broadcastState`) берёт оба из него, не считая
`coverageFor` дважды на игрока (~−40% на проекцию броадкаста по бенчу).
**Радарные бонусы (A2):** reach каждого радара игрока
(зданий и кораблей) множится на (1 + Σ `radarRangeBonus` завершённых технологий +
`radarRangeBonus` пассива фракции) — данными, не kernel-хуком: проекция чистая и
живёт вне кернела. **Разведка флотом (A3):** транзитный флот опознаёт ближайший узел
по ходу (`fleetNode` интерполирует позицию), так что память фиксирует и пройденные
узлы маршрута. **Хелпер `isVisibleTo(state, viewer, {planetId|fleetId}, data)` (A4)** —
ad-hoc запрос «видим ли объект на identify-уровне» по тому же правилу, что режет
проекция: своё — всегда, radar-blip/память/неизвестный id — false (fail-secure).

**Память (вариант B, `visibilityModule` + `modules/visibility.ts`).** Модуль на
`time.advanced`/`planet.captured`/`fleet.arrived` пишет per-player снимки опознанных
миров в **`GameState.fog`** (JSON, детерминировано). `visibleState` для мира вне обзора,
но виденного ранее, отдаёт **серое «last known»** из снимка и кладёт id в `remembered[]`
(а `fog` из проекции вырезается — внутреннее). Без модуля — память пустая, мир читается
как unknown (мягкая деградация).

**Туман на рассылке (F6, `packages/server/MatchRoom`).** Сервер шлёт **per-player
дельты** от `visibleState` (своя базовая линия на игрока) + сигнатуры/`remembered`
отдельными полями; **события тоже фильтруются** по видимости (`eventVisibleTo`). e2e:
на dev-карте green не видит флот red и `red_1` **не появляется по проводу** ни в стейте,
ни в событиях. **Контракт роутинга закреплён тестом (AUD-2):** `eventVisibleTo` адресует
события по ИМЕНАМ ключей payload — соглашению без схемы, — поэтому
`packages/server/src/eventFogContract.test.ts` статически разбирает все 82 нетестовых
`emit()` в `shared-core/src/modules/**` и требует хотя бы один маршрутизируемый ключ:
`time.advanced`/`match.*` освобождены, `hero.*` требует именно `owner` (короткое
замыкание срабатывает до списка адресатов), ключи из условного спреда не в счёт.
Тест нашёл два живых адресных дефекта, оба закрыты: `hero.path.expired` эмитился без
`owner` и не доходил НИ ДО КОГО, включая владельца героя (AUD-2); у `effect.applied`
адресат приезжал условным спредом — гарантии не было, а `schedule`-правило (глобальное
тёмное событие) не несёт и планеты, по которой его можно было бы доставить (AUD-11:
`playerId` теперь обязателен в `EffectOccurrence` и пишется в payload безусловно).
**Список исключений пуст** — контракт держится без поблажек.
Сам сканер тоже под сторожами (AUD-15): разбор идёт по символам, поэтому комментарий
внутри `emit()` читался как текст ключа и съедал ключ, который шёл следом, — а `}` или
целый закомментированный `emit(` в комментарии рвал границы литерала и подсовывал мёртвый
код. Лечится одним `stripComments()` перед любым разбором (строковые литералы уважает, так
что `//` в URL остаётся значением); 7 тестов на сам сканер, каждый проверен мутацией.
Дефект был живой, а не гипотетический: у `artillery.fired` ключ `near` стоит за
трёхстрочным комментарием и в инвентарь не попадал — вердикт не менялся только потому, что
событие адресовалось соседними ключами.
**Дальше:** AOI-оптимизация, JWT в рукопожатии (F7).

**Реестр матчей / мета-шелл (`packages/server/MatchRegistry`, первый кирпич MM-0.1).**
Мульти-матч реестр поверх `MatchRoom` + **мета-запись рядом с матчем** (`MatchMeta`:
`mapId, rules:MatchConfig, createdAt, startedAt, archivedBy`) — **вне `GameState`**
(инвариант `main-menu.md` §2: мета-состояние не живёт в ядре). Read-model браузера
матчей `MatchRegistry.list(nick)` отдаёт три вкладки для зрителя: **available**
(присоединяемые — есть слот, не `ended`, ты не в них), **active** (ты держишь слот),
**archived** (ты перенёс в свой архив — **per-player** флаг, не глобальный). Строка
статуса: `days` (игровые дни от старта = `(state.time-startedAt)/MS_PER_DAY`), `players`
(занято/всего — занятость через `AccountStore.occupiedSeats`), `mapId`, `rules`, `status`.
Интент **archive/unarchive** — fail-secure (`E_NO_MATCH`/`E_FORBIDDEN`, авторизация по
посадке nick). По проводу: `wsServer` маршрутит `/matches/<id>` по реестру (404 на
неизвестный id), `GET /matches?nick=` (read-model) + `POST /matches/<id>/archive?nick=`
(интент). Идентичность — лёгкая, по nick (`AccountStore.seatOf`), **без аккаунтов**
(полное меню ждёт `AC-0.1`). `main.ts` сидит 2-3 dev-матча. **Дальше:** клиентский
экран меню (Этап 4), персистентность меты + `MatchStore.list` (Postgres уже под это
индексирован), лобби/создание матча (MM-1.1).

## 6. Данные (`data/*.json`, версия `0.1.4`)

> **RULES-2 — правила про КОНТЕНТ живут здесь, а не в коде.** Поля-правила у зданий:
> `maxPerPlanet` (лимит экземпляров на мире, дефолт 1) и `creditsBonus` (доля прибавки ко
> всему кредитному доходу мира). Оба заменили зашитые в модулях условия и константу с
> именем конкретного здания. Сторож — не «поле существует», а «поведение следует числу»:
> тесты меняют объявленное значение и требуют, чтобы игра его исполнила, иначе данные
> превратятся в украшение. Константы АЛГОРИТМА и глобальный тюнинг механик остаются в
> коде до отдельного кирпича.

- **resources:** `credits` (деньги), `metal`, `food`, `energy`, `microelectronics` —
  внутриматчевый набор из 5. Торгуются на сессионной бирже (модуль `market`).
- **units** (схема `UnitDef`): `domain('space'|'ground')`, `stats{attack, defense,
speed, hp, shield, range, cargoCapacity, cargoSize, aaDamage}` (+ любые доп. числа),
  `line, traits, abilities, cost, buildTimeHours, upkeep`, `signature, radarRange`
  (армия очков не даёт — см. victory). Есть: `scout_drone, sensor_frigate,
cruiser, siege_lance(artillery,range), dropship(cargoCapacity 12), militia,
drop_infantry, tank(cargoSize 3), hero, fighter_squadron, strike_carrier` (11 юнитов,
все vanguard; `orbital_aa` — защитное здание, не юнит; `infected_cruiser` в контенте нет).
  `sensor_frigate` — носитель дальнего радара: один `utility`-слот, своя антенна 60, и
  это ЕДИНСТВЕННЫЙ корпус, куда встаёт `radar_module` (`allowed.units` в `modules.json`,
  исполняет общий гейт `canEquip` → `E_NOT_ALLOWED`).
  Щиты (аблятивные) у боевых кораблей: cruiser 15, dropship 12, hero 40.
- **buildings** (`BuildingDef`): `cost, buildTimeHours, produces, hp,
defenseBonus, upgrades[{…}], traits, scoreValue, radarRange, healRate, shipRepair`. Есть: `mine_t1, mine_t2,
shipyard, biomass_pit, barracks, spaceport, radar, fort, orbital_aa, hospital, metal_station, power_plant, fabricator`
  (форт — 3 уровня: HP 35→50→65, defenseBonus 0.35→0.50→0.65; **радар — 3 уровня**: `radarRange`
  180→300→420 (расстояние), HP 18→26→34). `radarRange` теперь **уровневый** (`BuildingLevelSchema`),
  `visibleState` читает его через `buildingLevel(def, level)`. `scoreValue`: fort 20·уровень,
  shipyard 12, fabricator 14, mine/biomass/power_plant 8, barracks/spaceport/radar 6.
  **ECON-3 — производители недостающих ресурсов:** `power_plant` (Fusion Reactor, 3 уровня:
  `energy` 25→60→110) и `fabricator` (Microelectronics Fab, 3 уровня: `microelectronics`
  8→18→32; стоит metal+credits+`energy` — премиум-ресурс «варится» из энергии, гейтится
  технологией `microelectronics_fabrication`). Так у каждого экономического ресурса
  (кроме `credits` — валюта/сток) есть хотя бы одно здание-производитель; экономика
  начисляет любой `produces`-ресурс агностично (движок не трогался). Ростеры
  `sectorKinds`: реактор — планета/астероид/туманность/`void_station`, фабрикатор —
  планета/`void_station`; `orbital_aa` и `hospital` добавлены в ростер `planet`
  (0.1.3 — до этого оба были непостроимы нигде: не входили НИ в один
  `allowedBuildings`, мёртвый контент при активном `E_WRONG_SECTOR`).
  Referential-integrity тест следит, что любой `produces`/`cost`/
  `upkeep`-ресурс контента есть в `resources`.
- **sectors:** `empty_space(+скорость), asteroid_field(−скорость/+живучесть/score 5),
nebula(score 3)`. **planetTypes** дают `scoreValue` (terran 40, oceanic 35,
  volcanic 20, gas_giant 10, barren 5).
- **factions:** `vanguard, swarm` (пока флейвор/трейты).
- **events:** `infect_planet, void_anomaly` (правила
  trigger→effect; движок трейтов пока не построен).
- **technologies:** сессионное дерево (`industrial_automation`,
  `orbital_logistics`, `siege_doctrine`, `fortified_infrastructure`,
  `microelectronics_fabrication`): стоимость,
  длительность, prerequisite-цепочки, unlocks юнитов/зданий и бонусы к
  production/speed/damage.
- **Герои — 5 data-каталогов (HERO-1..9 ✅):** `heroes.json` (архетипы `commander/ravager/
vanguard/warden`; `branch` — своя ось `transhuman|psionic`, `ship.unit`, `slots`,
  `startAbilities`/`startPassives`), `heroAbilities.json` (`{type, cooldownHours, range,
cost, params}` — включая маркер-типы `spawn_fleet`/`spawn_allied`), `heroPassives.json`
  (`{hook, scope, params}`), `heroSkillTrees.json` (`{branch?, requires[], cost,
grants}`), `heroFittings.json` (`{statMods, grants, cost}`). Движок ПОЛНОСТЬЮ живой:
  `hero.ability`/`hero.spawn`/`hero.skill.unlock`/`hero.fit` + пассивки на хуках +
  пред-матч ростер (`SlotAssignment.heroes`) — см. §5 hero-модуль. Referential-integrity
  тесты связывают все каталоги; загрузчик собирает 5 фрагментов.
- **Ещё два фрагмента бандла:** `modules.json` (6 корабельных модулей: `cargo_bay`,
  `radar_module`, `ion_engine`, `targeting_array`, `ablative_plating`, `shield_booster` —
  `ModuleDefSchema`; ядро читает их живьём в `util/loadout.ts`, инлайн-каталог прототипа
  §7 их ЗЕРКАЛИТ). `radar_module` — единственный с именным списком корпусов
  (`allowed.units: ['sensor_frigate']`): дальнее зрение это роль одного корабля, а не
  опция для любого крейсера; правило исполняет общий гейт `canEquip` (`E_NOT_ALLOWED`),
  в коде нет ни одной проверки по id. Радиус радара флота = антенна корпуса ПЛЮС
  прибавки модулей (`stackRadarRange`/`fleetRadarRange` в `state/visibility.ts`) — до
  этого читалось только поле корпуса, и установленный радар-модуль не считался нигде.
  Второй фрагмент — `rewards.json` (XP/место по итогам — `RewardsDefSchema`, см. раздел
  наград SES-2). Оба — обычные строки `composeGameDataBundle` (`data/loadGameData.ts`),
  то есть проходят `parseGameData` вместе с остальным контентом.
- **Каталоги ВНЕ ядрового бандла (только сервер):** `medals.json` (достижения — свой
  fail-secure парсер `medalCatalog.ts`, см. §8), `dropTables.json` (дроп-таблицы лута
  после матча: веса по месту, pity-счётчик, salvage) и `starterArsenal.json` (стартовый
  набор корпусов/модулей для нового аккаунта) — последние два читает и валидирует против
  уже собранного `GameData` сам сервер (`scenario.ts`: `loadDropTables`/
  `loadStarterArsenal`, `E_INVALID_DROP_TABLES`/`E_INVALID_STARTER_ARSENAL` на кривой
  форме). В `GameData` не входят.

## 7. Прототип (`prototype/`)

**Локализация (LOC-1…LOC-5 закрыты).** Текста для игрока в коде НЕТ — есть ключ:
`t('err.no-capacity')`, `tData('Metal Mine')`. Сам текст живёт в корневой
`/localization` (одна локаль = один файл, плоская карта `ключ → текст`); формат ключа
— `домен.сущность.аспект` (точки — иерархия, kebab-case внутри сегмента). Полное
правило — в корневом `CLAUDE.md` §«Локализация». Рантайм ОДИН на прототип и клиент —
`localization/runtime.ts` (LOC-5 снял вторую копию, `packages/client/src/i18n.ts`).
Порядок поиска в нём:
выбранная локаль → **русский как источник** (непереведённый ключ виден по-русски, а не
как голый ключ) → сам ключ (заметная опечатка). `tData()` строит ключ детерминированным
слагом `dataKey()`, поэтому таблицы «имя данных → ключ» нет. На ключи переведены:

- **словарные домены**, где ключ выводится из идентификатора кода — `err.*` (таблица
  `ERR_RU` УДАЛЕНА: ключ считается из кода отказа), `data.*`, `hero.*`, `ship.*`,
  `diplo.*`, `market.*`, `tech.branch.*`, `hud.resource.*` (LOC-1);
- **вся статичная разметка** `prototype/build.mjs` — `welcome.*` (вход, регистрация,
  восстановление, список матчей, подвал), `hub.*`, `rail.*`, `win.*`, `setup.*`,
  `seatpick.*`, `speed.*`, `upd.*` (первый домен LOC-2);
- **боковая панель матча** (секция `side panel` в `main.ts`) — `side.*`: конвейеры
  стройки, оперативная группа, карточка флота и сводка армии, авиагруппа, бой и отход,
  бомбардировка/штурм с прогнозом, погрузка десанта, мир вне сенсоров, досье мира,
  вкладки гарнизона (второй домен LOC-2);
- **досье объектов и кодекс** (секции `object dossiers` + `build/unit codex` в
  `main.ts`) — `dossier.*` (здания, корабли, стройка в очереди и её выхлоп, вкладки
  гарнизона, характеристики флота) и `codex.*` (строки характеристик карточки,
  теги, `codex.hub.*` справочника ONB-4, `codex.term.*` статей глоссария); статьи
  глоссария не держат копию текста в коде — `GlossaryArticle` в `codexIndex.ts` отдаёт
  `titleKey`/`bodyKey` (третий домен LOC-2);
- **онбординг** (ONB-1/2/3/5/7) — `onb.*`: туры-подсказки (`onb.tour.hud.*` /
  `onb.tour.first.*` + обвязка в `spotlightDom.ts`), карточки первого контакта
  (`onb.intro.*`), цели первой сессии (`onb.goal.*`), сводка возвращения
  (`onb.recap.*`). Четыре чистых модуля с копией (`intros.ts`, `firstGoals.ts`,
  `onboardingTour.ts`, `firstMatchTour.ts`) отдают ключи, а не текст (четвёртый
  домен LOC-2);
- **командная панель флота** (`renderCmdBar`) — `cmd.*`: приказы парами «подпись +
  подсказка», режим огня артиллерии, каст способности героя (пятый домен LOC-2);
- **экран настроек** — `settings.*`: интерфейс, цвета сторон с палитрой под
  цветослепоту, графика (шестой домен LOC-2);
- **кабинет корпорации и войны альянсов** (AVA-C1/C2, CORP-HUB) — `corp.*`: состав и
  заявки, готовность, полный жизненный цикл вызова AvA, лента и история, витрина
  наград и история боёв (седьмой домен LOC-2);
- **журнал событий матча** — `log.*` (бой, технологии, вахта Хранителя, шпионаж,
  захват, дипломатия, стройка, флот, биржа) и `war.confirm.*` (диалог объявления
  войны) (восьмой домен LOC-2);
- **штаб героев** — `hero.hq.*` / `hero.tree.*` / `hero.abil.*` / `hero.fit.*`:
  состав, дерево навыков, способности, фиттинги (девятый домен LOC-2);
- **аккаунты и браузер матчей** (SES-2.5) — `acc.*` (вход, регистрация, сессия,
  переподключение) и `browser.*` (карточка матча в ленте и её действия)
  (десятый домен LOC-2);
- **переписка и шпионаж** (вкладки окна дипломатии) — `chat.*`, `spy.*` и `diplo.*`
  (окно, вкладки, фильтр и сортировка ростера) (одиннадцатый домен LOC-2);
- **«Верфь»** — `yard.*`: корпус и типизированные слоты под модули, стоимость и
  заказ (двенадцатый домен LOC-2);
- **дерево технологий** (TT-3.1) — `tech.*`: требования узла, рельса дней, состояния
  и действия (тринадцатый домен LOC-2);
- **«Хранитель»** — `steward.*`: позы, журнал вахты, гейт неизученного протокола
  (четырнадцатый домен LOC-2);
- **коммуникации** — `chat.win.*` (плавающее окно чата), `comms.*` (меню связи) и
  `ping.*` (композер меток провинции) (пятнадцатый домен LOC-2);
- **биржа, конец матча и карточка игрока** — `market.*`, `end.*`, `card.*`
  (шестнадцатый домен LOC-2);
- **весь остальной интерфейс матча и хаба** — `threat.*`, `queue.*`, `div.*`,
  `cargo.*`, `ai.*`, `map.*`, `split.*`, `hint.*`, `meta.*`, `arsenal.*`, `auth.*`,
  `setup.*`, `scipick.*`, `hud.*`, `net.*`, `back.*`, `tgt.*`, `upd.*`, `sandbox.*`,
  `fmt.*` (финишный проход LOC-2);
- **таблицы-справочники и игровой каталог** — подписи, уходящие в `t()` переменной:
  `tech.group/fx.*`, `hero.branch/hook/arch.*`, `yard.tab/slot.*`, `res.of.*`,
  `stat.*`, `callsign.*`, `arsenal.*`, `form.*`, `corp.tab/role/audit.*`,
  `meta.branch/node.*`, `fleet.size.*`, `ground.officer.*`, `sandbox.res/tog.*`, а
  также весь каталог `prototypeData.ts` — `tech.node.*`, `sci.*`, `faction.*`,
  `hero.unit/ability/passive/tree/fit.*` (закрытие LOC-2).

Итого **1685 ключей**. Записи в локалях разложены по доменным секциям и отсортированы
по ключу внутри каждой. Таблицы-справочники прототипа и игровой каталог
(`prototypeData.ts`) держат В ЗНАЧЕНИИ ключ, а не русский текст — их подписи уходят в
`t()` переменной, и раньше именно там английский пропадал незаметно для гейта. Имена
игровых ДАННЫХ (модули, фитинги, здания, юниты) остаются английскими: `tData()` строит
из них слаг `dataKey()`, а он вырезает всё кроме `[a-z0-9]`, поэтому русское имя
схлопнулось бы в ключ `data.` и перевод стал бы недостижим.

**Шипнутый контент приведён к этому правилу (AUD-3).** В `data/*.json` жили **28**
кириллических `name` (весь геройский слой + `modules` + учёный `Куратор`) — ровно та
схлопнутая форма, о которой правило и предупреждает: ключ `data.` был недостижим на любой
локали, включая русскую. Имена переименованы в английские, русский текст уехал в **19**
новых пар `data.*` (9 из 28 ключей в локалях уже были — просто их нечем было достать).
Замер на том же `dataKey()`, что и рантайм: из 98 именованных сущностей бандла
**0 схлопнутых**; без ключа было 38, сейчас **18** (технологии закрыл отдельный проход,
фракции — AUD-14) — эти не схлопываются и чинятся дозаведением, разбивка и причины ниже.
Один id, `ablative_plating`, живёт в ДВУХ каталогах (`modules` и `heroFittings`), а
пространство `tData` плоское, поэтому фиттинг назван `Ablative Cladding` — тем же именем,
которое уже держал `prototypeData.ts`.

**Сторож на это есть (AUD-4).** До него `i18n.test.ts` смотрел ТОЛЬКО рукописный
`prototypeData.ts`, поэтому шипнутый бандл — тот, что читают `packages/client` и сервер —
не проверялся вовсе. Теперь его держат три теста поверх `composeGameDataBundle`: имя
никогда не схлопывается в голый `data.`; **в именах нет кириллицы** (не дубль первого:
`dataKey('Мина II')` даёт `data.ii` — ключ не голый, а перевод всё равно недостижим);
покрытие ключом `data.*` по ОБЕИМ локалям. Первые два жёсткие — allowlist на них не
действует. У третьего есть `DATA_KEY_GAPS`, и он **сокращающийся**: валит тест и на новой
непокрытой сущности, и на записи, для которой ключ уже появился. Записей **18** —
`buildings` 11, `scientists` 5, `planetTypes` 1, `sectorKinds` 1 (14 технологий по дороге
закрыл отдельный PR, 6 фракций — AUD-14: у них имя в бандле и в каталоге прототипа
совпадало, так что решать «какое каноническое» было нечего). Снять оставшиеся 11
(`buildings`) нельзя, пока не решено AUD-8: у прототипа для тех же сущностей другие
имена и частью другие id.

Статичный узел в разметке ПУСТ, ключ стоит в ЗНАЧЕНИИ атрибута
(`data-i18n="hub.play"`, аналогично `-title`/`-ph`/`-aria`), и `localizeStaticDom()`
проставляет текст на старте — русская формулировка физически не может разъехаться с
локалью. **Мост совместимости снят** (`/localization/legacy/` удалён вместе с веткой в
рантайме): русского текста в коде прототипа нет, `t()`/`tData()` принимают только
ключи, промах виден как сам ключ. Гейт — `prototype/src/i18n.test.ts` (14 тестов:
паритет ru/en, в исходнике локали нет дублей ключей, ключи из полей игрового каталога
заведены, ключ из кода заведён, ключ локали не осиротел, в EN нет кириллицы, у каждого
юнита есть имя, у каждого имени в каталоге ПРОТОТИПА есть ключ `data.*`, статичная
разметка на ключах и без старой формы, таблицы копии отдают ключи, главный инвариант
этапа 2 — в коде нет русского текста, — и три про ШИПНУТЫЙ бандл, см. выше: имя не
схлопывается в `data.`, в именах нет кириллицы, покрытие ключом по обеим локалям);
поведение самого рантайма отдельно держит
`localization/runtime.test.ts`. Тест сирот
ищет ключ В КАВЫЧКАХ: подстрочный поиск считал живым любой ключ, чей текст встречается
внутри другого литерала, и именно так мост держал десятки мёртвых записей. Не
локализованы намеренно: `testmode.ts` (дев-экран), поисковые алиасы `codexIndex.ts`
(двуязычны по назначению) и `CHAT_BADWORDS`.

`pnpm run prototype` → esbuild собирает всё (ядро + zod + UI) в **два** self-contained
HTML (открываются с диска, без сервера): `dist/void-dominion.html` — дев-клиент
(всё как раньше) и `dist/void-dominion-player.html` — **клиент обычного игрока**:
тест-режим, одиночный скирмиш и контролы ускорения времени вырезаны (esbuild-define
`__PLAYER_BUILD__` выкидывает ветки из бандла, `build.mjs` вырезает `<!--dev-only-->`
разметку); главный путь игрока — позывной → браузер запущенных сессий (`GET /matches`).
Экран матчей в player-клиенте — ТОЛЬКО вкладки Доступные/Активные/Архив + список:
поля сервера/позывного, «Обновить список» и подзаголовок скрыты (инпуты остаются в
DOM как носители состояния для `resolveServer`); список сам обновляется тихим
10-секундным поллом, а поле сервера всплывает только пока список недоступен
(APK без same-origin вводит адрес хоста один раз — и оно снова прячется).
Прото-хост отдаёт player-клиент на `/`, дев-клиент — на `/dev`. Обучение (ONB-2
guided sandbox) в player-клиенте живо — идёт на фикс-темпе без ручки скорости.
APK собирается в двух лейнах (matrix в `android.yml`): дев — rolling-релиз `alpha`
(`com.voiddominion.prototype`, как раньше), player — rolling-релиз `player`
(`void-dominion-player.apk`, свой `com.voiddominion.player` — ставится рядом с
дев-версией); каждый APK автообновляется из своего лейна.

- **Реальное ядро** в браузере: `createKernel([sector, planetType, tax, faction, hunger,
economy, movement, hero, heroEffects, orbital, combat, artillery, intercept, captureOnArrival,
construction, arsenalSync, technology, steward, army, victory, fleetLaunch, diplomacy, espionage,
botDiplomacy, market, capital, standingOrders, forcedMarch, instantRepair, econScrews,
effects])` (31 модуль), тик в реальном
  времени (скорость ⏸/▶/⏩). Концовка матча — из авторитетного `state.match` (`victoryModule`),
  полноэкранный экран итогов победы/поражения/ничьи (счёт+место+статы+XP, рематч; см.
  раздел victory) — а не хардкод по узлам.
- **Фракции (H3):** setup-экран несёт **пикер из 4 лор-домов** (`data.factions`:
  azure «Azure Compact» +12% экономика · crimson «Crimson Hegemony» +10% урон · amber
  «Amber Concord» +15% скорость флотов · violet «Violet Ascendancy» +5%/+5%) — пока
  фракция это **чисто пассивный бонус к экономике или юнитам**, применяемый ядровым
  `factionModule` через те же хуки, что и технологии. Человек выбирает дом, ИИ-места
  разбирают оставшиеся (имя места = имя дома; цвет остаётся за местом); карточка
  игрока показывает дом + пассив. Тесты `factions.test.ts` (4).
  **Имя дома ЛОКАЛИЗУЕТСЯ на месте показа (AUD-14).** В состоянии и в конфиге места лежит
  английское имя ДАННЫХ — состояние одно на всех игроков, а локаль у каждого своя, —
  поэтому перевод даёт `houseDisplayName()` (`setupSeats.ts`): номер круга отделяется ДО
  поиска ключа (слаг `data.azurecompact2` не нашёлся бы, и «Azure Compact 2» вышло бы на
  экран целиком английским), а ник живого игрока проходит насквозь промахом `tData()`.
  В матче это ОДНА воронка — карта `NAME` в `main.ts`, куда `syncPlayerNames` кладёт уже
  готовый к показу текст; отдельно проведены экран сетапа, витрина рынка и выбор дома при
  входе. Ключи `data.*` заведены на все 6 домов бандла. **Баг-фикс 2026-07-30:**
  каталог прототипа держал ключи `blue`/`red`, а места раздавали `azure`/`crimson` —
  `factionModule` читает `data.factions[id] ?? 0`, и оба дома молча играли БЕЗ пассивок;
  ключи переименованы в канонические, паритет «место ↔ каталог» закреплён тестом.
- **Командный бой (AVA-0, первый шаг к AvA без мета-слоя):** тумблер «⚔ Командный бой» в
  setup + A/B-чипы на местах (ты залочен в A, ИИ-места переключаются). При включении
  `SeatConfig.team` едет в `newGame`, который сеет дипломатию по стороне: **одна сторона
  ALLIED** (побеждают вместе через SES-1, без дружественного огня — `combat.isHostile`
  читает стойку), **между сторонами WAR** с первого часа; нет команд → классический FFA
  (все пары `peace`). Альянс — посеянное состояние, поэтому ИИ-союзник реальный (в обход
  `E_BOT_ALLIANCE`-гейта декларации; клика-победа читает стойку). Коалиционный чат/пинги/
  порог победы работают из коробки. `teams.test.ts` (5). **Сетевые места:**
  прото-хост (`netserver.ts`) по умолчанию сеет FFA на 10 живых кресел (`p1`–`p10`);
  `TEAMS=5v5` делит те же 10 мест на A: p1–p5 и B: p6–p10, а `TEAMS=2v2` сохраняет
  компактный режим на 4 места. **Два ИИ (SES-2.2, `seatAiDecision` — чистая
  тестируемая функция):** `steward` — свой автопилот игрока (играет по своей позе
  даже при живом коннекте, делегирование бьёт грейс), `substitute` — полный
  `expand`-бот на брошенном кресле после **3 РЕАЛЬНЫХ дней** отсутствия
  (`AI_GRACE_MS`, wall-clock, независимо от `TIME_SCALE`; мгновенно снимается при
  возврате), `none` — присутствующий игрок командует сам. Конфигурации, дипломатия
  и таблица истинности двух ИИ закреплены в `networkSeats.test.ts` (8).
  **Мульти-сессии:** `MATCHES=N` (деф. 1, кап 16) поднимает N независимых сессий в
  ОДНОМ процессе (`proto`, `proto-2`, …) — вся пер-матчевая машинерия (комната,
  wake-драйвер, ИИ пустых кресел, standing-приказы, debounced-снапшот, receipts,
  BF-17 grace) закрыта в фабрике `createHostedMatch`; все сессии в `MatchRegistry`
  → браузер матчей клиента показывает каждую строкой, вход по matchId; durable
  restore пер-id (рестарт резюмирует все), shutdown флашит каждую. **Автостарт
  (SES-2.1, модель Iron Order):** лобби нет — часы сессии идут с момента её
  создания (`MatchRoom.initiallyStarted` без `manualStart`: якорь на
  `initialState.time`, `TIME_SCALE` работает), вход всегда в живой мир; клиентский
  лобби-оверлей и кнопка «Старт» удалены. Проверено e2e (реальный Chromium +
  Postgres-resume; автостарт — живой raw-ws смоук).
  Полный AvA-жизненный цикл
  (вызов/ростер/фазы, `corporation-wars.md`) — server/meta, дальше.
  Миры размечены типами (terran/barren/oceanic/volcanic/gas_giant) — карточка планеты
  показывает тип и его бонусы (prod/def), `netIncome` учитывает множитель производства.
- **Герои — полная новая модель в прототипе:** 5 hero-каталогов инлайн в данных `game.ts`
  (зеркало `data/*.json`, те же id, что и в легаси-пуле меню), ростер меню (4 героя)
  сеется **core-инстансами** `hero:{seat}:{n}` (grade→архетип 1:1: main→commander,
  legendary→ravager, rare→vanguard, common→warden; главный — флагман домашнего флота,
  остальные — резерв как в `buildFromMap`; способности = выбор меню + маркер-перки
  архетипа). Ростер героев **свёрнут в таб «Верфи»** (панель «Герои» → `heroStaff.ts`;
  окно `#hero`/рельс `rail-hero` ретайрнуты в CON-4) — весь цикл: развёртывание
  `hero.spawn` armed-тапом (свой мир / свой флот / мир союзника по маркерам), каст
  `hero.ability` (встроенные `temp_lane`/`annihilate` armed-тапом цели + `recall` /
  `aura` (rally/bulwark) / `reveal` (scan, armed-тап цели) — прототип-кернел несёт
  `heroEffectsModule`; **все не-встроенные эффекты имеют провайдеры → «скоро» не
  осталось**), дерево `hero.skill.unlock`, фиттинги `hero.fit`. Кастуемость —
  `HERO_CASTABLE` (built-ins + провайдеры `hero.effect.*`). Билдеры действий —
  `castHeroAbility`/`spawnHero`/`unlockHeroSkill`/`fitHero` (`game.ts`); тесты
  `herostate.test.ts` (сид) + `heroactions.test.ts` (интеграция пяти действий, включая
  reveal/scan, против прототипных каталогов).
- **Конструктор «Верфь» (`rail-constructor` → `shipyard.open()`, оверлей `#constructor`):**
  единый in-match таб-лоадаут со Stellaris-свитчером `[Корабли|Эскадрильи|Армия|Герои]` —
  все четыре панели живые (разгрузка игрового HUD: рельс `rail-hero` и окно `#hero`
  ретайрнуты, штаб героев свёрнут внутрь этого таба).
  Окно целиком живёт в `prototype/src/shipyard.ts` (REFM-13, `initShipyard(host)`):
  разметка чистая (`yardBoxHtml`/`loadoutPaneHtml`/`statBarHtml`/`bagText`/
  `originTagHtml`/`ownedHullsOf`), черновик заказа — значение `YardDraft` с чистой
  `normalizeDraft`, DOM трогает только проводка; `main.ts` отдаёт ему состояние хуками.
  Панели **Корабли** и **Эскадрильи** рендерят один framework-agnostic view-model
  `@void/client/loadoutEditor` (`loadoutPaneHtml(...,hullList,...)`, переиспользован
  напрямую, без дублирования логики) над разными семействами корпусов: типизированные слоты
  (Оружие/Защита/Система), палитра с `installable`/причиной от `canEquip`, живой превью
  base→derived (`effectiveStats`), разбивка стоимости (`loadoutCost`) и «Построить ×N» →
  `buildShip` → `unit.build{modules}` (ядро валидирует/платит/штампует; лоадаут заморожен
  на постройке — без переоснастки). Панель **Армия** снесена вместе с дивизиями
  (H4-REVERT): наземные войска строятся как обычные юниты в конвейере «Земля» панели
  мира. Панель **Герои** — ростер/штаб, живёт в
  `heroStaff.ts` (REFM-14, `initHeroStaff(host)`): способности `hero.ability`, дерево
  `hero.skill.unlock`, фиттинги `hero.fit`; вид панели — значение `HeroView` с чистой
  `normalizeHeroView`, разметка ничего не мутирует. Верфь берёт у неё `paneHtml()` и
  отдаёт клики в `click()` (→ `repaint`/`close`/null). Дальний каст и развёртывание
  целятся тапом по КАРТЕ, поэтому взводят хост (`armCast`/`armSpawn`) и отвечают
  `'close'` — `heroAim`/`heroSpawnAim` остались в `main.ts`. Инлайн-данные `game.ts` дополнены каталогом
  `modules` (6 модулей, зеркало `data/modules.json`) + типизированными `slots` на корпусах
  кораблей (cruiser/siege/scout/dropship) и эскадрилий (fighter_squadron/strike_carrier).
  Тесты: `shipyard.test.ts` (38) — цена и полоса характеристики (включая экранирование
  подписи, CWE-79), метка «откуда» (LARS-4), фильтр по снимку арсенала (ARS-5),
  нормализация черновика, разметка панели (гашение заказа без казны и без своих миров),
  окно целиком (вкладки, смена корпуса сбрасывает обвес, отказ ядра доезжает текстом кода,
  границы счётчика, заказ уходит в `unit.build`) и `heroStaff.test.ts` (28) — ростер,
  нормализация вида, роутинг кликов (дальний каст взводит карту и не шлёт приказ, ближний
  уходит сразу), имя героя в шапке досье (AUD-12: `heroDisplayName()` разводит два случая
  одного поля `name` — главный герой носит имя МЕСТА, позывной или дом, и переводу как
  текст не подлежит; остальные носят КЛЮЧ роты `hero.arch.*`, и сырой рендер показывал
  игроку сам ключ. Не-главному имя берётся из архетипа каталога — тот же текст, что уже
  показывают чипы ростера, так что шапка и чипы разъехаться не могут); плюс `loadoutEditor` в `packages/client` и живая проверка в браузере.
  **Мобильная адаптация** (`@media (max-width:560px)`): двухколоночная сетка панелей
  уже сворачивается в одну на ≤760px; на телефоне палитра модулей `.cn-pal` переходит
  на 2 колонки (имена перестают переноситься), крупнее тап-таргеты (`.cn-close` 36px,
  шаг счётчика 38px, таб/корпус-кнопки выше), меньше рамка оверлея (шире бокс); на
  коротких вьюпортах (`max-height:680px`, ландшафт-телефоны) оверлей скроллится, как
  соседние окна. Проверено CDP-скриншотами в portrait 390×844 (все 4 панели, без
  горизонтального переполнения).
- **Карта (квадратная 11×11, генерится в `game.ts::buildField`):** 121 провинция — ровно **30
  «планет»** (по 50 очков) + 91 не-планета (по 10) = **~2410** базовых очков на доске; **10
  старт-кандидатов** равномерно разнесены по инсет-периметру, ещё 20 нейтральных планет
  собраны в зеркальные орбиты. Квадратный аспект — чтобы карта читалась в портрете
  (заполняет ширину, панится по вертикали). Победа по очкам — **1100**
  (`SCORE_LIMIT`, прототип переопределяет дефолт ядра 600). Джиттер-решётка, RNG-линки и границы канваса выводятся из констант
  `FIELD`/`*_CELLS` — карта переформировывается правкой списков клеток.
- **`fleet.launch {planetId}`** (прототип: `fleetLaunch.ts`, REFP-10) — поднимает флот из
  гарнизона (корабли→`units`, наземные→`landing`). **В ядре тоже есть** —
  `packages/shared-core/src/modules/fleetOps.ts` (`fleetOpsModule`), закрывает разрыв
  между «построено» (`constructionModule` кладёт в гарнизон) и «играбельно» (ничего не
  выводило корабль из гарнизона). Два независимых, но идентичных по поведению
  реализации (прото исторически впереди, порт в ядро — этим заходом).
- **UI — тактический пульт (DEFCON-вайб):** векторно-каркасный стиль на чёрном.
  - **Карта = радарный планшет:** панорамируемая координатная сетка (двигается/
    масштабируется с камерой), редкие звёзды-тики, лёгкие скан-линии (CSS). Фон усилен мягкими туманностями и twinkle-звёздами; jump lanes
    — тонкие статичные неоновые линии (кэшированный список связей). **Планеты —
    wireframe-кольца** с неоновым свечением (glow), секторной аурой, пульсирующим
    ядром, крестовыми тиками-блипами, анимированным пунктирным кольцом «сенсорной
    дальности», форт = гекс-контур; выделение — вращающиеся target-скобки. **Флоты —
    светящиеся chevron-ы** по курсу, с engine-pulse, заливкой и затухающим следом.
    **Стоящие флоты сидят на одном кольце орбиты** вокруг планеты (одна орбита, без
    меток N/F); у летящих рисуется **путь** (анимированная dash-полилиния по хопам), бомбардировка —
    beam. Бой — многокольцевая пульсирующая красная волна. Render loop кэширует
    HUD/log DOM-строки и отсекает offscreen планеты/флоты.
  - **HUD минималистичный, моноширинный, неоновые тонкие линии:** верхний бар в
    **два ряда** (`--tbh`; зависимые отступы `#devline`/`#fps`/`#toasts`/`#side`
    висят на переменной): ряд 1 — «‹» (зеркало аппаратного Back: закрыть верхний
    слой / двойное «выход из матча»), круглый аватар-эмблема (тап → досье игрока),
    позывной + живое «N-е из M» (формула ранжира энд-скрина по live-очкам), чип
    «✦ счёт/лимит» в зазоре (тап → разбор победных очков), справа карточка «День N»
    с обратным отсчётом `H:MM:SS` до след. дня; ряд 2 — капсулы 5 ресурсов с `±N/ч`
    из `netIncome` (тап → сводка; дефицит/пусто — как раньше). Суверены ◆ — уровнем
    ниже, на статус-строке (игровые часы + золото). Кнопки скорости вынесены в
    **отдельный горизонтальный бар**; левая рейка-иконки, нижняя карточка-досье,
    терминальный лог `>`. **Командный бар флота**
    (горизонтальный, появляется по выбору флота): **Move** (взводит приказ → тап по миру
    отдаёт его — тап по узлу ИЛИ **по дороге** (`moveFleetEdge`/`nearestLanePoint`:
    армия выходит маршрутом на лейн и встаёт в точке; превью — путь + ETA-пип)),
    **Stop** (`fleet.stop` — паркует там, где стоит, прямо на дороге), **Attack**
    (штурм). Орбита одна — отдельного переключателя орбиты в баре больше нет.
    Припаркованный флот — chevron в его непрерывной точке, перемаршрутизируется
    по Move. Палитра: cyan (свои) / red (враг) / фосфорный зелёный (chrome) на near-black.
  - **Радар-кольцо:** при тумане — бледный teal-эллипс охвата моих радаров (массивы
    L1/L2/L3 = 240/330/420 коорд-ед + радар-корабли); радиус евклидов, проецируется
    по осям → граница тумана совпадает с кольцом.
  - **Камера pan/zoom** (тащить мышью-ЛКМ или пальцем / колесо / pinch / двойной
    тап-сброс); **адаптив** (мобайл/десктоп, media-queries, DPR-чёткость, тач).
    `netIncome` считает прирост.
  - **Семантический зум (LOD):** на отдалении карта становится схемой — голо-бейджи
    типов, callout-тексты, пирамиды/карго/счётчики флотов, орбитальные кольца и
    таймеры боёв растворяются (кроссфейд `globalAlpha` по scale 1.2→1.45; ниже —
    полностью схема). Остаются территории, узлы, флоты-шевроны «носом по курсу»,
    пульсы боёв и пинги; **свои миры подписаны на любом зуме** (якорь, как имена
    городов на глобусе). Пропуск отрисовки деталей на широких видах — заодно и
    выигрыш по кадру.
  - **Вспышка захвата провинции** (`planet.captured`, фог-гейт): провинция, сменившая
    владельца, загорается его цветом — волна расходится из центра ячейки (обрезана по
    её полигону), фронтир вспыхивает, всё гаснет за ~1.5с (`captureFlashes`,
    `CAPTURE_FLASH_MS`). Полигон ячейки берётся `computePowerCell` (тот же
    взвешенный-Вороной, что печёт полит-карту, одна ячейка O(n)) → волна пиксель-в-пиксель
    ложится на заливку и едет с камерой. Раньше захват был «тихим» (только тост).
- **Орбитальные контролы игрока в панели флота** (выводят механику ядра, а не
  стопгап): переключатель **бомбардировки** (`fleet.bombard`), ручной **штурм**
  (`fleet.assault`), и **погрузка/высадка наземной армии** между гарнизоном своей
  планеты и трюмом флота (`army.load`/`army.unload`). Орбита одна — на неё флот
  встаёт сам по прибытии, отдельной кнопки спуска/подъёма нет. Ошибочные приказы
  кратко логируются (`✖ code`).
- **Стопгап (сужен):** авто-штурм (`autoEngage`) остался **только для ИИ**
  (вражеские флоты), чтобы давление сохранялось; флоты игрока теперь полностью
  ручные. `fleet.launch`/`merge`/`split`/`engage` — есть и в ядре (`fleetOpsModule`), и
  в прототипе (`fleetLaunch.ts`).
- **Эскадрильи-авианосцы** (squadrons-roadmap SQ-1.1→4.1): `fighter_squadron` +
  `strike_carrier` строятся; носитель отделяет крыло в отдельный быстрый флот через
  `fleet.split` (кнопка «Запустить эскадрилью»); дерётся обычным боем, `orbital_aa`
  (теперь защитное здание, не юнит) — встроенный counter; ядро суммирует `aaDamage`
  и по гарнизону, и по зданиям (`aaStrengthAt`). Топливо/перезарядка (`SortieState`), евклидов `strikeRange`,
  детерминированное решение патруля (`patrolTarget`) — чистые тестируемые хелперы `game.ts`.
- **Цепочки приказов (command-chains) — УДАЛЕНЫ к релизу (REL-1, «пока убери»).**
  Старая очередь приказов (CC-5/CC-6: `orderQueueModule`, клиентский план
  `fleetQueues`+`driveQueues`, UI «Очередь приказов»/«➕ строить») и
  `subscriptionModule` (лимит-апселл) были вырезаны перед REL-1 (история — в git
  и `docs/backlog.md`, блок CC); **очередь вернулась в новом виде** — см. цепочки
  ниже. **Стоячие приказы** (CC-2/CC-4, `standingOrdersModule`):
  `order.auto`→`state.autoAssault` (авто-штурм), `order.scramble`→`state.patrols`
  (дежурный вылет, сервер сам считает центр/радиус/запас вылетов), `patrol.stamp`;
  чистые драйверы `serverAutoAssaultActions`/`serverPatrolActions` + хост-цикл
  `netserver.runServerStanding`; кнопки «⚔ авто-штурм» и «🛩 дежурный вылет»
  работают в соло и NET. **Цепочки приказов (CC-1, 2026-07-21, PR #294–#299):**
  авторитетный план флота `state.orders[fleetId]={steps,waitUntil?}` — шаги
  `move`/`wait` (Задержка, кап 14 суток)/`assault`/`barrage`/`strike` (огневое
  окно N часов: фокус-огонь → cease по дедлайну); клиент ставит план атомарно
  (`order.chain`, в гейт-схемах; `chain.stamp` — штамп драйвера, с провода
  отрезан), чистый драйвер `serverChainActions` (двухфазные wait/strike,
  consume-on-issue, sorted ids) + `runServerStanding` в NET и `driveChains` в
  соло-кадре — план исполняется офлайн. UI (CHAIN-UX, заказ владельца 2026-08-04;
  перерос одноцелевой композер TGT-1): кнопка «◎ Приказ» в cmdbar включает
  ПЕРСИСТЕНТНЫЙ режим построения — на мобиле нижний хаб (лист + рейл + скорость +
  цели) убирается (`body.chain-mode` + формула `open` renderPanel), полоска плана
  в ноде #cmdbar (`chainStripHtml`: счётчик N/8, живое «~T» через textContent вне
  HTML-сигнатуры, ⚠ при разных планах группы, ⟲ откат ЖЕСТА целиком / ⌂ домой /
  ✓ отправить / ✕ выход); каждый тап по точке карты открывает КОНТЕКСТНОЕ меню у
  самой точки («в зависимости от того, что это»: свой/нейтральный мир — курс+⏱;
  вражеский — +штурм и огневое окно (гейт по артиллерии, причина серости написана
  в пункте); вражеский флот — огонь по нему; герой на борту — ★ способности),
  выбор дописывает жест (действие не в финише само дописывает перелёт), ⏱/🎯
  наращивают часы повторными тапами не закрывая меню (бокс #tgted, позиция каждый
  кадр — едет с камерой и движущимся флотом-целью). Вся цепочка РИСУЕТСЯ на карте
  (`drawChainOverlay`): пунктирная полилиния по маршрутам move-шагов (кэш
  `chainRouteCache` — граф статичен), капсулы-глифы шагов у точек, накопленное
  «~T» под ними (`chainTimeline`: голова отправленного плана авторитетна по
  arrivesAt/waitUntil, хвост — оценка `estimateTravelHours` с учётом форс-марша и
  кулдауна ability); ◎-бейдж на якоре плана — тап открывает редактирование. Режим
  в реестре Back/Escape двумя ступенями (первый Back закрывает меню точки `tgted`,
  второй — сам режим; порядок задан z-index'ом лестницы BACK-1, а не «первой ветвью»,
  как было до неё), самогасится при пропаже флотов, сбрасывается в installMatch и на
  net-welcome. Чистая модель — `src/chainPlanner.ts` (жесты/меню/таймлайн/разметка,
  24 теста); позитивный сэмпл `orderChain` добавлен в gateparity (дыры больше
  нет). Плюс ☰-ряд командной панели: «⊕ Выбрать+» (SEL-1: тач-мультивыбор,
  панель схлопывается, тапы тумблерят свои флоты, общий приказ выходит из режима)
  и «⚡ Ускорить» (BOOST-1, `forcedMarchModule`: `fleet.forcemarch`, ×1.5 в хук
  `fleet.speed`, износ 5% max-HP/час только в полёте, пол — последний корпус жив,
  флаг слетает по прибытии). `orders`/`autoAssault`/`patrols`/`forcedMarch`
  фильтруются в fog (`visibleState`) — чужие планы не текут в снапшоты.
- **Bytro-карточка армии + визуальная система кораблей (2026-07-22, постер владельца):**
  `prototype/src/unitGlyphs.ts` — 6 архетипов-силуэтов из полей unit-def (флагман
  `hero` > артиллерия `range>0` > рой `faction=swarm` > транспорт `cargo≥8` > скаут
  `signature≤1 ∧ radar>0` > боевой), нормализованный SVG-путь 24×24 кормит и тайлы
  панели (`unitGlyphSvg`: размер S/M/L по hp, гало при щите/флагмане), и маркер
  карты (`Path2D`): **флот на карте = силуэт доминанта** (`dominantUnit`,
  attack+defense↓/hp↓/id↑) **+ счёт «×N»**; карго-хвост/LOD-шеврон прежние.
  Модификаторы поверх силуэта — ОДНИ на обе поверхности (`glyphScale`/`glyphHalo`,
  REFM-129): таблица размеров была своя у панели (`L 1 · M 0.84 · S 0.68`) и своя у
  маркера (`M 0.8 · S 0.62`), то есть «размер = hp» переставало быть шкалой ровно
  между двумя экранами; правило гало «щит или флагман» стояло дважды слово в слово.
  Радиус кольца у поверхностей по-прежнему разный, и намеренно: в панели бокс тайла
  фиксирован (кольцо постоянного радиуса, иначе сетка «дышит»), на карте бокса нет и
  кольцо едет за силуэтом.
  Карточка флота (`fleetPanelHtml`): ХП-бар армии (корабли+десант, effectiveStats;
  отдельная полоса щита), чипы АТК/ЗАЩ считаются как в ядре (`cappedUnitStat`,
  кап-индикатор `N/10`), СКР = `fleetBaseSpeed` с меткой ⚡ форс-марша; время в
  пути гибкое — остаток маршрута ÷1.5 при включённом марше; тайлы юнитов с
  мини-барами ХП стеков (тап — досье, добавлены досье Линии огня/Корпуса/Щита);
  тап по имени — **сводка армии** (состав по архетипам, кап против полной суммы,
  пулы, скорость с активными множителями, трюм/радар/содержание). **Платный
  мгновенный ремонт** — ненавязчивый золотой чип «🔧 N💰» на своём повреждённом
  флоте вне боя: `fleet.instantRepair {fleetId}` (гейт-схема в SV-1.2; модуль
  `instantRepairModule` в game.ts, цена `ceil(missingHull×1)` кредитов, топ-ап hp
  кораблей+десанта, щит не трогает; отказы `E_IN_BATTLE`/`E_NOTHING_TO_REPAIR`/
  `E_NO_FUNDS`/`E_NO_FLEET`; кредиты — прокси премиум-валюты до монетизации).
  **Настройки → «Цвета сторон»:** свой/нейтральный цвет (color-инпуты) и пресет
  палитры соперников (классика/тёплая/дальтоник Okabe–Ito), localStorage-косметика
  поверх `ownerColor`. Известный долг: `uitest.mjs` сломан на main до этой правки
  (`document.addEventListener` в фейк-DOM) — не входит в гейт.
- **Десант: «кого и сколько» (GRND-1, заказ владельца)** — погрузка/выгрузка наземных
  частей ушла из карточки флота в ряд команд: кнопка **⇅ «Десант»** (рядом с «Делить»,
  так же строго ОДНОФЛОТОВАЯ — гарнизон и трюм у каждого свои) раскрывает третий
  `.cmdpop`-поповер над рядом, без затемнения и без своего DOM-узла/слушателя. Внутри —
  строка на УНИКАЛЬНЫЙ тип (стеки схлопываются), «гарнизон ▸ трюм», знаковый счётчик
  `▼ − N + ▲`: `+N` поднять, `−N` высадить, обе стороны в одном заходе, без вкладок.
  Чистая модель и разметка — `src/troopsMenu.ts` (`troopsModel`/`stepPlan`/`maxPlan`/
  `planOrders`/`troopsMenuHtml`), 26 тестов: `floor(free/cargoSize)` (а не `free`),
  двойной резерв (трюм — своей очередью, гарнизон — очередями ВСЕХ флотов у мира),
  только здоровые стеки (`findHealthyStack`, как в ядре), конкуренция строк за место,
  «выгрузка освобождает трюм для погрузки в том же плане». Шаг КЛАМПИТСЯ, а не
  блокируется (идиома `+10` из диалога разделения). Подтверждение: выгрузка мгновенна
  и уходит ОДНИМ `army.unload {count}` на тип (ядро принимает `count` атомарно),
  погрузка ложится в часовую очередь `pendingLoads` по одной записи на единицу —
  сознательно, потому что ядро грузит «всё или ничего», и N записей доедут частично,
  если гарнизон за час обмелел. Fail-secure: гарнизон под штурмом (`garrisonUnderAssault`)
  отбивается на входе, а не через час. Реестр Back/Escape — рядом со `splitState`;
  меню гаснет само в раннем выходе `renderCmdBar`, в серии взаимного гашения приказов,
  в `apply()` при пропаже флота, в `clearSelection` и на старте матча. Карточка флота
  оставила ту же секцию БЕЗ кнопок — сводка «гарнизон ▸ трюм» + отсылка к ⇅ (прецедент
  подписан в коде: SO-UI, стоячие приказы). Текст тура `onb.tour.first.troops` переписан
  под новый путь в обеих локалях. Проверено вживую (412×915, RU): ⇅ активна у своего
  мира, «до упора» набирает 2 ополченца, шапка показывает `трюм 2/11 · заказано +2`,
  Подтвердить → «⏳ грузится: 2» → через игровой час `ополчение 0 ▸ 2`; обратный ▼ →
  мгновенно `2 ▸ 0`; Escape закрывает меню, не роняя матч.
- **Цели первой сессии / чек-лист (ONB-7)** — лёгкий «правильно ли я играю?»-сигнал только в
  онбординг-матче: чистый `src/firstGoals.ts` (`FIRST_GOALS` — шахта/флот/захват/100 очков;
  `metGoals(signals)`→Set, `mergeDone` монотонно, `goalsComplete`) — 13 тестов (три
  последних сканируют CSS и сторожат ПК-привязку оверлея). main.ts:
  `startFirstGoals()` в гайд-матче снимает baseline (миры/шахты/флоты), сворачиваемый оверлей
  `#goals` (z-32; телефон — правый нижний угол, ПК — левая колонка под devline, `left:70px`
  мимо рейла: не ложится ни на шапку, ни на открытое меню) тикает цели по живому
  состоянию каждый кадр (`updateGoals` в
  фрейм-лупе, no-op вне онбординга); всё выполнено → похвала + XP-бонус (ровно раз, guard);
  скрывается на конце гайд-тура и выходе в меню. RU/EN. Проверено вживую (headless-бут):
  чеклист появляется 0/4 в гайд-матче (без ложных тиков — baseline корректен), сворачивается,
  прячется на выходе. Только онбординг-сессия (DoD «чеклист скрыт после онбординга»).
- **Async-модель + дневной дайджест (ONB-5)** — учим самый трудный концепт жанра (мир идёт
  офлайн) в два хода. (1) **Интро задержки:** первый приказ на курс (`fleet.move`) → разовая
  карточка «мир идёт без тебя» (через ONB-3-механизм `asyncDelay`, вне гайд-тура). (2)
  **Сводка возвращения:** чистый `buildRecap(events, since)` → `{items (attention-first),
  attention, count}`, `isHighEvent` по emoji-маркерам ⚔🚩☠💥 — язык-независимо; логика теперь
  живёт в `@void/shared-core` (`util/recap.ts`), `prototype/src/recap.ts` — тонкий re-export
  (клиент и сервер строят дайджест по одной функции). main.ts: `note()` зеркалит структурный
  `eventLog` (bounded 80, чистится на новый матч); оверлей `#recap` (z-57) группирует «Требуют
  внимания» (жёлтый) + «Пока тебя не было», тап-по-объекту → `jumpToPing`; авто-показ на
  `visibilitychange` (фон-таб догоняет мир на возврате — реальный «пока тебя не было»; порог
  15с) + ручной вход «🛰» в окне сводок. RU/EN. Проверено вживую (headless-бут): дайджест
  открывается из окна сводок, ловит события матча, закрывается. **Серверная сторона push**
  (`packages/server/src/push.ts`): `vapidFromEnv`/`configureWebPush` (VAPID из `VAPID_PUBLIC_KEY`/
  `VAPID_PRIVATE_KEY`/`VAPID_SUBJECT`, отсутствие → пуш просто выключен), `digestPushPayload`
  (title = текст верхнего `RecapItem` как есть — уже локализован по своему контракту, никакой
  синтезированной прозы; остальные события — только `+N` числом), `sendPush` через `web-push`
  (404/410 → `{gone:true}`, вызывающий обязан снести подписку). `PushStore` (Memory/Postgres,
  таблица `push_subscriptions`, одна подписка на аккаунт) + `pushApi.ts` (`GET /push/key`,
  `POST /push/subscribe`, `POST /push/unsubscribe`, session-gated как остальные write-роуты) —
  14 тестов. _Осталось: сам триггер (когда слать — online/offline по аккаунту, cooldown,
  привязка к матчу) и клиентский service worker + подписка на push из UI._
- **Just-in-time интро механик (ONB-3)** — при **первом** контакте с продвинутой механикой —
  разовая интро-карточка, потом никогда: чистый `src/intros.ts` (`INTROS` — 11 карточек
  `{id,title,body,trigger}`: 5 панельных из готовой копии технологии/рынок/Хранитель/верфь/
  дипломатия + `corp`/`ava` (ONB-8) + `hero` (вкладка «Герои» внутри Верфи — по запросу
  владельца, героев/навыки push-обучение раньше не касалось совсем) + `asyncDelay`/
  `retreat`/`artillery` — три `firstAvailable`/`firstFail`-триггера на РЕАЛЬНОМ игровом
  действии, не открытии панели: первый `fleet.move` (мир идёт офлайн), первый
  `fleet.retreat` (копия — существующий боевой `.hint` про −40% корпуса/щита, вынесена из
  мид-боя в спокойный момент), первый `fleet.barrage` (обстрел); fail-secure
  `parseSeenIntros`, идемпотентные `markIntroSeen`/`hasSeenIntro`; `resolveIntro(seen,
  id,{veteran})→{card,seen}` — показывает ровно раз, ветерану suppress-но-помечено) — 10
  тестов. Хранится per-nick `vd.seenIntros.<ник>`. main.ts: `maybeIntro(id)` в хуках
  рельс-панелей (`rail-tech`/`-steward`/`-market`/`-constructor` + `openDiplo`), в
  хуке Верфи на вкладке «Герои» (`onHeroTab`) и в `playerOrder` на успешном
  `fleet.move`/`fleet.retreat`/`fleet.barrage` (не во время гайд-тура — тур сам владеет экраном),
  оверлей `#intro` (z-58 — поверх панели, ниже настроек 59), «Понятно» закрывает; ветеран =
  завершил матч (`meta.xp>0`)
  → карточки помечаются молча (не спамим). RU/EN. Прогрессивное раскрытие: обучение
  разнесено по сессиям, не фронт-лоадом. Проверено вживую (headless-бут): первое открытие →
  карточка, повторное → нет, другой панель → своя, ветеран → подавлено-но-помечено. _Триггеры
  `firstAvailable`/`firstFail` (ретрит/артиллерия) — модель готова, хуки за доводкой._
- **Help/кодекс-хаб (ONB-4)** — существующий корпус кодекса стал **находимым**: чистый
  индекс `src/codexIndex.ts` (`buildCodexIndex(data)`→плоский `CodexEntry[]` по всем
  юнитам/зданиям + `GLOSSARY` из 7 терминов-статей: async, туман, upkeep, орбита/высадка,
  трассы, очки, коалиц-порог; `searchCodex` — матч по заголовку+тегам, пустой запрос → все,
  инъектируемый `textOf` для локали) — 9 юнит-тестов (`codexIndex.test.ts`: поиск по
  заголовку/тегу, регистронезависимость, пустой→категории, глоссарий, ранжирование). UI:
  оверлей `#codexhub` (z-45, под `#codex`) с поиском + категориями (Юниты/Здания/Механики),
  результат — deep-link в существующий `openCodex` (глоссарий рендерит новая ветвь
  `codexHtml('m')`); точки входа — хаб «Ещё → Справочник» + внутриматчевая рельс-кнопка «?».
  RU/EN, поиск бьёт по локализованному ярлыку (RU «туман» и EN «fog» оба находят). Чистое
  surfacing (низкий риск). Проверено вживую (headless-бут): хаб открывается, пустой запрос →
  категории, поиск находит юнит/здание/термин, тап результата открывает статью. _Per-panel
  контекстная «?» — за последующей доводкой; глобальный хаб + рельс-«?» дают «найти за 2 тапа»._
- **Экран входа (`#connect`, welcome-стадия)** — карточка до авторизации: язык (чип
  RU⇄EN), «Новый командир», соц-стабы, «Вход по позывному», подвал с правовыми
  ссылками. Матч отсюда запустить НЕЛЬЗЯ: кнопки «Одиночная игра» на карточке нет ни в
  дев-, ни в игровой сборке (соло-скирмиш живёт за логином, в хабе) — неавторизованный
  посетитель не должен уметь поднимать сессии. Вёрстка: `#connect` скроллится и центрует
  карточку авто-полями (`align-items:flex-start` + `margin:auto`), а чип языка и подвал
  — абсолютные, поэтому их полосы зарезервированы паддингом `.cwrap` (46px сверху,
  50px снизу); раньше они висели за пределами бокса и на ноутбучном окне обрезались
  (чип уезжал под панель закладок браузера). Просторная раскладка требует ~930px высоты,
  которых у окна браузера нет, поэтому компактный вариант (чип и подвал в потоке,
  меньше крест) включается уже с `max-height:940px`. Пустое поле позывного отвечает
  фокусом, а не строкой статуса: ключей `auth.need-nick`/`err.no-nick` больше нет — при
  загрузке страницы `resolveServer()` красил ими статус-строку ещё до того, как игрок
  что-то ввёл, и под карточкой висело «Введите позывной».
- **Первый запуск + воронка (ONB-0)** — признак «прошёл онбординг» отдельно от ника:
  чистая per-nick модель `src/onboarding.ts` (`OnboardState {started, stepReached,
  completed, skipped}`, fail-secure `parseOnboardState`, идемпотентные переходы,
  `welcomeMode` new/returning, `isOnboarded`) — 13 юнит-тестов (`onboarding.test.ts`:
  new/returning, идемпотентность completed, skip уважается, парсер не падает на битом
  значении). Хранится в `localStorage` (`vd.onboard.<ник>`, рядом с `vd.meta.<ник>`);
  при сервер-аккаунте (SE-1.x) переедет в профиль. main.ts: новичку — одноразовое
  предложение в хабе (`#onboard-nudge`, «Начать обучение»/«Пропустить»), «Ещё → Обучение»
  — реплей; «Начать» запускает ONB-2-гайд (см. ниже); тонкий воронка-хук пишет
  `stepReached`/исход через чистый `applyTourOutcome` (без PII, агрегаты — за OPS).
  Проверено вживую (headless-бут main.ts): предложение показывается новичку, «Пропустить»
  пишет флаг и прячет карточку, повторный визит не предлагает, признак per-nick.
- **Гайдовый первый матч (ONB-2)** ★ — главный онбординг-deliverable: `startGuidedMatch`
  поднимает **безопасную соло-песочницу без ботов** (`setupSlots` all-off → `startMatch`)
  и запускает над её живым HUD data-цепочку `src/firstMatchTour.ts` — весь цикл §2:
  добыча (`action:building.construct`) → флот (`action:fleet.launch`) → курс
  (`action:fleet.move`, туман) → двухфазный захват (`state`: игрок владеет миром сверх
  стартового) → счёт пошёл (`state`: счёт вырос) → «первая схватка выиграна». «Do X»-беты
  ждут **реального** приказа (через `playerOrder`→`notifyAction`), захват/счёт — по живому
  `s`; скипаемо на любом шаге. Успех (первое прохождение) → `onboarded`=completed +
  XP-пакет (`matchXp`, начисляется один раз) + нудж «сыграй настоящий матч». Скрипт
  запускается через шов `pendingGuide`, срабатывающий из `installMatch` (кадр на прорисовку
  HUD). Тесты: `firstMatchTour.test.ts` (форма цепи, захват gated на `state`, скипаемость)
  + `applyTourOutcome` (награда ровно раз) в `onboarding.test.ts`. Проверено вживую
  (headless-бут): «Начать обучение» ставит матч, гайд ведёт над HUD, action-шаг прячет
  «Далее» (нужен реальный приказ), «Пропустить» пишет `skipped`. _Тонкая доводка захвата
  (микрошаги орбита/десант) — за ONB-3/последующими; беты цикла присутствуют и
  корректно гейтятся._ Побочно: у `action`/`state`-шагов подсветка best-effort (missing
  target → ждём, не скип/стоп; ONB-1-движок уточнён), а на них `.sl-dim` прозрачна —
  карта читается, игрок оперирует HUD.
- **Движок гайд-марок (ONB-1, spotlight)** — переиспользуемый онбординг-примитив
  (`src/spotlight.ts` — чистый, DOM-free стейт-машина + геометрия; `src/spotlightDom.ts`
  — браузерный адаптер; `src/onboardingTour.ts` — data-цепочка над реальным HUD).
  Затемняющий оверлей + подсветка узла (дыра из 4 dim-панелей по bounding-box, элемент
  виден/кликабелен сквозь щель) + пузырь-подсказка со счётчиком «шаг k из n», «Далее/
  Понятно» и «Пропустить обучение». Продвижение по `tap` / `action:<type>` (реальный
  приказ через `playerOrder` → `activeTour.notifyAction`) / `state`-предикату (пуллится
  на `refresh`). Устойчив к перерисовке панели (re-query по селектору каждый кадр);
  отсутствующий target → optional-скип или безопасный стоп (не крашится). z-50: поверх
  HUD, ниже критичных модалок; `tap`-шаги ловят клики (только «Далее» ведёт вперёд),
  `action`/`state`-шаги — click-through к живому HUD. **Баг найден живьём (реальный
  игрок + независимо headless-тач-репро) и исправлен:** click-through был неполным —
  `#spotlight{position:fixed;inset:0}` сам обычный div (дефолт `pointer-events:auto`), и
  хотя все 4 `.sl-dim`-панели уходили в `pointer-events:none` под `.sl-passthrough`,
  корень продолжал глотать тап в зазоре между панелями (ровно там, где игрок должен
  тапнуть HUD) — на любом action/state-шаге («построй Шахту» и далее) тур не пропускал
  ничего. Исправлено добавлением `#spotlight.sl-passthrough{pointer-events:none}`
  (`build.mjs`; пузырь остаётся кликабельным — явный `pointer-events:auto` на потомке
  перебивает `:none` предка). Локаль RU/EN. Запуск — шов
  `window.__vdTour` (авто-предложение и «Ещё → Обучение» — за ONB-0/ONB-2, они строятся
  на этом движке). Тесты: `spotlight.test.ts` (22 — tap/action/state, скип, optional-скип
  vs safe-stop, счётчик, re-query-устойчивость, геометрия, + 2 CSS-регрессии на сам баг).
- Валидаторы: `src/smoke.ts` (Node-сценарий ядра) и `uitest.mjs` (headless-DOM
  прогон UI-бандла).
- **Кабинет корпорации** (`prototype/src/corpScreen.ts`) — межсессионный альянс из
  `metagame.md`: оверлей `#corp` (вход с вкладки «Альянсы» в хабе и с рейл-кнопки ⬢).
  Не макет: шесть вкладок **сеткой** (Штаб / Участники / Вызовы / Битвы / Казна /
  Настройки), каждая поверх живого маршрута — `corpApi.ts`, `avaApi.ts`, `medalApi.ts`,
  `leaderboardApi.ts` (AVA-C1/C2 + CORP-HUB). Витрина наград — тап по кубку открывает
  общий список медалей; сам выбор витрины локальный (поля витрины у сервера нет).
  Чего в кабинете НЕТ, потому что нет в данных: корп-постройки, кузница, склад
  деталей, задачи недели, ресурсная казна (влияние — единственная корп-валюта),
  звенья, онлайн-статус, тег/девиз/набор/взнос, счёт отдельного боя. Владения и чат
  ждут Контур 2 и остаются честными строками «скоро» в «Настройках».

## 8. Метаигра (north-star)

Два контура: обычные сессии (малая карта) + AvA-битвы за сектора мета-галактики
(корпорации, очки влияния, мета-шпионаж). Зафиксировано в **`docs/metagame.md`**.
Ключ: сессионное ядро — движок обоих контуров; мета-слой — сервер (Этап 3+).
Сейчас **не строим**. UX мета-шелла — **`docs/main-menu.md`**; экран управления
корпорацией (ростер/роли/казна/владения/AvA/чат) — **`docs/corporation-ui.md`**.

**CORP-0 (первый серверный кирпич мета-слоя)** — база корпораций из
`docs/corporations.md`: `CorpStore` (Memory + Postgres) с членством
`head|officer|member|recruit` (рекрут-строка = заявка), `CorpService` применяет матрицу
прав §2 fail-secure стабильными кодами (ровно один Глава, Главу не кикнуть, офицер не
эскалирует, передача главенства — явное действие Главы, уход Главы = передача или
роспуск в одиночку), REST `/corps` в `main.ts` session-gated + per-IP rate-limit на
записи + аудит-лог. Структурные инварианты на уровне стора: одна корпа на аккаунт (PK
по `account_id`), уникальное имя без регистра, атомарные `createCorp`/`swapHead` в
транзакции, аудит переживает роспуск. Контрактные тесты обоих адаптеров +
матрица прав + HTTP-контракт (memory + Postgres 16). Отложено (не спекулятивно):
гейт создания по уровню аккаунта (нужен серверный XP AC-0.3). Клиентский экран (§7 mock)
пока на локальных данных — проводка к `/corps` дальше.

**Медали / достижения (MED-1, corporations.md §3).** Каталог-ДАННЫЕ `data/medals.json`
(вне ядрового `GameData`-загрузчика: свой fail-secure парсер `medalCatalog.ts`,
`E_INVALID_MEDALS` на кривой форме — неизвестное условие никогда не читается как
«eligible»). Условия ОБЪЕКТИВНЫ и проверяются сервером из истории AvA
(`AvaResultStore.statsForCorp` — матчи корпы с любой стороны + победы), не самозаявкой
клиента. MVP — корп-медаль `scope:corp`+`grant:manual`: сервер помечает корпу eligible
по условию, глава/офицер вручает медаль члену своей корпы, сервер ПЕРЕПРОВЕРЯЕТ
eligibility на выдаче (`E_NOT_ELIGIBLE`), грант идемпотентен и перманентен (PK
`(account, medal)`, `MedalStore` memory+Postgres), аудит-запись `medal`. HTTP
session-gated: `GET /medals` (каталог) · `/medals/me` · `/medals/eligible` ·
`POST /medals/grant {target, medalId}`. Отложено (нужен пер-аккаунт леджер участия):
`scope:account`+`grant:auto` авто-достижения. `medalCatalog/medalService/medalApi`
+ стор-контракт `statsForCorp`/`MedalStore` (оба адаптера).

**AVA-2/3/4 (готовность + вызов/принятие AvA)** — серверный слой поверх CORP-0.
**AVA-2 очки влияния:** корп-валюта `influence` в `CorpStore` (`addInfluence`/
`spendInfluence` — списание атомарное с guard'ом `influence >= cost` внутри UPDATE,
`E_INSUFFICIENT`, никогда < 0; аудит `influence`); отдельно от внутриматчевой казны;
Memory + Postgres (`ALTER … IF NOT EXISTS`-backfill). **AVA-3 флаги готовности:**
корп-флаг (глава → пул готовых) + игровой флаг (член → согласие на офлайн-развёртывание,
привязан к текущей корпе — выход/кик/роспуск чистит его в той же транзакции); `GET
/ava/pool`; таблицы `corp_ready`/`player_ready`. **AVA-4 вызов/принятие (S0→S2):**
`AvaService` — глава готовой корпы тратит влияние и вызывает другую готовую (списание
ДО создания заявки, возврат при отказе создания); глава цели `accept` (→ `accepted` =
S2-матчап) или `decline` (возврат); истечение — `sweepExpired(now)` на инжектируемом
таймере (свип-интервал в `main.ts`, без подключённых клиентов). Инварианты в сторе:
одна `pending`-заявка на пару (partial unique index) + exactly-once `pending→terminal`
(условный UPDATE — гонка double-accept закрыта, без двойного возврата влияния). Всё
fail-secure стабильными кодами; REST `/ava/*` session-gated + per-IP rate-limit;
`AvaService`/HTTP/стор-контракт-тесты (memory + Postgres 16).
**AVA-6 ростер + лок (S3):** `accept` открывает окно паузы (`pause_ends_at`, деф. 24ч);
state-машина матчапа расширена `accepted` → `locked`/`cancelled` (exactly-once условным
UPDATE — лок необратим по построению). `AvaRosterStore` (Memory + Postgres `ava_roster`):
PK (matchup, account), пер-сайд кап охраняется атомарно (вставка сериализуется
`FOR UPDATE` на строке матчапа — гонка за последний слот не переполняет сторону).
`setRoster` — глава/офицер, replace-side целиком, ТОЛЬКО флагнутые (AVA-3), кап;
`join` — самозапись члена в окне (нефлагнутый тоже — явка и есть согласие),
идемпотентен; `rosterView` — свой состав + счётчики обеих сторон (чужой ростер
приватен до боя); `sweepRosters` — обе стороны ≥ minPerSide → `locked` (вход S4),
недобор → `cancelled` + возврат цены вызова ровно один раз; свип рядом с expiry в
`main.ts`. Коды `E_NOT_FLAGGED`/`E_ROSTER_FULL`/`E_ROSTER_LOCKED`/`E_WINDOW_CLOSED`; REST
`GET /ava/matchup/:id` + `POST …/roster` + `POST …/join`.
**AVA-7 оркестратор сессии (S4):** `AvaOrchestrator` из залоченного матчапа поднимает живую
AvA-сессию. Чистая `seatAvaRoster(map, rosterBySide)` кладёт каждую сторону на слоты своей
команды (сортированы — союзники сгруппированы), пустые кресла → серверный ИИ; `playerId =
slotId` (id аккаунта не течёт в state). `orchestrate(matchupId)` (идемпотентно): размер =
`max(сторона)` → `pickAvaMap` (seeded `ava:<matchupId>`) → `buildStateFromMap({slots,
crossTeamStart:'peace'})` (мир S5) → комната через инжектируемый `createRoom` (снапшот в
стор, ленивый реестр грузит на коннекте) → `AvaSessionStore.create`. `AvaSessionStore`
(Memory+Postgres `ava_sessions`, PK match_id + UNIQUE matchup_id): matchup↔match_id +
`seats` (account→slot), restart-safe. `resolveAvaSeat(matchId, accountId)` → фикс-место /
`E_NOT_ROSTERED` / `null` (не-AvA → обычный `resolveSeat`), встроен в `matchApi.join`. Свип
по `lockedMatchups` без сессии рядом с roster-свипом (мимо клиента). Коды
`E_NO_MATCHUP`/`E_NOT_LOCKED`/`E_NO_MAP`; загрузчик пула `loadAvaMaps()`. Отложено: снапшот
арсенала в лоадаут (мета-инвентарь), `capPerSide`=слоты карты.
**AVA-8 итог (S7) — самодостаточный срез:** state-машина матчапа продлена терминальным
`ended` (`locked` → `ended`, exactly-once условным UPDATE — тот же паттерн, что
`accepted`→`locked`); `AvaService.settleMatch(matchupId, winnerSide)` архивирует матчап,
пишет исход в `AvaResultStore` (Memory + Postgres `ava_results`, PK matchup — история
MM-3.1: кто с кем/победитель/время) и начисляет влияние победившей корпе (AVA-2
`addInfluence`, деф. `winReward`=150, инжектируемо) + аудит; выигрыш `locked→ended` —
exactly-once-гейт, повторный `match.ended` не начисляет дважды. Ничья (`winnerSide=null`)
— исход пишется, влияние нет. `matchHistory(limit)` — лента исходов newest-first
(фундамент под AVA-9/медали/рейтинг). Код `E_MATCHUP_CLOSED`. Server-driven (мимо гейта,
как свипы).
**AVA-8 S6 + проводка (кирпич закрыт — полный цикл S0→S7 собран):** `AvaSession.warAt`
(= создание + `peaceMs`, деф. 24ч / env `AVA_PEACE_MS`) + exactly-once штамп
`warDeclaredAt` (`markWarDeclared` условным UPDATE, очередь `dueWar`).
`AvaOrchestrator.sweepWar` на общем интервале: `registry.resolve` будит комнату,
`warDeclarationsFor(state)` — чистые системные декларации ровно по кросс-командным
peace-парам (детерминированные id `ava-war:<match>:<a>:<b>` — реплей батча дедупится
квитанциями; `E_SAME_STANCE` = пара уже провёрнута), транзиент-провал → ретрай
следующим свипом; матчап, рассчитанный до войны, вычищается из очереди без эскалации.
Игроки в AvA-комнате войну не объявляют: новая опция **`MatchRoom.denyPlayerActions`**
— wire-правило в `receive` (оба пути bare+gated; серверные драйверы через
`submitAction`/`submitServerAction` идут мимо), в AvA-комнате `diplomacy.declare` →
`E_AVA_DIPLOMACY`. Проводка S7: observe-`end` AvA-комнаты → `onMatchEnded` →
`winnerSideOf` (слот/`bot:`-слот → сторона тем же sorted-teams правилом, что рассадка;
неизвестный → null-ничья, fail-secure) → `settleMatch` (реплей `end` — no-op).
**AVA-9 публичная лента (блок AVA-1…9 закрыт):** `AvaFeedStore` (append-only,
Memory + Postgres `ava_feed`) — только публичные факты: имена корпораций (снапшот на
публикации) + победитель, БЕЗ ростера. Публикация в `AvaService`: `matchup` в конце
`accept` (S2), `result` в конце `settleMatch` (S7, exactly-once его `locked→ended`
гейтом) — последним шагом, best-effort (лента не валит закоммиченный переход).
Чтение `publicFeed(limit, before)` newest-first с курсором по `at`; публичный
`GET /ava/feed` (без сессии, `registerAvaFeed` рядом с open-matches feed;
`?limit` 1..50, `?before`). `corporation-wars.md`.

## 9. Статус

> Компактный агрегат; помашинная матрица — [`readiness.md`](readiness.md),
> запуск для живых игроков — [`launch-runbook.md`](launch-runbook.md).

**✅ Этап 1 (ядро) — готово целиком:** 33 модуля на микроядре (шина/хуки/манифест,
seeded RNG + golden, `advanceTo`; список — §3, разбор — §5, сервер собирает из них
`DEV_MODULES` — 29): экономика + рынок, карта/движение/перехват, типы
секторов и планет, бой (мелэ + орбитальное ПВО/бомбардировка + артиллерия) с двухфазным
захватом, здания + станции, флот ⊕ армия + транспорт, технологии + учёные, фракции,
дипломатия (стойки + consent-офферы), шпионаж + контрразведка, герои, «Хранитель»,
победа/счёт, туман (`visibleState` + память + radar), движок эффектов (EFX-1:
`data.events` trigger→effect, трейты читаются генерически).

**✅ Этап 2 (action-layer) — готово и вшито в сервер** (`GATE=1`); клиент шлёт
`action.v1`-конверты по `gated`-рукопожатию.

**🚧 Этап 3 (сервер) — крит-путь до онлайн-сессии закрыт:** durable Postgres +
commit-before-broadcast, туман-на-отправке, offline-планировщик, `LazyRoomRegistry` +
MatchKeeper, аккаунты логин/пароль + JWT (opt-in); action-гейт включён и на
играбельном пути (netserver, REL-4 — в compose по умолчанию ON), места игроков
заперты посадочными билетами (REL-5, `SEAT_LOCK`, тоже default-ON). Дальше:
OIDC/полные аккаунты на прото-пути, мультипроцесс.

**🚧 Этап 4 (клиент):** играбельный клиент игроков — `prototype/` (браузер + APK,
RU/EN, мобильный UI-пасс, мета-прогрессия); `packages/client` — transport-adapter +
Vite-shell с живой картой. Полный HUD в shell — впереди.

**✅ ONB-0 (онбординг — флаг первого запуска + воронка):** `prototype/src/onboarding.ts`
хранит `void.onboarded.<ник>` (started/stepReached/completed/skipped, fail-secure парсер,
как `meta.ts`); `openHub()` — единая точка входа (Новый командир/Вход по позывному/
соц-стабы/автовход) — ветвит new/returning и показывает разовый nudge к гайду только
брендново-новому нику, переживает reload. Сам гайд (spotlight-движок, гайдовый матч) —
ONB-1/ONB-2, следующие кирпичи (`docs/onboarding-roadmap.md`).

**⚠️ Известные стопгапы/долги:**

- Прототип: орбитальные контролы (bombard, assault, load/unload) теперь в
  UI игрока; орбита одна (флот встаёт на неё по прибытии); `autoEngage` остался
  только для ИИ; ПВО считается в ядре, но отдельной индикации в UI пока нет.
- ✅ ~~`fleet.launch` — пока прототип-модуль~~ — **портирован**: `fleet.launch`/
  `merge`/`split`/`engage` теперь есть и в ядре (`packages/shared-core/src/modules/
  fleetOps.ts`, `fleetOpsModule`, в `DEV_MODULES`), закрывая разрыв между «построено»
  и «играбельно» на живом мультиплеерном сервере.
- ✅ ~~Бой: флот-только-десант (без кораблей) выигрывает наземный бой, но не
  захватывает~~ — **исправлено**: `capturePlanet` вызывается до `releaseOrDestroyFleet`,
  десант депонируется в гарнизон; fleet без кораблей уничтожается после захвата.
- ✅ ~~Стройка: два одинаковых заказа до завершения спишут ресурсы дважды~~ —
  **исправлено**: `building.construct` и `building.upgrade` проверяют pending
  `construction.complete` в `scheduled[]` и отклоняют дубль (`E_ALREADY_QUEUED`).

## 10. Команды и качество

```bash
pnpm install
pnpm run check       # lint + typecheck + test + docs-check (гейт)
pnpm test            # vitest
pnpm run prototype   # собрать prototype/dist/void-dominion{,-player}.html
```

Гейт зеркалится в CI (`ci.yml`), рядом идут `security.yml` (набор сканеров; блокирующие
— Semgrep, Gitleaks, OSV, Trivy fs/image; с SEC-10 ещё и еженедельный ре-скан `main` по
крону — прод крутит пиненный образ дольше, чем живут ленты CVE), `android.yml` (APK),
`image.yml` (SEC-13: сборка → блокирующий Trivy → блокирующий смоук «образ стартует» →
GHCR → подпись cosign по дайджесту; смоук — SEC-17, потому что сканеры читают файловую
систему образа и ни один его не запускает, так что мёртвый образ сканируется начисто) и
`automerge.yml` (ставит зелёный PR в merge queue). Про последний важно, что он делает
**не** «Enable auto-merge»: под очередью эта кнопка не работает — она зовёт
`enablePullRequestAutoMerge`, тогда как «Merge when ready» зовёт совсем другую мутацию,
`enqueuePullRequest`. Воркфлоу подписан на ЗАВЕРШЕНИЕ прогонов `CI`/`Security scan`
(момент «required-чеки отчитались») плюс на `ready_for_review`, читает
`mergeStateStatus` и ставит в очередь `CLEAN` и `UNSTABLE` — последнее потому, что
информационные сканеры краснеют штатно (чужие CVE в caddy/gosu чинятся апстримом), и
требование строгого `CLEAN` остановило бы авто-постановку для всех PR разом. Гейт этим
не обходится: очередь ПЕРЕПРОВЕРЯЕТ PR на временной ветке «свежий `main` + PR» и не
вливает красное. Безопасность `workflow_run` (он бежит с правами базовой ветки) держится
на том, что checkout кода PR там НЕТ вообще и артефакты вызвавшего прогона не читаются,
плюс явная отсечка форков и черновиков. `ci.yml` и `security.yml` подписаны на событие
`merge_group`: `main` идёт через merge queue, а она ждёт required-чеков на своей
временной ветке — воркфлоу без этой подписки туда не попадает, и PR вышибает по
таймауту. Заводишь required-чек в новом воркфлоу — добавляй `merge_group` и ему, И
дописывай воркфлоу в список `workflows:` у `automerge.yml`, иначе авто-постановка
сработает раньше, чем этот чек отчитается (процедура настройки ветки целиком — в
`CONTRIBUTING.md`).
Прод-деплой из подписанного образа: `deploy/verify-image.sh` + оверлей
`docker-compose.release.yml` (runbook — `deploy/README.md`, разбор слоёв —
`docs/security/pipeline.md`).

Тесты лежат рядом с кодом (`*.test.ts`) — и в пакетах, и в `prototype/src` (Vitest
их видит). **Прототип типизируется в гейте (REFM-0):** `prototype/tsconfig.json`
(полный `strict` + `noUncheckedIndexedAccess`, DOM-lib) накрывает `src/**` +
`netserver.ts` + `/localization`, `pnpm run typecheck` гоняет его после workspace-пакетов
— 91 накопившаяся ошибка починена по-настоящему (в т.ч. TDZ-класс `authMode`,
расхождение словаря `ChainStep`, битые l10n-фолбэки юнитов). **ESLint зона тоже прошла (REFM-0.1)** — `prototype/**` больше не в `ignores`,
правила общие с пакетами, единственная настройка — Node-глобалы для `*.mjs`-скриптов
зоны. Это уже НЕ throwaway — это играбельный клиент игроков.
Разработка — на фиче-ветке, PR (draft).

Поверх юнитов — **property/fuzz-слой ядра** (fast-check, playtest-hardening FUZZ-1…4,
SD-7.3 ✅): test-only `shared-core/src/testkit/arbitraries.ts` (генераторы действий по
каталогу `actionPayloadSchemas` + fixture-вселенная) и три сьюта в гейте —
`applyAction.property.test.ts` (fail-secure на враждебном мусоре, чистота/детерминизм
frozen-vs-thawed), `advanceTo.property.test.ts` (спаны, партиционная инвариантность:
бит-в-бит на дискретном ядре, coarse ≈ fine на полном стеке, модуль-бомба),
`delta.property.test.ts` (`applyDelta∘diffState = id` + JSON-провод + идемпотентность).
Падение печатает seed — репро детерминирован. Четвёртый сьют, **MP-3**
(`economyConservation.property.test.ts`, `security-master-plan.md`): переиспользует
тот же `arbValidAction`-генератор, но с локальным `economyFixtureState` (общая
фикстура стартует уже застроенной и без верфи — под ней ни один sink не сработал бы) —
сумма ресурсов игроков + эскроу открытых market-ордеров не может расти на любой
последовательности; сознательно узкий периметр (без `advanceTo`/`market.take` —
без начисления/комиссии, которые вне «кроме явных source/sink»), не общее заявление
о сохранении всей игровой экономики.

## 11. Как возобновить работу

1. Прочитать корневой `CLAUDE.md` (инварианты + рабочие правила), затем этот файл
   и нужные `docs/`.
2. Своя фиче-ветка от `main`; перед коммитом — `pnpm run check`.
3. Новая механика = новый модуль (события + хуки) + возможно данные; ядро трогать
   не нужно. Этот снапшот обновлять после крупных изменений.
