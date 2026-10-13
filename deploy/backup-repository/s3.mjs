/** SE-3.5: independent S3 transport. No DB, decryption key, retention or delete API.
 * Receipts must be kept in a trusted journal outside the game host. An endpoint
 * acknowledging a version does not by itself prove Object Lock or restore fitness.
 */
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { constants, createReadStream } from 'node:fs';
import { link, mkdir, open, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { Agent } from 'node:https';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { prepareBundle, withBackupWorkspace } from '../backup-bundle.mjs';

const MAX_BYTES = 5 * 1024 ** 3; // Single conditional PUT; no multipart fallback.
const SLUG = /^[a-z0-9][a-z0-9-]{0,62}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const READ = constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK;
const CREATE = constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW;
const CODES = new Set(
  [
    'CONFIG',
    'PATH',
    'KEY',
    'FORMAT',
    'SIGNATURE',
    'IDENTITY',
    'DIGEST',
    'LOCK',
    'IO',
    'EXISTS',
    'COMMIT_UNKNOWN',
    'RECEIPT',
    'REMOTE_UNKNOWN',
    'REMOTE_EXISTS',
    'REMOTE_FAILED',
    'REMOTE_INVALID',
  ].map((x) => `E_BACKUP_${x}`),
);
const fail = (code) => {
  throw new Error(`E_BACKUP_${code}`);
};
const safe = (error) => new Error(CODES.has(error?.message) ? error.message : 'E_BACKUP_IO');
const b64 = (hex) => Buffer.from(hex, 'hex').toString('base64');

function config(options) {
  let url;
  try {
    url = new URL(options.endpoint);
  } catch {
    fail('CONFIG');
  }
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  )
    fail('CONFIG');
  if (
    typeof options.bucket !== 'string' ||
    !/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(options.bucket) ||
    options.bucket.includes('..')
  )
    fail('CONFIG');
  if (
    [options.region, options.expectedDomain, options.expectedProducer].some(
      (value) => typeof value !== 'string' || !SLUG.test(value),
    ) ||
    typeof options.expectedBackupId !== 'string' ||
    !UUID.test(options.expectedBackupId)
  )
    fail('CONFIG');
  if (
    typeof options.publicKeyPath !== 'string' ||
    !options.publicKeyPath ||
    typeof options.workDir !== 'string' ||
    !options.workDir
  )
    fail('CONFIG');
  const timeoutMs = options.timeoutMs ?? 300_000;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 1_800_000) fail('CONFIG');
  return {
    ...options,
    endpoint: url.origin,
    timeoutMs,
    key: `backups/v1/${options.expectedDomain}/${options.expectedProducer}/${options.expectedBackupId}.vdbak`,
  };
}

async function regular(path) {
  let handle;
  try {
    handle = await open(path, READ);
    const info = await handle.stat();
    if (!info.isFile() || !Number.isSafeInteger(info.size)) fail('PATH');
    return { handle, bytes: info.size };
  } catch {
    await handle?.close().catch(() => {});
    fail('PATH');
  }
}

async function smallFile(path, limit) {
  const source = await regular(path);
  try {
    if (!source.bytes || source.bytes > limit) fail('CONFIG');
    const data = Buffer.alloc(source.bytes + 1);
    let offset = 0;
    while (offset < data.length) {
      const { bytesRead } = await source.handle.read(data, offset, data.length - offset, offset);
      if (!bytesRead) break;
      offset += bytesRead;
    }
    if (offset !== source.bytes) fail('CONFIG');
    return data.subarray(0, offset);
  } finally {
    await source.handle.close();
  }
}

