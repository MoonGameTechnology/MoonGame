#!/bin/bash
# Remove only old, published MoonGame images. The caller MUST hold autoupdate.lock
# throughout inventory and deletion, and pass every current/rollback/prepared image
# checkpoint as a full digest reference. Never invoke global Docker prune here.
# Runtime requirements match the deploy agent: Bash, Docker and GNU coreutils.
set -euo pipefail

fail() { printf 'image-retention: %s\n' "$1" >&2; exit 1; }
log() { printf 'image-retention: %s\n' "$*"; }

case "${1:-}" in
  --apply|--dry-run) MODE="$1"; shift ;;
  *) fail E_IMAGE_PRUNE_USAGE ;;
esac
[ "$#" -gt 0 ] || fail E_IMAGE_PRUNE_USAGE

IMAGE_REPO="${IMAGE_REPO:-ghcr.io/moongametechnology/moongame}"
CADDY_REPO="${CADDY_REPO:-$IMAGE_REPO/caddy}"
for repo in "$IMAGE_REPO" "$CADDY_REPO"; do
  [[ "$repo" =~ ^[a-z0-9][a-z0-9._:/-]*[a-z0-9]$ ]] || fail E_IMAGE_PRUNE_USAGE
done
[ "$IMAGE_REPO" != "$CADDY_REPO" ] || fail E_IMAGE_PRUNE_USAGE
for pin in "$@"; do
  [[ "$pin" =~ ^[a-z0-9][a-z0-9._:/-]*@sha256:[0-9a-f]{64}$ ]] || fail E_IMAGE_PRUNE_USAGE
done

declare -A seen=() protected=() revisions=() repositories=() snapshots=() retained=() revision_seen=() revision_count=()
ids=()
records=()
candidates=()

# Read only explicitly selected non-secret fields, never Config.Env or raw inspect.
# Finish the entire inventory/protection plan before the first destructive call.
inventory="$(timeout 30s docker image ls --all --no-trunc --quiet 2>/dev/null)" || fail E_IMAGE_PRUNE_INVENTORY
while IFS= read -r id; do
  [ -n "$id" ] || continue
  [[ "$id" =~ ^sha256:[0-9a-f]{64}$ ]] || fail E_IMAGE_PRUNE_INVENTORY
  [ -z "${seen[$id]:-}" ] || continue
  seen["$id"]=1
  ids+=("$id")
done <<< "$inventory"

# Docker may omit Labels/RepoDigests/RepoTags entirely for local or imported
# images. index/with preserves those images without a missing-map-key failure.
FORMAT='{{.Id}}|{{.Created}}|{{with index .Config "Labels"}}{{index . "org.opencontainers.image.revision"}}{{end}}|{{with index . "RepoDigests"}}{{join . ","}}{{end}}|{{with index . "RepoTags"}}{{join . ","}}{{end}}'
for id in "${ids[@]}"; do
  row="$(timeout 30s docker image inspect --format "$FORMAT" "$id" 2>/dev/null)" || fail E_IMAGE_PRUNE_INSPECT
  [[ "$row" != *$'\n'* && "$row" != *$'\r'* ]] || fail E_IMAGE_PRUNE_METADATA
  [[ "$row" =~ ^([^\|]*)\|([^\|]*)\|([^\|]*)\|([^\|]*)\|([^\|]*)$ ]] || fail E_IMAGE_PRUNE_METADATA
  actual="${BASH_REMATCH[1]}"; created="${BASH_REMATCH[2]}"; revision="${BASH_REMATCH[3]}"
  digests="${BASH_REMATCH[4]}"; tags="${BASH_REMATCH[5]}"
  [ "$actual" = "$id" ] || fail E_IMAGE_PRUNE_METADATA
  # Missing/invalid provenance, foreign aliases and local/dangling builds stay.
  # A shared server+Caddy image is ambiguous and also stays conservatively.
  owner=""; foreign=0
  IFS=, read -r -a aliases <<< "$digests"
  for alias in "${aliases[@]}"; do
    matched=""
    for repo in "$IMAGE_REPO" "$CADDY_REPO"; do
      digest="${alias#"$repo@sha256:"}"
      if [ "$alias" != "$digest" ] && [[ "$digest" =~ ^[0-9a-f]{64}$ ]]; then matched="$repo"; fi
    done
    if [ -z "$matched" ]; then foreign=1
    elif [ -n "$owner" ] && [ "$owner" != "$matched" ]; then foreign=1
    else owner="$matched"; fi
  done
  [ -n "$owner" ] && [ "$foreign" = 0 ] || continue
  IFS=, read -r -a aliases <<< "$tags"
  for alias in "${aliases[@]}"; do
    tag="${alias#"$owner:"}"
    digest="${alias#"$owner@sha256:"}"
    if [ "$tag" != "$alias" ] && [[ "$tag" =~ ^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$ ]]; then continue; fi
    if [ "$digest" != "$alias" ] && [[ "$digest" =~ ^[0-9a-f]{64}$ ]]; then continue; fi
    foreign=1
  done
  [ "$foreign" = 0 ] && [[ "$revision" =~ ^[0-9a-f]{40}$ ]] || continue

  # Only provenance-qualified images participate in ordering. Local/imported
  # images can legitimately carry Docker's zero Created value (year 0001); their
  # timestamps cannot block cleanup of unrelated published images.
  [[ "$created" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,9})?Z$ ]] || fail E_IMAGE_PRUNE_METADATA
  timestamp="$(date -u --date="$created" '+%s.%N' 2>/dev/null)" || fail E_IMAGE_PRUNE_METADATA
  [[ "$timestamp" =~ ^[0-9]{1,12}\.[0-9]{9}$ ]] || fail E_IMAGE_PRUNE_METADATA
  repositories["$id"]="$owner"
  revisions["$id"]="$revision"
  snapshots["$id"]="$row"
  records+=("$timestamp $owner $revision")
