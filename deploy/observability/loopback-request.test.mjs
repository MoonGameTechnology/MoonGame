import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFile, execFileSync } from 'node:child_process';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import https from 'node:https';
import { once } from 'node:events';
import { loopbackRequestFromEnv } from './loopback-request.mjs';

let tools = true;
try {
  execFileSync('openssl', ['version'], { stdio: 'pipe' });
  execFileSync('python3', ['--version'], { stdio: 'pipe' });
} catch {
  tools = false;
}
if (process.env.CI && !tools)
  throw new Error('Transport integration requires Python3/OpenSSL in CI');

describe.skipIf(!tools)('verified local operator transport', () => {
  let root, server, port;
  const pki = fileURLToPath(new URL('../transport/pki.py', import.meta.url));
  const env = () => ({
    GAME_METRICS_TLS_CA_FILE: join(root, 'pki/public/ca.crt'),
    GAME_METRICS_TLS_SERVERNAME: 'transport-app',
  });
  beforeAll(async () => {
    root = mkdtempSync(join(tmpdir(), 'transport-test-'));
    chmodSync(root, 0o700);
    const profile = {
      name: 'test',
      directory: join(root, 'pki'),
      app: {
        service: 'server',
        container: 'test-app',
        dns: ['transport-app', 'localhost'],
        uid: process.getuid(),
      },
      db: {
        service: 'postgres',
        container: 'test-db',
        dns: ['transport-db', 'localhost'],
        uid: process.getuid(),
      },
      front_network: 'test-front',
      db_network: 'test-db',
    };
    const file = join(root, 'profile.json');
    writeFileSync(file, JSON.stringify(profile), { mode: 0o600 });
    execFileSync('python3', [pki, 'prepare', file], { stdio: 'pipe' });
    server = https.createServer(
      {
        key: readFileSync(join(root, 'pki/app/server.key')),
        cert: readFileSync(join(root, 'pki/app/server.crt')),
      },
      (_req, res) => {
        res.end('{"ok":true}');
      },
    );
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    port = server.address().port;
  });
  afterAll(async () => {
    if (server) {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    }
    if (root) rmSync(root, { recursive: true, force: true });
  });
  it('encrypts the fixed loopback request and verifies its CA and hostname', async () => {
    const response = await loopbackRequestFromEnv(env())(`http://127.0.0.1:${port}/health`);
    const chunks = [];
    for await (const chunk of response.body) chunks.push(chunk);
    expect(JSON.parse(Buffer.concat(chunks).toString())).toEqual({ ok: true });
  });
  it('rejects a valid certificate with the wrong server identity', async () => {
    await expect(
      loopbackRequestFromEnv({ ...env(), GAME_METRICS_TLS_SERVERNAME: 'wrong-name.invalid' })(
        `http://127.0.0.1:${port}/health`,
      ),
    ).rejects.toThrow('E_OBS_SOURCE');
  });
  it('rejects a server signed by an untrusted CA', async () => {
    const request = loopbackRequestFromEnv({
      ...env(),
      GAME_METRICS_TLS_CA_FILE: '/etc/ssl/certs/ca-certificates.crt',
    });
    await expect(request(`http://127.0.0.1:${port}/health`)).rejects.toThrow('E_OBS_SOURCE');
  });
  it('never sends the operator bearer to a remote destination', async () => {
    await expect(
      loopbackRequestFromEnv(env())('https://remote.invalid/metrics', {
        headers: { Authorization: 'Bearer fixture' },
      }),
    ).rejects.toThrow('E_OBS_SOURCE');
  });
  it('fails closed instead of downgrading when native TLS has no configured CA', () => {
    expect(() => loopbackRequestFromEnv({ TLS_CERT_FILE: '/certs/server.crt' })).toThrow(
      'E_OBS_TLS_CONFIG',
    );
  });
  it('generates private, UID-owned keys and a backend-only database network', () => {
    const overlay = readFileSync(join(root, 'pki/compose.yml'), 'utf8');
    expect(overlay).toContain('PGSSLMODE: verify-full');
    expect(overlay).toContain('networks: !override [transport-db]');
    expect(overlay).not.toContain('/private');
    const leaf = statSync(join(root, 'pki/app/server.key'));
    expect(leaf.uid).toBe(process.getuid());
    expect(leaf.mode & 0o777).toBe(0o400);
    expect(statSync(join(root, 'pki/private')).mode & 0o777).toBe(0o700);
    expect(readFileSync(join(root, 'pki/pg_hba.conf'), 'utf8')).toContain(
      'hostnossl all all 0.0.0.0/0 reject',
    );
    const result = execFileSync('python3', [pki, 'prepare', join(root, 'profile.json')], {
      encoding: 'utf8',
    });
    expect(JSON.parse(result).renewed).toEqual([]);
  });
  it('runs the real shell health probe with certificate and identity verification', async () => {
    const shell = fileURLToPath(new URL('../release-state.sh', import.meta.url));
    const file = join(root, 'health.env');
    const config = `TLS_CERT_FILE=/transport/server.crt\nPORT=${port}\nLOCAL_TLS_CA_FILE=${env().GAME_METRICS_TLS_CA_FILE}\n`;
    writeFileSync(file, config + 'HEALTHCHECK_TLS_SERVERNAME=transport-app\n');
    const run = () =>
      promisify(execFile)('bash', [
        '-c',
        '. "$1"; release_local_probe "$2" /health',
        'probe',
        shell,
        file,
      ]);
    expect(JSON.parse((await run()).stdout)).toEqual({ ok: true });
    writeFileSync(file, config + 'HEALTHCHECK_TLS_SERVERNAME=wrong.invalid\n');
    await expect(run()).rejects.toMatchObject({ code: 60 });
  });
  it('preserves a checked playtest deferral and refuses unverified required backups', () => {
    const transport = fileURLToPath(new URL('../transport', import.meta.url));
    const deploy = fileURLToPath(new URL('../', import.meta.url));
    const file = join(root, 'server.env');
    const base = 'PROD=1\nDB_AUTO_MIGRATE=0\nDB_REQUIRE_LEAST_PRIVILEGE=1\n';
    const script =
      'import sys,json; from pathlib import Path; sys.path.insert(0,sys.argv[1]); from activate import preflight_environment; print(json.dumps(preflight_environment(Path(sys.argv[2]),Path(sys.argv[3]))))';
    const run = () =>
      execFileSync('python3', ['-c', script, transport, deploy, root], {
        encoding: 'utf8',
        stdio: 'pipe',
        env: { ...process.env, STATE_DIR: root },
      });
    writeFileSync(file, base + 'BACKUP_POLICY=deferred-playtest\n');
    expect(JSON.parse(run())).toEqual({
      BACKUP_READINESS_VERIFIED: '0',
      BACKUP_READINESS_DEFERRED: '1',
    });
    writeFileSync(file, base + 'BACKUP_POLICY=required\n');
    expect(run).toThrow();
  });
  it('rejects an operator profile writable by other users before generating a key', () => {
    const file = join(root, 'unsafe.json');
    writeFileSync(file, readFileSync(join(root, 'profile.json')), { mode: 0o666 });
    chmodSync(file, 0o666);
    expect(() => execFileSync('python3', [pki, 'prepare', file], { stdio: 'pipe' })).toThrow();
  });
  it('refuses PKI inside an output parent replaceable by another host user', () => {
    const shared = join(root, 'shared');
    mkdirSync(shared);
    chmodSync(shared, 0o777);
    const profile = JSON.parse(readFileSync(join(root, 'profile.json'), 'utf8'));
    profile.directory = join(shared, 'pki');
    const file = join(root, 'unsafe-output.json');
    writeFileSync(file, JSON.stringify(profile), { mode: 0o600 });
    expect(() => execFileSync('python3', [pki, 'prepare', file], { stdio: 'pipe' })).toThrow();
  });
  it('makes leaf directories traversable under a private operator umask', () => {
    const profile = JSON.parse(readFileSync(join(root, 'profile.json'), 'utf8'));
    profile.directory = join(root, 'private-umask');
    const file = join(root, 'private-umask.json');
    writeFileSync(file, JSON.stringify(profile), { mode: 0o600 });
    const script =
      'import sys,os;sys.path.insert(0,sys.argv[1]);import pki;os.umask(0o077);pki.prepare(pki.profile_from_file(sys.argv[2]))';
    execFileSync(
      'python3',
      ['-c', script, fileURLToPath(new URL('../transport', import.meta.url)), file],
      { stdio: 'pipe' },
    );
    expect(statSync(profile.directory).mode & 0o777).toBe(0o700);
    for (const role of ['app', 'db']) {
      expect(statSync(join(profile.directory, role)).mode & 0o777).toBe(0o755);
      expect(statSync(join(profile.directory, role, 'server.key')).mode & 0o777).toBe(0o400);
    }
  });
  it.each(['inspect', 'restart', 'exec'])(
    'retries certificate application after Docker %s fails',
    (operation) => {
      const profile = JSON.parse(readFileSync(join(root, 'profile.json'), 'utf8'));
      profile.directory = join(root, 'retry-' + operation);
      const file = join(root, 'retry-' + operation + '.json');
      writeFileSync(file, JSON.stringify(profile), { mode: 0o600 });
      const script = `import sys,json
from pathlib import Path
sys.path.insert(0,sys.argv[1])
import pki
p=pki.profile_from_file(sys.argv[2]); pki.prepare(p)
original=pki.command; failed=False; calls=[]
def command(*args):
    global failed
    if args[0]!='docker': return original(*args)
    calls.append(args[1])
    if args[1]==sys.argv[3] and not failed:
        failed=True
        raise RuntimeError('fixture temporary failure')
    return b'true' if args[1]=='inspect' else b''
pki.command=command
try: pki.apply_pending(p)
except RuntimeError: pass
pending=json.loads((Path(p['directory'])/'pending.json').read_text())
issued=pki.prepare(p); calls.clear(); pki.apply_pending(p)
print(json.dumps({'pendingAfterFailure':pending,'issuedOnRetry':issued,'retryCalls':calls,'remaining':json.loads((Path(p['directory'])/'pending.json').read_text())}))`;
      const result = JSON.parse(
        execFileSync(
          'python3',
          ['-c', script, fileURLToPath(new URL('../transport', import.meta.url)), file, operation],
          { encoding: 'utf8', stdio: 'pipe' },
        ),
      );
      expect(result.pendingAfterFailure.length).toBeGreaterThan(0);
      expect(result.issuedOnRetry).toEqual([]);
      expect(result.retryCalls.length).toBeGreaterThan(0);
      expect(result.remaining).toEqual([]);
    },
  );
  it.each(['ssl=no-verify', 'ssl=', 'sslmode=require', 'sslrootcert=%2Ftmp%2Fca.pem'])(
    'rejects URL TLS overrides before activation: %s',
    (query) => {
      const script = `import sys
sys.path.insert(0,sys.argv[1])
from activate import validate_database_urls
validate_database_urls({'DATABASE_URL':'postgresql://fixture@postgres/fixture'})
try: validate_database_urls({'DATABASE_URL':'postgresql://fixture@postgres/fixture?'+sys.argv[2]})
except RuntimeError: print('rejected')
else: raise SystemExit('fixture accepted unsafe TLS override')`;
      expect(
        execFileSync(
          'python3',
          ['-c', script, fileURLToPath(new URL('../transport', import.meta.url)), query],
          { encoding: 'utf8', stdio: 'pipe' },
        ).trim(),
      ).toBe('rejected');
    },
  );
  it.each(['load', 'renew'])('continues independent profiles after a %s failure', (operation) => {
    const script = `import sys,io,json,contextlib
from pathlib import Path
sys.path.insert(0,sys.argv[1])
import renew as scheduler
attempted=[]; applied=[]
def load(path):
    attempted.append(path.stem)
    if path.stem=='monitoring' and sys.argv[2]=='load': raise ValueError('fixture secret')
    return {'name':path.stem}
def renew(profile):
    if profile['name']=='monitoring': raise RuntimeError('fixture secret')
    applied.append(profile['name']); return []
scheduler.profile_from_file=load; scheduler.renew=renew
log=io.StringIO()
with contextlib.redirect_stdout(log): failed=scheduler.renew_profiles([Path(n+'.json') for n in ['monitoring','prod','stage']])
print(json.dumps({'attempted':attempted,'applied':applied,'failed':failed,'log':log.getvalue()}))`;
    const result = JSON.parse(
      execFileSync(
        'python3',
        ['-c', script, fileURLToPath(new URL('../transport', import.meta.url)), operation],
        { encoding: 'utf8', stdio: 'pipe' },
      ),
    );
    expect(result.attempted).toEqual(['monitoring', 'prod', 'stage']);
    expect(result.applied).toEqual(['prod', 'stage']);
    expect(result.failed).toEqual(['monitoring']);
    expect(result.log).not.toContain('fixture secret');
  });
});
