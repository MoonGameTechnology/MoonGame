/**
 * SE-3.5 foundation: an authenticated, portable envelope around age ciphertext.
 * This is trusted local staging, not an immutable/off-host repository. Filesystem
 * ancestors and the running user must be trusted; another process with this user's
 * privileges can still remove files. The signing key is NOT the age restore key.
 *
 * Wire v1: 8-byte magic, uint32 BE JSON length, 64-byte Ed25519 signature, exact
 * UTF-8 JSON, zero padding to 16 KiB, then exactly the signed ciphertext length.
 * Signing covers a protocol-specific context followed by the exact JSON bytes.
 */
import { constants } from 'node:fs';
import { link, mkdir, open, unlink } from 'node:fs/promises';
import {
  createHash,
  createPrivateKey,
  createPublicKey,
  randomUUID,
  sign,
  verify,
} from 'node:crypto';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TextDecoder } from 'node:util';

const MAGIC = Buffer.from('VDBAK001');
const HEADER_BYTES = 16384;
const MANIFEST_OFFSET = 76;
const SIGN_CONTEXT = Buffer.from('Void Dominion backup bundle v1\0', 'utf8');
const AGE_HEADER = Buffer.from('age-encryption.org/v1\n');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SLUG = /^[a-z0-9][a-z0-9-]{0,62}$/;
const READ_FLAGS = constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK;
const CREATE_FLAGS =
  constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW;

class BackupError extends Error {
  constructor(code) {
    super(code);
  }
}

function fail(code) {
  throw new BackupError(code);
}
function safeError(error) {
  if (error instanceof BackupError) return error;
  return new BackupError(error?.code === 'EEXIST' ? 'E_BACKUP_EXISTS' : 'E_BACKUP_IO');
}

function pathValue(value) {
  if (typeof value !== 'string' || !value || value.includes('\0')) fail('E_BACKUP_CONFIG');
  return resolve(value);
}

function metadata(domain, producer, backupId) {
  if (
    typeof domain !== 'string' ||
    !SLUG.test(domain) ||
    typeof producer !== 'string' ||
    !SLUG.test(producer) ||
    typeof backupId !== 'string' ||
    !UUID.test(backupId)
  )
    fail('E_BACKUP_CONFIG');
}

async function close(handle) {
  if (handle) await handle.close().catch(() => {});
}

async function regularFile(path) {
  let handle;
  try {
    handle = await open(pathValue(path), READ_FLAGS);
    const info = await handle.stat();
    if (!info.isFile() || !Number.isSafeInteger(info.size)) fail('E_BACKUP_PATH');
    return { handle, size: info.size };
  } catch (error) {
    await close(handle);
    if (error instanceof BackupError) throw error;
    fail('E_BACKUP_PATH');
  }
}

// No recursive creation: the caller supplies a trusted parent, not an arbitrary
// directory tree. O_DIRECTORY/O_NOFOLLOW rejects the final symlink component.
async function privateDirectory(path) {
  const directory = pathValue(path);
  try {
    await mkdir(directory, { mode: 0o700 });
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
  }
  let handle;
  try {
    handle = await open(
      directory,
      constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
    );
    const info = await handle.stat();
    if (!info.isDirectory() || (info.mode & 0o777) !== 0o700) fail('E_BACKUP_PATH');
    return { path: directory, handle };
  } catch {
    await close(handle);
    fail('E_BACKUP_PATH');
  }
}

async function readExactly(handle, buffer, position) {
  let offset = 0;
  while (offset < buffer.length) {
    const { bytesRead } = await handle.read(
      buffer,
      offset,
      buffer.length - offset,
      position + offset,
    );
    if (!bytesRead) fail('E_BACKUP_FORMAT');
    offset += bytesRead;
  }
}

async function writeExactly(handle, buffer, position) {
  let offset = 0;
  while (offset < buffer.length) {
    const { bytesWritten } = await handle.write(
      buffer,
      offset,
      buffer.length - offset,
      position + offset,
    );
    if (!bytesWritten) fail('E_BACKUP_IO');
    offset += bytesWritten;
  }
}

async function keyFile(path, privateKey) {
  let handle;
  try {
    const source = await regularFile(path);
    handle = source.handle;
    if (!source.size || source.size > 16384) fail('E_BACKUP_KEY');
    const pem = Buffer.alloc(source.size);
    await readExactly(handle, pem, 0);
    const extra = await handle.read(Buffer.alloc(1), 0, 1, source.size);
    if (extra.bytesRead) fail('E_BACKUP_KEY');
    // createPublicKey also accepts a private PEM; don't accidentally deploy the
    // signing secret as a restore verifier's configuration.
    if (!privateKey && !pem.toString('ascii').startsWith('-----BEGIN PUBLIC KEY-----'))
      fail('E_BACKUP_KEY');
    const key = privateKey ? createPrivateKey(pem) : createPublicKey(pem);
    if (key.asymmetricKeyType !== 'ed25519') fail('E_BACKUP_KEY');
    return key;
  } catch {
    fail('E_BACKUP_KEY');
  } finally {
    await close(handle);
  }
}

