import { it, expect } from 'vitest';
import { mkdtemp, mkdir, writeFile, symlink, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { EVENTS } from '../security/records.mjs';

it('executes a symlinked main, but does not execute an imported module with an unrelated argv', async () => {
  const root = await mkdtemp(join(tmpdir(), 'main-entry-'));
  try {
    const entry = join(root, 'entry.mjs'),
      alias = join(root, 'current.mjs');
    const helper = new URL('./main-module.mjs', import.meta.url).href;
    await writeFile(
      entry,
      `import {isMainModule} from ${JSON.stringify(helper)}; if(isMainModule(import.meta.url)) process.stdout.write('entered');`,
    );
    await symlink(entry, alias);
    for (const path of [entry, alias]) {
      const child = spawnSync(process.execPath, [path], { encoding: 'utf8', timeout: 10000 });
      expect([child.status, child.stdout, child.stderr]).toEqual([0, 'entered', '']);
    }
    const imported = spawnSync(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        `await import(${JSON.stringify(pathToFileURL(alias).href)})`,
        'nonexistent-entry',
      ],
      { encoding: 'utf8', timeout: 10000 },
    );
    expect([imported.status, imported.stdout, imported.stderr]).toEqual([0, '', '']);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it('writes a real detector sample when invoked through the deployment symlink', async () => {
  const root = await mkdtemp(join(tmpdir(), 'monitor-entry-'));
  try {
    const logs = join(root, 'logs'),
      metrics = join(root, 'metrics'),
      alias = join(root, 'monitor.mjs');
    await mkdir(logs, { mode: 0o700 });
    await mkdir(metrics, { mode: 0o755 });
    const at = Date.now();
    await writeFile(
      join(logs, `security-status-${new Date(at).toISOString().slice(0, 10)}.jsonl`),
      JSON.stringify({
        schema: 2,
        kind: 'security.status',
        run: '11111111-2222-4333-8444-555555555555',
        at,
        startedAt: at - 1000,
        stableCorrelation: 1,
        sampled: 0,
        failed: 0,
        journal: { written: 0, dropped: 0, failed: 0 },
        counts: Object.fromEntries([...EVENTS].map((e) => [e, 0])),
      }) + '\n',
      { mode: 0o600 },
    );
    await symlink(new URL('../security/monitor.mjs', import.meta.url), alias);
    const child = spawnSync(process.execPath, [alias, 'sample'], {
      env: {
        ...process.env,
        SECURITY_LOG_DIR: logs,
        SECURITY_METRICS_DIR: metrics,
        SECURITY_EDGE_LOG_DIR: '',
        SECURITY_MAINTENANCE_MARKER: '',
        SECURITY_MAINTENANCE_SUCCESS: '',
      },
      encoding: 'utf8',
      timeout: 10000,
    });
    expect([child.status, child.stderr]).toEqual([0, '']);
    expect(await readFile(join(metrics, 'security.prom'), 'utf8')).toContain(
      'moongame_security_detector_up 1\n',
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it('runs controller argument validation through a symlink without invoking Docker', async () => {
  const root = await mkdtemp(join(tmpdir(), 'stack-entry-'));
  try {
    const alias = join(root, 'stack.mjs');
    await symlink(new URL('./stack.mjs', import.meta.url), alias);
    const child = spawnSync(process.execPath, [alias, 'invalid-command'], {
      encoding: 'utf8',
      timeout: 10000,
    });
    expect([child.status, child.stderr]).toEqual([1, 'E_OBS_CONFIG\n']);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
