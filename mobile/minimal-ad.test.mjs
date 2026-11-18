import { afterEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
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
  it('reports only fixed network evidence from ambiguous SDK code 1000 messages', () => {
    const dir = mkdtempSync(join(tmpdir(), 'vk-network-failure-'));
    dirs.push(dir);
    const source = fileURLToPath(new URL('./minimal-ad/VkNetworkFailure.java', import.meta.url));
    const checks = join(dir, 'NetworkCheck.java');
    writeFileSync(checks, `package com.voiddominion.adprobe;
      import java.util.Objects;
      final class NetworkCheck {
        private static void check(String message, String kind, Integer status) {
          VkNetworkFailure actual = VkNetworkFailure.fromMessage(message);
          if (!kind.equals(actual.kind) || !Objects.equals(status, actual.httpStatus))
            throw new AssertionError(actual.kind + " " + actual.httpStatus);
        }
        public static void main(String[] args) {
          check("204 – null", "http", 204);
          check("429 – Ad request error - response code429", "http", 429);
          check("-1 – Unable to resolve host data.invalid", "dns", null);
          check("-1 – Trust anchor for certification path not found", "tls", null);
          check("-1 – Cleartext HTTP traffic not permitted", "cleartext_blocked", null);
          check("-1 – failed to connect to data.invalid", "connect", null);
          check("-1 – Read timed out", "timeout", null);
          check("arbitrary text https://data.invalid/?token=private&status=429", "unknown", null);
          check(null, "unknown", null);
        }
      }`);
    execFileSync('java', ['-m', 'jdk.compiler/com.sun.tools.javac.Main', '-d', dir, source, checks], { timeout: 5000 });
    execFileSync('java', ['-cp', dir, 'com.voiddominion.adprobe.NetworkCheck'], { timeout: 5000 });
  });
  it('builds a separate app identity with the same SDK and no game or Capacitor runtime', async () => {
    const f = fixture();
    await prepareProbe(f.target, 5977, 'a'.repeat(40), f.wrapper);
    const gradle = f.read('app/build.gradle');
    expect(gradle).toContain("applicationId 'com.voiddominion.adprobe'");
    expect(gradle).not.toContain("applicationId 'com.voiddominion.player'");
    expect(f.read('app/src/main/java/com/voiddominion/adprobe/AdProbeActivity.java')).toContain('package com.voiddominion.adprobe;');
    expect(f.read('app/src/main/java/com/voiddominion/adprobe/ProbeTelemetry.java')).toContain('package com.voiddominion.adprobe;');
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
