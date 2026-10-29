# Изолированная приёмка Coraza

Это стенд для [аудита перед включением](../../../docs/security/waf-evaluation-2026-10-25.md),
не production-конфигурация. Ни один рабочий Dockerfile/compose его не импортирует.
Патч `connector.patch` меняет журналирование чувствительных данных и обработку
MaxBytesError в coraza-caddy 2.6.2; тесты upstream уточняют новый контракт журнала.

Нужны Linux, Docker, Python 3, Git, OpenSSL, curl с HTTP/2, Node, зависимости репозитория (`pnpm install`)
и установленный Playwright Chromium. Подготовка скачивает пиненные исходники/образы;
GHCR game image должен быть доступен Docker. На разработческой машине оставьте
примерно 6 GiB диска и 2 GiB свободной RAM. Сборка ограничена 1 CPU / 1536 MiB. Необязательный `WAF_BUILD_CACHE` задаёт каталог
общего Go cache (подкаталоги `go-cache` и `go-modules`); сертификаты и результаты
всегда создаются в новом `WAF_WORKDIR`.

```sh
export WAF_WORKDIR="$(mktemp -u -d /tmp/moongame-waf.XXXXXXXX)"
python3 deploy/caddy/waf-evaluation/prepare.py
WAF_BINARY=caddy-patched python3 deploy/caddy/waf-evaluation/probe.py
python3 deploy/caddy/waf-evaluation/game-probe.py
```

`prepare.py` атомарно создаёт отсутствующий каталог с правами 0700; существующий путь
отвергается. Не передавайте каталоги с рабочими ключами или данными. Тестовые ключи
создаются заново на два дня и никогда не коммитятся. Подготовка сама запускает Go-тесты
соединителя и четырёх пакетов движка. Команды выполняются последовательно: изменение
Docker-сетей другим тестом может дать Chromium `ERR_NETWORK_CHANGED`.

Во время probes создаются уникальная `--internal` сеть и контейнеры без опубликованных
портов, host network, Docker socket, production env и томов. CPU/RAM/PID/log/tmpfs
ограничены, rootfs read-only, capabilities сброшены, no-new-privileges включён.
Python/Chromium с хоста обращаются к приватному IP контейнера. При обычном завершении
и исключениях собственные контейнеры и сеть удаляются. SIGKILL/перезагрузка не дают
Python выполнить finally: оставшиеся объекты узнаются по уникальному префиксу
`moongame-waf-review-` / `moongame-waf-game-`; чужие/рабочие объекты трогать не нужно.

`probe.py` проверяет HTTP/1, HTTP/2, HTTP/3, TLS до backend, JSON/form/multipart/XML,
размеры, WS/WSS, приватность журналов, версии правил и ограниченную нагрузку.
`case.passed=true` у `*-boundary`, `*-outside-waf`, `*-gap` и DetectionOnly означает
**подтверждённую границу защиты**, а не блокировку атаки. Реальная блокировка дополнительно
проверяет, что запрос не дошёл до backend. Файл-only reload ожидаемо оставляет старое
правило; отдельно проверяется исправляющая смена inline revision.

`game-probe.py` поднимает точный игровой image digest релиза e1325d98 с памятью вместо
БД, с тестовой JWT-подписью, Origin allowlist, GATE и SEAT_LOCK. Браузер проходит
регистрацию/login/reward/join/order/rejoin. SPKI allowlist Chromium доверяет только
одноразовому сертификату стенда; глобальный ignoreHTTPSErrors не используется.
Сетевая матрица отдельно проверяет CA/имя сертификата и отказ при неверном имени.
Это не тест настоящего Android, БД или всех игровых механик.

Артефакты остаются только в `$WAF_WORKDIR`: `probe-results.json`, `game-results.json`,
`edge.log`, `game-edge.log`, `game-backend.log` и сборки. Даже синтетические журналы
не предназначены для публикации: сохраняйте только очищенные результаты проверок.
Каталог можно удалить после чтения результатов, когда probes завершились.

CRS получен по pinned commit e03a4f6dabc7a30ebd8c52c97d28a154f590a48f и SHA-256
bdd0dec65d47fcae5aaa48aa681e0f4c151a8c1d9eb3040f6f65ebb8b2273c75. GitHub показывает
подпись тега v4.30.0 как valid. Это не локальная GPG-проверка release tarball:
публичный security.asc подписывает релизные архивы, а тег подписан другим ключом.
Исходники engine/connector проверяются по tag + точному commit, Go-зависимости — SumDB.
