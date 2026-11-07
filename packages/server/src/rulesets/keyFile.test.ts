import { mkdtemp, chmod, readFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadRulesetKey } from './keyFile';

describe('ruleset signing key lifecycle', () => {
  it('survives restart and concurrent first boots without publishing a partial key', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ruleset-key-'));
    try {
      const file = join(dir, 'keys', 'key');
      const keys = await Promise.all(Array.from({ length: 12 }, () => loadRulesetKey(file, true)));
      expect(keys.every((key) => key.length === 32 && key.equals(keys[0]!))).toBe(true);
      expect(await loadRulesetKey(file, false)).toEqual(keys[0]);
      expect(await readFile(file)).toEqual(keys[0]);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
  it('refuses to replace a missing key once artifacts exist, and rejects readable/symlinked keys', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ruleset-key-'));
    try {
      const file = join(dir, 'key');
      await expect(loadRulesetKey(file, false)).rejects.toMatchObject({ code: 'E_RULESET_KEY' });
      await loadRulesetKey(file, true);
      await chmod(file, 0o644);
      await expect(loadRulesetKey(file, false)).rejects.toMatchObject({ code: 'E_RULESET_KEY' });
      await chmod(file, 0o600);
      await symlink(file, join(dir, 'link'));
      await expect(loadRulesetKey(join(dir, 'link'), false)).rejects.toMatchObject({ code: 'E_RULESET_KEY' });
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
});
