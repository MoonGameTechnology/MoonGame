import { it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

it('retains maintenance through a failed start and retries it even with an empty queue', () => {
  const dir = mkdtempSync(join(tmpdir(), 'erasure-hooks-'));
  const bin = join(dir, 'bin'); mkdirSync(bin);
  const script = (path, body) => writeFileSync(path, '#!/bin/bash\nset -eu\n' + body, { mode: 0o700 });
  // Only ownership is virtualized: CI runs unprivileged, production requires root hooks.
  script(join(bin, 'stat'), 'if [[ "$2" = %u ]]; then echo 0; else echo 700; fi\n');
  script(join(bin, 'node'), 'echo "$*" >> "$STATE_DIR/calls"\nif [[ "$*" = *--pending* ]]; then exit "${PENDING_EXIT:-0}"; fi\n');
  const stop = join(dir, 'stop'); const start = join(dir, 'start');
  script(stop, 'echo stop >> "$STATE_DIR/calls"\n');
  script(start, 'echo start >> "$STATE_DIR/calls"\n[[ -e "$STATE_DIR/allow-start" ]]\n');
  const env = { ...process.env, PATH: `${bin}:${process.env.PATH}`, STATE_DIR: dir, ERASURE_CHECKOUT: dir, ERASURE_STOP_HOOK: stop, ERASURE_START_HOOK: start };
  const run = extra => spawnSync('bash', [resolve('deploy/account-erasure.sh')], { env: { ...env, ...extra }, encoding: 'utf8' });
  try {
    expect(run().status).toBe(1);
    expect(existsSync(join(dir, 'account-erasure.pending'))).toBe(true);
    expect(existsSync(join(dir, 'account-erasure.last-success'))).toBe(false);
    writeFileSync(join(dir, 'allow-start'), '');
    expect(run({ PENDING_EXIT: '3' }).status).toBe(0);
    expect(existsSync(join(dir, 'account-erasure.pending'))).toBe(false);
    expect(existsSync(join(dir, 'account-erasure.last-success'))).toBe(true);
    expect(readFileSync(join(dir, 'calls'), 'utf8').match(/--replay/g)).toHaveLength(2);
    rmSync(join(dir, 'account-erasure.last-success'));
    expect(run({ PENDING_EXIT: '1' }).status).toBe(1);
    expect(existsSync(join(dir, 'account-erasure.last-success'))).toBe(false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
