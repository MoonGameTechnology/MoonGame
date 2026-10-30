// Root control-plane installation on the existing signed single-VPS deployment.
// The collector itself has no Docker/API/DB access and performs no response actions.
import { constants } from 'node:fs';
import { readFile, writeFile, open, mkdir, lstat, statfs, access, chmod } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { withEdgeImport } from './edge-logging.mjs';

const STATE = '/var/lib/moongame',
  CONFIG = '/etc/moongame/security-monitor.env';
function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    timeout: 60000,
    maxBuffer: 262144,
    ...options,
  });
  if (result.status !== 0) throw Error('E_SECURITY_INSTALL_STEP');
  return (result.stdout ?? '').trim();
}
async function protectedFile(path) {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = await file.stat();
    if (
      !stat.isFile() ||
      stat.nlink !== 1 ||
      stat.uid !== 0 ||
      stat.mode & 0o022 ||
      stat.size > 65536
    )
      throw Error('E_SECURITY_INSTALL_FILE');
    return await file.readFile('utf8');
  } finally {
    await file.close();
  }
}
async function replaceMounted(path, content) {
  const file = await open(path, constants.O_WRONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    await file.truncate(0);
    await file.writeFile(content);
    await file.datasync();
  } finally {
    await file.close();
  }
}
async function install() {
  if (process.getuid() !== 0) throw Error('E_SECURITY_INSTALL_ROOT');
  if (process.argv[2] !== '--locked') {
    const result = spawnSync(
      '/usr/bin/flock',
      [
        '-n',
        '-E',
        '75',
        STATE + '/autoupdate.lock',
        process.execPath,
        fileURLToPath(import.meta.url),
        '--locked',
      ],
      { stdio: 'inherit', timeout: 180000 },
    );
    process.exitCode = result.status ?? 1;
    return;
  }
  await access(STATE + '/current/deploy/security/monitor.mjs');
  try {
    await lstat(STATE + '/resource-pressure.json');
    throw Error('E_SECURITY_INSTALL_PRESSURE');
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
  }
  const disk = await statfs('/');
  if (disk.bavail * disk.bsize < 6.5 * 1024 ** 3) throw Error('E_SECURITY_INSTALL_RESERVE');
  const revisions = run('docker', [
    'inspect',
    '--format',
    '{{index .Config.Labels "org.opencontainers.image.revision"}}',
    'deploy-server-1',
    'deploy-caddy-1',
  ]).split('\n');
  if (
    revisions.length !== 2 ||
    !/^[a-f0-9]{40}$/.test(revisions[0]) ||
    revisions[0] !== revisions[1]
  )
    throw Error('E_SECURITY_INSTALL_RELEASE_PAIR');
  const source = await protectedFile(STATE + '/Caddyfile'),
    candidate = withEdgeImport(source);
  const logDir = run('docker', [
    'volume',
    'inspect',
    '--format',
    '{{.Mountpoint}}',
    'deploy_void-logs',
  ]);
  const dataDir = run('docker', [
    'volume',
    'inspect',
    '--format',
    '{{.Mountpoint}}',
    'deploy_caddy-data',
  ]);
  for (const path of [logDir, dataDir])
    if (!/^\/var\/lib\/docker\/volumes\/[A-Za-z0-9_-]+\/_data$/.test(path))
      throw Error('E_SECURITY_INSTALL_VOLUME');
  const edgeDir = dataDir + '/moongame-security';
  await mkdir(edgeDir, { recursive: true, mode: 0o700 });
  const edgeInfo = await lstat(edgeDir);
  if (!edgeInfo.isDirectory() || edgeInfo.isSymbolicLink() || edgeInfo.uid !== 0)
    throw Error('E_SECURITY_INSTALL_EDGE_DIRECTORY');
  await chmod(edgeDir, 0o700);
  run(
    'docker',
    [
      'exec',
      '-i',
      'deploy-caddy-1',
      'caddy',
      'validate',
      '--config',
      '-',
      '--adapter',
      'caddyfile',
    ],
    { input: candidate },
  );
  // Read only the nonsecret DOMAIN setting; neither the file nor credentials enter output.
  const env = await protectedFile(STATE + '/server.env');
  const domain = /^DOMAIN=([A-Za-z0-9.-]+)\r?$/m.exec(env)?.[1];
  if (!domain) throw Error('E_SECURITY_INSTALL_DOMAIN');
  let changed = false;
  try {
    if (candidate !== source) {
      await replaceMounted(STATE + '/Caddyfile', candidate);
      changed = true;
      run('docker', [
        'exec',
        'deploy-caddy-1',
        'caddy',
        'reload',
        '--config',
        '/etc/caddy/Caddyfile',
        '--adapter',
        'caddyfile',
      ]);
    }
    const health = JSON.parse(
      run('curl', ['-fsS', '--max-time', '10', `https://${domain}/health`]),
    );
    const ready = JSON.parse(run('curl', ['-fsS', '--max-time', '10', `https://${domain}/ready`]));
    if (health.ok !== true || health.version !== revisions[0].slice(0, 12) || ready.ready !== true)
      throw Error('E_SECURITY_INSTALL_HEALTH');
    // One protected-route probe verifies the edge logger without creating accounts,
    // product events, gameplay commands or a synthetic incident.
    const response = run('curl', [
      '-sS',
      '--max-time',
      '10',
      '-o',
      '/dev/null',
      '-w',
      '%{http_code}',
      `https://${domain}/metrics`,
    ]);
    if (response !== '404') throw Error('E_SECURITY_INSTALL_BOUNDARY');
  } catch (error) {
    if (changed) {
      await replaceMounted(STATE + '/Caddyfile', source);
      run('docker', [
        'exec',
        'deploy-caddy-1',
        'caddy',
        'reload',
        '--config',
        '/etc/caddy/Caddyfile',
        '--adapter',
        'caddyfile',
      ]);
    }
    throw error;
  }
  await mkdir('/etc/moongame', { recursive: true, mode: 0o700 });
  await mkdir('/var/lib/moongame-security', { recursive: true, mode: 0o700 });
  const stateInfo = await lstat('/var/lib/moongame-security');
  if (!stateInfo.isDirectory() || stateInfo.isSymbolicLink() || stateInfo.uid !== 0)
    throw Error('E_SECURITY_INSTALL_STATE');
  await chmod('/var/lib/moongame-security', 0o700);
  const values = {
    SECURITY_LOG_DIR: logDir,
    SECURITY_METRICS_DIR: '/var/lib/moongame-metrics',
    SECURITY_STATE_DIR: '/var/lib/moongame-security',
    SECURITY_EDGE_LOG_DIR: edgeDir,
    SECURITY_MAINTENANCE_MARKER: STATE + '/account-erasure.pending',
    SECURITY_MAINTENANCE_SUCCESS: STATE + '/account-erasure.last-success',
  };
  const text =
    Object.entries(values)
      .map(([k, v]) => `${k}=${v}`)
      .join('\n') + '\n';
  try {
    const existing = await protectedFile(CONFIG);
    if (existing !== text) throw Error('E_SECURITY_INSTALL_CONFIG_CHANGED');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    await writeFile(CONFIG, text, { mode: 0o600, flag: 'wx' });
  }
  await chmod(CONFIG, 0o600);
  for (const name of ['moongame-security-monitor.service', 'moongame-security-monitor.timer']) {
    const target = '/etc/systemd/system/' + name;
    try {
      await protectedFile(target);
    } catch (e) {
      if (e.code !== 'ENOENT') throw e;
    }
    await writeFile(target, await readFile(new URL('./' + name, import.meta.url)), { mode: 0o644 });
  }
  // Keep the observer's UID, credentials and write scope. Only expose the public
  // code directory through a read-only bind; /var/lib/moongame remains root0700.
  const dropDir = '/etc/systemd/system/moongame-observer.service.d';
  await mkdir(dropDir, { recursive: true, mode: 0o755 });
  const dropPath = dropDir + '/40-signed-release-code.conf';
  const drop =
    '[Service]\nBindReadOnlyPaths=/var/lib/moongame/current/deploy/observability:/run/moongame-observer-code\nExecStart=\nExecStart=/usr/bin/node /run/moongame-observer-code/observer.mjs\n';
  try {
    await protectedFile(dropPath);
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
  }
  await writeFile(dropPath, drop, { mode: 0o644 });
  await writeFile(STATE + '/security-monitor.version', '1\n', { mode: 0o600 });
  run('systemctl', ['daemon-reload']);
  run('systemctl', ['try-restart', 'moongame-observer.service']);
  run('systemctl', ['enable', '--now', 'moongame-security-monitor.timer']);
  process.stdout.write(
    JSON.stringify({
      installed: true,
      revision: revisions[0],
      timer: 'moongame-security-monitor.timer',
      notifications: 'panel-only',
      heavyStackStarted: false,
    }) + '\n',
  );
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  install().catch((error) => {
    process.stderr.write(
      /^E_SECURITY_[A-Z_]+$/.test(error.message) ? error.message + '\n' : 'E_SECURITY_INSTALL\n',
    );
    process.exitCode = 1;
  });
