# OBS-0.1 — контракт пульта и профиль первого VPS

Решение 2026-10-16 для [пульта плейтестов](playtest-observability-roadmap.md).
Контракт v1 принят в рамках реализации OBS-0.1; схема источников сверена с `main`
`1161bc2d`. OBS-1.1 добавил локальный Game exporter, а OBS-0.2 —
[закрытый bootstrap стек](../deploy/observability/README.md) с проверенным локальным
provisioning. Это не утверждение о rollout на VPS, node/DB exporters, сборе логов
или очистке. Изменение значения/единиц существующего
поля требует новой версии контракта; добавление метрик допускается через allowlist.

## Принятый профиль и экраны

Один VPS, отдельные процессы/тома/лимиты мониторинга. Исходный доступ —
SSH-туннель к Grafana на loopback. Дополнение владельца2026-10-18:
[профиль первого VPS](../deploy/observability/VPS.md) допускает отдельный HTTPS
site с обязательным клиентским сертификатом и персональным Grafana login;
Prometheus/Loki/Alloy и Game metrics наружу не публикуются.
Владелец явно выбрал **уведомления только в закрытом пульте**, без внешних
сообщений. Contact point и внешний dead-man отложены: отсутствие всего VPS
таким контуром не обнаруживается снаружи. Не записывать фиктивный успешный test-send.
Независимые бэкапы отложены владельцем отдельно; их состояние — `not_configured`,
а не success. Это не разрешение ослаблять проверку запуска production-образов.

| Экран первого выпуска | Минимальное содержание | Явно отсутствует в v1 |
| --- | --- | --- |
| Обзор | liveness, readiness, версия, registry rooms, WS connections, freshness, активные правила | Карта зависимостей невключённых сервисов |
| Сервер | CPU, MemAvailable, FS bytes/inodes, OOM/restart, доступность БД | SQL-тексты, игровые таблицы, персональные данные |
| Связь/ошибки | принятые/отклонённые действия, desync/dead-letter/overflow, count/avg/max submit/broadcast, RTT/FPS samples | p95 без buckets, группировка произвольных crash stack |
| Поведение | статус приёмника и качество данных; после OBS-2.2 агрегатная воронка/D1 | Raw events, D7/D30, утверждение install=человек |
| Партии | общее количество комнат registry и соединений | Карточки/поиск по matchId до OBS-3.1 |

`not_implemented`, `not_configured`, `no_samples`, `stale`, `error` и измеренный
ноль — разные состояния. До включения очищенного technical stream поиск логов показывает
`not_implemented`; создание пустого datasource не считается реализацией.

## Target matrix и границы доступа

Имена — стабильные логические service/instance, без IP/домена/имён людей.
Адреса ниже — target matrix: OBS-0.2 реализует только внутренние storage/service
порты и loopback Grafana, без Game/node/DB scrape и Loki datasource/ingest.
`/health` и `/ready` уже существуют у игрового хоста.

| Target / путь | Клиент и credential | Доступ / сеть | Период / timeout |
| --- | --- | --- | --- |
| Game `/health`, `/ready` | ограниченный Game exporter, без пользовательского токена | Внутренняя сеть; публичные probes сохраняют нынешний контракт | 15 с / default 1500 мс, cap 2 с |
| Game `/metrics`, `/metrics/summary`, `/metrics/activity` | Game exporter, host `METRICS_TOKEN` ≥32 символов | Внутренняя сеть; Caddy продолжает запрещать публичные `/metrics*` | 15 с / default 1500 мс, cap 2 с |
| Game `/metrics/recent`, `/metrics/health` | Не опрашивать в scrape | Первый читает raw файл целиком, второй содержит накопленные alert/max | Нет periodic scrape |
| Game exporter `:9108/metrics` | Prometheus | Только наблюдательная сеть, без host-port | 15 с / 2 с |
| node_exporter `:9100/metrics` | Prometheus, allowlist collectors | Хостовые числа без процессов/env/SSH/Docker socket в контейнере | 15 с / 2 с |
| DB exporter `:9187/metrics` | Prometheus; отдельная мониторинговая DB-роль | Только системные числа; без чтения игровых таблиц или SQL-текстов | 15 с / 2 с |
| Prometheus `:9090`, Loki `:3100`, Alloy `:12345` | Provisioned Grafana / ограниченный log writer | Только внутренняя сеть; write/read роли разделены | Нет публичных портов |
| Grafana `127.0.0.1:3000` | Индивидуальные операторские учётки, Viewer/Admin | SSH tunnel; anonymous/self-signup/snapshot sharing выключены | UI 15 с |
| Report worker / textfile markers | Фиксированный локальный job | Атомарные ограниченные агрегаты; не shell/SQL endpoint | 5 мин / 30 с |

