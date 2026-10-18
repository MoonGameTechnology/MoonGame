// Exercise the exact offline Compose rendering used by the KICS security scan.
import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const DEPLOY = fileURLToPath(new URL('../', import.meta.url));
const SENTINELS = Object.freeze({
  OBS_STATE_DIR: '/tmp/OBS_TEST_NOINTERPOLATE_STATE_1713',
  OBS_GRAFANA_ADMIN_USER: 'OBS_TEST_NOINTERPOLATE_OPERATOR_1713',
  POSTGRES_PASSWORD: 'OBS_TEST_NOINTERPOLATE_PASSWORD_1713',
  DOMAIN: 'obs-test-nointerpolate-1713.invalid',
});

function composeAvailable() {
  try {
    const version = execFileSync('docker', ['compose', 'version', '--short'], {
      encoding: 'utf8',
      timeout: 3000,
      maxBuffer: 8192,
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
    const match = /^v?(\d+)\.(\d+)\.(\d+)/.exec(version);
    if (!match) return false;
    const [, major, minor, patch] = match.map(Number);
    // The public TLS overlay uses !override, introduced in Compose v2.24.4.
    return major > 2 || (major === 2 && (minor > 24 || (minor === 24 && patch >= 4)));
  } catch {
    return false;
  }
}

function config(files) {
  let text;
  try {
    text = execFileSync(
      'docker',
      [
        'compose',
        ...files.flatMap((file) => ['-f', file]),
        'config',
        '--no-interpolate',
        '--format',
        'json',
      ],
      {
        cwd: DEPLOY,
        env: { ...process.env, ...SENTINELS },
        encoding: 'utf8',
        timeout: 10000,
        maxBuffer: 1024 * 1024,
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
  } catch {
    throw new Error('E_OBS_COMPOSE');
  }
  // Never dump the rendered configuration or captured stderr in an assertion.
  expect(Object.values(SENTINELS).some((value) => text.includes(value))).toBe(false);
  try {
    return JSON.parse(text);
  } catch {
    throw new Error('E_OBS_COMPOSE');
  }
}

function environmentValue(environment, key) {
  // With --no-interpolate, Compose may retain the merged environment in list form.
  return Array.isArray(environment)
    ? environment.find((entry) => entry.startsWith(`${key}=`))?.slice(key.length + 1)
    : environment?.[key];
}

describe.skipIf(!composeAvailable())('OBS-0.2 KICS effective Compose', () => {
  it.each([
    ['base+observability', ['docker-compose.yml', 'docker-compose.observability.yml']],
    [
      'release+observability',
      [
        'docker-compose.yml',
        'docker-compose.tls.yml',
        'docker-compose.release.yml',
        'docker-compose.release-tls.yml',
        'docker-compose.observability.yml',
      ],
    ],
  ])('renders %s without interpolating operator credentials', (_name, files) => {
    const rendered = config(files);
    const grafana = rendered.services['obs-grafana'];
    const adminUser = environmentValue(grafana?.environment, 'GF_SECURITY_ADMIN_USER');
    const postgresPassword = environmentValue(
      rendered.services.postgres.environment,
      'POSTGRES_PASSWORD',
    );
    expect(
      typeof adminUser === 'string' && adminUser.startsWith('${OBS_GRAFANA_ADMIN_USER:?'),
    ).toBe(true);
    expect(
      typeof postgresPassword === 'string' && postgresPassword.includes('${POSTGRES_PASSWORD'),
    ).toBe(true);
    for (const service of ['obs-grafana', 'obs-prometheus', 'obs-loki', 'obs-alloy']) {
      const mounts = rendered.services[service]?.volumes ?? [];
      expect(
        mounts.some((mount) => mount.type === 'bind' && mount.source.includes('${OBS_STATE_DIR:?')),
      ).toBe(true);
    }
    const secret = rendered.secrets.grafana_admin_password.file;
    expect(typeof secret === 'string' && secret.includes('${OBS_STATE_DIR:?')).toBe(true);
    if (rendered.services.caddy) {
      const domain = environmentValue(rendered.services.caddy.environment, 'DOMAIN');
      expect(typeof domain === 'string' && domain.startsWith('${DOMAIN:?')).toBe(true);
    }
  });
});
