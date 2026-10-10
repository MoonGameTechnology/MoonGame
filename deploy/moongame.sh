#!/bin/bash
#
# Команда `moongame` на хосте автодеплоя (ZTP-1.2).
#
# /usr/local/bin/moongame здесь — три строки, которые зовут ЭТОТ файл из текущей версии
# `deploy/` (их пишет install-autodeploy.sh). Сам хелпер поэтому обновляется вместе с
# образом, как и всё остальное: правка команды доезжает до машины без входа на неё.
#
# На хосте без автодеплоя хелпер прежний, из install-ubuntu.sh.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STATE_DIR="${STATE_DIR:-/var/lib/moongame}"
SERVICE_NAME="moongame"
SERVICE_USER="${SERVICE_USER:-moongame}"
export STATE_DIR DOCKER_CONFIG="${DOCKER_CONFIG:-$STATE_DIR/docker}"

# Docker и состояние принадлежат сервисной учётке, а команду набирают из-под своей.
as_service() {
  if [ "$(id -un)" = "$SERVICE_USER" ]; then
    "$@"
  else
    sudo -u "$SERVICE_USER" env STATE_DIR="$STATE_DIR" DOCKER_CONFIG="$DOCKER_CONFIG" "$@"
  fi
}

case "${1:-}" in
  start | stop | restart | status)
    sudo systemctl "$1" "$SERVICE_NAME"
    ;;
  logs)
    # Логи КОНТЕЙНЕРОВ: юнит лишь поднимает стек и выходит, сам сервер пишет в docker.
    as_service bash "$HERE/stack.sh" logs -f --tail 100
    ;;
  journal)
    sudo journalctl -u "$SERVICE_NAME" -u "$SERVICE_NAME-autoupdate" -f
    ;;
  update)
    # Выкатить свежий подписанный :main СЕЙЧАС, мимо окна тихих часов: для срочной починки.
    # Тот же путь, что у таймера (подпись, здоровье, откат), и та же строка в журнале.
    as_service bash "$HERE/autoupdate.sh" --now
    ;;
  history)
    # Последние выкатки и откаты (ZTP-1.3). Полный файл — $STATE_DIR/deploy-history.
    as_service tail -n "${2:-20}" "$STATE_DIR/deploy-history"
    ;;
  version)
    # Что запущено: дайджест из точки отката и то, что сервер сам говорит о сборке.
    echo "образ:   $(as_service cat "$STATE_DIR/last-good-image" 2>/dev/null || echo '—')"
    echo "/health: $(curl -fsS --max-time 3 "http://127.0.0.1:${PORT:-8788}/health" 2>/dev/null || echo 'не отвечает')"
    systemctl list-timers "$SERVICE_NAME-autoupdate.timer" --no-pager 2>/dev/null | sed -n '1,2p' || true
    ;;
  *)
    echo "Void Dominion — управление сервером (автодеплой)"
    echo ""
    echo "Использование: moongame [команда]"
    echo ""
    echo "  start | stop | restart | status — systemd-юнит сервера"
    echo "  logs        — логи сервера (Ctrl+C для выхода)"
    echo "  journal     — журнал юнитов сервера и автообновления"
    echo "  update      — выкатить свежую подписанную сборку сейчас, мимо окна"
    echo "  history [N] — последние выкатки и откаты"
    echo "  version     — что сейчас запущено"
    echo ""
    echo "Выключить автообновление: AUTODEPLOY=0 в $STATE_DIR/server.env."
    echo "Окно выкатки: AUTODEPLOY_WINDOW=ЧЧ:ММ-ЧЧ:ММ там же (время хоста, пусто — сразу)."
    ;;
esac
