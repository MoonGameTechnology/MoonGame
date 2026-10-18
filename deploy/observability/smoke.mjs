// Isolated Docker acceptance for OBS-0.2. Never starts Game or deletes its volumes.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, copyFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import assert from 'node:assert/strict';

const deploy = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const state = mkdtempSync(resolve(tmpdir(), 'moongame-obs-smoke-'));
const project = `obs-smoke-${process.pid}`;
const services = ['obs-grafana', 'obs-prometheus', 'obs-loki', 'obs-alloy'];
const env = { ...process.env, OBS_STATE_DIR: state, OBS_GRAFANA_ADMIN_USER: 'smoke-operator' };
const compose = [
  'compose',
  '-p',
  project,
  '-f',
  'docker-compose.yml',
  '-f',
  'docker-compose.observability.yml',
  '--profile',
  'observability',
];
const run = (args) =>
  execFileSync('docker', args, {
    cwd: deploy,
    env,
    encoding: 'utf8',
    timeout: 180_000,
    maxBuffer: 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
const config = JSON.parse(run([...compose, 'config', '--format', 'json']));
const prom = config.services['obs-prometheus'].image;
const password = randomBytes(32).toString('hex');
const viewerPassword = randomBytes(32).toString('hex');
const baseURL = 'http://127.0.0.1:3000';
const auth = (user, pass) => ({
  Authorization: `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}`,
});
// Probe the service namespace, independently of host Docker forwarding.
const api = async (path, options = {}) => {
  const id = run([...compose, 'ps', '-q', 'obs-grafana']);
  const lines = [
    'silent',
    'show-error',
    'noproxy = "127.0.0.1"',
    'max-time = 5',
    `url = ${JSON.stringify(`${baseURL}${path}`)}`,
    `request = ${JSON.stringify(options.method ?? 'GET')}`,
    `write-out = ${JSON.stringify('\n%{http_code}')}`,
  ];
  for (const [name, value] of Object.entries(options.headers ?? {}))
    lines.push(`header = ${JSON.stringify(`${name}: ${value}`)}`);
  if (options.body !== undefined) lines.push(`data = ${JSON.stringify(options.body)}`);
  const raw = execFileSync('docker', ['exec', '-i', id, 'curl', '--config', '-'], {
    cwd: deploy,
    env,
    encoding: 'utf8',
    timeout: 10000,
    maxBuffer: 1024 * 1024,
    input: lines.join('\n') + '\n',
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const boundary = raw.lastIndexOf('\n');
  const status = Number(raw.slice(boundary + 1));
  assert.ok(Number.isInteger(status) && status >= 100 && status <= 599);
  return {
    status,
    ok: status >= 200 && status < 300,
    json: () => JSON.parse(raw.slice(0, boundary)),
  };
};

const admin = auth('smoke-operator', password);
let extractor;
let stage = 'initialization';
try {
  // A trusted one-shot initializer owns ONLY this newly-created fixture directory.
  chmodSync(state, 0o755);
  for (const name of ['grafana', 'prometheus', 'loki', 'alloy', 'secrets', 'probe']) {
    mkdirSync(resolve(state, name), { mode: 0o755 });
    chmodSync(resolve(state, name), 0o755);
  }
  writeFileSync(resolve(state, 'secrets/grafana_admin_password'), password, { mode: 0o600 });
  extractor = run(['create', prom]);
  run(['cp', `${extractor}:/bin/busybox`, resolve(state, 'probe/busybox')]);
  // Keep the writable Grafana state across a real process restart.
  copyFileSync(
    resolve(deploy, 'observability/prometheus.yml'),
    resolve(state, 'fixture-prometheus.yml'),
  );
  run([
    'run',
    '--rm',
    '--network',
    'none',
    '--read-only',
    '--user',
    '0:0',
    '--cap-drop',
    'ALL',
    '--cap-add',
    'CHOWN',
    '--cap-add',
    'FOWNER',
    '--cap-add',
    'DAC_OVERRIDE',
    '-v',
    `${state}:/state`,
    '--entrypoint',
    '/bin/sh',
    prom,
    '-c',
    'chown 472:472 /state/grafana /state/secrets /state/secrets/grafana_admin_password; chmod 700 /state/secrets; chmod 400 /state/secrets/grafana_admin_password; chown 65534:65534 /state/prometheus; chown 10001:10001 /state/loki; chown 473:473 /state/alloy; chmod 555 /state/probe/busybox',
  ]);
  stage = 'Game configuration parity';
  const base = JSON.parse(
    run(['compose', '-p', project, '-f', 'docker-compose.yml', 'config', '--format', 'json']),
  );
  for (const service of ['server', 'postgres'])
    assert.deepEqual(config.services[service], base.services[service]);
  stage = 'container startup';
  run([...compose, 'up', '--no-deps', '--wait', '--wait-timeout', '120', '-d', ...services]);
  stage = 'container hardening';
  for (const service of services) {
    const id = run([...compose, 'ps', '-q', service]);
    const [container] = JSON.parse(run(['inspect', id]));
    assert.equal(container.State.Health.Status, 'healthy');
    assert.equal(container.HostConfig.ReadonlyRootfs, true);
    assert.equal(container.HostConfig.Privileged, false);
    assert.deepEqual(container.HostConfig.CapDrop, ['ALL']);
    assert.ok(container.Config.User && !container.Config.User.startsWith('0:'));
    assert.ok(
      !container.Mounts.some((mount) => /docker\.sock|playtest-logs|pgdata/.test(mount.Source)),
    );
    const ports = container.HostConfig.PortBindings ?? {};
    if (service === 'obs-grafana')
      assert.deepEqual(ports, { '3000/tcp': [{ HostIp: '127.0.0.1', HostPort: '3000' }] });
    else assert.deepEqual(ports, {});
  }
  stage = 'anonymous and spoofed-header denial';
  for (const path of [
    '/api/search',
    '/api/datasources',
    '/api/datasources/proxy/uid/moongame-prometheus/-/ready',
  ]) {
    const anonymous = await api(path);
    stage = `anonymous denial ${path} status=${anonymous.status}`;
    assert.equal(anonymous.status, 401);
    const spoofed = await api(path, {
      headers: {
        'X-WEBAUTH-USER': 'smoke-operator',
        'X-Forwarded-User': 'smoke-operator',
        'X-Forwarded-For': '127.0.0.1',
      },
    });
    stage = `spoofed-header denial ${path} status=${spoofed.status}`;
    assert.equal(spoofed.status, 401);
  }
  stage = 'datasource provisioning and write denial';
  const ds = await api('/api/datasources', { headers: admin });
  assert.equal(ds.status, 200);
  const sources = await ds.json();
  assert.deepEqual(
    sources.map((source) => source.uid),
    ['moongame-prometheus'],
  );
  assert.equal(sources[0].readOnly, true);
  assert.equal(
    (await api('/api/datasources/proxy/uid/moongame-prometheus/-/ready', { headers: admin }))
      .status,
    200,
  );
  for (const path of [
    '/api/snapshots',
    '/api/datasources/proxy/uid/moongame-prometheus/api/v1/admin/tsdb/delete_series',
    '/api/datasources/proxy/uid/moongame-prometheus/api/v1/write',
    '/api/datasources/proxy/uid/moongame-prometheus/loki/api/v1/push',
  ]) {
    assert.ok(
      !(
        await api(path, {
          method: 'POST',
          headers: { ...admin, 'Content-Type': 'application/json' },
          body: '{}',
        })
      ).ok,
    );
  }
  assert.ok(!(await api('/api/public/dashboards/unknown')).ok);
  stage = 'Viewer role and restart persistence';
  const created = await api('/api/admin/users', {
    method: 'POST',
    headers: { ...admin, 'Content-Type': 'application/json' },
    body: JSON.stringify({ login: 'smoke-viewer', name: 'Smoke Viewer', password: viewerPassword }),
  });
  assert.equal(created.status, 200);
  const viewer = auth('smoke-viewer', viewerPassword);
  assert.equal(
    (
      await api('/api/admin/users', {
        method: 'POST',
        headers: { ...viewer, 'Content-Type': 'application/json' },
        body: '{}',
      })
    ).status,
    403,
  );
  run([...compose, 'restart', ...services]);
  run([...compose, 'up', '--no-deps', '--wait', '--wait-timeout', '120', '-d', ...services]);
  assert.equal((await api('/api/user', { headers: viewer })).status, 200);
  assert.equal((await api('/api/datasources', { headers: admin })).status, 200);
  console.log(
    'OBS-0.2 smoke OK: four healthy non-root containers, loopback/auth/proxy boundary, restart persistence; Game config unchanged.',
  );
} catch {
  // No raw child-process output: bootstrap credentials must never enter CI logs.
  console.error(`E_OBS_SMOKE: ${stage}`);
  process.exitCode = 1;
} finally {
  // Every cleanup is attempted even if the previous resource could not be removed.
  const cleanup = (args) => {
    try {
      return run(args);
    } catch {
      console.error('E_OBS_SMOKE_CLEANUP');
      process.exitCode = 1;
      return '';
    }
  };
  if (extractor) cleanup(['rm', '-f', extractor]);
  cleanup([...compose, 'stop', ...services]);
  cleanup([...compose, 'rm', '-f', ...services]);
  const networks = cleanup([
    'network',
    'ls',
    '-q',
    '--filter',
    `label=com.docker.compose.project=${project}`,
  ]);
  for (const id of networks.split('\n').filter(Boolean)) cleanup(['network', 'rm', id]);
  console.log(`Private fixture retained for inspection: ${state}`);
}
