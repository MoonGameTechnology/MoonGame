# 🚀 Void Dominion — Развертывание на Ubuntu Server

Полный пакет скриптов и документации для однокликовой установки игрового сервера на Ubuntu.

## 📖 Быстрый старт

### Вариант 1: Автоматическая установка (рекомендуется)

```bash
# На Ubuntu Server, от пользователя с sudo доступом:
sudo bash deploy/install-ubuntu.sh
```

**Это делает:**
- ✅ Установит Docker + Docker Compose
- ✅ Клонирует репозиторий в `/opt/moongame`
- ✅ Настроит systemd сервис для автозапуска
- ✅ Запустит сервер (2-3 минуты)

**Результат:**
```bash
moongame status      # проверить статус
moongame logs        # просмотреть логи
moongame update      # обновление (см. ниже: с VOID_IMAGE — с проверкой подписи)
```

### Вариант 2: Docker Compose вручную (как прежде)

```bash
cd deploy && docker compose up -d --build
```

Поднимает **два сервиса**:

| Сервис     | Назначение | Порт |
|-----------|-----------|------|
| `server` | Игровой сервер + WebSocket | `8788` |
| `postgres` | База данных (durable хранилище) | `127.0.0.1:5432` (только локально) |

## 📋 Переменные окружения

Все переменные в `server.env` (см. `server.env.example`):

| Переменная | Описание | Значение по умолчанию (compose) |
|-----------|---------|----------------------|
| `PORT` | Порт сервера | `8788` |
| `TIME_SCALE` | Ускорение времени (1 = реальное 24/7) | `24` — первая плейтест-сессия: 1 реальный час = 1 игровой день (SES-2.6) |
| `GATE` | Валидация action.v1-конвертов | `1` (релиз-постура) |
| `SEAT_LOCK` | Посадочные билеты (nick-режим) | `1` (релиз-постура) |
| `AUTH_JWT_SECRET` | Аккаунты (SES-2.5): register/login → session-JWT → join-токен; nick/ticket отклоняются | пусто = nick+ticket режим. **Под `PROD=1` обязателен и должен быть ≥32 символов** — короткий HS256-секрет подбирается офлайн по одному перехваченному токену |
| `ALLOWED_ORIGINS` | Origin-allowlist (через запятую) — защита от CSWSH: без него браузер откроет wss-сессию к серверу с чужой страницы | пусто = проверки нет. **Под `PROD=1` обязателен**; TLS-оверлей выводит его из `DOMAIN` автоматически |
| `ENTRY_WINDOW_MS` | Окно входа новичка от создания сессии (реальное время) | 4 дня |
| `AI_GRACE_MS` | ИИ-заместитель забирает брошенное кресло (реальное время) | 3 дня |
| `MATCHES` | Сколько сессий хостит процесс | `1` |
| `TEAMS` | `5v5` / `2v2`; пусто = FFA на 10 | пусто |
| `DATABASE_URL` | Строка подключения PostgreSQL | `postgres://void:…@postgres:5432/void` |
| `POSTGRES_PASSWORD` | Пароль БД | задайте свой |

Окна отсутствия (`AI_GRACE_MS`) и входа (`ENTRY_WINDOW_MS`) считаются РЕАЛЬНЫМ
временем независимо от `TIME_SCALE` — на ×24-сессии «ушедшим» всё равно считают
по реальным суткам. Полный игровой цикл (регистрация → лента → вход → игра)
включается одной переменной: задайте `AUTH_JWT_SECRET` (стабильный между
рестартами — иначе игроки перелогиниваются).

## 🛠️ Управление сервером (после автоустановки)

После запуска `install-ubuntu.sh` используй команду `moongame`:

```bash
moongame start      # запустить сервер
moongame stop       # остановить
moongame restart    # перезапустить
moongame status     # статус сервера
moongame logs       # просмотреть логи (реальное время)
moongame update     # обновление: проверка здоровья после рестарта + откат при провале
                    #   VOID_IMAGE=ghcr.io/moongametechnology/moongame@sha256:… moongame update
                    #   ↑ проверяемый путь: подпись проверяется ДО рестарта (гейт),
                    #     без неё обновление отменяется и сервер не трогается.
                    #   Без VOID_IMAGE — сборка на хосте: без скана и подписи.
moongame shell      # shell в директории проекта
```

