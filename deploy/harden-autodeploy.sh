#!/bin/bash
# One-time, root-only migration of an existing signed-image host. Running game
# containers are never stopped. A busy deploy or retained service process fails closed.
set -euo pipefail
STATE_DIR="${STATE_DIR:-/var/lib/moongame}"
SYSTEMD_DIR="${SYSTEMD_DIR:-/etc/systemd/system}"
BIN_DIR="${BIN_DIR:-/usr/local/bin}"
RETIRED_USER="${RETIRED_USER:-moongame}"
die() { echo "$1" >&2; exit 1; }
[ "$(id -u)" = 0 ] || die E_DEPLOY_ROOT_REQUIRED
[[ "$RETIRED_USER" =~ ^[a-z_][a-z0-9_-]*$ ]] || die E_DEPLOY_USER
[ "$RETIRED_USER" != root ] || die E_DEPLOY_USER
[ "${1:-}" = --apply ] || {
  echo 'Run with --apply to protect deployment state and retire service Docker access.'
  exit 2
}
# Validate before stopping any timer or changing ownership. Never follow an external
# symlink or change a hardlinked file outside the deployment tree.
python3 - "$STATE_DIR" "$SYSTEMD_DIR" "$BIN_DIR" <<'PY'
import json, os, stat, sys
state, systemd, binaries = sys.argv[1:]
for path in (state, systemd, binaries):
    if not os.path.isabs(path) or os.path.realpath(path) != path or path in ('/', '/var', '/var/lib', '/etc', '/usr', '/usr/local'):
        raise SystemExit('E_DEPLOY_PATH')
    parent = os.path.dirname(path)
    while parent != '/':
        s = os.stat(parent)
        if s.st_uid not in (0, os.geteuid()) or (s.st_mode & 0o022 and not s.st_mode & stat.S_ISVTX):
            raise SystemExit('E_DEPLOY_PARENT')
        parent = os.path.dirname(parent)
for path in (systemd, binaries):
    s = os.stat(path)
    if s.st_uid != os.geteuid() or s.st_mode & 0o022:
        raise SystemExit('E_DEPLOY_PARENT')
for unit in ('moongame.service', 'moongame-autoupdate.service'):
    if not os.path.isfile(os.path.join(systemd, unit)):
        raise SystemExit('E_DEPLOY_UNIT')
    dropin = os.path.join(systemd, unit + '.d')
    if os.path.lexists(dropin):
        s = os.lstat(dropin)
        if not stat.S_ISDIR(s.st_mode) or s.st_uid != os.geteuid() or s.st_mode & 0o022:
            raise SystemExit('E_DEPLOY_UNIT_PATH')
    if os.path.islink(os.path.join(dropin, '10-deploy-boundary.conf')):
        raise SystemExit('E_DEPLOY_UNIT_PATH')
if os.path.islink(os.path.join(binaries, 'moongame')) or os.path.islink(os.path.join(state, 'autoupdate.lock')):
    raise SystemExit('E_DEPLOY_PATH')
if not os.path.isfile(os.path.join(state, 'current', 'deploy', 'stack.sh')):
    raise SystemExit('E_DEPLOY_LAYOUT')
# Preflight and stack.sh accept the old deploy UID as an owner. After this
# migration only root is trusted. External dependencies cannot be silently
# adopted: an old account could still replace them through their parent directory.
keys = ('BACKUP_READINESS_CHECK', 'ERASURE_READINESS_CHECK', 'COMPOSE_EXTRA_FILE', 'PRIVACY_RELEASE_MANIFEST')
configured = {}
with open(os.path.join(state, 'server.env')) as f:
    for line in f:
        key, sep, value = line.rstrip('\r\n').partition('=')
        if sep and key in keys:
            configured[key] = value.strip("\"'")
def dependency(key, value):
    if not value:
        return
    resolved = os.path.realpath(value)
    if not os.path.isabs(value) or os.path.islink(value) or not os.path.isfile(value):
        raise SystemExit('E_DEPLOY_DEPENDENCY: ' + key)
    if value.startswith(state + '/') and resolved.startswith(state + '/') and not resolved.startswith(state + '/certs/'):
        return  # The complete protected tree is adopted below.
    if resolved != value:
        raise SystemExit('E_DEPLOY_DEPENDENCY: ' + key)
    s = os.stat(value)
    if s.st_uid != 0 or s.st_mode & 0o022:
        raise SystemExit('E_DEPLOY_DEPENDENCY: ' + key + ' requires a reviewed root-owned file')
    parent = os.path.dirname(value)
    while parent != '/':
        s = os.stat(parent)
        if s.st_uid != 0 or s.st_mode & 0o022:
            raise SystemExit('E_DEPLOY_DEPENDENCY_PARENT: ' + key)
        parent = os.path.dirname(parent)
for key in keys:
    dependency(key, os.environ.get(key, configured.get(key, '')))
