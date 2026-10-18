import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, readFile, symlink, lstat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  BUDGETS,
  SERVICES,
  budgetDecision,
  composePlan,
  guardStack,
  parseArgs,
  runStack,
} from './stack.mjs';

// Real files exercise permissions, symlinks and exclusive writes. Only root ownership
// is modelled so these security regressions also run on unprivileged CI workers.
const ownership = vi.hoisted(() => new Map());
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    chown: async (path, uid) => {
      ownership.set(String(path), uid);
    },
    lstat: async (path) =>
      Object.assign(Object.create(await actual.lstat(path)), {
        uid: ownership.get(String(path)) ?? 0,
      }),
    open: async (...args) => {
      const handle = await actual.open(...args);
      return {
        stat: async () =>
          Object.assign(Object.create(await handle.stat()), {
            uid: ownership.get(String(args[0])) ?? 0,
          }),
        read: (...values) => handle.read(...values),
        close: () => handle.close(),
      };
    },
    statfs: async () => ({ bavail: 20, bsize: 1024 ** 3 }),
  };
});

const GiB = 1024 ** 3;
const empty = () => Object.fromEntries(Object.keys(BUDGETS).map((key) => [key, 0]));
const options = {
  stateDir: '/var/lib/moongame-observability',
  envFile: '/root/server.env',
  adminUser: 'alice',
};

describe('OBS-0.2 budget guard', () => {
  it('keeps a measured zero distinct from missing or invalid measurements', () => {
    expect(budgetDecision({ freeBytes: 12 * GiB, usage: empty() })).toEqual({
      level: 0,
      stop: false,
    });
    for (const invalid of [undefined, null, NaN, Infinity, -1, '0', 0.5]) {
      expect(() => budgetDecision({ freeBytes: invalid, usage: empty() })).toThrow('E_OBS_MEASURE');
      expect(() =>
        budgetDecision({ freeBytes: 20 * GiB, usage: { ...empty(), loki: invalid } }),
      ).toThrow('E_OBS_MEASURE');
    }
  });

  it.each(Object.keys(BUDGETS))('enforces warning and stop thresholds for the %s budget', (key) => {
    const cap = BUDGETS[key];
    expect(
      budgetDecision({
        freeBytes: 20 * GiB,
        usage: { ...empty(), [key]: Math.ceil(cap * 0.8) - 1 },
      }).level,
    ).toBe(0);
    expect(
      budgetDecision({ freeBytes: 20 * GiB, usage: { ...empty(), [key]: Math.ceil(cap * 0.8) } }),
    ).toEqual({ level: 1, stop: false });
    expect(
      budgetDecision({ freeBytes: 20 * GiB, usage: { ...empty(), [key]: Math.ceil(cap * 0.9) } }),
    ).toEqual({ level: 2, stop: true });
  });

  it('stops before monitoring consumes the game host disk reserve', () => {
    expect(budgetDecision({ freeBytes: 12 * GiB - 1, usage: empty() })).toEqual({
      level: 2,
      stop: true,
    });
  });

  it('records numeric warning state without stopping services', async () => {
    const stop = vi.fn(),
      record = vi.fn();
    const marker = await guardStack({
      measure: async () => ({
        freeBytes: 20 * GiB,
        usage: { ...empty(), loki: Math.ceil(BUDGETS.loki * 0.8) },
      }),
      stop,
      record,
    });
    expect(stop).not.toHaveBeenCalled();
    expect(record).toHaveBeenCalledWith(marker);
    expect(marker.level).toBe(1);
    expect(Object.values(marker).every((value) => typeof value === 'number')).toBe(true);
  });

  it('stops once on measurement failure, records unknown state and returns a stable error', async () => {
    const stop = vi.fn(),
      record = vi.fn();
    await expect(
      guardStack({
        measure: async () => {
          throw new Error('secret-containing stderr');
        },
        stop,
        record,
      }),
    ).rejects.toThrow(/^E_OBS_MEASURE$/);
    expect(stop).toHaveBeenCalledTimes(1);
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({ measurementError: 1, stopped: 1, level: 2 }),
    );
    expect(record.mock.calls[0][0]).not.toHaveProperty('freeBytes');
  });

  it('reports a failed emergency stop without marking a successful stop', async () => {
    const record = vi.fn();
    await expect(
      guardStack({
        measure: async () => ({ freeBytes: 0, usage: empty() }),
        stop: async () => {
          throw new Error('details');
        },
        record,
      }),
    ).rejects.toThrow(/^E_OBS_STOP$/);
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({ measurementError: 0, stopped: 0, stopError: 1 }),
    );
  });
});

