import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { it, expect } from 'vitest';

// Import the actual build script through Node, as .mjs sits outside TS project roots.
const run = (source: string) =>
  execFileSync(process.execPath, ['--input-type=module', '-e', source], {
    encoding: 'utf8',
    stdio: 'pipe',
  });
it('rejects incomplete release settings and escaping/rollback inputs', () => {
  const config = {
    commerceMode: 'disabled',
    appId: 'org.moongame.rustore',
    versionCode: 2,
    previousVersionCode: 1,
    versionName: '1.0',
    server: 'https://game.example.org',
    privacyUrl: 'https://game.example.org/privacy.txt',
    policySha256: 'a'.repeat(64),
    certificateSha256: 'b'.repeat(64),
    privacyEvidenceSha256: 'c'.repeat(64),
    erasureRestoreDrillSha256: 'd'.repeat(64),
    approvedBy: 'Release reviewer',
    reviewedAt: new Date().toISOString(),
  };
  const invoke = (c: object) =>
    run(
      `import {validateRelease} from './mobile/rustore-config.mjs'; validateRelease(${JSON.stringify(c)});`,
    );
  expect(() => invoke(config)).not.toThrow();
  for (const patch of [
    { commerceMode: 'enabled' },
    { commerceMode: undefined },
    { versionCode: 1 },
    { appId: 'com.voiddominion.player' },
    { server: 'http://game.example.org' },
    { server: 'https://secret@game.example.org' },
    { versionName: '1"\ncode' },
    { reviewedAt: '2020-01-01' },
    { approvedBy: '' },
    { certificateSha256: '' },
  ])
    expect(() => invoke({ ...config, ...patch })).toThrow();
  expect(() => invoke({})).toThrow();
});
it('bundles reviewed policy as inert text and rejects placeholders/hash mismatch', () => {
  const text = 'Политика оператора. '.repeat(40) + '<script>alert(1)</script>';
  const hash = createHash('sha256').update(text).digest('hex');
  const result = run(
    `import {policyDocument} from './mobile/rustore-config.mjs'; console.log(policyDocument(${JSON.stringify(text)}, '${hash}'));`,
  );
  const unfinished = text + '[ЗАПОЛНИТЬ: оператор]';
  const unfinishedHash = createHash('sha256').update(unfinished).digest('hex');
  expect(() => run(`import {policyDocument} from './mobile/rustore-config.mjs'; policyDocument(${JSON.stringify(unfinished)}, '${unfinishedHash}');`)).toThrow();
  expect(result).toContain('&lt;script&gt;');
  expect(result).toContain("default-src 'none'");
  expect(result).not.toContain('<script>');
  expect(() =>
    run(
      `import {policyDocument} from './mobile/rustore-config.mjs'; policyDocument(${JSON.stringify(text)}, '${'f'.repeat(64)}');`,
    ),
  ).toThrow();
});

