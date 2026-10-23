#!/bin/bash
# Optional ERASURE_WORKER_HOOK: use the exact server image across autodeploys.
# Credentials stay in a separate root-only Docker env file, never in argv/logs.
set -euo pipefail
case "${1:-}" in --pending|--replay) ;; *) exit 2 ;; esac
: "${ERASURE_DOCKER_ENV:?E_ERASURE_CONFIG}"
: "${ERASURE_LEDGER:?E_ERASURE_CONFIG}"
: "${ERASURE_DOCKER_NETWORK:?E_ERASURE_CONFIG}"
: "${ERASURE_DOCKER_LOG_VOLUME:?E_ERASURE_CONFIG}"
[[ "$ERASURE_DOCKER_ENV" = /* && -f "$ERASURE_DOCKER_ENV" && ! -L "$ERASURE_DOCKER_ENV" ]] || exit 1
[[ "$(stat -c %u "$ERASURE_DOCKER_ENV")" = 0 ]] || exit 1
(( (8#$(stat -c %a "$ERASURE_DOCKER_ENV") & 8#077) == 0 )) || exit 1
[[ "$ERASURE_LEDGER" = /* && -f "$ERASURE_LEDGER" && ! -L "$ERASURE_LEDGER" ]] || exit 1
image="$(docker inspect --format '{{.Image}}' "${ERASURE_DOCKER_SERVER:-deploy-server-1}")"
[[ "$image" =~ ^sha256:[0-9a-f]{64}$ ]] || exit 1
# Root is confined to the two data mounts; CHOWN preserves original log ownership.
# The root filesystem is read-only and no host ports or Docker socket are exposed.
exec docker run --rm --pull never --read-only --user 0:0 \
  --network "$ERASURE_DOCKER_NETWORK" --env-file "$ERASURE_DOCKER_ENV" \
  --cap-drop ALL --cap-add CHOWN --cap-add DAC_OVERRIDE \
  --security-opt no-new-privileges:true --pids-limit 128 --memory 512m \
  --mount "type=bind,src=$(dirname "$ERASURE_LEDGER"),dst=/erasure" \
  --mount "type=volume,src=$ERASURE_DOCKER_LOG_VOLUME,dst=/app/playtest-logs" \
  --env "ERASURE_LEDGER=/erasure/$(basename "$ERASURE_LEDGER")" \
  --env ERASURE_LOG_DIR=/app/playtest-logs \
  "$image" packages/server/dist/account-erasure.mjs "$1"
