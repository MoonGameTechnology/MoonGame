import { open, readFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isMainModule } from '../observability/main-module.mjs';
import { RULES } from './records.mjs';

const KEYS = new Set([
  'SECURITY_LOG_DIR',
  'SECURITY_METRICS_DIR',
  'SECURITY_STATE_DIR',
  'SECURITY_EDGE_LOG_DIR',
  'SECURITY_MAINTENANCE_MARKER',
  'SECURITY_MAINTENANCE_SUCCESS',
]);
export function parseConfig(text) {
  const out = {};
  for (const line of text.split('\n')) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const match = /^([A-Z_]+)=(\/[A-Za-z0-9_./-]+)$/.exec(line);
    if (!match || !KEYS.has(match[1]) || out[match[1]] || match[2] !== resolve(match[2]))
      throw Error('E_SECURITY_CONFIG');
    out[match[1]] = match[2];
  }
  if (!out.SECURITY_LOG_DIR || !out.SECURITY_METRICS_DIR || !out.SECURITY_STATE_DIR)
    throw Error('E_SECURITY_CONFIG');
  return out;
}
async function config() {
  const file = await open(
    '/etc/moongame/security-monitor.env',
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  );
  try {
    const stat = await file.stat();
    if (
      !stat.isFile() ||
      stat.nlink !== 1 ||
      stat.uid !== 0 ||
      stat.mode & 0o077 ||
      stat.size > 4096
    )
      throw Error('E_SECURITY_CONFIG');
    return parseConfig(await file.readFile('utf8'));
  } finally {
    await file.close();
  }
}
async function main() {
  const options = await config(),
    command = process.argv[2];
  if (command === 'status' && process.argv.length === 3) {
    const raw = await readFile(options.SECURITY_METRICS_DIR + '/security.prom', 'utf8');
    if (raw.length > 32768) throw Error('E_SECURITY_STATUS');
    const values = new Map(raw.split('\n').map((line) => line.split(' ')));
    const at = Number(values.get('moongame_security_detector_sample_timestamp_seconds'));
    const heartbeat = Number(values.get('moongame_security_detector_heartbeat_timestamp_seconds'));
    const age = Date.now() / 1000 - at;
    const incidents = [...RULES].map((rule) => ({
      rule,
      active: Number(values.get(`moongame_security_incidents_active{rule="${rule}"}`)),
      retained: Number(values.get(`moongame_security_incidents_retained{rule="${rule}"}`)),
    }));
    const healthy =
      age >= 0 &&
      age < 45 &&
      Date.now() / 1000 - heartbeat < 180 &&
      values.get('moongame_security_detector_up') === '1' &&
      values.get('moongame_security_detector_storage_limited') === '0' &&
      values.get('moongame_security_detector_capacity_limited') === '0' &&
      values.get('moongame_security_detector_invalid_records') === '0' &&
      incidents
        .filter((r) => ['audit-loss', 'correlation-missing'].includes(r.rule))
        .every((r) => r.active === 0);
    process.stdout.write(
      JSON.stringify(
        {
          pipelineHealthy: healthy,
          sampleAgeSeconds: age,
          heartbeatAgeSeconds: Date.now() / 1000 - heartbeat,
          incidents,
        },
        null,
        2,
      ) + '\n',
    );
    return;
  }
  if (!['events', 'incidents'].includes(command)) throw Error('E_SECURITY_COMMAND');
  const args = process.argv.slice(3);
  if (command === 'incidents') args.unshift('--incidents');
  const child = spawnSync(
    '/usr/bin/flock',
    [
      '-n',
      '-E',
      '75',
      '/var/lib/moongame/autoupdate.lock',
      process.execPath,
      fileURLToPath(new URL('./query.mjs', import.meta.url)),
      ...args,
    ],
    { env: { ...process.env, ...options }, stdio: 'inherit', timeout: 20000 },
  );
  process.exitCode = child.status ?? 1;
}
if (isMainModule(import.meta.url))
  main().catch(() => {
    process.stderr.write('E_SECURITY_CONTROL\n');
    process.exitCode = 1;
  });
