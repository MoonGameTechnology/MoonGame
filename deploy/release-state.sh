#!/usr/bin/env bash
# ZTP TLS slice: one atomic checkpoint for the server + edge pair. Never source it.
release_value() {
  [ -f "$1" ] || return 0
  sed -n "s/^$2=//p" "$1" | tail -n 1 | sed -e 's/^["'"'"']//;s/["'"'"']$//;s/\r$//'
}
release_effective() {
  if [[ -v "$2" ]]; then printf '%s' "${!2}"; else release_value "$1" "$2"; fi
}
release_tls() { [ -n "$(release_effective "$1" DOMAIN)" ]; }
release_ref_valid() { [[ "$1" =~ ^[a-z0-9][a-z0-9./:_-]+@sha256:[0-9a-f]{64}$ ]]; }
release_pair_read() {
  local file="$1"
  [ -f "$file" ] && [ ! -L "$file" ] || return 1
  [ "$(wc -l < "$file")" -eq 3 ] && [ "$(head -n 1 "$file")" = version=1 ] || return 1
  RELEASE_SERVER="$(sed -n '2s/^server=//p' "$file")"
  RELEASE_CADDY="$(sed -n '3s/^caddy=//p' "$file")"
  release_ref_valid "$RELEASE_SERVER" && release_ref_valid "$RELEASE_CADDY"
}
release_pair_write() {
  local file="$1" server="$2" caddy="$3" temporary
  release_ref_valid "$server" && release_ref_valid "$caddy" || return 1
  temporary="$(mktemp "${file}.XXXXXX")" || return 1
  if ! printf 'version=1\nserver=%s\ncaddy=%s\n' "$server" "$caddy" > "$temporary" || ! mv -f "$temporary" "$file"; then
    rm -f "$temporary"
    return 1
  fi
}
release_pair_id() { printf '%s\n%s\n' "$1" "$2" | sha256sum | cut -c1-24; }
