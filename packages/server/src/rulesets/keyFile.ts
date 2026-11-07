import { constants } from 'node:fs';
import { link, mkdir, open, unlink } from 'node:fs/promises';
import { randomBytes, randomUUID } from 'node:crypto';
import { dirname } from 'node:path';
import { RulesetError } from './types';

async function readKey(path: string): Promise<Buffer> {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.size !== 32 || (stat.mode & 0o077) !== 0) throw new RulesetError('E_RULESET_KEY');
    const bytes = await file.readFile();
    const directory = await open(dirname(path), constants.O_RDONLY);
    try { await directory.sync(); } finally { await directory.close(); }
    return bytes;
  } finally { await file.close(); }
}

/** Atomic first boot; never replace a missing key while signed artifacts exist. */
export async function loadRulesetKey(path: string, allowCreate: boolean): Promise<Buffer> {
  try { return await readKey(path); } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT' || !allowCreate) throw new RulesetError('E_RULESET_KEY');
  }
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${randomUUID()}.tmp`;
  const file = await open(temporary, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600);
  try { await file.writeFile(randomBytes(32)); await file.sync(); } finally { await file.close(); }
  try {
    try { await link(temporary, path); } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
    return await readKey(path);
  } catch { throw new RulesetError('E_RULESET_KEY'); }
  finally { await unlink(temporary).catch(() => {}); }
}
