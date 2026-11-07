#!/usr/bin/env node
/** Optional workstation setup, never run by install/build/CI. Pins are reviewed in Git. */
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const pins = JSON.parse(
  readFileSync(new URL('./agent-tools.lock.json', import.meta.url), 'utf8'),
);

function objectAt(path) {
  if (!existsSync(path)) return {};
  const value = JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF/, ''));
  if (!value || Array.isArray(value) || typeof value !== 'object')
    throw new Error(`Invalid settings: ${path}`);
  return value;
}

function backup(path) {
  if (existsSync(path))
    cpSync(path, `${path}.before-agent-tools-${randomUUID()}.bak`, { recursive: true });
}

/** Preserve unrelated preferences and the original file; reruns do not create backups. */
export function mergeSettings(path, patch) {
  const before = objectAt(path);
  if (
    Object.entries(patch).every(
      ([key, value]) => JSON.stringify(before[key]) === JSON.stringify(value),
    )
  )
    return;
  mkdirSync(dirname(path), { recursive: true });
  backup(path);
  const temporary = `${path}.${randomUUID()}.tmp`;
  writeFileSync(temporary, `${JSON.stringify({ ...before, ...patch }, null, 2)}\n`, {
    mode: 0o600,
  });
  renameSync(temporary, path);
}

