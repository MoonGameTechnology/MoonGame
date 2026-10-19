// Host-only pull publisher. No HTTP listener, SSH key, GitHub token or Docker API.
import { mkdir, readFile, writeFile, rename, symlink, unlink, readdir, rm, statfs } from 'node:fs/promises';
import { openSync, closeSync, writeSync } from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateManifest, LANES, apkName } from '../../mobile/apk-manifest.mjs';
import { verifyApk } from '../../mobile/apk-verify.mjs';
const { AbortController } = globalThis;
const REPO = 'https://api.github.com/repos/MoonGameTechnology/MoonGame';
const ALLOWED = new Set(['api.github.com','github.com','objects.githubusercontent.com','release-assets.githubusercontent.com']);
const MAX_APK = 128 * 1024 * 1024;

/** Manual redirects keep an asset's Location from reaching arbitrary hosts. */
export async function download(url, limit, { fetchImpl = fetch, destination } = {}) {
  const abort = new AbortController(); const timer = setTimeout(() => abort.abort(), 90000);
  let descriptor;
  try {
    for (let hop=0; hop<6; hop++) {
      const u = new URL(url);
      if (u.protocol !== 'https:' || !ALLOWED.has(u.hostname) || u.username || u.password || (u.port && u.port !== '443')) throw new Error('E_APK_SOURCE');
      const res = await fetchImpl(u.href, { redirect:'manual', credentials:'omit', signal:abort.signal,
        headers: { Accept: u.hostname==='api.github.com'?'application/vnd.github+json':'application/octet-stream', 'User-Agent':'MoonGame-APK-publisher' } });
      if ([301,302,303,307,308].includes(res.status)) {
        const location = res.headers.get('location'); await res.body?.cancel();
        if (!location) throw new Error('E_APK_SOURCE'); url = new URL(location,u).href; continue;
      }
      if (!res.ok || !res.body) throw new Error('E_APK_SOURCE');
      const length = res.headers.get('content-length');
      if (length && Number(length)>limit) { await res.body.cancel(); throw new Error('E_APK_SIZE'); }
      if (destination) descriptor = openSync(destination, 'wx', 0o644);
      const reader = res.body.getReader(); const chunks=[]; const hash=createHash('sha256'); let bytes=0;
      try {
        while (true) {
          const {done,value}=await reader.read(); if(done)break;
          bytes+=value.length; if(bytes>limit)throw new Error('E_APK_SIZE'); hash.update(value);
          if(descriptor!==undefined) { let offset=0; while(offset<value.length)offset+=writeSync(descriptor,value,offset); }
          else chunks.push(Buffer.from(value));
        }
      } finally { await reader.cancel().catch(()=>{}); }
      return { bytes, sha256:hash.digest('hex'), ...(destination ? {} : { body:Buffer.concat(chunks) }) };
    }
    throw new Error('E_APK_SOURCE');
  } finally { clearTimeout(timer); if(descriptor!==undefined)closeSync(descriptor); }
}

