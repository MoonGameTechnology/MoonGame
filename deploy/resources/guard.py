#!/usr/bin/env python3
"""Local disk circuit breaker. Never deletes data or starts stopped containers."""
import argparse
import fcntl
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import sys
import tempfile
import time

GIB = 1024 ** 3
STATE = Path('/var/lib/moongame-resource-guard')
DEPLOY_STATE = Path('/var/lib/moongame')
PRESSURE = DEPLOY_STATE / 'resource-pressure.json'
MIN_FREE = 6 * GIB
MIN_INODES = 100_000
PROD = ['deploy-server-1', 'deploy-postgres-1']
STAGE = ['moongame-bots-stage-server', 'moongame-bots-stage-postgres']
PROXY = ['deploy-caddy-1']
MONITORING = ['deploy-obs-grafana-1', 'deploy-obs-prometheus-1',
              'deploy-obs-loki-1', 'deploy-obs-alloy-1']
TARGETS = PROD + STAGE + PROXY + MONITORING
# Budgets are deployment policy, not caller-controlled paths or shell arguments.
VOLUMES = {
    'deploy_void-pgdata': (8 * GIB, PROD),
    'deploy_void-logs': (5 * GIB // 4, PROD[:1]),
    'moongame-bots-stage-postgres': (2 * GIB, STAGE),
    # Includes both APK lanes: eight builds each, up to 128 MiB per APK, plus staging.
    'deploy_caddy-data': (3 * GIB, PROXY),
    'deploy_caddy-config': (GIB // 4, PROXY),
}


def run(argv, timeout=30):
    # Explicit local endpoint: no caller Docker context/proxy can select another host.
    environment = os.environ.copy()
    if argv[0] == 'docker':
        argv = ['docker', '--host=unix:///var/run/docker.sock', *argv[1:]]
        for key in ['DOCKER_HOST', 'DOCKER_CONTEXT', 'DOCKER_TLS', 'DOCKER_TLS_VERIFY', 'DOCKER_CERT_PATH']:
            environment.pop(key, None)
    return subprocess.check_output(argv, text=True, stderr=subprocess.PIPE,
                                   timeout=timeout, env=environment).strip()


def protected(path, directory=False):
    """Root-owned ancestors, no symlinks or group/other write permission."""
    path = Path(path)
    for item in [*reversed(path.parents), path]:
        info = item.lstat()
        if info.st_uid != 0 or info.st_mode & 0o022 or stat.S_ISLNK(info.st_mode):
            raise ValueError('E_RESOURCE_PATH')
        if item != path or directory:
            if not stat.S_ISDIR(info.st_mode):
                raise ValueError('E_RESOURCE_PATH')
        elif not stat.S_ISREG(info.st_mode):
            raise ValueError('E_RESOURCE_PATH')


def sync_directory(path):
    descriptor = os.open(path, os.O_DIRECTORY)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def save(path, value):
    protected(path.parent, directory=True)
    if path.exists() or path.is_symlink():
        protected(path)
    descriptor, filename = tempfile.mkstemp(prefix='.' + path.name + '.', dir=path.parent)
    temporary = Path(filename)
    try:
        with os.fdopen(descriptor, 'w') as stream:
            json.dump(value, stream)
            stream.write('\n')
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
        sync_directory(path.parent)
    finally:
        temporary.unlink(missing_ok=True)


def read_pressure():
    if not PRESSURE.exists() and not PRESSURE.is_symlink():
        return None
    protected(PRESSURE)
    value = json.loads(PRESSURE.read_text())
    if not isinstance(value, dict) or not isinstance(value.get('targets'), list) or \
            not value['targets'] or any(target not in TARGETS for target in value['targets']) or \
            type(value.get('at')) is not int or not isinstance(value.get('reasons'), list) or \
            any(not isinstance(reason, str) for reason in value['reasons']):
        raise ValueError('E_RESOURCE_MARKER')
    return value


def measure():
    root = Path(run(['docker', 'info', '--format', '{{.DockerRootDir}}']))
    protected(root, directory=True)
    disk = os.statvfs(root)
    present = set(run(['docker', 'volume', 'ls', '--format', '{{.Name}}']).splitlines())
    if not {'deploy_void-pgdata', 'deploy_void-logs'} <= present:
        raise ValueError('E_RESOURCE_VOLUME')
    usage = {}
    for volume in VOLUMES:
        if volume not in present:
            usage[volume] = 0
            continue
        path = Path(run(['docker', 'volume', 'inspect', '--format', '{{.Mountpoint}}', volume]))
        # Docker owns the parent, while the volume root belongs to its service UID.
        protected(path.parent, directory=True)
        info = path.lstat()
        if not path.is_relative_to(root / 'volumes') or not stat.S_ISDIR(info.st_mode):
            raise ValueError('E_RESOURCE_VOLUME_PATH')
        # Count allocated blocks; never follow symlinks or descend onto another filesystem.
        # A publisher/DB can unlink a file during traversal. Retry once before
        # treating a failed measurement as pressure; never accept partial output.
        for attempt in range(2):
            try:
                output = run(['du', '-sx', '--block-size=1', '--', str(path)], timeout=20)
                break
            except subprocess.CalledProcessError:
                if attempt:
                    raise
        match = re.fullmatch(r'(\d+)\s+[^\n]+', output)
        if not match:
            raise ValueError('E_RESOURCE_MEASURE')
        usage[volume] = int(match[1])
    return {'free_bytes': disk.f_bavail * disk.f_frsize,
            'free_inodes': disk.f_favail, 'usage': usage}


def decision(sample):
    values = [sample['free_bytes'], sample['free_inodes'], *sample['usage'].values()]
    if set(sample['usage']) != set(VOLUMES) or any(type(v) is not int or v < 0 for v in values):
        raise ValueError('E_RESOURCE_MEASURE')
    reasons, targets = [], set()
    warning = sample['free_bytes'] < 8 * GIB or sample['free_inodes'] < 2 * MIN_INODES
    if sample['free_bytes'] <= MIN_FREE or sample['free_inodes'] <= MIN_INODES:
        reasons.append('filesystem_reserve')
        targets.update(TARGETS)
    for name, (budget, owners) in VOLUMES.items():
        if sample['usage'][name] >= budget:
            reasons.append(name)
            targets.update(owners)
        warning |= sample['usage'][name] >= budget * 0.8
    return {'level': 2 if targets else 1 if warning else 0,
            'reasons': reasons, 'targets': sorted(targets)}


def stop(targets):
    if any(name not in TARGETS for name in targets):
        raise ValueError('E_RESOURCE_TARGET')
    rows = run(['docker', 'ps', '--no-trunc', '--format', '{{.ID}} {{.Names}}']).splitlines()
    running = {}
    for row in rows:
        identifier, name = row.split()
        if not re.fullmatch(r'[0-9a-f]{64}', identifier):
            raise ValueError('E_RESOURCE_CONTAINER')
        running[name] = identifier
    # Drain application writes before stopping databases. Preserve all data/volumes.
    databases = {PROD[1], STAGE[1]}
    failures = []
    for group in [[n for n in targets if n not in databases],
                  [n for n in targets if n in databases]]:
        identifiers = [running[n] for n in group if n in running]
        if identifiers:
            try:
                run(['docker', 'stop', '--time', '60', *identifiers], timeout=150)
            except Exception:
                failures.append('E_RESOURCE_STOP')
    if failures:
        raise RuntimeError('E_RESOURCE_STOP')


def measurement_failure(error):
    """Bounded cause metadata only: never persist command arguments or stderr."""
    kind = 'timeout' if isinstance(error, subprocess.TimeoutExpired) else \
        'command' if isinstance(error, subprocess.CalledProcessError) else \
        'os' if isinstance(error, OSError) else 'validation' if isinstance(error, ValueError) else 'other'
    command = getattr(error, 'cmd', None)
    operation = 'unknown'
    if isinstance(command, (list, tuple)) and command:
        if command[0] == 'du':
            operation = 'volume-size'
        elif command[0] == 'docker':
            if 'info' in command:
                operation = 'docker-root'
            elif 'volume' in command and 'inspect' in command:
                operation = 'volume-path'
            elif 'volume' in command and 'ls' in command:
                operation = 'volume-list'
    code = getattr(error, 'returncode', None)
    return {'kind': kind, 'operation': operation,
            'returncode': code if type(code) is int and -255 <= code <= 255 else None}


def enforce():
    sample, error, failure = None, False, None
    try:
        sample = measure()
        result = decision(sample)
        previous = read_pressure()
    except Exception as exception:
        error, previous = True, None
        failure = measurement_failure(exception)
        result = {'level': 2, 'reasons': ['measurement_failed'], 'targets': TARGETS[:]}
    if previous:
        result['targets'] = sorted(set(result['targets']) | set(previous['targets']))
        result['level'] = 2
        failure = previous.get('measurement_failure')
    if result['targets']:
        marker = {'at': int(time.time()), **result}
        if failure is not None:
            marker['measurement_failure'] = failure
        if previous:
            marker['first_detected_at'] = previous.get('first_detected_at', previous['at'])
            marker['reasons'] = sorted(set(marker['reasons']) | set(previous['reasons']))
        try:
            save(PRESSURE, marker)  # Durable intent before stopping any writer.
        except Exception:
            stop(result['targets'])
            raise
        stop(result['targets'])
    status = {'at': int(time.time()), **result, 'measurement_error': error,
              'measurement_failure': failure, 'sample': sample}
    save(STATE / 'status.json', status)
    if error:
        raise RuntimeError('E_RESOURCE_MEASURE')
    return status


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('action', choices=['check', 'enforce', 'resume'])
    args = parser.parse_args()
    if os.geteuid() != 0:
        raise ValueError('E_RESOURCE_ROOT')
    protected(DEPLOY_STATE, directory=True)
    protected(STATE, directory=True)
    if args.action == 'check':
        if read_pressure() or decision(measure())['level'] == 2:
            raise ValueError('E_RESOURCE_PRESSURE')
        return
    lock_path = DEPLOY_STATE / 'autoupdate.lock'
    if lock_path.exists():
        protected(lock_path)
    descriptor = os.open(lock_path, os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
    with os.fdopen(descriptor, 'w') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            if args.action == 'resume':
                raise ValueError('E_RESOURCE_DEPLOY_BUSY')
            print('{"resource_guard":"deployment_busy"}')
            return
        if args.action == 'resume':
            read_pressure()  # Validate a pre-existing marker before touching it.
            if decision(measure())['level'] != 0:
                raise ValueError('E_RESOURCE_NOT_RECOVERED')
            PRESSURE.unlink(missing_ok=True)
            sync_directory(PRESSURE.parent)
            print('{"resource_guard":"resume_allowed","containers_started":false}')
        else:
            status = enforce()
            print(json.dumps({'resource_guard': status['level'], 'blocked': bool(status['targets'])}))


if __name__ == '__main__':
    try:
        main()
    except Exception:
        print('E_RESOURCE_GUARD: inspect disk usage and protected guard status', file=sys.stderr)
        raise SystemExit(1)
