// SEC-39: install Debian's fixed libc in a build stage while distroless's own
// snapshot is behind. Only package data and its inventory enter the runtime.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const lock = JSON.parse(readFileSync(new URL('./libc6.lock.json', import.meta.url), 'utf8'));

export function pinForArchitecture(architecture) {
  if (!Object.hasOwn(lock.packages, architecture))
    throw new Error(`Unsupported Debian architecture: ${architecture}`);
  return { ...lock.packages[architecture], architecture, version: lock.version };
}

export function stageLibc(archive, output, pin) {
  const bytes = readFileSync(archive);
  if (
    bytes.length !== pin.size ||
    createHash('sha256').update(bytes).digest('hex') !== pin.sha256
  ) {
    throw new Error('libc6 archive size or SHA-256 does not match the reviewed Debian package');
  }
  const control = execFileSync('dpkg-deb', ['--field', archive], { encoding: 'utf8' });
  const field = (name) =>
    control
      .split('\n')
      .find((line) => line.startsWith(`${name}: `))
      ?.slice(name.length + 2);
  if (
    field('Package') !== 'libc6' ||
    field('Version') !== pin.version ||
    field('Architecture') !== pin.architecture
  ) {
    throw new Error('libc6 package identity does not match the runtime pin');
  }
  if (existsSync(output)) throw new Error('Runtime layer output must not already exist');

  const controls = mkdtempSync(join(tmpdir(), 'void-libc-control-'));
  try {
    // Extracting package data does not execute preinst/postinst or ship dpkg/apt.
    execFileSync('dpkg-deb', ['--control', archive, controls]);
    mkdirSync(output, { recursive: true });
    execFileSync('dpkg-deb', ['--extract', archive, output]);
    const inventory = join(output, 'var/lib/dpkg/status.d');
    mkdirSync(inventory, { recursive: true });
    writeFileSync(join(inventory, 'libc6'), `${control.trimEnd()}\nStatus: install ok installed\n`);
    writeFileSync(join(inventory, 'libc6.md5sums'), readFileSync(join(controls, 'md5sums')));
  } finally {
    rmSync(controls, { recursive: true, force: true });
  }
}

async function main() {
  const output = process.argv[2];
  if (!output)
    throw new Error('Usage: node deploy/runtime/prepare-libc.mjs <new-output-directory>');
  const architecture = execFileSync('dpkg', ['--print-architecture'], { encoding: 'utf8' }).trim();
  const pin = pinForArchitecture(architecture);
  const url = `https://deb.debian.org/debian/pool/main/g/glibc/libc6_${pin.version}_${architecture}.deb`;
  const work = mkdtempSync(join(tmpdir(), 'void-libc-download-'));
  try {
    const response = await fetch(url, { signal: globalThis.AbortSignal.timeout(60_000) });
    if (!response.ok) throw new Error(`Debian libc6 download failed: HTTP ${response.status}`);
    const archive = join(work, 'libc6.deb');
    writeFileSync(archive, Buffer.from(await response.arrayBuffer()));
    stageLibc(archive, output, pin);
    console.log(`Verified libc6 ${pin.version} (${architecture}), SHA-256 ${pin.sha256}`);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
