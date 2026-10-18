#!/usr/bin/env bash
# Host-build / playtest entrypoint. For signed-image hosts use stack.sh instead.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
ENV_FILE="${ENV_FILE:-$HERE/server.env}"
. "$HERE/production-preflight.sh"
if [ "${1:-}" = stop ]; then
  shift
  action=(stop)
else
  production_preflight "$ENV_FILE"
  action=(up -d)
fi
files=(-f "$HERE/docker-compose.yml")
if [ -n "$(deploy_env_value "$ENV_FILE" DOMAIN)" ]; then
  files+=(-f "$HERE/docker-compose.tls.yml")
fi
# Preserve host-specific policy (for example, operator-only match creation).
if [ -n "${COMPOSE_EXTRA_FILE:-}" ]; then files+=(-f "$COMPOSE_EXTRA_FILE"); fi
docker compose --env-file "$ENV_FILE" "${files[@]}" "${action[@]}" "$@"