/** Commit immutable files first, then switch ONE pointer shared by JSON and APK. */
export async function installRelease({ root, lane, manifest, acquire, verify=verifyApk, checkSpace=true }) {
  const m=validateManifest(manifest,lane); const dir=join(root,lane); await mkdir(dir,{recursive:true,mode:0o755});
  // A killed process cannot run finally. The systemd oneshot serializes runs;
  // remove only this publisher's random staging names before another attempt.
  for(const name of await readdir(dir))
    if(/^\.(?:incoming|current)-[a-f0-9]{24}$/.test(name))await rm(join(dir,name),{recursive:true,force:true});
  let current;
  try { current=JSON.parse(await readFile(join(dir,'current','latest.json'),'utf8')); }
  catch(e) { if(e.code!=='ENOENT')throw new Error('E_APK_CURRENT', { cause:e }); }
  if(current && m.versionCode<=current.versionCode) {
    if(m.versionCode===current.versionCode && m.apkSha256!==current.apkSha256)throw new Error('E_APK_VERSION_REUSE');
    return false;
  }
  if(checkSpace) { const fs=await statfs(root); if(fs.bavail*fs.bsize < 12*1024**3+MAX_APK)throw new Error('E_APK_DISK'); }
  const stage=join(dir,`.incoming-${randomBytes(12).toString('hex')}`);await mkdir(stage,{mode:0o755});
  const filename=apkName(lane), target=`${m.versionCode}-${m.sha}`, pointer=join(dir,`.current-${randomBytes(12).toString('hex')}`);
  try {
    const result=await acquire(join(stage,filename));
    if(result.sha256!==m.apkSha256 || result.bytes<=0 || result.bytes>MAX_APK)throw new Error('E_APK_DIGEST');
    await verify(join(stage,filename),m);
    await writeFile(join(stage,'latest.json'),JSON.stringify(m,null,2)+'\n',{flag:'wx',mode:0o644});
    await symlink(filename,join(stage,'latest.apk'));
    // Recover an immutable directory left by an interrupted switch only after
    // verification above; it was never public through the stable pointer.
    await rm(join(dir,target),{recursive:true,force:true});
    await rename(stage,join(dir,target));
    await symlink(target,pointer);await rename(pointer,join(dir,'current'));
    // At most eight published builds per lane; current is always retained.
    const builds=(await readdir(dir)).filter(x=>/^\d+-[a-f0-9]{7,40}$/.test(x)).sort((a,b)=>Number(b.split('-')[0])-Number(a.split('-')[0]));
    for(const old of builds.slice(8)) if(old!==target)await rm(join(dir,old),{recursive:true,force:true});
    return true;
  } finally { await rm(stage,{recursive:true,force:true}); await unlink(pointer).catch(()=>{}); }
}
export async function syncLane(root,lane,{ get=download }={}) {
  const release=JSON.parse((await get(`${REPO}/releases/tags/${lane}`,65536)).body.toString('utf8'));
  if(release.tag_name!==lane || !Array.isArray(release.assets))throw new Error('E_APK_RELEASE');
  const asset=(name)=>release.assets.find(a=>a.name===name && typeof a.browser_download_url==='string')?.browser_download_url;
  const metadata=asset('version.json'),apk=asset(apkName(lane));
  const prefix=`https://github.com/MoonGameTechnology/MoonGame/releases/download/${lane}/`;
  if(!metadata) {
    // Migration only: an already imported, verified legacy build is unchanged.
    // Never infer/download a new APK from prose when version.json is missing.
    const current=validateManifest(JSON.parse(await readFile(join(root,lane,'current/latest.json'),'utf8')),lane);
    const vc=/void:versionCode=(\d+)/.exec(release.body||'');
    const sha=/void:sha=([a-f0-9]{7,40})/.exec(release.body||'');
    if(vc && sha && Number(vc[1])===current.versionCode && sha[1]===current.sha)return false;
    throw new Error('E_APK_RELEASE');
  }
  if(metadata!==prefix+'version.json' || apk!==prefix+apkName(lane))throw new Error('E_APK_RELEASE');
  const m=JSON.parse((await get(metadata,16384)).body.toString('utf8'));
  return installRelease({root,lane,manifest:m,acquire:destination=>get(apk,MAX_APK,{destination})});
}
async function main() {
  const root=process.env.APK_PUBLIC_DIR;
  if(process.argv.length!==2 || !root || resolve(root)!==root || root==='/')throw new Error('E_APK_CONFIG');
  await mkdir(root,{recursive:true,mode:0o755});
  let failed=false;
  for(const lane of Object.keys(LANES)) {
    try { const changed=await syncLane(root,lane);process.stdout.write(`${lane}: ${changed?'published':'unchanged'}\n`); }
    catch {failed=true;process.stderr.write(`${lane}: E_APK_PUBLISH\n`);}
  }
  if(failed)process.exitCode=1;
}
if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url))
  main().catch(()=>{process.stderr.write('E_APK_PUBLISH\n');process.exitCode=1;});
