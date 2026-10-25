#!/usr/bin/env python3
"""Bounded, isolated probes. No real accounts, secrets, or production volumes."""
import concurrent.futures
import hashlib
import http.client
import json
import os
from pathlib import Path
import socket
import ssl
import struct
import subprocess
import time
import urllib.parse

BASE = Path(os.environ['WAF_WORKDIR']).resolve()
NETWORK = 'moongame-waf-review-' + os.urandom(6).hex()
EDGE = NETWORK + '-edge'
BACKEND = NETWORK + '-backend'
SERVER_IMAGE = 'ghcr.io/moongametechnology/moongame@sha256:c22485ab652856256c8dfbcca4dd6c1c2c159eb07105df6f776be28092573a84'
CADDY_IMAGE = 'caddy:2-alpine@sha256:eb4d35b7452d1ab6171fbdbe8d9275b2301dad6dad92115d91e19fb9b24d510f'
RESULTS = []
HOST = '127.0.0.1'
BINARY = os.environ.get('WAF_BINARY', 'caddy')


def run(*args, timeout=60):
    return subprocess.check_output(list(args), text=True, stderr=subprocess.STDOUT, timeout=timeout).strip()


def record(name, passed, **evidence):
    item = {'case': name, 'passed': bool(passed), **evidence}
    RESULTS.append(item)
    print(json.dumps(item), flush=True)


def request(port, method='GET', path='/health', body=None, headers=None):
    connection = http.client.HTTPConnection(HOST, port, timeout=12)
    try:
        connection.request(method, path, body=body, headers={
            'Host': 'play.example.test', 'User-Agent': 'MoonGame-WAF-probe',
            'Accept': '*/*', **(headers or {})})
        response = connection.getresponse()
        payload = response.read()
        return response.status, payload
    finally:
        connection.close()


def case(port, name, expected, method='GET', path='/health', body=None, headers=None, expected_body=None):
    headers = {'User-Agent': 'MoonGame-WAF-probe', 'Accept': '*/*', 'X-Probe-ID': name, **(headers or {})}
    before = json.loads(request(port, path='/stats')[1]).get(name, 0)
    start = time.monotonic()
    status, response = request(port, method, path, body, headers)
    after = json.loads(request(port, path='/stats')[1]).get(name, 0)
    blocked = status >= 400
    body_matches = expected_body is None or response == expected_body
    body_evidence = {} if expected_body is None else {
        'expected_response_bytes': len(expected_body),
        'response_sha256': hashlib.sha256(response).hexdigest(),
        'expected_response_sha256': hashlib.sha256(expected_body).hexdigest(),
    }
    record(name, status in expected and (not blocked or after == before) and body_matches,
           status=status, expected=expected, reached_backend=after > before,
           ms=round((time.monotonic() - start) * 1000, 2), response_bytes=len(response), **body_evidence)


def websocket(port, secure=False):
    sock = socket.create_connection((HOST, port), 10)
    if secure:
        context = ssl.create_default_context(cafile=str(BASE / 'test-ca.crt'))
        sock = context.wrap_socket(sock, server_hostname='play.example.test')
    prefix = 'wss' if secure else 'websocket'
    sock.settimeout(10)
    try:
        sock.sendall(b'GET /ws HTTP/1.1\r\nHost: play.example.test\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\nUser-Agent: MoonGame-WAF-probe\r\nAccept: */*\r\n\r\n')
        headers = b''
        while b'\r\n\r\n' not in headers:
            chunk = sock.recv(4096)
            if not chunk: raise ConnectionError('EOF during websocket handshake')
            headers += chunk
            if len(headers) > 32768: raise RuntimeError('oversized handshake')
        record(prefix + '-upgrade', headers.startswith(b'HTTP/1.1 101'))
        if not headers.startswith(b'HTTP/1.1 101'): return
        payload = b"' OR 1=1 -- <script>alert(1)</script>"
        mask = b'ABCD'
        frame = bytes([0x81, 0x80 | len(payload)]) + mask + bytes(c ^ mask[i % 4] for i, c in enumerate(payload))
        if secure:
            time.sleep(12)  # Exceeds the HTTP read_body timeout after upgrade.
        sock.sendall(frame)
        data = b''
        while len(data) < len(payload) + 2:
            chunk = sock.recv(4096)
            if not chunk: raise ConnectionError('EOF before websocket echo')
            data += chunk
        record(prefix + '-frames-outside-waf', data[2:] == payload,
               interpretation='Expected boundary: the WAF does not inspect upgraded frames')
    finally:
        sock.close()