async function privateDirectory(path) {
  let handle;
  try {
    try {
      await mkdir(path, { mode: 0o700 });
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
    }
    handle = await open(path, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    const info = await handle.stat();
    if ((info.mode & 0o777) !== 0o700) fail('PATH');
    return handle;
  } catch {
    await handle?.close().catch(() => {});
    fail('PATH');
  }
}

// Copy a bounded stream; reject before writing bytes beyond the expected length.
async function copy(body, target, expected) {
  let output;
  const hash = createHash('sha256');
  let size = 0;
  try {
    output = await open(target, CREATE, 0o600);
    for await (const value of body) {
      const chunk = Buffer.from(value);
      if (size + chunk.length > expected) fail('REMOTE_INVALID');
      let offset = 0;
      while (offset < chunk.length) {
        const { bytesWritten } = await output.write(
          chunk,
          offset,
          chunk.length - offset,
          size + offset,
        );
        if (!bytesWritten) fail('IO');
        offset += bytesWritten;
      }
      size += chunk.length;
      hash.update(chunk);
    }
    if (size !== expected) fail('REMOTE_INVALID');
    await output.sync();
    return hash.digest('hex');
  } finally {
    body.destroy?.();
    await output?.close();
  }
}

async function snapshot(sourcePath, target) {
  const source = await regular(sourcePath);
  try {
    if (source.bytes < 16384 || source.bytes > MAX_BYTES) fail('FORMAT');
    const body = source.handle.createReadStream({ start: 0, end: source.bytes, autoClose: false });
    return { bytes: source.bytes, sha256: await copy(body, target, source.bytes) };
  } finally {
    await source.handle.close();
  }
}

async function verify(path, cfg, workspace) {
  return prepareBundle({
    bundlePath: path,
    outputDir: join(workspace, 'verified'),
    publicKeyPath: cfg.publicKeyPath,
    expectedDomain: cfg.expectedDomain,
    expectedProducer: cfg.expectedProducer,
    expectedBackupId: cfg.expectedBackupId,
  });
}

function validVersion(value) {
  return (
    typeof value === 'string' && value !== 'null' && /^[A-Za-z0-9._~+/=-]{1,1024}$/.test(value)
  );
}

function receiptFor(cfg, digest, versionId) {
  return {
    version: 1,
    type: 'void.backup.s3-receipt',
    endpoint: cfg.endpoint,
    region: cfg.region,
    bucket: cfg.bucket,
    key: cfg.key,
    domain: cfg.expectedDomain,
    producer: cfg.expectedProducer,
    backupId: cfg.expectedBackupId,
    versionId,
    ...digest,
  };
}

function checkedReceipt(value, cfg) {
  if (
    !value ||
    typeof value !== 'object' ||
    !validVersion(value.versionId) ||
    !Number.isSafeInteger(value.bytes) ||
    value.bytes < 16384 ||
    value.bytes > MAX_BYTES ||
    typeof value.sha256 !== 'string' ||
    !/^[0-9a-f]{64}$/.test(value.sha256)
  )
    fail('RECEIPT');
  const wanted = receiptFor(cfg, { bytes: value.bytes, sha256: value.sha256 }, value.versionId);
  if (
    Object.keys(value).sort().join(',') !== Object.keys(wanted).sort().join(',') ||
    Object.keys(wanted).some((key) => value[key] !== wanted[key])
  )
    fail('RECEIPT');
  return wanted;
}

// Explicit TLS verification also overrides NODE_TLS_REJECT_UNAUTHORIZED=0.
async function repository(cfg) {
  const ca = cfg.caPath ? await smallFile(cfg.caPath, 1024 * 1024) : undefined;
  return new S3Client({
    endpoint: cfg.endpoint,
    region: cfg.region,
    forcePathStyle: true,
    followRegionRedirects: false,
    maxAttempts: 1,
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
    requestHandler: {
      httpsAgent: new Agent({
        rejectUnauthorized: true,
        minVersion: 'TLSv1.2',
        ...(ca ? { ca } : {}),
      }),
      connectionTimeout: Math.min(cfg.timeoutMs, 10_000),
      requestTimeout: cfg.timeoutMs,
    },
  });
}

async function network(cfg, injected, action) {
  const client = injected ?? (await repository(cfg));
  const controller = new globalThis.AbortController();
  const timer = setTimeout(() => controller.abort(), cfg.timeoutMs);
  try {
    return await action(client, controller.signal);
  } finally {
    clearTimeout(timer);
    if (!injected) client.destroy();
  }
}

/** A lost PUT response is unknown, never an instruction to retry under a new ID. */
export async function uploadBundle(options, injected) {
  try {
    const cfg = config(options);
    return await withBackupWorkspace(cfg.workDir, async (workspace) => {
      const path = join(workspace, 'snapshot.vdbak');
      const digest = await snapshot(cfg.bundlePath, path);
      await verify(path, cfg, workspace);
      return network(cfg, injected, async (client, signal) => {
        const body = createReadStream(path);
        try {
          const result = await client.send(
            new PutObjectCommand({
              Bucket: cfg.bucket,
              Key: cfg.key,
              Body: body,
              ContentLength: digest.bytes,
              ChecksumSHA256: b64(digest.sha256),
              IfNoneMatch: '*',
              ContentType: 'application/octet-stream',
            }),
            { abortSignal: signal },
          );
          if (!validVersion(result.VersionId) || result.ChecksumSHA256 !== b64(digest.sha256))
            fail('REMOTE_UNKNOWN');
          return receiptFor(cfg, digest, result.VersionId);
        } catch (error) {
          if (error?.$metadata?.httpStatusCode === 412) fail('REMOTE_EXISTS');
          fail('REMOTE_UNKNOWN');
        } finally {
          body.destroy();
        }
      });
    });
  } catch (error) {
    throw safe(error);
  }
}

/** Only an exact receipt version can be fetched. Publish after digest/signature checks. */
export async function downloadBundle(options, injected) {
  let directory;
  let linked = false;
  try {
    const cfg = config(options);
    const receipt = checkedReceipt(options.receipt, cfg);
    directory = await privateDirectory(options.outputDir);
    return await withBackupWorkspace(cfg.workDir, async (workspace) => {
      // Publication is one exclusive hardlink, never a non-atomic cross-device copy.
      if ((await stat(workspace)).dev !== (await directory.stat()).dev) fail('PATH');
      const temporary = join(workspace, 'download.vdbak');
      await network(cfg, injected, async (client, signal) => {
        let body;
        try {
          const result = await client.send(
            new GetObjectCommand({
              Bucket: cfg.bucket,
              Key: cfg.key,
              VersionId: receipt.versionId,
              ChecksumMode: 'ENABLED',
            }),
            { abortSignal: signal },
          );
          body = result.Body;
          if (
            !body ||
            result.VersionId !== receipt.versionId ||
            result.ContentLength !== receipt.bytes
          )
            fail('REMOTE_INVALID');
          if (result.ChecksumSHA256 && result.ChecksumSHA256 !== b64(receipt.sha256))
            fail('REMOTE_INVALID');
          const stop = () => body.destroy(new Error('E_BACKUP_REMOTE_FAILED'));
          signal.addEventListener('abort', stop, { once: true });
          try {
            if (signal.aborted) fail('REMOTE_FAILED');
            if ((await copy(body, temporary, receipt.bytes)) !== receipt.sha256)
              fail('REMOTE_INVALID');
          } finally {
            signal.removeEventListener('abort', stop);
          }
        } catch (error) {
          if (error?.message === 'E_BACKUP_REMOTE_INVALID') throw error;
          fail('REMOTE_FAILED');
        } finally {
          body?.destroy?.();
        }
      });
      await verify(temporary, cfg, workspace);
      const path = join(options.outputDir, `void-${cfg.expectedBackupId}.vdbak`);
      await link(temporary, path);
      linked = true;
      await directory.sync();
      return { ...receipt, path };
    });
  } catch (error) {
    if (linked) fail('COMMIT_UNKNOWN');
    if (error?.code === 'EEXIST') fail('EXISTS');
    throw safe(error);
  } finally {
    await directory?.close().catch(() => {});
  }
}

async function main() {
  const [command, source, workDir, outputDir, ...extra] = process.argv.slice(2);
  if (!source || !workDir || extra.length) fail('CONFIG');
  const options = {
    endpoint: process.env.BACKUP_S3_ENDPOINT,
    region: process.env.BACKUP_S3_REGION,
    bucket: process.env.BACKUP_S3_BUCKET,
    caPath: process.env.BACKUP_S3_CA,
    timeoutMs: process.env.BACKUP_S3_TIMEOUT_MS
      ? Number(process.env.BACKUP_S3_TIMEOUT_MS)
      : undefined,
    publicKeyPath: process.env.BACKUP_VERIFY_KEY,
    expectedDomain: process.env.BACKUP_EXPECT_DOMAIN,
    expectedProducer: process.env.BACKUP_EXPECT_PRODUCER,
    expectedBackupId: process.env.BACKUP_EXPECT_ID,
    workDir,
  };
  let result;
  if (command === 'put' && !outputDir)
    result = await uploadBundle({ ...options, bundlePath: source });
  else if (command === 'get' && outputDir) {
    let receipt;
    try {
      receipt = JSON.parse((await smallFile(source, 16384)).toString('utf8'));
    } catch {
      fail('RECEIPT');
    }
    result = await downloadBundle({ ...options, receipt, outputDir });
  } else fail('CONFIG');
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${safe(error).message}\n`);
    process.exitCode = 1;
  });
}
