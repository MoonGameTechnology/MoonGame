# OBS-0.1 — пассивный baseline VPS, 16 октября 2026

Контракт и воспроизведение: [OBS-0.1 v1](../observability-contract-v1.md).
[Машинный отчёт](2026-10-16-obs-0-1-baseline.json), SHA-256
`fb2f3cca49d754513ce8f933ae13673be76eb7a54ea434ff85a57de29739611f`.

## Условия и происхождение

- UTC: **2026-10-16T15:46:08.423Z — 2026-10-16T15:48:08.381Z**, 9 samples, 15 с,
  120 с между первым и последним. CPU первого sample — null (warm-up), 8 полных интервалов.
- Collector SHA-256: `0354cdd85e4600afaed0cf8d6ceb8d5b3867f82a6bac086ee9c1da72070063ea`; его код ещё не был закоммичен,
  SHA checkout/base при замере: `1161bc2d0b3cd90c61352a3c5b93ba66858d1406`. SHA инструмента
  в JSON позволяет отличить его от checkout. В опубликованном collector добавлен
  только первый комментарий для ESLint (`/* global AbortSignal */`); hash capture
  воспроизводится через `tail -n +2 deploy/observability/baseline.mjs | sha256sum`. Запущенный Game сообщает **81715959**:
  версия checkout не выдаётся за версию действующего образа.
- Linux VPS: **4 logical CPU**, 5.78 GiB RAM,
  root filesystem 58.94 GiB. Swap отсутствует.
- Workload: **9 registry rooms, 0 WS connections** во всех samples; действий
  не наблюдалось; FPS/RTT в проекцию baseline не включены. Anonymous Available feed показал
  duel-1 ×3, ffa-4 ×2, team-2v2 ×2, team-3v3 ×2, всё **×24**.
  Feed не является полным административным списком: full/closed/ended комнаты
  могут отсутствовать. В этом замере его количество совпало с registry=9.
- Мониторинг ещё не установлен, автодеплой не активирован. Это контрольная точка
  перед их внедрением. Выполнялись только bounded GET/inspect и чтение /proc/statfs;
  нагрузочный тест, сборка, SQL и рестарт не запускались. Probe overhead включён
  в измерение; это не изолированный CPU benchmark.

## Результаты

| Показатель | Наблюдение |
| --- | --- |
| Средний / максимальный CPU busy хоста | 1.96% / 2.24% всей ёмкости 4 CPU |
| Минимум MemAvailable | 4.21 GiB |
| Минимум свободного root FS (bavail) | 43.44 GiB |
| Минимум свободных inode | 3,589,735 из 3,932,160 |
| health / ready / metrics / summary / feed | 9/9 успешных валидных ответов каждого источника |
| Game desync / dead letter / advance overflow | 0, 0, 0; новых событий за окно нет |
| Journal dropped / failed | 0 / 0 у обоих streams; counters не выросли |
| Telemetry | 7 batches / 14 events накоплено, activeInstalls=0; за окно без роста |
| Submit / broadcast p95 | Не измерены: нет samples и histogram buckets |
| Контейнеры | running=true, OOMKilled=false, restart count=0 у server/postgres/caddy во всех samples |

## Проверенные контейнеры

Image ID ниже — фактические байты локального Docker, **не утверждение о подписи
GHCR** и не digest-пара из release manifest. Во всех samples IDs и startedAt
сохранились. Caps: Game/PostgreSQL по 1 GiB, Caddy 512 MiB.

- server: `sha256:1c51618b04999a264193d85e6464403392114d54a78aeb680993c157d357e823`, startedAt `2026-10-16T15:09:10.538931834Z`.
- postgres: `sha256:721873c34ceb9f8d8fc265984940dc982404c105f19ad51be9fdc5970a6080ea`, startedAt `2026-10-16T13:27:00.407741494Z`.
- caddy: `sha256:a8d1d32cfaa5d7d5c57c1fb5b333f0966dce7ce74a4c5fd96d1274c06db01658`, startedAt `2026-10-16T13:46:53.827297791Z`.

## Что этот замер не подтверждает

Нет клиентов/приказов — нет оценки capacity, p95, задержек под нагрузкой, реакции
на desync и стоимости будущих collectors. Ресурсный запас достаточен для начала
контролируемой установки в заданных caps, но не доказывает пригодность 24/7:
нужны одинаковые on/off workloads и 24 ч soak из roadmap. Нельзя сравнивать CPU
этого окна с другой картой/образом/числом клиентов как эффект мониторинга.

Подробный DB health, IO, scheduler backlog, per-match live API и внешний backup
не измерены. Внешние бэкапы и уведомления отложены владельцем; локальная копия
для отката не выдаётся за независимый DR. Установка Grafana/TTL cleanup/Alloy
этим отчётом не выполнена. После перевода на signed-image/autodeploy или другого
образа нужен новый baseline; этот исторический файл не переписывать.
