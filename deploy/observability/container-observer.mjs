// Trusted host-only timer. Fixed Docker read commands; only numeric projections
// cross the textfile boundary. Never mount the Docker socket in monitoring.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, writeFile, rename, unlink } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const CONTAINERS = Object.freeze({
  game: 'deploy-server-1', postgres: 'deploy-postgres-1', proxy: 'deploy-caddy-1',
  grafana: 'deploy-obs-grafana-1', prometheus: 'deploy-obs-prometheus-1',
  loki: 'deploy-obs-loki-1', alloy: 'deploy-obs-alloy-1',
});
const STATES = ['created', 'running', 'paused', 'restarting', 'exited', 'dead', 'removing'];
const HEALTH = ['unhealthy', 'healthy', 'starting'];
const FORMAT = '{"id":{{json .Id}},"pid":{{.State.Pid}},"status":{{json .State.Status}},"health":{{if .State.Health}}{{json .State.Health.Status}}{{else}}"none"{{end}},"restarts":{{.RestartCount}},"oomKilled":{{.State.OOMKilled}},"started":{{json .State.StartedAt}}}';
const exec = promisify(execFile);
const fail = () => new Error('E_OBS_CONTAINER');
const integer = (value) => {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw fail();
  return value;
};
const number = (text) => {
  if (!/^\d+$/.test(text.trim())) throw fail();
  return integer(Number(text.trim()));
};
const fields = (text) => Object.fromEntries(text.trim().split('\n').map((line) => line.trim().split(/\s+/)));

export function projectInspect(input) {
  if (!input || !/^[a-f0-9]{64}$/.test(input.id) || !STATES.includes(input.status) ||
      ![...HEALTH, 'none'].includes(input.health) || typeof input.oomKilled !== 'boolean') throw fail();
  const started = input.started === '0001-01-01T00:00:00Z' ? 0 : Date.parse(input.started) / 1000;
  if (!Number.isFinite(started) || started < 0) throw fail();
  return { id: input.id, pid: integer(input.pid), state: STATES.indexOf(input.status),
    health: HEALTH.indexOf(input.health), restarts: integer(input.restarts),
    oomKilled: Number(input.oomKilled), started };
}

export function cgroupPath(id, membership) {
  if (!/^[a-f0-9]{64}$/.test(id)) throw fail();
  const path = membership.trim().split('\n').find((line) => line.startsWith('0::'))?.slice(3);
  // Only supported rootful Docker cgroup-v2 layouts. Never follow an arbitrary
  // proc path, parent traversal, container ID or label supplied by a caller.
  if (![ `/system.slice/docker-${id}.scope`, `/docker/${id}` ].includes(path)) throw fail();
  return `/sys/fs/cgroup${path}`;
}

export function projectCgroup(files) {
  const cpu = fields(files['cpu.stat']), events = fields(files['memory.events']);
  const memory = fields(files['memory.stat']);
  const current = number(files['memory.current']);
  const [quota, period, ...extra] = files['cpu.max'].trim().split(/\s+/);
  if (extra.length || number(period) === 0) throw fail();
  const limit = files['memory.max'].trim();
  return {
    memory_bytes: current,
    memory_working_set_bytes: Math.max(0, current - number(memory.inactive_file)),
    memory_limit_bytes: limit === 'max' ? 0 : number(limit),
    cpu_limit_cores: quota === 'max' ? 0 : number(quota) / number(period),
    cpu_seconds_total: number(cpu.usage_usec) / 1e6,
    cpu_throttled_seconds_total: number(cpu.throttled_usec) / 1e6,
    memory_limit_hits_total: number(events.max),
    oom_kills_total: number(events.oom_kill),
  };
}

async function docker(args) {
  // Ignore DOCKER_HOST/context from an interactive shell; this is the local daemon.
  const { stdout } = await exec('docker', ['--host', 'unix:///var/run/docker.sock', ...args], {
    timeout: 1500, killSignal: 'SIGKILL', maxBuffer: 65536,
    env: { PATH: '/usr/local/bin:/usr/bin:/bin', DOCKER_CONFIG: '/nonexistent' },
  });
  return stdout;
}
const CGROUP_FILES = ['memory.current', 'memory.stat', 'memory.max', 'memory.events', 'cpu.stat', 'cpu.max'];
async function resources(info) {
  const path = cgroupPath(info.id, await readFile(`/proc/${info.pid}/cgroup`, 'utf8'));
  const entries = await Promise.all(CGROUP_FILES.map(async (file) => [file, await readFile(join(path, file), 'utf8')]));
  // Detect a stop/replacement while reading. No mixed old/new epoch sample.
  if (cgroupPath(info.id, await readFile(`/proc/${info.pid}/cgroup`, 'utf8')) !== path) throw fail();
  return projectCgroup(Object.fromEntries(entries));
}

