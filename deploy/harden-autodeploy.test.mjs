import { describe, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  chmodSync,
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
  it('rejects a redirected systemd drop-in', async () => {
    const f = fixture();
    symlinkSync(f.bin, join(f.systemd, 'moongame.service.d'));
    await expect(run('bash', [script, '--apply'], { env: f.env })).rejects.toMatchObject({
      code: 1,
    });
    expect(readFileSync(f.log, 'utf8')).toBe('');
  });
});