Baseline CLI — **ручной доверенный host-инструмент**: Docker inspect разрешён
оператору, а не Grafana/exporter/Alloy. Он не запускается как HTTP-служба, не
выдаёт socket и не меняет контейнеры. Секрет читается только из приватного env-файла;
в аргументы запросов/логи/отчёт он не попадает. Redirect запрещён.

Текущий `METRICS_TOKEN` открывает также pre-fog `/metrics/recent`; allowlist
exporter не ограничивает похищенный credential. Это известная широкая привилегия
локального bootstrap. Перед переносом exporter с игрового VPS требуется отдельный
metrics-only scope и отрицательные проверки raw endpoints. Game JWT и DB-admin
не используются как credentials наблюдаемости. Публичный доступ требует отдельной
приёмки auth gateway/MFA; локальный Grafana login не выдаётся за MFA.

## Матрица полей, типов и единиц

Game Prometheus-имена ниже реализованы в standalone OBS-1.1; host/DB/backup и
будущие histogram/backlog включаются отдельными этапами. Baseline JSON хранит
разрешённую проекцию источников и остаётся отдельным инструментом. `G` — gauge,
`C` — monotonic process counter, `H` — будущая настоящая histogram.
Доступ для всех строк — только оператор через внутренний scrape.

| Поле → источник | Тип / единицы / labels | Свежесть и семантика |
| --- | --- | --- |
| `moongame_source_up{source}` → результат bounded fetch | G, 0/1; source из target matrix | Ошибка источника даёт 0 даже при `up=1` самого exporter |
| `moongame_source_last_success_timestamp_seconds{source}` → время успешного fetch | G, Unix seconds | До первого успеха отсутствует; timestamp не обновлять при ошибке |
| `moongame_build_info{version}` → `/health.version` | G=1, hex SHA 7–40 знаков | Один текущий build; отсутствие версии — unknown |
| `moongame_game_ready` → `/ready.ready` | G, 0/1 | 503 с `ready:false` — известная неготовность, не успех liveness |
| `moongame_matches`, `moongame_connections` → `/metrics.matches`, `.connections` | G, rooms / WS sockets | Rooms registry не равны активным боям; socket не равен человеку |
| `moongame_players_online` → `/metrics/activity.online` | G, уникальные аккаунты | Foreground heartbeat ≤70с; sockets не считаются игроками |
| `moongame_player_activity_{since,sample}_timestamp_seconds` → activity since/at | G, Unix seconds | Начало сбора и свежесть снимка; ms → s |
| `moongame_player_activity_daily_{players,visits,online_seconds}{day}` → activity.days | G, accounts / заходы / игроко-секунды | ≤30 суток UTC, union вкладок/устройств; текущий день неполный. [Семантика/retention](../deploy/observability/PLAYER-ACTIVITY.md) |
| `moongame_joins_total`, `moongame_leaves_total` → summary joins/leaves | C, events | За жизнь процесса, не за сутки |
| `moongame_actions_total{outcome}` → actions.ok/rejected | C, actions; outcome=`ok,rejected` | Сумма должна совпадать с actions.total; неизвестная схема — invalid |
| `moongame_action_types_total{type}` → actions.byType | C, actions; известные типы манифеста | Не создавать совместный outcome×type: источник не даёт cross-tab |
| `moongame_action_rejects_total{code}` → actions.rejectByCode | C, rejects; закрытый каталог E_* | Неизвестный код → other; code не содержит текст ошибки |
| `moongame_desyncs_total`, `_dead_letters_total`, `_advance_overflows_total` → summary | C, occurrences | Алерт на increase за окно; ненулевое старое значение не новый инцидент |
| `moongame_submit_duration_seconds_{sum,count}` → submitMs.total/count | C, seconds / samples | ms делятся на 1000; avg=sum/count при count>0 |
| `moongame_broadcast_duration_seconds_{sum,count}` → broadcastMs.total/count | C, seconds / samples | Та же эпоха sum/count; не делить на число игроков |
| `moongame_submit_duration_seconds_max`, broadcast max → SeriesStat.max | G, lifetime seconds | Накопленный max не является оконным max/p95; count=0 → no_samples |
| `moongame_delta_bytes_{sum,count,max}` → deltaBytes | C/C/G, bytes / samples / bytes | Размер одной per-player delta; без player labels |
| FPS/RTT `{sum,count,max}` → clientFps/clientRttMs | C/C/G, frames/s либо seconds | Выборочные клиентские наблюдения; null/no_samples не 0; RTT ms→s |
| `moongame_journal_{written,dropped,failed}_total{stream}` → journal.match/client | C, lines; stream=`match,client` | Написанная строка не подтверждает доставку в Loki |
| `moongame_telemetry_{batches,events,dropped_events,rejected,limited}_total` → telemetry | C, соответствующие events/requests | Приём != аналитический дедуп; не считать raw строки уникальными событиями |
| `moongame_active_installs` → telemetry.activeInstalls | G, browser installs | Скользящие 5 мин; не пользователи онлайн |
| `moongame_host_cpu_seconds_total{mode}` → host observer `os.cpus()` | C, seconds; mode=user/nice/sys/idle/irq | Сумма по CPU, ms→seconds; busy — отношение rates, не loadavg |
| `moongame_host_cpu_count`, `moongame_host_load1` → host observer | G, CPUs / runnable tasks | Весь VPS, не отдельный матч |
| `moongame_host_memory_{total,available}_bytes` → `/proc/meminfo` | G, bytes | Именно MemAvailable, не MemFree |
| `moongame_host_root_{size,available}_bytes`, `moongame_host_root_{inodes,free_inodes}` → `statfs('/')` | G, bytes / count | Root FS; IO пока не измеряется |
| `moongame_observer_sample_timestamp_seconds` → atomic textfile publication | G, Unix seconds | Dashboard скрывает данные при age≥45s; error сохраняет старый timestamp |
| `moongame_container_{source_up,present,resources_up}{container}` → fixed host timer | G,0/1; container=game/postgres/proxy/grafana/prometheus/loki/alloy | Ошибка Docker — source_up0, present отсутствует; absent — present0; cgroup failure — resources_up0 |
| `moongame_container_{state,health}{container}` → inspect projection | G, enum | state:0created/1running/2paused/3restarting/4exited/5dead/6removing; health:-1none/0unhealthy/1healthy/2starting |
| `moongame_container_{restart_count,oom_killed,started_timestamp_seconds}{container}` → inspect | G, count /0–1 /Unix seconds | RestartCount только automatic за жизнь текущего контейнера; не журнал ручных рестартов |
| `moongame_container_{memory_bytes,memory_working_set_bytes,memory_limit_bytes,cpu_limit_cores}{container}` → cgroup v2 | G, bytes /cores | current включает cache; working set=max(0,current-inactive_file); limit0=unlimited, процент не строится |
| `moongame_container_{cpu_seconds_total,cpu_throttled_seconds_total,memory_limit_hits_total,oom_kills_total}{container}` → cgroup v2 | C, seconds /events | Сброс при пересоздании; CPU rate относительно quota, не число матчей |
| `moongame_container_sample_timestamp_seconds` → atomic containers.prom | G, Unix seconds | Отдельный15s producer; age≥45s скрывает текущие значения, ошибка записи не обновляет timestamp |
| DB up/connections → ограниченный DB exporter | G, 0/1 / connections | Game ready проверяет только свой store, не заменяет весь DB health |
| backup/restore last success → независимые verified job markers | G, Unix seconds | Сейчас not_configured; наличие локального файла не даёт success |
| p95 submit/broadcast/RTT → H buckets в OBS-2.3 | H, seconds | Пока not_implemented; из avg/max/slow JSONL вычислять запрещено |
| per-match live/scheduler backlog → новый read-model / instrumentation | G, контракт следующего этапа | Пока not_implemented; не угадывать по общему summary |