it('verifies a player bundle larger than the default child-process output buffer', () => {
  const dir = mkdtempSync(join(tmpdir(), 'rustore-apk-'));
  const bin = join(dir, 'bin'); mkdirSync(bin);
  const cert = 'b'.repeat(64);
  const policy = 'Синтетическая политика для проверки сборки. '.repeat(30);
  const policyHash = createHash('sha256').update(policy).digest('hex');
  const policyHtml = run(`import {policyDocument} from './mobile/rustore-config.mjs'; process.stdout.write(policyDocument(${JSON.stringify(policy)}, '${policyHash}'));`);
  const config = {
    commerceMode: 'disabled', appId: 'org.moongame.rustore', versionCode: 2, previousVersionCode: 1,
    versionName: '1.0', server: 'https://game.example.org', privacyUrl: 'https://game.example.org/privacy.txt',
    policySha256: policyHash, certificateSha256: cert, privacyEvidenceSha256: 'c'.repeat(64),
    erasureRestoreDrillSha256: 'd'.repeat(64), approvedBy: 'Release reviewer', reviewedAt: new Date().toISOString(),
  };
  const script = (name: string, source: string): string => {
    const path = join(bin, name);
    writeFileSync(path, '#!/usr/bin/env node\n' + source, { mode: 0o700 }); return path;
  };
  const aapt = script('aapt', `const kind=process.argv[3]; console.log(kind==='badging' ? "package: name='org.moongame.rustore' versionCode='2' versionName='1.0'" : kind==='permissions' ? "uses-permission: name='android.permission.INTERNET'" : ['debuggable','allowBackup','usesCleartextTraffic'].map(n=>'android:'+n+'=(type 0x12)0x0').join('\\n'));`);
  const signer = script('apksigner', `console.log('Signer #1 certificate SHA-256 digest: ${cert}');`);
  script('unzip', `process.stdout.write(process.argv[4].endsWith('index.html') ? 'x'.repeat(20*1024*1024)+'"channel":"rustore","privacyUrl":"privacy.html"' : process.argv[4].endsWith('capacitor.config.json') ? JSON.stringify({appId:'org.moongame.rustore',webDir:'www',server:{androidScheme:process.env.RUSTORE_FIXTURE_INSECURE?'http':'https',cleartext:!!process.env.RUSTORE_FIXTURE_INSECURE}}) : ${JSON.stringify(policyHtml)});`);
  const apk = join(dir, 'candidate.apk'); const configFile = join(dir, 'config.json');
  writeFileSync(apk, 'synthetic APK fixture'); writeFileSync(configFile, JSON.stringify(config));
  try {
    execFileSync(process.execPath, ['mobile/verify-rustore.mjs', apk], { env: {
      ...process.env, PATH: `${bin}:${process.env.PATH}`, AAPT: aapt, APKSIGNER: signer, RUSTORE_CONFIG_FILE: configFile,
    }, stdio: 'pipe' });
    expect(JSON.parse(readFileSync(apk + '.verification.json', 'utf8'))).toMatchObject({ certificateSha256: cert, versionCode: 2 });
    expect(() => execFileSync(process.execPath, ['mobile/verify-rustore.mjs', apk], { env: {
      ...process.env, PATH: `${bin}:${process.env.PATH}`, AAPT: aapt, APKSIGNER: signer, RUSTORE_CONFIG_FILE: configFile,
      RUSTORE_FIXTURE_INSECURE: '1',
    }, stdio: 'pipe' })).toThrow(/E_RUSTORE_WEBVIEW_CONFIG/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

it('accepts only the package-local signature receiver permission and rejects extra privileges', () => {
  const appId = 'org.moongame.rustore';
  const internal = `${appId}.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION`;
  const permissions = ['android.permission.INTERNET', internal];
  const manifest = `  E: permission (line=12)\n    A: android:name(0x01010003)="${internal}" (Raw: "${internal}")\n    A: android:protectionLevel(0x01010009)=(type 0x11)0x2\n  E: application (line=20)\n`;
  const invoke = (p: string[], m: string) => run(`import {verifyPermissions} from './mobile/rustore-config.mjs'; verifyPermissions(${JSON.stringify(p)}, ${JSON.stringify(m)}, '${appId}');`);
  expect(() => invoke(permissions, manifest)).not.toThrow();
  expect(() => invoke([...permissions, 'android.permission.REQUEST_INSTALL_PACKAGES'], manifest)).toThrow();
  expect(() => invoke(permissions, '')).toThrow();
  expect(() => invoke(permissions, manifest.replace('0x2\n', '0x0\n'))).toThrow();
  expect(() => invoke(permissions, manifest.replaceAll(appId, 'org.foreign.application'))).toThrow();
  expect(() => invoke(permissions, manifest + manifest)).toThrow();
});

it('rejects a packaged policy whose text or surrounding markup changed after preparation', () => {
  const text = 'Синтетическая политика оператора. '.repeat(30) + '&amp; <script>test</script>';
  const hash = createHash('sha256').update(text).digest('hex');
  const html = run(`import {policyDocument} from './mobile/rustore-config.mjs'; process.stdout.write(policyDocument(${JSON.stringify(text)}, '${hash}'));`);
  const verify = (value: string) => run(`import {verifyPolicyDocument} from './mobile/rustore-config.mjs'; verifyPolicyDocument(${JSON.stringify(value)}, '${hash}');`);
  expect(() => verify(html)).not.toThrow();
  expect(() => verify(html.replace('Синтетическая', 'Изменённая'))).toThrow();
  expect(() => verify(html + '<script>extra()</script>')).toThrow();
});
