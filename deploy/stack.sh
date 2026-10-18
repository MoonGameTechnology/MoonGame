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
# One checkpoint is authoritative for a TLS pair, including after reboot.
. "$HERE/release-state.sh"
TLS=0
if release_tls "$ENV_FILE"; then
  TLS=1
  if [ -n "${VOID_IMAGE:-}" ] || [ -n "${VOID_CADDY_IMAGE:-}" ]; then
    release_ref_valid "${VOID_IMAGE:-}" && release_ref_valid "${VOID_CADDY_IMAGE:-}" || { echo E_DEPLOY_RELEASE_PAIR >&2; exit 1; }
  else
    release_pair_read "$STATE_DIR/last-good-release" || { echo E_DEPLOY_RELEASE_PAIR >&2; exit 1; }
    VOID_IMAGE="$RELEASE_SERVER"
    VOID_CADDY_IMAGE="$RELEASE_CADDY"
  fi
  export VOID_CADDY_IMAGE
fi
EXTRA="$(release_effective "$ENV_FILE" COMPOSE_EXTRA_FILE)"
if [ -n "$EXTRA" ]; then
  if [[ "$EXTRA" != /* ]] || [ -L "$EXTRA" ] || [ ! -f "$EXTRA" ]; then echo E_DEPLOY_EXTRA_FILE >&2; exit 1; fi
  owner="$(stat -c %u "$EXTRA")"; mode="$(stat -c %a "$EXTRA")"
  if (( (8#$mode & 0022) != 0 )) || { [ "$owner" != 0 ] && [ "$owner" != "$(id -u)" ]; }; then echo E_DEPLOY_EXTRA_FILE >&2; exit 1; fi
fi

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
  local files=(-f "$HERE/docker-compose.yml")
  if [ "$TLS" = 1 ]; then files+=(-f "$HERE/docker-compose.tls.yml"); fi
  files+=(-f "$HERE/docker-compose.release.yml")
  if [ "$TLS" = 1 ]; then files+=(-f "$HERE/docker-compose.release-tls.yml"); fi
  if [ -n "$EXTRA" ]; then files+=(-f "$EXTRA"); fi
  docker compose --env-file "$ENV_FILE" "${files[@]}" "$@"
}

case "${1:-}" in
  up|db-up)
    . "$HERE/production-preflight.sh"
    production_preflight "$ENV_FILE"
    # `--pull missing`, а не `always` из оверлея: образ уже проверен и скачан тем, кто
    # его выкатывал, а дайджест не даёт подменить байты. С `always` перезагрузка при
    # недоступном реестре оставила бы игру лежать — ровно когда её некому поднять.
    if [ "$1" = db-up ]; then
      # The legacy unit stops PostgreSQL too. Recover only the database before
      # the migration job; Game must not start against the old schema.
      compose up -d --no-build --pull missing --wait --wait-timeout 60 postgres
    else
      compose up -d --no-build --pull missing
    fi
    ;;
  down)
    compose down
    ;;
  "")
    echo "usage: $0 up|db-up|down|<docker compose args>" >&2
    exit 2
    ;;
  *)
    compose "$@"
    ;;
esac
