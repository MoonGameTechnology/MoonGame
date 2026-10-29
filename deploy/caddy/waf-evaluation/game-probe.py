import json
import os
from pathlib import Path
import secrets
import subprocess
import time
import urllib.request

BASE=Path(os.environ['WAF_WORKDIR']).resolve()
NETWORK='moongame-waf-game-'+secrets.token_hex(6)
EDGE=NETWORK+'-edge'
BACKEND=NETWORK+'-backend'
IMAGE='ghcr.io/moongametechnology/moongame@sha256:c22485ab652856256c8dfbcca4dd6c1c2c159eb07105df6f776be28092573a84'
def run(*args):
    return subprocess.check_output(list(args),stderr=subprocess.STDOUT,text=True,timeout=60).strip()
created=[]
network_created=False
try:
    run('docker','network','create','--internal',NETWORK)
    network_created=True
    created.append(BACKEND)
    run('docker','run','-d','--name',BACKEND,'--network',NETWORK,'--network-alias','backend',
        '--read-only','--cpus','0.75','--memory','512m','--memory-swap','512m','--pids-limit','64',
        '--cap-drop','ALL','--security-opt','no-new-privileges:true','--no-healthcheck',
        '--tmpfs','/tmp:rw,noexec,nosuid,size=32m','--log-opt','max-size=2m','--log-opt','max-file=1',
        '-e','HOST=0.0.0.0','-e','PORT=8081','-e','PROD=0','-e','GATE=1','-e','SEAT_LOCK=1',
        '-e','AUTH_JWT_SECRET='+secrets.token_hex(32),'-e','ALLOWED_ORIGINS=https://play.example.test:8443',
        '-e','TLS_KEY_FILE=/probe/backend.key','-e','TLS_CERT_FILE=/probe/backend.crt',
        '-v',f'{BASE}/backend.key:/probe/backend.key:ro','-v',f'{BASE}/backend.crt:/probe/backend.crt:ro',IMAGE)
    created.append(EDGE)
    run('docker','run','-d','--name',EDGE,'--network',NETWORK,'--read-only','--cpus','0.5',
        '--memory','512m','--memory-swap','512m','--pids-limit','128','--cap-drop','ALL',
        '--security-opt','no-new-privileges:true','--tmpfs','/tmp:rw,noexec,nosuid,size=64m',
        '--tmpfs','/data:rw,noexec,nosuid,size=16m','--tmpfs','/config:rw,noexec,nosuid,size=8m',
        '--log-opt','max-size=4m','--log-opt','max-file=1',
        '-v',f'{BASE}/build/caddy-patched:/usr/bin/caddy:ro','-v',f'{BASE}:/probe:ro',
        '-v',f'{BASE}/coraza:/coraza:ro','-v',f'{BASE}/coreruleset:/crs:ro',
        'caddy:2-alpine@sha256:eb4d35b7452d1ab6171fbdbe8d9275b2301dad6dad92115d91e19fb9b24d510f','caddy','run','--config','/probe/game-Caddyfile','--adapter','caddyfile')
    ip=json.loads(run('docker','inspect',EDGE))[0]['NetworkSettings']['Networks'][NETWORK]['IPAddress']
    opener=urllib.request.build_opener(urllib.request.ProxyHandler({}))
    for _ in range(100):
        try:
            if opener.open(f'http://{ip}:8080/ready',timeout=3).status==200: break
        except (OSError,urllib.error.URLError): pass
        time.sleep(.3)
    else: raise RuntimeError('game did not become ready')
    subprocess.run(['node',str(Path(__file__).with_name('game-smoke.mjs')),str(Path(__file__).resolve().parents[3]),ip,str(BASE)],check=True,timeout=180)
finally:
    try:
        for name in reversed(created):
            logs=subprocess.run(['docker','logs',name],capture_output=True,text=True,timeout=15)
            (BASE/('game-edge.log' if name==EDGE else 'game-backend.log')).write_text(logs.stdout+logs.stderr)
    finally:
        for name in reversed(created):
            subprocess.run(['docker','rm','-f',name],capture_output=True,timeout=30)
        if network_created: subprocess.run(['docker','network','rm',NETWORK],capture_output=True,timeout=30)
