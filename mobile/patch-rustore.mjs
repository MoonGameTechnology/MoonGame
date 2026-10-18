import { readFileSync, writeFileSync } from 'node:fs';
import { validateRelease } from './rustore-config.mjs';
const config = validateRelease(JSON.parse(readFileSync(process.env.RUSTORE_CONFIG_FILE, 'utf8')));
const gradlePath = 'android/app/build.gradle';
let gradle = readFileSync(gradlePath, 'utf8');
if (/debug\.keystore|signingConfig\s+signingConfigs\.debug/.test(gradle)) throw Error('E_RUSTORE_DEBUG_SIGNING');
if (!/versionCode\s+\d+/.test(gradle) || !/versionName\s+"[^"]*"/.test(gradle)) throw Error('E_RUSTORE_GRADLE');
gradle = gradle.replace(/versionCode\s+\d+/, `versionCode ${config.versionCode}`).replace(/versionName\s+"[^"]*"/, `versionName "${config.versionName}"`);
writeFileSync(gradlePath, gradle);
const path = 'android/app/src/main/AndroidManifest.xml';
let xml = readFileSync(path, 'utf8');
for (const name of ['debuggable', 'allowBackup', 'usesCleartextTraffic']) {
  const pattern = new RegExp(`android:${name}="[^"]*"`, 'g');
  xml = xml.replace(pattern, '');
  xml = xml.replace('<application', `<application android:${name}="false"`);
}
writeFileSync(path, xml);
