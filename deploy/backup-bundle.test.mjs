import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash, generateKeyPairSync, randomBytes, sign } from 'node:crypto';
import { execFile } from 'node:child_process';
import {
  chmod,
  mkdir,
  mkdtemp,
  open,
  readFile,
  readdir,
  rm,
  stat,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { createBundle, prepareBundle, validateSealConfig } from './backup-bundle.mjs';

const run = promisify(execFile);
const CLI = fileURLToPath(new URL('./backup-bundle.mjs', import.meta.url));
const HEADER_BYTES = 16384;
const MANIFEST_OFFSET = 76;
const SIGN_CONTEXT = Buffer.from('Void Dominion backup bundle v1\0', 'utf8');
const ID = '62a54d8e-9715-478f-a568-181243157936';
const OTHER_ID = 'dc84d15e-73e9-4cf9-8e1f-d0b9e083bc0e';
const keys = generateKeyPairSync('ed25519');
const pem = keys.privateKey.export({ type: 'pkcs8', format: 'pem' });

describe('signed backup bundles (SE-3.5 foundation)', () => {
  let dir;
  let archive;
  let seal;
  let prepare;
  let ciphertext;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'void-bundle-'));
    archive = join(dir, 'source.age');
    ciphertext = Buffer.concat([Buffer.from('age-encryption.org/v1\n'), randomBytes(180_000)]);
    await writeFile(archive, ciphertext, { mode: 0o600 });
    await writeFile(join(dir, 'private.pem'), pem, { mode: 0o600 });
    await writeFile(
      join(dir, 'public.pem'),
      keys.publicKey.export({ type: 'spki', format: 'pem' }),
    );
    seal = {
      archivePath: archive,
      outputDir: join(dir, 'staging'),
      privateKeyPath: join(dir, 'private.pem'),
      domain: 'game-auth',
      producer: 'backup-job-1',
      backupId: ID,
    };
    prepare = {
      outputDir: join(dir, 'verified'),
      publicKeyPath: join(dir, 'public.pem'),
      expectedDomain: seal.domain,
      expectedProducer: seal.producer,
      expectedBackupId: ID,
    };
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(dir, { recursive: true, force: true });
  });

  async function bundle() {
    const result = await createBundle(seal);
    return result.path;
  }

  async function outputFiles() {
    return (await readdir(seal.outputDir)).filter((name) => name !== '.backup.lock');
  }

  async function altered(change) {
    const bytes = await readFile(await bundle());
    const result = change(bytes) ?? bytes;
    const path = join(dir, 'altered.vdbak');
    await writeFile(path, result, { mode: 0o600 });
    return path;
  }

  // Re-sign malformed manifests: parser tests must not merely fail at signature verification.
  function rewriteManifest(bytes, change) {
    const length = bytes.readUInt32BE(8);
    const manifest = JSON.parse(bytes.subarray(MANIFEST_OFFSET, MANIFEST_OFFSET + length));
    change(manifest);
    const encoded = Buffer.from(JSON.stringify(manifest));
    bytes.fill(0, MANIFEST_OFFSET, HEADER_BYTES);
    bytes.writeUInt32BE(encoded.length, 8);
    encoded.copy(bytes, MANIFEST_OFFSET);
    sign(null, Buffer.concat([SIGN_CONTEXT, encoded]), keys.privateKey).copy(bytes, 12);
  }

  it('round-trips copied ciphertext with a real signature and private filesystem modes', async () => {
    const result = await createBundle(seal);
    expect(result).toEqual({ backupId: ID, path: join(seal.outputDir, `void-${ID}.vdbak`) });
    const manifest = await prepareBundle({ ...prepare, bundlePath: result.path });
    expect(manifest).toMatchObject({
      version: 1,
      type: 'void.postgres.backup',
      backupId: ID,
      domain: seal.domain,
      producer: seal.producer,
      ciphertext: {
        format: 'postgres.sql.gz.age',
        bytes: ciphertext.length,
        sha256: createHash('sha256').update(ciphertext).digest('hex'),
      },
    });
    expect(new Date(manifest.createdAt).toISOString()).toBe(manifest.createdAt);
    expect(await readFile(join(prepare.outputDir, 'archive.sql.gz.age'))).toEqual(ciphertext);
    expect((await stat(result.path)).mode & 0o777).toBe(0o600);
    expect((await stat(seal.outputDir)).mode & 0o777).toBe(0o700);
    expect((await stat(prepare.outputDir)).mode & 0o777).toBe(0o700);
    expect((await stat(join(prepare.outputDir, 'archive.sql.gz.age'))).mode & 0o777).toBe(0o600);
    expect(await outputFiles()).toEqual([`void-${ID}.vdbak`]);
    expect((await stat(join(seal.outputDir, '.backup.lock'))).mode & 0o777).toBe(0o600);
    expect((await readFile(result.path)).includes(pem)).toBe(false);
  });

  it('allocates distinct UUIDs for concurrent jobs and never replaces an existing ID', async () => {
    const generated = await Promise.all(
      Array.from({ length: 3 }, () => createBundle({ ...seal, backupId: undefined })),
    );
    expect(new Set(generated.map((x) => x.backupId)).size).toBe(3);
    const results = await Promise.allSettled([createBundle(seal), createBundle(seal)]);
    expect(results.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
    expect(results.find((x) => x.status === 'rejected').reason.message).toBe('E_BACKUP_EXISTS');
    const oldBytes = await readFile(join(seal.outputDir, `void-${ID}.vdbak`));
    await writeFile(archive, Buffer.from('age-encryption.org/v1\nreplacement'));
    await expect(createBundle(seal)).rejects.toThrow('E_BACKUP_EXISTS');
    expect(await readFile(join(seal.outputDir, `void-${ID}.vdbak`))).toEqual(oldBytes);
    expect((await outputFiles()).filter((x) => x.startsWith('.'))).toEqual([]);
  });

  it.each(['expectedDomain', 'expectedProducer', 'expectedBackupId'])(
    'requires matching external %s',
    async (field) => {
      const bundlePath = await bundle();
      await expect(
        prepareBundle({
          ...prepare,
          bundlePath,
          [field]: field === 'expectedBackupId' ? OTHER_ID : 'another',
        }),
      ).rejects.toThrow('E_BACKUP_IDENTITY');
      await expect(prepareBundle({ ...prepare, bundlePath, [field]: undefined })).rejects.toThrow(
        'E_BACKUP_CONFIG',
      );
    },
  );

  it('trusts only the configured public signing key', async () => {
    const bundlePath = await bundle();
    const other = generateKeyPairSync('ed25519');
    await writeFile(prepare.publicKeyPath, other.publicKey.export({ type: 'spki', format: 'pem' }));
    await expect(prepareBundle({ ...prepare, bundlePath })).rejects.toThrow('E_BACKUP_SIGNATURE');
  });

  it.each([
    [
      'magic',
      (b) => {
        b[0] ^= 1;
      },
    ],
    [
      'oversized manifest',
      (b) => {
        b.writeUInt32BE(0xffffffff, 8);
      },
    ],
    [
      'empty manifest',
      (b) => {
        b.writeUInt32BE(0, 8);
      },
    ],
    [
      'signature',
      (b) => {
        b[12] ^= 1;
      },
    ],
    [
      'manifest',
      (b) => {
        b[MANIFEST_OFFSET + 5] ^= 1;
      },
    ],
    [
      'padding',
      (b) => {
        b[HEADER_BYTES - 1] = 1;
      },
    ],
    [
      'ciphertext',
      (b) => {
        b[HEADER_BYTES + 100] ^= 1;
      },
    ],
    ['short header', (b) => b.subarray(0, 40)],
    ['short payload', (b) => b.subarray(0, b.length - 1)],
    ['trailing bytes', (b) => Buffer.concat([b, Buffer.from('extra')])],
  ])('rejects %s corruption without leaving prepared data', async (_name, mutate) => {
    const bundlePath = await altered(mutate);
    await expect(prepareBundle({ ...prepare, bundlePath })).rejects.toThrow(/^E_BACKUP_/);
    expect(await readdir(prepare.outputDir).catch(() => [])).toEqual([]);
  });

  it.each([
    [
      'unknown field',
      (m) => {
        m.extra = true;
      },
    ],
    [
      'unknown nested field',
      (m) => {
        m.ciphertext.filename = '../../escape';
      },
    ],
    [
      'version',
      (m) => {
        m.version = 2;
      },
    ],
    [
      'type',
      (m) => {
        m.type = 'another';
      },
    ],
    [
      'format',
      (m) => {
        m.ciphertext.format = 'postgres.sql';
      },
    ],
    [
      'negative size',
      (m) => {
        m.ciphertext.bytes = -1;
      },
    ],
    [
      'fractional size',
      (m) => {
        m.ciphertext.bytes = 1.5;
      },
    ],
    [
      'oversized size',
      (m) => {
        m.ciphertext.bytes = Number.MAX_VALUE;
      },
    ],
    [
      'invalid time',
      (m) => {
        m.createdAt = 'yesterday';
      },
    ],
    [
      'invalid id',
      (m) => {
        m.backupId = '../../escape';
      },
    ],
    [
      'invalid slug',
      (m) => {
        m.domain = 'a/b';
      },
    ],
    [
      'invalid digest',
      (m) => {
        m.ciphertext.sha256 = 'bad';
      },
    ],
  ])('rejects a correctly signed malformed manifest: %s', async (_name, mutate) => {
    const bundlePath = await altered((bytes) => rewriteManifest(bytes, mutate));
    await expect(prepareBundle({ ...prepare, bundlePath })).rejects.toThrow('E_BACKUP_FORMAT');
  });

  it('rejects a signed payload without the age header', async () => {
    const bundlePath = await altered((bytes) => {
      bytes[HEADER_BYTES] ^= 1;
      rewriteManifest(bytes, (m) => {
        m.ciphertext.sha256 = createHash('sha256')
          .update(bytes.subarray(HEADER_BYTES))
          .digest('hex');
      });
    });
    await expect(prepareBundle({ ...prepare, bundlePath })).rejects.toThrow('E_BACKUP_FORMAT');
    expect(await readdir(prepare.outputDir).catch(() => [])).toEqual([]);
  });

  it('does not replace an existing prepared archive', async () => {
    const bundlePath = await bundle();
    await mkdir(prepare.outputDir, { mode: 0o700 });
    const target = join(prepare.outputDir, 'archive.sql.gz.age');
    await writeFile(target, 'retained');
    await expect(prepareBundle({ ...prepare, bundlePath })).rejects.toThrow('E_BACKUP_EXISTS');
    expect(await readFile(target, 'utf8')).toBe('retained');
  });

  it.each(['archivePath', 'privateKeyPath', 'outputDir'])(
    'rejects a symlink at seal %s',
    async (field) => {
      if (field === 'outputDir') await mkdir(seal.outputDir, { mode: 0o700 });
      const link = join(dir, 'link');
      await symlink(seal[field], link);
      await expect(createBundle({ ...seal, [field]: link })).rejects.toThrow(/^E_BACKUP_/);
    },
  );

  it.each(['bundlePath', 'publicKeyPath', 'outputDir'])(
    'rejects a symlink at prepare %s',
    async (field) => {
      const bundlePath = await bundle();
      if (field === 'outputDir') await mkdir(prepare.outputDir, { mode: 0o700 });
      const options = { ...prepare, bundlePath };
      const link = join(dir, 'link');
      await symlink(options[field], link);
      await expect(prepareBundle({ ...options, [field]: link })).rejects.toThrow(/^E_BACKUP_/);
    },
  );

  it('does not follow existing output file symlinks or alter their targets', async () => {
    await mkdir(seal.outputDir, { mode: 0o700 });
    const sentinel = join(dir, 'sentinel');
    await writeFile(sentinel, 'retained');
    await symlink(sentinel, join(seal.outputDir, `void-${ID}.vdbak`));
    await expect(createBundle(seal)).rejects.toThrow('E_BACKUP_EXISTS');
    expect(await readFile(sentinel, 'utf8')).toBe('retained');
  });

  it('preserves a completely linked bundle when parent fsync leaves commit durability unknown', async () => {
    const handle = await open(archive, 'r');
    const prototype = Object.getPrototypeOf(handle);
    await handle.close();
    const sync = prototype.sync;
    const fault = vi.spyOn(prototype, 'sync').mockImplementation(async function () {
      if ((await this.stat()).isDirectory()) throw new Error('injected fsync failure');
      return sync.call(this);
    });
    await expect(createBundle(seal)).rejects.toThrow('E_BACKUP_COMMIT_UNKNOWN');
    fault.mockRestore();
    const bundlePath = join(seal.outputDir, `void-${ID}.vdbak`);
    expect(await outputFiles()).toEqual([`void-${ID}.vdbak`]);
    expect((await prepareBundle({ ...prepare, bundlePath })).backupId).toBe(ID);
    await expect(createBundle(seal)).rejects.toThrow('E_BACKUP_EXISTS');
  });

  it('rejects a signed payload digest mismatch and removes only its own partial file', async () => {
    const bundlePath = await altered((bytes) => {
      bytes[HEADER_BYTES + 500] ^= 1;
    });
    await mkdir(prepare.outputDir, { mode: 0o700 });
    await writeFile(join(prepare.outputDir, 'retained'), 'other job data');
    await expect(prepareBundle({ ...prepare, bundlePath })).rejects.toThrow('E_BACKUP_DIGEST');
    expect(await readdir(prepare.outputDir)).toEqual(['retained']);
  });

  it('rejects unsafe output-directory permissions', async () => {
    await mkdir(seal.outputDir, { mode: 0o700 });
    await chmod(seal.outputDir, 0o755);
    await expect(createBundle(seal)).rejects.toThrow('E_BACKUP_PATH');
  });

  it.each(['', 'plaintext SQL', 'age-encryption.org/v2\nbody'])(
    'rejects invalid ciphertext without publishing: %j',
    async (value) => {
      await writeFile(archive, value);
      await expect(createBundle(seal)).rejects.toThrow('E_BACKUP_FORMAT');
      expect(await outputFiles().catch(() => [])).toEqual([]);
    },
  );

  it('rejects bad signing configuration before accessing an archive or creating staging', async () => {
    await writeFile(seal.privateKeyPath, 'SECRET_INVALID_PEM');
    await expect(validateSealConfig(seal)).rejects.toThrow('E_BACKUP_KEY');
    await expect(createBundle(seal)).rejects.toThrow('E_BACKUP_KEY');
    expect(await readdir(seal.outputDir).catch(() => [])).toEqual([]);
  });

  it.each([0o644, 0o640, 0o604, 0o620, 0o602, 0o610, 0o601])(
    'rejects signing-key group/other permissions before reading PEM: %i',
    async (mode) => {
      await chmod(seal.privateKeyPath, mode);
      const keyInfo = await stat(seal.privateKeyPath);
      const probe = await open(archive, 'r');
      const prototype = Object.getPrototypeOf(probe);
      await probe.close();
      const read = prototype.read;
      let keyReads = 0;
      vi.spyOn(prototype, 'read').mockImplementation(async function (...args) {
        const info = await this.stat();
        if (info.dev === keyInfo.dev && info.ino === keyInfo.ino) keyReads += 1;
        return read.apply(this, args);
      });
      await expect(validateSealConfig(seal)).rejects.toThrow('E_BACKUP_KEY');
      await expect(createBundle(seal)).rejects.toThrow('E_BACKUP_KEY');
      expect(keyReads).toBe(0);
      expect(await readdir(seal.outputDir).catch(() => [])).toEqual([]);
    },
  );

  it.each([0o600, 0o400])('accepts an owner-only signing key: %i', async (mode) => {
    await chmod(seal.privateKeyPath, mode);
    await expect(validateSealConfig(seal)).resolves.toEqual({ ok: true });
    await expect(createBundle(seal)).resolves.toMatchObject({ backupId: ID });
  });

  it('permits a public verifier with mode 0644', async () => {
    const bundlePath = await bundle();
    await chmod(prepare.publicKeyPath, 0o644);
    await expect(prepareBundle({ ...prepare, bundlePath })).resolves.toMatchObject({
      backupId: ID,
    });
  });

  it('rejects oversized PEMs and keys for another signature algorithm', async () => {
    await writeFile(seal.privateKeyPath, Buffer.alloc(16385, 65));
    await expect(validateSealConfig(seal)).rejects.toThrow('E_BACKUP_KEY');
    const other = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    await writeFile(seal.privateKeyPath, other.privateKey.export({ type: 'pkcs8', format: 'pem' }));
    await expect(validateSealConfig(seal)).rejects.toThrow('E_BACKUP_KEY');
  });

  it('refuses the signing private PEM in the public verifier configuration', async () => {
    const bundlePath = await bundle();
    await writeFile(prepare.publicKeyPath, pem);
    await expect(prepareBundle({ ...prepare, bundlePath })).rejects.toThrow('E_BACKUP_KEY');
  });

  it.each(['../escape', '', 'UPPERCASE'])('rejects unsafe names: %j', async (domain) => {
    await expect(createBundle({ ...seal, domain })).rejects.toThrow('E_BACKUP_CONFIG');
  });

  it('CLI seal / prepare / check-seal report only their documented JSON', async () => {
    const env = {
      ...process.env,
      BACKUP_SIGNING_KEY: seal.privateKeyPath,
      BACKUP_DOMAIN: seal.domain,
      BACKUP_PRODUCER: seal.producer,
      BACKUP_VERIFY_KEY: prepare.publicKeyPath,
      BACKUP_EXPECT_DOMAIN: prepare.expectedDomain,
      BACKUP_EXPECT_PRODUCER: prepare.expectedProducer,
    };
    const preflight = await run(process.execPath, [CLI, 'check-seal'], { env });
    expect(JSON.parse(preflight.stdout)).toEqual({ ok: true });
    const created = await run(process.execPath, [CLI, 'seal', archive, seal.outputDir], { env });
    const result = JSON.parse(created.stdout);
    expect(result.backupId).toMatch(/^[0-9a-f-]{36}$/);
    const checked = await run(process.execPath, [CLI, 'prepare', result.path, prepare.outputDir], {
      env: { ...env, BACKUP_EXPECT_ID: result.backupId },
    });
    expect(JSON.parse(checked.stdout).backupId).toBe(result.backupId);
    expect(preflight.stderr + created.stderr + checked.stderr).toBe('');
  });

  it('CLI errors are stable and do not reveal secrets or filesystem paths', async () => {
    await writeFile(seal.privateKeyPath, 'SECRET_INVALID_PEM');
    await expect(
      run(process.execPath, [CLI, 'check-seal'], {
        env: {
          ...process.env,
          BACKUP_SIGNING_KEY: seal.privateKeyPath,
          BACKUP_DOMAIN: seal.domain,
          BACKUP_PRODUCER: seal.producer,
        },
      }),
    ).rejects.toMatchObject({ stdout: '', stderr: 'E_BACKUP_KEY\n' });
  });
});