def benchmark(port, label):
    def one(_):
        start = time.monotonic()
        status, _ = request(port)
        return status, (time.monotonic() - start) * 1000
    start = time.monotonic()
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        samples = list(pool.map(one, range(200)))
    elapsed = time.monotonic() - start
    timings = sorted(ms for _, ms in samples)
    record(label, all(status == 200 for status, _ in samples), requests=200,
           concurrency=4, seconds=round(elapsed, 3), p50_ms=round(timings[100], 2),
           p95_ms=round(timings[189], 2), max_ms=round(timings[-1], 2))


def main():
    global HOST
    created = []
    network_created = False
    original_policy = (BASE / 'policy.conf').read_text()
    original_caddy = (BASE / 'Caddyfile').read_text()
    try:
        run('docker', 'network', 'create', '--internal', NETWORK)
        network_created = True
        created.append(BACKEND)
        run('docker', 'run', '-d', '--name', BACKEND, '--network', NETWORK,
            '--network-alias', 'backend', '--read-only', '--cpus', '0.25', '--memory', '128m',
            '--memory-swap', '128m', '--pids-limit', '32', '--cap-drop', 'ALL',
            '--security-opt', 'no-new-privileges:true', '--no-healthcheck',
            '--log-opt', 'max-size=1m', '--log-opt', 'max-file=1',
            '-v', f'{BASE}/backend.mjs:/probe/backend.mjs:ro',
            '-v', f'{BASE}/backend.key:/probe/backend.key:ro',
            '-v', f'{BASE}/backend.crt:/probe/backend.crt:ro', SERVER_IMAGE, '/probe/backend.mjs')
        created.append(EDGE)
        run('docker', 'run', '-d', '--name', EDGE, '--network', NETWORK,
            '--read-only', '--cpus', '0.5', '--memory', '512m', '--memory-swap', '512m',
            '--pids-limit', '128', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges:true',
            '--tmpfs', '/tmp:rw,noexec,nosuid,size=64m', '--tmpfs', '/data:rw,noexec,nosuid,size=16m',
            '--tmpfs', '/config:rw,noexec,nosuid,size=8m', '--log-opt', 'max-size=4m', '--log-opt', 'max-file=1',
            '-v', f'{BASE}/build/{BINARY}:/usr/bin/caddy:ro',
            '-v', f'{BASE}:/probe:ro', '-v', f'{BASE}/coraza:/coraza:ro', '-v', f'{BASE}/coreruleset:/crs:ro',
            CADDY_IMAGE, 'caddy', 'run', '--config', '/probe/Caddyfile', '--adapter', 'caddyfile')
        info = json.loads(run('docker', 'inspect', EDGE))[0]
        HOST = info['NetworkSettings']['Networks'][NETWORK]['IPAddress']
        port = 8080
        ready = False
        for _ in range(100):
            try:
                ready = request(port)[0] == 200
                if ready: break
            except (ConnectionError, OSError, http.client.HTTPException): pass
            time.sleep(0.2)
        if not ready:
            raise RuntimeError('edge did not become ready; inspect private edge.log')
        record('startup', True, caddy_version=run('docker', 'exec', EDGE, 'caddy', 'version'))
        curl = ['curl', '--noproxy', '*', '--silent', '--show-error', '--max-time', '10',
                '--resolve', f'play.example.test:8443:{HOST}', '--cacert', str(BASE / 'test-ca.crt'),
                '--output', '/dev/null', '--write-out', '%{http_code} %{http_version}',
                '--http2', 'https://play.example.test:8443/health']
        response = run(*curl)
        record('tls-http2-and-verified-tls-upstream', response == '200 2', response=response)
        oversized = subprocess.run([*curl, '-H', 'X-Fill: ' + 'a' * 24000], capture_output=True, text=True, timeout=15)
        healthy = request(port)[0] == 200
        record('http2-oversize-headers', healthy and (oversized.stdout.startswith('431 ') or oversized.returncode == 16),
               status=oversized.stdout, curl_exit=oversized.returncode, healthy_after=healthy)
        def h3(path, header_size=0):
            return json.loads(run('docker', 'exec', EDGE, '/probe/build/h3-client', f'{HOST}:8443',
                                  '/probe/test-ca.crt', path, str(header_size)))
        res = h3('/health')
        record('http3-normal', res.get('status') == 200 and res.get('protocol') == 'HTTP/3.0', evidence=res)
        res = h3('/probe?q=%27%20OR%201%3D1%20--')
        record('http3-sqli-blocked', res.get('status') == 403, evidence=res)
        res = h3('/health', 24000)
        healthy = request(port)[0] == 200
        record('http3-oversize-headers', res.get('status') == 431 and healthy,
               evidence=res, healthy_after=healthy)
        case(port, 'normal-json', [200], 'POST', '/auth/login',
             json.dumps({'username': "O'Connor", 'password': 'Moon light & stars 2026!'}), {'Content-Type': 'application/json'})
        case(port, 'android-user-agent', [200], headers={'User-Agent': 'Dalvik/2.1.0 (Linux; U; Android 15; Pixel 8 Build/AP3A)'})
        case(port, 'cors-preflight', [200], 'OPTIONS', '/auth/login', headers={
            'Origin': 'https://play.example.test', 'Access-Control-Request-Method': 'POST',
            'Access-Control-Request-Headers': 'authorization,content-type'})
        for method in ['PUT', 'PATCH', 'DELETE']:
            case(port, 'unsupported-method-' + method.lower(), [403], method, '/probe')
        case(port, 'normal-head', [200], 'HEAD')
        case(port, 'large-download', [200], path='/large', expected_body=b'A' * (2 * 1024 * 1024))
        attack = "' OR 1=1 --"
        case(port, 'sqli-query', [403], path='/search?q=' + urllib.parse.quote(attack))
        case(port, 'xss-query', [403], path='/search?q=' + urllib.parse.quote('<script>alert(1)</script>'))
        case(port, 'pl1-short-command-signature-gap', [200], path='/files/x%3Bid')
        case(port, 'path-shell-expression', [403], path='/files/' + urllib.parse.quote('$(whoami)', safe=''))
        case(port, 'file-traversal', [403], path='/search?file=..%2F..%2Fetc%2Fpasswd')
        for name, body in [
            ('json-sqli', {'account': {'role': attack}}),
            ('json-dotted-collision', {'account': {'role': attack}, 'account.role': 'safe'}),
            ('json-case-collision', {'account': {'role': attack, 'Role': 'safe'}}),
        ]:
            case(port, name, [403], 'POST', '/probe', json.dumps(body), {'Content-Type': 'application/json'})
        case(port, 'form-content-type-parameter', [403], 'POST', '/probe',
             urllib.parse.urlencode({'q': attack}), {'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8'})
        case(port, 'mixed-case-forbidden-charset', [403], 'POST', '/probe', 'q=hello',
             {'Content-Type': 'application/x-www-form-urlencoded; CHARSET=utf-7'})
        case(port, 'get-argument-overflow', [400], path='/probe?' + '&'.join(f'a{i}=1' for i in range(1002)))
        case(port, 'json-argument-overflow', [400], 'POST', '/probe',
             json.dumps({f'a{i}': '1' for i in range(1002)}), {'Content-Type': 'application/json'})
        case(port, 'deep-json', [400], 'POST', '/probe', '[' * 2000 + '0' + ']' * 2000,
             {'Content-Type': 'application/json'})
        case(port, 'truncated-json', [400], 'POST', '/probe', '{"a":', {'Content-Type': 'application/json'})
        case(port, 'xml-attribute-injection', [400, 403], 'POST', '/probe',
             '<a value="&apos; OR 1=1 --"/>', {'Content-Type': 'application/xml'})
        case(port, 'multipart-parser-no-fatal-exit', [400, 403], 'POST', '/probe',
             'x', {'Content-Type': 'multipart/form-data; a=1; a=2'})
        case(port, 'multipart-truncated', [400], 'POST', '/probe',
             '--probe\r\nContent-Disposition: form-data; name="file"; filename="ok.txt"\r\n\r\nx',
             {'Content-Type': 'multipart/form-data; boundary=probe'})
        multipart = '--probe\r\nContent-Disposition: form-data; name="file"; filename="shell.php"\r\nContent-Type: application/octet-stream\r\n\r\nx\r\n--probe--\r\n'
        case(port, 'multipart-dangerous-extension', [403], 'POST', '/probe', multipart,
             {'Content-Type': 'multipart/form-data; boundary=probe'})
        case(port, 'oversize-body', [413], 'POST', '/probe', 'x' * (1048576 + 1), {'Content-Type': 'application/json'})
        case(port, 'oversize-headers', [431], headers={'X-Fill': 'a' * 24000})
        websocket(port)
        websocket(8443, secure=True)
        canary = 'WAF_SYNTHETIC_' + os.urandom(12).hex()
        case(port, 'synthetic-log-secret', [403], path='/probe?q=' + urllib.parse.quote(attack) + '&token=' + canary)
        case(port, 'synthetic-body-secret', [403], 'POST', '/probe', json.dumps({'password': canary + ' ' + attack}), {'Content-Type': 'application/json'})
        case(port, 'synthetic-header-secret', [403], path='/probe?q=' + urllib.parse.quote(attack), headers={'Authorization': 'Bearer ' + canary})
        logs = run('docker', 'logs', EDGE)
        record('log-privacy', canary not in logs, synthetic_secret_found=canary in logs)
        benchmark(port, 'bounded-benchmark-waf-on')
        # Included files alone are absent from the module's global WAF pool key.
        (BASE / 'policy.conf').write_text(original_policy + '\nSecRule REQUEST_URI "@streq /reload-probe" "id:100500,phase:1,deny,status:403,nolog"\n')
        run('docker', 'exec', EDGE, 'caddy', 'reload', '--config', '/probe/Caddyfile', '--adapter', 'caddyfile', '--force')
        status, _ = request(port, path='/reload-probe')
        record('included-policy-reload-stale-boundary', status == 200, status=status,
               interpretation='Confirmed unsafe file-only reload: old policy remains. Require revision change or recreate.')
        (BASE / 'Caddyfile').write_text(original_caddy.replace('MoonGame-WAF-probe-1', 'MoonGame-WAF-probe-2'))
        run('docker', 'exec', EDGE, 'caddy', 'reload', '--config', '/probe/Caddyfile', '--adapter', 'caddyfile', '--force')
        status, _ = request(port, path='/reload-probe')
        record('versioned-policy-reload', status == 403, status=status)
        pl3 = original_policy.replace('Include /crs/crs-setup.conf.example',
            'SecAction "id:900000,phase:1,pass,nolog,setvar:tx.blocking_paranoia_level=3,setvar:tx.detection_paranoia_level=3"\nInclude /crs/crs-setup.conf.example')
        (BASE / 'policy.conf').write_text(pl3)
        (BASE / 'Caddyfile').write_text(original_caddy.replace('MoonGame-WAF-probe-1', 'MoonGame-WAF-probe-pl3'))
        run('docker', 'exec', EDGE, 'caddy', 'reload', '--config', '/probe/Caddyfile', '--adapter', 'caddyfile', '--force')
        case(port, 'pl3-short-command-detected', [403], path='/files/x%3Bid')
        # DetectionOnly must not be presented as an enforcing security boundary.
        (BASE / 'policy.conf').write_text(original_policy.replace('SecRuleEngine On', 'SecRuleEngine DetectionOnly'))
        (BASE / 'Caddyfile').write_text(original_caddy.replace('MoonGame-WAF-probe-1', 'MoonGame-WAF-probe-detection'))
        run('docker', 'exec', EDGE, 'caddy', 'reload', '--config', '/probe/Caddyfile', '--adapter', 'caddyfile', '--force')
        case(port, 'detection-only-allows-attack', [200], path='/probe?q=' + urllib.parse.quote(attack))
        case(port, 'detection-only-normal-json', [200], 'POST', '/auth/login',
             json.dumps({'username': 'Test', 'password': 'Moon light & stars 2026!'}), {'Content-Type': 'application/json'})
        case(port, 'detection-only-secret-canary', [200], path='/probe?q=' + urllib.parse.quote(attack) + '&token=' + canary)
        case(port, 'detection-only-oversize-body', [413], 'POST', '/probe', 'x' * (1048576 + 1), {'Content-Type': 'application/json'})
        record('detection-log-privacy', canary not in run('docker', 'logs', EDGE))
        (BASE / 'Caddyfile').write_text(original_caddy.replace('tls_server_name backend', 'tls_server_name wrong-backend')
                                      .replace('MoonGame-WAF-probe-1', 'MoonGame-WAF-probe-badname'))
        run('docker', 'exec', EDGE, 'caddy', 'reload', '--config', '/probe/Caddyfile', '--adapter', 'caddyfile', '--force')
        status, _ = request(port)
        record('wrong-upstream-certificate-name-rejected', status == 502, status=status)
        (BASE / 'policy.conf').write_text(original_policy.replace('SecRuleEngine On', 'SecRuleEngine Off'))
        (BASE / 'Caddyfile').write_text(original_caddy.replace('MoonGame-WAF-probe-1', 'MoonGame-WAF-probe-off'))
        run('docker', 'exec', EDGE, 'caddy', 'reload', '--config', '/probe/Caddyfile', '--adapter', 'caddyfile', '--force')
        benchmark(port, 'bounded-benchmark-waf-off')
        info = json.loads(run('docker', 'inspect', EDGE))[0]
        record('container-no-oom', not info['State']['OOMKilled'], restart_count=info['RestartCount'])
    finally:
        try:
            if EDGE in created:
                logs = subprocess.run(['docker', 'logs', EDGE], capture_output=True, text=True, timeout=15)
                (BASE / 'edge.log').write_text(logs.stdout + logs.stderr)
            (BASE / 'policy.conf').write_text(original_policy)
            (BASE / 'Caddyfile').write_text(original_caddy)
            (BASE / 'probe-results.json').write_text(json.dumps(RESULTS, indent=2) + '\n')
        finally:
            for name in reversed(created):
                subprocess.run(['docker', 'rm', '-f', name], capture_output=True, timeout=30)
            if network_created:
                subprocess.run(['docker', 'network', 'rm', NETWORK], capture_output=True, timeout=30)


if __name__ == '__main__':
    main()
    raise SystemExit(0 if RESULTS and all(x['passed'] for x in RESULTS) else 1)
