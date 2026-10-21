// DSA-6572-1: replace distroless's stale trust bundle with the fixed Debian roots.
// apt authenticates the pinned archive against Debian's signed index. Only the
// generated bundle and package inventory enter the runtime, never installer tools.
import { createHash, X509Certificate } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const CA_CERTIFICATES = { package: 'ca-certificates', version: '20250419+deb13u1' };
// emSign ECC Root CA - G3 and AAA Certificate Services, removed by Debian.
export const DISTRUSTED_CA_SHA256 = [
  '86:A1:EC:BA:08:9C:4A:8D:3B:BE:27:34:C6:12:BA:34:1D:81:3E:04:3C:F9:E8:A8:62:CD:5C:57:A3:6B:BE:6B',
  'D7:A7:A0:FB:5D:7E:27:31:D7:71:E9:48:4E:BC:DE:F7:1D:5F:0C:3E:0A:29:48:78:2B:C8:3E:E0:EA:69:9E:F4',
];

export function stageCaCertificates(archive, output, pin = CA_CERTIFICATES) {
  const control = execFileSync('dpkg-deb', ['--field', archive], { encoding: 'utf8' });
  const field = (name) =>
    control
      .split('\n')
      .find((line) => line.startsWith(`${name}: `))
      ?.slice(name.length + 2);
  if (
    field('Package') !== pin.package ||
    field('Version') !== pin.version ||
    field('Architecture') !== 'all'
  ) {
    throw new Error('ca-certificates package identity does not match the runtime pin');
  }
  if (existsSync(output)) throw new Error('Runtime layer output must not already exist');

  const work = mkdtempSync(join(tmpdir(), 'void-ca-extract-'));
  try {
    const payload = join(work, 'payload');
    const controls = join(work, 'control');
    execFileSync('dpkg-deb', ['--control', archive, controls]);
    execFileSync('dpkg-deb', ['--extract', archive, payload]);
    const roots = join(payload, 'usr/share/ca-certificates/mozilla');
    const files = readdirSync(roots, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith('.crt'))
      .map((entry) => entry.name)
      .sort();
    if (!files.length) throw new Error('CA archive contains no trust anchors');
    const fingerprints = new Set();
    const bundle = files
      .map((file) => {
        const pem = readFileSync(join(roots, file), 'utf8').trim();
        if ((pem.match(/-----BEGIN CERTIFICATE-----/g) ?? []).length !== 1) {
          throw new Error('CA archive entry must contain exactly one certificate');
        }
        const certificate = new X509Certificate(pem);
        if (!certificate.ca || DISTRUSTED_CA_SHA256.includes(certificate.fingerprint256)) {
          throw new Error('CA archive contains an invalid or distrusted trust anchor');
        }
        if (fingerprints.has(certificate.fingerprint256)) {
          throw new Error('CA archive contains duplicate trust anchors');
        }
        fingerprints.add(certificate.fingerprint256);
        return `${pem}\n`;
      })
      .join('');

    // Debian enables the Mozilla .crt files by default. Build only from this
    // authenticated archive: do not inherit builder/local roots or run postinst.
    // This pinned distroless base ships only this bundle, with no hashed CA links.
    const certs = join(output, 'etc/ssl/certs');
    const inventory = join(output, 'var/lib/dpkg/status.d');
    mkdirSync(certs, { recursive: true });
    mkdirSync(inventory, { recursive: true });
    writeFileSync(join(certs, 'ca-certificates.crt'), bundle);
    writeFileSync(
      join(inventory, pin.package),
      `${control.trimEnd()}\nStatus: install ok installed\n`,
    );
    writeFileSync(
      join(inventory, `${pin.package}.md5sums`),
      readFileSync(join(controls, 'md5sums')),
    );
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

function main() {
  const output = process.argv[2];
  if (!output) throw new Error('Usage: node deploy/runtime/prepare-ca.mjs <new-output-directory>');
  const work = mkdtempSync(join(tmpdir(), 'void-ca-download-'));
  try {
    execFileSync('chown', ['_apt', work]);
    execFileSync('apt-get', ['update'], { stdio: 'inherit' });
    execFileSync(
      'apt-get',
      [
        '-o',
        'APT::Get::AllowUnauthenticated=false',
        'download',
        `${CA_CERTIFICATES.package}=${CA_CERTIFICATES.version}`,
      ],
      { cwd: work, stdio: 'inherit' },
    );
    const archives = readdirSync(work).filter((name) => name.endsWith('.deb'));
    if (archives.length !== 1) throw new Error('apt-get download must leave exactly one archive');
    const archive = join(work, archives[0]);
    stageCaCertificates(archive, output);
    const sha256 = createHash('sha256').update(readFileSync(archive)).digest('hex');
    console.log(
      `Verified ${CA_CERTIFICATES.package} ${CA_CERTIFICATES.version} (all), SHA-256 ${sha256}`,
    );
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
