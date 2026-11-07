import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { ZLIB, stageZlib } from './prepare-zlib.mjs';

let work;
let archive;
const pin = {
  package: 'zlib1g',
  version: '1:1.3.dfsg+really1.3.1-1+deb13u1',
  architecture: 'amd64',
};

beforeEach(() => {
  work = mkdtempSync(join(tmpdir(), 'void-zlib-test-'));
  const pkg = join(work, 'package');
  mkdirSync(join(pkg, 'DEBIAN'), { recursive: true });
  mkdirSync(join(pkg, 'usr/lib/x86_64-linux-gnu'), { recursive: true });
  writeFileSync(
    join(pkg, 'DEBIAN/control'),
    [
      'Package: zlib1g',
      'Version: 1:1.3.dfsg+really1.3.1-1+deb13u1',
      'Architecture: amd64',
      'Maintainer: Test <test@example.invalid>',
      'Description: inert test fixture',
      '',
    ].join('\n'),
  );
  // Package maintainer scripts must never run or end up in the runtime layer.
  writeFileSync(join(pkg, 'DEBIAN/postinst'), '#!/bin/sh\nexit 99\n', { mode: 0o755 });
  writeFileSync(join(pkg, 'usr/lib/x86_64-linux-gnu/libz.so.1'), 'patched fixture');
  writeFileSync(join(pkg, 'DEBIAN/md5sums'), 'fixture checksum inventory\n');
  archive = join(work, 'zlib1g.deb');
  execFileSync('dpkg-deb', ['--build', pkg, archive], { stdio: 'pipe' });
});

afterEach(() => rmSync(work, { recursive: true, force: true }));

it('stages the library and replaces the base inventory entry without maintainer scripts', () => {
  const output = join(work, 'runtime');
  stageZlib(archive, output, pin);
  expect(readFileSync(join(output, 'usr/lib/x86_64-linux-gnu/libz.so.1'), 'utf8')).toBe(
    'patched fixture',
  );
  // distroless keeps this package as status.d/zlib1g — the same name overwrites it.
  const status = readFileSync(join(output, 'var/lib/dpkg/status.d/zlib1g'), 'utf8');
  expect(status).toContain('Version: 1:1.3.dfsg+really1.3.1-1+deb13u1');
  expect(status).toContain('Status: install ok installed');
  expect(readFileSync(join(output, 'var/lib/dpkg/status.d/zlib1g.md5sums'), 'utf8')).toBe(
    'fixture checksum inventory\n',
  );
  expect(existsSync(join(output, 'DEBIAN'))).toBe(false);
});

it.each(['package', 'version', 'architecture'])(
  'rejects a mismatched %s before installing any files',
  (field) => {
    const wrong = {
      package: 'zlib1g-dev',
      version: '1:1.3.dfsg+really1.3.1-1+b1',
      architecture: 'arm64',
    };
    const output = join(work, 'runtime');
    expect(() => stageZlib(archive, output, { ...pin, [field]: wrong[field] })).toThrow();
    expect(existsSync(output)).toBe(false);
  },
);

it('refuses to stage over an existing output', () => {
  const output = join(work, 'runtime');
  mkdirSync(output);
  expect(() => stageZlib(archive, output, pin)).toThrow();
  expect(existsSync(join(output, 'var'))).toBe(false);
});

it('pins the Debian revision that fixes the base image findings', () => {
  expect(ZLIB.package).toBe('zlib1g');
  execFileSync('dpkg', [
    '--compare-versions',
    ZLIB.version,
    'ge',
    '1:1.3.dfsg+really1.3.1-1+deb13u1',
  ]);
});