## 🔄 Отказоустойчивость

- **Автоперезапуск**: systemd сервис `moongame` автоматически перезапускает контейнеры при краше
- **Durable-матчи**: состояние сохраняется в PostgreSQL → матч продолжается после рестарта
- **Healthchecks**: образ проверяет `/health` endpoint; сервер стартует только после здорового PostgreSQL
- **Автозапуск**: при перезагрузке сервера сервис запускается автоматически
- **Ограниченные логи**: логи ротируются (10MB×3) чтобы не переполнить диск

## 🌐 Внешний доступ

Для доступа через `94.190.83.220:95367` запусти:

```bash
sudo bash deploy/setup-proxy.sh
```

Это настроит Nginx проксирование с поддержкой WebSocket.

Или настрой Port Forwarding на роутере:
- Внешний порт: `95367 TCP`
- Внутренний IP: `192.168.1.7`
- Внутренний порт: `8788 TCP`

## 🔒 TLS / wss (RS-5.1)

Клиент сам выбирает `wss://`, когда страница открыта по `https` — нужно лишь дать
серверу TLS. Два пути:

### Нативный TLS (в самом сервере, без прокси)

Сервер слушает `wss://` сам, если заданы `TLS_KEY_FILE` + `TLS_CERT_FILE` (оба — или
ни одного; половинчатая настройка = ошибка старта, fail-secure, не тихий cleartext).

```bash
# 1) Выпустить сертификат на свой домен (пример — certbot standalone, порт 80 свободен):
sudo certbot certonly --standalone -d play.example.com

# 2) Положить цепочку в ./certs рядом с docker-compose.yml (монтируется в /certs :ro).
#    ВАЖНО — владелец: контейнер работает от non-root uid 65532, а certbot оставляет
#    privkey.pem как root:root 0600. Простой `cp` даёт файл, который сервер НЕ прочитает,
#    и старт упадёт на «половинчатой» TLS-настройке. Поэтому кладём с нужным владельцем:
mkdir -p deploy/certs
sudo install -o 65532 -g 65532 -m 0400 \
  /etc/letsencrypt/live/play.example.com/privkey.pem   deploy/certs/privkey.pem
sudo install -o 65532 -g 65532 -m 0444 \
  /etc/letsencrypt/live/play.example.com/fullchain.pem deploy/certs/fullchain.pem

# 3) Включить TLS и поднять стек:
cd deploy
TLS_KEY_FILE=/certs/privkey.pem TLS_CERT_FILE=/certs/fullchain.pem \
  docker compose up -d --build
```

Теперь транспорт зашифрован end-to-end (`wss://play.example.com:8788/...`). Продление:
`certbot renew` → повторный **`install` с тем же владельцем 65532** (обычный `cp` вернёт
root:root 0600 и сервер перестанет стартовать после ближайшего рестарта) →
`docker compose restart server` (в cron).

### Реверс-прокси терминирует TLS (альтернатива)

Nginx/Caddy/Traefik перед сервером (`deploy/setup-proxy.sh` — заготовка Nginx под
WebSocket-upgrade; добавь `listen 443 ssl`, пути к сертам и редирект `80→443`). При
этом на сервере **не** ставь `TLS_*`, а поставь `TRUST_PROXY=1`, чтобы per-IP лимиты
видели реального клиента, а не прокси.

> **Стор-сборка (RS-1.2, `rustore-release-roadmap.md`):** для RuStore-APK финальная
> сборка обязана ходить только по `https/wss` — `cleartext:false` +
> `androidScheme:'https'` в capacitor-конфиге стор-профиля; dev/LAN-сборка остаётся на
> `ws://` для локальных тестов.
### 🔒 Публичный HTTPS / WSS через Caddy (HTTPS-2.1)

Для постоянного публичного сервера с настоящим TLS (а не туннелем) — Caddy перед
игровым сервером: авто-сертификат Let's Encrypt, авто-продление, `http→https`,
прозрачный `wss`. Игровой сервер при этом **не торчит наружу** (только Caddy на `:443`).

**Предусловие:** домен, чья DNS-запись `A`/`AAAA` указывает на этот хост (Caddy
подтверждает владение через `:80`/`:443`, прежде чем получить сертификат).

