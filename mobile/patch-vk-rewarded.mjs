import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const source = fileURLToPath(new URL('./native/VkRewardedAdsPlugin.java', import.meta.url));
const configPath = fileURLToPath(new URL('./vk-rewarded.json', import.meta.url));
const marker = '// VOID_VK_REWARDED';

export function rewardedBridge(slotId) {
  return readFileSync(new URL('./native/vk-rewarded-bridge.js', import.meta.url), 'utf8')
    .replace('const SLOT_ID = 2111707', `const SLOT_ID = ${slotId}`);
}

/** Check the packaged assets and the MERGED manifest, not just generator inputs. */
export function verifyVkRewarded(html, bridge, manifest) {
  const config = JSON.parse(readFileSync(configPath, 'utf8'));
  const matches = manifest.split(/(?=^\s*E: )/m).filter(block =>
    /^\s*E: meta-data(?:\s|$)/m.test(block) && block.includes('"com.my.target.autoInitMode"'));
  if (!html.includes('<script src="vk-rewarded-bridge.js"></script>') ||
      bridge !== rewardedBridge(config.slotId) || matches.length !== 1 ||
      !/android:value[^\n]*=\(type 0x1[01]\)0x0(?:\s|$)/.test(matches[0]))
    throw Error('E_VK_AD_PACKAGED_ASSET');
}

/** Install after branding/updater patches; generated Android sources are not committed. */
export function patchVkRewarded(root, config = JSON.parse(readFileSync(configPath, 'utf8'))) {
  if (!Number.isSafeInteger(config?.slotId) || config.slotId <= 0 || config.slotId > 2147483647 || config.placement !== 'main.supply' ||
      config.sdkVersion !== '5.52.5' || config.trackerVersion !== '3.6.0' || config.billingVersion !== '9.1.0') throw Error('E_VK_AD_CONFIG');
  const appId = JSON.parse(readFileSync(join(root, 'capacitor.config.json'), 'utf8')).appId;
  if (typeof appId !== 'string' || !/^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*){2,}$/.test(appId))
    throw Error('E_VK_AD_APP_ID');
  const main = join(root, 'android/app/src/main');
  const javaDir = join(main, 'java', ...appId.split('.'));
  const activityPath = join(javaDir, 'MainActivity.java');
  const gradlePath = join(root, 'android/app/build.gradle');
  const manifestPath = join(main, 'AndroidManifest.xml');
  const htmlPath = join(main, 'assets/public/index.html');
  let activity = readFileSync(activityPath, 'utf8');
  let gradle = readFileSync(gradlePath, 'utf8');
  let manifest = readFileSync(manifestPath, 'utf8');
  let html = readFileSync(htmlPath, 'utf8');
  if (!html.includes('</head>')) throw Error('E_VK_AD_WEB_ASSET');
  const script = '<script src="vk-rewarded-bridge.js"></script>';
  if (!html.includes(script)) html = html.replace('</head>', script + '</head>');
  const bridge = rewardedBridge(config.slotId);
  const registration = 'registerPlugin(VkRewardedAdsPlugin.class);';
  if (!activity.includes(registration)) {
    if (activity.includes('super.onCreate(savedInstanceState);'))
      activity = activity.replace('super.onCreate(savedInstanceState);', `${registration}\n        super.onCreate(savedInstanceState);`);
    else if (/public class MainActivity extends BridgeActivity\s*\{\s*\}/.test(activity))
      activity = activity.replace(/public class MainActivity extends BridgeActivity\s*\{\s*\}/,
        `public class MainActivity extends BridgeActivity {\n    @Override public void onCreate(android.os.Bundle savedInstanceState) {\n        ${registration}\n        super.onCreate(savedInstanceState);\n    }\n}`);
    else throw Error('E_VK_AD_ACTIVITY');
  }
  if (!gradle.includes(marker)) {
    if (/mytarget-sdk|mytracker-sdk/.test(gradle)) throw Error('E_VK_AD_DEPENDENCY');
    gradle += `\n${marker}\ndependencies {\n    implementation 'com.my.target:mytarget-sdk:${config.sdkVersion}'\n    constraints {\n        implementation('com.my.tracker:mytracker-sdk') { version { strictly '${config.trackerVersion}' } }\n        implementation('com.android.billingclient:billing') { version { strictly '${config.billingVersion}' } }\n    }\n}\n`;
  }
  // Non-personalized operation does not need access to the advertising identifier.
  if (!manifest.includes('xmlns:tools=')) manifest = manifest.replace('<manifest ', '<manifest xmlns:tools="http://schemas.android.com/tools" ');
  for (const permission of ['com.google.android.gms.permission.AD_ID', 'com.android.vending.BILLING',
    'com.google.android.finsky.permission.BIND_GET_INSTALL_REFERRER_SERVICE']) {
    const removal = `<uses-permission android:name="${permission}" tools:node="remove" />`;
    if (!manifest.includes(removal)) {
      if (!manifest.includes('</manifest>')) throw Error('E_VK_AD_MANIFEST');
      manifest = manifest.replace('</manifest>', `    ${removal}\n</manifest>`);
    }
  }
  const autoInit = '<meta-data android:name="com.my.target.autoInitMode" android:value="0" />';
  if (!manifest.includes(autoInit)) {
    if (manifest.includes('com.my.target.autoInitMode')) throw Error('E_VK_AD_AUTO_INIT');
    manifest = manifest.replace(/<application\s*\/>/, '<application></application>');
    if (!manifest.includes('</application>')) throw Error('E_VK_AD_MANIFEST');
    manifest = manifest.replace('</application>', `    ${autoInit}\n</application>`);
  }
  const java = readFileSync(source, 'utf8').replaceAll('__APP_ID__', appId).replaceAll('__SLOT_ID__', String(config.slotId));
  mkdirSync(javaDir, { recursive: true });
  writeFileSync(join(javaDir, 'VkRewardedAdsPlugin.java'), java);
  writeFileSync(activityPath, activity);
  writeFileSync(gradlePath, gradle);
  writeFileSync(manifestPath, manifest);
  writeFileSync(join(main, 'assets/public/vk-rewarded-bridge.js'), bridge);
  writeFileSync(htmlPath, html);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  patchVkRewarded(dirname(fileURLToPath(import.meta.url)));
