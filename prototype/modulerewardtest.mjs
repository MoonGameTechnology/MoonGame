#!/usr/bin/env node
/* global window, document, getComputedStyle */
/** Browser contract of the production reward controller using confirmed-inventory fixtures.
 * No economy writes. Run: node prototype/modulerewardtest.mjs */
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { launchBrowser, serve } from './harnessKit.mjs';
const out = process.env.MODULE_REWARD_ARTIFACTS ?? '.playwright-mcp/module-rewards';
mkdirSync(out, { recursive: true });
const js = await build({
  stdin: {
    contents: `
 import { initModuleRewards } from './prototype/src/moduleRewards';
 import { setLocale } from './localization/runtime';
 setLocale(new URLSearchParams(location.search).get('lang') || 'ru');
 let key='server.alice', visible=true;
 const rewards=initModuleRewards({identity:()=>key,visible:()=>visible,
 read:k=>JSON.parse(localStorage.getItem(k)||'null'),write:(k,items)=>localStorage.setItem(k,JSON.stringify(items))});
 window.rewardTest={observe:items=>rewards.observe(items), hide:()=>{visible=false;rewards.hide()},
 show:()=>{visible=true;rewards.resume()}, account:k=>{key=k;rewards.resume()}};
 `,
    resolveDir: process.cwd(),
    loader: 'ts',
  },
  bundle: true,
  write: false,
  format: 'iife',
  define: { __SECTOR_ZERO_ONLY__: 'false' },
});
const closeCss =
  readFileSync('prototype/styles/02-windows.css', 'utf8')
    .match(/\.btn-x(?::[^{}]+)?\{[^}]*\}/g)
    ?.join('\n') ?? '';
const site = await serve({
  '/': `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>:root{--red:#e46c7a;--ink:#edf2ed}body{margin:0;min-height:100vh;background:#06131d;color:#cdd;font-family:system-ui}button{font:inherit} ${closeCss} ${readFileSync('prototype/profile.css', 'utf8')}</style></head><body><button id="start">Arsenal</button><dialog id="other"><button onclick="this.closest('dialog').close()">Medal</button></dialog><script>${js.outputFiles[0].text}</script></body></html>`,
});
const browser = await launchBrowser();
const item = (over = {}) => ({
  itemId: 'reward1',
  kind: 'module',
  form: 'instance',
  defId: 'shield_booster',
  grade: 1,
  origin: 'craft',
  soulbound: false,
  acquiredAt: 1,
  ...over,
});
const results = [];
try {
  for (const [lang, width, height, motion] of [
    ['ru', 1366, 900, 'no-preference'],
    ['en', 390, 844, 'no-preference'],
    ['ru', 390, 844, 'reduce'],
  ]) {
    const context = await browser.newContext({
      viewport: { width, height },
      reducedMotion: motion,
      isMobile: width < 600,
      hasTouch: width < 600,
    });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(site.url + '/?lang=' + lang);
    await page.waitForFunction(() => !!window.rewardTest);
    await page.locator('#start').focus();
    await page.evaluate(() => {
      window.rewardTest.observe([]);
      document.querySelector('#other').showModal();
    });
    await page.evaluate((items) => window.rewardTest.observe(items), [item()]);
    assert.equal(await page.locator('#module-reward').evaluate((el) => el.open), false);
    await page.locator('#other button').click();
    const dialog = page.locator('#module-reward');
    await dialog.waitFor({ state: 'visible' });
    assert.equal(
      await page
        .locator('[data-module-reward="next"]')
        .evaluate((el) => el === document.activeElement),
      true,
    );
    await page.screenshot({ path: resolve(out, `received-${lang}-${motion}.png`) });
    await page.locator('[data-module-reward="next"]').click();
    await page.evaluate((items) => window.rewardTest.observe(items), [item()]);
    assert.equal(await dialog.evaluate((el) => el.open), false);
    await page.evaluate((items) => window.rewardTest.observe(items), [item({ grade: 3 })]);
    await dialog.waitFor({ state: 'visible' });
    assert.equal(await page.locator('.mr-new').count(), 2);
    assert.equal(await page.locator('.mr-existing').count(), 1);
    assert.equal(
      await page.locator('.mr-grade').textContent(),
      lang === 'ru' ? 'Звёздность: 1 → 3' : 'Stars: 1 → 3',
    );
    if (motion === 'reduce')
      assert.equal(
        await page.locator('.mr-module').evaluate((el) => getComputedStyle(el).animationName),
        'none',
      );
    else
      await page
        .locator('.mr-new')
        .last()
        .evaluate(async (el) => Promise.all(el.getAnimations().map((a) => a.finished)));
    await page.screenshot({ path: resolve(out, `upgraded-${lang}-${motion}.png`) });
    const box = await dialog.boundingBox();
    assert.ok(box.x >= 0 && box.x + box.width <= width);
    await page.evaluate(() => window.rewardTest.hide());
    assert.equal(await dialog.evaluate((el) => el.open), false);
    await page.evaluate(() => window.rewardTest.show());
    await dialog.waitFor({ state: 'visible' });
    await page.evaluate(() => window.rewardTest.account('server.bob'));
    assert.equal(await dialog.evaluate((el) => el.open), false);
    await page.evaluate((items) => window.rewardTest.observe(items), [item({ grade: 3 })]);
    assert.equal(await dialog.evaluate((el) => el.open), false);
    await page.evaluate(() => window.rewardTest.account('server.alice'));
    await page.evaluate(
      (items) => window.rewardTest.observe(items),
      [item({ grade: 3 }), item({ itemId: 'second' })],
    );
    await dialog.waitFor({ state: 'visible' });
    await page.keyboard.press('Escape');
    assert.equal(await dialog.evaluate((el) => el.open), false);
    await page.reload();
    await page.waitForFunction(() => !!window.rewardTest);
    await page.evaluate(
      (items) => window.rewardTest.observe(items),
      [item({ grade: 3 }), item({ itemId: 'second' })],
    );
    assert.equal(await dialog.evaluate((el) => el.open), false);
    assert.deepEqual(errors, []);
    results.push({ lang, width, motion, passed: true });
    await context.close();
  }
  writeFileSync(resolve(out, 'results.json'), JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results));
} finally {
  await browser.close();
  await site.close();
}