```bash
cd deploy
DOMAIN=play.example.com SERVER_BIND=127.0.0.1 \
  docker compose -f docker-compose.yml -f docker-compose.tls.yml up -d --build
```

- `DOMAIN` — публичный хостнейм (Caddy выпустит и будет продлевать сертификат сам).
- `SERVER_BIND=127.0.0.1` — плоский порт сервера слушает только loopback; Caddy ходит
  к нему по compose-сети (`server:8788`), наружу открыт лишь `:443`.
- Сертификаты живут в volume `caddy-data` — переживают рестарт/редеплой (без
  повторных обращений к Let's Encrypt и его rate-limit'ам).
- Проверка: `https://<домен>/health` отвечает `{"ok":true}`, клиент подключается по
  `wss://<домен>/matches/…`. Прямой `:8788` снаружи недоступен.

Отладка без реального домена — см. комментарии в `deploy/Caddyfile` (`tls internal` /
ACME-staging). Managed-край (Render/Cloudflare-туннель) уже даёт HTTPS без Caddy —
см. `docs/https-roadmap.md`.

## 📚 Документация

| Файл | Для кого | Время |
|------|----------|-------|
| **[QUICK-START.md](QUICK-START.md)** | Я спешу | 5 мин |
| **[INSTALLATION.md](INSTALLATION.md)** | Я хочу все понять | 15 мин |
| **[README-UBUNTU.md](README-UBUNTU.md)** | Мне нужна справка | справочник |

## 🔍 Статус и логи

```bash
# Автоустановка
moongame status                    # статус сервера
moongame logs                      # логи (реальное время)
moongame logs | tail -50           # последние 50 строк

# Docker Compose (вручную)
docker compose ps                  # состояние контейнеров
docker compose logs -f server      # логи сервера
curl -s http://127.0.0.1:8788/health  # проверка здоровья
```

## 🛠️ Отладка и восстановление

### Если сервер не запускается

```bash
# 1. Проверь логи
moongame logs | head -50

# 2. Проверь статус Docker
docker ps -a | grep moongame

# 3. Попробуй перезапустить
moongame restart

# 4. Если проблема продолжается
sudo journalctl -u moongame -n 100
```

### Замок мест (SEAT_LOCK) — восстановление (NETA2-10)

Если игрок потерял билет (почистил localStorage / сменил устройство) — вечный 401 без
переиздания не грозит, но **самообслуживания намеренно нет**: nick+ticket — ЕДИНСТВЕННАЯ
личность на этом (безаккаунтном) пути, так что несанкционированный сброс = кража чужого
места (ровно то, от чего замок защищает). Сброс — **действие оператора** (эта же психика
у `resetSeatTicket` в `AccountStore`, `store/types.ts`, покрыта тестами store-контракта —
эта команда бьёт ровно ту же строку):

```bash
# Сбросить билет места (следующий вход сминтит новый — тот же путь, что «место
# заявлено до появления замка»)
docker compose exec postgres psql -U void void \
  -c "UPDATE seats SET ticket_hash = NULL WHERE room='proto' AND nick='Имя';"

# Или полностью освободить место
# docker compose exec postgres psql -U void void \
#   -c "DELETE FROM seats WHERE room='proto' AND nick='Имя';"
```

**Важно:** не публикуй ссылки с `?ticket=` в access-логах реверс-прокси — это bearer-секрет.

### Выкатка, меняющая манифест модулей или данные — старые матчи не поднимутся

Загрузчик (`serverWiring.ts`) сверяет у каждого сохранённого матча два пина и
отказывается его поднимать при расхождении — это **штатное fail-secure поведение**,
а не поломка:

