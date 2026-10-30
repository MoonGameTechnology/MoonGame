# Закрытый стек наблюдаемости — OBS-0.2

Opt-in Grafana OSS, Prometheus, Loki и Alloy для одного VPS.
[Игроки по дням и время онлайн](PLAYER-ACTIVITY.md) — отдельный provisioned экран.
[План](../../docs/playtest-observability-roadmap.md) и
[контракт](../../docs/observability-contract-v1.md) задают границы.
Это bootstrap-реализация; первый VPS может включить отдельный
[профиль HTTPS и host/Game wiring](VPS.md). По умолчанию Prometheus собирает
себя, Alloy и пустой textfile target; provisioned обзор показывает «нет данных»,
пока не включён host bridge. [Security экран и правила](../security/README.md) добавляют локальный audit/detector
и panel-only alerts. DB exporter, остальные алерты и нагрузочная приёмка —
следующие OBS-этапы. Alloy читает только числовой textfile stream, не файлы игры.
Loki datasource отсутствует до query-only границы OBS-2.1: `editable:false`
само по себе не запрещает запись через datasource proxy.

## Установка от root

Нужны Linux, Node ≥20, **локальный rootful Docker Engine ≥28**, Compose ≥2.24.4.
Remote Docker, rootless и userns-remap не поддерживаются. До Engine28 loopback
published ports могли быть доступны с того же L2. Checkout и конфиги должны
быть на хосте daemon. Пример ниже предполагает checkout `/opt/moongame`.
Несекретные конфиги `*.yml`/`config.alloy`/provisioning должны читаться UID
контейнеров (обычно 0644, каталоги 0755); это отдельно от приватных state/env/secret.

Обновите checkout до принятого PR. Env должен быть приватным обычным файлом 0600,
без hardlink, owner root или UID штатного сервисного аккаунта `moongame`.
По умолчанию используется `deploy/server.env`. Поддерживается только штатная
финальная ссылка этого пути на `/var/lib/moongame/server.env`; если checkout env
отсутствует в извлечённом release, выбирается тот же постоянный файл.
Произвольные symlink/чужие UID не принимаются. Явный `--env-file` задаёт реальный
абсолютный путь без ссылок. Контроллер передаёт его Compose, содержимое не печатает. Затем:

```bash
cd /opt/moongame
node deploy/observability/stack.mjs init --admin-user YOUR_PERSONAL_ADMIN_LOGIN
cp deploy/observability/moongame-observability-guard.service /etc/systemd/system/
cp deploy/observability/moongame-observability-guard.timer /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now moongame-observability-guard.timer
systemctl start moongame-observability-guard.service
systemctl status moongame-observability-guard.service --no-pager
node deploy/observability/stack.mjs up
node deploy/observability/stack.mjs status
```

**До установки unit** проверьте `command -v node`, путь checkout и `ExecStart`.
При custom `--state-dir`/`--env-file` нужны те же абсолютные пути в unit;
обновите `ReadWritePaths` при смене состояния. Проверяйте `systemctl cat` и результат
service: активность timer сама по себе не доказывает совпадение путей.
`up`/`restart` требуют активный timer и ≥12GiB свободного места; не снижайте резерв.

`init` создаёт `/var/lib/moongame-observability` (root0700), bind-каталоги с UID
контейнеров и случайный пароль `secrets/grafana_admin_password` (UID472,0400).
Root читает его приватно на сервере для первого входа. Пароль не попадает в
env/аргументы/stdout. Compose file secrets не меняют host UID: права задаёт init.
Повторный успешный init сохраняет пароль и metadata. При частичном сбое init
не перезаписывает helper/secret; требуется разбор причины с сохранением данных.

Контроллер запускает только четыре `obs-*` через `up --no-deps`, без сборки/обновления
Game. Сторонние образы pinned по digest и включены в CI Trivy/проверку свежести;
две effective Compose-комбинации добавлены в KICS. `verify-image.sh` проверяет
подписи наших Game/Caddy images, не upstream Grafana.

## Вход через Windows CMD

```cmd
ssh -N -L 127.0.0.1:3000:127.0.0.1:3000 root@SERVER_IP
```

Замените `SERVER_IP`, откройте `http://localhost:3000`, войдите персональным Admin.
Через Administration → Users создайте отдельные персональные Viewer.
Anonymous, self-signup, auth-proxy/JWT, public dashboards, snapshots и установка
плагинов отключены. Datasource разрешает только `obs-prometheus:9090`;
admin/lifecycle/write API Prometheus не включены. Grafana OSS login не является MFA.
3000 опубликован только на IPv4 loopback, 9090/3100/12345 не опубликованы.
Не добавляйте их в Caddy/firewall. Отдельный opt-in HTTPS ingress с клиентским
сертификатом и Grafana login описан в [VPS.md](VPS.md).

