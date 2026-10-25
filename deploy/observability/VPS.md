# Первый VPS: закрытый пульт в браузере

Opt-in продолжение [bootstrap](README.md), по явному выбору владельца:
HTTPS с клиентским сертификатом и отдельным паролем Grafana. Это доступ к
агрегатам; игровые журналы, персональные данные и GameState сюда не передаются.
Внешние уведомления и backup остаются `not_configured`.

## Сбор без сетевого доступа к bearer

`observer.mjs` переиспользует `createExporter().scrape()` из OBS-1.1: четыре
фиксированных loopback URL, тот же allowlist, deadlines и правила reset. Каждые
15 секунд добавляет CPU counters из `os.cpus()` (миллисекунды → секунды),
MemTotal/MemAvailable из `/proc/meminfo`, load1 и bytes/inodes корневой FS.
Никакого чтения SQL, `/metrics/recent`, environment или Docker API.

Один файл `host.prom` заменяется через exclusive temporary + rename, ≤1MiB;
последовательный цикл не копит задания. Отказ источника даёт `source_up=0` и
отсутствующие значения; отказ записи/host sample оставляет старый producer
timestamp. Dashboard скрывает значения старше 45 секунд, а свежесть показывает
и при устаревании. Простой сборщика не превращается в зелёное состояние игры.

Alloy использует только встроенный textfile collector (`set_collectors`),
read-only mount `/run/moongame-metrics`; host `/proc`, секрет и Docker socket
в контейнер не монтируются. Prometheus опрашивает внутренний component endpoint
Alloy. Пустой bootstrap-каталог не содержит `*.prom` и даёт «нет данных».
Отдельный порт exporter в этой топологии вообще не открывается.

Установка для штатного VPS, root:

1. Скопировать принятый `deploy/` в постоянный root-owned `/opt/moongame-ops/deploy`.
   Это отдельная версия ops-конфигурации, не переключаемая Game autoupdate.
   Не включать `server.env`/migration env в копию. Использовать физический путь
   к JS entrypoint: Node разрешает symlink до проверки `import.meta.url`.
2. Создать системного `moon-observer` без shell и групп Docker. Записать только
   отдельный `METRICS_READER_TOKEN` в root0600 `/etc/moongame-observability/game-token`
   и защищённый env Game. Полный `METRICS_TOKEN` observer не получает; при переходе
   со старой установки его также ротируют ([проверка](GAME-EXPORTER.md)).
   Не копировать туда весь env и не передавать значение в argv/stdout.
3. Установить `moongame-observer.service`. `LoadCredential` передаёт ключ юниту;
   приватная копия в RuntimeDirectory имеет0600 (systemd credential может иметь
   0440, который строгий reader OBS-1.1 обоснованно отвергает). StateDirectory
   `/var/lib/moongame-metrics`0755 содержит только разрешённый numeric stream.
4. Выполнить `stack.mjs init --admin-user PERSONAL_ADMIN`, установить guard
   service/timer из README, адаптировав Docker unit и физический ops path.
   До запуска подтвердить успешный guard, активный timer и ≥12GiB free.
5. Передать контроллеру три несекретные переменные из отдельного root0600 файла:
   `OBS_METRICS_DIR=/var/lib/moongame-metrics`,
   `OBS_GRAFANA_ROOT_URL=https://MONITOR_HOST/`,
   `OBS_GRAFANA_COOKIE_SECURE=true`. Запустить `stack.mjs up` и закрепить
   oneshot systemd unit с `RemainAfterExit`, `ExecStop=… stack.mjs stop`.

Observer ограничен64MiB/0.1CPU/32tasks, доступом только к localhost и записью
в собственные runtime/state dirs. Стек сохраняет отдельные caps/guard OBS-0.2.
При ротации Game bearer заменить root-файл и перезапустить только observer.

## Контейнеры: фиксированный host timer

`container-observer.mjs` — доверенное root-задание на хосте, не часть Grafana/Alloy
и не HTTP-служба. Через локальный Unix socket выполняет только `docker container ls`
и `docker container inspect --format` для семи фиксированных имён Compose:
`deploy-server-1`, `deploy-postgres-1`, `deploy-caddy-1` и четырёх `deploy-obs-*-1`.
Проекция inspect содержит только ID/PID для локального cgroup lookup, state,
health, RestartCount, OOMKilled и StartedAt. ID/PID и физические имена не
публикуются. Env, labels, команды, logs и mount paths не запрашиваются в проекции.
Docker root socket остаётся привилегией доверенного host job, не sandbox;
скомпрометированный root-код способен обойти собственный allowlist. Не выдавать
этот socket или право редактирования кода пользовательскому/наблюдательному сервису.

Поддержаны rootful Docker cgroup v2 layouts `/system.slice/docker-ID.scope` и
`/docker/ID`; PID/cgroup сверяются, а после чтения проверяется та же эпоха запуска.
Из cgroup читаются CPU seconds/throttling, memory.current/max/stat/events. В панели
различаются вся charged memory (включая кэш) и working set (current минус
inactive_file, как в Docker CLI). Высокая charged memory из-за кэша сама по себе
не доказывает нехватку RAM. `memory.events max` показывает попытки превысить лимит;
OOM-kill — отдельный counter. Нулевой лимит означает unlimited, не нулевую ёмкость:
процент без лимита не строится. CPU rate в ядрах:1 = одно полностью занятое ядро;
процент относительно quota при отсутствии quota недоступен.

Для установки после host observer:

```bash
install -m 0644 /opt/moongame-ops/deploy/observability/moongame-container-observer.{service,timer} /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now moongame-container-observer.timer
systemctl start moongame-container-observer.service
```

