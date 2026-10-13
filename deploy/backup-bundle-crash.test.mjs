/** Real Linux flock/SIGKILL coverage; synthetic ciphertext keeps the test isolated. */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import { generateKeyPairSync } from 'node:crypto';
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cleanupBundles, createBundle, prepareBundle } from './backup-bundle.mjs';

const HELPER = new URL('./backup-bundle.mjs', import.meta.url).href;
const READY_ID = '6d4b2b38-7dfb-4ab8-9e6d-10531e55f9ec';
const CRASH_ID = '3d68685b-cf9c-4e53-a77a-95ac204811a7';
const NEXT_ID = 'a5d75c7d-d1d3-4f4c-9795-c2a9af83444e';
const ORPHAN = '.bundle-0a6169a2-8724-4dde-9d78-85df17fffd54.tmp';
const JOB = '.bundle-job-20261013T040000Z.aB1234';

describe('signed backup crash reclamation', () => {
  let root, outputDir, source, seal, prepare;
  let children;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'void-bundle-crash-'));
    outputDir = join(root, 'bundles');
    source = join(root, 'source.age');
    await writeFile(source, 'age-encryption.org/v1\nsynthetic ciphertext', { mode: 0o600 });
    const keys = generateKeyPairSync('ed25519');
    const privateKeyPath = join(root, 'sign.pem');
    const publicKeyPath = join(root, 'verify.pem');
    await writeFile(privateKeyPath, keys.privateKey.export({ type: 'pkcs8', format: 'pem' }), {
      mode: 0o600,
    });
    await writeFile(publicKeyPath, keys.publicKey.export({ type: 'spki', format: 'pem' }));
    seal = {
      archivePath: source,
      outputDir,
      privateKeyPath,
      domain: 'game',
      producer: 'job',
      backupId: READY_ID,
    };
    prepare = {
      outputDir: join(root, 'verified'),
      publicKeyPath,
      expectedDomain: 'game',
      expectedProducer: 'job',
    };
    children = [];
  });

  afterEach(async () => {
    for (const { child, exited } of children) {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
      await exited;
    }
    await rm(root, { recursive: true, force: true });
  });

  async function stoppedWriter() {
    // Stop the real writer immediately after its first header write. The hook lives
    // only in this separate test process; the production helper has no failpoints.
    const program = `
      import { open } from 'node:fs/promises';
      import { createBundle } from ${JSON.stringify(HELPER)};
      const options = JSON.parse(process.argv[1]);
      const probe = await open(options.archivePath, 'r');
      const prototype = Object.getPrototypeOf(probe);
      await probe.close();
      const original = prototype.write;
      let stopped = false;
      prototype.write = async function (...args) {
        const result = await original.apply(this, args);
        if (!stopped && args[0].length === 16384 && args[3] === 0) {
          stopped = true;
          process.send('staged');
          process.kill(process.pid, 'SIGSTOP');
        }
        return result;
      };
      await createBundle(options);
      process.disconnect();
    `;
    const child = spawn(
      process.execPath,
      ['--input-type=module', '-e', program, JSON.stringify({ ...seal, backupId: CRASH_ID })],
      {
        stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
      },
    );
    let stderr = '';
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    const exited = new Promise((resolveExit) => child.once('exit', resolveExit));
    children.push({ child, exited });
    await new Promise((resolveReady, reject) => {
      child.once('error', reject);
      child.once('message', (message) => {
        if (message === 'staged') resolveReady();
        else reject(new Error(`unexpected child message: ${message}`));
      });
      child.once('exit', () => reject(new Error(`writer exited before stop: ${stderr}`)));
    });
    return { child, exited };
  }

  it('does not reclaim a live writer, reclaims after SIGKILL, and next writer/restore succeeds', async () => {
    const ready = await createBundle(seal);
    const readyBytes = await readFile(ready.path);
    const lockBefore = await stat(join(outputDir, '.backup.lock'));
    const { child, exited } = await stoppedWriter();
    const temporary = (await readdir(outputDir)).find(
      (name) => name.startsWith('.bundle-') && name.endsWith('.tmp'),
    );
    expect(temporary).toBeTruthy();
    const outside = join(root, 'outside');
    await writeFile(outside, 'retained');
    await mkdir(join(outputDir, JOB), { mode: 0o700 });
    await writeFile(join(outputDir, JOB, 'partial.sql'), 'private incomplete dump');
    await symlink(outside, join(outputDir, JOB, 'external'));

    expect(await cleanupBundles({ outputDir })).toEqual({ skipped: true, removed: 0 });
    expect((await stat(join(outputDir, temporary))).size).toBe(16384);
    // A second writer remains available while the first holds its shared lease.
    const concurrent = await createBundle({ ...seal, backupId: NEXT_ID });
    expect(await cleanupBundles({ outputDir })).toEqual({ skipped: true, removed: 0 });
    expect(await readFile(ready.path)).toEqual(readyBytes);

    child.kill('SIGKILL');
    await exited;
    expect(await cleanupBundles({ outputDir })).toEqual({ skipped: false, removed: 2 });
    expect(await readFile(outside, 'utf8')).toBe('retained');
    expect(await readFile(ready.path)).toEqual(readyBytes);
    expect((await stat(join(outputDir, '.backup.lock'))).ino).toBe(lockBefore.ino);
    expect(await readdir(outputDir)).toEqual([
      '.backup.lock',
      ...[ready.path, concurrent.path].map((path) => path.split('/').at(-1)).sort(),
    ]);

    const restarted = await createBundle({ ...seal, backupId: CRASH_ID });
    await expect(
      prepareBundle({ ...prepare, bundlePath: restarted.path, expectedBackupId: CRASH_ID }),
    ).resolves.toMatchObject({ backupId: CRASH_ID });
    expect(await readFile(join(prepare.outputDir, 'archive.sql.gz.age'))).toEqual(
      await readFile(source),
    );
  }, 15_000);

  it('a subsequent writer reclaims abandoned reserved staging and retains unrelated entries', async () => {
    await mkdir(outputDir, { mode: 0o700 });
    await writeFile(join(outputDir, ORPHAN), 'abandoned ciphertext');
    await mkdir(join(outputDir, JOB), { mode: 0o700 });
    await writeFile(join(outputDir, JOB, 'partial.sql'), 'abandoned plaintext');
    const retained = [
      '.tmp-20261013T040000Z.aB1234',
      '.bundle-not-a-uuid.tmp',
      'void-retained.vdbak',
      'other',
    ];
    for (const name of retained) await writeFile(join(outputDir, name), 'retained');
    const unsafeJob = '.bundle-job-20261013T050000Z.aB1234';
    await mkdir(join(outputDir, unsafeJob), { mode: 0o700 });
    await chmod(join(outputDir, unsafeJob), 0o755);
    const linkedJob = '.bundle-job-20261013T060000Z.aB1234';
    await symlink(root, join(outputDir, linkedJob));
    const linkedBundle = '.bundle-3d68685b-cf9c-4e53-a77a-95ac204811a7.tmp';
    await symlink(source, join(outputDir, linkedBundle));

    const result = await createBundle(seal);
    expect(await readdir(outputDir)).toEqual(
      [
        '.backup.lock',
        ...retained,
        unsafeJob,
        linkedJob,
        linkedBundle,
        result.path.split('/').at(-1),
      ].sort(),
    );
    expect(await cleanupBundles({ outputDir })).toEqual({ skipped: false, removed: 0 });
  });

  it.each(['symlink', 'public permissions', 'directory'])(
    'fails closed for an unsafe lock: %s',
    async (kind) => {
      await mkdir(outputDir, { mode: 0o700 });
      const lock = join(outputDir, '.backup.lock');
      if (kind === 'symlink') await symlink(source, lock);
      else if (kind === 'directory') await mkdir(lock, { mode: 0o700 });
      else {
        await writeFile(lock, '', { mode: 0o600 });
        await chmod(lock, 0o644);
      }
      await writeFile(join(outputDir, ORPHAN), 'retained on lock error');
      await expect(cleanupBundles({ outputDir })).rejects.toThrow('E_BACKUP_LOCK');
      await expect(createBundle(seal)).rejects.toThrow('E_BACKUP_LOCK');
      expect(await readFile(join(outputDir, ORPHAN), 'utf8')).toBe('retained on lock error');
    },
  );
});
