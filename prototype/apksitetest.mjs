#!/usr/bin/env node
/* global window, document, CustomEvent */
// Both distribution paths against the real built UI; network/install bridge is
// substituted, never a silent Android install or a contact to public GitHub.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync } from 'node:fs';
import { generateKeyPairSync, sign } from 'node:crypto';
import jsQR from 'jsqr';
import { launchBrowser, serve, builtPage, waitForApp } from './harnessKit.mjs';
const require=createRequire(import.meta.url);
const {PNG}=createRequire(require.resolve('qrcode/package.json'))('pngjs');
const config=JSON.parse(readFileSync('mobile/distribution.json','utf8'));
const root=config.origin+config.basePath;
const link=root+'/player/latest.apk';
const ANDROID_UA='Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36';
const IPHONE_UA='Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const fulfilApk=async(page)=>{let requested='';await page.route(link,async route=>{requested=route.request().url();await route.fulfill({contentType:'application/vnd.android.package-archive',headers:{'Content-Disposition':'attachment; filename=probe.apk'},body:'APK download fixture'});});return ()=>requested;};
const enterHub=async(page,nick,tap)=>{if(!(await page.locator('#cwnick').isVisible()))await page.locator('#clogin')[tap?'tap':'click']();await page.locator('#cwnick').fill(nick);await page.locator('#cwgo')[tap?'tap':'click']();await page.locator('#hub-play').waitFor({state:'visible'});};
// Hostile release notes must render as text, never as markup.
const hostileNotes='Changes <img src=x onerror="window.__xss=1">';
// The real key signs in CI only. The harness bakes its own public key into the served
// build so the actual WebCrypto check runs; a file signed by any other key must fail.
const testKey=generateKeyPairSync('ed25519'),strangerKey=generateKeyPairSync('ed25519');
const testPublic=Buffer.from(testKey.publicKey.export({format:'jwk'}).x,'base64url').toString('base64');
const withTestKey=html=>{const out=html.toString().replace(/manifestPublicKey:"[^"]*"/,`manifestPublicKey:"${testPublic}"`);assert.notEqual(out,html.toString(),'built page must carry the baked manifest key');return out;};
const signed=(m,key=testKey.privateKey)=>{const payload=Buffer.from(JSON.stringify(m));return {payload:payload.toString('base64'),signature:sign(null,payload,key).toString('base64')};};
const pages=await serve({'/':withTestKey(builtPage()),'/player':withTestKey(builtPage('void-dominion-player.html'))});
const browser=await launchBrowser();
const errors=[];mkdirSync('.playwright-mcp',{recursive:true});
try {
  for(const [profile,locale] of [['/','ru'],['/player','en']]) {
    const page=await browser.newPage({viewport:{width:1366,height:1000},locale});page.on('pageerror',e=>errors.push(e.message));
    await page.goto(pages.url+profile);await waitForApp(page);
    await enterHub(page,'APK download probe');
    // The button sits in the hub header next to the game mark; on a mouse PC hovering it opens the QR.
    await page.locator('.hub-banner #hub-android-download').waitFor({state:'visible'});
    assert.equal(await page.locator('#hub-android-download').getAttribute('href'),link);
    assert.equal((await page.locator('#hub-android-download').textContent()).trim(),locale==='ru'?'Скачать APK':'Download APK');
    assert.equal(await page.locator('#hub-android-qr').isVisible(),false,'QR opens on hover, not over the hub');
    await page.locator('#hub-android-download').hover();await page.locator('#hub-android-qr').waitFor({state:'visible'});
    assert.equal(await page.locator('#hub-android-qr').getAttribute('href'),link);
    const png=PNG.sync.read(await page.locator('#hub-android-qr svg').screenshot());
    assert.equal(jsQR(new Uint8ClampedArray(png.data),png.width,png.height)?.data,link,'QR must decode to the download URL');
    await page.screenshot({path:`.playwright-mcp/android-hub-${profile==='/'?'dev':'player'}.png`});
    const requested=await fulfilApk(page);
    const [download]=await Promise.all([page.waitForEvent('download'),page.locator('#hub-android-download').click()]);
    assert.equal(requested(),link);assert.equal(download.suggestedFilename(),'probe.apk');
    // Android phone browser: the same button in the one-line header, fully on screen and beside the mark.
    for(const width of [390,360,320]) {
      const phone=await browser.newPage({viewport:{width,height:844},hasTouch:true,isMobile:true,userAgent:ANDROID_UA,locale});phone.on('pageerror',e=>errors.push(e.message));
      await phone.goto(pages.url+profile);await waitForApp(phone);
      await enterHub(phone,'APK phone probe',true);
      const btn=await phone.locator('.hub-banner #hub-android-download').boundingBox(),mark=await phone.locator('.hub-bt').boundingBox();
      assert.ok(btn&&mark,'phone header shows the APK button');
      assert.ok(btn.x>=0&&btn.x+btn.width<=width,`APK button stays on screen at ${width}px`);
      assert.ok(mark.x+mark.width<=btn.x,`APK button sits beside the mark, not over it, at ${width}px`);
      assert.ok(mark.height<24,`the mark stays one line at ${width}px`);
      assert.equal(await phone.locator('#hub-android-qr').isVisible(),false,'a phone gets the file, not a QR');
      if(width===390){const asked=await fulfilApk(phone);const [file]=await Promise.all([phone.waitForEvent('download'),phone.locator('#hub-android-download').tap()]);assert.equal(asked(),link);assert.equal(file.suggestedFilename(),'probe.apk');await phone.screenshot({path:`.playwright-mcp/android-hub-phone-${profile==='/'?'dev':'player'}.png`});}
      await phone.close();
    }
    // iOS cannot install an APK: no button that leads to a file nothing can open.
    const iphone=await browser.newPage({viewport:{width:390,height:844},hasTouch:true,isMobile:true,userAgent:IPHONE_UA,locale});
    await iphone.goto(pages.url+profile);await waitForApp(iphone);await enterHub(iphone,'APK iPhone probe',true);
    assert.equal(await iphone.locator('#hub-android').count(),0,'iPhone must not be offered an APK');
    await iphone.close();await page.close();
  }
  for(const lane of ['alpha','player']) {
    for(const scenario of ['newer','forged','equal','older','offline']) {
      const page=await browser.newPage({viewport:{width:390,height:844},hasTouch:true,isMobile:true,locale:lane==='alpha'?'ru':'en'});page.on('pageerror',e=>errors.push(e.message));
      const vc=scenario==='newer'||scenario==='forged'?43:scenario==='equal'?42:41;
      const apkSha256='c'.repeat(64);
      const apkUrl=`${root}/${lane}/${vc}-deadbee/void-dominion-${lane}.apk`;
      let requests=0;
      await page.addInitScript(()=>{window.__BUILD__={versionCode:42,sha:'abc1234',versionName:'installed-42'};window.__installs=[];window.VoidNative={installVerified:(url,sha)=>{window.__installs.push([url,sha]);window.dispatchEvent(new CustomEvent('void-apk-update',{detail:'E_UPDATE_DIGEST'}));}};});
      await page.route(root+`/${lane}/latest.json`,async route=>{requests++;if(scenario==='offline')return route.abort('failed');return route.fulfill({contentType:'application/json',headers:{'Access-Control-Allow-Origin':'*'},body:JSON.stringify(signed({versionCode:vc,versionName:`${lane}-deadbee`,sha:'deadbee',apkUrl,notes:hostileNotes,apkSha256,appId:lane==='alpha'?'com.voiddominion.prototype':'com.voiddominion.player',signerSha256:config.signerSha256},scenario==='forged'?strangerKey.privateKey:undefined))});});
      await page.goto(pages.url+(lane==='player'?'/player':'/'));await waitForApp(page);
      await page.waitForFunction(()=>document.getElementById('cver')?.textContent?.includes('installed-42'));
      assert.equal(await page.locator('#hub-android').count(),0,'APK must not advertise another installation');
      if(scenario==='newer') {
        await page.locator('#updbar').waitFor({state:'visible'});assert.notEqual(await page.locator('#ub-go').getAttribute('href'),apkUrl,'no unverified plain-link download');
        assert.equal(await page.locator('#ub-notes').textContent(),hostileNotes);assert.equal(await page.locator('#ub-notes img').count(),0);assert.equal(await page.evaluate(()=>window.__xss),undefined);
        await page.locator('#ub-go').click();assert.deepEqual(await page.evaluate(()=>window.__installs),[[apkUrl,apkSha256]]);
        assert.equal(await page.locator('#ub-status').textContent(),lane==='alpha'?'✗ файл не совпал с подписанной версией, установка отменена':"✗ the file doesn't match the signed version, install cancelled");
        await page.screenshot({path:`.playwright-mcp/android-update-${lane}.png`});
        await page.locator('#ub-later').click();assert.equal(await page.locator('#updbar').isVisible(),false);
      } else { await page.waitForTimeout(250);assert.equal(await page.locator('#updbar').isVisible(),false); }
      assert.equal(requests,1);await page.close();
    }
  }
  assert.deepEqual(errors,[]);console.log('APK site: header download on desktop (hover QR decoded) and Android phones 390/360/320, none on iPhone (dev/player), APK newer/forged/equal/older/offline, signed manifest, verified native install handoff, safe notes: passed');
} finally {await browser.close();await pages.close();}
