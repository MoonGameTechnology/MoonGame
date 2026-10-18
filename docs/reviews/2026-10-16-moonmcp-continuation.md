# Continuing MoonMCP pentest — 2026-10-16 (local docker stack + prod blackbox addendum)

Дополнение к [промежуточному пентесту 2026-10-14](2026-10-14-moonmcp-interim-pentest.md). Два контура: (A) локальный docker-стенд владельца (`deploy-*`, Fastify `deploy-server-1` на `127.0.0.1:8788`) — глубокий белый ящик по WS-экономике; (B) краткое подтверждение из [production blackbox отчёта](2026-10-16-prod-blackbox.md). Стенды **не** смешиваются.

## A. Локальный docker-стенд (white-box, live)

Контур: `deploy-server-1` (Fastify :8788), `deploy-corporations-1` (:8789, не опубликован хосту), `deploy-postgres-1` (loopback), `deploy-corporations-db-1`. Фронт — один inline-бандл 2.8 MB; протокол полностью реконструирован из бандла (action.v1 envelope, join-jwt, zod-схемы).

### Тестовые аккаунты
`sectest_alpha` / `sectest_bravo` / `sectest_charlie` (регистрация через открытый `/auth/register`). Пароль тестовый, аккаунты созданы для проверки и подлежат удалению владельцем.

### Проверено — защита на месте (негативные контроли)

| Сценарий | Результат |
| --- | --- |
| Подмена `playerId` в action.v1 envelope (`p2`-сессия шлёт как `p1`, чужой fleetId) | `E_FORBIDDEN` |
| envelope.playerId ≠ action.playerId | `E_BAD_ACTION_ID` |
| Фейковый/чужой `sessionId` | `E_FORBIDDEN` |
| `clientSeq` gap (+50) | `E_OUT_OF_ORDER` |
| Replay идентичного envelope | дедуп (`E_ALREADY_QUEUED` на строительстве; state resubmit) |
| Chat-флуд по WS | `E_CHAT_RATE` после 5 в окно |
| Туман войны (p2 подключён, p1 оппонент) | серверный: чужие планеты `owner:null`, гарнизоны пустые, ресурсы p1 `{}` не отдаются |
| Экономика: отрицательные/нулевые amounts, `price<1`, `1e308` (trader/market/army/unit) | `E_BAD_PAYLOAD` по всем векторам (zod) |
| corporations: member → `role`/`kick`/`transfer`/`build`/`audit` | все `403`; self-promote до membership: `E_NOT_MEMBER`/`E_BAD_TARGET` |
| `E_BAD_MESSAGE` на `expectedLevel:-1` | невалидное body отсекается |
| Rate limits REST | `/auth/login` 429; `/corps/*/accept` `E_RATE_LIMIT` при частых вызовах |
| Join-токен cross-match | handshake `401`; `?player=`/`?nick=` в accounts-режиме не работают |
| `/metrics` на 8788 | 404 без и с токенами |
| corporations API с хоста | `401` без service-key (key живёт в docker env, не в HTTP) |

**Позитив**: `market.list` → детерминированный `market:<seq>` id; `GET /matches` показывает только агрегаты.

### Кандидаты в находки (текущий статус)

**W-1 · Мультисессия одного места / дедуп по sessionId (Low, LIVE)**
`/matches/:id/join` возвращает **идентичный join-токен при каждом запросе**; сервер допускает N≥3 одновременных WS-сессий одного игрока (все получают welcome/state). Дедуп конвертов ключится на `sessionId`, а не на `playerId`: один `clientSeq=1` в двух сессиях = два разных actionId. `SEAT_LOCK=1` ограничивает число мест, но не соединений. Импакт: примитив для гонок + тихое параллельное управление местом. Совпадает с Finding 2 production blackbox (`singlePeerPerPlayer`). **Рекомендация**: single-peer-per-player (kick старшего сокета + уведомление), либо зафиксировать by-design.