/** Preflight for backup.sh: validate configuration before taking a database dump. */
export async function validateSealConfig(options = {}) {
  try {
    metadata(options.domain, options.producer, options.backupId ?? randomUUID());
    await keyFile(options.privateKeyPath, true);
    return { ok: true };
  } catch (error) {
    throw safeError(error);
  }
}

// Bounded memory; hashes are calculated over the same bytes written to the private
// destination. Freeze the initial length and reject growth/truncation instead of
// following an endlessly growing input. No later read of the source supplies data.
async function copyCiphertext(source, target, sourceOffset, targetOffset, size) {
  if (
    !Number.isSafeInteger(size) ||
    size < AGE_HEADER.length ||
    size > Number.MAX_SAFE_INTEGER - HEADER_BYTES
  )
    fail('E_BACKUP_FORMAT');
  const prefix = Buffer.alloc(AGE_HEADER.length);
  await readExactly(source, prefix, sourceOffset);
  if (!prefix.equals(AGE_HEADER)) fail('E_BACKUP_FORMAT');
  await writeExactly(target, prefix, targetOffset);
  const hash = createHash('sha256').update(prefix);
  const buffer = Buffer.alloc(65536);
  let copied = prefix.length;
  while (copied < size) {
    const length = Math.min(buffer.length, size - copied);
    const { bytesRead } = await source.read(buffer, 0, length, sourceOffset + copied);
    if (!bytesRead) fail('E_BACKUP_FORMAT');
    const chunk = buffer.subarray(0, bytesRead);
    await writeExactly(target, chunk, targetOffset + copied);
    hash.update(chunk);
    copied += bytesRead;
  }
  const extra = await source.read(Buffer.alloc(1), 0, 1, sourceOffset + size);
  if (extra.bytesRead) fail('E_BACKUP_FORMAT');
  return { format: 'postgres.sql.gz.age', bytes: copied, sha256: hash.digest('hex') };
}

function exactKeys(value, keys) {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.keys(value).sort().join(',') === [...keys].sort().join(',')
  );
}

function validManifest(manifest) {
  if (
    !exactKeys(manifest, [
      'version',
      'type',
      'backupId',
      'domain',
      'producer',
      'createdAt',
      'ciphertext',
    ]) ||
    manifest.version !== 1 ||
    manifest.type !== 'void.postgres.backup' ||
    !exactKeys(manifest.ciphertext, ['format', 'bytes', 'sha256'])
  )
    fail('E_BACKUP_FORMAT');
  try {
    metadata(manifest.domain, manifest.producer, manifest.backupId);
  } catch {
    fail('E_BACKUP_FORMAT');
  }
  const data = manifest.ciphertext;
  if (
    data.format !== 'postgres.sql.gz.age' ||
    !Number.isSafeInteger(data.bytes) ||
    data.bytes < AGE_HEADER.length ||
    data.bytes > Number.MAX_SAFE_INTEGER - HEADER_BYTES ||
    typeof data.sha256 !== 'string' ||
    !/^[0-9a-f]{64}$/.test(data.sha256) ||
    typeof manifest.createdAt !== 'string' ||
    manifest.createdAt.length !== 24
  )
    fail('E_BACKUP_FORMAT');
  try {
    if (new Date(manifest.createdAt).toISOString() !== manifest.createdAt) fail('E_BACKUP_FORMAT');
  } catch {
    fail('E_BACKUP_FORMAT');
  }
}

/** Produce one durable file; exclusive hard-link publication never replaces history. */
export async function createBundle(options = {}) {
  let source;
  let directory;
  let output;
  let temporary;
  let linked = false;
  try {
    const backupId = options.backupId ?? randomUUID();
    metadata(options.domain, options.producer, backupId);
    const key = await keyFile(options.privateKeyPath, true);
    source = await regularFile(options.archivePath);
    directory = await privateDirectory(options.outputDir);
    temporary = join(directory.path, `.bundle-${randomUUID()}.tmp`);
    output = await open(temporary, CREATE_FLAGS, 0o600);
    await writeExactly(output, Buffer.alloc(HEADER_BYTES), 0);
    const ciphertext = await copyCiphertext(source.handle, output, 0, HEADER_BYTES, source.size);
    const manifest = {
      version: 1,
      type: 'void.postgres.backup',
      backupId,
      domain: options.domain,
      producer: options.producer,
      createdAt: new Date().toISOString(),
      ciphertext,
    };
    const encoded = Buffer.from(JSON.stringify(manifest), 'utf8');
    if (encoded.length > HEADER_BYTES - MANIFEST_OFFSET) fail('E_BACKUP_FORMAT');
    const header = Buffer.alloc(HEADER_BYTES);
    MAGIC.copy(header);
    header.writeUInt32BE(encoded.length, 8);
    sign(null, Buffer.concat([SIGN_CONTEXT, encoded]), key).copy(header, 12);
    encoded.copy(header, MANIFEST_OFFSET);
    await writeExactly(output, header, 0);
    await output.sync();
    const path = join(directory.path, `void-${backupId}.vdbak`);
    await link(temporary, path);
    linked = true;
    // Failure here means the complete file exists, but crash durability is unknown.
    // Never erase it or encourage retry under another ID as if nothing happened.
    await directory.handle.sync();
    await unlink(temporary);
    temporary = undefined;
    return { backupId, path };
  } catch (error) {
    if (linked) fail('E_BACKUP_COMMIT_UNKNOWN');
    throw safeError(error);
  } finally {
    await close(output);
    await close(source?.handle);
    await close(directory?.handle);
    if (temporary) await unlink(temporary).catch(() => {});
  }
}