export async function collectContainers({ command = docker, readResources = resources } = {}) {
  let names;
  try { names = new Set((await command(['container', 'ls', '--all', '--format', '{{.Names}}'])).trim().split('\n')); }
  catch { return Object.keys(CONTAINERS).map((container) => ({ container, source_up: 0 })); }
  const rows = [];
  for (const [container, name] of Object.entries(CONTAINERS)) {
    if (!names.has(name)) { rows.push({ container, source_up: 1, present: 0 }); continue; }
    try {
      const inspect = async () => projectInspect(JSON.parse(await command(['container', 'inspect', '--format', FORMAT, name])));
      const info = await inspect();
      const running = [1, 2].includes(info.state);
      let usage = {};
      let resources_up = 0;
      if (running) {
        try { usage = await readResources(info); resources_up = 1; } catch { /* status still useful */ }
        const after = await inspect();
        if (after.id !== info.id || after.pid !== info.pid || after.started !== info.started || after.state !== info.state) throw fail();
      }
      rows.push({ container, source_up: 1, present: 1, state: info.state, health: info.health,
        restart_count: info.restarts, oom_killed: info.oomKilled, started_timestamp_seconds: info.started,
        resources_up, ...usage });
    } catch { rows.push({ container, source_up: 0 }); }
  }
  return rows;
}

const METRICS = Object.freeze(['source_up', 'present', 'state', 'health', 'restart_count', 'oom_killed',
  'started_timestamp_seconds', 'resources_up', 'memory_bytes', 'memory_working_set_bytes', 'memory_limit_bytes', 'cpu_limit_cores',
  'cpu_seconds_total', 'cpu_throttled_seconds_total', 'memory_limit_hits_total', 'oom_kills_total']);
export function renderContainers(rows, timestamp) {
  if (!Number.isFinite(timestamp) || timestamp < 0 || rows.length !== Object.keys(CONTAINERS).length ||
      new Set(rows.map((row) => row.container)).size !== rows.length) throw fail();
  const lines = [];
  for (const metric of METRICS) {
    const name = `moongame_container_${metric}`;
    lines.push(`# TYPE ${name} ${metric.endsWith('_total') ? 'counter' : 'gauge'}`);
    for (const row of rows) {
      if (!Object.hasOwn(CONTAINERS, row.container)) throw fail();
      if (row[metric] === undefined) continue;
      if (!Number.isFinite(row[metric]) || (row[metric] < 0 && !(metric === 'health' && row[metric] === -1))) throw fail();
      lines.push(`${name}{container="${row.container}"} ${row[metric]}`);
    }
  }
  lines.push('# TYPE moongame_container_sample_timestamp_seconds gauge', `moongame_container_sample_timestamp_seconds ${timestamp}`);
  return lines.join('\n') + '\n';
}

export async function writeContainers(directory, body) {
  if (typeof body !== 'string' || Buffer.byteLength(body) > 65536) throw fail();
  const temporary = join(directory, `.containers-${randomBytes(12).toString('hex')}`);
  try {
    await writeFile(temporary, body, { flag: 'wx', mode: 0o644 });
    await rename(temporary, join(directory, 'containers.prom'));
  } finally { await unlink(temporary).catch(() => {}); }
}
async function main() {
  if (process.argv.length !== 2) throw fail();
  // Fixed directory is the shared numeric projection, never arbitrary output paths.
  // A slow batch must not make its earliest observations look newly collected.
  const timestamp = Date.now() / 1000;
  await writeContainers('/var/lib/moongame-metrics', renderContainers(await collectContainers(), timestamp));
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main().catch(() => { process.stderr.write('E_OBS_CONTAINER\n'); process.exitCode = 1; });
