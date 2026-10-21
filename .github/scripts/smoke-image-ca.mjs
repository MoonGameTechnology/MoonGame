// DSA-6572-1: package inventory alone cannot prove that Node stopped trusting the
// removed roots. Exercise the built image's own ENTRYPOINT and default TLS policy.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { X509Certificate } from 'node:crypto';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, get } from 'node:https';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getCACertificates } from 'node:tls';
import { CA_CERTIFICATES, DISTRUSTED_CA_SHA256 } from '../../deploy/runtime/prepare-ca.mjs';

const insideScript = '/app/.github/scripts/smoke-image-ca.mjs';
const fixtureMount = '/ca-smoke';
const verificationErrors = new Set([
  'SELF_SIGNED_CERT_IN_CHAIN',
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'CERT_UNTRUSTED',
]);

function inventory() {
  // --use-system-ca also passes a synthetic-CA connection test, but adds the
  // bundled public roots back. Require the image's exclusive OpenSSL policy.
  assert.ok(
    process.execArgv.includes('--use-openssl-ca'),
    'The runtime ENTRYPOINT must select --use-openssl-ca',
  );
  assert.equal(process.env.SSL_CERT_FILE, '/etc/ssl/certs/ca-certificates.crt');
  // The OpenSSL store is loaded lazily, so this API normally returns no default
  // roots in this mode. If any are present (for example extra CAs), inspect them.
  for (const pem of getCACertificates('default')) {
    const fingerprint = new X509Certificate(pem).fingerprint256;
    assert.ok(
      !DISTRUSTED_CA_SHA256.includes(fingerprint),
      `Distrusted CA remains in Node's default trust store: ${fingerprint}`,
    );
  }
  const status = readFileSync(`/var/lib/dpkg/status.d/${CA_CERTIFICATES.package}`, 'utf8');
  assert.equal(status.match(/^Version: (.+)$/m)?.[1], CA_CERTIFICATES.version);
  const bundle = readFileSync('/etc/ssl/certs/ca-certificates.crt', 'utf8');
  const pattern = /-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g;
  const certificates = bundle.match(pattern) ?? [];
  assert.ok(certificates.length > 0, 'The runtime CA bundle must not be empty');
  assert.equal(bundle.replace(pattern, '').trim(), '', 'Unexpected data in the CA bundle');
  for (const pem of certificates) {
    const certificate = new X509Certificate(pem);
    assert.ok(certificate.ca, 'Every trust-store entry must be a CA certificate');
    assert.ok(
      !DISTRUSTED_CA_SHA256.includes(certificate.fingerprint256),
      `Distrusted CA remains in runtime bundle: ${certificate.fingerprint256}`,
    );
  }
  console.log(`CA inventory ok: ${CA_CERTIFICATES.version}, ${certificates.length} certificates`);
}

async function requestFixture(name) {
  const server = createServer(
    {
      key: readFileSync(join(fixtureMount, `${name}.key`)),
      cert: readFileSync(join(fixtureMount, `${name}.chain`)),
    },
    (_req, res) => res.end('trusted fixture'),
  );
  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    return await new Promise((resolve, reject) => {
      // No ca option, custom checkServerIdentity or rejectUnauthorized override:
      // this must use precisely the image's ordinary Node trust configuration.
      const request = get(
        `https://127.0.0.1:${server.address().port}/`,
        { agent: false },
        (res) => {
          res.resume();
          res.once('end', () =>
            resolve(res.statusCode === 200 ? 'trusted' : `http-${res.statusCode}`),
          );
          res.once('error', reject);
        },
      );
      request.setTimeout(3_000, () => request.destroy(new Error('TLS fixture request timed out')));
      request.once('error', (error) => {
        if (verificationErrors.has(error.code)) resolve('untrusted');
        else reject(error);
      });
    });
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
}

async function trustFixture(mode) {
  assert.notEqual(process.env.NODE_TLS_REJECT_UNAUTHORIZED, '0');
  assert.equal(
    await requestFixture('a'),
    mode === 'trusted' ? 'trusted' : 'untrusted',
    'The image must use SSL_CERT_FILE as its default trust store',
  );
  assert.equal(await requestFixture('b'), 'untrusted', 'An unrelated CA must remain untrusted');
  console.log(`CA TLS policy ok: ${mode} store`);
}

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    timeout: 30_000,
    killSignal: 'SIGKILL',
    stdio: 'pipe',
    ...options,
  });
}

