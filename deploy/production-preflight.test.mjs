import { describe, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { chmodSync, cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const run = promisify(execFile);
const preflight = fileURLToPath(new URL('./production-preflight.sh', import.meta.url));
const launch = fileURLToPath(new URL('./launch.sh', import.meta.url));

function fixture({ checkExit = 0, insecureChecker = false } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'deploy-preflight-'));
  const checker = join(dir, 'check-recovery');
  const calls = join(dir, 'calls');
  writeFileSync(calls, '');
  writeFileSync(checker, `#!/bin/bash\necho backup-check >> '${calls}'\necho sensitive-diagnostic >&2\nexit ${checkExit}\n`);
  chmodSync(checker, insecureChecker ? 0o777 : 0o700);
  const envFile = join(dir, 'server.env');
  const config = `PROD=1\nDB_AUTO_MIGRATE=0\nDB_REQUIRE_LEAST_PRIVILEGE=1\nBACKUP_READINESS_CHECK=${checker}\n`;
  writeFileSync(envFile, config, { mode: 0o600 });
  return { dir, checker, calls, envFile, config };
}

async function check(f) {
  const env = { ...process.env, STATE_DIR: f.dir, BACKUP_READINESS_VERIFIED: '1' };
  // Vite sets PROD for its own build mode; that is not a deployment override.
  delete env.PROD;
  try {
    return { code: 0, ...(await run('bash', ['-c', '. "$1"; production_preflight "$2" && echo "verified=${BACKUP_READINESS_VERIFIED:-0}"', '_', preflight, f.envFile], {
      env,
    })) };
  } catch (e) {
    return { code: e.code, stdout: e.stdout, stderr: e.stderr };
  }
}

