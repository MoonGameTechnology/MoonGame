import { describe, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { chmodSync, cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const run = promisify(execFile);
const source = dirname(fileURLToPath(import.meta.url));

function installer({ prepareExit = 0, bootstrapExit = 0 } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'void-install-agent-'));
  const bin = join(root, 'commands');
  const state = join(root, 'state');
  const checkout = join(root, 'checkout');
  const deploy = join(checkout, 'deploy');
  const systemd = join(root, 'systemd');
  for (const dir of [bin, deploy, systemd]) mkdirSync(dir, { recursive: true });
  const log = join(root, 'calls');
  writeFileSync(log, '');
  function script(dir, name, body) {
    const path = join(dir, name);
    writeFileSync(path, '#!/bin/bash\nset -euo pipefail\n' + body + '\n');
    chmodSync(path, 0o755);
  }
  cpSync(join(source, 'install-autodeploy.sh'), join(deploy, 'install-autodeploy.sh'));
  writeFileSync(join(deploy, 'server.env'), 'DOMAIN=play.example.com\n');
  writeFileSync(join(deploy, 'migration.env'), 'DB_MIGRATION_URL=fixture-only\n');
  writeFileSync(join(systemd, 'moongame.service'), '[Service]\nExecStart=/legacy/start\n');
  script(deploy, 'production-preflight.sh', 'production_preflight() { echo preflight >> "$LOG"; }');
  script(
    deploy,
    'autoupdate.sh',
    `echo "$1" >> "$LOG"
if [ "$1" = --prepare-bootstrap ]; then exit ${prepareExit}; fi
[ ${bootstrapExit} -eq 0 ] || exit ${bootstrapExit}
mkdir -p "$STATE_DIR/releases/prepared/deploy"
touch "$STATE_DIR/releases/prepared/deploy/stack.sh"
ln -s "$STATE_DIR/releases/prepared" "$STATE_DIR/current"
printf 'version=1\\nserver=fixture\\ncaddy=fixture\\n' > "$STATE_DIR/last-good-release"`,
  );
  // No root/systemd/Docker access: only the installer's control flow is under test.
  script(bin, 'id', 'if [ "${1:-}" = -u ]; then echo 0; else /usr/bin/id "$@"; fi');
  script(bin, 'sudo', '[ "$1" = -u ]; shift 2; exec "$@"');
  script(
    bin,
    'install',
    `args=()
while [ "$#" -gt 0 ]; do
  case "$1" in -o|-g) shift 2 ;; *) args+=("$1"); shift ;; esac
done
exec /usr/bin/install "\${args[@]}"`,
  );
  script(bin, 'chown', 'exit 0');
  script(bin, 'systemctl', 'printf "systemctl %s\\n" "$*" >> "$LOG"');
  const env = {
    ...process.env,
    PATH: bin + ':' + process.env.PATH,
    LOG: log,
    SERVICE_USER: 'root',
    INSTALL_DIR: checkout,
    STATE_DIR: state,
    SYSTEMD_DIR: systemd,
    BIN_DIR: bin,
    DOCKER_SYSTEMD_UNIT: 'moongame-docker.service',
    VOID_REGISTRY_USER: '',
    VOID_REGISTRY_TOKEN: '',
  };
  return { env, deploy, state, systemd, calls: () => readFileSync(log, 'utf8') };
}

describe('installer bootstrap boundary', () => {
  it('refuses a nonroot deployment account before preparing or stopping anything', async () => {
    const f = installer();
    await expect(
      run('bash', [join(f.deploy, 'install-autodeploy.sh')], {
        env: { ...f.env, SERVICE_USER: 'moongame' },
      }),
    ).rejects.toMatchObject({ code: 1 });
    expect(f.calls()).toBe('');
  });
  it('never stops the working unit when candidate preparation fails', async () => {
    const f = installer({ prepareExit: 1 });
    await expect(
      run('bash', [join(f.deploy, 'install-autodeploy.sh')], { env: f.env }),
    ).rejects.toMatchObject({ code: 1 });
    expect(f.calls()).toContain('--prepare-bootstrap');
    expect(f.calls()).not.toContain('systemctl');
  });

  it('restores the legacy unit when the first signed rollout fails and leaves the timer off', async () => {
    const f = installer({ bootstrapExit: 1 });
    await expect(
      run('bash', [join(f.deploy, 'install-autodeploy.sh')], { env: f.env }),
    ).rejects.toMatchObject({ code: 1 });
    expect(f.calls()).toContain(
      '--prepare-bootstrap\nsystemctl stop moongame\n--bootstrap\nsystemctl start moongame',
    );
    expect(f.calls()).not.toContain('enable');
  });

  it('installs the custom Docker dependency and timer only after a successful prepared bootstrap', async () => {
    const f = installer();
    await run('bash', [join(f.deploy, 'install-autodeploy.sh')], { env: f.env });
    expect(f.calls()).toContain('--bootstrap\nsystemctl daemon-reload');
    expect(f.calls()).toContain('systemctl enable --now moongame-autoupdate.timer');
    expect(readFileSync(join(f.systemd, 'moongame.service'), 'utf8')).toContain(
      'Requires=moongame-docker.service',
    );
    expect(readFileSync(join(f.systemd, 'moongame.service'), 'utf8')).toContain('User=root');
    expect(readFileSync(join(f.state, 'migration.env'), 'utf8')).toBe(
      'DB_MIGRATION_URL=fixture-only\n',
    );
  });
});
