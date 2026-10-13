// A local S3 wire fixture, NOT an IAM/Object Lock implementation or provider certification.
// The real SDK, HTTPS, hostname/CA verification, streaming and CLI execute here.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash, generateKeyPairSync, randomBytes } from 'node:crypto';
import { execFile, execFileSync, spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:https';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { cleanupBundles, createBundle } from '../backup-bundle.mjs';
import { downloadBundle, uploadBundle } from './s3.mjs';

const run = promisify(execFile);
const CLI = fileURLToPath(new URL('./s3.mjs', import.meta.url));
const ID = '62a54d8e-9715-478f-a568-181243157936';
const keys = generateKeyPairSync('ed25519');
const digest = (body) => createHash('sha256').update(body).digest('base64');
const hasAge = (() => {
  try {
    execFileSync('age', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

describe('S3 over real HTTPS and SDK (local protocol fixture)', () => {
  let certificates, tls, wrongTls, dir, server, cfg, path, original, requests, objects, mode, child;
  beforeAll(async () => {
    certificates = await mkdtemp(join(tmpdir(), 'void-s3-tls-'));
    async function certificate(name, san) {
      const key = join(certificates, `${name}.key`);
      const cert = join(certificates, `${name}.pem`);
      await run('openssl', [
        'req',
        '-x509',
        '-newkey',
        'rsa:2048',
        '-nodes',
        '-keyout',
        key,
        '-out',
        cert,
        '-days',
        '1',
        '-subj',
        '/CN=backup-test',
        '-addext',
        `subjectAltName=${san}`,
      ]);
      return { key: await readFile(key), cert: await readFile(cert), caPath: cert };
    }
    tls = await certificate('valid', 'IP:127.0.0.1');
    wrongTls = await certificate('wrong-host', 'DNS:wrong.example.test');
  });
  afterAll(async () => {
    await rm(certificates, { recursive: true, force: true });
  });
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'void-s3-https-'));
    vi.stubEnv('AWS_ACCESS_KEY_ID', 'synthetic-backup-writer');
    vi.stubEnv('AWS_SECRET_ACCESS_KEY', randomBytes(32).toString('hex'));
    vi.stubEnv('AWS_EC2_METADATA_DISABLED', 'true');
    vi.stubEnv('AWS_PROFILE', '');
    vi.stubEnv('AWS_CONFIG_FILE', join(dir, 'no-config'));
    vi.stubEnv('AWS_SHARED_CREDENTIALS_FILE', join(dir, 'no-credentials'));
    const privateKeyPath = join(dir, 'sign.pem');
    const publicKeyPath = join(dir, 'verify.pem');
    await writeFile(privateKeyPath, keys.privateKey.export({ type: 'pkcs8', format: 'pem' }), {
      mode: 0o600,
    });
    await writeFile(publicKeyPath, keys.publicKey.export({ type: 'spki', format: 'pem' }));
    const archivePath = join(dir, 'source.age');
    await writeFile(
      archivePath,
      Buffer.concat([Buffer.from('age-encryption.org/v1\n'), randomBytes(200000)]),
    );
    ({ path } = await createBundle({
      privateKeyPath,
      archivePath,
      outputDir: join(dir, 'bundles'),
      domain: 'game',
      producer: 'nightly',
      backupId: ID,
    }));
    original = await readFile(path);
    requests = [];
    objects = new Map();
    mode = 'normal';
    cfg = {
      region: 'us-east-1',
      bucket: 'void-backups',
      publicKeyPath,
      expectedDomain: 'game',
      expectedProducer: 'nightly',
      expectedBackupId: ID,
      workDir: join(dir, 'work'),
      timeoutMs: 2000,
    };
    await start(tls);
  });
  afterEach(async () => {
    if (child && child.exitCode === null && child.signalCode === null) {
      const stopped = once(child, 'close');
      child.kill('SIGKILL');
      await stopped;
    }
    child = undefined;
    if (server) {
      server.closeAllConnections();
      await new Promise((done) => server.close(done));
    }
    vi.unstubAllEnvs();
    await rm(dir, { recursive: true, force: true });
  });

  async function start(material, extra = {}) {
    if (server) {
      server.closeAllConnections();
      await new Promise((done) => server.close(done));
    }
    server = createServer({ key: material.key, cert: material.cert, ...extra }, (req, res) => {
      requests.push({
        method: req.method,
        url: req.url,
        headers: req.headers,
        protocol: req.socket.getProtocol(),
      });
      server.emit('backup-request');
      if (mode === 'redirect') {
        res.writeHead(307, { location: `${cfg.endpoint}/redirected` });
        res.end();
        return;
      }
      if (mode === 'unavailable') {
        res.writeHead(503, { 'content-type': 'application/xml' });
        res.end('<Error><Code>SlowDown</Code></Error>');
        return;
      }
      if (mode === 'denied') {
        res.writeHead(403, { 'content-type': 'application/xml' });
        res.end('<Error><Code>AccessDenied</Code></Error>');
        return;
      }
      const url = new URL(req.url, cfg.endpoint);
      if (req.method === 'PUT') {
        const chunks = [];
        req.on('data', (data) => chunks.push(data));
        req.on('end', () => {
          const data = Buffer.concat(chunks);
          if (mode === 'hang-put') return;
          if (objects.size && req.headers['if-none-match'] === '*') {
            res.writeHead(412, { 'content-type': 'application/xml' });
            res.end('<Error><Code>PreconditionFailed</Code></Error>');
            return;
          }
          if (digest(data) !== req.headers['x-amz-checksum-sha256']) {
            res.writeHead(400);
            res.end();
            return;
          }
          objects.set('version-1', data);
          if (mode === 'lost-put-response') {
            req.socket.destroy();
            return;
          }
          res.writeHead(200, {
            'x-amz-version-id': 'version-1',
            'x-amz-checksum-sha256': digest(data),
          });
          res.end();
        });
      } else if (req.method === 'GET') {
        const version = url.searchParams.get('versionId');
        const data = objects.get(version);
        if (!data) {
          res.writeHead(404);
          res.end();
          return;
        }
        res.writeHead(200, { 'x-amz-version-id': version, 'content-length': data.length });
        if (mode === 'hang-get') {
          res.write(data.subarray(0, 10));
          return;
        }
        res.end(data);
      } else {
        res.writeHead(405);
        res.end();
      }
    });
    await new Promise((done) => server.listen(0, '127.0.0.1', done));
    cfg.endpoint = `https://127.0.0.1:${server.address().port}`;
    cfg.caPath = material.caPath;
  }

  function cliEnv(extra = {}) {
    return {
      ...process.env,
      BACKUP_S3_ENDPOINT: cfg.endpoint,
      BACKUP_S3_BUCKET: cfg.bucket,
      BACKUP_S3_REGION: cfg.region,
      BACKUP_S3_CA: cfg.caPath,
      BACKUP_S3_TIMEOUT_MS: String(cfg.timeoutMs),
      BACKUP_VERIFY_KEY: cfg.publicKeyPath,
      BACKUP_EXPECT_DOMAIN: 'game',
      BACKUP_EXPECT_PRODUCER: 'nightly',
      BACKUP_EXPECT_ID: ID,
      ...extra,
    };
  }

  it('round trips via SigV4/HTTPS and restores the pinned version after loss of the local source', async () => {
    const receipt = await uploadBundle({ ...cfg, bundlePath: path });
    expect(objects.get('version-1')).toEqual(original);
    expect(requests[0].headers.authorization).toMatch(
      /^AWS4-HMAC-SHA256 Credential=synthetic-backup-writer\//,
    );
    expect(requests[0].headers['if-none-match']).toBe('*');
    expect(['TLSv1.2', 'TLSv1.3']).toContain(requests[0].protocol);
    await rm(path);
    objects.set('latest-version', Buffer.from('different current object'));
    const result = await downloadBundle({ ...cfg, receipt, outputDir: join(dir, 'restored') });
    expect(new URL(requests[1].url, cfg.endpoint).searchParams.get('versionId')).toBe('version-1');
    expect(await readFile(result.path)).toEqual(original);
  });

  it('rejects a duplicate PUT and preserves the first object', async () => {
    await uploadBundle({ ...cfg, bundlePath: path });
    await expect(uploadBundle({ ...cfg, bundlePath: path })).rejects.toThrow(
      'E_BACKUP_REMOTE_EXISTS',
    );
    expect(requests).toHaveLength(2);
    expect(objects.get('version-1')).toEqual(original);
  });

  it.each(['lost-put-response', 'unavailable', 'redirect', 'denied'])(
    'does not retry or follow redirects on %s',
    async (fault) => {
      mode = fault;
      await expect(uploadBundle({ ...cfg, bundlePath: path })).rejects.toThrow(
        'E_BACKUP_REMOTE_UNKNOWN',
      );
      expect(requests).toHaveLength(1);
      expect(await readFile(path)).toEqual(original);
      if (fault === 'lost-put-response') expect(objects.get('version-1')).toEqual(original);
    },
  );

  it('rejects an untrusted certificate before sending credentials or the archive', async () => {
    await expect(uploadBundle({ ...cfg, caPath: undefined, bundlePath: path })).rejects.toThrow(
      'E_BACKUP_REMOTE_UNKNOWN',
    );
    expect(requests).toHaveLength(0);
  });

  it('rejects a trusted certificate for the wrong hostname', async () => {
    await start(wrongTls);
    await expect(uploadBundle({ ...cfg, bundlePath: path })).rejects.toThrow(
      'E_BACKUP_REMOTE_UNKNOWN',
    );
    expect(requests).toHaveLength(0);
  });

  it('refuses TLS older than 1.2', async () => {
    await start(tls, { minVersion: 'TLSv1', maxVersion: 'TLSv1.1' });
    await expect(uploadBundle({ ...cfg, bundlePath: path })).rejects.toThrow(
      'E_BACKUP_REMOTE_UNKNOWN',
    );
    expect(requests).toHaveLength(0);
  });

  it('applies the absolute deadline to a stalled response body after headers', async () => {
    const receipt = await uploadBundle({ ...cfg, bundlePath: path });
    mode = 'hang-get';
    const outputDir = join(dir, 'restored');
    await expect(downloadBundle({ ...cfg, timeoutMs: 100, receipt, outputDir })).rejects.toThrow(
      'E_BACKUP_REMOTE_FAILED',
    );
    expect(await readdir(outputDir)).toEqual([]);
    expect(await readdir(cfg.workDir)).toEqual(['.backup.lock']);
  });

  it('runs the CLI and ignores an ambient TLS-verification bypass', async () => {
    const put = await run(process.execPath, [CLI, 'put', path, cfg.workDir], { env: cliEnv() });
    const receipt = JSON.parse(put.stdout);
    const receiptPath = join(dir, 'receipt.json');
    await writeFile(receiptPath, put.stdout, { mode: 0o600 });
    const get = await run(
      process.execPath,
      [CLI, 'get', receiptPath, cfg.workDir, join(dir, 'restored')],
      { env: cliEnv() },
    );
    expect(await readFile(JSON.parse(get.stdout).path)).toEqual(original);
    expect(receipt.versionId).toBe('version-1');
    requests.length = 0;
    await expect(
      run(process.execPath, [CLI, 'put', path, cfg.workDir], {
        env: cliEnv({ BACKUP_S3_CA: '', NODE_TLS_REJECT_UNAUTHORIZED: '0' }),
      }),
    ).rejects.toMatchObject({
      code: 1,
      stdout: '',
      stderr: expect.stringContaining('E_BACKUP_REMOTE_UNKNOWN'),
    });
    expect(requests).toHaveLength(0);
  });

  it('protects a live CLI workspace and reclaims it on the next job after SIGKILL', async () => {
    mode = 'hang-put';
    const requested = once(server, 'backup-request');
    child = spawn(process.execPath, [CLI, 'put', path, cfg.workDir], {
      env: cliEnv({ BACKUP_S3_TIMEOUT_MS: '30000' }),
      stdio: 'ignore',
    });
    await requested;
    expect(await cleanupBundles({ outputDir: cfg.workDir })).toEqual({ skipped: true, removed: 0 });
    const oldWorkspace = (await readdir(cfg.workDir)).find((name) =>
      name.startsWith('.bundle-job-'),
    );
    expect(oldWorkspace).toBeTruthy();
    const stopped = once(child, 'close');
    child.kill('SIGKILL');
    await stopped;
    mode = 'normal';
    const receipt = await uploadBundle({ ...cfg, bundlePath: path });
    expect(receipt.versionId).toBe('version-1');
    expect(await readdir(cfg.workDir)).toEqual(['.backup.lock']);
    expect(await readFile(path)).toEqual(original);
  });

  it.skipIf(!process.env.DATABASE_URL || !hasAge)(
    'restores real PostgreSQL data through age + signed bundle + HTTPS after local backup and DB loss',
    async () => {
      const base = process.env.DATABASE_URL;
      const database = 'void_backup_s3_drill';
      const [connection, query] = base.split('?');
      const target = `${connection.replace(/\/[^/]*$/, `/${database}`)}${query ? `?${query}` : ''}`;
      const sql = async (url, text) =>
        (
          await run('psql', ['-tAqX', '-v', 'ON_ERROR_STOP=1', '-d', url, '-c', text])
        ).stdout.trim();
      const fingerprint = () =>
        sql(target, "SELECT md5(string_agg(t::text,'' ORDER BY id)) FROM backup_probe t");
      const deploy = fileURLToPath(new URL('../', import.meta.url));
      const identity = join(dir, 'restore-only.key');
      const generated = await run('age-keygen', ['-o', identity]);
      const recipient = /age1[a-z0-9]+/.exec(generated.stderr)[0];
      const backupDir = join(dir, 'db-backup');
      const env = {
        ...process.env,
        DATABASE_URL: target,
        BACKUP_DIR: backupDir,
        BACKUP_FORMAT: 'bundle-v1',
        BACKUP_ID: ID,
        BACKUP_DOMAIN: 'game',
        BACKUP_PRODUCER: 'nightly',
        BACKUP_SIGNING_KEY: join(dir, 'sign.pem'),
        BACKUP_AGE_RECIPIENT: recipient,
        PGTZ: 'UTC',
      };
      await sql(base, `DROP DATABASE IF EXISTS ${database} WITH (FORCE)`);
      try {
        await sql(base, `CREATE DATABASE ${database}`);
        await sql(
          target,
          `CREATE TABLE backup_probe (id integer PRIMARY KEY, state jsonb, balance numeric, created_at timestamptz); INSERT INTO backup_probe VALUES (1, '{"note":"данные учения test-secret-marker","nullable":null}', 1234567890.125, '2026-10-13T00:00:00Z'), (2, '{"items":[1,2,3]}', 0, NULL)`,
        );
        const before = await fingerprint();
        await run('bash', [join(deploy, 'backup.sh')], { env });
        const source = join(backupDir, `void-${ID}.vdbak`);
        const receipt = await uploadBundle({ ...cfg, bundlePath: source });
        expect(objects.get(receipt.versionId).toString('latin1')).not.toContain(
          'test-secret-marker',
        );
        await rm(backupDir, { recursive: true });
        await rm(env.BACKUP_SIGNING_KEY);
        await sql(base, `DROP DATABASE ${database} WITH (FORCE)`);
        await sql(base, `CREATE DATABASE ${database}`);
        const restored = await downloadBundle({
          ...cfg,
          receipt,
          outputDir: join(dir, 'db-restored'),
        });
        await run('bash', [join(deploy, 'restore.sh'), restored.path], {
          env: {
            ...process.env,
            DATABASE_URL: target,
            BACKUP_AGE_IDENTITY: identity,
            BACKUP_REQUIRE_SIGNED: '1',
            BACKUP_VERIFY_KEY: cfg.publicKeyPath,
            BACKUP_EXPECT_DOMAIN: 'game',
            BACKUP_EXPECT_PRODUCER: 'nightly',
            BACKUP_EXPECT_ID: ID,
            PGTZ: 'UTC',
          },
        });
        expect(await fingerprint()).toBe(before);
        const damaged = objects.get(receipt.versionId);
        damaged[damaged.length - 1] ^= 1;
        await expect(
          downloadBundle({ ...cfg, receipt, outputDir: join(dir, 'bad-restored') }),
        ).rejects.toThrow('E_BACKUP_REMOTE_INVALID');
        expect(await fingerprint()).toBe(before);
      } finally {
        await sql(base, `DROP DATABASE IF EXISTS ${database} WITH (FORCE)`);
      }
    },
    60000,
  );
});
