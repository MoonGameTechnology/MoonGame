// OBS-0.2: trusted local root controller, never an HTTP endpoint or a Game dependency.
import {
  lstat,
  mkdir,
  chown,
  chmod,
  readFile,
  writeFile,
  rename,
  unlink,
  statfs,
  open,
} from 'node:fs/promises';
import { constants } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomBytes, createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { isAbsolute, resolve, join, parse } from 'node:path';

const exec = promisify(execFile);
const DEPLOY = fileURLToPath(new URL('../', import.meta.url));
const DEFAULT_STATE = '/var/lib/moongame-observability';
export const PROBE_IMAGE =
  'prom/prometheus:v3.13.4@sha256:87861b8cf91579109319ebc300f3f1060e6da9c05d6ae8ad15a20c879e84e32e';
export const SERVICES = Object.freeze(['obs-grafana', 'obs-prometheus', 'obs-loki', 'obs-alloy']);
const GiB = 1024 ** 3;
export const BUDGETS = Object.freeze({
  grafana: GiB / 4,
  prometheus: GiB * 2.5,
  loki: GiB * 2,
  alloy: GiB / 4,
  total: GiB * 6,
});
const DIRECTORIES = Object.freeze({
  grafana: [472, 0o700],
  prometheus: [65534, 0o700],
  loki: [10001, 0o700],
  alloy: [473, 0o700],
  secrets: [472, 0o700],
  probe: [0, 0o755],
});
const ACTIONS = new Set(['init', 'up', 'restart', 'stop', 'status', 'guard']);
const failure = (code) => new Error(code);
const finiteBytes = (n) => Number.isSafeInteger(n) && n >= 0;

/** Invalid measurements are an error, never a healthy zero. */
export function budgetDecision({ freeBytes, usage } = {}) {
  if (
    !finiteBytes(freeBytes) ||
    !usage ||
    !Object.keys(BUDGETS).every((key) => finiteBytes(usage[key]))
  )
    throw failure('E_OBS_MEASURE');
  const ratios = Object.entries(BUDGETS).map(([key, cap]) => usage[key] / cap);
  const level =
    freeBytes < 12 * GiB || ratios.some((ratio) => ratio >= 0.9)
      ? 2
      : ratios.some((ratio) => ratio >= 0.8)
        ? 1
        : 0;
  return { level, stop: level === 2 };
}

function absolutePath(value) {
  if (
    typeof value !== 'string' ||
    !isAbsolute(value) ||
    [...value].some(
      (character) => character.codePointAt(0) < 32 || character.codePointAt(0) === 127,
    )
  )
    throw failure('E_OBS_CONFIG');
  const result = resolve(value);
  if (result === parse(result).root) throw failure('E_OBS_CONFIG');
  return result;
}

function validAdmin(value) {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= 128 &&
    value.trim() === value &&
    !/[\p{C}]/u.test(value) &&
    value.toLowerCase() !== 'admin'
  );
}

export function parseArgs(args) {
  const action = args[0];
  if (!ACTIONS.has(action) || (args.length - 1) % 2) throw failure('E_OBS_CONFIG');
  const options = new Map();
  for (let i = 1; i < args.length; i += 2) {
    if (
      !['--state-dir', '--env-file', '--admin-user'].includes(args[i]) ||
      options.has(args[i]) ||
      !args[i + 1]
    )
      throw failure('E_OBS_CONFIG');
    options.set(args[i], args[i + 1]);
  }
  const adminUser = options.get('--admin-user');
  if (action === 'init' ? !validAdmin(adminUser) : adminUser !== undefined)
    throw failure('E_OBS_CONFIG');
  return {
    action,
    stateDir: absolutePath(options.get('--state-dir') ?? DEFAULT_STATE),
    envFile: absolutePath(options.get('--env-file') ?? join(DEPLOY, 'server.env')),
    adminUser,
  };
}

/** Service allowlist is part of the safety boundary: never restart/down the project. */
export function composePlan(action, { stateDir, envFile, adminUser }) {
  if (!['up', 'restart', 'stop', 'status', 'config'].includes(action))
    throw failure('E_OBS_CONFIG');
  const args = [
    'compose',
    '--project-name',
    'deploy',
    '--env-file',
    absolutePath(envFile),
    '-f',
    join(DEPLOY, 'docker-compose.yml'),
    '-f',
    join(DEPLOY, 'docker-compose.observability.yml'),
    '--profile',
    'observability',
  ];
  if (action === 'up')
    args.push('up', '--no-deps', '--wait', '--wait-timeout', '180', '-d', ...SERVICES);
  if (action === 'restart') args.push('restart', '--no-deps', ...SERVICES);
  if (action === 'stop') args.push('stop', '--timeout', '20', ...SERVICES);
  if (action === 'status') args.push('ps', '--all', '--format', 'json', ...SERVICES);
  if (action === 'config') args.push('config', '--quiet');
  return {
    binary: 'docker',
    args,
    env: {
      OBS_STATE_DIR: absolutePath(stateDir),
      OBS_GRAFANA_ADMIN_USER: validAdmin(adminUser) ? adminUser : 'operator-unavailable',
    },
  };
}