Код и ops-каталог должны принадлежать root; `/var/lib/moongame-metrics` создаёт
существующий host observer. Job имеет96MiB/0.2CPU/64tasks, timeout30s и только
AF_UNIX. Каждый Docker вызов ограничен1500ms/64KiB, вызовы последовательны,
сборы не перекрываются. `containers.prom` ≤64KiB заменяется атомарно, Alloy читает
его через существующий readonly mount. Новых портов и контейнеров нет.

Dashboard `moongame-containers` (ссылка из `moongame-overview`) содержит17 панелей.
Есть отдельные source_up, present и resources_up: отказ Docker не равен отсутствию
контейнера; отсутствие healthcheck не зелёный health; остановленный контейнер не
получает выдуманное нулевое потребление. Timestamp независим от host observer;
при возрасте≥45s текущие значения скрываются, возраст остаётся виден.
RestartCount — автоматические рестарты Docker за жизнь текущего контейнера,
не журнал всех ручных рестартов. StartedAt дополняет его; пересоздание обнуляет
cgroup counters, `rate()` учитывает resets. История событий между15s выборками
и долговременный аудит пересозданий не реализованы.

Проверено на VPS2026-10-18: семь источников/ресурсов доступны,17 PromQL queries
успешны; пауза producer46.8s скрыла состояния, возобновление вернуло семь строк,
Game ready оставался200. Один успешный job: peak около26MiB, CPU около0.64s;
это точечный замер, не24h/on-off soak. Fixture tests проверяют missing/ошибку
Docker, cgroup failure, остановку/пересоздание/reset и numeric/label allowlists.
Графический Android/browser smoke отдельно не выполнен.

Grafana Alerting поддерживает правила, no-data/error policy, contact points и
маршрутизацию уведомлений. Настройка выполняется отдельным Admin; обычный Viewer
наблюдает. Этот шаг не создаёт rules/contact points и не отправляет сообщений.
Внешний dead-man нужен отдельно, чтобы видеть полную потерю этого VPS.

## Вход через HTTPS

Используется существующий подписанный Caddy, отдельный hostname. DNS должен
вести на VPS; бесплатное имя `monitor.IP-WITH-DASHES.sslip.io` подходит при
успешной публичной ACME-проверке. Не использовать HTTP для входа.

Root создаёт отдельную CA (CA:TRUE/keyCertSign) и персональный клиентский
сертификат (CA:FALSE/digitalSignature/clientAuth,90дней). CA private key защищён
паролем и не монтируется в Caddy. Клиентский PKCS#12 `.p12` защищён отдельным
случайным паролем. `monitoringSite(hostname, caPem)` из `https-ingress.mjs`
формирует site с `require_and_verify` и inline public CA. В proxy удалены
пользовательские identity headers; Grafana auth-proxy/JWT выключены.

Caddy получает доступ к `deploy_observability` через постоянный host
`COMPOSE_EXTRA_FILE`: сохранить существующую Caddyfile policy, добавить Caddy
сети `[default, observability]`, определить `observability` как external с
`name: deploy_observability`. Не менять Game/БД и их volumes. До следующего
релиза можно подключить работающий Caddy через `docker network connect`.

Сначала сохранить обе старые конфигурации, проверить candidate командой
`caddy validate`, затем reload. Файл, уже bind-mounted в Caddy, обновлять с
сохранением inode; atomic rename сам по себе не обновит старый file mount.
Изменение host policy сериализовать штатным `autoupdate.lock`. Caddy включает
strict SNI/Host при client auth; проверить отдельно SNI игры + Host пульта.
Никаких proxy routes к Prometheus/Loki/Alloy/Game metrics не добавлять.

Через локальный Grafana admin API создать отдельного персонального Viewer,
проверить403 на admin API, provisioned dashboard и Prometheus datasource.
Bootstrap Admin хранить отдельно; не передавать его для обычного наблюдения.
Успешный HTTPS handshake с сертификатом **не заменяет** вход в Grafana.

Оператор забирает `.p12` через свой SSH/SCP, импортирует в личное хранилище
сертификатов браузера/ОС (не в доверенные корневые CA), затем открывает hostname
и входит своим Viewer. Пароли не публикуются в PR/отчётах/чатах. На VPS путь
к клиентскому комплекту и инструкции остаются root-only.

Отзыв в этом первом профиле — замена CA и клиентского сертификата с validate +
reload и отрицательной проверкой старого сертификата. Не считать удаление
локального `.p12` отзывом. До истечения90дней выпустить новый комплект.

## Проверка и границы

Проверить: certificate absent/wrong/expired → TLS отказ; правильный сертификат
без Grafana session → login/401; spoofed identity headers →401; Viewer admin→403;
datasource write→отказ. Источники показывают настоящий build/число комнат,
затем проверяются stale producer и восстановление без остановки Game.
Stop/restart только OBS сохраняет Grafana dashboard/users/TSDB; `/ready` игры
должен оставаться успешным. На ребуте Docker restart policies восстанавливают
контейнеры, units — observer и guard; Game release не удаляет ops-конфигурацию.

Это первый обзор, не завершение OBS-1.2/1.3/4.1: нет отдельной DB monitoring
роли, backup/restore markers, оконных алертов/внешнего
dead-man, histogram p95, карточек партий и24h/on-off soak. Host RAM/CPU не
выдаются за расход конкретной комнаты. Отчёт реального запуска хранить отдельно.

Официальная конфигурация: [Caddy client auth](https://caddyserver.com/docs/caddyfile/directives/tls),
[Alloy textfile](https://grafana.com/docs/alloy/latest/reference/components/prometheus/prometheus.exporter.unix/).
