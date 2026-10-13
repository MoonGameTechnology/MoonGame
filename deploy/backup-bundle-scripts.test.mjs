/** Signed-backup shell boundaries. PG/age here are wiring doubles; the PG drill
 * in backup.test.mjs verifies actual data and (when installed) real age. */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { execFile, spawn } from 'node:child_process';
import { once } from 'node:events';
import { promisify } from 'node:util';
import { createHash, generateKeyPairSync } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const run = promisify(execFile);
const deploy = dirname(fileURLToPath(import.meta.url));
const fixture = '-- synthetic fixture\nSELECT 42;\n-- PostgreSQL database dump complete\n';

describe('signed backup shell admission and publication', () => {
  let root, bin, env, calls, output;
  const running = new Set();
  const backup = (extra = {}) =>
    run('bash', [join(deploy, 'backup.sh')], { env: { ...env, ...extra } });
  const restore = (path, extra = {}) =>
    run('bash', [join(deploy, 'restore.sh'), path], { env: { ...env, ...extra } });
  const backups = () =>
    readdirSync(output)
      .filter((f) => f.endsWith('.vdbak'))
      .map((f) => join(output, f));
  const id = (path) => path.split('/').at(-1).slice(5, -6);
  const log = () => readFileSync(calls, 'utf8');

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'void-signed-scripts-'));
    bin = join(root, 'bin');
    mkdirSync(bin, { mode: 0o700 });
    output = join(root, 'backups');
    calls = join(root, 'calls');
    writeFileSync(calls, '');
    const keys = generateKeyPairSync('ed25519');
    const privateKey = join(root, 'sign.pem');
    const publicKey = join(root, 'verify.pem');
    writeFileSync(privateKey, keys.privateKey.export({ type: 'pkcs8', format: 'pem' }), {
      mode: 0o600,
    });
    writeFileSync(publicKey, keys.publicKey.export({ type: 'spki', format: 'pem' }), {
      mode: 0o600,
    });
    writeFileSync(join(root, 'fixture.sql'), fixture);
    writeFileSync(join(bin, 'date'), '#!/bin/bash\nprintf "20261013T040000Z\\n"\n', {
      mode: 0o700,
    });
    writeFileSync(
      join(bin, 'pg_dump'),
      '#!/bin/bash\necho dump >> "$STUB_CALLS"\ncat "$STUB_FIXTURE"\n',
      { mode: 0o700 },
    );
    writeFileSync(
      join(bin, 'psql'),
      '#!/bin/bash\necho psql >> "$STUB_CALLS"\nwhile [ $# -gt 0 ]; do if [ "$1" = -f ]; then cat "$2" > "$STUB_SQL"; exit; fi; shift; done\nexit 3\n',
      { mode: 0o700 },
    );
    writeFileSync(
      join(bin, 'age'),
      `#!/bin/bash
echo age >> "$STUB_CALLS"
mode=enc; out=; inp=
while [ $# -gt 0 ]; do
  case "$1" in
    -d) mode=dec ;;
    -r|-i) shift ;;
    -o) out="$2"; shift ;;
    *) inp="$1" ;;
  esac
  shift
done
if [ "$mode" = enc ]; then { printf 'age-encryption.org/v1\\n'; cat "$inp"; } > "$out"
else tail -n +2 "$inp" > "$out"; fi
`,
      { mode: 0o700 },
    );
    env = {
      ...process.env,
      PATH: `${bin}:${process.env.PATH}`,
      DATABASE_URL: 'postgres://fixture@localhost/isolated',
      BACKUP_FORMAT: 'bundle-v1',
      BACKUP_DIR: output,
      BACKUP_KEEP_DAYS: '14',
      BACKUP_DOMAIN: 'game',
      BACKUP_PRODUCER: 'nightly-job',
      BACKUP_AGE_RECIPIENT: 'age1wiringdouble',
      BACKUP_AGE_IDENTITY: join(root, 'offline.key'),
      BACKUP_SIGNING_KEY: privateKey,
      BACKUP_VERIFY_KEY: publicKey,
      BACKUP_EXPECT_DOMAIN: 'game',
      BACKUP_EXPECT_PRODUCER: 'nightly-job',
      BACKUP_ID: '',
      BACKUP_EXPECT_ID: '',
      BACKUP_REQUIRE_SIGNED: '1',
      BACKUP_PLAINTEXT: '0',
      VOID_RESTORE_UNVERIFIED: '0',
      STUB_CALLS: calls,
      STUB_FIXTURE: join(root, 'fixture.sql'),
      STUB_SQL: join(root, 'restored.sql'),
    };
  });
  afterEach(async () => {
    for (const child of running) {
      if (child.exitCode === null && child.signalCode === null) {
        const exited = once(child, 'exit');
        process.kill(-child.pid, 'SIGKILL');
        await exited;
      }
    }
    running.clear();
    rmSync(root, { recursive: true, force: true });
  });

  it('publishes distinct complete bundles under concurrent same-second jobs and restores the selected one', async () => {
    await Promise.all([backup(), backup()]);
    const files = backups();
    expect(files).toHaveLength(2);
    expect(readdirSync(output).filter((name) => name !== '.backup.lock')).toHaveLength(2);
    await restore(files[0], { BACKUP_EXPECT_ID: id(files[0]) });
    expect(readFileSync(join(root, 'restored.sql'), 'utf8')).toContain(fixture);
    expect(
      log()
        .split('\n')
        .filter((s) => s === 'psql'),
    ).toHaveLength(1);
  });

  it.each([
    { BACKUP_FORMAT: 'typo' },
    { BACKUP_SIGNING_KEY: '' },
    { BACKUP_DOMAIN: '' },
    { BACKUP_PRODUCER: '' },
    { BACKUP_AGE_RECIPIENT: '', BACKUP_PLAINTEXT: '1' },
    { BACKUP_ID: '../wrong' },
  ])('rejects producer configuration before dumping: %j', async (extra) => {
    await expect(backup(extra)).rejects.toThrow();
    expect(log()).toBe('');
  });

  it('rejects an invalid signing key before dumping, without exposing its contents', async () => {
    writeFileSync(env.BACKUP_SIGNING_KEY, 'PRIVATE-KEY-CANARY');
    const error = await backup().catch((e) => e);
    expect(error.code).not.toBe(0);
    expect(`${error.stdout}${error.stderr}`).not.toContain('PRIVATE-KEY-CANARY');
    expect(log()).toBe('');
  });

  it('a persisted job ID is reported before publication and can never replace an earlier copy', async () => {
    const backupId = 'cf5fdb3f-31b7-4019-bc9f-e25a8d118771';
    const { stdout } = await backup({ BACKUP_ID: backupId });
    expect(stdout).toContain(`backupId=${backupId}`);
    const [file] = backups();
    const before = readFileSync(file);
    await expect(backup({ BACKUP_ID: backupId })).rejects.toThrow(/E_BACKUP_EXISTS/);
    expect(readFileSync(file)).toEqual(before);
    expect(backups()).toEqual([file]);
  });

  it('reclaims a killed job on restart while preserving live jobs and ready backups', async () => {
    mkdirSync(output, { mode: 0o700 });
    const ready = join(output, 'void-preserved.vdbak');
    writeFileSync(ready, 'ready backup sentinel');
    const marker = join(root, 'dump-started');
    writeFileSync(
      join(bin, 'pg_dump'),
      `#!/bin/bash
cat "$STUB_FIXTURE"
if [ "\${STUB_BLOCK_DUMP:-0}" = 1 ]; then
  touch "$STUB_MARKER"
  exec sleep 30
fi
`,
      { mode: 0o700 },
    );
    const child = spawn('bash', [join(deploy, 'backup.sh')], {
      detached: true,
      env: { ...env, STUB_BLOCK_DUMP: '1', STUB_MARKER: marker },
      stdio: 'ignore',
    });
    running.add(child);
    const exited = once(child, 'exit');
    await expect.poll(() => existsSync(marker), { timeout: 4000 }).toBe(true);
    const work = readdirSync(output).find((name) => name.startsWith('.bundle-job-'));
    expect(work).toBeTruthy();
    const cleanup = () =>
      run(process.execPath, [join(deploy, 'backup-bundle.mjs'), 'cleanup', output]);
    const busy = JSON.parse((await cleanup()).stdout);
    expect(busy.skipped).toBe(true);
    expect(existsSync(join(output, work))).toBe(true);
    process.kill(-child.pid, 'SIGKILL');
    await exited;
    running.delete(child);

    // A normal restart reclaims the abandoned plaintext job directory before dump.
    const { stdout } = await backup();
    expect(existsSync(join(output, work))).toBe(false);
    expect(readFileSync(ready, 'utf8')).toBe('ready backup sentinel');
    expect(readdirSync(output).some((name) => name.startsWith('.bundle-job-'))).toBe(false);
    const receipt = JSON.parse(stdout.split('\n').find((line) => line.startsWith('{')));
    await restore(receipt.path, { BACKUP_EXPECT_ID: receipt.backupId });
    expect(readFileSync(join(root, 'restored.sql'), 'utf8')).toContain(fixture);
  }, 15_000);

  it.each([
    { BACKUP_EXPECT_DOMAIN: 'corp' },
    { BACKUP_EXPECT_PRODUCER: 'other-job' },
    { BACKUP_EXPECT_ID: 'f93a2b66-c114-47bc-8cd4-0c6b181b89dd' },
    { BACKUP_EXPECT_ID: '' },
    { BACKUP_VERIFY_KEY: '' },
    { BACKUP_REQUIRE_SIGNED: 'typo' },
  ])('rejects wrong restore authority before age/psql: %j', async (extra) => {
    await backup();
    const [file] = backups();
    writeFileSync(calls, '');
    await expect(restore(file, { BACKUP_EXPECT_ID: id(file), ...extra })).rejects.toThrow();
    expect(log()).toBe('');
  });

  it('rejects payload tampering before age/psql even when legacy bypass is set', async () => {
    await backup();
    const [file] = backups();
    const bytes = readFileSync(file);
    bytes[bytes.length - 1] ^= 1;
    writeFileSync(file, bytes);
    writeFileSync(calls, '');
    await expect(
      restore(file, { BACKUP_EXPECT_ID: id(file), VOID_RESTORE_UNVERIFIED: '1' }),
    ).rejects.toThrow();
    expect(log()).toBe('');
  });

  it.each([{ BACKUP_REQUIRE_SIGNED: '1', BACKUP_VERIFY_KEY: '' }, { BACKUP_REQUIRE_SIGNED: '0' }])(
    'rejects legacy downgrade by policy or configured verification key: %j',
    async (extra) => {
      await backup({ BACKUP_FORMAT: 'legacy' });
      const file = join(
        output,
        readdirSync(output).find((f) => f.endsWith('.age')),
      );
      writeFileSync(calls, '');
      await expect(restore(file, { ...extra, VOID_RESTORE_UNVERIFIED: '1' })).rejects.toThrow();
      expect(log()).toBe('');
    },
  );

  it('legacy checksum cannot validate a different file before restoring altered SQL', async () => {
    await backup({ BACKUP_FORMAT: 'legacy', BACKUP_AGE_RECIPIENT: '', BACKUP_PLAINTEXT: '1' });
    const file = join(
      output,
      readdirSync(output).find((f) => f.endsWith('.sql.gz')),
    );
    const original = readFileSync(file);
    writeFileSync(join(output, 'unrelated.sql.gz'), original);
    writeFileSync(file, gzipSync('SELECT 13;\n-- PostgreSQL database dump complete\n'));
    writeFileSync(
      `${file}.sha256`,
      `${createHash('sha256').update(original).digest('hex')}  unrelated.sql.gz\n`,
    );
    writeFileSync(calls, '');
    await expect(
      restore(file, { BACKUP_VERIFY_KEY: '', BACKUP_REQUIRE_SIGNED: '0' }),
    ).rejects.toThrow(/Контрольная сумма/);
    expect(log()).toBe('');
  });
});