async function command(binary, args, { env = {}, timeout = 10000 } = {}) {
  try {
    return (
      await exec(binary, args, {
        cwd: DEPLOY,
        env: { ...process.env, ...env },
        timeout,
        maxBuffer: 65536,
      })
    ).stdout.trim();
  } catch {
    throw failure('E_OBS_COMMAND');
  }
}

async function localDocker(run, { requireVersion = false } = {}) {
  const endpoint =
    process.env.DOCKER_CONTEXT || !process.env.DOCKER_HOST
      ? await run('docker', ['context', 'inspect', '--format', '{{.Endpoints.docker.Host}}'])
      : process.env.DOCKER_HOST;
  if (!endpoint.startsWith('unix://')) throw failure('E_OBS_DOCKER_LOCAL');
  const options = await run('docker', ['info', '--format', '{{json .SecurityOptions}}']);
  let security;
  try {
    security = JSON.parse(options);
  } catch {
    throw failure('E_OBS_DOCKER_LOCAL');
  }
  if (
    !Array.isArray(security) ||
    security.some((value) => typeof value !== 'string' || /rootless|userns/.test(value))
  )
    throw failure('E_OBS_DOCKER_LOCAL');
  if (requireVersion) {
    let version;
    try {
      version = await run('docker', ['version', '--format', '{{.Server.Version}}']);
    } catch {
      throw failure('E_OBS_DOCKER_VERSION');
    }
    const match = /^(\d+)\./.exec(version);
    const major = match ? Number(match[1]) : NaN;
    // Engine 28 fixed access to localhost-published ports from the same L2 segment.
    // Emergency stop/guard remain available on older or unidentifiable engines.
    if (!Number.isSafeInteger(major) || major < 28) throw failure('E_OBS_DOCKER_VERSION');
  }
}

/** Reject a symlink at every existing path component, not only the final basename. */
async function noLinks(path, missingFinal = false, trustedParents = false) {
  const components = absolutePath(path).split('/').filter(Boolean);
  let current = '/';
  for (let i = 0; i < components.length; i++) {
    current = join(current, components[i]);
    let info;
    try {
      info = await lstat(current);
    } catch (error) {
      if (missingFinal && i === components.length - 1 && error.code === 'ENOENT') return;
      if (error.code === 'ENOENT') throw error;
      throw failure('E_OBS_STATE');
    }
    if (info.isSymbolicLink() || (i < components.length - 1 && !info.isDirectory()))
      throw failure('E_OBS_STATE');
    // A private leaf beneath an untrusted writable parent can be renamed between checks.
    // Root-owned sticky ancestors such as /tmp protect a root-owned child from that race.
    if (
      trustedParents &&
      i < components.length - 1 &&
      (info.uid !== 0 || (info.mode & 0o022 && !(info.mode & 0o1000)))
    )
      throw failure('E_OBS_STATE');
  }
}

async function checkEntry(path, uid, mode, directory) {
  await noLinks(path);
  const info = await lstat(path);
  if (
    info.uid !== uid ||
    (info.mode & 0o7777) !== mode ||
    (directory ? !info.isDirectory() : !info.isFile() || info.nlink !== 1)
  )
    throw failure('E_OBS_STATE');
  return info;
}

async function makeDirectory(path, uid, mode) {
  await noLinks(path, true);
  try {
    await mkdir(path, { mode });
    await chown(path, uid, uid);
    await chmod(path, mode);
  } catch (error) {
    if (error.code !== 'EEXIST') throw failure('E_OBS_STATE');
  }
  await checkEntry(path, uid, mode, true);
}

async function metadata(stateDir) {
  const path = join(stateDir, 'administrator.json');
  const info = await checkEntry(path, 0, 0o600, false);
  if (info.size > 1024) throw failure('E_OBS_STATE');
  let data;
  try {
    data = JSON.parse(await readFile(path, 'utf8'));
  } catch {
    throw failure('E_OBS_STATE');
  }
  if (
    data.schemaVersion !== 1 ||
    !validAdmin(data.adminUser) ||
    !/^[0-9a-f]{64}$/.test(data.probeSha256)
  )
    throw failure('E_OBS_STATE');
  return data;
}

