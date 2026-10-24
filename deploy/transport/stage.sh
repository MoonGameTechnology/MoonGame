#!/usr/bin/env bash
# Root operator entrypoint: keep TLS and backend isolation on every stage update.
set -euo pipefail
[ "$(id -u)" = 0 ] || exit 1
STATE_DIR="${STATE_DIR:-/var/lib/moongame-bots-stage}"
TRANSPORT_FILE="${TRANSPORT_FILE:-/var/lib/moongame-transport/stage/compose.yml}"
exec docker compose --env-file "$STATE_DIR/stage.env" \
  -f "$STATE_DIR/docker-compose.bots-stage.yml" -f "$TRANSPORT_FILE" "$@"
