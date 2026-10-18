/** Builds and verifies the real RuStore profile with synthetic facts and a disposable
 * signing key. Never a release candidate. Run from a clean mobile/ checkout with
 * JDK 21, Android SDK, openssl and unzip installed. No release secrets are read. */
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { createServer } from 'node:https';
import { existsSync, readFileSync, writeFileSync, mkdtempSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

assert.ok(!existsSync('android'), 'Use a clean mobile/ checkout: android/ already exists');
assert.ok(process.env.ANDROID_HOME, 'ANDROID_HOME is required');
const dir = mkdtempSync(join(tmpdir(), 'rustore-synthetic-'));
const originalConfig = readFileSync('capacitor.config.json');
const sha256 = value => createHash('sha256').update(value).digest('hex');
const env = Object.fromEntries(['PATH', 'HOME', 'JAVA_HOME', 'ANDROID_HOME', 'ANDROID_SDK_ROOT',
  'GRADLE_USER_HOME', 'JAVA_TOOL_OPTIONS'].filter(key => process.env[key]).map(key => [key, process.env[key]]));
env.KEYSTORE_PASSWORD = randomBytes(32).toString('hex');
env.RUSTORE_CONFIG_FILE = join(dir, 'config.json');
env.NODE_EXTRA_CA_CERTS = join(dir, 'tls.crt');
const tools = readdirSync(join(env.ANDROID_HOME, 'build-tools')).filter(name => /^\d+\.\d+\.\d+$/.test(name))
  .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
assert.ok(tools.length, 'Android build-tools are required');
const buildTools = join(env.ANDROID_HOME, 'build-tools', tools.at(-1));
env.AAPT = join(buildTools, 'aapt'); env.APKSIGNER = join(buildTools, 'apksigner');
const run = async (bin, args, cwd = '.') => {
  const child = spawn(bin, args, { cwd, env, stdio: 'inherit' });
  const timer = setTimeout(() => child.kill('SIGKILL'), 20 * 60 * 1000);
  try {
    const code = await new Promise((done, fail) => { child.once('error', fail); child.once('exit', done); });
    assert.equal(code, 0, `synthetic build step failed: ${bin}`);
  } finally { clearTimeout(timer); }
};
let server;
try {
  // No credentials in argv; generated material is scoped to the private temp dir.
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', join(dir, 'tls.key'),
    '-out', env.NODE_EXTRA_CA_CERTS, '-days', '2', '-subj', '/CN=localhost', '-addext', 'subjectAltName=DNS:localhost,IP:127.0.0.1'], { stdio: 'ignore' });
  await run('keytool', ['-genkeypair', '-keystore', join(dir, 'test.keystore'), '-alias', 'synthetic-only',
    '-storepass:env', 'KEYSTORE_PASSWORD', '-keypass:env', 'KEYSTORE_PASSWORD', '-keyalg', 'RSA', '-keysize', '3072',
    '-validity', '2', '-dname', 'CN=Synthetic Tooling Drill Only, O=Not A Release Key']);
  const cert = execFileSync('keytool', ['-exportcert', '-keystore', join(dir, 'test.keystore'), '-alias', 'synthetic-only',
    '-storepass:env', 'KEYSTORE_PASSWORD'], { env, stdio: ['ignore', 'pipe', 'ignore'] });
  const policy = 'СИНТЕТИЧЕСКИЙ СТЕНД. Документ используется только для проверки сборки. Это не политика работающей игры. '
    + 'В этой проверке нет настоящего оператора и реальных игроков. Сборка использует отдельный идентификатор приложения, локальный HTTPS-сервер и временный ключ подписи. '
    + 'Этот APK не предназначен для публикации, установки игроками или обработки их персональных данных. Сведения оператора, контакт, география хранения и сроки обработки должны быть утверждены отдельно перед выпуском. '
    + 'Проверяется только упаковка документа, его контрольная сумма и инертное отображение. Учение не является юридическим заключением и не подтверждает готовность игры к модерации.\n';
  server = createServer({ key: readFileSync(join(dir, 'tls.key')), cert: readFileSync(env.NODE_EXTRA_CA_CERTS) }, (req, res) => {
    if (req.url === '/privacy.txt') { res.setHeader('Content-Type', 'text/plain; charset=utf-8'); res.end(policy); }
    else if (req.url === '/auth/status') { res.setHeader('Content-Type', 'application/json'); res.end('{"enabled":true,"accountDeletion":true}'); }
    else { res.statusCode = 404; res.end(); }
  });
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  const origin = `https://localhost:${server.address().port}`;
  const config = { commerceMode: 'disabled', appId: 'com.voiddominion.syntheticdrill', versionCode: 1,
    previousVersionCode: 0, versionName: '0.0.1-drill', server: origin, privacyUrl: origin + '/privacy.txt',
    policySha256: sha256(policy), certificateSha256: sha256(cert),
    privacyEvidenceSha256: sha256('Synthetic fixture; no operator approval'),
    erasureRestoreDrillSha256: sha256('Synthetic packaging fixture; no production erasure approval'),
    approvedBy: 'Automated synthetic tooling drill; NOT RELEASE APPROVAL', reviewedAt: new Date().toISOString() };
  writeFileSync(env.RUSTORE_CONFIG_FILE, JSON.stringify(config), { mode: 0o600 });
  await run('node', ['prepare-rustore.mjs']);
  await run('npx', ['--no-install', 'cap', 'add', 'android']);
  await run('npx', ['--no-install', 'cap', 'sync', 'android']);
  await run('npm', ['run', 'assets']);
  await run('node', ['patch-android.mjs']);
  await run('node', ['patch-rustore.mjs']);
  await run('./gradlew', ['assembleRelease', '--no-daemon', '--max-workers=2', '-Dorg.gradle.jvmargs=-Xmx1536m'], 'android');
  const aligned = join(dir, 'aligned.apk'), apk = join(dir, 'synthetic.apk');
  await run(join(buildTools, 'zipalign'), ['-P', '16', '-f', '4', 'android/app/build/outputs/apk/release/app-release-unsigned.apk', aligned]);
  await run(env.APKSIGNER, ['sign', '--ks', join(dir, 'test.keystore'), '--ks-key-alias', 'synthetic-only',
    '--ks-pass', 'env:KEYSTORE_PASSWORD', '--key-pass', 'env:KEYSTORE_PASSWORD', '--out', apk, aligned]);
  await run(join(buildTools, 'zipalign'), ['-c', '-P', '16', '4', apk]);
  await run('node', ['verify-rustore.mjs', apk]);
  const verification = JSON.parse(readFileSync(apk + '.verification.json'));
  mkdirSync('dist', { recursive: true });
  writeFileSync('dist/rustore-smoke.json', JSON.stringify({ syntheticOnly: true, releaseApproval: false,
    sourceSha: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), ...verification }, null, 2));
} finally {
  server?.close();
  writeFileSync('capacitor.config.json', originalConfig);
  rmSync(dir, { recursive: true, force: true });
}
