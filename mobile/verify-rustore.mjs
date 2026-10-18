import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { validateRelease, verifyPermissions, verifyPolicyDocument } from './rustore-config.mjs';
const config = validateRelease(JSON.parse(readFileSync(process.env.RUSTORE_CONFIG_FILE, 'utf8')));
const apk = process.argv[2]; if (!apk) throw Error('E_RUSTORE_APK');
const aapt = process.env.AAPT ?? 'aapt';
const run = (cmd, args) => execFileSync(cmd, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
const badging = run(aapt, ['dump', 'badging', apk]);
if (!badging.includes(`package: name='${config.appId}' versionCode='${config.versionCode}' versionName='${config.versionName}'`) || badging.includes('application-debuggable')) throw Error('E_RUSTORE_IDENTITY');
const permissions = [...run(aapt, ['dump', 'permissions', apk]).matchAll(/uses-permission(?:-sdk-23)?: name='([^']+)'/g)].map(m => m[1]);
const manifest = run(aapt, ['dump', 'xmltree', apk, 'AndroidManifest.xml']);
verifyPermissions(permissions, manifest, config.appId);
if (manifest.includes('android:networkSecurityConfig')) throw Error('E_RUSTORE_NETWORK_POLICY_REVIEW');
// Absent debuggable defaults to false in Android; AGP may omit it on release builds.
for (const line of manifest.split('\n').filter(line => line.includes('android:debuggable')))
  if (!/android:debuggable[^\n]*=\(type 0x12\)0x0(?:\s|$)/.test(line)) throw Error('E_RUSTORE_MANIFEST');
for (const name of ['allowBackup', 'usesCleartextTraffic']) if (!new RegExp(`android:${name}[^\\n]*=\\(type 0x12\\)0x0(?:\\s|$)`).test(manifest)) throw Error('E_RUSTORE_MANIFEST');
const signatures = run(process.env.APKSIGNER ?? 'apksigner', ['verify', '--verbose', '--print-certs', apk]);
const certs = [...signatures.matchAll(/Signer #\d+ certificate SHA-256 digest: ([a-fA-F0-9]+)/g)].map(m => m[1].toLowerCase());
if (certs.length !== 1 || certs[0] !== config.certificateSha256 || /CN=Android Debug/i.test(signatures)) throw Error('E_RUSTORE_CERTIFICATE');
const html = run('unzip', ['-p', apk, 'assets/public/index.html']);
if (!html.includes('"channel":"rustore"') || !html.includes('"privacyUrl":"privacy.html"')) throw Error('E_RUSTORE_CHANNEL');
const capacitor = JSON.parse(run('unzip', ['-p', apk, 'assets/capacitor.config.json']));
if (capacitor.appId !== config.appId || capacitor.webDir !== 'www' ||
    capacitor.server?.androidScheme !== 'https' || capacitor.server.cleartext !== false ||
    Object.keys(capacitor.server).sort().join(',') !== 'androidScheme,cleartext')
  throw Error('E_RUSTORE_WEBVIEW_CONFIG');
const policy = run('unzip', ['-p', apk, 'assets/public/privacy.html']);
verifyPolicyDocument(policy, config.policySha256);
writeFileSync(apk + '.verification.json', JSON.stringify({ appId: config.appId, versionCode: config.versionCode, certificateSha256: certs[0], apkSha256: createHash('sha256').update(readFileSync(apk)).digest('hex'), permissions, checkedAt: new Date().toISOString() }, null, 2));
console.log('RuStore APK identity, manifest, permissions, signature and privacy asset verified.');
