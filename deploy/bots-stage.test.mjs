import { afterEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const compose = fileURLToPath(new URL('./docker-compose.bots-stage.yml', import.meta.url));
const dirs = [];
afterEach(() => dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })));

function composeAvailable() {
  try {
    const version = execFileSync('docker', ['compose', 'version', '--short'], {
      encoding: 'utf8',
      stdio: 'pipe',
      timeout: 30000, // a loaded CI runner can take >3 s; a false "missing" fails the gate
    });
    const match = /^v?(\d+)\.(\d+)/.exec(version.trim());
    return !!match && (Number(match[1]) > 2 || (Number(match[1]) === 2 && Number(match[2]) >= 30));
  } catch {
    return false;
  }
}
const available = composeAvailable();
if (process.env.CI && !available)
  throw new Error('Bot stage integration tests require Compose >=2.30 in CI');

function config({ scanner = false } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'bots-stage-'));
  dirs.push(dir);
  const serverEnv = join(dir, 'server.env');
  const postgresEnv = join(dir, 'postgres.env');
  // Raw mode must preserve dollars, quotes and hashes in existing credentials.
  writeFileSync(serverEnv, 'AUTH_JWT_SECRET=stage$secret#"literal\n');
  writeFileSync(
    postgresEnv,
    'POSTGRES_USER=stage\nPOSTGRES_DB=stage\nPOSTGRES_PASSWORD=stage$pw\n',
  );
  return JSON.parse(
    execFileSync(
      'docker',
      [
        'compose',
        '-f',
        compose,
        'config',
        '--format',
        'json',
        ...(scanner ? ['--no-interpolate', '--no-env-resolution'] : []),
      ],
      {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        env: {
          ...process.env,
          STAGE_SERVER_IMAGE: `ghcr.io/example/server@sha256:${'a'.repeat(64)}`,
          STAGE_POSTGRES_IMAGE: `postgres@sha256:${'b'.repeat(64)}`,
          STAGE_RELEASE_DIR: join(dir, 'release'),
          STAGE_SERVER_ENV_FILE: serverEnv,
          STAGE_POSTGRES_ENV_FILE: postgresEnv,
        },
      },
    ),
  );
}

describe.skipIf(!available)('isolated bot stage deployment', () => {
  it('renders privilege guards and bounded resources for both services', () => {
    const { services } = config();
    expect(Object.keys(services).sort()).toEqual(['stage-postgres', 'stage-server']);
    for (const service of Object.values(services)) {
      expect(service.security_opt).toContain('no-new-privileges:true');
      expect(service.pids_limit).toBeGreaterThan(0);
      expect(Number(service.mem_limit)).toBeGreaterThan(0);
      expect(Number(service.cpus)).toBeGreaterThan(0);
      expect(service.ports ?? []).toEqual([]);
      expect(Object.keys(service.networks)).toEqual(['stage']);
    }
    expect(services['stage-server'].cap_drop).toEqual(['ALL']);
    expect(services['stage-server'].user).toBe('65532:65532');
    expect(services['stage-server'].read_only).toBe(true);
    expect(services['stage-server'].volumes.every((volume) => volume.read_only)).toBe(true);
  });
  it('preserves literal credentials and the existing external database volume', () => {
    const result = config();
    // Compose versions may escape literal dollars for a subsequent Compose parse.
    const literal = (value) => value.replaceAll('$$', '$');
    expect(literal(result.services['stage-server'].environment.AUTH_JWT_SECRET)).toBe(
      'stage$secret#"literal',
    );
    expect(literal(result.services['stage-postgres'].environment.POSTGRES_PASSWORD)).toBe(
      'stage$pw',
    );
    expect(result.volumes['stage-pgdata']).toMatchObject({
      external: true,
      name: 'moongame-bots-stage-postgres',
    });
    expect(result.networks.stage).toMatchObject({ external: true, name: 'moongame-bots-stage' });
    expect(result.services['stage-server'].depends_on['stage-postgres'].condition).toBe(
      'service_healthy',
    );
  });
  it('renders KICS input without resolving private environment files or paths', () => {
    const result = config({ scanner: true });
    const text = JSON.stringify(result);
    expect(text).not.toContain('stage$');
    expect(text).not.toContain('/bots-stage-');
    expect(result.services['stage-server'].volumes[0].source).toContain('${STAGE_RELEASE_DIR:');
    expect(result.services['stage-server'].environment).toBeUndefined();
  });
});
