// Read-only local inspection. Never source server.env, print docker inspect, or probe a URL.
import { execFileSync } from 'node:child_process';
import { lstatSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const enabled = (value) => value === '1' || value === 'true';
const loopback = (ip) => ip === '127.0.0.1' || ip === '::1';

/** Whitelist projection: raw environment values and exception messages never reach output. */
export function assessContainer(container) {
  const service = container.Config?.Labels?.['com.docker.compose.service'];
  if (!['server', 'postgres', 'caddy'].includes(service)) return undefined;
  const env = Object.fromEntries(
    (container.Config.Env ?? []).map((item) => {
      const at = item.indexOf('=');
      return [item.slice(0, at), item.slice(at + 1)];
    }),
  );
  const host = container.HostConfig ?? {};
  const findings = [];
  const add = (id, severity) => findings.push({ id, severity });
  const state = container.State ?? {};
  const effective = {
    service,
    running: state.Running === true,
    health: ['healthy', 'unhealthy', 'starting'].includes(state.Health?.Status)
      ? state.Health.Status
      : 'unverified',
    digestPinned: /@sha256:[a-f0-9]{64}$/.test(container.Config.Image ?? ''),
    readOnlyRoot: host.ReadonlyRootfs === true,
    noNewPrivileges: (host.SecurityOpt ?? []).some(
      (o) => o === 'no-new-privileges' || o === 'no-new-privileges:true',
    ),
    memoryBounded: host.Memory > 0,
    pidsBounded: host.PidsLimit > 0,
  };
  if (!effective.running) add('container.stopped', 'high');
  if (effective.health === 'unhealthy') add('container.unhealthy', 'high');
  if (!effective.noNewPrivileges) add('container.privilege-escalation', 'high');
  if (host.Privileged) add('container.privileged', 'critical');
  if (!effective.memoryBounded || !effective.pidsBounded) add('container.unbounded', 'medium');
  if (!effective.digestPinned) add('image.mutable-tag', 'medium');
  if (service === 'server') {
    effective.prod = enabled(env.PROD);
    effective.auth = (env.AUTH_JWT_SECRET ?? '').length >= 32;
    effective.gate = enabled(env.GATE);
    effective.seatLock = enabled(env.SEAT_LOCK);
    effective.originAllowlist = Boolean(env.ALLOWED_ORIGINS?.split(',').some((o) => o.trim()));
    effective.tlsConfigured =
      Boolean(env.TLS_KEY_FILE && env.TLS_CERT_FILE) || env.TRUST_PROXY === '1';
    effective.leastPrivilegeGuard =
      env.DB_AUTO_MIGRATE === '0' && env.DB_REQUIRE_LEAST_PRIVILEGE === '1';
    effective.audit = enabled(env.PROD) || env.SECURITY_AUDIT === '1';
    effective.logsBounded =
      ['local', 'json-file'].includes(host.LogConfig?.Type) &&
      Number(host.LogConfig?.Config?.['max-file']) > 0 &&
      /^\d+[kmg]$/i.test(host.LogConfig?.Config?.['max-size'] ?? '');
    let database;
    let nonDefaultDbPassword = false;
    try {
      database = new URL(env.DATABASE_URL);
      nonDefaultDbPassword = Boolean(
        database.password && decodeURIComponent(database.password) !== 'void',
      );
    } catch {
      /* remains unverified */
    }
    effective.nonDefaultDbPassword = nonDefaultDbPassword;
    const retired = Number(env.AUTH_JWT_PREVIOUS_UNTIL);
    effective.previousKey = env.AUTH_JWT_PREVIOUS_SECRET
      ? Number.isSafeInteger(retired) && retired > 0
        ? 'bounded'
        : 'invalid'
      : 'absent';
    for (const key of [
      'prod',
      'auth',
      'gate',
      'seatLock',
      'originAllowlist',
      'tlsConfigured',
      'nonDefaultDbPassword',
    ]) {
      if (!effective[key]) add(`server.${key}`, 'high');
    }
    if (!effective.leastPrivilegeGuard) add('database.runtime-guard-disabled', 'high');
    if (!effective.audit || !effective.logsBounded) add('audit.incomplete', 'medium');
    if (effective.previousKey === 'invalid') add('auth.unbounded-old-key', 'high');
    if (!/^(?:65532|nonroot)(?::(?:65532|nonroot))?$/.test(container.Config.User ?? ''))
      add('server.user-unverified', 'medium');
    if (!(host.CapDrop ?? []).some((v) => v.toUpperCase() === 'ALL'))
      add('server.capabilities', 'high');
    const published = Object.entries(container.NetworkSettings?.Ports ?? {})
      .filter(([port]) => port.startsWith('8788/'))
      .flatMap(([, bindings]) => bindings ?? []);
    if (published.some((p) => !loopback(p.HostIp)) && !(env.TLS_KEY_FILE && env.TLS_CERT_FILE))
      add('server.public-plaintext-port', 'critical');
    if (!effective.readOnlyRoot) add('server.writable-root', 'medium');
  }
  if (service === 'postgres') {
    const ports = Object.values(container.NetworkSettings?.Ports ?? {}).flatMap(
      (bindings) => bindings ?? [],
    );
    if (ports.some((p) => !loopback(p.HostIp))) add('database.public-port', 'critical');
  }
  return { ...effective, findings };
}

export function collectPosture(envFile = '/var/lib/moongame/server.env') {
  const environment = { ...process.env };
  for (const name of [
    'DOCKER_HOST',
    'DOCKER_CONTEXT',
    'DOCKER_TLS',
    'DOCKER_TLS_VERIFY',
    'DOCKER_CERT_PATH',
  ])
    delete environment[name];
  const result = {
    kind: 'security.posture',
    at: new Date().toISOString(),
    mode: 'read-only',
    containers: [],
    envPermissions: 'unverified',
    inspection: 'unverified',
    unverified: [
      'firewall-and-SSH-policy',
      'certificate-validity',
      'image-signature',
      'actual-database-grants',
      'backups-and-restore',
      'external-alert-delivery',
    ],
  };
  try {
    const stat = lstatSync(envFile);
    result.envPermissions = stat.isFile() && (stat.mode & 0o077) === 0 ? 'restricted' : 'unsafe';
  } catch {
    /* absent or denied, do not print exception/file contents */
  }
  try {
    const ids = execFileSync(
      'docker',
      [
        '--host=unix:///var/run/docker.sock',
        'ps',
        '-aq',
        '--filter',
        'label=com.docker.compose.project=deploy',
      ],
      { encoding: 'utf8', timeout: 10_000, stdio: ['ignore', 'pipe', 'pipe'], env: environment },
    )
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    if (!ids.length) {
      result.inspection = 'stack-not-found';
      return result;
    }
    const raw = execFileSync('docker', ['--host=unix:///var/run/docker.sock', 'inspect', ...ids], {
      encoding: 'utf8',
      timeout: 10_000,
      maxBuffer: 8 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: environment,
    });
    result.containers = JSON.parse(raw).map(assessContainer).filter(Boolean);
    result.inspection = result.containers.some((c) => c.service === 'server')
      ? 'inspected'
      : 'server-not-found';
  } catch {
    result.inspection = 'E_POSTURE_INSPECT';
  }
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = collectPosture(process.argv[2]);
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  process.exitCode =
    result.inspection !== 'inspected' ||
    result.envPermissions !== 'restricted' ||
    result.containers.some((c) => c.findings.some((f) => ['critical', 'high'].includes(f.severity)))
      ? 1
      : 0;
}
