#!/bin/bash
# Run from a pinned checkout. Protected env is provided by systemd EnvironmentFile.
set -euo pipefail
umask 077
cd "${ERASURE_CHECKOUT:?E_ERASURE_CONFIG}"
: "${ERASURE_STOP_HOOK:?E_ERASURE_CONFIG}"
: "${ERASURE_START_HOOK:?E_ERASURE_CONFIG}"
# Hooks are root-owned executable files, not shell strings from player input.
for hook in "$ERASURE_STOP_HOOK" "$ERASURE_START_HOOK" ${ERASURE_WORKER_HOOK:+"$ERASURE_WORKER_HOOK"}; do
  [[ -f "$hook" && ! -L "$hook" && -x "$hook" ]] || exit 1
  [[ "$(stat -c %u "$hook")" = 0 ]] || exit 1
  (( (8#$(stat -c %a "$hook") & 8#022) == 0 )) || exit 1
done
worker() {
  if [[ -n "${ERASURE_WORKER_HOOK:-}" ]]; then "$ERASURE_WORKER_HOOK" "$@"
  else node packages/server/dist/account-erasure.mjs "$@"; fi
}
exec 9>"${STATE_DIR:-/var/lib/moongame}/autoupdate.lock"
flock -n 9 || exit 0
marker="${STATE_DIR:-/var/lib/moongame}/account-erasure.pending"
# A failed start must retry the entire maintenance/replay cycle, even with no queue.
if [[ -e "$marker" ]] || worker --pending; then
  :
else
  result=$?
  if [[ "$result" = 3 ]]; then
    [[ ! -e "${STATE_DIR:-/var/lib/moongame}/account-erasure.pending" ]] || exit 1
    touch "${STATE_DIR:-/var/lib/moongame}/account-erasure.last-success"
    exit 0
  fi
  exit "$result"
fi
# NO restart trap: a failed erasure must stay in maintenance until retried.
touch "${STATE_DIR:-/var/lib/moongame}/account-erasure.pending"
"$ERASURE_STOP_HOOK"
worker --replay
"$ERASURE_START_HOOK"
rm -f "$marker"
touch "${STATE_DIR:-/var/lib/moongame}/account-erasure.last-success"
