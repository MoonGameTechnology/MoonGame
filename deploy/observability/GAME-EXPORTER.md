# OBS-1.1 — локальный Game exporter

Отдельный read-only процесс Node ≥20 на игровом Linux-хосте. Он преобразует
существующие JSON-источники в Prometheus exposition и не меняет Game, его
readiness или журнал; не получает DB credentials. Источник activity сам выполняет
свою retention-очистку в Game. Это локальный bootstrap; автоматическая установка
на VPS и подключение к контейнерному Prometheus сюда не входят.

```bash
node deploy/observability/game-exporter.mjs
curl --fail http://127.0.0.1:9108/metrics
```

Exporter слушает **только 127.0.0.1**, по умолчанию порт 9108. Он читает только
`http://127.0.0.1:8788/health`, `/ready`, `/metrics`, `/metrics/summary`, `/metrics/activity`.
`GAME_EXPORTER_PORT` и `GAME_EXPORTER_SOURCE_PORT` меняют только числовые порты
(1–65535). Настройки URL/hostname/public bind отсутствуют. `GET /health` проверяет
жизнь самого exporter, а `GET /metrics` обновляет источники. Иные пути, query и
методы получают 404; HTTP-ответы не кэшируются.

Direct-loopback Game не требует bearer. Если опубликованный Docker-порт приводит
запрос к Game через bridge и сервер отказывает операторскому доступу, задайте
`GAME_EXPORTER_TOKEN_FILE` — путь к **отдельному приватному обычному файлу**,
содержащему только действующий `METRICS_TOKEN`, без `KEY=`, кавычек или пробелов.
Допускается один завершающий LF; ключ — 32–4096 ASCII-символов из алфавита
установщика (`A-Z a-z 0-9 . _ + / = : , @ % -`) плюс ранее поддержанный `~`.
Пробелы/control bytes запрещены. Файл принадлежит
root/пользователю exporter и недоступен группе/остальным (0600); symlink/FIFO
отвергаются, чтение ограничено. Секрет не передаётся в аргументах, URL, метриках
или сообщениях об ошибке. После смены секрета перезапустите exporter.

Текущий `METRICS_TOKEN` разрешает также raw `/metrics/recent`. Поэтому source
остаётся literal loopback, redirect запрещён, credential отправляется только
трём фиксированным `/metrics`-путям. Не подключайте этот bootstrap к удалённому
Game и не публикуйте его через прокси. Для контейнерной/удалённой интеграции
нужен отдельный принятый transport и metrics-only credential с отрицательными
проверками raw endpoints; один allowlist самого collector не сужает украденный ключ.

Потребитель опрашивает exporter каждые 15 секунд. Каждый `GET /metrics` выполняет
пять запросов параллельно; конкурентные scrapes делят один in-flight refresh.
На источник: timeout по умолчанию 1500 мс, включая headers/body, ≤64 KiB JSON,
без retries. Это оставляет 500 мс для формирования/доставки ответа до принятого
scrape deadline потребителя 2 с: иначе timeout источника мог бы скрыть и сам
`source_up=0` за timeout всего exporter. Явный локальный API override `timeoutMs`
допускает максимум 2000 мс; при таком override будущий consumer должен получить
больший deadline с запасом. Одинаковые source/consumer deadlines недопустимы.
Exposition ограничена 5000 samples и 1 MiB. На ошибке конкретного источника
`moongame_source_up{source}` равен 0, его игровые значения отсутствуют, прежний
`moongame_source_last_success_timestamp_seconds` не меняется. До первого успеха
timestamp отсутствует. Stale через 45 с определяет потребитель; ноль, отсутствие
samples и неработающий source различаются. Остальные источники продолжают работать.

Counters копируются из одного текущего ответа без offsets: рестарт exporter
не обнуляет Game counters, рестарт Game виден как reset для `rate/increase`.
`503 /ready` с `ready:false` даёт известную неготовность, а не source failure.
Проверяются обязательные поля, конечность/знак/тип, action totals и суммы карт.
Неизвестные поля не сериализуются; повреждённая схема не заменяется нулями.

Статический каталог содержит shipping action handlers (включая серверные intents)
и выбранные действующие reject codes, проверенные parity-тестом. Неизвестные
action names отбрасываются; `moongame_exporter_rejected_series_total` считает
отклонённые строки при каждой успешной проекции, а не уникальные actions/имена.
Неизвестные reject codes суммируются в `code="other"`. Сам неизвестный ключ
никогда не выходит наружу. Общий размер каталога ограничен 256 types и 64 codes.

Имена/типы/единицы заданы в [контракте](../../docs/observability-contract-v1.md).
В частности, ms переводятся в seconds; `*_sum`/`*_count` — накопленные counters,
`*_max` — gauge за жизнь Game, а не оконный max/p95. При count=0 max отсутствует.
Null FPS/RTT не превращаются в ноль; выборочные client reports не подтверждают SLO.
Environment/instance/service задаются стабильными target labels потребителя
(`playtest`/`game-1`/`game`), а не IP/именами контейнеров. Exporter не читает
`/metrics/recent`, `/metrics/health`, GameState, persisted summaries или raw JSONL.

Проверки:

```bash
pnpm exec vitest run deploy/observability/game-exporter*.test.mjs
```

Fixtures проверяют privacy, schema drift, units, no-samples, caps, redirect,
timeout после headers, single-flight, stale и private secret. Fake-timer тесты
проверяют зависшие headers и body: `source_up=0` готов к 1500 мс, до 2-секундного
deadline потребителя. Live-тест собирает
тот же `prototype/netserver.ts → packages/server/dist/proto-server.mjs`, который
запускает Docker CMD: настоящий WebSocket join меняет gauges/counters, остановка
Game убирает значения, рестарты Game/exporter не создают двойного счёта.
Это локальная проверка без PostgreSQL и контейнеров, не on-host capacity/24h приёмка.

Суточные gauges, ограниченный date label и точность присутствия —
[активность игроков](PLAYER-ACTIVITY.md).