describe('OBS-0.2 fixed service plans', () => {
  it('starts only the monitoring services without starting dependencies', () => {
    const plan = composePlan('up', options);
    expect(plan.binary).toBe('docker');
    expect(plan.args).toEqual(
      expect.arrayContaining([
        '--project-name',
        'deploy',
        '--env-file',
        options.envFile,
        '--profile',
        'observability',
        '--no-deps',
        '--wait',
        '-d',
      ]),
    );
    expect(plan.args.slice(-4)).toEqual(SERVICES);
    expect(plan.args).not.toContain('server');
    expect(plan.args).not.toContain('postgres');
    expect(plan.env).toEqual({ OBS_STATE_DIR: options.stateDir, OBS_GRAFANA_ADMIN_USER: 'alice' });
  });

  it.each(['restart', 'stop', 'status'])(
    '%s never expands to project teardown or Game',
    (action) => {
      const plan = composePlan(action, options);
      expect(plan.args.slice(-4)).toEqual(SERVICES);
      for (const forbidden of [
        'down',
        '--volumes',
        '-v',
        '--remove-orphans',
        'server',
        'postgres',
        'caddy',
      ])
        expect(plan.args).not.toContain(forbidden);
    },
  );

  it('rejects unrecognized actions and relative file paths', () => {
    expect(() => composePlan('down', options)).toThrow('E_OBS_CONFIG');
    expect(() => composePlan('up', { ...options, stateDir: './state' })).toThrow('E_OBS_CONFIG');
    expect(() => composePlan('stop', { ...options, envFile: './server.env' })).toThrow(
      'E_OBS_CONFIG',
    );
  });

  it('can construct an emergency stop without the bootstrap account', () => {
    expect(
      composePlan('stop', { ...options, adminUser: undefined }).env.OBS_GRAFANA_ADMIN_USER,
    ).toBe('operator-unavailable');
  });
});

describe('OBS-0.2 CLI boundary', () => {
  it('requires a named bootstrap administrator only for init', () => {
    expect(
      parseArgs([
        'init',
        '--admin-user',
        'alice',
        '--state-dir',
        options.stateDir,
        '--env-file',
        options.envFile,
      ]),
    ).toEqual({ action: 'init', ...options });
    for (const name of ['', 'admin', 'ADMIN', ' alice', 'alice\nsecret', 'a\u200bb'])
      expect(() => parseArgs(['init', '--admin-user', name])).toThrow('E_OBS_CONFIG');
    expect(() => parseArgs(['up', '--admin-user', 'alice'])).toThrow('E_OBS_CONFIG');
  });

  it('rejects options that could select additional services or destructive actions', () => {
    for (const args of [
      ['down'],
      ['stop', '--services', 'server'],
      ['guard', '--state-dir'],
      ['up', '--state-dir', '/tmp/x', '--state-dir', '/tmp/y'],
      ['up', '--state-dir', '/'],
      ['init'],
    ])
      expect(() => parseArgs(args)).toThrow('E_OBS_CONFIG');
  });
});