Scrape/refresh — 15 с, stale через 45 с после последнего успеха. На ошибке
динамические игровые значения отсутствуют; прошлый успешный cache не выдаётся
за новый. Только один in-flight запрос на источник, без бесконечных retries;
существующий JSON response ≤64 KiB, будущая exposition ≤1 MiB и ≤5000 samples/target.
Unknown source field игнорируется; отсутствующее обязательное поле делает source
invalid. NaN, infinity, отрицательные counters, неверные типы не превращаются в 0.

Identity: environment=`playtest`, instance=`game-1`, service из target matrix.
Это конфигурация, не имя контейнера/хоста или PID. Экспортер копирует накопленные
counters источника; его рестарт не добавляет offsets и не обнуляет Game counters.
Рестарт Game допускает reset, `rate/increase` обрабатывают его; сумма count/sum
читается из одного ответа. Версия не равна эпохе: один SHA может рестартовать.
Текущий API не выдаёт process-start marker; baseline фиксирует Docker startedAt,
но exporter не получает socket ради него. Persisted summary и live counters
не суммируются; сравнение baseline с новым startedAt помечается reset/incomparable.

Labels только environment/instance/service/source/stream/outcome/type/code/version/le/mode/container/day;
на ряд разрешены только перечисленные для него значения. Бюджет всего стенда
≤25 000 active series, ≤256 известных action types и ≤64 reject codes (+other).
Никаких matchId/playerId/actor/install/session/IP/URL/query/текста исключения в labels.
`day` разрешён только трём `moongame_player_activity_daily_*`: ISO UTC date из
текущего 30-дневного окна, ≤30 значений на instance. Это не label игрока/сессии.
При исчерпании бюджета новые ряды отклоняются со счётчиком, не создаются бесконечно.

