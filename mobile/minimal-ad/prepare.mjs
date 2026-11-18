import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { transform } from 'esbuild';

const here = dirname(fileURLToPath(import.meta.url));
const mobile = resolve(here, '..');
const strings = {
  app_name: 'hub.ad-preview.minimal-title', action: 'hub.ad-preview.action', hint: 'hub.ad-preview.hint', loading: 'hub.ad-preview.loading',
  earned: 'hub.ad-preview.earned', cancelled: 'hub.ad-preview.cancelled', log_sent: 'hub.ad-preview.log-sent', log_failed: 'hub.ad-preview.log-failed',
  error_app: 'hub.ad-preview.error.app', error_connection: 'hub.ad-preview.error.connection', error_no_ads: 'hub.ad-preview.error.no-ads',
  error_provider: 'hub.ad-preview.error.provider', error_rejected: 'hub.ad-preview.error.rejected', error_show: 'hub.ad-preview.error.show', error_timeout: 'hub.ad-preview.error.timeout',
};
const xml = value => value.replaceAll('\\', '\\\\').replaceAll("'", "\\'").replaceAll('"', '\\"')
  .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');

async function resources(locale) {
  const input = readFileSync(resolve(mobile, `../localization/${locale}.ts`), 'utf8');
  const { code } = await transform(input, { loader: 'ts', format: 'esm' });
  const bundle = (await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`))[locale];
  return '<resources>\n' + Object.entries(strings).map(([name, key]) => {
    const value = bundle[key];
    if (typeof value !== 'string' || !value) throw Error('E_PROBE_LOCALE');
    return `    <string name="${name}" formatted="false">${xml(value)}</string>`;
  }).join('\n') + '\n</resources>\n';
}

/** Fresh directory only; the SDK, identifier, signing key and privacy match the player APK. */
export async function prepareProbe(target, versionCode, sha, wrapperDirectory) {
  if (!Number.isInteger(versionCode) || versionCode < 1 || versionCode > 2100000000 || !/^[a-f0-9]{40}$/.test(sha))
    throw Error('E_PROBE_VERSION');
  if (existsSync(target) && readdirSync(target).length) throw Error('E_PROBE_DIRECTORY');
  const sdk = JSON.parse(readFileSync(join(mobile, 'vk-rewarded.json'), 'utf8'));
  const distribution = JSON.parse(readFileSync(join(mobile, 'distribution.json'), 'utf8'));
  if (sdk.slotId !== 2111707 || sdk.sdkVersion !== '5.52.5' || sdk.trackerVersion !== '3.6.0' || sdk.billingVersion !== '9.1.0' ||
      distribution.origin !== 'https://77-221-140-87.sslip.io') throw Error('E_PROBE_CONFIG');
  const files = {
    'settings.gradle': "pluginManagement { repositories { google(); mavenCentral(); gradlePluginPortal() } }\nrootProject.name = 'VkAdProbe'\ninclude ':app'\n",
    'build.gradle': "buildscript { repositories { google(); mavenCentral() }; dependencies { classpath 'com.android.tools.build:gradle:8.13.0' } }\nallprojects { repositories { google(); mavenCentral() } }\n",
    'gradle.properties': 'android.useAndroidX=true\norg.gradle.jvmargs=-Xmx2048m\n',
    'app/build.gradle': `apply plugin: 'com.android.application'
android {
    namespace 'com.voiddominion.player'
    compileSdk 36
    defaultConfig {
        applicationId 'com.voiddominion.player'
        minSdk 24
        targetSdk 36
        versionCode ${versionCode}
        versionName 'ad-probe-${sha.slice(0, 8)}'
        buildConfigField 'int', 'SLOT_ID', '${sdk.slotId}'
        buildConfigField 'String', 'SDK_VERSION', '"${sdk.sdkVersion}"'
        buildConfigField 'String', 'SOURCE_SHA', '"${sha.slice(0, 8)}"'
        buildConfigField 'String', 'TELEMETRY_URL', '"${distribution.origin}/telemetry"'
    }
    buildFeatures { buildConfig true }
    signingConfigs {
        debug { storeFile file('../debug.keystore'); storePassword 'android'; keyAlias 'androiddebugkey'; keyPassword 'android' }
    }
    compileOptions { sourceCompatibility JavaVersion.VERSION_21; targetCompatibility JavaVersion.VERSION_21 }
}
dependencies {
    implementation 'com.my.target:mytarget-sdk:${sdk.sdkVersion}'
    constraints {
        implementation('com.my.tracker:mytracker-sdk') { version { strictly '${sdk.trackerVersion}' } }
        implementation('com.android.billingclient:billing') { version { strictly '${sdk.billingVersion}' } }
    }
}
`,
    'app/src/main/AndroidManifest.xml': `<manifest xmlns:android="http://schemas.android.com/apk/res/android" xmlns:tools="http://schemas.android.com/tools">
    <uses-permission android:name="android.permission.INTERNET" />
    <uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />
    <uses-permission android:name="com.google.android.gms.permission.AD_ID" tools:node="remove" />
    <uses-permission android:name="com.android.vending.BILLING" tools:node="remove" />
    <uses-permission android:name="com.google.android.finsky.permission.BIND_GET_INSTALL_REFERRER_SERVICE" tools:node="remove" />
    <application android:label="@string/app_name" android:theme="@android:style/Theme.Material.Light.NoActionBar" android:allowBackup="false" android:usesCleartextTraffic="false">
        <meta-data android:name="com.my.target.autoInitMode" android:value="0" />
        <activity android:name=".AdProbeActivity" android:exported="true" android:configChanges="orientation|screenSize|keyboardHidden|screenLayout|smallestScreenSize|density" android:screenOrientation="portrait">
            <intent-filter><action android:name="android.intent.action.MAIN" /><category android:name="android.intent.category.LAUNCHER" /></intent-filter>
        </activity>
    </application>
</manifest>
`,
  };
  for (const locale of ['en', 'ru', 'de', 'pl', 'es']) {
    files[`app/src/main/res/values${locale === 'en' ? '' : '-' + locale}/strings.xml`] = await resources(locale);
  }
  for (const name of ['AdProbeActivity.java', 'ProbeTelemetry.java'])
    files[`app/src/main/java/com/voiddominion/player/${name}`] = readFileSync(join(here, name), 'utf8');
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(target, path)), { recursive: true });
    writeFileSync(join(target, path), content);
  }
  copyFileSync(join(mobile, 'debug.keystore'), join(target, 'debug.keystore'));
  for (const name of ['gradlew', 'gradlew.bat', 'gradle/wrapper/gradle-wrapper.jar', 'gradle/wrapper/gradle-wrapper.properties']) {
    mkdirSync(dirname(join(target, name)), { recursive: true });
    copyFileSync(join(wrapperDirectory, name), join(target, name));
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [target, versionCode, sha] = process.argv.slice(2);
  if (!target) throw Error('E_PROBE_DIRECTORY');
  const wrapper = mkdtempSync(join(tmpdir(), 'vk-ad-probe-wrapper-'));
  try {
    // Tooling from the same locked Capacitor archive; none of its runtime goes into the APK.
    execFileSync('tar', ['-xzf', join(mobile, 'node_modules/@capacitor/cli/assets/android-template.tar.gz'), '-C', wrapper]);
    await prepareProbe(resolve(target), Number(versionCode), sha, wrapper);
  } finally { rmSync(wrapper, { recursive: true, force: true }); }
}
