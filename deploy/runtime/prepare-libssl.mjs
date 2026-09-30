// SEC-42: install Debian's fixed libssl3t64 in a build stage while distroless's own
// snapshot is behind. Only package data and its inventory enter the runtime.
//
// Unlike SEC-39's libc6, the archive is not pinned by a hash kept in the repo: apt fetches
// exactly the pinned version and refuses it unless it matches Debian's signed index,
// checked with the archive keyring of the digest-pinned builder image. The package
// identity is then re-checked here before anything is extracted.
import { createHash } from 'node:crypto';
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

export const LIBSSL = { package: 'libssl3t64', version: '3.5.7-1~deb13u3' };

export function stageLibssl(archive, output, pin) {
  const control = execFileSync('dpkg-deb', ['--field', archive], { encoding: 'utf8' });
  const field = (name) =>
    control
      .split('\n')
      .find((line) => line.startsWith(`${name}: `))
      ?.slice(name.length + 2);
  if (
    field('Package') !== pin.package ||
    field('Version') !== pin.version ||
    field('Architecture') !== pin.architecture
  ) {
    throw new Error('libssl3t64 package identity does not match the runtime pin');
  }
  if (existsSync(output)) throw new Error('Runtime layer output must not already exist');

  const controls = mkdtempSync(join(tmpdir(), 'void-libssl-control-'));
  try {
    // Extracting package data does not execute preinst/postinst or ship dpkg/apt.
    execFileSync('dpkg-deb', ['--control', archive, controls]);
    mkdirSync(output, { recursive: true });
    execFileSync('dpkg-deb', ['--extract', archive, output]);
    // Same file names as the base's own entry, so the overlay replaces it.
    const inventory = join(output, 'var/lib/dpkg/status.d');
    mkdirSync(inventory, { recursive: true });
    writeFileSync(
      join(inventory, pin.package),
      `${control.trimEnd()}\nStatus: install ok installed\n`,
    );
    writeFileSync(
      join(inventory, `${pin.package}.md5sums`),
      readFileSync(join(controls, 'md5sums')),
    );
  } finally {
    rmSync(controls, { recursive: true, force: true });
  }
}

function main() {
  const output = process.argv[2];
  if (!output)
    throw new Error('Usage: node deploy/runtime/prepare-libssl.mjs <new-output-directory>');
  const architecture = execFileSync('dpkg', ['--print-architecture'], { encoding: 'utf8' }).trim();
  const pin = { ...LIBSSL, architecture };
  const work = mkdtempSync(join(tmpdir(), 'void-libssl-download-'));
  try {
    // apt downloads as its unprivileged `_apt` user, which needs to own the target.
    execFileSync('chown', ['_apt', work]);
    execFileSync('apt-get', ['update'], { stdio: 'inherit' });
    execFileSync(
      'apt-get',
      ['-o', 'APT::Get::AllowUnauthenticated=false', 'download', `${pin.package}=${pin.version}`],
      { cwd: work, stdio: 'inherit' },
    );
    const archives = readdirSync(work).filter((name) => name.endsWith('.deb'));
    if (archives.length !== 1) throw new Error('apt-get download must leave exactly one archive');
    const archive = join(work, archives[0]);
    stageLibssl(archive, output, pin);
    const sha256 = createHash('sha256').update(readFileSync(archive)).digest('hex');
    console.log(`Verified ${pin.package} ${pin.version} (${architecture}), SHA-256 ${sha256}`);
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
