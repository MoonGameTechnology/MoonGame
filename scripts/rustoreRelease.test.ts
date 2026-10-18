import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { it, expect } from 'vitest';

// Import the actual build script through Node, as .mjs sits outside TS project roots.
const run = (source: string) =>
  execFileSync(process.execPath, ['--input-type=module', '-e', source], {
    encoding: 'utf8',
    stdio: 'pipe',
  });
it('rejects incomplete release settings and escaping/rollback inputs', () => {
  const config = {
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