done

# Docker's complete container list includes exited/created/paused containers. Their
# immutable image IDs are protected even if no tag or release checkpoint names them.
containers="$(timeout 30s docker container ls --all --quiet 2>/dev/null)" || fail E_IMAGE_PRUNE_CONTAINERS
while IFS= read -r container; do
  [ -n "$container" ] || continue
  [[ "$container" =~ ^([0-9a-f]{12}|[0-9a-f]{64})$ ]] || fail E_IMAGE_PRUNE_CONTAINERS
  id="$(timeout 30s docker container inspect --format '{{.Image}}' "$container" 2>/dev/null)" || fail E_IMAGE_PRUNE_CONTAINERS
  [[ "$id" =~ ^sha256:[0-9a-f]{64}$ ]] && [ -n "${seen[$id]:-}" ] || fail E_IMAGE_PRUNE_CONTAINERS
  protected["$id"]=1
done <<< "$containers"

for pin in "$@"; do
  id="$(timeout 30s docker image inspect --format '{{.Id}}' "$pin" 2>/dev/null)" || fail E_IMAGE_PRUNE_PIN
  [[ "$id" =~ ^sha256:[0-9a-f]{64}$ ]] && [ -n "${seen[$id]:-}" ] || fail E_IMAGE_PRUNE_PIN
  protected["$id"]=1
done

# Select distinct revisions, not five image IDs: a rebuild of the same revision
# must not evict an extra rollback revision. Keep all images of retained revisions.
if [ "${#records[@]}" -gt 0 ]; then
  ordered="$(printf '%s\n' "${records[@]}" | LC_ALL=C sort -k1,1nr -k2,2 -k3,3)" || fail E_IMAGE_PRUNE_INVENTORY
  while read -r timestamp repo revision; do
    key="$repo|$revision"
    [ -z "${revision_seen[$key]:-}" ] || continue
    revision_seen["$key"]=1
    count="${revision_count[$repo]:-0}"
    if [ "$count" -lt 5 ]; then
      retained["$key"]=1
      revision_count["$repo"]=$((count + 1))
    fi
  done <<< "$ordered"
fi

for id in "${ids[@]}"; do
  [ -n "${repositories[$id]:-}" ] || continue
  key="${repositories[$id]}|${revisions[$id]}"
  [ -z "${protected[$id]:-}" ] && [ -z "${retained[$key]:-}" ] || continue
  candidates+=("$id")
done

removed=0; skipped=0
for id in "${candidates[@]}"; do
  log "plan $id"
  [ "$MODE" = --apply ] || continue
  # Recheck aliases/provenance immediately before deletion; a changed or unknown
  # image stays. No --force: Docker also rejects images newly used by containers.
  if ! fresh="$(timeout 30s docker image inspect --format "$FORMAT" "$id" 2>/dev/null)" || [ "$fresh" != "${snapshots[$id]}" ]; then
    skipped=$((skipped + 1))
    log "skip $id E_IMAGE_PRUNE_RECHECK"
    continue
  fi
  if timeout 120s docker image rm "$id" >/dev/null 2>&1; then
    removed=$((removed + 1))
  else
    skipped=$((skipped + 1))
    log "skip $id E_IMAGE_PRUNE_REMOVE"
  fi
done
log "mode=${MODE#--} images=${#ids[@]} candidates=${#candidates[@]} removed=$removed skipped=$skipped"
