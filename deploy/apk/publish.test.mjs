import { describe, it, expect } from 'vitest';
import { mkdtemp, mkdir, writeFile, readFile, readlink, readdir, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash, generateKeyPairSync } from 'node:crypto';
import { createManifest, validateManifest, distribution, signManifest, openSignedManifest } from '../../mobile/apk-manifest.mjs';
import { download, installRelease, syncLane } from './publish.mjs';
import { apkIngress } from './ingress.mjs';
const { Response } = globalThis;
const bytes=Buffer.from('APK fixture bytes');const sha=createHash('sha256').update(bytes).digest('hex');
const manifest=(vc=1,lane='player')=>createManifest({lane,versionCode:vc,versionName:`${lane}-deadbee`,sha:'deadbee',notes:'Changes',apkSha256:sha,signerSha256:distribution.signerSha256});
const pair=()=>{const {privateKey,publicKey}=generateKeyPairSync('ed25519');
  return {pem:privateKey.export({type:'pkcs8',format:'pem'}),publicKey:Buffer.from(publicKey.export({format:'jwk'}).x,'base64url').toString('base64')};};
const keys=pair(),other=pair();
const signed=(m=manifest())=>signManifest(m,keys.pem);
const publicKey=keys.publicKey;
const acquire=async path=>{await writeFile(path,bytes);return {bytes:bytes.length,sha256:sha};};
const verify=async()=>{};
describe('verified atomic site publication',()=>{
  it.each([6*1024**3, 6*1024**3+128*1024**2, NaN])('preserves current without downloading when available bytes are %s',async available=>{
    const root=await mkdtemp(join(tmpdir(),'apk-disk-'));
    try {
      await installRelease({root,lane:'player',signed:signed(),publicKey,acquire,verify,checkSpace:false});
      let downloads=0;
      await expect(installRelease({root,lane:'player',signed:signed(manifest(2)),publicKey,verify,
        statfsImpl:async()=>({bavail:available,bsize:1}),
        acquire:async path=>{downloads++;return acquire(path);}})).rejects.toThrow('E_APK_DISK');
      expect(downloads).toBe(0);
      expect(await readlink(join(root,'player/current'))).toBe('1-deadbee');
      expect((await readdir(join(root,'player'))).filter(x=>x.startsWith('.'))).toEqual([]);
    } finally {await rm(root,{recursive:true,force:true});}
  });
  it.each([6*1024**3+129*1024**2, Math.floor(6.2*1024**3)])('publishes with the six-GiB reserve and staging allowance at %s free bytes',async available=>{
    const root=await mkdtemp(join(tmpdir(),'apk-disk-safe-'));
    try {
      expect(await installRelease({root,lane:'player',signed:signed(),publicKey,acquire,verify,
        statfsImpl:async()=>({bavail:available,bsize:1})})).toBe(true);
      expect(await readlink(join(root,'player/current'))).toBe('1-deadbee');
    } finally {await rm(root,{recursive:true,force:true});}
  });
  it('pairs the stable APK and version through a single pointer; preserves old immutable APKs',async()=>{
    const root=await mkdtemp(join(tmpdir(),'apk-publish-'));
    try {
      const install=(vc)=>installRelease({root,lane:'player',signed:signed(manifest(vc)),publicKey,acquire,verify,checkSpace:false});
      expect(await install(1)).toBe(true);
      expect(await readlink(join(root,'player','current'))).toBe('1-deadbee');
      expect(openSignedManifest(JSON.parse(await readFile(join(root,'player/current/latest.json'),'utf8')),'player',publicKey).manifest.versionCode).toBe(1);
      expect(await readFile(join(root,'player/current/latest.apk'))).toEqual(bytes);
      expect(await install(2)).toBe(true);
      expect(openSignedManifest(JSON.parse(await readFile(join(root,'player/current/latest.json'),'utf8')),'player',publicKey).manifest.versionCode).toBe(2);
      expect(await readFile(join(root,'player/1-deadbee/void-dominion-player.apk'))).toEqual(bytes);
      expect(await install(1)).toBe(false);
      expect(await install(2)).toBe(false);
    } finally {await rm(root,{recursive:true,force:true});}
  });
  it.each(['interrupted','digest','signature'])('keeps previous APK+JSON when %s fails',async(kind)=>{
    const root=await mkdtemp(join(tmpdir(),'apk-failure-'));
    try {
      await installRelease({root,lane:'player',signed:signed(),publicKey,acquire,verify,checkSpace:false});
      const badAcquire=kind==='interrupted'?async()=>{throw Error('network');}:kind==='digest'?async path=>{await acquire(path);return {bytes:bytes.length,sha256:'0'.repeat(64)};}:acquire;
      const badVerify=kind==='signature'?async()=>{throw Error('E_APK_SIGNER');}:verify;
      await expect(installRelease({root,lane:'player',signed:signed(manifest(2)),publicKey,acquire:badAcquire,verify:badVerify,checkSpace:false})).rejects.toThrow();
      expect(await readlink(join(root,'player/current'))).toBe('1-deadbee');
      expect((await readdir(join(root,'player'))).filter(x=>x.startsWith('.'))).toEqual([]);
    } finally {await rm(root,{recursive:true,force:true});}
  });
  it('rejects changing APK bytes under an existing versionCode',async()=>{
    const root=await mkdtemp(join(tmpdir(),'apk-reuse-'));
    try {
      await installRelease({root,lane:'player',signed:signed(),publicKey,acquire,verify,checkSpace:false});
      await expect(installRelease({root,lane:'player',signed:signed({...manifest(),apkSha256:'0'.repeat(64)}),publicKey,acquire,verify,checkSpace:false})).rejects.toThrow('E_APK_VERSION_REUSE');
    } finally {await rm(root,{recursive:true,force:true});}
  });
  it('replaces a build signed by the previous APK certificate, but never publishes one',async()=>{
    const root=await mkdtemp(join(tmpdir(),'apk-rekey-'));
    try {
      const old={...manifest(1),signerSha256:distribution.previousSignerSha256};
      await mkdir(join(root,'player/1-deadbee'),{recursive:true});
      await writeFile(join(root,'player/1-deadbee/latest.json'),JSON.stringify(signed(old)));
      await symlink('1-deadbee',join(root,'player/current'));
      await expect(installRelease({root,lane:'player',signed:signed({...old,versionCode:2,apkUrl:manifest(2).apkUrl}),publicKey,acquire,verify,checkSpace:false})).rejects.toThrow('E_APK_MANIFEST');
      expect(await installRelease({root,lane:'player',signed:signed(manifest(2)),publicKey,acquire,verify,checkSpace:false})).toBe(true);
      expect(await readlink(join(root,'player/current'))).toBe('2-deadbee');
    } finally {await rm(root,{recursive:true,force:true});}
  });
  it('rejects wrong signer, package, lane or asset path before publishing',()=>{
    for(const patch of [{signerSha256:'0'.repeat(64)},{appId:'com.other.app'},{apkUrl:'https://evil.test/a.apk'},{versionCode:0}])
      expect(()=>validateManifest({...manifest(),...patch},'player')).toThrow('E_APK_MANIFEST');
    expect(()=>validateManifest(manifest(),'alpha')).toThrow();
  });
  it('publishes only what the CI key signed, byte for byte',async()=>{
    const root=await mkdtemp(join(tmpdir(),'apk-signed-'));
    try {
      const good=signed();
      const forged=[signManifest(manifest(),other.pem),{...good,payload:signed(manifest(2)).payload},{payload:good.payload},{...good,signature:good.signature.slice(4)}];
      for(const bad of forged)
        await expect(installRelease({root,lane:'player',signed:bad,publicKey,acquire,verify,checkSpace:false})).rejects.toThrow();
      expect(await readdir(root)).toEqual([]);
      await installRelease({root,lane:'player',signed:{...good,extra:'x'},publicKey,acquire,verify,checkSpace:false});
      const published=JSON.parse(await readFile(join(root,'player/current/latest.json'),'utf8'));
      expect(published).toEqual({payload:good.payload,signature:good.signature});
      expect(openSignedManifest(published,'player',publicKey).manifest).toEqual(manifest());
      expect(()=>openSignedManifest(good,'alpha',publicKey)).toThrow();
    } finally {await rm(root,{recursive:true,force:true});}
  });
  it('drops unknown remote metadata rather than publishing secrets',()=>expect(validateManifest({...manifest(),extra:'secret'},'player')).not.toHaveProperty('extra'));
});
describe('bounded upstream transport',()=>{
  it('requests binary asset API responses and keeps JSON headers for release discovery',async()=>{
    const calls=[];
    const fetchImpl=async(url,options)=>{
      calls.push({url,accept:options.headers.Accept});
      return calls.length===1
        ? new Response(null,{status:302,headers:{location:'https://release-assets.githubusercontent.com/test'}})
        : new Response(bytes);
    };
    await download('https://api.github.com/repos/MoonGameTechnology/MoonGame/releases/assets/101',1024,{fetchImpl});
    expect(calls.map(x=>x.accept)).toEqual(['application/octet-stream','application/octet-stream']);
    await download('https://api.github.com/repos/MoonGameTechnology/MoonGame/releases/tags/player',1024,{fetchImpl});
    expect(calls.at(-1).accept).toBe('application/vnd.github+json');
  });
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

describe('immutable release snapshot transport',()=>{
  const repo='https://api.github.com/repos/MoonGameTechnology/MoonGame';
  const release=(lane='player')=>({tag_name:lane,assets:[
    {id:101,name:'version.json',browser_download_url:`https://github.com/MoonGameTechnology/MoonGame/releases/download/${lane}/version.json`},
    {id:102,name:`void-dominion-${lane}.apk`,browser_download_url:`https://github.com/MoonGameTechnology/MoonGame/releases/download/${lane}/void-dominion-${lane}.apk`},
  ]});
  it.each(['alpha','player'])('publishes %s using the selected IDs even when rolling-tag downloads are unavailable',async lane=>{
    const root=await mkdtemp(join(tmpdir(),'apk-assets-'));const calls=[];
    try {
      const m=manifest(2,lane);
      const get=async(url,limit,options)=>{
        calls.push(url);
        if(url===`${repo}/releases/tags/${lane}`)return {body:Buffer.from(JSON.stringify(release(lane)))};
        if(url===`${repo}/releases/assets/101`)return {body:Buffer.from(JSON.stringify(signed(m)))};
        if(url===`${repo}/releases/assets/102`)return acquire(options.destination);
        throw Error('E_ROLLING_URL_UNAVAILABLE');
      };
      let verified=0;
      expect(await syncLane(root,lane,{get,publicKey,statfsImpl:async()=>({bavail:8*1024**3,bsize:1}),verify:async(path,value)=>{
        expect(await readFile(path)).toEqual(bytes);expect(value).toEqual(m);verified++;
      }})).toBe(true);
      expect(verified).toBe(1);
      expect(calls).toEqual([`${repo}/releases/tags/${lane}`,`${repo}/releases/assets/101`,`${repo}/releases/assets/102`]);
      expect(await readlink(join(root,lane,'current'))).toBe('2-deadbee');
    }finally {await rm(root,{recursive:true,force:true});}
  });
  it.each([0,-1,1.5,'101',null,Number.MAX_SAFE_INTEGER+1])('rejects invalid asset id %s before acquiring files',async id=>{
    const root=await mkdtemp(join(tmpdir(),'apk-bad-id-'));
    try {
      const data=release();data.assets[0].id=id;let calls=0;
      await expect(syncLane(root,'player',{publicKey,get:async()=>{calls++;return {body:Buffer.from(JSON.stringify(data))};}})).rejects.toThrow('E_APK_RELEASE');
      expect(calls).toBe(1);expect(await readdir(root)).toEqual([]);
    }finally {await rm(root,{recursive:true,force:true});}
  });
  it('refuses asset substitution and preserves current when metadata cannot be downloaded',async()=>{
    const root=await mkdtemp(join(tmpdir(),'apk-source-fail-'));
    try {
      await installRelease({root,lane:'player',signed:signed(),publicKey,acquire,verify,checkSpace:false});
      const data=release();data.assets[1].browser_download_url='https://evil.test/app.apk';
      await expect(syncLane(root,'player',{publicKey,get:async()=>({body:Buffer.from(JSON.stringify(data))})})).rejects.toThrow('E_APK_RELEASE');
      await expect(syncLane(root,'player',{publicKey,get:async url=>{
        if(url===`${repo}/releases/tags/player`)return {body:Buffer.from(JSON.stringify(release()))};
        throw Error('E_APK_SOURCE');
      }})).rejects.toThrow('E_APK_SOURCE');
      expect(await readlink(join(root,'player/current'))).toBe('1-deadbee');
    }finally {await rm(root,{recursive:true,force:true});}
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
  await installRelease({root,lane:'player',signed:signed(),publicKey,acquire,verify,checkSpace:false});
  const legacy=vc=>({get:async()=>({body:Buffer.from(JSON.stringify({tag_name:'player',body:`<!-- void:versionCode=${vc} void:sha=deadbee -->`,assets:[]}))})});
  expect(await syncLane(root,'player',{...legacy(1),publicKey})).toBe(false);
  await expect(syncLane(root,'player',{...legacy(2),publicKey})).rejects.toThrow('E_APK_RELEASE');
  expect(await readlink(join(root,'player/current'))).toBe('1-deadbee');
 } finally {await rm(root,{recursive:true,force:true});}
});

it('recovers staging left by a killed publisher without deleting the current release',async()=>{
 const root=await mkdtemp(join(tmpdir(),'apk-orphan-'));
 try {
  await installRelease({root,lane:'player',signed:signed(),publicKey,acquire,verify,checkSpace:false});
  const orphan=join(root,'player','.incoming-'+ 'a'.repeat(24));await mkdir(orphan);await writeFile(join(orphan,'partial.apk'),'incomplete');
  expect(await installRelease({root,lane:'player',signed:signed(),publicKey,acquire,verify,checkSpace:false})).toBe(false);
  expect((await readdir(join(root,'player'))).some(x=>x.startsWith('.incoming-'))).toBe(false);
  expect(await readlink(join(root,'player/current'))).toBe('1-deadbee');
 } finally {await rm(root,{recursive:true,force:true});}
});
