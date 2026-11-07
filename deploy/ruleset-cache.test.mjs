import { afterEach, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { lstatSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { installRuleset } from './ruleset-cache.mjs';
const dirs = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { force: true, recursive: true }); });
it('archives only verified bytes in a root-owned immutable cache and never replaces an existing identity', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ruleset-deploy-')); dirs.push(dir);
  const bytes = Buffer.from('export const fixture = true;');
  const id = createHash('sha256').update(bytes).digest('hex');
  const descriptor = { format: 1, id, source: 'a'.repeat(40) };
  const root = join(dir, 'rulesets');
  expect(() => installRuleset(root, Buffer.from('changed'), descriptor)).toThrow('E_RULESET_INTEGRITY');
  if (process.getuid() !== 0) {
    expect(() => installRuleset(root, bytes, descriptor)).toThrow('E_RULESET_CACHE_PERMISSIONS');
    return;
  }
  const previous = process.umask(0o077);
  try { installRuleset(root, bytes, descriptor); }
  finally { process.umask(previous); }
  expect(lstatSync(root).mode & 0o777).toBe(0o755);
  installRuleset(root, bytes, descriptor);
  expect(readFileSync(join(root, `${id}.mjs`))).toEqual(bytes);
  expect(lstatSync(join(root, `${id}.mjs`)).mode & 0o777).toBe(0o444);
  expect(() => installRuleset(root, bytes, { ...descriptor, source: 'b'.repeat(40) })).toThrow('E_RULESET_PIN_CONFLICT');
  rmSync(join(root, `${id}.mjs`));
  writeFileSync(join(dir, 'target'), bytes);
  symlinkSync(join(dir, 'target'), join(root, `${id}.mjs`));
  expect(() => installRuleset(root, bytes, descriptor)).toThrow('E_RULESET_PIN_CONFLICT');
});
