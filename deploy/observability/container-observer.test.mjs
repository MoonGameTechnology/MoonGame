import { describe, it, expect } from 'vitest';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CONTAINERS, projectInspect, projectCgroup, cgroupPath, collectContainers, renderContainers, writeContainers } from './container-observer.mjs';
const id = 'a'.repeat(64);
const info = { id, pid: 42, status: 'running', health: 'healthy', restarts: 2, oomKilled: false, started: '2026-10-18T10:00:00Z' };
const files = { 'memory.current': '512', 'memory.stat': 'inactive_file 128', 'memory.max': '1024', 'cpu.max': '25000 100000',
  'cpu.stat': 'usage_usec 1500000\nthrottled_usec 200000\n', 'memory.events': 'max 3\noom_kill 1\n' };
const fake = (value = info) => async (args) => args[1] === 'ls' ? 'deploy-server-1\nnot-monitored\n' : JSON.stringify(value);
describe('fixed host container projection', () => {
  it('converts cgroup units and keeps total charged memory including cache', () => {
    expect(projectCgroup(files)).toEqual({ memory_bytes: 512, memory_working_set_bytes: 384, memory_limit_bytes: 1024,
      cpu_limit_cores: 0.25, cpu_seconds_total: 1.5, cpu_throttled_seconds_total: 0.2,
      memory_limit_hits_total: 3, oom_kills_total: 1 });
    expect(projectCgroup({ ...files, 'memory.max': 'max', 'cpu.max': 'max 100000' })).toMatchObject({ memory_limit_bytes: 0, cpu_limit_cores: 0 });
  });
  it.each(['-1', 'NaN', '1e3', '9007199254740992'])('rejects invalid resource numbers %s', (value) => {
    expect(() => projectCgroup({ ...files, 'memory.current': value })).toThrow();
  });
  it('rejects missing counters and zero CPU periods', () => {
    expect(() => projectCgroup({ ...files, 'cpu.stat': '' })).toThrow();
    expect(() => projectCgroup({ ...files, 'cpu.max': '10 0' })).toThrow();
  });
  it('resolves only matching rootful cgroup-v2 Docker paths', () => {
    expect(cgroupPath(id, `0::/system.slice/docker-${id}.scope\n`)).toBe(`/sys/fs/cgroup/system.slice/docker-${id}.scope`);
    expect(cgroupPath(id, `0::/docker/${id}`)).toBe(`/sys/fs/cgroup/docker/${id}`);
    for (const path of ['0::/../../etc', `0::/docker/${'b'.repeat(64)}`, '1:cpu:/docker/abc'])
      expect(() => cgroupPath(id, path)).toThrow('E_OBS_CONTAINER');
  });
  it('distinguishes stopped, health absent, starting and OOM status', () => {
    expect(projectInspect({ ...info, status: 'exited', health: 'none', pid: 0, oomKilled: true })).toMatchObject({ state: 4, health: -1, oomKilled: 1 });
    expect(projectInspect({ ...info, health: 'starting' }).health).toBe(2);
    expect(() => projectInspect({ ...info, status: 'SECRET' })).toThrow();
  });
  it('reads only named containers; drops identities/secrets and marks missing explicitly', async () => {
    const commands = [];
    const rows = await collectContainers({ command: async (args) => { commands.push(args); return fake({ ...info, Env: ['TOKEN=secret'], labels: { player: 'secret' } })(args); }, readResources: async () => projectCgroup(files) });
    const body = renderContainers(rows, 100);
    expect(body).toContain('moongame_container_memory_bytes{container="game"} 512');
    expect(body).toContain('moongame_container_present{container="grafana"} 0');
    expect(body).not.toMatch(/secret|TOKEN|deploy-server|aaaaaaa|not-monitored/);
    expect(commands.slice(1).every((args) => args.at(-1) === CONTAINERS.game)).toBe(true);
  });
  it('daemon failure is unavailable, never missing or healthy zero memory', async () => {
    const rows = await collectContainers({ command: async () => { throw Error('SECRET'); } });
    expect(rows).toHaveLength(7);
    expect(rows.every((row) => row.source_up === 0 && row.present === undefined)).toBe(true);
    expect(renderContainers(rows, 100)).not.toContain('memory_bytes{');
  });
  it('cgroup failure preserves state but omits resource measurements', async () => {
    const rows = await collectContainers({ command: fake(), readResources: async () => { throw Error(); } });
    expect(rows[0]).toMatchObject({ source_up: 1, present: 1, resources_up: 0 });
    expect(rows[0].memory_bytes).toBeUndefined();
  });
  it('does not read stale cgroups for a stopped container', async () => {
    let reads = 0;
    const rows = await collectContainers({ command: fake({ ...info, status: 'exited', pid: 0 }), readResources: async () => { reads++; } });
    expect(reads).toBe(0);
    expect(rows[0]).toMatchObject({ state: 4, resources_up: 0 });
  });
  it('rejects a replacement between inspect and resource collection', async () => {
    let calls = 0;
    const command = async (args) => args[1] === 'ls' ? CONTAINERS.game : JSON.stringify({ ...info, id: ++calls === 1 ? id : 'b'.repeat(64) });
    const rows = await collectContainers({ command, readResources: async () => projectCgroup(files) });
    expect(rows[0]).toEqual({ container: 'game', source_up: 0 });
  });
  it('allows counter resets after a restart without stored offsets', async () => {
    const rows = await collectContainers({ command: fake({ ...info, restarts: 0 }), readResources: async () => projectCgroup({ ...files, 'cpu.stat': 'usage_usec 100000\nthrottled_usec 0' }) });
    expect(rows[0].cpu_seconds_total).toBe(0.1);
    expect(rows[0].restart_count).toBe(0);
  });
  it('atomically replaces only containers.prom and preserves last sample on failure', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'obs-containers-'));
    try {
      const rows = await collectContainers({ command: fake(), readResources: async () => projectCgroup(files) });
      await writeContainers(dir, renderContainers(rows, 100));
      await expect(writeContainers(dir, 'x'.repeat(65537))).rejects.toThrow();
      expect(await readFile(join(dir, 'containers.prom'), 'utf8')).toContain('sample_timestamp_seconds 100');
      expect(await readdir(dir)).toEqual(['containers.prom']);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
});
