import { constants } from 'node:fs';
import { open, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { canonical } from './canonical';
import { bundleId, MAX_RULESET_BYTES, RULESET_ID, RulesetSigner } from './signing';
import { RulesetError, type RulesetArtifact, type RulesetDescriptor, type RulesetStore } from './types';

async function readRegular(path: string, limit: number, rootOwned: boolean): Promise<Buffer> {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const info = await file.stat();
    if (!info.isFile() || info.size < 1 || info.size > limit ||
        (rootOwned && (info.uid !== 0 || (info.mode & 0o022) !== 0)))
      throw new RulesetError('E_RULESET_INTEGRITY');
    return await file.readFile();
  } finally { await file.close(); }
}

/** Signed images supply the embedded default. The deployment agent archives copies
 *  in a root-owned directory mounted READ ONLY in the application container. */
export async function readImageRuleset(bundlePath: string, descriptorPath: string, signer: RulesetSigner): Promise<RulesetArtifact> {
  try {
    const bundle = await readRegular(bundlePath, MAX_RULESET_BYTES, false);
    const descriptor = JSON.parse((await readRegular(descriptorPath, 131_072, false)).toString('utf8')) as RulesetDescriptor;
    return signer.artifact(descriptor, bundle);
  } catch { throw new RulesetError('E_RULESET_INTEGRITY'); }
}

/** Database values select a digest, never executable bytes or a filesystem path.
 *  No HTTP endpoint or application store method can publish new capsule files. */
export class FileRulesetStore implements RulesetStore {
  constructor(private readonly root: string, private readonly signer: RulesetSigner,
    private readonly embedded: RulesetArtifact, private readonly requireRootOwnership = true) {}

  async hasAny(): Promise<boolean> {
    try { return (await readdir(this.root)).some((name) => /^[a-f0-9]{64}\.mjs$/.test(name)); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error; }
  }

  async get(id: string): Promise<RulesetArtifact | null> {
    if (!RULESET_ID.test(id)) throw new RulesetError('E_RULESET_INVALID');
    if (id === this.embedded.descriptor.id) return {
      descriptor: structuredClone(this.embedded.descriptor), bundle: Buffer.from(this.embedded.bundle), signature: this.embedded.signature,
    };
    try {
      const dir = await stat(this.root);
      if (!dir.isDirectory() || (this.requireRootOwnership && (dir.uid !== 0 || (dir.mode & 0o022) !== 0)))
        throw new RulesetError('E_RULESET_INTEGRITY');
      const bundle = await readRegular(join(this.root, `${id}.mjs`), MAX_RULESET_BYTES, this.requireRootOwnership);
      if (bundleId(bundle) !== id) throw new RulesetError('E_RULESET_INTEGRITY');
      const descriptor = JSON.parse((await readRegular(join(this.root, `${id}.json`), 131_072, this.requireRootOwnership)).toString('utf8')) as RulesetDescriptor;
      if (descriptor.id !== id) throw new RulesetError('E_RULESET_INTEGRITY');
      // Authentication of these artifacts comes from the protected deployment cache.
      // The same signer additionally authenticates persisted per-match configuration.
      return this.signer.artifact(descriptor, bundle);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw new RulesetError('E_RULESET_INTEGRITY');
    }
  }

  async put(record: RulesetArtifact): Promise<void> {
    const known = await this.get(record.descriptor.id);
    if (!known || canonical(known.descriptor) !== canonical(record.descriptor) || known.signature !== record.signature ||
        !Buffer.from(known.bundle).equals(Buffer.from(record.bundle))) throw new RulesetError('E_RULESET_PIN_CONFLICT');
    // Deliberately no writes: only the privileged, signature-verifying deploy agent installs files.
  }
}
