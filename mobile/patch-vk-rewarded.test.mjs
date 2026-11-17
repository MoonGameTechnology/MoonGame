import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { patchVkRewarded, rewardedBridge, verifyVkRewarded } from './patch-vk-rewarded.mjs';

const dirs = [];
afterEach(() => dirs.splice(0).forEach(dir => rmSync(dir, { recursive: true, force: true })));
function fixture(activity = 'public class MainActivity extends BridgeActivity {}') {
  const dir = mkdtempSync(join(tmpdir(), 'vk-ad-build-'));
  dirs.push(dir);
  const files = {
    'capacitor.config.json': JSON.stringify({ appId: 'org.moongame.fixture' }),
    'android/app/src/main/java/org/moongame/fixture/MainActivity.java': activity,
    'android/app/build.gradle': 'android { defaultConfig { versionCode 1 } }\n',
    'android/app/src/main/AndroidManifest.xml': '<manifest xmlns:android="http://schemas.android.com/apk/res/android"><application /></manifest>',
    'android/app/src/main/assets/public/index.html': '<html><head></head><body></body></html>',
  };
  for (const [path, value] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), value);
  }
  return { dir, read: path => readFileSync(join(dir, path), 'utf8'), files };
}
const java = 'android/app/src/main/java/org/moongame/fixture/';
describe('VK SDK packaging', () => {
  it('checks the final merged manifest and exact bridge bytes', () => {
    const html = '<script src="vk-rewarded-bridge.js"></script>';
    const manifest = 'E: application\n  E: meta-data\n    A: android:name="com.my.target.autoInitMode"\n    A: android:value=(type 0x10)0x0\n';
    expect(() => verifyVkRewarded(html, rewardedBridge(2111707), manifest)).not.toThrow();
    expect(() => verifyVkRewarded(html, rewardedBridge(123), manifest)).toThrow();
    expect(() => verifyVkRewarded('', rewardedBridge(2111707), manifest)).toThrow();
    expect(() => verifyVkRewarded(html, rewardedBridge(2111707), manifest.replace('0x0', '0x1'))).toThrow();
  });
  it.each([
    'public class MainActivity extends BridgeActivity {}',
    'public class MainActivity extends BridgeActivity { public void onCreate(Bundle savedInstanceState) { super.onCreate(savedInstanceState); keepUpdater(); } }',
  ])('registers the real native plugin before Capacitor starts, without replacing the updater', activity => {
    const f = fixture(activity);
    patchVkRewarded(f.dir);
    const host = f.read(java + 'MainActivity.java');
    expect(host.indexOf('registerPlugin(')).toBeLessThan(host.indexOf('super.onCreate('));
    if (activity.includes('keepUpdater')) expect(host).toContain('keepUpdater();');
    const plugin = f.read(java + 'VkRewardedAdsPlugin.java');
    expect(plugin).toContain('package org.moongame.fixture;');
    expect(plugin).toContain('SLOT_ID = 2111707;');
    const paths = [java + 'MainActivity.java', java + 'VkRewardedAdsPlugin.java',
      'android/app/build.gradle', 'android/app/src/main/AndroidManifest.xml',
      'android/app/src/main/assets/public/index.html', 'android/app/src/main/assets/public/vk-rewarded-bridge.js'];
    const before = paths.map(f.read);
    patchVkRewarded(f.dir);
    expect(paths.map(f.read)).toEqual(before);
    expect(f.read('android/app/build.gradle')).toContain('mytarget-sdk:5.52.5');
    expect(f.read('android/app/build.gradle')).toContain("strictly '3.6.0'");
    expect(f.read('android/app/build.gradle')).toContain("strictly '9.1.0'");
    expect(f.read('android/app/src/main/AndroidManifest.xml')).toContain('permission.AD_ID" tools:node="remove"');
    expect(f.read('android/app/src/main/AndroidManifest.xml')).toContain('vending.BILLING" tools:node="remove"');
    expect(f.read('android/app/src/main/AndroidManifest.xml')).toContain('autoInitMode" android:value="0"');
    expect(f.read('android/app/src/main/assets/public/index.html')).toContain('src="vk-rewarded-bridge.js"');
  });
  it('fails before mutating a project with an unfamiliar activity', () => {
    const f = fixture('unfamiliar activity');
    expect(() => patchVkRewarded(f.dir)).toThrow('E_VK_AD_ACTIVITY');
    for (const [path, value] of Object.entries(f.files)) expect(f.read(path)).toBe(value);
  });
  it.each([{}, { slotId: -1 }, { slotId: '2111707' },
    { slotId: 2111707, placement: 'run.sovereigns', sdkVersion: '5.52.5', trackerVersion: '3.6.0' },
  ])('rejects a substituted slot/config instead of requesting an arbitrary ad', config => {
    const f = fixture();
    expect(() => patchVkRewarded(f.dir, config)).toThrow('E_VK_AD_CONFIG');
    for (const [path, value] of Object.entries(f.files)) expect(f.read(path)).toBe(value);
  });
});
