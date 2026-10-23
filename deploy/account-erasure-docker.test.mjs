import { it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

it('pins the maintenance container to the installed image and passes credentials by protected file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'erasure-docker-'));
  const bin = join(dir, 'bin'); mkdirSync(bin);
  const script = (name, body) => writeFileSync(join(bin, name), `#!/bin/bash\nset -eu\n${body}`, { mode: 0o700 });
  script('stat', 'if [[ "$2" = %u ]]; then echo 0; else echo "${TEST_ENV_MODE:-600}"; fi\n');
  const image = `sha256:${'a'.repeat(64)}`;
  script('docker', `if [[ "$1" = inspect ]]; then echo '${image}'; else printf '%s\\n' "$@" > "$TEST_ARGS"; exit 3; fi\n`);
  const secret = join(dir, 'worker.env'), ledger = join(dir, 'ledger.json'), args = join(dir, 'args');
  writeFileSync(secret, 'ERASURE_GAME_DATABASE_URL=never-print-this\n', { mode: 0o600 });
  writeFileSync(ledger, '[]', { mode: 0o600 });
  const env = { ...process.env, PATH: `${bin}:${process.env.PATH}`, TEST_ARGS: args,
    ERASURE_DOCKER_ENV: secret, ERASURE_LEDGER: ledger, ERASURE_DOCKER_NETWORK: 'isolated',
    ERASURE_DOCKER_LOG_VOLUME: 'synthetic-logs' };
  const run = extra => spawnSync('bash', [resolve('deploy/account-erasure-docker.sh'), '--pending'], { env: { ...env, ...extra }, encoding: 'utf8' });
  try {
    expect(run().status).toBe(3); // Empty-queue exit survives the Docker adapter.
    const actual = readFileSync(args, 'utf8').trim().split('\n');
    expect(actual).toContain(image);
    expect(actual).toContain('--read-only');
    // Keep the image's TLS trust policy, including its Node --use-openssl-ca flag.
    expect(actual).not.toContain('--entrypoint');
    expect(actual).toContain(secret);
    expect(actual).toContain(`type=bind,src=${dir},dst=/erasure`);
    expect(actual).not.toContain('never-print-this');
    expect(actual.slice(-2)).toEqual(['packages/server/dist/account-erasure.mjs', '--pending']);
    expect(run({ TEST_ENV_MODE: '644' }).status).toBe(1);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
