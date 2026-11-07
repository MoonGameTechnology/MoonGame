// SEC-43: install Debian's fixed zlib1g in a build stage while distroless's own snapshot
// is behind (it still ships 1:1.3.dfsg+really1.3.1-1+b1). Same scheme as SEC-42's
// libssl3t64: apt fetches exactly the pinned version and refuses it unless it matches
// Debian's signed index; the package identity is re-checked here before extraction.
// Only package data and its inventory enter the runtime.
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

export const ZLIB = { package: 'zlib1g', version: '1:1.3.dfsg+really1.3.1-1+deb13u1' };

export function stageZlib(archive, output, pin) {
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
    throw new Error('zlib1g package identity does not match the runtime pin');
  }
  if (existsSync(output)) throw new Error('Runtime layer output must not already exist');

  const controls = mkdtempSync(join(tmpdir(), 'void-zlib-control-'));
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
    throw new Error('Usage: node deploy/runtime/prepare-zlib.mjs <new-output-directory>');
  const architecture = execFileSync('dpkg', ['--print-architecture'], { encoding: 'utf8' }).trim();
  const pin = { ...ZLIB, architecture };
  const work = mkdtempSync(join(tmpdir(), 'void-zlib-download-'));
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
    stageZlib(archive, output, pin);
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
