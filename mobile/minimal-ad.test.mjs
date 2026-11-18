import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { prepareProbe } from './minimal-ad/prepare.mjs';

const dirs = [];
afterEach(() => dirs.splice(0).forEach(dir => rmSync(dir, { recursive: true, force: true })));
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'vk-native-probe-'));
  dirs.push(dir);
  const wrapper = join(dir, 'wrapper');
  for (const name of ['gradlew', 'gradlew.bat', 'gradle/wrapper/gradle-wrapper.jar', 'gradle/wrapper/gradle-wrapper.properties']) {
    mkdirSync(dirname(join(wrapper, name)), { recursive: true });
    writeFileSync(join(wrapper, name), 'fixture');
  }
  const target = join(dir, 'project');
  return { target, wrapper, read: name => readFileSync(join(target, name), 'utf8') };
}

describe('native-only ad probe', () => {
  it('builds the same player identity and SDK with no game or Capacitor runtime', async () => {
    const f = fixture();
    await prepareProbe(f.target, 5977, 'a'.repeat(40), f.wrapper);
    const gradle = f.read('app/build.gradle');
    expect(gradle).toContain("applicationId 'com.voiddominion.player'");
    expect(gradle).toContain('versionCode 5977');
    expect(gradle).toContain("versionName 'ad-probe-aaaaaaaa'");
    expect(gradle).toContain('mytarget-sdk:5.52.5');
    expect(gradle).not.toContain('capacitor');
    expect(readdirSync(join(f.target, 'app/src/main')).sort()).toEqual(['AndroidManifest.xml', 'java', 'res']);
    const manifest = f.read('app/src/main/AndroidManifest.xml');
    expect(manifest).toContain('android:usesCleartextTraffic="false"');
    expect(manifest).toContain('autoInitMode" android:value="0"');
    expect(manifest).toContain('permission.AD_ID" tools:node="remove"');
    for (const locale of ['', '-ru', '-de', '-pl', '-es']) {
      const xml = f.read(`app/src/main/res/values${locale}/strings.xml`);
      expect(xml).toContain('name="error_no_ads"');
      expect(xml).not.toContain('undefined');
    }
    expect(f.read('app/src/main/res/values-ru/strings.xml')).toContain('Проверить рекламу');
  });
  it.each([[0, 'a'.repeat(40)], [1.1, 'a'.repeat(40)], [5977, '$(untrusted)'], [2100000001, 'a'.repeat(40)]])(
    'rejects unsafe build identity before writing anything', async (version, sha) => {
      const f = fixture();
      await expect(prepareProbe(f.target, version, sha, f.wrapper)).rejects.toThrow('E_PROBE_VERSION');
    },
  );
  it('does not overwrite an existing project or user files', async () => {
    const f = fixture();
    mkdirSync(f.target); writeFileSync(join(f.target, 'keep'), 'owner');
    await expect(prepareProbe(f.target, 5977, 'a'.repeat(40), f.wrapper)).rejects.toThrow('E_PROBE_DIRECTORY');
    expect(f.read('keep')).toBe('owner');
  });
});