async function verifyState(stateDir, envFile) {
  await noLinks(stateDir, false, true);
  await checkEntry(stateDir, 0, 0o700, true);
  for (const [directory, [uid, mode]] of Object.entries(DIRECTORIES))
    await checkEntry(join(stateDir, directory), uid, mode, true);
  const envInfo = await checkEntry(envFile, 0, 0o600, false);
  if (envInfo.size > 65536) throw failure('E_OBS_CONFIG');
  const secret = join(stateDir, 'secrets/grafana_admin_password');
  const secretInfo = await checkEntry(secret, 472, 0o400, false);
  if (secretInfo.size !== 65) throw failure('E_OBS_STATE');
  // The Grafana UID owns this file: bound the read even if that process changes it
  // after lstat, and never follow a replacement symlink as root.
  const handle = await open(secret, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const buffer = Buffer.alloc(66),
      current = await handle.stat();
    if (
      !current.isFile() ||
      current.nlink !== 1 ||
      current.size !== 65 ||
      current.uid !== secretInfo.uid ||
      (current.mode & 0o7777) !== 0o400
    )
      throw failure('E_OBS_STATE');
    const { bytesRead } = await handle.read(buffer, 0, 66, 0);
    if (
      bytesRead !== 65 ||
      !/^[a-f0-9]{64}\n$/.test(buffer.subarray(0, bytesRead).toString('utf8'))
    )
      throw failure('E_OBS_STATE');
  } finally {
    await handle.close();
  }
  const probe = join(stateDir, 'probe/busybox');
  const probeInfo = await checkEntry(probe, 0, 0o555, false);
  if (probeInfo.size < 1000 || probeInfo.size > 10 * 1024 ** 2) throw failure('E_OBS_STATE');
  const data = await metadata(stateDir);
  if (
    createHash('sha256')
      .update(await readFile(probe))
      .digest('hex') !== data.probeSha256
  )
    throw failure('E_OBS_STATE');
  return data;
}