/** Authenticate metadata and copy the verified ciphertext into private restore staging. */
export async function prepareBundle(options = {}) {
  let source;
  let directory;
  let output;
  let target;
  let created = false;
  let complete = false;
  try {
    metadata(options.expectedDomain, options.expectedProducer, options.expectedBackupId);
    const key = await keyFile(options.publicKeyPath, false);
    source = await regularFile(options.bundlePath);
    if (source.size < HEADER_BYTES) fail('E_BACKUP_FORMAT');
    const header = Buffer.alloc(HEADER_BYTES);
    await readExactly(source.handle, header, 0);
    const length = header.readUInt32BE(8);
    if (
      !header.subarray(0, 8).equals(MAGIC) ||
      !length ||
      length > HEADER_BYTES - MANIFEST_OFFSET ||
      header.subarray(MANIFEST_OFFSET + length).some((byte) => byte !== 0)
    )
      fail('E_BACKUP_FORMAT');
    const encoded = header.subarray(MANIFEST_OFFSET, MANIFEST_OFFSET + length);
    if (!verify(null, Buffer.concat([SIGN_CONTEXT, encoded]), key, header.subarray(12, 76)))
      fail('E_BACKUP_SIGNATURE');
    let manifest;
    try {
      manifest = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(encoded));
      // A single unambiguous representation; duplicate keys/alternate spellings are rejected.
      if (!Buffer.from(JSON.stringify(manifest), 'utf8').equals(encoded)) fail('E_BACKUP_FORMAT');
    } catch {
      fail('E_BACKUP_FORMAT');
    }
    validManifest(manifest);
    if (
      manifest.domain !== options.expectedDomain ||
      manifest.producer !== options.expectedProducer ||
      manifest.backupId !== options.expectedBackupId
    )
      fail('E_BACKUP_IDENTITY');
    if (source.size !== HEADER_BYTES + manifest.ciphertext.bytes) fail('E_BACKUP_FORMAT');
    directory = await privateDirectory(options.outputDir);
    target = join(directory.path, 'archive.sql.gz.age');
    output = await open(target, CREATE_FLAGS, 0o600);
    created = true;
    const copied = await copyCiphertext(
      source.handle,
      output,
      HEADER_BYTES,
      0,
      manifest.ciphertext.bytes,
    );
    if (copied.sha256 !== manifest.ciphertext.sha256) fail('E_BACKUP_DIGEST');
    await output.sync();
    await directory.handle.sync();
    complete = true;
    return manifest;
  } catch (error) {
    throw safeError(error);
  } finally {
    await close(output);
    await close(source?.handle);
    await close(directory?.handle);
    if (created && !complete) await unlink(target).catch(() => {});
  }
}

async function main() {
  const [command, source, outputDir, ...extra] = process.argv.slice(2);
  const sealing = {
    backupId: process.env.BACKUP_ID || undefined,
    privateKeyPath: process.env.BACKUP_SIGNING_KEY,
    domain: process.env.BACKUP_DOMAIN,
    producer: process.env.BACKUP_PRODUCER,
  };
  let result;
  if (command === 'check-seal' && source === undefined) result = await validateSealConfig(sealing);
  else if (command === 'seal' && source && outputDir && !extra.length)
    result = await createBundle({ ...sealing, archivePath: source, outputDir });
  else if (command === 'prepare' && source && outputDir && !extra.length)
    result = await prepareBundle({
      bundlePath: source,
      outputDir,
      publicKeyPath: process.env.BACKUP_VERIFY_KEY,
      expectedDomain: process.env.BACKUP_EXPECT_DOMAIN,
      expectedProducer: process.env.BACKUP_EXPECT_PRODUCER,
      expectedBackupId: process.env.BACKUP_EXPECT_ID,
    });
  else fail('E_BACKUP_CONFIG');
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${safeError(error).message}\n`);
    process.exitCode = 1;
  });
}
