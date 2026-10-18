#!/bin/bash
# Host-only public-release gate. Never print the protected configuration/ledger.
set -euo pipefail
file=/etc/moongame/account-erasure.env
[[ -f "$file" && ! -L "$file" && "$(stat -c %u "$file")" = 0 ]] || exit 1
(( (8#$(stat -c %a "$file") & 8#077) == 0 )) || exit 1
set -a
# shellcheck disable=SC1090
source "$file"
set +a
: "${ERASURE_LEDGER:?E_ERASURE_CONFIG}"
[[ -f "$ERASURE_LEDGER" && ! -L "$ERASURE_LEDGER" ]] || exit 1
(( (8#$(stat -c %a "$ERASURE_LEDGER") & 8#077) == 0 )) || exit 1
systemctl is-enabled --quiet moongame-account-erasure.timer
systemctl is-active --quiet moongame-account-erasure.timer
state="${STATE_DIR:-/var/lib/moongame}"
[[ ! -e "$state/account-erasure.pending" && -f "$state/account-erasure.last-success" ]] || exit 1
age=$(( $(date +%s) - $(stat -c %Y "$state/account-erasure.last-success") ))
(( age >= 0 && age < 172800 )) || exit 1
