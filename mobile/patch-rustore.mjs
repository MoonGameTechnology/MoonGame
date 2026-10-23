import { readFileSync, writeFileSync } from 'node:fs';
import { validateRelease } from './rustore-config.mjs';
const config = validateRelease(JSON.parse(readFileSync(process.env.RUSTORE_CONFIG_FILE, 'utf8')));
const gradlePath = 'android/app/build.gradle';
let gradle = readFileSync(gradlePath, 'utf8');
if (/debug\.keystore|signingConfig\s+signingConfigs\.debug/.test(gradle)) throw Error('E_RUSTORE_DEBUG_SIGNING');
if (!/versionCode\s+\d+/.test(gradle) || !/versionName\s+"[^"]*"/.test(gradle)) throw Error('E_RUSTORE_GRADLE');
gradle = gradle.replace(/versionCode\s+\d+/, `versionCode ${config.versionCode}`).replace(/versionName\s+"[^"]*"/, `versionName "${config.versionName}"`);
// Let the Android build tools own the manifest's debuggable attribute. Hardcoding
// it in the source manifest fails release lint (HardcodedDebugMode).
if (!/buildTypes\s*\{\s*release\s*\{/.test(gradle)) throw Error('E_RUSTORE_GRADLE');
gradle = gradle.replace(/(buildTypes\s*\{\s*release\s*\{)([\s\S]*?)(\n\s*\})/,
  (_match, head, body, tail) => `${head}${body.replace(/^\s*debuggable\s+[^\n]+/gm, '')}\n            debuggable false${tail}`);
writeFileSync(gradlePath, gradle);
const path = 'android/app/src/main/AndroidManifest.xml';
let xml = readFileSync(path, 'utf8');
xml = xml.replace(/\s*android:debuggable="[^"]*"/g, '');
for (const name of ['allowBackup', 'usesCleartextTraffic']) {
  const pattern = new RegExp(`android:${name}="[^"]*"`, 'g');
  xml = xml.replace(pattern, '');
  xml = xml.replace('<application', `<application android:${name}="false"`);
}
writeFileSync(path, xml);
