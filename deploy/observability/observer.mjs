// Host-side bridge: only the existing allowlisted Game projection crosses into
// Alloy's read-only textfile mount. No inbound socket, Docker API or DB access.
import { readFile, writeFile, rename, unlink, statfs } from 'node:fs/promises';
import { cpus, loadavg } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { createExporter, readToken } from './game-exporter.mjs';

const valid = (n) => typeof n === 'number' && Number.isFinite(n) && n >= 0;
export function hostMetrics({ cpus: processors, meminfo, disk, load }) {
  const memory = Object.fromEntries(meminfo.split('\n')
    .map((line) => /^(MemTotal|MemAvailable):\s+(\d+) kB$/.exec(line))
    .filter(Boolean).map((m) => [m[1], Number(m[2]) * 1024]));
  const modes = ['user', 'nice', 'sys', 'idle', 'irq'];
  if (!processors.length || !valid(load) || !valid(memory.MemTotal) || !valid(memory.MemAvailable) ||
      memory.MemTotal <= 0 || memory.MemAvailable > memory.MemTotal ||
      !['blocks', 'bavail', 'bsize', 'files', 'ffree'].every((k) => valid(disk[k])) ||
      disk.bavail > disk.blocks || disk.ffree > disk.files || disk.bsize <= 0 ||
      !processors.every((cpu) => modes.every((mode) => valid(cpu.times[mode]))))
    throw new Error('E_OBS_HOST');
  const lines = [];
  const add = (name, value, type = 'gauge', suffix = '') => {
    if (!valid(value)) throw new Error('E_OBS_HOST');
    if (!suffix || !lines.some((line) => line.startsWith(`# TYPE ${name} `)))
      lines.push(`# TYPE ${name} ${type}`);
    lines.push(`${name}${suffix} ${value}`);
  };
  for (const mode of modes)
    add('moongame_host_cpu_seconds_total', processors.reduce((sum, cpu) => sum + cpu.times[mode], 0) / 1000, 'counter', `{mode="${mode}"}`);
  add('moongame_host_cpu_count', processors.length);
  add('moongame_host_load1', load);
  add('moongame_host_memory_total_bytes', memory.MemTotal);
  add('moongame_host_memory_available_bytes', memory.MemAvailable);
  add('moongame_host_root_size_bytes', disk.blocks * disk.bsize);
  add('moongame_host_root_available_bytes', disk.bavail * disk.bsize);
  add('moongame_host_root_inodes', disk.files);
  add('moongame_host_root_free_inodes', disk.ffree);
  return lines.join('\n') + '\n';
}

export async function writeSample(directory, body, timestamp) {
  if (typeof body !== 'string' || Buffer.byteLength(body) > 1048576 || !valid(timestamp))
    throw new Error('E_OBS_SAMPLE');
  const temporary = join(directory, `.sample-${randomBytes(12).toString('hex')}`);
  try {
    await writeFile(temporary, `${body}# TYPE moongame_observer_sample_timestamp_seconds gauge\nmoongame_observer_sample_timestamp_seconds ${timestamp}\n`, { mode: 0o644, flag: 'wx' });
    await rename(temporary, join(directory, 'host.prom'));
  } finally { await unlink(temporary).catch(() => {}); }
}

async function main() {
  if (process.argv.length !== 2) throw new Error('E_OBS_CONFIG');
  const directory = process.env.OBS_METRICS_DIR;
  if (!directory || directory !== resolve(directory)) throw new Error('E_OBS_CONFIG');
  const token = await readToken(process.env.GAME_EXPORTER_TOKEN_FILE);
  const { scrape } = createExporter({ token });
  const sample = async () => {
    const [game, meminfo, disk] = await Promise.all([scrape(), readFile('/proc/meminfo', 'utf8'), statfs('/')]);
    const host = hostMetrics({ cpus: cpus(), meminfo, disk, load: loadavg()[0] });
    await writeSample(directory, game + host, Date.now() / 1000);
  };
  // Await each iteration: a slow/failing source cannot accumulate jobs.
  let stopped = false, timer, wake;
  for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, () => { stopped = true; clearTimeout(timer); wake?.(); });
  while (!stopped) {
    try { await sample(); } catch { process.stderr.write('E_OBS_SAMPLE\n'); }
    if (!stopped) await new Promise((done) => { wake = done; timer = setTimeout(done, 15000); });
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main().catch(() => { process.stderr.write('E_OBS_CONFIG\n'); process.exitCode = 1; });