- `version.manifest` против `MODULE_MANIFEST_VERSION` (`scenario.ts`) — состав и
  порядок модулей есть контракт детерминизма (инвариант #6);
- `version.dataHash` против хеша задеплоенного `data/*.json` (MP-4).

Значит **любая правка `DEV_MODULES` или игровых данных обнуляет все незавершённые
матчи**. Матч с чужим пином молча пропадёт из ленты, но строка в БД останется
`status='ongoing'`, будет висеть в браузере матчей и занимать слот. После такой
выкатки закрой их:

```bash
docker compose exec -T postgres psql -U void void \
  -c "UPDATE matches SET status='ended' WHERE status='ongoing';"
```

Именно `UPDATE`, а не `DELETE`: на `match_id` ссылаются `receipts`, `seats` и
`ava_sessions` — удаление оставит их сиротами.

Если незавершённые матчи ценны — дай им доиграться ДО выкатки. Миграция снапшотов
(переписать `manifest`/`dataHash` в JSONB) обходит ровно тот предохранитель, ради
которого он поставлен: ядро уже другое, и реплей такого матча всё равно не
воспроизведётся.

## 💾 Бэкап и восстановление БД

```bash
# Экспорт БД
docker compose exec -T postgres pg_dump -U void void | gzip > void-$(date +%F).sql.gz

# Восстановление в чистый volume
docker compose down && docker volume rm deploy_void-pgdata
docker compose up -d postgres
gunzip -c void-2026-07-10.sql.gz | docker compose exec -T postgres psql -U void void
docker compose up -d --build
```

Автоматический бэкап (crontab):
```bash
# Ежедневно в 04:00
0 4 * * * cd /path/to/repo/deploy && docker compose exec -T postgres pg_dump -U void void | gzip > /backups/void-$(date +\%F).sql.gz
```

## 🔐 Деплой подписанного образа (SEC-13, рекомендуемый путь для прода)

`docker compose up --build` собирает образ **на хосте** — он получается из того же
Dockerfile, но это утверждение об исходниках, а не о байтах, которые поедут в прод: их
никто не сканировал и не подписывал. Рекомендуемый прод-путь — забрать образ, который
собрал и подписал CI.

Что гарантирует цепочка: `image.yml` на каждый пуш в `main` собирает образ, гоняет по
нему **блокирующий** Trivy (находка ⇒ пуша нет), кладёт в GHCR и подписывает
**дайджест** через keyless-cosign. Дайджест печатается в summary прогона.

```bash
# 1. Проверить подпись — это и есть гейт (exit≠0 ⇒ дальше не идти)
./deploy/verify-image.sh ghcr.io/moongametechnology/moongame@sha256:<digest>

# 2. Забрать ровно эти байты
docker pull ghcr.io/moongametechnology/moongame@sha256:<digest>

# 3. Поднять стек на них (--no-build обязателен: иначе compose пересоберёт локально
#    и молча выбросит проверенный образ)
cd deploy && VOID_IMAGE=ghcr.io/moongametechnology/moongame@sha256:<digest> \
  docker compose -f docker-compose.yml -f docker-compose.release.yml up -d --no-build

# публичный хост — добавить TLS-оверлей третьим -f:
#   -f docker-compose.yml -f docker-compose.tls.yml -f docker-compose.release.yml
```

Только по дайджесту, не по тегу: тег после проверки можно перевесить на другие байты —
`verify-image.sh` поэтому отказывается работать с тегом. Обновление = повторить те же
три шага с новым дайджестом (старый контейнер заменится).

## 🛡️ Хардненинг контейнеров — чек-лист при правке compose (SEC-12)

**Compose теперь сканируется — но не целиком, и чек-лист остаётся.** Trivy misconfig
умеет Dockerfile/k8s/terraform/cloudformation/helm/ARM, Docker Compose в список не
входит; этот пробел закрыт отдельным движком — джобой `kics` в `security.yml`
(информационной до триажа базовой линии). Два её ограничения и делают чек-лист живым
вторым слоем, а не рудиментом: KICS читает каждый файл **изолированно** и не понимает
мерж оверлеев, поэтому фрагментам `tls.yml`/`release.yml` он штатно ставит «нет
healthcheck / cap_drop / security_opt», хотя те лежат в базовом файле и сливаются в
рантайме; и про осознанные исключения ниже его правила не знают ничего. Проходить руками
при добавлении/правке сервиса:

- [ ] `security_opt: [no-new-privileges:true]` — процесс не получит привилегии через setuid;
- [ ] `cap_drop: [ALL]`, обратно — только доказанно нужное (`caddy` → `NET_BIND_SERVICE` под 80/443);
- [ ] `mem_limit` + `pids_limit` — утечка/форк-бомба упирается в стенку, а не в весь VPS;
- [ ] порт наружу только там, где это осознанно (`postgres` — `127.0.0.1`, не `0.0.0.0`);
- [ ] сторонний образ — по дайджесту (`image:tag@sha256:…`), пин записан в `docs/security/image-pinning.md`;
- [ ] секрет не имеет «рабочего» дефолта на **любом не-локальном** пути. Критерий — не
      «есть TLS-оверлей», а «этот путь ведёт наружу»: `POSTGRES_PASSWORD` обязателен
      (`:?`) и в `docker-compose.tls.yml`, и в `docker-compose.release.yml` — стек не
      поднимется без него. Базовый `docker-compose.yml` намеренно оставляет
      `${POSTGRES_PASSWORD:-void}` (локальный playtest должен подниматься одной
      командой), и безопасно это ровно до тех пор, пока каждый прод-путь перекрывает
      дефолт своим `:?`. **Заводишь новый прод-оверлей — перекрой его там же**, иначе
      база уедет в мир с паролем `void`.

Что осознанно **не** включено и почему:

- **`read_only: true` для `server`** — препятствие СНЯТО, но шаг ещё не сделан. Раньше
  `netserver.mjs` транспилировал сервер в `/app/packages/server/dist` на КАЖДОМ старте,
  и записываемая корневая ФС была неизбежна. Бандл теперь печётся при сборке образа
  (`prototype/bundle-netserver.mjs`), рантайм запускает готовый файл — стартовая запись
  в `/app` исчезла. Остался единственный писатель, `/app/playtest-logs` (JSONL матчей),
  и он закрывается томом или `tmpfs`. То есть `read_only: true` стал реалистичным
  следующим кирпичом, а не архитектурным тупиком. Пока не включён — не проверен на живом
  хосте. Образ и так работает от non-root (uid 65532) — это то, что дал бы `read_only`
  в основном.
- **`cap_drop: [ALL]` для `postgres`** — официальный энтрипойнт стартует от root
  (chown/initdb каталога данных) и только потом роняет привилегии до `postgres`.
  Урезание capabilities требует вернуть ровно `CHOWN`, `DAC_OVERRIDE`, `FOWNER`,
  `SETUID`, `SETGID`, и ошибка в наборе ломает БД на следующем рестарте. Включать
  осознанно и **сперва на тестовом хосте**:

  ```yaml
  postgres:
    cap_drop: [ALL]
    cap_add: [CHOWN, DAC_OVERRIDE, FOWNER, SETUID, SETGID]
  ```

  Проверка: `docker compose down && docker compose up -d`, затем `moongame status` —
  контейнер `healthy` (энтрипойнт делает chown только на существующем томе, поэтому
  рестарт со **старым** томом — не полная проверка; честная проверка — на чистом томе).

## 🔗 Альтернативные пути развертывания

### Docker Compose вручную (как раньше)

```bash
cd deploy && docker compose up -d --build
```

### Без Docker (tmux на VPS) — legacy

```bash
bash deploy/serve.sh
```

Требует:
- Node.js >= 20
- pnpm
- PostgreSQL (или используй `docker compose up -d postgres`)
- Конфиг: `deploy/server.env` (см. `server.env.example`)

## 📊 Известные границы

- **Один процесс**: мульти-процессное масштабирование (pg-boss) — будущий этап
- **TLS**: нативно — `TLS_KEY_FILE`/`TLS_CERT_FILE` → сервер слушает `wss://` сам (RS-5.1); либо реверс-прокси (Nginx/Traefik/Caddy) перед `8788`. См. раздел «TLS / wss» выше.
- **Один хост**: отказоустойчивость = автоперезапуск + durable-резюме (не горячий резерв)

## 📞 Помощь и дальнейшее

1. Прочитай **[QUICK-START.md](QUICK-START.md)** (5 мин)
2. Полное руководство: **[INSTALLATION.md](INSTALLATION.md)** (15 мин)
3. Все вопросы: **[README-UBUNTU.md](README-UBUNTU.md)** (справочник)
4. Проблемы: `moongame logs` и `sudo journalctl -u moongame -n 100`

---

**Готово!** Запусти:
```bash
sudo bash deploy/install-ubuntu.sh
```
