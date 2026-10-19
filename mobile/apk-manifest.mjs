// Shared publication contract. APK clients consume the public projection, not GitHub.
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyApk } from './apk-verify.mjs';
export const distribution = JSON.parse(readFileSync(new URL('./distribution.json', import.meta.url), 'utf8'));
export const LANES = Object.freeze({ alpha: 'com.voiddominion.prototype', player: 'com.voiddominion.player' });
export const apkName = (lane) => `void-dominion-${lane}.apk`;
export function validateManifest(m, lane) {
  if (!Object.hasOwn(LANES, lane) || !m || typeof m !== 'object' ||
      !Number.isInteger(m.versionCode) || m.versionCode <= 0 || m.versionCode > 2100000000 ||
      typeof m.versionName !== 'string' || !/^[a-zA-Z0-9._-]{1,80}$/.test(m.versionName) ||
      typeof m.sha !== 'string' || !/^[a-f0-9]{7,40}$/.test(m.sha) ||
      typeof m.notes !== 'string' || m.notes.length > 8192 ||
      !/^[a-f0-9]{64}$/.test(m.apkSha256) || m.appId !== LANES[lane] ||
      m.signerSha256 !== distribution.signerSha256) throw new Error('E_APK_MANIFEST');
  const apkUrl = `${distribution.origin}${distribution.basePath}/${lane}/${m.versionCode}-${m.sha}/${apkName(lane)}`;
  if (m.apkUrl !== apkUrl) throw new Error('E_APK_MANIFEST');
  // Drop every unknown property before publishing remotely supplied JSON.
  return Object.fromEntries(['versionCode','versionName','sha','notes','apkSha256','appId','signerSha256','apkUrl'].map((k) => [k, m[k]]));
}
export function createManifest({ lane, versionCode, versionName, sha, notes, apkSha256, signerSha256 }) {
  return validateManifest({ versionCode, versionName, sha, notes, apkSha256, signerSha256,
    appId: LANES[lane], apkUrl: `${distribution.origin}${distribution.basePath}/${lane}/${versionCode}-${sha}/${apkName(lane)}` }, lane);
}
async function main() {
  const [apk, out] = process.argv.slice(2);
  if (!apk || !out || process.argv.length !== 4) throw new Error('E_APK_CONFIG');
  const notes = execFileSync('git', ['log', '-8', '--pretty=format:%s', 'HEAD'], { encoding: 'utf8', maxBuffer: 65536 }).slice(0,2048);
  const m = createManifest({ lane: process.env.RELEASE_TAG, versionCode: Number(process.env.VOID_VC),
    versionName: process.env.VOID_VN, sha: process.env.VOID_SHA, notes,
    signerSha256: process.env.VOID_SIGNER_CERT_SHA256,
    apkSha256: createHash('sha256').update(readFileSync(apk)).digest('hex') });
  await verifyApk(apk, m);
  writeFileSync(out, JSON.stringify(m, null, 2)+'\n');
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(() => { process.stderr.write('E_APK_VERIFY\n'); process.exitCode=1; });
