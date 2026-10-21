import { execFileSync } from 'node:child_process';
import { X509Certificate } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, expect, it } from 'vitest';
import { CA_CERTIFICATES, DISTRUSTED_CA_SHA256, stageCaCertificates } from './prepare-ca.mjs';

let fixture;
let work;
let pkg;
let archive;
let roots;
const certificates = [];

beforeAll(() => {
  fixture = mkdtempSync(join(tmpdir(), 'void-ca-fixture-'));
  for (const name of ['A', 'B']) {
    const cert = join(fixture, `${name}.crt`);
    execFileSync(
      'openssl',
      [
        'req',
        '-x509',
        '-newkey',
        'ec',
        '-pkeyopt',
        'ec_paramgen_curve:P-256',
        '-nodes',
        '-keyout',
        join(fixture, `${name}.key`),
        '-out',
        cert,
        '-days',
        '1',
        '-subj',
        `/CN=Runtime test CA ${name}`,
        '-addext',
        'basicConstraints=critical,CA:TRUE',
      ],
      { stdio: 'pipe' },
    );
    certificates.push(readFileSync(cert, 'utf8'));
  }
});
afterAll(() => rmSync(fixture, { recursive: true, force: true }));

function pack(overrides = {}) {
  const control = {
    Package: CA_CERTIFICATES.package,
    Version: CA_CERTIFICATES.version,
    Architecture: 'all',
    Maintainer: 'Test <test@example.invalid>',
    Description: 'inert fixture',
    ...overrides,
  };
  writeFileSync(
    join(pkg, 'DEBIAN/control'),
    Object.entries(control)
      .map(([k, v]) => `${k}: ${v}\n`)
      .join(''),
  );
  execFileSync('dpkg-deb', ['--build', pkg, archive], { stdio: 'pipe' });
}

beforeEach(() => {
  work = mkdtempSync(join(tmpdir(), 'void-ca-test-'));
  pkg = join(work, 'package');
  roots = join(pkg, 'usr/share/ca-certificates/mozilla');
  archive = join(work, 'ca-certificates.deb');
  mkdirSync(roots, { recursive: true });
  mkdirSync(join(pkg, 'DEBIAN'));
  writeFileSync(join(pkg, 'DEBIAN/postinst'), '#!/bin/sh\nexit 99\n', { mode: 0o755 });
  writeFileSync(join(pkg, 'DEBIAN/md5sums'), 'fixture package inventory\n');
  writeFileSync(join(roots, 'B.crt'), certificates[1]);
  writeFileSync(join(roots, 'A.crt'), certificates[0]);
  // Installer code and non-Mozilla/local roots must not enter the runtime.
  mkdirSync(join(pkg, 'usr/sbin'), { recursive: true });
  writeFileSync(join(pkg, 'usr/sbin/update-ca-certificates'), '#!/bin/sh\nexit 99\n');
  mkdirSync(join(pkg, 'usr/local/share/ca-certificates'), { recursive: true });
  writeFileSync(join(pkg, 'usr/local/share/ca-certificates/local.crt'), 'not a trusted root');
  pack();
});
afterEach(() => rmSync(work, { recursive: true, force: true }));

it('rebuilds the bundle solely from authenticated Mozilla roots and replaces package inventory', () => {
  const output = join(work, 'runtime');
  stageCaCertificates(archive, output);
  expect(readFileSync(join(output, 'etc/ssl/certs/ca-certificates.crt'), 'utf8')).toBe(
    certificates.map((pem) => `${pem.trim()}\n`).join(''),
  );
  const inventory = join(output, 'var/lib/dpkg/status.d');
  expect(readFileSync(join(inventory, 'ca-certificates'), 'utf8')).toContain(
    `Version: ${CA_CERTIFICATES.version}`,
  );
  expect(readFileSync(join(inventory, 'ca-certificates'), 'utf8')).toContain(
    'Status: install ok installed',
  );
  expect(readFileSync(join(inventory, 'ca-certificates.md5sums'), 'utf8')).toBe(
    'fixture package inventory\n',
  );
  expect(existsSync(join(output, 'usr'))).toBe(false);
  expect(existsSync(join(output, 'DEBIAN'))).toBe(false);
});

it.each([{ Package: 'another-package' }, { Version: '20250419' }, { Architecture: 'amd64' }])(
  'rejects wrong package identity before writing a runtime layer: %j',
  (overrides) => {
    pack(overrides);
    const output = join(work, 'runtime');
    expect(() => stageCaCertificates(archive, output)).toThrow('identity');
    expect(existsSync(output)).toBe(false);
  },
);

it('rejects an authentic distrusted root even if archive metadata claims the fixed version', () => {
  // Public root certificate, not a secret or private key; retained as a regression fixture.
  const revoked = readFileSync(
    new URL('./fixtures/emsign-ecc-root-g3.pem', import.meta.url),
    'utf8',
  );
  expect(DISTRUSTED_CA_SHA256).toContain(new X509Certificate(revoked).fingerprint256);
  writeFileSync(join(roots, 'revoked.crt'), revoked);
  pack();
  const output = join(work, 'runtime');
  expect(() => stageCaCertificates(archive, output)).toThrow('distrusted');
  expect(existsSync(output)).toBe(false);
});

it.each(['empty', 'invalid', 'duplicate', 'multiple'])('rejects a %s certificate set', (kind) => {
  if (kind === 'empty') {
    rmSync(roots, { recursive: true });
    mkdirSync(roots);
  } else {
    const pem =
      kind === 'invalid'
        ? 'invalid certificate'
        : kind === 'multiple'
          ? certificates.join('')
          : certificates[0];
    writeFileSync(join(roots, 'bad.crt'), pem);
  }
  pack();
  const output = join(work, 'runtime');
  expect(() => stageCaCertificates(archive, output)).toThrow();
  expect(existsSync(output)).toBe(false);
});

it('refuses an existing output directory without modifying it', () => {
  const output = join(work, 'runtime');
  mkdirSync(output);
  writeFileSync(join(output, 'keep'), 'existing work');
  expect(() => stageCaCertificates(archive, output)).toThrow('already exist');
  expect(readFileSync(join(output, 'keep'), 'utf8')).toBe('existing work');
  expect(existsSync(join(output, 'etc'))).toBe(false);
});