**W-2 · Гонка market.take из двух сессий (снят/unconfirmed after testing)**
Два одновременных `market.take` одного листинга ( barriers, два WS, валидные конверты): **оба ответа OK, но исполнение не произошло** — брекет-замер ресурсов (3–10 s settle) показал delta ≈ 0 metal при номинале +20/−100, листинг жив, `market.traded` события не эмитились. Контрольный одиночный take по той же методике тоже дал 0 дельты. Единственный прогон с движением товара (+25 metal) случился в матче, уже находившемся в `status=ended` (матч завершён победой p2). Вывод: двойного исполнения не показано; вероятная механика — take уходит в очередь за seat-lock и не успевает исполниться в границах наблюдения. **Требует отдельного разбора с ожиданием исполнения в live-матче и проверкой ответа после settle**, прежде чем объявлять race-condition.

**W-3 · user enumeration через `E_LOGIN_TAKEN` (Info)** — дублирует V-3 из отчёта 2026-10-14 для контейнера: там подтверждённый 409 на дубликат login.

**W-4 · logout/revocation отсутствуют (Info, подтверждает V-5)** — `POST /auth/logout` 404, session JWT (HS256, `typ: session+jwt`, 7 дней) неотзывной; на контейнере повторный login детерминированно возвращает тот же token.

### Ограничения
Гонки AvA/friend-limit из white-box списка (I-1/I-5 отчёта 14.10) на контейнере не воспроизводились; экономический race-кейс W-2 остался неустановленным (не в плюс и не в минус — нужен воспроизводимый прогон). Туман войны проверен на одной паре игроков (`duel-1`/`ffa-4`).

## B. Production blackbox (addendum 2026-10-16)

Полный отчёт: [2026-10-16-prod-blackbox.md](2026-10-16-prod-blackbox.md) (external probing, `https://77-221-140-87.sslip.io/`, build `81715959`).

- External surface: только 22/80/443 (проверено check-host.net с ≥2 нод; локальный «тысячи портов» артефакт NAT). Postgres/Redis **не** торчат наружу.
- TLS 1.3 + HSTS + строгий CSP (`default-src 'none'`, sha256, `frame-ancestors 'none'`); CORS locked к origin.
- JWT (alg pin, tamper→401), WS Origin allowlist (missing/null/wrong/subdomain → 403), join-token match-scoped (cross-match 403), seat-hijack prevented (`?slot=p1` на занятое → first free), per-IP limits на login/join engage, обход X-Forwarded-For не показан.
- Corps RBAC: эскалаций не найдено (member → head/officer self-promote, kick head, disband — все 403).
- Находки: **L1** `GET /matches/:id/seats` без авторизации (состав мест, фракции, старт); **L2** дубликаты WS на один join-токен (параллельная сессия одного места; = W-1); **I3** build version + `Via: Caddy`; **I4** register login-existence.

## Сводка статусов по обоим стендам

| Контур | Результат |
| --- | --- |
| Auth/JWT/WS handshake | отклоняют все подмены; соответствует отчёту 14.10 |
| Fog of war | серверный, в проверенных парах не утечён |
| Authorization (corps/seat/archive) | эскалаций не найдено |
| Экономика: валидация | негативная валидация zod держит все перегибы amount/price |
| Экономика: гонки | **не подтверждены и не исключены** (W-2 needs follow-up) |
| Мультисессия места | воспроизводится в обоих контурах → W-1 = prod Finding 2, single-peer enforcement absent |
| Метрики/инфраструктура | не экспонированы; только 22/80/443 в prod |

## Рекомендации (дополнение к разделу 5 отчёта 14.10)

1. **P2 / W-1**: single-peer-per-player в `MatchRoom` (kick старшего сокета + notify) или задокументировать by-design; сверить wiring с build `81715959`.
2. **Follow-up / W-2**: воспроизводимый прогон экономического take в live-матче с наблюдением после settle; затем вывод про race-condition с протоколом замера (продукт — до или после исполнения).
3. **W-4**: индивидуальный отзыв сессии (совместно с V-5 приёмкой из 14.10).
4. Аккаунты `sectest_*` локального контейнера удалить после проверки зависимостей (включая `corp_arsenal_rent`/`corp_members` записи от `sectest_bravo`).