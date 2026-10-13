import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash, generateKeyPairSync } from 'node:crypto';
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
import { Readable } from 'node:stream';
import { createBundle } from '../backup-bundle.mjs';
import { downloadBundle, uploadBundle } from './s3.mjs';

const ID = '62a54d8e-9715-478f-a568-181243157936';
const keys = generateKeyPairSync('ed25519');
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const base64 = (hex) => Buffer.from(hex, 'hex').toString('base64');
async function bytes(body) {
  const chunks = [];
  for await (const chunk of body) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

describe('S3 backup transport: authenticated bundles and pinned versions', () => {
  let dir, options, path, original, receipt, client, requests, objects;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'void-backup-s3-'));
    const privateKeyPath = join(dir, 'sign.pem');
    const publicKeyPath = join(dir, 'verify.pem');
    await writeFile(privateKeyPath, keys.privateKey.export({ type: 'pkcs8', format: 'pem' }), {
      mode: 0o600,
    });
    await writeFile(publicKeyPath, keys.publicKey.export({ type: 'spki', format: 'pem' }));
    const archivePath = join(dir, 'test.age');
    await writeFile(archivePath, 'age-encryption.org/v1\n' + 'ciphertext'.repeat(10000));
    ({ path } = await createBundle({
      privateKeyPath,
      archivePath,
      outputDir: join(dir, 'bundles'),
      domain: 'game',
      producer: 'nightly',
      backupId: ID,
    }));
    original = await readFile(path);
    options = {
      endpoint: 'https://backup.example.test',
      region: 'us-east-1',
      bucket: 'void-backups',
      publicKeyPath,
      expectedDomain: 'game',
      expectedProducer: 'nightly',
      expectedBackupId: ID,
      workDir: join(dir, 'work'),
      timeoutMs: 1000,
    };
    receipt = {
      version: 1,
      type: 'void.backup.s3-receipt',
      endpoint: options.endpoint,
      region: options.region,
      bucket: options.bucket,
      key: `backups/v1/game/nightly/${ID}.vdbak`,
      domain: 'game',
      producer: 'nightly',
      backupId: ID,
      versionId: 'version-1',
      bytes: original.length,
      sha256: sha(original),
    };
    requests = [];
    objects = new Map([['version-1', original]]);
    client = {
      destroy: vi.fn(),
      send: vi.fn(async (command) => {
        const input = command.input;
        requests.push({ command: command.constructor.name, ...input });
        if (command.constructor.name === 'PutObjectCommand') {
          const uploaded = await bytes(input.Body);
          objects.set('version-1', uploaded);
          return { VersionId: 'version-1', ChecksumSHA256: base64(sha(uploaded)) };
        }
        const object = objects.get(input.VersionId);
        return {
          VersionId: input.VersionId,
          ContentLength: object.length,
          Body: Readable.from([object]),
        };
      }),
    };
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(dir, { recursive: true, force: true });
  });

  it('uploads only a verified private snapshot, with conditional create and a full-object checksum', async () => {
    expect(await uploadBundle({ ...options, bundlePath: path }, client)).toEqual(receipt);
    expect(requests[0]).toMatchObject({
      command: 'PutObjectCommand',
      Bucket: options.bucket,
      Key: receipt.key,
      IfNoneMatch: '*',
      ContentLength: original.length,
      ChecksumSHA256: base64(receipt.sha256),
    });
    expect(objects.get('version-1')).toEqual(original);
    expect(await readdir(options.workDir)).toEqual(['.backup.lock']);
    expect(await readFile(path)).toEqual(original);
  });

  it('does not reopen the mutable source for network upload', async () => {
    const send = client.send.getMockImplementation();
    client.send.mockImplementation(async (command) => {
      await writeFile(path, 'changed after verification');
      return send(command);
    });
    expect(await uploadBundle({ ...options, bundlePath: path }, client)).toEqual(receipt);
    expect(objects.get('version-1')).toEqual(original);
  });

  it.each([
    'http://backup.example.test',
    'https://user:pass@backup.example.test',
    'https://backup.example.test/path',
    'https://backup.example.test/?token=secret',
    'https://backup.example.test/#fragment',
  ])('rejects unsafe endpoint %s before network access', async (endpoint) => {
    await expect(uploadBundle({ ...options, endpoint, bundlePath: path }, client)).rejects.toThrow(
      'E_BACKUP_CONFIG',
    );
    expect(client.send).not.toHaveBeenCalled();
  });

  it('rejects tampered ciphertext before contacting S3', async () => {
    original[original.length - 1] ^= 1;
    await writeFile(path, original);
    await expect(uploadBundle({ ...options, bundlePath: path }, client)).rejects.toThrow(
      'E_BACKUP_DIGEST',
    );
    expect(client.send).not.toHaveBeenCalled();
    expect(await readdir(options.workDir)).toEqual(['.backup.lock']);
  });

  it('rejects another signed domain before contacting S3', async () => {
    await expect(
      uploadBundle({ ...options, expectedDomain: 'inventory', bundlePath: path }, client),
    ).rejects.toThrow('E_BACKUP_IDENTITY');
    expect(client.send).not.toHaveBeenCalled();
  });

  it('rejects symlink sources and public staging', async () => {
    const alias = join(dir, 'alias');
    await symlink(path, alias);
    await expect(uploadBundle({ ...options, bundlePath: alias }, client)).rejects.toThrow(
      'E_BACKUP_PATH',
    );
    await mkdir(options.workDir, { recursive: true });
    await chmod(options.workDir, 0o755);
    await expect(uploadBundle({ ...options, bundlePath: path }, client)).rejects.toThrow(
      'E_BACKUP_PATH',
    );
    expect(client.send).not.toHaveBeenCalled();
  });

  it.each([{}, { VersionId: 'null' }, { VersionId: 'version-1', ChecksumSHA256: 'wrong' }])(
    'never treats an unversioned or unconfirmed PUT as success: %j',
    async (response) => {
      client.send.mockResolvedValue(response);
      await expect(uploadBundle({ ...options, bundlePath: path }, client)).rejects.toThrow(
        'E_BACKUP_REMOTE_UNKNOWN',
      );
      expect(client.send).toHaveBeenCalledTimes(1);
      expect(await readFile(path)).toEqual(original);
    },
  );

  it('preserves an unknown PUT outcome and does not retry or change the ID', async () => {
    client.send.mockImplementation(async (command) => {
      objects.set('remote-committed', await bytes(command.input.Body));
      throw new Error('connection lost with secret request details');
    });
    await expect(uploadBundle({ ...options, bundlePath: path }, client)).rejects.toThrow(
      /^E_BACKUP_REMOTE_UNKNOWN$/,
    );
    expect(client.send).toHaveBeenCalledTimes(1);
    expect(objects.get('remote-committed')).toEqual(original);
    expect(await readFile(path)).toEqual(original);
  });

  it('reports conditional conflict without overwriting or claiming the old object is valid', async () => {
    client.send.mockRejectedValue({ $metadata: { httpStatusCode: 412 } });
    await expect(uploadBundle({ ...options, bundlePath: path }, client)).rejects.toThrow(
      'E_BACKUP_REMOTE_EXISTS',
    );
    expect(client.send).toHaveBeenCalledTimes(1);
  });

  it('downloads the receipt version, validates its bytes/signature, and publishes privately', async () => {
    objects.set('latest', Buffer.from('not the chosen version'));
    const result = await downloadBundle(
      { ...options, receipt, outputDir: join(dir, 'restored') },
      client,
    );
    expect(requests[0]).toMatchObject({
      command: 'GetObjectCommand',
      Bucket: options.bucket,
      Key: receipt.key,
      VersionId: 'version-1',
      ChecksumMode: 'ENABLED',
    });
    expect(await readFile(result.path)).toEqual(original);
    expect((await stat(result.path)).mode & 0o777).toBe(0o600);
    expect(await readdir(options.workDir)).toEqual(['.backup.lock']);
  });

  it.each([
    { key: '../other' },
    { bucket: 'other-bucket' },
    { endpoint: 'https://evil.test' },
    { versionId: 'null' },
    { backupId: 'different' },
    { bytes: 6 * 1024 ** 3 },
    { sha256: 'bad' },
  ])('rejects receipt substitution before network: %j', async (change) => {
    await expect(
      downloadBundle(
        { ...options, receipt: { ...receipt, ...change }, outputDir: join(dir, 'restored') },
        client,
      ),
    ).rejects.toThrow('E_BACKUP_RECEIPT');
    expect(client.send).not.toHaveBeenCalled();
  });

  it.each(['truncated', 'oversized', 'tampered', 'wrong-version', 'wrong-size'])(
    'rejects %s response without publishing a backup',
    async (fault) => {
      let data = Buffer.from(original);
      if (fault === 'truncated') data = data.subarray(0, 20);
      if (fault === 'oversized') data = Buffer.concat([data, Buffer.from('extra')]);
      if (fault === 'tampered') data[data.length - 1] ^= 1;
      const body = Readable.from([data]);
      client.send.mockResolvedValue({
        VersionId: fault === 'wrong-version' ? 'other-version' : receipt.versionId,
        ContentLength: fault === 'wrong-size' ? 1 : receipt.bytes,
        Body: body,
      });
      const outputDir = join(dir, 'restored');
      await expect(downloadBundle({ ...options, receipt, outputDir }, client)).rejects.toThrow(
        'E_BACKUP_REMOTE_INVALID',
      );
      expect(await readdir(outputDir)).toEqual([]);
      expect(await readdir(options.workDir)).toEqual(['.backup.lock']);
      expect(body.destroyed).toBe(true);
    },
  );

  it('checks the signature even when the receipt digest matches a forged archive', async () => {
    const forged = Buffer.from(original);
    forged[12] ^= 1;
    objects.set('version-1', forged);
    const outputDir = join(dir, 'restored');
    await expect(
      downloadBundle(
        { ...options, receipt: { ...receipt, sha256: sha(forged) }, outputDir },
        client,
      ),
    ).rejects.toThrow('E_BACKUP_SIGNATURE');
    expect(await readdir(outputDir)).toEqual([]);
  });

  it.each(['open', 'write', 'sync'])(
    'reports local staging %s failure as I/O, without publishing',
    async (operation) => {
      const probe = await open(join(dir, 'probe'), 'w');
      const prototype = Object.getPrototypeOf(probe);
      await probe.close();
      const body = Readable.from([original]);
      client.send.mockImplementationOnce(async () => {
        if (operation === 'open') {
          const job = (await readdir(options.workDir)).find((name) =>
            name.startsWith('.bundle-job-'),
          );
          await mkdir(join(options.workDir, job, 'download.vdbak'));
        } else {
          vi.spyOn(prototype, operation).mockRejectedValueOnce(
            Object.assign(new Error('local storage details'), { code: 'ENOSPC' }),
          );
        }
        return { VersionId: receipt.versionId, ContentLength: receipt.bytes, Body: body };
      });
      const outputDir = join(dir, 'restored');
      await expect(downloadBundle({ ...options, receipt, outputDir }, client)).rejects.toThrow(
        /^E_BACKUP_IO$/,
      );
      expect(await readdir(outputDir)).toEqual([]);
      expect(await readdir(options.workDir)).toEqual(['.backup.lock']);
      expect(body.destroyed).toBe(true);
      expect(client.send).toHaveBeenCalledTimes(1);
    },
  );

  it('keeps a broken response stream classified as a remote failure', async () => {
    const body = Readable.from(
      (async function* () {
        yield original.subarray(0, 20);
        throw Object.assign(new Error('connection details'), { code: 'ECONNRESET' });
      })(),
    );
    client.send.mockResolvedValue({
      VersionId: receipt.versionId,
      ContentLength: receipt.bytes,
      Body: body,
    });
    const outputDir = join(dir, 'restored');
    await expect(downloadBundle({ ...options, receipt, outputDir }, client)).rejects.toThrow(
      /^E_BACKUP_REMOTE_FAILED$/,
    );
    expect(await readdir(outputDir)).toEqual([]);
    expect(await readdir(options.workDir)).toEqual(['.backup.lock']);
    expect(body.destroyed).toBe(true);
  });

  it('does not replace a pre-existing restored bundle', async () => {
    const outputDir = join(dir, 'restored');
    await mkdir(outputDir, { mode: 0o700 });
    const destination = join(outputDir, `void-${ID}.vdbak`);
    await writeFile(destination, 'keep this file');
    await expect(downloadBundle({ ...options, receipt, outputDir }, client)).rejects.toThrow(
      'E_BACKUP_EXISTS',
    );
    expect(await readFile(destination, 'utf8')).toBe('keep this file');
  });
});