manifest = os.environ.get('PRIVACY_RELEASE_MANIFEST', configured.get('PRIVACY_RELEASE_MANIFEST', ''))
if manifest:
    if os.stat(manifest).st_size > 128 * 1024:
        raise SystemExit('E_DEPLOY_DEPENDENCY: PRIVACY_RELEASE_MANIFEST')
    with open(manifest) as f:
        data = json.load(f)
    evidence = list(data.get('evidence', {}).values())
    evidence += [item.get('evidence', {}) for item in data.get('stores', [])]
    for item in evidence:
        if not isinstance(item, dict) or not isinstance(item.get('path'), str):
            raise SystemExit('E_DEPLOY_DEPENDENCY: PRIVACY_RELEASE_MANIFEST evidence')
        dependency('PRIVACY_RELEASE_MANIFEST evidence', item['path'])
for base, dirs, files in os.walk(state, followlinks=False):
    for name in dirs + files:
        p = os.path.join(base, name)
        s = os.lstat(p)
        if stat.S_ISLNK(s.st_mode):
            if p == os.path.join(state, 'certs') or (p.startswith(state + '/certs/') and not os.path.realpath(p).startswith(state + '/certs/')):
                raise SystemExit('E_DEPLOY_CERT_LINK')
            if not os.path.realpath(p).startswith(state + '/'):
                raise SystemExit('E_DEPLOY_EXTERNAL_LINK')
        elif stat.S_ISREG(s.st_mode):
            if s.st_nlink != 1:
                raise SystemExit('E_DEPLOY_HARDLINK')
        elif not stat.S_ISDIR(s.st_mode):
            raise SystemExit('E_DEPLOY_SPECIAL_FILE')
PY
timer_was_active=0
migration_state=0
systemctl is-active --quiet moongame-autoupdate.timer && timer_was_active=1
restore_timer() {
  if [ "$timer_was_active" = 1 ] && [ "$migration_state" != 1 ]; then systemctl start moongame-autoupdate.timer; fi
  if [ "$migration_state" = 1 ]; then echo E_DEPLOY_MIGRATION_INCOMPLETE_TIMER_PAUSED >&2; fi
}
trap restore_timer EXIT
systemctl stop moongame-autoupdate.timer
if systemctl is-active --quiet moongame-autoupdate.service; then die E_DEPLOY_BUSY; fi
# Existing processes retain supplementary groups and open writable descriptors.
if id "$RETIRED_USER" >/dev/null 2>&1 && pgrep -u "$RETIRED_USER" >/dev/null; then die E_DEPLOY_USER_BUSY; fi
exec 9>"$STATE_DIR/autoupdate.lock"
flock -n 9 || die E_DEPLOY_BUSY

backup="$(mktemp -d "$STATE_DIR/deploy-boundary.XXXXXX")"
chmod 700 "$backup"
# Preserve file ownership needed by nonroot processes through read-only cert
# mounts. The certificate directory itself and the host parent remain root-only.
cert_paths=()
cert_owners=()
if [ -d "$STATE_DIR/certs" ]; then
  while IFS= read -r -d '' path; do
    cert_paths+=("$path")
    cert_owners+=("$(stat -c %u:%g -- "$path")")
  done < <(find "$STATE_DIR/certs" -type f -print0)
fi
for unit in moongame.service moongame-autoupdate.service; do
  [ -f "$SYSTEMD_DIR/$unit" ] || die E_DEPLOY_UNIT
  cp -p "$SYSTEMD_DIR/$unit" "$backup/$unit"
done
# Protect the parent first; merely switching User=root would execute scripts still
# writable by the old account. Do not chmod certificates to 0600: the application's
# read-only bind mount must remain readable by container UID 65532.
migration_state=1
chown root:root "$STATE_DIR"
chmod 700 "$STATE_DIR"
chown -hR root:root "$STATE_DIR"
for i in "${!cert_paths[@]}"; do
  chown "${cert_owners[$i]}" -- "${cert_paths[$i]}"
done
find "$STATE_DIR" -type d -exec chmod go-w {} +
find "$STATE_DIR" -type f -exec chmod go-w {} +
for unit in moongame.service moongame-autoupdate.service; do
  install -d -o root -g root -m 0755 "$SYSTEMD_DIR/$unit.d"
  cat > "$SYSTEMD_DIR/$unit.d/10-deploy-boundary.conf" <<EOF
[Service]
User=root
Group=root
Environment=SERVICE_USER=root
NoNewPrivileges=yes
UMask=0077
EOF
  chown root:root "$SYSTEMD_DIR/$unit.d/10-deploy-boundary.conf"
  chmod 644 "$SYSTEMD_DIR/$unit.d/10-deploy-boundary.conf"
done
# Old release helpers support this selector; rollback must not restore a call to
# sudo -u moongame after that account has lost its deployment rights.
cat > "$BIN_DIR/moongame" <<EOF
#!/bin/bash
exec env SERVICE_USER=root STATE_DIR="$STATE_DIR" bash "$STATE_DIR/current/deploy/moongame.sh" "\$@"
EOF
chown root:root "$BIN_DIR/moongame"
chmod 755 "$BIN_DIR/moongame"
if id "$RETIRED_USER" >/dev/null 2>&1 && id -nG "$RETIRED_USER" | tr ' ' '\n' | grep -qx docker; then
  gpasswd -d "$RETIRED_USER" docker >/dev/null
fi
systemctl daemon-reload
migration_state=2
echo 'Deployment boundary protected; existing containers were not restarted.'
