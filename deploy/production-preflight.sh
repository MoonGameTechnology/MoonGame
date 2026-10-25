#!/usr/bin/env bash
# Source this file and call production_preflight before mutating the running stack.
# Backup credentials/checker stay on the host, never in the game container.

deploy_env_value() {
  # Compose gives process environment precedence over --env-file. Inspect the same
  # effective switches, including systemd EnvironmentFile and explicit LAN opt-in.
  if [[ -v "$2" ]]; then printf '%s' "${!2}"; return 0; fi
  [ -f "$1" ] || return 0
  sed -n "s/^$2=//p" "$1" | tail -n 1 | sed -e 's/^["'"'"']//;s/["'"'"']$//;s/\r$//'
}

production_preflight() {
  local file="$1" prod checker mode owner key
  if [ -e "${STATE_DIR:-/var/lib/moongame}/resource-pressure.json" ]; then
    echo '[✗] E_RESOURCE_PRESSURE: inspect disk pressure and explicitly resume the resource guard.' >&2
    return 1
  fi
  if [ -e "${STATE_DIR:-/var/lib/moongame}/account-erasure.pending" ]; then
    echo '[✗] E_ERASURE_MAINTENANCE: finish account erasure before starting/updating runtimes.' >&2
    return 1
  fi
  # Never trust an inherited/stored success from an earlier deployment.
  unset BACKUP_READINESS_VERIFIED BACKUP_READINESS_DEFERRED
  prod="$(deploy_env_value "$file" PROD)"
  if [ "$(deploy_env_value "$file" PUBLIC_RELEASE)" = 1 ] && [ "$prod" != 1 ] && [ "$prod" != true ]; then
    echo '[✗] E_PRIVACY_RELEASE: public launch requires explicit PROD=1.' >&2
    return 1
  fi
  case "$prod" in
    0|false)
      case "$(deploy_env_value "$file" SERVER_BIND)" in
        127.0.0.1|::1) return 0 ;;
      esac
      if [ "$(deploy_env_value "$file" ALLOW_INSECURE_LAN)" = 1 ]; then return 0; fi
      echo '[✗] E_DEPLOY_DEV_BIND: use SERVER_BIND=127.0.0.1 or explicit ALLOW_INSECURE_LAN=1 for a private LAN.' >&2
      return 1 ;;
    1|true|"") ;;
    *) echo '[✗] E_DEPLOY_PROD_CONFIG: invalid PROD.' >&2; return 1 ;;
  esac
  for key in DB_AUTO_MIGRATE DB_REQUIRE_LEAST_PRIVILEGE; do
    local expected=1
    [ "$key" != DB_AUTO_MIGRATE ] || expected=0
    if [ "$(deploy_env_value "$file" "$key")" != "$expected" ]; then
      echo "[✗] E_DEPLOY_DATABASE: require $key=$expected; provision roles first (docs/security/zero-trust-rollout.md)." >&2
      return 1
    fi
  done
  # Public launch is distinct from a TLS-protected playtest. Unknown values fail closed.
  case "$(deploy_env_value "$file" PUBLIC_RELEASE)" in
    ""|0) ;;
    1)
      if [ "$(deploy_env_value "$file" BACKUP_POLICY)" = deferred-playtest ]; then
        echo '[✗] E_PRIVACY_RELEASE: public launch cannot defer independent backups.' >&2
        return 1
      fi
      if [ "$(deploy_env_value "$file" ACCOUNT_DELETION_ENABLED)" != 1 ]; then
        echo '[✗] E_ERASURE_READINESS: public accounts require in-app deletion.' >&2
        return 1
      fi
      local erasure_checker
      erasure_checker="$(deploy_env_value "$file" ERASURE_READINESS_CHECK)"
      if [[ "$erasure_checker" != /* ]] || [ -L "$erasure_checker" ] || [ ! -f "$erasure_checker" ] || [ ! -x "$erasure_checker" ]; then
        echo '[✗] E_ERASURE_READINESS: configure a protected erasure readiness checker.' >&2
        return 1
      fi
      mode="$(stat -c %a "$erasure_checker")"; owner="$(stat -c %u "$erasure_checker")"
      if (( (8#$mode & 0022) != 0 )) || { [ "$owner" != 0 ] && [ "$owner" != "$(id -u)" ]; } || ! "$erasure_checker"; then
        echo '[✗] E_ERASURE_READINESS: scheduled erasure is not ready.' >&2
        return 1
      fi
      local privacy_manifest
      privacy_manifest="$(deploy_env_value "$file" PRIVACY_RELEASE_MANIFEST)"
      if ! python3 "$(dirname "${BASH_SOURCE[0]}")/privacy-readiness.py" "$privacy_manifest"; then
        return 1
      fi ;;
    *) echo '[✗] E_PRIVACY_RELEASE: invalid PUBLIC_RELEASE.' >&2; return 1 ;;
  esac
  case "$(deploy_env_value "$file" BACKUP_POLICY)" in
    ""|required) ;;
    deferred-playtest)
      # An explicit operator decision, never a fabricated successful recovery check.
      export BACKUP_READINESS_VERIFIED=0 BACKUP_READINESS_DEFERRED=1
      echo '[!] W_DEPLOY_BACKUP_DEFERRED: independent recovery is not configured; owner-selected playtest policy.' >&2
      return 0 ;;
    *) echo '[✗] E_DEPLOY_BACKUP_POLICY: unknown backup policy.' >&2; return 1 ;;
  esac
  checker="$(deploy_env_value "$file" BACKUP_READINESS_CHECK)"
  # One trusted executable, no shell/eval or command-line fragments from config.
  # It must verify fresh off-host encrypted backup, scheduling and restore evidence.
  if [[ "$checker" != /* ]] || [ -L "$checker" ] || [ ! -f "$checker" ] || [ ! -x "$checker" ]; then
    echo '[✗] E_DEPLOY_BACKUP_CHECK: configure an absolute executable BACKUP_READINESS_CHECK.' >&2
    return 1
  fi
  mode="$(stat -c %a "$checker")" || return 1
  owner="$(stat -c %u "$checker")" || return 1
  if (( (8#$mode & 0022) != 0 )) || { [ "$owner" != 0 ] && [ "$owner" != "$(id -u)" ]; }; then
    echo '[✗] E_DEPLOY_BACKUP_CHECK: unsafe checker ownership or permissions.' >&2
    return 1
  fi
  # A bounded read-only check, not a backup/restore job on the live database. Raw
  # checker output can contain credentials and is never forwarded into deploy logs.
  if ! timeout --kill-after=5 55 "$checker" >/dev/null 2>&1; then
    echo '[✗] E_DEPLOY_BACKUP_CHECK: recovery readiness failed; running stack unchanged.' >&2
    return 1
  fi
  export BACKUP_READINESS_VERIFIED=1
}
