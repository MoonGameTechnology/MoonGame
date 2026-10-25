#!/usr/bin/env bash
# Install local controls without restarting Game, PostgreSQL, Caddy or Docker.
set -euo pipefail
[ "$(id -u)" = 0 ] || { echo E_RESOURCE_ROOT >&2; exit 1; }
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
PYTHONDONTWRITEBYTECODE=1 python3 - "$HERE" <<'PY'
import importlib.util
import os
from pathlib import Path
import subprocess
import stat
import sys
import tempfile

source = Path(sys.argv[1])
inputs = ['guard.py', 'guard.service', 'guard.timer', 'preflight.conf', 'journald.conf', 'version']
for path in [*reversed(source.parents), source, *(source / name for name in inputs)]:
    info = path.lstat()
    if info.st_uid != 0 or info.st_mode & 0o022 or stat.S_ISLNK(info.st_mode):
        raise SystemExit('E_RESOURCE_INSTALL_SOURCE')
    if path.name in inputs and not stat.S_ISREG(info.st_mode):
        raise SystemExit('E_RESOURCE_INSTALL_SOURCE')
spec = importlib.util.spec_from_file_location('guard', source / 'guard.py')
guard = importlib.util.module_from_spec(spec)
spec.loader.exec_module(guard)
guard.protected(source, directory=True)
guard.protected(guard.DEPLOY_STATE, directory=True)

def directory(path, mode=0o755):
    if not path.exists():
        directory(path.parent)
        path.mkdir(mode=mode)
    guard.protected(path, directory=True)

directory(guard.STATE, 0o700)
if guard.read_pressure() or guard.decision(guard.measure())['level'] == 2:
    raise SystemExit('E_RESOURCE_PRESSURE: inspect disk before installing')

def install(src, dst):
    directory(dst.parent)
    fd, name = tempfile.mkstemp(prefix='.' + dst.name + '.', dir=dst.parent)
    temporary = Path(name)
    try:
        with os.fdopen(fd, 'wb') as stream:
            stream.write(src.read_bytes())
            os.fchmod(stream.fileno(), 0o644)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, dst)
        guard.sync_directory(dst.parent)
    finally:
        temporary.unlink(missing_ok=True)

install(source / 'guard.py', Path('/opt/moongame-ops/deploy/resources/guard.py'))
for suffix in ['service', 'timer']:
    install(source / ('guard.' + suffix), Path('/etc/systemd/system/moongame-resource-guard.' + suffix))
for unit in ['moongame', 'moongame-autoupdate', 'moongame-account-erasure', 'moongame-observability']:
    install(source / 'preflight.conf', Path('/etc/systemd/system') / (unit + '.service.d/30-resource-budget.conf'))
install(source / 'journald.conf', Path('/etc/systemd/journald.conf.d/moongame-resources.conf'))
install(source / 'version', guard.DEPLOY_STATE / 'resource-guard.version')
PY
systemctl daemon-reload
systemctl enable --now moongame-resource-guard.timer
systemctl start moongame-resource-guard.service
systemctl restart systemd-journald.service
