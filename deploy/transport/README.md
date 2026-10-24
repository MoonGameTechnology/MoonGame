# Проверяемый внутренний TLS

Профили включают native HTTPS приложения и PostgreSQL TLS с `verify-full`,
разделяют сети прокси и БД и сохраняют настройки при перезапуске/автодеплое.
Это дополнительный операторский слой для существующей установки с подписанными
образами. Шифрование диска и независимое резервное копирование настраиваются отдельно.

## Профиль и ключи

Нужны root, Python 3, OpenSSL, Docker Compose >=2.30. Конфигурация и PKI находятся
вне checkout и образов: `/var/lib/moongame-transport` — root:root 0700,
`profiles/*.json` — root:root 0600. Не храните реальные профили/ключи в Git.

Скопируйте `profile.example.json` в `profiles/prod.json`, проверьте имена сервисов,
контейнеров, UID и существующих сетей. Создайте отдельную `--internal` сеть для БД.
Приложение присоединяется к frontend и backend, PostgreSQL — только к backend.
Для Caddy задайте `proxy_networks`: список остальных frontend-сетей, которые надо
сохранить; backend БД в него включать нельзя. При его наличии Caddy получает только
frontend приложения и перечисленные сети.

```sh
python3 deploy/transport/pki.py prepare /var/lib/moongame-transport/profiles/prod.json
```

CA действует 10 лет, leaf-сертификаты — 90 дней, обновление начинается за 30 дней.
Ключ CA остаётся в `private/ca.key` на хосте, каталог 0700, ключ 0400.
В контейнер монтируется только каталог его leaf-сертификата с ключом 0400 нужного
UID и публичным CA. Публичный CA для Caddy копируется в его постоянный `/data/transport`;
leaf-каталоги имеют 0755 независимо от операторского umask, родитель PKI остаётся 0700.
Сгенерированный `caddy-upstream.txt` задаёт HTTPS, trust pool и проверяемое имя.
CA не ротируется автоматически: приближение истечения требует отдельной смены доверия.

`compose.yml` профиля применяется последним после обычных release/policy-оверлеев.
`COMPOSE_TRANSPORT_FILE` в root-защищённом `server.env` сохраняет этот порядок в
`stack.sh`. Задайте `DB_NETWORK`, `LOCAL_TLS_CA_FILE`, `TLS_CERT_FILE`,
`TLS_KEY_FILE`, `HEALTHCHECK_CA_FILE`, `HEALTHCHECK_TLS_SERVERNAME` соответственно
профилю. Локальный операторский probe проверяет CA и имя, без `curl -k`.
Мигратору передаётся публичный CA; для worker удаления нужны
`ERASURE_DOCKER_NETWORK` и `ERASURE_DB_TLS_CA_FILE`. Административные URL остаются
в отдельных защищённых env-файлах. В URL нельзя оставлять параметры, отменяющие TLS.

`activate.py` обслуживает существующую раскладку `/var/lib/moongame` с профилями
`prod` и `monitoring`. Без аргументов печатает план, `--apply` выполняет перенос:
проверяет preflight, сериализуется с автодеплоем, делает зашифрованный локальный
maintenance snapshot, сохраняет конфиги, останавливает приложение, меняет стек
на тех же image digests и проверяет `/health`, `/ready`, публичный HTTPS.
При ошибке возвращает прежние конфиги и стек; результат backup-preflight применяется
и к откату. Локальный maintenance key не заменяет независимый backup.
Скрипт не предназначен для повторного применения после успешного переноса.
Автодеплой отклоняет образы без `transport/version=1` до перезапуска.

Stage использует отдельный профиль с его service/container/UID, frontend и backend.
После переноса установите `stage.sh` как `/usr/local/bin/moongame-stage` и
обновляйте стенд через него: базовый Compose без последнего overlay возвращает HTTP.

## Мониторинг

`kind: "monitoring"` использует `app` для Grafana (UID 472), `db` для Prometheus
(65534), `extra_roles.alloy` (473), `extra_roles.loki` (10001). Для каждого нужны
`service`, `container`, `uid`, `dns: ["имя-сервиса", "localhost"]`; у Grafana
также `port: 3000`. Frontend отделён от внутренней `deploy_observability`.
Только Grafana соединяется с Caddy. HTTPS включён у всех четырёх сервисов;
datasource и scrape-конфиги проверяют CA/имя, неиспользуемый Loki gRPC слушает loopback.

Соберите статический probe без внешних Go-модулей:

```sh
docker build --output type=local,dest=/tmp/transport-probe deploy/transport
install -m 0755 /tmp/transport-probe/probe /var/lib/moongame-transport/bin/probe
```

`pki.py prepare` создаёт monitoring-overlay. Укажите его абсолютный путь в
`OBS_TRANSPORT_FILE` защищённого `/etc/moongame-observability/stack.env`;
`stack.mjs` читает его и при ручном вызове, и из systemd. Это не запускает сервисы.
Для observer скопируйте публичный CA приложения в доступный ему root-защищённый
каталог, задайте `GAME_METRICS_TLS_CA_FILE` и `GAME_METRICS_TLS_SERVERNAME` в drop-in
`moongame-observer.service`. Bearer остаётся в systemd credential, HTTPS направлен
только на числовой loopback и проверяет заданную identity.

## Продление и доступ пользователей хоста

Установите Python-модули из этого каталога в `/opt/moongame-ops/deploy/transport`,
оставив рядом исходные configs в `../observability`. Установите `renew.service`
как `moongame-transport-renew.service`, аналогично timer; включите timer.
Продление держит общий lock автодеплоя, перечитывает TLS PostgreSQL, перезапускает
работающие приложения/мониторинг и сохраняет остановленное состояние сервисов.
Необходимость применения хранится в защищённом `pending.json` до успешного
reload/restart: временная ошибка Docker не теряется после выпуска нового сертификата.

`host-access.py` фильтрует только host OUTPUT. Root сохраняет доступ, observer UID
получает app/metrics, остальные пользователи не могут обращаться к private subnets
и loopback-портам сервисов. Публичные 80/443 Caddy разрешены с учётом Docker DNAT.
Container FORWARD и SSH не меняются. Это не защита от root или доступа к Docker API.

Задайте root:root 0600 `/etc/moongame-transport/host-access.env`:

```dotenv
TRANSPORT_OBSERVER_UID=995
TRANSPORT_NETWORKS="deploy_default deploy_database moongame-bots-stage moongame-bots-database deploy_monitor_front deploy_observability"
```

Сверьте UID и сети с хостом. `--check --observer-uid UID NETWORK...` проверяет правила
через `iptables-restore --test`, без изменения firewall. Установите service/timer
с префиксом `moongame-`, включите их; правило обновляется после смены Docker IP.

Проверки после включения: успешные HTTPS health/ready и DB-запрос с `ssl=true`;
отказ plaintext, чужого CA и неверного имени; отсутствие у Caddy сети БД;
отказ DB TCP от обычного UID при сохранённом публичном HTTPS; свежие observer samples.
`loopback-request.test.mjs`, deploy-тесты и отдельные native monitoring-пробы проверяют
эти границы. Секреты, дампы и реальные данные проверок остаются вне Git.