describe('production deployment data protection preflight', () => {
  it('does not restart a circuit-breaker stop even when backups are explicitly deferred', async () => {
    const f = fixture();
    writeFileSync(join(f.dir, 'resource-pressure.json'), '{}');
    writeFileSync(f.envFile, f.config + 'BACKUP_POLICY=deferred-playtest\n');
    await expect(run('bash', ['-c', '. "$1"; production_preflight "$2"', '_', preflight, f.envFile], {
      env: { ...process.env, STATE_DIR: f.dir, PROD: '1' },
    })).rejects.toMatchObject({ code: 1, stderr: expect.stringContaining('E_RESOURCE_PRESSURE') });
    expect(readFileSync(f.calls, 'utf8')).toBe('');
  });
  it('blocks public release without privacy evidence and rejects playtest backup deferral', async () => {
    for (const extra of ['PUBLIC_RELEASE=1\n', 'PUBLIC_RELEASE=1\nBACKUP_POLICY=deferred-playtest\n', 'PUBLIC_RELEASE=1\nPROD=0\nSERVER_BIND=127.0.0.1\n']) {
      const f = fixture();
      writeFileSync(f.envFile, f.config + extra);
      const result = await check(f);
      expect(result.code).not.toBe(0);
      expect(result.stderr).toMatch(/E_PRIVACY_RELEASE|E_ERASURE_READINESS/);
      expect(readFileSync(f.calls, 'utf8')).toBe('');
    }
  });

  it('records an explicit deferral without claiming a verified backup or running a fake checker', async () => {
    const f=fixture({ checkExit:1 });
    writeFileSync(f.envFile,f.config+'BACKUP_POLICY=deferred-playtest\n');
    const result=await check(f);
    expect(result.code).toBe(0);
    expect(result.stdout).toBe('verified=0\n');
    expect(result.stderr).toContain('W_DEPLOY_BACKUP_DEFERRED');
    expect(readFileSync(f.calls,'utf8')).toBe('');
    writeFileSync(f.envFile,f.config+'BACKUP_POLICY=typo\n');
    expect((await check(f)).code).not.toBe(0);
  });
  it('runs the trusted recovery verifier before attesting a production launch', async () => {
    const f = fixture();
    const result = await check(f);
    expect(result.code).toBe(0);
    expect(result.stdout).toBe('verified=1\n');
    expect(result.stderr).not.toContain('sensitive-diagnostic');
    expect(readFileSync(f.calls, 'utf8')).toBe('backup-check\n');
  });
  it('cannot reuse an inherited success or bypass a failed backup verification', async () => {
    const f = fixture({ checkExit: 1 });
    const result = await check(f);
    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain('E_DEPLOY_BACKUP_CHECK');
    expect(result.stderr).not.toContain('sensitive-diagnostic');
    expect(result.stdout).not.toContain('verified=1');
  });
  it('rejects an unsafe database mode before invoking the external checker', async () => {
    const f = fixture();
    writeFileSync(f.envFile, f.config.replace('DB_AUTO_MIGRATE=0', 'DB_AUTO_MIGRATE=1'));
    const result = await check(f);
    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain('E_DEPLOY_DATABASE');
    expect(readFileSync(f.calls, 'utf8')).toBe('');
  });
  it('does not accept a writable verifier or a shell expression as a verifier', async () => {
    for (const insecureChecker of [false, true]) {
      const f = fixture({ insecureChecker });
      if (!insecureChecker) writeFileSync(f.envFile, f.config.replace(f.checker, `${f.checker}; touch /tmp/unwanted`));
      expect((await check(f)).code).not.toBe(0);
      expect(readFileSync(f.calls, 'utf8')).toBe('');
    }
  });
  it('allows loopback development without a backup but refuses an implicit public dev bind', async () => {
    const f = fixture();
    writeFileSync(f.envFile, 'PROD=0\nSERVER_BIND=127.0.0.1\n');
    const localResult = await check(f);
    expect(localResult.code, localResult.stderr).toBe(0);
    expect(localResult.stdout).toBe('verified=0\n');
    writeFileSync(f.envFile, 'PROD=0\n');
    expect((await check(f)).stderr).toContain('E_DEPLOY_DEV_BIND');
    expect(readFileSync(f.calls, 'utf8')).toBe('');
  });
  it('launch never calls Docker when preflight fails; TLS and host policy survive success', async () => {
    const f = fixture({ checkExit: 1 });
    cpSync(preflight, join(f.dir, 'production-preflight.sh'));
    cpSync(launch, join(f.dir, 'launch.sh'));
    const docker = join(f.dir, 'docker');
    writeFileSync(docker, `#!/bin/bash\necho "docker verified=$BACKUP_READINESS_VERIFIED $*" >> '${f.calls}'\n`);
    chmodSync(docker, 0o700);
    const env = { ...process.env, STATE_DIR: f.dir, PATH: `${f.dir}:${process.env.PATH}`, ENV_FILE: f.envFile, COMPOSE_EXTRA_FILE: '/host/policy.yml' };
    delete env.PROD;
    await expect(run('bash', [join(f.dir, 'launch.sh'), '--no-build'], { env })).rejects.toBeDefined();
    expect(readFileSync(f.calls, 'utf8')).not.toContain('docker');
    writeFileSync(f.checker, '#!/bin/bash\nexit 0\n');
    writeFileSync(f.envFile, f.config + 'DOMAIN=play.example\n');
    await run('bash', [join(f.dir, 'launch.sh'), '--no-build'], { env });
    expect(readFileSync(f.calls, 'utf8')).toContain('docker verified=1');
    expect(readFileSync(f.calls, 'utf8')).toContain(`-f ${f.dir}/docker-compose.tls.yml -f /host/policy.yml up -d --no-build`);
  });
  it('legacy tmux launcher refuses production before pulling, installing or replacing a session', async () => {
    const f = fixture();
    const deploy = join(f.dir, 'deploy');
    mkdirSync(deploy);
    const entry = join(deploy, 'serve.sh');
    cpSync(fileURLToPath(new URL('./serve.sh', import.meta.url)), entry);
    await expect(run('bash', [entry], { env: { ...process.env, PROD: '1' } })).rejects.toMatchObject({
      code: 1, stderr: expect.stringContaining('E_DEPLOY_PROD_LAUNCHER'),
    });
  });
});
