import { describe, it, expect } from 'vitest';
import { mkdtemp, mkdir, writeFile, readFile, readlink, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { createManifest, validateManifest, distribution } from '../../mobile/apk-manifest.mjs';
import { download, installRelease, syncLane } from './publish.mjs';
import { apkIngress } from './ingress.mjs';
const { Response } = globalThis;
const bytes=Buffer.from('APK fixture bytes');const sha=createHash('sha256').update(bytes).digest('hex');
const manifest=(vc=1,lane='player')=>createManifest({lane,versionCode:vc,versionName:`${lane}-deadbee`,sha:'deadbee',notes:'Changes',apkSha256:sha,signerSha256:distribution.signerSha256});
const acquire=async path=>{await writeFile(path,bytes);return {bytes:bytes.length,sha256:sha};};
const verify=async()=>{};
describe('verified atomic site publication',()=>{
  it('pairs the stable APK and version through a single pointer; preserves old immutable APKs',async()=>{
    const root=await mkdtemp(join(tmpdir(),'apk-publish-'));
    try {
      const install=(vc)=>installRelease({root,lane:'player',manifest:manifest(vc),acquire,verify,checkSpace:false});
      expect(await install(1)).toBe(true);
      expect(await readlink(join(root,'player','current'))).toBe('1-deadbee');
      expect(JSON.parse(await readFile(join(root,'player/current/latest.json'),'utf8')).versionCode).toBe(1);
      expect(await readFile(join(root,'player/current/latest.apk'))).toEqual(bytes);
      expect(await install(2)).toBe(true);
      expect(JSON.parse(await readFile(join(root,'player/current/latest.json'),'utf8')).versionCode).toBe(2);
      expect(await readFile(join(root,'player/1-deadbee/void-dominion-player.apk'))).toEqual(bytes);
      expect(await install(1)).toBe(false);
      expect(await install(2)).toBe(false);
    } finally {await rm(root,{recursive:true,force:true});}
  });
  it.each(['interrupted','digest','signature'])('keeps previous APK+JSON when %s fails',async(kind)=>{
    const root=await mkdtemp(join(tmpdir(),'apk-failure-'));
    try {
      await installRelease({root,lane:'player',manifest:manifest(),acquire,verify,checkSpace:false});
      const badAcquire=kind==='interrupted'?async()=>{throw Error('network');}:kind==='digest'?async path=>{await acquire(path);return {bytes:bytes.length,sha256:'0'.repeat(64)};}:acquire;
      const badVerify=kind==='signature'?async()=>{throw Error('E_APK_SIGNER');}:verify;
      await expect(installRelease({root,lane:'player',manifest:manifest(2),acquire:badAcquire,verify:badVerify,checkSpace:false})).rejects.toThrow();
      expect(await readlink(join(root,'player/current'))).toBe('1-deadbee');
      expect((await readdir(join(root,'player'))).filter(x=>x.startsWith('.'))).toEqual([]);
    } finally {await rm(root,{recursive:true,force:true});}
  });
  it('rejects changing APK bytes under an existing versionCode',async()=>{
    const root=await mkdtemp(join(tmpdir(),'apk-reuse-'));
    try {
      await installRelease({root,lane:'player',manifest:manifest(),acquire,verify,checkSpace:false});
      await expect(installRelease({root,lane:'player',manifest:{...manifest(),apkSha256:'0'.repeat(64)},acquire,verify,checkSpace:false})).rejects.toThrow('E_APK_VERSION_REUSE');
    } finally {await rm(root,{recursive:true,force:true});}
  });
  it('rejects wrong signer, package, lane or asset path before publishing',()=>{
    for(const patch of [{signerSha256:'0'.repeat(64)},{appId:'com.other.app'},{apkUrl:'https://evil.test/a.apk'},{versionCode:0}])
      expect(()=>validateManifest({...manifest(),...patch},'player')).toThrow('E_APK_MANIFEST');
    expect(()=>validateManifest(manifest(),'alpha')).toThrow();
  });
  it('drops unknown remote metadata rather than publishing secrets',()=>expect(validateManifest({...manifest(),extra:'secret'},'player')).not.toHaveProperty('extra'));
});
describe('bounded upstream transport',()=>{
  it('does not follow asset redirects to arbitrary hosts',async()=>{
    let calls=0;
    await expect(download('https://github.com/x',100,{fetchImpl:async()=>{calls++;return new Response(null,{status:302,headers:{location:'https://evil.test/a.apk'}});}})).rejects.toThrow('E_APK_SOURCE');
    expect(calls).toBe(1);
  });
  it('caps bodies without trusting content-length',async()=>{
    await expect(download('https://api.github.com/x',10,{fetchImpl:async()=>new Response('x'.repeat(11))})).rejects.toThrow('E_APK_SIZE');
  });
  it('streams allowed HTTPS files and calculates exact SHA-256',async()=>{
    const r=await download('https://github.com/x',1024,{fetchImpl:async()=>new Response(bytes)});
    expect(r.sha256).toBe(sha);expect(r.body).toEqual(bytes);
  });
});
it('renders a public CORS/no-cache file-only ingress with stable aliases',()=>{
  const site=apkIngress('/data/moongame-apk');
  expect(site).toContain('Access-Control-Allow-Origin "*"');
  expect(site).toContain('Cache-Control "no-store"');
  expect(site).toContain('current/{re.apkAlias.2}');
  expect(site).not.toContain('browse');
  expect(()=>apkIngress('/data/../private')).toThrow();
});

it('keeps a verified legacy release unchanged but refuses any unmanifested newer build',async()=>{
 const root=await mkdtemp(join(tmpdir(),'apk-migration-'));
 try {
  await installRelease({root,lane:'player',manifest:manifest(),acquire,verify,checkSpace:false});
  const legacy=vc=>({get:async()=>({body:Buffer.from(JSON.stringify({tag_name:'player',body:`<!-- void:versionCode=${vc} void:sha=deadbee -->`,assets:[]}))})});
  expect(await syncLane(root,'player',legacy(1))).toBe(false);
  await expect(syncLane(root,'player',legacy(2))).rejects.toThrow('E_APK_RELEASE');
  expect(await readlink(join(root,'player/current'))).toBe('1-deadbee');
 } finally {await rm(root,{recursive:true,force:true});}
});

it('recovers staging left by a killed publisher without deleting the current release',async()=>{
 const root=await mkdtemp(join(tmpdir(),'apk-orphan-'));
 try {
  await installRelease({root,lane:'player',manifest:manifest(),acquire,verify,checkSpace:false});
  const orphan=join(root,'player','.incoming-'+ 'a'.repeat(24));await mkdir(orphan);await writeFile(join(orphan,'partial.apk'),'incomplete');
  expect(await installRelease({root,lane:'player',manifest:manifest(),acquire,verify,checkSpace:false})).toBe(false);
  expect((await readdir(join(root,'player'))).some(x=>x.startsWith('.incoming-'))).toBe(false);
  expect(await readlink(join(root,'player/current'))).toBe('1-deadbee');
 } finally {await rm(root,{recursive:true,force:true});}
});