function makeFixtures(directory) {
  mkdirSync(join(directory, 'empty-certs'));
  writeFileSync(join(directory, 'empty.pem'), '');
  writeFileSync(
    join(directory, 'leaf.ext'),
    'basicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature,keyEncipherment\n' +
      'extendedKeyUsage=serverAuth\nsubjectAltName=DNS:localhost,IP:127.0.0.1\n',
  );
  for (const name of ['a', 'b']) {
    const file = (suffix) => join(directory, `${name}.${suffix}`);
    run('openssl', [
      'req',
      '-x509',
      '-newkey',
      'rsa:2048',
      '-nodes',
      '-sha256',
      '-days',
      '1',
      '-subj',
      `/CN=Void CA smoke ${name}`,
      '-keyout',
      file('ca.key'),
      '-out',
      file('ca.pem'),
      '-addext',
      'basicConstraints=critical,CA:TRUE',
      '-addext',
      'keyUsage=critical,keyCertSign,cRLSign',
    ]);
    run('openssl', [
      'req',
      '-new',
      '-newkey',
      'rsa:2048',
      '-nodes',
      '-sha256',
      '-subj',
      '/CN=localhost',
      '-keyout',
      file('key'),
      '-out',
      file('csr'),
    ]);
    run('openssl', [
      'x509',
      '-req',
      '-in',
      file('csr'),
      '-CA',
      file('ca.pem'),
      '-CAkey',
      file('ca.key'),
      '-set_serial',
      name === 'a' ? '1' : '2',
      '-days',
      '1',
      '-sha256',
      '-extfile',
      join(directory, 'leaf.ext'),
      '-out',
      file('pem'),
    ]);
    writeFileSync(
      file('chain'),
      readFileSync(file('pem'), 'utf8') + readFileSync(file('ca.pem'), 'utf8'),
    );
    // The image runs as nonroot. These are ephemeral test keys, never real secrets.
    chmodSync(file('key'), 0o644);
    rmSync(file('ca.key'));
    rmSync(file('csr'));
  }
  chmodSync(directory, 0o755);
}

function host(image) {
  assert.ok(image && !image.startsWith('-'), 'Usage: node smoke-image-ca.mjs <image-ref>');
  const directory = mkdtempSync(join(tmpdir(), 'void-image-ca-'));
  const names = [];
  try {
    makeFixtures(directory);
    for (const mode of ['inventory', 'trusted', 'empty']) {
      const name = `void-ca-smoke-${process.pid}-${mode}`;
      names.push(name);
      const environment =
        mode === 'inventory'
          ? []
          : [
              '-e',
              `SSL_CERT_FILE=${fixtureMount}/${mode === 'trusted' ? 'a.ca.pem' : 'empty.pem'}`,
              '-e',
              `SSL_CERT_DIR=${fixtureMount}/empty-certs`,
            ];
      run(
        'docker',
        [
          'run',
          '--rm',
          '--name',
          name,
          '--network',
          'none',
          '--read-only',
          '--mount',
          `type=bind,src=${directory},dst=${fixtureMount},readonly`,
          ...environment,
          image,
          insideScript,
          '--inside',
          mode,
        ],
        { stdio: 'inherit' },
      );
    }
  } finally {
    for (const name of names) {
      try {
        run('docker', ['rm', '-f', name]);
      } catch {
        /* --rm already removed it. */
      }
    }
    rmSync(directory, { recursive: true, force: true });
  }
}

try {
  if (process.argv[2] === '--inside') {
    const mode = process.argv[3];
    assert.ok(['inventory', 'trusted', 'empty'].includes(mode), 'Unknown CA smoke mode');
    if (mode === 'inventory') inventory();
    else await trustFixture(mode);
  } else {
    host(process.argv[2]);
  }
} catch (error) {
  console.error(`::error::CA smoke failed: ${error.message}`);
  process.exitCode = 1;
}
