# Первый запуск наблюдаемости на игровом VPS — 2026-10-18

Выполнен по запросу владельца: основа мониторинга и браузерный HTTPS-вход
с клиентским сертификатом, затем отдельным Viewer password. [Runbook](../../deploy/observability/VPS.md).
Это on-host bootstrap, не полный OBS-1.2/1.3/4.1 и не измерение ёмкости матчей.

## Реальный контур

- Игровой VPS:4vCPU/5.78GiB RAM; мониторинг на том же хосте. Public hostname:
  `monitor.77-221-140-87.sslip.io`, настоящий публично доверенный HTTPS сертификат.
- Grafana13.2.4, Prometheus3.13.4, Loki3.7.8, Alloy1.20.1 — существующие digest pins
  OBS-0.2. Loki не принимает Game logs, datasource/ingest не включены.
- Root-owned ops snapshot `/opt/moongame-ops/deploy` независим от Game release
  symlink. Стек и guard — systemd; collector — отдельный `moon-observer`,64MiB,
  0.1CPU, без Docker group. Bearer передаётся через LoadCredential/private0600 copy.
- Разрешённые host/Game scalar metrics → atomic textfile → readonly Alloy mount →
  внутренний Prometheus → provisioned dashboard. Сеть Game, SQL и raw journal
  collector не использует. Target labels playtest/game-1/observer проверены.
- Readiness Game проверяет подключение к store; это не отдельная DB диагностика.
- Проверка завершена в 2026-10-18T09:17:06.734328+00:00, Game build `a9fbcba93ced`;
  live registry9комнат. Рабочая нагрузка почти отсутствует; capacity не оценивалась.

## Доступ и отказные проверки

| Сценарий | Наблюдение |
| --- | --- |
| Нет client certificate | TLS отказ, HTTP ответ не получен |
| Чужой self-signed certificate | TLS отказ |
| Правильный certificate | `/api/health`200 |
| Certificate без Grafana login | `/api/user`401 |
| Поддельные identity headers |401, вход не появился |
| SNI игры + Host пульта |421 |
| Viewer `/api/org/users` |403 |
| Viewer datasource write/admin-delete |403 |
| Session login после restart |200, роль Viewer, Secure+HttpOnly cookie |
| Dashboard/users после stop/up | Сохранены; свежие9комнат снова читаются |
| Collector остановлен61.7s | Producer age75.3s; игровой panel query пустой |
| OBS остановлен целиком | Game `/ready`200, его container ID/startedAt не изменились |

После всех проб четыре monitoring containers healthy, OOM=false; observer,
stack unit и guard timer активны. Host policy Caddy (включая запрет создания
игроками сессий и закрытые `/metrics*`) сохранена; сеть observability закреплена
в постоянном COMPOSE_EXTRA_FILE, не только `docker network connect`.
Смена TLS policy проверена `caddy validate` и выполнена reload, без команды
перезапуска Game. Во время работ независимый штатный autoupdate также обновлял
Game/Caddy; это не выдано за непрерывность одного build на всём интервале.

## Лимиты и ограничения доказательств

При первом старте исходные256MiB Grafana/128MiB Alloy и0.25CPU были слишком
тесным профилем: готовность в исходный deadline не достигнута. Финальный профиль:
Grafana512MiB/1CPU, Prometheus384MiB/0.25CPU, Loki384MiB/0.25CPU,
Alloy256MiB/0.5CPU; GOMAXPROCS=1 и bounded Go memory для Grafana/Alloy.
Четыре RAM caps суммарно1536MiB, с observer1600MiB. Это пределы, не постоянный
расход. AverageCPU<0.5core и24h soak ещё не доказаны.

На этой Docker-конфигурации host TCP3000 не слушает; успешный доступ подтверждён
через Caddy/internal network и mTLS, а не выдан за работающий SSH loopback tunnel.
Прямые9090/3100/12345 и Game8788 из интернета не публикуются.
Сертификат клиента действителен90дней; личный `.p12` и инструкция с credentials
сохранены root-only на VPS, не включены в Git/отчёт. Отзыв — rotation CA + reload
и negative probe старого сертификата; публичной выдачи private key нет.

HTTP/TLS/session/datasource проверки прошли. Визуальный Chromium smoke не выполнен:
у установленного headless shell нет `libatk-1.0.so.0`. Зависимости браузера на
игровой хост ради этой проверки не устанавливались. Внешняя сеть клиента и
импорт `.p12` на устройстве владельца требуют его первого входа.

DB exporter, backup/restore markers, raw logs, per-match memory, histogram p95,
оконные alerts и внешний dead-man не настроены. При потере VPS пропадёт и пульт;
этому профилю не приписана независимость мониторинга.

## Проверка кода

Новые fixtures проверяют host units, invalid вместо нулей, bounded atomic
publication, hostname injection/CA validation и обязательный verified mTLS site.
Compose/controller тесты и реальные on-host пробы приведены выше. Полный
`VITEST_MAX_WORKERS=2 pnpm run check` прошёл:12407 passed,135 skipped,1000files
(995passed/5skipped); lint/typecheck/docs-check зелёные. Локально отсутствуют
PostgreSQL test DSN, реальный test Caddy и age; это не выдано за их проверку.
Первый конкурентный прогон был остановлен после одного5s timeout в неизменённом
`data/scientistRescue.test.ts`; повтор с двумя workers прошёл полностью.
Нагрузочный/суточный прогон этим отчётом не подменяется.

Доводка по ревью PR1719: private token reader принимает полный алфавит
установщика, включая `: , @ %`, сохраняя bounds и запрет whitespace/control bytes.
Положительные и отрицательные fixtures добавлены; существующий токен VPS менять
не потребовалось. Обновлён только локальный observer, Game не перезапускался.
