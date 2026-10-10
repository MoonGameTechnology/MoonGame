#!/bin/bash
#
# Стек прода на ПОДПИСАННОМ образе — одна команда на всех, кто его поднимает (ZTP-1.2).
#
#   stack.sh up      — поднять стек на образе из точки отката (`$STATE_DIR/last-good-image`)
#   stack.sh down    — остановить
#   stack.sh logs …  — любые прочие аргументы уходят в `docker compose` как есть
#
# ЗАЧЕМ ОТДЕЛЬНЫЙ ФАЙЛ. До автодеплоя systemd-юнит из `install-ubuntu.sh` поднимал голый
# `docker compose up` — без релизного оверлея и без `VOID_IMAGE`. Выкатка подписанного
# образа жила ровно до первой перезагрузки: юнит возвращал хост на локальную сборку, а
# агент этого не замечал, потому что удалённый дайджест равен записанному. Теперь юнит,
# хелпер `moongame` и обновление собирают стек ОДНИМ способом — этим файлом, — и после
# ребута работает тот же дайджест, что был до него.
#
# Состояние (`server.env`, сертификаты, точка отката) живёт НЕ здесь, а в `$STATE_DIR`:
# этот каталог — одна из версий `deploy/`, их на хосте несколько, и переключаются они
# атомарно (см. autoupdate.sh). Имя проекта Compose — `deploy` (задано в
# docker-compose.yml): под ним живут контейнеры, сеть и том `deploy_void-pgdata`, и
# соседний каталог версии не должен поднять второй стек.
set -euo pipefail

# Физический путь (`pwd -P`): юнит зовёт этот файл через ссылку `current`, а агент — по
# настоящему каталогу версии. Compose считает путь к файлам частью конфигурации, и с двумя
# написаниями одного каталога каждый старт юнита пересоздавал бы работающий сервер.
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
STATE_DIR="${STATE_DIR:-/var/lib/moongame}"
ENV_FILE="$STATE_DIR/server.env"
LAST_GOOD="$STATE_DIR/last-good-image"

# Образ берётся из точки отката, если его не передали явно (так делает update.sh, когда
# поднимает НОВЫЙ дайджест, ещё не ставший точкой отката).
if [ -z "${VOID_IMAGE:-}" ]; then
  VOID_IMAGE="$(cat "$LAST_GOOD" 2>/dev/null || true)"
fi
case "$VOID_IMAGE" in
  *@sha256:*) ;;
  *)
    echo "[✗] Нет подписанного образа для подъёма: $LAST_GOOD пуст или не дайджест." >&2
    echo "    Хост ещё не переведён на автодеплой — см. deploy/install-autodeploy.sh." >&2
    exit 1
    ;;
esac
export VOID_IMAGE

compose() {
  docker compose --env-file "$ENV_FILE" \
    -f "$HERE/docker-compose.yml" -f "$HERE/docker-compose.release.yml" "$@"
}

case "${1:-}" in
  up)
    # `--pull missing`, а не `always` из оверлея: образ уже проверен и скачан тем, кто
    # его выкатывал, а дайджест не даёт подменить байты. С `always` перезагрузка при
    # недоступном реестре оставила бы игру лежать — ровно когда её некому поднять.
    compose up -d --no-build --pull missing
    ;;
  down)
    compose down
    ;;
  "")
    echo "usage: $0 up|down|<docker compose args>" >&2
    exit 2
    ;;
  *)
    compose "$@"
    ;;
esac
