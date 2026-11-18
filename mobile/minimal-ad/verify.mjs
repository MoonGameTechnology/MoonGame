import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { distribution } from '../apk-manifest.mjs';
import { verifyApk } from '../apk-verify.mjs';

const [apk, rawVersion, sha] = process.argv.slice(2);
const versionCode = Number(rawVersion);
if (!apk || !Number.isSafeInteger(versionCode) || !/^[a-f0-9]{40}$/.test(sha)) throw Error('E_PROBE_VERIFY_CONFIG');
const manifest = { appId: 'com.voiddominion.player', versionCode, versionName: `ad-probe-${sha.slice(0, 8)}`, signerSha256: distribution.signerSha256 };
await verifyApk(apk, manifest);
const badging = execFileSync(process.env.AAPT || 'aapt', ['dump', 'badging', apk], { encoding: 'utf8' });
if (!badging.includes("launchable-activity: name='com.voiddominion.player.AdProbeActivity'") ||
    !badging.includes("sdkVersion:'24'") || /uses-permission: name='(?:com\.google\.android\.gms\.permission\.AD_ID|com\.android\.vending\.BILLING|com\.google\.android\.finsky\.permission\.BIND_GET_INSTALL_REFERRER_SERVICE)'/.test(badging))
  throw Error('E_PROBE_MANIFEST');
const xml = execFileSync(process.env.AAPT || 'aapt', ['dump', 'xmltree', apk, 'AndroidManifest.xml'], { encoding: 'utf8' });
const metadata = xml.split(/(?=^\s*E: )/m).filter(b => /^\s*E: meta-data(?:\s|$)/m.test(b) && b.includes('"com.my.target.autoInitMode"'));
if (metadata.length !== 1 || !/android:value[^\n]*=\(type 0x1[01]\)0x0(?:\s|$)/.test(metadata[0])) throw Error('E_PROBE_AUTO_INIT');
const files = execFileSync('unzip', ['-Z1', apk], { encoding: 'utf8' }).split('\n');
if (files.some(n => n.startsWith('assets/public/') || /(?:void-dominion|sim-worker).*\.(?:html|js)$/.test(n))) throw Error('E_PROBE_GAME_ASSETS');
const bytes = readFileSync(apk);
if (bytes.length > 16 * 1024 * 1024) throw Error('E_PROBE_SIZE');
const proof = { manifest, source: sha, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), nativeOnly: true, autoInit: false, advertisingId: false };
writeFileSync(apk + '.verification.json', JSON.stringify(proof, null, 2) + '\n');
console.log(JSON.stringify(proof));
