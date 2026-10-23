import { describe, it, expect } from 'vitest';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { hostMetrics, writeSample } from './observer.mjs';

const host = {
  cpus: [{ times: { user: 1200, nice: 0, sys: 300, idle: 2500, irq: 0 } }],
  meminfo: 'MemTotal: 1000 kB\nMemAvailable: 400 kB\n',
  disk: { blocks: 100, bavail: 40, bsize: 4096, files: 80, ffree: 20 },
  load: 1.5,
};
describe('sanitized on-host observation bridge', () => {
  it('projects actual units, available memory and fixed labels only', () => {
    const body = hostMetrics(host);
    expect(body).toContain('moongame_host_cpu_seconds_total{mode="user"} 1.2');
    expect(body).toContain('moongame_host_memory_available_bytes 409600');
    expect(body).toContain('moongame_host_root_available_bytes 163840');
    expect(body).not.toContain('MemTotal');
  });
  it.each([
    { ...host, meminfo: 'MemTotal: 1000 kB\n' },
    { ...host, disk: { ...host.disk, bavail: NaN } },
    { ...host, cpus: [] },
  ])('fails rather than publishing healthy zeros on invalid host data', (input) => {
    expect(() => hostMetrics(input)).toThrow('E_OBS_HOST');
  });
  it('atomically replaces one bounded sample; failure retains the old timestamp', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'obs-observer-'));
    try {
      const path = join(dir, 'host.prom');
      await writeSample(dir, 'first 1\n', 100);
      await expect(writeSample(dir, 'x'.repeat(1048577), 200)).rejects.toThrow('E_OBS_SAMPLE');
      expect(await readFile(path, 'utf8')).toContain('sample_timestamp_seconds 100');
      await writeSample(dir, 'second 2\n', 300);
      expect(await readFile(path, 'utf8')).not.toContain('first 1');
      expect(await readdir(dir)).toEqual(['host.prom']);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
});