## Privacy, хранение и лимиты

В технический поток разрешены timestamp, уровень из enum, service/build/run,
код события, числовые durations/sizes/counts и технический match reference только
для разрешённого расследования в закрытом Loki (не Prometheus label). Baseline
не публикует даже этот reference: только группы карт и timeScale. Authorization,
cookies, password/reset URL, email, ник, IP, произвольные props/message/stack,
raw команды/GameState, экономика, флоты, winner/actor и pre-fog события запрещены.
Raw игровые JSONL не являются technical stream. До OBS-0.3/2.1 их не отправлять в Loki.

Профиль принят для следующей реализации lifecycle, **не включает очистку сейчас**:

| Хранилище / компонент | Принятый предел | Статус на OBS-0.1 |
| --- | --- | --- |
| Prometheus | 7 дней / retention.size 1.5 GB, volume budget 2.5 GiB с WAL/head | Не установлен |
| Loki | 72 ч, volume budget 2 GiB, compactor + byte watchdog | Не установлен |
| Raw JSONL | 7 UTC-дней или 1 GiB, что наступит раньше | Очистка/удаление субъекта — OBS-0.3; сейчас не исполняется |
| Derived product aggregates | Не дольше исходного 7-дневного окна; erase + пересчёт/checkpoint | Worker ещё не установлен; D1 после реализации, D7/D30 unavailable |
| Grafana / Alloy | State ≤256 MiB / positions+spool ≤256 MiB | Не установлены |
| RAM caps после первого VPS запуска | Grafana768, Prometheus384, Loki384, Alloy256, Game/node/DB exporter по64MiB, container timer96MiB | План2080MiB; текущий объединённый observer вместо трёх exporter —1952MiB. Report worker отдельно ≤256MiB |
| Monitoring CPU/disk | В среднем <0.5 core, диск ≤6 GiB; Game лимиты не уменьшать | Нужна on/off и 24 ч приёмка после установки |
| Запас хоста | ≥12 GiB свободно; local backup budget ≤8 GiB при его включении | Бэкапы отложены; не считать бюджет готовым backup |

Малые когорты/неполные UTC-окна показываются с n и качеством, не как ноль.
Внешнее хранение не включено; публичный HTTPS ingress допускается только отдельным
профилем выше с client certificate + login. TTL требует
удаления spool/derived copies и не заменяет права доступа или erasure.

## Локальный Game exporter — OBS-1.1