Смена bootstrap password файла **не меняет пароль существующей Grafana DB**.
Ротируйте через интерфейс учётной записи или поддерживаемый admin reset CLI;
проверьте вход новым паролем и отказ старого. Не удаляйте SQLite ради ротации.
Viewer не имеет административных операций; настройки делает отдельный Admin.

## Лимиты и остановка

| Service    | RAM cap |   CPU cap | Каталог / бюджет                     |
| ---------- | ------: | --------: | ------------------------------------ |
| Grafana    |  768MiB | 1.00 core | `grafana/`, 256MiB                   |
| Prometheus |  384MiB | 0.25 core | `prometheus/`, 2.5GiB; TSDB7d/1500MB |
| Loki       |  384MiB | 0.25 core | `loki/`, 2GiB; compactor72h          |
| Alloy      |  256MiB | 0.50 core | `alloy/`, 256MiB                     |

У каждого: non-root, read-only rootfs, capabilities dropped, no-new-privileges,
128PID, tmpfs16MiB, logs2×5MiB. Общий RAM cap1792MiB; средний CPU<0.5core
ещё требует замера. Контейнеры не получают Docker socket, DB credentials и тома Game.
Только доверенный root CLI и фиксированный host timer из [профиля VPS](VPS.md)
используют Docker; HTTP endpoint управления нет. С host/Game observer64MiB и
container timer96MiB текущий общий RAM cap1952MiB. Grafana768MiB оставляет
запас сверх Go heap target448MiB: прежние 512MiB давали reclaim stalls при загрузке UI.

Таймер каждые 60s измеряет `du -sb`/`statfs`: warning80%, stop90% бюджета,
<12GiB free или неизвестное измерение. Общий state budget6GiB. Приватный numeric
`guard-status.json` хранит результат. Это watchdog, **не filesystem hard quota**;
учитывайте интервал/скорость роста и WAL/head при приёмке. Guard ничего не удаляет
и не запускает сбор автоматически после освобождения места.

```bash
node deploy/observability/stack.mjs guard
node deploy/observability/stack.mjs stop
node deploy/observability/stack.mjs restart
```

`stop` находит только project=`deploy`/четыре разрешённых service по Docker labels
и останавливает валидированные полные container IDs, без env/Compose. Утрата env
не мешает emergency stop; guard при ошибке измерения использует тот же путь.
`restart` ожидает HTTP readiness перед успешным результатом.
`stop` сохраняет состояние, останавливает только четыре service. **Не используйте
`compose down`**: проект `deploy` общий с игрой. Game readiness не зависит от
мониторинга. После budget stop разберите причину/маркер, проверьте резерв, выполните
`up`. Не удаляйте активные TSDB/WAL/chunks или данные игры вручную для очистки.

Healthchecks проверяют живые HTTP endpoints. Для shell-free Loki `init` извлекает
статический BusyBox из того же pinned Prometheus image без запуска entrypoint:
root0555 helper, SHA256 в root0600 metadata. При бампе проверяйте новую установку,
probe и `PROBE_IMAGE`; не заменяйте helper непроверенным исполняемым файлом.

## Проверка и оставшаяся приёмка

```bash
umask 022
pnpm exec vitest run deploy/observability/stack.test.mjs deploy/observability/compose.test.mjs
node deploy/observability/smoke.mjs
```

Smoke требует Docker и свободный localhost:3000 в namespace daemon. Создаёт
отдельный проект `obs-smoke-*`; одноразовый root initializer монтирует только новый
fixture-каталог. Проверяет реальные readiness, UID/caps/mounts/port bindings,
anonymous/spoofed headers, write/snapshot API deny, Viewer403 и сохранение Viewer
после рестарта; Game Compose config сравнивает с базовым. API пробы идут через
curl в Grafana namespace: forwarding в managed cloud может жить отдельно от workspace.
Credentials идут через stdin curl, не argv/логи. Cleanup каждого ресурса независим,
Game volumes не удаляются. Приватный fixture остаётся в `/tmp` для диагностики.

Локальный smoke не доказывает внешний доступ на VPS. Перед rollout сохраните
baseline; проверьте реальный root CLI init, unit/timer paths, firewall/SSH tunnel,
остановку мониторинга при живой Game readiness, затем 24h/on-off soak по контракту.
Root/systemd rollout и ресурсная ёмкость VPS этой реализацией не объявлены принятыми.

## Лицензии и обновления

Upstream OSS без сторонних плагинов: Grafana/Loki — AGPLv3, Prometheus/Alloy —
Apache-2.0, извлекаемый BusyBox — GPLv2. Исходники/лицензии:
[Grafana](https://github.com/grafana/grafana), [Loki](https://github.com/grafana/loki),
[Prometheus](https://github.com/prometheus/prometheus), [Alloy](https://github.com/grafana/alloy),
[BusyBox](https://busybox.net/). При бампе проверьте release/лицензию, измените digest
в overlay и согласуйте `PROBE_IMAGE`, затем smoke, общий gate и CI scanners.
Новый tag не заменяет digest автоматически; свой image/plugin требует release policy.