describe('OBS-0.2 root controller with real private files', () => {
  let directory, stateDir, envFile, runner;
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'obs-stack-test-'));
    stateDir = join(directory, 'state');
    envFile = join(directory, 'server.env');
    await writeFile(envFile, 'POSTGRES_PASSWORD=fixture-only\n', { mode: 0o600 });
    vi.spyOn(process, 'geteuid').mockReturnValue(0);
    runner = vi.fn(async (binary, args) => {
      if (binary === 'systemctl') return '';
      if (binary === 'du') return `0\t${args.at(-1)}`;
      if (args[0] === 'context') return 'unix:///var/run/docker.sock';
      if (args[0] === 'info') return '["name=seccomp"]';
      if (args[0] === 'version') return '28.0.0';
      if (args[0] === 'create') return 'a'.repeat(64);
      if (args[0] === 'cp') {
        await writeFile(args.at(-1), Buffer.alloc(2048, 1), { mode: 0o644 });
        return '';
      }
      return '';
    });
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    ownership.clear();
    await rm(directory, { recursive: true, force: true });
  });
  const args = (action, stateDir, envFile) => [
    action,
    '--state-dir',
    stateDir,
    '--env-file',
    envFile,
    ...(action === 'init' ? ['--admin-user', 'alice'] : []),
  ];

  it('initializes private non-root mounts and never changes an existing password on repeat init', async () => {
    await expect(runStack(args('init', stateDir, envFile), runner)).resolves.toEqual({
      initialized: 1,
    });
    const secret = join(stateDir, 'secrets/grafana_admin_password');
    const password = await readFile(secret, 'utf8');
    expect(password).toMatch(/^[a-f0-9]{64}\n$/);
    expect((await lstat(secret)).mode & 0o777).toBe(0o400);
    expect((await lstat(secret)).uid).toBe(472);
    expect((await lstat(join(stateDir, 'probe/busybox'))).mode & 0o777).toBe(0o555);
    await runStack(args('init', stateDir, envFile), runner);
    expect(await readFile(secret, 'utf8')).toBe(password);
    expect(runner.mock.calls.filter(([, command]) => command[0] === 'create')).toHaveLength(1);
    expect(runner.mock.calls.filter(([, command]) => command[0] === 'rm')).toHaveLength(1);
  });

  it('rejects a symlink in the state path without writing through it', async () => {
    await symlink(directory, stateDir);
    await expect(runStack(args('init', stateDir, envFile), runner)).rejects.toThrow('E_OBS_STATE');
    expect(runner.mock.calls.some(([, command]) => command[0] === 'create')).toBe(false);
  });

  it('cleans up the extraction container when copying the helper fails', async () => {
    const normal = runner.getMockImplementation();
    runner.mockImplementation(async (binary, command) => {
      if (command[0] === 'cp') throw new Error('private stderr');
      return normal(binary, command);
    });
    await expect(runStack(args('init', stateDir, envFile), runner)).rejects.toThrow(
      /^E_OBS_STACK$/,
    );
    expect(runner).toHaveBeenCalledWith('docker', ['rm', 'a'.repeat(64)]);
  });

  it('refuses to start until the continuous disk guard is active', async () => {
    await runStack(args('init', stateDir, envFile), runner);
    const normal = runner.getMockImplementation();
    runner.mockImplementation(async (binary, command) => {
      if (binary === 'systemctl') throw new Error('inactive');
      return normal(binary, command);
    });
    await expect(runStack(args('up', stateDir, envFile), runner)).rejects.toThrow(
      /^E_OBS_GUARD_REQUIRED$/,
    );
    expect(
      runner.mock.calls.some(([, command]) => command[0] === 'compose' && command.includes('up')),
    ).toBe(false);
  });

  it('starts with an active guard and restarts without extracting or regenerating credentials', async () => {
    await runStack(args('init', stateDir, envFile), runner);
    const password = await readFile(join(stateDir, 'secrets/grafana_admin_password'), 'utf8');
    await expect(runStack(args('up', stateDir, envFile), runner)).resolves.toEqual({ started: 1 });
    await expect(runStack(args('restart', stateDir, envFile), runner)).resolves.toEqual({
      started: 1,
    });
    expect(await readFile(join(stateDir, 'secrets/grafana_admin_password'), 'utf8')).toBe(password);
    expect(runner.mock.calls.filter(([, command]) => command[0] === 'create')).toHaveLength(1);
    const commands = runner.mock.calls.filter(([, command]) => command[0] === 'compose');
    expect(commands.filter(([, command]) => command.includes('config'))).toHaveLength(2);
    expect(
      commands.every(
        ([, command]) =>
          command.includes('config') ||
          command.slice(-4).every((service) => SERVICES.includes(service)),
      ),
    ).toBe(true);
  });

  it('rejects a modified probe before starting services', async () => {
    await runStack(args('init', stateDir, envFile), runner);
    const probe = join(stateDir, 'probe/busybox');
    // The test worker owns the fixture; root would be required on the actual host.
    const { chmod } = await import('node:fs/promises');
    await chmod(probe, 0o755);
    await writeFile(probe, Buffer.alloc(2048, 2));
    await chmod(probe, 0o555);
    await expect(runStack(args('up', stateDir, envFile), runner)).rejects.toThrow(/^E_OBS_STATE$/);
    expect(
      runner.mock.calls.some(([, command]) => command[0] === 'compose' && command.includes('up')),
    ).toBe(false);
  });

  it('rejects non-root callers before invoking Docker', async () => {
    vi.mocked(process.geteuid).mockReturnValue(1000);
    await expect(runStack(args('stop', stateDir, envFile), runner)).rejects.toThrow(/^E_OBS_ROOT$/);
    expect(runner).not.toHaveBeenCalled();
  });

  it('rejects remote contexts rather than applying local bind paths on another machine', async () => {
    const normal = runner.getMockImplementation();
    runner.mockImplementation(async (binary, command) =>
      command[0] === 'context' ? 'ssh://remote.example' : normal(binary, command),
    );
    await expect(runStack(args('init', stateDir, envFile), runner)).rejects.toThrow(
      /^E_OBS_DOCKER_LOCAL$/,
    );
    expect(runner.mock.calls.some(([, command]) => command[0] === 'create')).toBe(false);
  });

  it.each(['27.5.1', 'unidentifiable-engine'])(
    'refuses startup on engine %s while retaining emergency stop',
    async (version) => {
      const normal = runner.getMockImplementation();
      runner.mockImplementation(async (binary, command) =>
        command[0] === 'version' ? version : normal(binary, command),
      );
      for (const action of ['init', 'up', 'restart'])
        await expect(runStack(args(action, stateDir, envFile), runner)).rejects.toThrow(
          /^E_OBS_DOCKER_VERSION$/,
        );
      expect(
        runner.mock.calls.some(([, command]) => ['create', 'compose'].includes(command[0])),
      ).toBe(false);
      runner.mockClear();
      await expect(runStack(args('stop', stateDir, envFile), runner)).resolves.toEqual({
        stopped: 1,
      });
      expect(runner.mock.calls.some(([, command]) => command[0] === 'version')).toBe(false);
      const stop = runner.mock.calls.find(
        ([, command]) => command[0] === 'compose' && command.includes('stop'),
      );
      expect(stop[1].slice(-4)).toEqual(SERVICES);
    },
  );

  it('attempts a monitoring-only emergency stop when secret ownership is invalid', async () => {
    await runStack(args('init', stateDir, envFile), runner);
    ownership.set(join(stateDir, 'secrets/grafana_admin_password'), 0);
    await expect(runStack(args('guard', stateDir, envFile), runner)).rejects.toThrow(
      /^E_OBS_MEASURE$/,
    );
    const stop = runner.mock.calls.find(
      ([, command]) => command[0] === 'compose' && command.includes('stop'),
    );
    expect(stop[1].slice(-4)).toEqual(SERVICES);
    const marker = JSON.parse(await readFile(join(stateDir, 'guard-status.json'), 'utf8'));
    expect(marker).toMatchObject({ stopped: 1, measurementError: 1 });
    expect(Object.values(marker).every((value) => typeof value === 'number')).toBe(true);
  });
});