async function initialize(options, run) {
  await noLinks(options.stateDir, true, true);
  await makeDirectory(options.stateDir, 0, 0o700);
  for (const [directory, [uid, mode]] of Object.entries(DIRECTORIES))
    await makeDirectory(join(options.stateDir, directory), uid, mode);
  const metadataPath = join(options.stateDir, 'administrator.json');
  try {
    await lstat(metadataPath);
    const data = await verifyState(options.stateDir, options.envFile);
    if (data.adminUser !== options.adminUser) throw failure('E_OBS_CONFIG');
    return;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const probe = join(options.stateDir, 'probe/busybox');
  const temporary = `${probe}.${randomBytes(12).toString('hex')}`;
  let container;
  try {
    // Docker create never runs the image entrypoint; the digest is the same pin as Compose.
    container = await run('docker', ['create', PROBE_IMAGE], { timeout: 120000 });
    if (!/^[a-f0-9]{64}$/.test(container)) throw failure('E_OBS_COMMAND');
    await run('docker', ['cp', `${container}:/bin/busybox`, temporary], { timeout: 30000 });
    const info = await lstat(temporary);
    if (
      !info.isFile() ||
      info.isSymbolicLink() ||
      info.nlink !== 1 ||
      info.size < 1000 ||
      info.size > 10 * 1024 ** 2
    )
      throw failure('E_OBS_STATE');
    await chown(temporary, 0, 0);
    await chmod(temporary, 0o555);
    // Exclusive creation also rejects an existing helper or symlink after a partial init.
    const bytes = await readFile(temporary);
    await writeFile(probe, bytes, { flag: 'wx', mode: 0o555 });
    await chmod(probe, 0o555);
  } finally {
    await unlink(temporary).catch(() => {});
    if (container && /^[a-f0-9]{64}$/.test(container))
      await run('docker', ['rm', container]).catch(() => {});
  }
  const secret = join(options.stateDir, 'secrets/grafana_admin_password');
  try {
    await writeFile(secret, randomBytes(32).toString('hex') + '\n', { flag: 'wx', mode: 0o400 });
    await chown(secret, 472, 472);
    await chmod(secret, 0o400);
  } catch (error) {
    if (error.code !== 'EEXIST') throw failure('E_OBS_STATE');
    await checkEntry(secret, 472, 0o400, false);
  }
  await writeFile(
    metadataPath,
    JSON.stringify({
      schemaVersion: 1,
      adminUser: options.adminUser,
      probeSha256: createHash('sha256')
        .update(await readFile(probe))
        .digest('hex'),
    }) + '\n',
    { flag: 'wx', mode: 0o600 },
  );
  await verifyState(options.stateDir, options.envFile);
}

async function measure(stateDir, run) {
  const disk = await statfs(stateDir);
  const usage = {};
  for (const key of Object.keys(BUDGETS)) {
    const path = key === 'total' ? stateDir : join(stateDir, key);
    const output = await run('du', ['-sb', '--', path]);
    const match = /^(\d+)\s/.exec(output);
    if (!match) throw failure('E_OBS_MEASURE');
    usage[key] = Number(match[1]);
  }
  return { freeBytes: disk.bavail * disk.bsize, usage };
}

async function recordGuard(stateDir, marker) {
  await checkEntry(stateDir, 0, 0o700, true);
  const destination = join(stateDir, 'guard-status.json');
  try {
    await checkEntry(destination, 0, 0o600, false);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const temporary = join(stateDir, `.guard-status.${randomBytes(12).toString('hex')}`);
  try {
    await writeFile(temporary, JSON.stringify(marker) + '\n', { flag: 'wx', mode: 0o600 });
    await rename(temporary, destination);
  } finally {
    await unlink(temporary).catch(() => {});
  }
}

/** Any measurement failure attempts a bounded stop before reporting failure. */
export async function guardStack({ measure: sample, stop, record }) {
  let measurement,
    decision,
    measurementError = 0,
    stopError = 0;
  try {
    measurement = await sample();
    decision = budgetDecision(measurement);
  } catch {
    decision = { level: 2, stop: true };
    measurementError = 1;
  }
  if (decision.stop) {
    try {
      await stop();
    } catch {
      stopError = 1;
    }
  }
  const marker = {
    schemaVersion: 1,
    checkedAt: Math.floor(Date.now() / 1000),
    level: decision.level,
    measurementError,
    stopped: decision.stop && !stopError ? 1 : 0,
    stopError,
  };
  if (measurement && !measurementError)
    Object.assign(
      marker,
      { freeBytes: measurement.freeBytes },
      Object.fromEntries(
        Object.entries(measurement.usage).map(([key, value]) => [`${key}Bytes`, value]),
      ),
    );
  await record(marker);
  if (stopError) throw failure('E_OBS_STOP');
  if (measurementError) throw failure('E_OBS_MEASURE');
  return marker;
}

async function executeStack(args, run) {
  const options = parseArgs(args);
  if (process.geteuid?.() !== 0) throw failure('E_OBS_ROOT');
  await localDocker(run, { requireVersion: ['init', 'up', 'restart'].includes(options.action) });
  const compose = async (action, adminUser) => {
    const plan = composePlan(action, { ...options, adminUser });
    return run(plan.binary, plan.args, {
      env: plan.env,
      timeout: action === 'up' ? 240000 : 120000,
    });
  };
  if (options.action === 'init') {
    await initialize(options, run);
    return { initialized: 1 };
  }
  if (options.action === 'guard')
    return guardStack({
      measure: async () => {
        await verifyState(options.stateDir, options.envFile);
        return measure(options.stateDir, run);
      },
      stop: () => compose('stop'),
      record: (marker) => recordGuard(options.stateDir, marker),
    });
  // Emergency stop does not depend on healthy storage, a readable password or a probe.
  if (options.action === 'stop') {
    await compose('stop');
    return { stopped: 1 };
  }
  const data = await verifyState(options.stateDir, options.envFile);
  if (options.action === 'status') {
    // Compose JSON contains only requested fields; never emit Config.Env or health log text.
    const text = await compose('status', data.adminUser);
    let rows;
    try {
      rows = text.startsWith('[')
        ? JSON.parse(text)
        : text
            .split('\n')
            .filter(Boolean)
            .map((line) => JSON.parse(line));
    } catch {
      throw failure('E_OBS_COMMAND');
    }
    if (!Array.isArray(rows) || rows.length > 16) throw failure('E_OBS_COMMAND');
    return {
      services: rows
        .filter((row) => SERVICES.includes(row.Service))
        .map((row) => ({
          service: row.Service,
          running: row.State === 'running' ? 1 : 0,
          healthy: row.Health === 'healthy' ? 1 : 0,
        })),
    };
  }
  const measurement = await measure(options.stateDir, run);
  if (budgetDecision(measurement).stop) throw failure('E_OBS_BUDGET');
  try {
    await run('systemctl', ['is-active', '--quiet', 'moongame-observability-guard.timer']);
  } catch {
    throw failure('E_OBS_GUARD_REQUIRED');
  }
  await compose('config', data.adminUser);
  await compose(options.action, data.adminUser);
  return { started: 1 };
}

export async function runStack(args, run = command) {
  try {
    return await executeStack(args, run);
  } catch (error) {
    throw failure(/^E_OBS_[A-Z_]+$/.test(error?.message) ? error.message : 'E_OBS_STACK');
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runStack(process.argv.slice(2))
    .then((result) => {
      process.stdout.write(JSON.stringify(result) + '\n');
    })
    .catch((error) => {
      process.stderr.write(
        /^E_OBS_[A-Z_]+$/.test(error.message) ? `${error.message}\n` : 'E_OBS_STACK\n',
      );
      process.exitCode = 1;
    });
}
