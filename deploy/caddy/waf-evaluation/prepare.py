#!/usr/bin/env python3
"""Prepare an isolated evaluation; never change production configuration."""
import hashlib
import os
from pathlib import Path
import shutil
import subprocess

HERE = Path(__file__).resolve().parent
BASE = Path(os.environ['WAF_WORKDIR']).resolve()
if BASE.exists():
    raise SystemExit('WAF_WORKDIR must be a new directory outside the repository')
if HERE.parents[2] == BASE or HERE.parents[2] in BASE.parents:
    raise SystemExit('Keep generated keys, source checkouts and logs outside the repository')
BASE.mkdir(mode=0o700, parents=True)
BUILDER = 'caddy:2-builder-alpine@sha256:ef9b65adf9a224770c6d5f6d1ae1bf99bc3caaa78d8c4bae3ea949ee6984f301'
RUNTIME = 'caddy:2-alpine@sha256:eb4d35b7452d1ab6171fbdbe8d9275b2301dad6dad92115d91e19fb9b24d510f'


def run(*args, cwd=None):
    subprocess.run(args, cwd=cwd, check=True, timeout=1800)


for name in ['Caddyfile', 'policy.conf', 'backend.mjs']:
    shutil.copyfile(HERE / name, BASE / name)
(BASE / 'game-Caddyfile').write_text((BASE / 'Caddyfile').read_text()
    .replace('/probe/policy.conf', '/probe/game-policy.conf')
    .replace('MoonGame-WAF-probe-1', 'MoonGame-WAF-game-1'))
shutil.copyfile(BASE / 'policy.conf', BASE / 'game-policy.conf')
for repo, tag, commit, name in [
    ('corazawaf/coraza', 'v3.8.1', '9f8521398d1ff023b958fad0b944cac265763866', 'coraza'),
    ('corazawaf/coraza-caddy', 'v2.6.2', '82b47274c867754b5c91285b2671dfb2f6e2690f', 'coraza-caddy'),
]:
    run('git', 'clone', '--quiet', '--depth', '1', '--branch', tag,
        f'https://github.com/{repo}.git', str(BASE / name))
    actual = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=BASE / name, text=True).strip()
    if actual != commit:
        raise SystemExit(f'{name}: tag no longer matches reviewed commit')
run('git', 'apply', '--check', str(HERE / 'connector.patch'), cwd=BASE / 'coraza-caddy')
run('git', 'apply', str(HERE / 'connector.patch'), cwd=BASE / 'coraza-caddy')
archive = BASE / 'crs.tar.gz'
download = subprocess.run([
    'curl', '--disable', '--proto', '=https', '--tlsv1.2', '--fail', '--silent', '--show-error',
    '--max-time', '60', '--max-filesize', '2097152', '--output', str(archive),
    '--write-out', '%{http_code}',
    'https://codeload.github.com/coreruleset/coreruleset/tar.gz/e03a4f6dabc7a30ebd8c52c97d28a154f590a48f',
], check=True, capture_output=True, text=True, timeout=65)
if download.stdout != '200':
    raise SystemExit(f'CRS download failed: HTTP {download.stdout}; redirects are not followed')
payload = archive.read_bytes()
if hashlib.sha256(payload).hexdigest() != 'bdd0dec65d47fcae5aaa48aa681e0f4c151a8c1d9eb3040f6f65ebb8b2273c75':
    raise SystemExit('CRS source checksum mismatch')
(BASE / 'coreruleset').mkdir()
run('tar', '-xzf', str(archive), '--strip-components=1', '-C', str(BASE / 'coreruleset'))

# Disposable fixture PKI. Only its directory is mounted into test containers.
run('openssl', 'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '2',
    '-subj', '/CN=MoonGame disposable WAF test CA', '-addext', 'basicConstraints=critical,CA:TRUE',
    '-addext', 'keyUsage=critical,keyCertSign,cRLSign',
    '-keyout', str(BASE / 'test-ca.key'), '-out', str(BASE / 'test-ca.crt'))
for name, hostname in [('edge', 'play.example.test'), ('backend', 'backend')]:
    run('openssl', 'req', '-newkey', 'rsa:2048', '-nodes', '-subj', f'/CN={hostname}',
        '-keyout', str(BASE / f'{name}.key'), '-out', str(BASE / f'{name}.csr'))
    (BASE / f'{name}.ext').write_text(f'basicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\nsubjectKeyIdentifier=hash\nauthorityKeyIdentifier=keyid,issuer\nsubjectAltName=DNS:{hostname}\n')
    run('openssl', 'x509', '-req', '-in', str(BASE / f'{name}.csr'), '-days', '2',
        '-CA', str(BASE / 'test-ca.crt'), '-CAkey', str(BASE / 'test-ca.key'), '-CAcreateserial',
        '-extfile', str(BASE / f'{name}.ext'), '-out', str(BASE / f'{name}.crt'))
    # Non-root Node reads the synthetic mounted key; the parent remains 0700.
    (BASE / f'{name}.key').chmod(0o644)
for directory in ['build', 'h3-client']:
    (BASE / directory).mkdir()
CACHE = Path(os.environ.get('WAF_BUILD_CACHE', str(BASE))).resolve()
for directory in ['go-cache', 'go-modules']:
    (CACHE / directory).mkdir(parents=True, exist_ok=True)
shutil.copyfile(HERE / 'h3-client.go', BASE / 'h3-client' / 'main.go')
(BASE / 'h3-client' / 'go.mod').write_text('module moongame-waf-evaluation\n\ngo 1.27.0\n')

docker = ['docker', 'run', '--rm', '--cpus', '1', '--memory', '1536m', '--memory-swap', '1536m',
    '--pids-limit', '256', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges:true',
    '-e', 'GOMAXPROCS=1', '-e', 'GOFLAGS=-p=1', '-e', 'GOMEMLIMIT=1GiB',
    '-e', 'XCADDY_SETCAP=0', '-e', 'GOCACHE=/cache', '-e', 'GOMODCACHE=/gomod',
    '-v', f'{CACHE}/go-cache:/cache', '-v', f'{CACHE}/go-modules:/gomod', '-v', f'{BASE}:/src']
run(*docker, BUILDER, 'xcaddy', 'build', 'v2.11.7', '--output', '/src/build/caddy-patched',
    '--with', 'github.com/corazawaf/coraza-caddy/v2@v2.6.2=/src/coraza-caddy',
    '--with', 'golang.org/x/net/http2@v0.60.0', '--with', 'github.com/go-chi/chi/v5@v5.4.0')
run(*docker, '-w', '/src/h3-client', BUILDER, 'go', 'get', 'github.com/quic-go/quic-go/http3@v0.63.0',
    'golang.org/x/crypto@v0.57.0', 'golang.org/x/net@v0.60.0', 'golang.org/x/sys@v0.48.0', 'golang.org/x/text@v0.42.0')
run(*docker, '-w', '/src/h3-client', BUILDER, 'go', 'build', '-o', '/src/build/h3-client', '.')
run(*docker, '-w', '/src/coraza-caddy', BUILDER, 'go', 'test', '-count=1', './...')
# Upstream audit-log permission tests require a non-writable root filesystem.
run(*docker, '--read-only', '--tmpfs', '/tmp:rw,exec,nosuid,size=512m', '-w', '/src/coraza',
    BUILDER, 'go', 'test', '-count=1', './internal/bodyprocessors', './internal/transformations',
    './internal/corazawaf', './internal/auditlog')
run('docker', 'pull', RUNTIME)
print('Prepared. Run probe.py and game-probe.py sequentially with the same WAF_WORKDIR.')
