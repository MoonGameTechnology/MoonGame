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
  const config = {
    commerceMode: 'disabled', appId: 'org.moongame.rustore', versionCode: 2, previousVersionCode: 1,
    versionName: '1.0', server: 'https://game.example.org', privacyUrl: 'https://game.example.org/privacy.txt',
    policySha256: 'a'.repeat(64), certificateSha256: cert, privacyEvidenceSha256: 'c'.repeat(64),
    erasureRestoreDrillSha256: 'd'.repeat(64), approvedBy: 'Release reviewer', reviewedAt: new Date().toISOString(),
  };
  const script = (name: string, source: string): string => {
    const path = join(bin, name);
    writeFileSync(path, '#!/usr/bin/env node\n' + source, { mode: 0o700 }); return path;
  };
  const aapt = script('aapt', `const kind=process.argv[3]; console.log(kind==='badging' ? "package: name='org.moongame.rustore' versionCode='2' versionName='1.0'" : kind==='permissions' ? "uses-permission: name='android.permission.INTERNET'" : ['debuggable','allowBackup','usesCleartextTraffic'].map(n=>'android:'+n+'=(type 0x12)0x0').join('\\n'));`);
  const signer = script('apksigner', `console.log('Signer #1 certificate SHA-256 digest: ${cert}');`);
  script('unzip', `process.stdout.write(process.argv[4].endsWith('index.html') ? 'x'.repeat(20*1024*1024)+'"channel":"rustore","privacyUrl":"privacy.html"' : "default-src 'none'");`);
  const apk = join(dir, 'candidate.apk'); const configFile = join(dir, 'config.json');
  writeFileSync(apk, 'synthetic APK fixture'); writeFileSync(configFile, JSON.stringify(config));
  try {
    execFileSync(process.execPath, ['mobile/verify-rustore.mjs', apk], { env: {
      ...process.env, PATH: `${bin}:${process.env.PATH}`, AAPT: aapt, APKSIGNER: signer, RUSTORE_CONFIG_FILE: configFile,
    }, stdio: 'pipe' });
    expect(JSON.parse(readFileSync(apk + '.verification.json', 'utf8'))).toMatchObject({ certificateSha256: cert, versionCode: 2 });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