function run(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} ${args[0]} failed: ${result.stderr}`);
  return result.stdout.trim();
}

function checkout(pin, target) {
  if (!existsSync(target)) {
    mkdirSync(dirname(target), { recursive: true });
    run('git', ['clone', '--no-checkout', pin.repository, target]);
    run('git', ['-C', target, 'checkout', '--detach', pin.revision]);
  }
  verifyCheckout(pin, target);
}

function verifyCheckout(pin, target) {
  if (
    run('git', ['-C', target, 'rev-parse', 'HEAD']) !== pin.revision ||
    run('git', ['-C', target, 'status', '--porcelain'])
  ) {
    throw new Error(`Checkout differs from the pin; retained for inspection: ${target}`);
  }
}

function verifyFiles(source, target) {
  for (const entry of readdirSync(source, { withFileTypes: true })) {
    if (entry.name === '__pycache__' || entry.name.endsWith('.pyc')) continue;
    const from = join(source, entry.name),
      to = join(target, entry.name);
    if (entry.isDirectory()) verifyFiles(from, to);
    else if (!existsSync(to) || !readFileSync(from).equals(readFileSync(to)))
      throw new Error(`Installed file differs from pin: ${to}`);
  }
}

function settingsMatch(path, settings) {
  const actual = objectAt(path);
  return Object.entries(settings).every(
    ([key, value]) => JSON.stringify(actual[key]) === JSON.stringify(value),
  );
}

export function setup(mode) {
  if (!['--plan', '--apply', '--check'].includes(mode))
    throw new Error('Usage: setup-agent-tools.mjs [--plan|--apply|--check]');
  if (mode === '--plan') {
    process.stdout.write(
      `${JSON.stringify(pins, null, 2)}\nUse --apply to install; --check to verify.\n`,
    );
    return;
  }
  if (process.platform !== 'linux' || Number(process.versions.node.split('.')[0]) < 22) {
    throw new Error('This setup is tested on Linux with Node >=22; see docs/agent-tools.md.');
  }
  run('codex', ['--version']);
  run('git', ['--version']);
  run('python3', ['-c', 'import sys; assert sys.version_info >= (3,10), "Python >=3.10 required"']);
  const userDir = homedir();
  const state = join(
    process.env.XDG_DATA_HOME || join(userDir, '.local/share'),
    'void-dominion-agent-tools',
  );
  const codexDir = process.env.CODEX_HOME || join(userDir, '.codex');
  const ponyConfig = join(
    process.env.XDG_CONFIG_HOME || join(userDir, '.config'),
    'ponytail/config.json',
  );
  const zaeDir = process.env.ZAEBAL_STATE_DIR || join(userDir, '.zaebal');
  const zaeSource = join(state, 'zaebal', pins.zaebal.revision);
  const zaeSkill = join(userDir, '.agents/skills/zaebal');
  const ponyMarket = join(state, 'ponytail-marketplace');
  const sl = pins['sl-ui-library'];
  const slCache = join(userDir, '.cache/sl-ui-library');

  if (mode === '--apply') {
    // Validate settings before any mutation; never reset an unreadable user config.
    for (const path of [
      ponyConfig,
      join(zaeDir, 'config.json'),
      join(codexDir, 'hooks.json'),
      join(slCache, 'settings.json'),
    ])
      objectAt(path);
    backup(join(codexDir, 'config.toml'));
    backup(join(codexDir, 'hooks.json'));
    // Pin the plugin itself: upstream Ponytail's marketplace points at moving main.
    mergeSettings(join(ponyMarket, '.agents/plugins/marketplace.json'), {
      name: 'ponytail',
      interface: { displayName: 'Ponytail' },
      plugins: [
        {
          name: 'ponytail',
          source: { source: 'url', url: pins.ponytail.repository, ref: pins.ponytail.revision },
          policy: { installation: 'AVAILABLE', authentication: 'ON_INSTALL' },
          category: 'Productivity',
        },
      ],
    });
    run('codex', ['plugin', 'marketplace', 'add', ponyMarket, '--json']);
    run('codex', ['plugin', 'add', 'ponytail@ponytail', '--json']);
    // SL's plugin is local to its marketplace checkout, so the marketplace SHA pins both.
    run('codex', ['plugin', 'marketplace', 'add', sl.repository, '--ref', sl.revision, '--json']);
    run('codex', ['plugin', 'add', 'sl-ui-library@sl-ui-library', '--json']);
    checkout(pins.zaebal, zaeSource);
    mergeSettings(ponyConfig, pins.ponytail.settings);
    mergeSettings(join(zaeDir, 'config.json'), pins.zaebal.settings);
    mergeSettings(join(slCache, 'settings.json'), { enabled: false });
    run('python3', [
      join(zaeSource, 'scripts/install_codex_hook.py'),
      '--platform',
      'linux',
      '--host',
      'codex',
      '--dest',
      zaeDir,
      '--config',
      join(codexDir, 'hooks.json'),
    ]);
    backup(zaeSkill);
    cpSync(join(zaeSource, 'skills/zaebal'), zaeSkill, { recursive: true });
  }

  const installed = JSON.parse(run('codex', ['plugin', 'list', '--json'])).installed;
  for (const name of ['ponytail', 'sl-ui-library']) {
    const plugin = installed.find((item) => item.pluginId === `${name}@${name}`);
    if (!plugin?.enabled || plugin.version !== pins[name].version)
      throw new Error(`${name}: not enabled at pinned version`);
    if (name === 'ponytail' && plugin.source.ref !== pins[name].revision)
      throw new Error('Ponytail source is not pinned');
    if (
      name === 'sl-ui-library' &&
      run('git', ['-C', plugin.source.path, 'rev-parse', 'HEAD']) !== pins[name].revision
    ) {
      throw new Error('SL UI Library source is not pinned');
    }
  }
  if (
    !settingsMatch(ponyConfig, pins.ponytail.settings) ||
    !settingsMatch(join(zaeDir, 'config.json'), pins.zaebal.settings) ||
    objectAt(join(slCache, 'settings.json')).enabled === true
  )
    throw new Error('Tool settings differ from the project profile');
  if (
    process.env.PONYTAIL_DEFAULT_MODE &&
    process.env.PONYTAIL_DEFAULT_MODE.trim().toLowerCase() !== 'full'
  ) {
    throw new Error('PONYTAIL_DEFAULT_MODE overrides the full profile; remove that override.');
  }
  verifyCheckout(pins.zaebal, zaeSource);
  if (!existsSync(join(zaeSkill, 'SKILL.md')) || !existsSync(join(zaeDir, 'core/zaebal.py')))
    throw new Error('Z.A.E.B.A.L skill/runtime missing');
  verifyFiles(join(zaeSource, 'core'), join(zaeDir, 'core'));
  verifyFiles(join(zaeSource, 'skills/zaebal'), zaeSkill);
  const hooks = objectAt(join(codexDir, 'hooks.json')).hooks?.UserPromptSubmit ?? [];
  if (
    !hooks.some((group) =>
      group.hooks?.some((hook) => hook.command?.includes(join(zaeDir, 'core/zaebal.py'))),
    )
  ) {
    throw new Error('Z.A.E.B.A.L prompt hook is not registered');
  }
  process.stdout.write(
    'Pinned tools and settings verified. In a fresh Codex session, check /hooks for enabled, trusted Ponytail/Z.A.E.B.A.L hooks. No hook trust or analytics consent was changed.\n',
  );
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    setup(process.argv[2] ?? '--plan');
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
