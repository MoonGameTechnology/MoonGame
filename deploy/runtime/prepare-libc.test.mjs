import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { pinForArchitecture, stageLibc } from './prepare-libc.mjs';

let work;
let archive;
let pin;

beforeEach(() => {
  work = mkdtempSync(join(tmpdir(), 'void-libc-test-'));
  const pkg = join(work, 'package');
  mkdirSync(join(pkg, 'DEBIAN'), { recursive: true });
  mkdirSync(join(pkg, 'usr/lib/x86_64-linux-gnu'), { recursive: true });
  writeFileSync(
    join(pkg, 'DEBIAN/control'),
    [
      'Package: libc6',
      'Version: 2.41-12+deb13u4',
      'Architecture: amd64',
      'Maintainer: Test <test@example.invalid>',
      'Description: inert test fixture',
      '',
    ].join('\n'),
  );
  // Package maintainer scripts must never run or end up in the runtime layer.
  writeFileSync(join(pkg, 'DEBIAN/postinst'), '#!/bin/sh\nexit 99\n', { mode: 0o755 });
  writeFileSync(join(pkg, 'usr/lib/x86_64-linux-gnu/libc.so.6'), 'patched fixture');
  writeFileSync(join(pkg, 'DEBIAN/md5sums'), 'fixture checksum inventory\n');
  archive = join(work, 'libc6.deb');
  execFileSync('dpkg-deb', ['--build', pkg, archive], { stdio: 'pipe' });
  const bytes = readFileSync(archive);
  pin = {
    architecture: 'amd64',
    version: '2.41-12+deb13u4',
    size: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  };
});

afterEach(() => rmSync(work, { recursive: true, force: true }));

it('stages the verified library and its package inventory without maintainer scripts', () => {
  const output = join(work, 'runtime');
  stageLibc(archive, output, pin);
  expect(readFileSync(join(output, 'usr/lib/x86_64-linux-gnu/libc.so.6'), 'utf8')).toBe(
    'patched fixture',
  );
  const status = readFileSync(join(output, 'var/lib/dpkg/status.d/libc6'), 'utf8');
  expect(status).toContain('Version: 2.41-12+deb13u4');
  expect(status).toContain('Status: install ok installed');
  expect(readFileSync(join(output, 'var/lib/dpkg/status.d/libc6.md5sums'), 'utf8')).toBe(
    'fixture checksum inventory\n',
  );
  expect(existsSync(join(output, 'DEBIAN'))).toBe(false);
});

it.each(['sha256', 'size', 'version', 'architecture'])(
  'rejects a mismatched %s before installing any files',
  (field) => {
    const wrong = {
      sha256: '0'.repeat(64),
      size: pin.size + 1,
      version: '2.41-12+deb13u3',
      architecture: 'arm64',
    };
    const output = join(work, 'runtime');
    expect(() => stageLibc(archive, output, { ...pin, [field]: wrong[field] })).toThrow();
    expect(existsSync(output)).toBe(false);
  },
);

it('pins a fixed Debian revision for every architecture supported by the base image', () => {
  for (const architecture of ['amd64', 'arm64', 'armhf', 'ppc64el', 's390x']) {
    const actual = pinForArchitecture(architecture);
    expect(actual.architecture).toBe(architecture);
    expect(actual.sha256).toMatch(/^[a-f0-9]{64}$/);
    execFileSync('dpkg', ['--compare-versions', actual.version, 'ge', '2.41-12+deb13u4']);
  }
  expect(() => pinForArchitecture('unsupported')).toThrow();
});
