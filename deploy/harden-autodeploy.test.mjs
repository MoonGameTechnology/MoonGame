import { describe, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  chmodSync,
  chownSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
const run = promisify(execFile);
const script = new URL('./harden-autodeploy.sh', import.meta.url).pathname;
function fixture({ busy = false, userBusy = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'deploy-boundary-'));
  const state = join(root, 'state'),
    systemd = join(root, 'systemd'),
    bin = join(root, 'bin'),
    commands = join(root, 'commands');
  for (const p of [
    state,
    systemd,
    bin,
    commands,
    join(state, 'releases', 'one', 'deploy'),
    join(state, 'certs'),
  ])
    mkdirSync(p, { recursive: true });
  writeFileSync(join(state, 'releases', 'one', 'deploy', 'stack.sh'), 'fixture');
  writeFileSync(join(state, 'server.env'), 'FIXTURE_ONLY=value\n');
  chmodSync(join(state, 'server.env'), 0o600);
  writeFileSync(join(state, 'certs', 'server.crt'), 'fixture');
  chmodSync(join(state, 'certs', 'server.crt'), 0o644);
  symlinkSync(join(state, 'releases', 'one'), join(state, 'current'));
  symlinkSync(join(state, 'certs'), join(state, 'releases', 'one', 'deploy', 'certs'));
  for (const u of ['moongame.service', 'moongame-autoupdate.service'])
    writeFileSync(join(systemd, u), '[Service]\nUser=moongame\n');
  const log = join(root, 'calls');
  writeFileSync(log, '');
  const stub = (name, body) => {
    const p = join(commands, name);
    writeFileSync(p, '#!/bin/bash\nset -euo pipefail\n' + body);
    chmodSync(p, 0o755);
  };
  stub('id', 'case "${1:-}" in -u) echo 0;; -nG) echo "moongame docker";; *) exit 0;; esac\n');
  stub('pgrep', `exit ${userBusy ? 0 : 1}\n`);
  stub(
    'systemctl',
    `echo "systemctl $*" >> "$CALL_LOG"\nif [ "$1" = is-active ]; then case "$3" in *.timer) exit 0;; *) exit ${busy ? 0 : 3};; esac; fi\n`,
  );
  stub('gpasswd', 'echo "gpasswd $*" >> "$CALL_LOG"\n');
  stub('chown', 'echo "chown $*" >> "$CALL_LOG"\n');
  stub(
    'install',
    'args=(); while [ "$#" -gt 0 ]; do case "$1" in -o|-g) shift 2;; *) args+=("$1");shift;; esac;done;exec /usr/bin/install "${args[@]}"\n',
  );
  return {
    state,
    systemd,
    bin,
    log,
    root,
    stub,
    env: {
      ...process.env,
      STATE_DIR: state,
      SYSTEMD_DIR: systemd,
      BIN_DIR: bin,
      PATH: commands + ':' + process.env.PATH,
      CALL_LOG: log,
    },
  };
}
describe('privileged deployment boundary migration', () => {
  it('restores private TLS key ownership after adopting the deploy tree', async () => {
    const f = fixture();
    const key = join(f.state, 'certs', 'privkey.pem');
    writeFileSync(key, 'synthetic-private-key', { mode: 0o400 });
    // CI need not be root: model the runtime UID reported by stat, while exercising
    // the real migration, file modes and ordering of ownership operations.
    f.stub(
      'stat',
      'if [ "$1" = -c ] && [ "$2" = %u:%g ] && [[ "${!#}" = */privkey.pem ]]; then echo 65532:65532; else exec /usr/bin/stat "$@"; fi\n',
    );
    await run('bash', [script, '--apply'], { env: f.env });
    const calls = readFileSync(f.log, 'utf8');
    const adopt = calls.indexOf(`chown -hR root:root ${f.state}`);
    const restore = calls.indexOf(`chown 65532:65532 -- ${key}`);
    expect(adopt).toBeGreaterThan(-1);
    expect(restore).toBeGreaterThan(adopt);
    expect(statSync(key).mode & 0o777).toBe(0o400);
  });
  for (const name of ['BACKUP_READINESS_CHECK', 'COMPOSE_EXTRA_FILE'])
    it(`rejects an old-user-owned external ${name} before changing the host`, async () => {
      const f = fixture();
      const dependency = join(f.root, 'external-policy');
      writeFileSync(dependency, 'synthetic', { mode: 0o700 });
      if (process.getuid() === 0) chownSync(dependency, 999, 999);
      writeFileSync(join(f.state, 'server.env'), `${name}=${dependency}\n`);
      await expect(run('bash', [script, '--apply'], { env: f.env })).rejects.toMatchObject({
        code: 1,
      });
      expect(readFileSync(f.log, 'utf8')).toBe('');
    });
  it('protects state, preserves mounted certificates and restores the timer without restarting containers', async () => {
    const f = fixture();
    await run('bash', [script, '--apply'], { env: f.env });
    expect(statSync(f.state).mode & 0o777).toBe(0o700);
    expect(statSync(join(f.state, 'server.env')).mode & 0o777).toBe(0o600);
    expect(statSync(join(f.state, 'certs', 'server.crt')).mode & 0o777).toBe(0o644);
    expect(
      readFileSync(join(f.systemd, 'moongame.service.d', '10-deploy-boundary.conf'), 'utf8'),
    ).toContain('User=root\nGroup=root');
    expect(readFileSync(join(f.bin, 'moongame'), 'utf8')).toContain('SERVICE_USER=root');
    const calls = readFileSync(f.log, 'utf8');
    expect(calls).toContain('gpasswd -d moongame docker');
    expect(calls).toContain('systemctl start moongame-autoupdate.timer');
    expect(calls).not.toContain('restart');
    expect(calls).not.toContain('stop moongame.service');
    await run('bash', [script, '--apply'], { env: f.env });
  });
  for (const opts of [{ busy: true }, { userBusy: true }])
    it(`rejects an active deploy or retained account processes ${JSON.stringify(opts)}`, async () => {
      const f = fixture(opts);
      await expect(run('bash', [script, '--apply'], { env: f.env })).rejects.toMatchObject({
        code: 1,
      });
      const calls = readFileSync(f.log, 'utf8');
      expect(calls).not.toContain('chown');
      expect(calls).not.toContain('gpasswd');
      expect(calls).toContain('systemctl start moongame-autoupdate.timer');
    });
  it('rejects external links before touching the timer or files', async () => {
    const f = fixture();
    symlinkSync('/etc', join(f.state, 'external'));
    await expect(run('bash', [script, '--apply'], { env: f.env })).rejects.toMatchObject({
      code: 1,
    });
    expect(readFileSync(f.log, 'utf8')).toBe('');
  });
  it('rejects a TLS key redirected outside the preserved certificate tree', async () => {
    const f = fixture();
    const key = join(f.state, 'runtime-key');
    writeFileSync(key, 'synthetic', { mode: 0o400 });
    symlinkSync(key, join(f.state, 'certs', 'privkey.pem'));
    await expect(run('bash', [script, '--apply'], { env: f.env })).rejects.toMatchObject({
      code: 1,
    });
    expect(readFileSync(f.log, 'utf8')).toBe('');
  });
  it('rejects a redirected systemd drop-in', async () => {
    const f = fixture();
    symlinkSync(f.bin, join(f.systemd, 'moongame.service.d'));
    await expect(run('bash', [script, '--apply'], { env: f.env })).rejects.toMatchObject({
      code: 1,
    });
    expect(readFileSync(f.log, 'utf8')).toBe('');
  });
});
