#!/usr/bin/env node
/** Signed imports follow verify-image.sh; local imports require an explicit operator path. Never executes capsule code. */
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { chmodSync, closeSync, existsSync, fchmodSync, fsyncSync, linkSync, lstatSync, mkdirSync, mkdtempSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { isMainModule } from './observability/main-module.mjs';

export function installRuleset(root, bundle, descriptor, { allowLocal = false } = {}) {
  if (!bundle.length || bundle.length > 16 * 1024 * 1024 || !/^[a-f0-9]{64}$/.test(descriptor.id) ||
      createHash('sha256').update(bundle).digest('hex') !== descriptor.id || descriptor.format !== 1 ||
      !(/^[a-f0-9]{40}$/.test(descriptor.source) || (allowLocal && descriptor.source === `local:${descriptor.id}`))) throw Error('E_RULESET_INTEGRITY');
  mkdirSync(root, { recursive: true, mode: 0o755 });
  const dir = lstatSync(root);
  if (!dir.isDirectory() || dir.uid !== 0 || (dir.mode & 0o022)) throw Error('E_RULESET_CACHE_PERMISSIONS');
  chmodSync(root, 0o755); // The deploy unit has UMask=0077; public code must remain readable in the non-root container.
  for (const [suffix, bytes] of [['mjs', bundle], ['json', Buffer.from(JSON.stringify(descriptor) + '\n')]]) {
    const path = join(root, `${descriptor.id}.${suffix}`);
    if (existsSync(path)) {
      const info = lstatSync(path);
      if (!info.isFile() || info.uid !== 0 || (info.mode & 0o022) || !readFileSync(path).equals(bytes)) throw Error('E_RULESET_PIN_CONFLICT');
      chmodSync(path, 0o444);
      continue;
    }
    const temp = `${path}.${randomUUID()}.tmp`;
    try {
      writeFileSync(temp, bytes, { mode: 0o444, flag: 'wx' });
      const fd = openSync(temp, 'r');
      try { fchmodSync(fd, 0o444); fsyncSync(fd); } finally { closeSync(fd); }
      try { linkSync(temp, path); }
      catch (error) {
        if (error.code !== 'EEXIST' || !readFileSync(path).equals(bytes)) throw Error('E_RULESET_PIN_CONFLICT', { cause: error });
      }
    }
    finally { rmSync(temp, { force: true }); }
  }
  const fd = openSync(root, 'r');
  try { fsyncSync(fd); } finally { closeSync(fd); }
}

export function archiveImageRuleset(image, stateDir) {
  if (!/^ghcr\.io\/[a-z0-9_./-]+@sha256:[a-f0-9]{64}$/.test(image)) throw Error('E_RULESET_IMAGE');
  return archiveRuleset(image, stateDir, false);
}

/** Explicit operator-only source-build path; immutable Docker ID, never a mutable tag. */
export function archiveLocalRuleset(image, stateDir) {
  if (!/^sha256:[a-f0-9]{64}$/.test(image)) throw Error('E_RULESET_IMAGE');
  return archiveRuleset(image, stateDir, true);
}

function archiveRuleset(image, stateDir, local) {
  if (!stateDir) throw Error('E_RULESET_IMAGE');
  const docker = (...args) => execFileSync('docker', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  // Old signed images remain valid rollback targets; they contain no rule capsules.
  const format = docker('image', 'inspect', '--format', '{{ index .Config.Labels "io.moongame.ruleset-format" }}', image);
  if (format !== '1') return;
  mkdirSync(stateDir, { recursive: true, mode: 0o700 });
  const temp = mkdtempSync(join(stateDir, '.ruleset-import-'));
  let container;
  try {
    container = docker('create', image);
    for (const suffix of ['mjs', 'json']) docker('cp', `${container}:/app/packages/server/dist/current-ruleset.${suffix}`, join(temp, `current.${suffix}`));
    const raw = readFileSync(join(temp, 'current.json'));
    if (raw.length > 131072) throw Error('E_RULESET_INTEGRITY');
    const descriptor = JSON.parse(raw.toString('utf8'));
    const source = docker('image', 'inspect', '--format', '{{ index .Config.Labels "org.opencontainers.image.revision" }}', image);
    if (source !== descriptor.source && !(local && descriptor.source === `local:${descriptor.id}`)) throw Error('E_RULESET_SOURCE');
    installRuleset(join(stateDir, 'rulesets'), readFileSync(join(temp, 'current.mjs')), descriptor, { allowLocal: local });
  } finally {
    if (container) docker('rm', container);
    rmSync(temp, { recursive: true, force: true });
  }
}
if (isMainModule(import.meta.url)) {
  try {
    if (process.argv[2] === '--local') archiveLocalRuleset(process.argv[3], process.argv[4]);
    else archiveImageRuleset(process.argv[2], process.argv[3]);
  }
  catch { process.stderr.write('E_RULESET_CACHE\n'); process.exitCode = 1; }
}
