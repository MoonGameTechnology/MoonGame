import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { engine } from './fixtureEngine';
import { bundleId, RulesetSigner } from './signing';
import { RulesetRegistry } from './registry';
import { MemoryRulesetStore } from './memory';
import { FileRulesetStore, readImageRuleset } from './files';
const dirs: string[] = [];
afterEach(async () => { await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true }))); });
async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'ruleset-files-')); dirs.push(root);
  const signer = new RulesetSigner(Buffer.alloc(32, 9));
  const temporary = new MemoryRulesetStore(), registry = new RulesetRegistry(temporary, signer);
  const bytes = engine(1), current = engine(2);
  const old = await registry.registerTrusted(bytes, bundleId(bytes));
  const latest = await registry.registerTrusted(current, bundleId(current));
  const oldRecord = (await temporary.get(old.descriptor.id))!;
  const currentRecord = (await temporary.get(latest.descriptor.id))!;
  await writeFile(join(root, `${old.descriptor.id}.mjs`), oldRecord.bundle, { mode: 0o444 });
  await writeFile(join(root, `${old.descriptor.id}.json`), JSON.stringify(oldRecord.descriptor), { mode: 0o444 });
  const store = new FileRulesetStore(root, signer, currentRecord, false);
  return { root, signer, old, oldRecord, currentRecord, store };
}
describe('read-only trusted capsule files', () => {
  it('loads the archived engine alongside the embedded new default, without creating or overwriting files', async () => {
    const { signer, old, currentRecord, store } = await setup();
    const registry = new RulesetRegistry(store, signer);
    expect((await registry.get(old.descriptor.id)).descriptor).toEqual(old.descriptor);
    expect((await registry.get(currentRecord.descriptor.id)).descriptor).toEqual(currentRecord.descriptor);
    expect(await store.get('f'.repeat(64))).toBeNull();
    await expect(store.get('../other')).rejects.toThrow('E_RULESET_INVALID');
    await expect(store.put({ ...currentRecord, descriptor: { ...currentRecord.descriptor, source: 'b'.repeat(40) } }))
      .rejects.toThrow('E_RULESET_PIN_CONFLICT');
  });
  it('rejects modified bytes and symlinks before executing code', async () => {
    const { root, old, signer, oldRecord, store } = await setup();
    const path = join(root, `${old.descriptor.id}.mjs`);
    await rm(path);
    await writeFile(path, 'throw Error("must not execute")');
    const importer = vi.fn(async () => ({}));
    await expect(new RulesetRegistry(store, signer, importer).get(old.descriptor.id)).rejects.toThrow('E_RULESET_INTEGRITY');
    expect(importer).not.toHaveBeenCalled();
    await rm(path);
    await writeFile(join(root, 'target'), oldRecord.bundle);
    await symlink(join(root, 'target'), path);
    await expect(store.get(old.descriptor.id)).rejects.toThrow('E_RULESET_INTEGRITY');
    await expect(readImageRuleset(path, join(root, `${old.descriptor.id}.json`), signer)).rejects.toThrow('E_RULESET_INTEGRITY');
  });
});
