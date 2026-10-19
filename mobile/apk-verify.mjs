import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const exec = promisify(execFile);
// Build-tools 35/36 use Signer #1; 37 also prints scheme-specific V3.0 Signer:.
// This sideload lane deliberately retains its existing debug certificate.
export function verifyCertificate(output, expected) {
  const counts=[...output.matchAll(/^Number of signers: (\d+)\r?$/gm)];
  const lines=output.split(/\r?\n/).filter(x=>x.includes('certificate SHA-256 digest:'));
  if(counts.length!==1 || counts[0][1]!=='1' || !lines.length ||
    lines.some(line=>line.match(/^(?:Signer #1|V[1-4](?:\.\d+)? Signer:) certificate SHA-256 digest: ([a-fA-F0-9]{64})$/)?.[1].toLowerCase()!==expected))throw new Error('E_APK_SIGNER');
}
export async function verifyApk(path, m) {
  const opts = { timeout:30000, maxBuffer:65536, env:{ PATH:'/usr/local/bin:/usr/bin:/bin', LANG:'C.UTF-8', JAVA_TOOL_OPTIONS:'-Xmx128m', ...(process.env.JAVA_HOME ? { JAVA_HOME:process.env.JAVA_HOME } : {}) } };
  const {stdout:signing}=await exec(process.env.APKSIGNER || 'apksigner',['verify','--verbose','--print-certs',path],opts);
  verifyCertificate(signing,m.signerSha256);
  const {stdout:badging}=await exec(process.env.AAPT || 'aapt',['dump','badging',path],opts);
  const pkg=/package: name='([^']+)' versionCode='(\d+)' versionName='([^']+)'/.exec(badging);
  if(!pkg || pkg[1]!==m.appId || Number(pkg[2])!==m.versionCode || pkg[3]!==m.versionName)throw new Error('E_APK_IDENTITY');
}