`node deploy/observability/game-exporter.mjs` слушает 127.0.0.1:9108; читает только
literal loopback пять Game routes. Ports настраиваются числом, URL/hostname не
принимаются. [Runbook](../deploy/observability/GAME-EXPORTER.md) описывает private
plain token file, bounded refresh и отсутствие автоматического Compose wiring.
Таблица target matrix выше сохраняет целевой сетевой профиль; текущий CLI не
включает его и не разрешает remote scrape с широким bootstrap credential.

Default source deadline — 1500 мс на headers+body, сохраняя 500 мс для ответа
exporter при consumer scrape deadline 2 с. Явный локальный `timeoutMs` override
ограничен прежним cap 2000 мс; будущий wiring обязан оставить запас между
фактическим source timeout и большим consumer deadline. Равные 2 с/2 с могут
скрыть `source_up=0` за timeout всего scrape. Это проверяют deterministic
fake-timer fixtures для зависших headers и body.

`moongame_client_fps_{sum,count,max}` и `moongame_client_rtt_seconds_{sum,count,max}`
— конкретные имена FPS/RTT. `moongame_exporter_rejected_series_total` считает
отклонённые неизвестные action rows при проекции (не события Game); keys не
сохраняются. Избранные действующие reject codes имеют статический каталог,
остальные numeric counts суммируются в `other`. Отсутствующие/невалидные
обязательные counters/series/maps или несогласованные action totals делают
summary invalid. Null client samples и отсутствующие необязательные
journal/telemetry не заменяются измеренным нулём; present-invalid optional поля
отвергаются.

Fixture + live production-bundle проверки закрывают OBS-1.1. Установка на VPS,
network wiring к Prometheus и ресурсная/24h приёмка этим не подтверждаются.

## Воспроизводимый baseline и приёмка

```bash
node deploy/observability/baseline.mjs \
  --env-file deploy/server.env \
  --out /tmp/obs-baseline.json --samples 9 --interval-ms 15000
```

Linux, Node >=20 и Docker CLI; `server.env` должен быть приватным обычным файлом
(mode 0600, root/текущий владелец), а не symlink. При перенесённом env укажите
реальный защищённый путь. CLI читает только фиксированные loopback :8788 routes и
inspect трёх `deploy-{server,postgres,caddy}-1`. Нет POST, чтения журналов, SQL,
рестартов или нагрузочного сценария. Это ручной инструмент, не постоянный collector.
Количество samples 2–40, интервал 1–60 с; body 64 KiB, HTTP timeout 2 с,
Docker/git timeout 3 с и maxBuffer 64 KiB. Output создаётся эксклюзивно с mode 0600;
ошибки наружу только E_OBS_*, без сырого HTTP/command stderr.

JSON записывает UTC samples, SHA инструмента, SHA checkout (не обязательно образа),
реальный image ID + startedAt каждого контейнера, доступную build version из health,
нагрузку по числу соединений/комнат и группам карта/timeScale, CPU/RAM/disk/inodes,
процессные counters и статус каждой проекции. Идентификаторы матчей и секреты
отбрасываются до сериализации. Положительный конечный числовой `timeScale`
сохраняется без неполного allowlist (включая ×100 и ×200); невалидный — null.
Отсутствующая/невалидная обязательная серия submit/broadcast/delta (`count/total/max`)
делает весь summary source invalid. Неподдерживаемые необязательные метрики перечислены явно.

Исходную версию collector для исторического замера можно восстановить из коммита
`02b8bc92d9c16e46723c985638191ffc485f909f` (PR #1691); команда из отчёта применяется
к этой версии, а не к последующим исправлениям collector. Новый запуск записывает
собственный SHA инструмента.

[Замер 2026-10-16](reviews/2026-10-16-obs-0-1-baseline.md) фиксирует реальные числа
и workload. Пассивный baseline без клиентов не определяет вместимость сервера,
p95, стоимость будущего мониторинга или SLO. Перед сравнением повторить тот же
workload, образ, карты/timeScale и профиль выборки. При смене образа/эпохи снять
новую контрольную точку; тяжёлые тесты/сборку во время замера не запускать.

OBS-0.1 закрыт наличием этого контракта, принятого UI-only/SSH/local профиля,
проверенного инструмента и честного on-host baseline. OBS-1.1 реализован выше;
OBS-0.2/0.3 и остальные этапы с внешними зависимостями этим не закрываются.
