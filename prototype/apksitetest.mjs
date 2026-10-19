#!/usr/bin/env node
/* global window, document */
// Both distribution paths against the real built UI; network/install bridge is
// substituted, never a silent Android install or a contact to public GitHub.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync } from 'node:fs';
import jsQR from 'jsqr';
import { launchBrowser, serve, builtPage, waitForApp } from './harnessKit.mjs';
const require=createRequire(import.meta.url);
const {PNG}=createRequire(require.resolve('qrcode/package.json'))('pngjs');
const config=JSON.parse(readFileSync('mobile/distribution.json','utf8'));
const root=config.origin+config.basePath;
const link=root+'/player/latest.apk';
const pages=await serve({'/':builtPage(),'/player':builtPage('void-dominion-player.html')});
const browser=await launchBrowser();
const errors=[];mkdirSync('.playwright-mcp',{recursive:true});
try {
  for(const [profile,locale] of [['/','ru'],['/player','en']]) {
    const page=await browser.newPage({viewport:{width:1366,height:1000},locale});page.on('pageerror',e=>errors.push(e.message));
    await page.goto(pages.url+profile);await waitForApp(page);
    if(!(await page.locator('#cwnick').isVisible()))await page.locator('#clogin').click();
    await page.locator('#cwnick').fill('APK download probe');await page.locator('#cwgo').click();
    await page.locator('#hub-android').waitFor({state:'visible'});
    assert.equal(await page.locator('#hub-android-download').getAttribute('href'),link);
    assert.equal(await page.locator('#hub-android-download').textContent(),locale==='ru'?'Скачать APK':'Download APK');
    assert.equal(await page.locator('#hub-android-qr').getAttribute('href'),link);
    const png=PNG.sync.read(await page.locator('#hub-android-qr svg').screenshot());
    assert.equal(jsQR(new Uint8ClampedArray(png.data),png.width,png.height)?.data,link,'QR must decode to the download URL');
    await page.locator('#hub-android').screenshot({path:`.playwright-mcp/android-hub-${profile==='/'?'dev':'player'}.png`});
    let requested='';await page.route(link,async route=>{requested=route.request().url();await route.fulfill({contentType:'application/vnd.android.package-archive',headers:{'Content-Disposition':'attachment; filename=probe.apk'},body:'APK download fixture'});});
    const [download]=await Promise.all([page.waitForEvent('download'),page.locator('#hub-android-download').click()]);
    assert.equal(requested,link);assert.equal(download.suggestedFilename(),'probe.apk');
    // The desktop promotion is hidden for touch phones.
    const phone=await browser.newPage({viewport:{width:390,height:844},hasTouch:true,isMobile:true});
    await phone.goto(pages.url+profile);await waitForApp(phone);
    if(!(await phone.locator('#cwnick').isVisible()))await phone.locator('#clogin').tap();
    await phone.locator('#cwnick').fill('APK phone probe');await phone.locator('#cwgo').tap();
    await phone.locator('#hub-play').waitFor({state:'visible'});assert.equal(await phone.locator('#hub-android').isVisible(),false);await phone.close();await page.close();
  }
  for(const lane of ['alpha','player']) {
    for(const scenario of ['newer','equal','older','offline']) {
      const page=await browser.newPage({viewport:{width:390,height:844},hasTouch:true,isMobile:true,locale:lane==='alpha'?'ru':'en'});page.on('pageerror',e=>errors.push(e.message));
      const vc=scenario==='newer'?43:scenario==='equal'?42:41;
      const apkUrl=`${root}/${lane}/${vc}-deadbee/void-dominion-${lane}.apk`;
      let requests=0;
      await page.addInitScript(()=>{window.__BUILD__={versionCode:42,sha:'abc1234',versionName:'installed-42'};window.__opened=[];window.VoidNative={open:url=>window.__opened.push(url)};});
      await page.route(root+`/${lane}/latest.json`,async route=>{requests++;if(scenario==='offline')return route.abort('failed');return route.fulfill({contentType:'application/json',headers:{'Access-Control-Allow-Origin':'*'},body:JSON.stringify({versionCode:vc,versionName:`${lane}-deadbee`,sha:'deadbee',apkUrl,notes:'Changes <script>not executable</script>'})});});
      await page.goto(pages.url+(lane==='player'?'/player':'/'));await waitForApp(page);
      await page.waitForFunction(()=>document.getElementById('cver')?.textContent?.includes('installed-42'));
      assert.equal(await page.locator('#hub-android').count(),0,'APK must not advertise another installation');
      if(scenario==='newer') {
        await page.locator('#updbar').waitFor({state:'visible'});assert.equal(await page.locator('#ub-go').getAttribute('href'),apkUrl);
        assert.equal(await page.locator('#ub-notes').textContent(),'Changes <script>not executable</script>');assert.equal(await page.locator('#ub-notes script').count(),0);
        await page.locator('#ub-go').click();assert.deepEqual(await page.evaluate(()=>window.__opened),[apkUrl]);
        await page.screenshot({path:`.playwright-mcp/android-update-${lane}.png`});
        await page.locator('#ub-later').click();assert.equal(await page.locator('#updbar').isVisible(),false);
      } else { await page.waitForTimeout(250);assert.equal(await page.locator('#updbar').isVisible(),false); }
      assert.equal(requests,1);await page.close();
    }
  }
  assert.deepEqual(errors,[]);console.log('APK site: desktop download + decoded QR (dev/player), APK newer/equal/older/offline, native browser handoff, safe notes: passed');
} finally {await browser.close();await pages.close();}
