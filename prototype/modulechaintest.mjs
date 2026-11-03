#!/usr/bin/env node
/* global window, document, innerWidth */
/** Real economy services + production UI controllers, isolated localhost fixtures. */
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { launchBrowser } from './harnessKit.mjs';
const out = process.env.MODULE_CHAIN_ARTIFACTS ?? '.playwright-mcp/module-chain';
mkdirSync(out, { recursive: true });
mkdirSync('packages/server/dist', { recursive: true });
const serviceFile = resolve('packages/server/dist/module-chain-service.mjs');
await build({
  stdin: {
    resolveDir: process.cwd(),
    contents: `
import Fastify from 'fastify';
import { MetaEconomy } from './packages/server/src/metaEconomy';
import { MemoryMetaMarket } from './packages/server/src/metaMarket';
import { MemoryMetaEconomyStore } from './packages/server/src/metaEconomyStore';
import { MemoryArsenalStore, MemoryDropStore } from './packages/server/src/store';
import { loadShippedData, loadDropTables } from './packages/server/src/scenario';
import { loadMetaEconomyCatalog } from './packages/server/src/metaEconomyCatalog';
import { registerMetaEconomyApi } from './packages/server/src/metaEconomyApi';
import { registerMetaMarketApi } from './packages/server/src/metaMarketApi';
const data=loadShippedData();
export async function stand() {
 const arsenal=new MemoryArsenalStore(), market=new MemoryMetaMarket(arsenal), store=new MemoryMetaEconomyStore(arsenal,new MemoryDropStore(),market);
 market.setEconomy(store);
 const economy=new MetaEconomy({store,catalog:loadMetaEconomyCatalog(data),dropTables:loadDropTables(data),moduleData:data});
 for(const id of ['alice','bob']) await store.transaction([id],async tx=>{await tx.creditWarrants(id,1000,'fixture','fixture',0);tx.account(id).moduleBlueprints={unique:1};});
 for(let n=0;n<10;n++) await arsenal.grant({accountId:'alice',itemId:n?'copy'+n:'target',kind:'module',form:'instance',defId:'cargo_bay',origin:'craft',soulbound:false,acquiredAt:0});
 const app=Fastify();const identify=async r=>['alice','bob'].includes(r.headers.authorization?.slice(7))?{accountId:r.headers.authorization.slice(7),login:r.headers.authorization.slice(7)}:null;
 registerMetaEconomyApi(app,{economy,identify,rateMax:100});registerMetaMarketApi(app,{market,identify,rateMax:100,shelf:async()=>({open:6,lockedXp:[3850,6750]})});
 app.get('/commerce/offers',async()=>({offers:[]}));
 return {app,arsenal,market,economy};
}`,
    loader: 'ts',
  },
  bundle: true,
  platform: 'node',
  format: 'esm',
  packages: 'external',
  alias: {
    '@void/shared-core': resolve('packages/shared-core/src/index.ts'),
    '@void/protocol': resolve('packages/protocol/src/index.ts'),
  },
  outfile: serviceFile,
});
const { stand } = await import(pathToFileURL(serviceFile).href);
const ui = await build({
  stdin: {
    resolveDir: process.cwd(),
    contents: `
import { initArsenal } from './prototype/src/arsenalScreen';
import { initModuleRewards } from './prototype/src/moduleRewards';
import { initMetaMarket } from './prototype/src/metaMarketScreen';
import { setLocale } from './localization/runtime';
setLocale(new URLSearchParams(location.search).get('lang') || 'ru');
let actor='alice', cache=[]; const history=new Map(); const rewards=initModuleRewards({identity:()=>actor,visible:()=>true,read:k=>history.get(k),write:(k,v)=>history.set(k,v)}); const auth=async()=>({base:location.origin,token:actor});
const arRoot=document.querySelector('#hp-arsenal'), mmRoot=document.querySelector('#hp-auction');
const showMarket=async()=>{arsenal.close();arRoot.hidden=true;mmRoot.hidden=false;await market.refresh();};
const arsenal=initArsenal({root:()=>arRoot,sheet:()=>document.querySelector('#arsenal-sheet'),narrow:()=>innerWidth<700,readCache:()=>cache,writeCache:i=>{cache=i;},confirmed:i=>rewards.observe(i),authorizedBase:auth,canSignIn:()=>false,signIn:()=>{},openCodex:()=>{},openSeason:()=>{},openStore:()=>{},openAuction:showMarket,sell:id=>{market.focusSell(id);void showMarket();}});
const market=initMetaMarket({root:()=>mmRoot,arsenal:()=>arsenal.items(),authorizedBase:auth,note:m=>{document.querySelector('#notice').textContent=m;},inventoryChanged:()=>arsenal.refresh()});
window.moduleChain={ready:arsenal.refresh(),showMarket,actor:async id=>{actor=id;cache=[];arsenal.forget();await arsenal.refresh();await showMarket();}};
`,
    loader: 'ts',
  },
  bundle: true,
  write: false,
  loader: { '.webp': 'dataurl', '.png': 'dataurl' },
  format: 'iife',
  define: { __SECTOR_ZERO_ONLY__: 'false' },
});
const css =
  readFileSync('prototype/profile.css', 'utf8') +
  readdirSync('prototype/styles')
    .filter((f) => f.endsWith('.css'))
    .sort()
    .map((f) => readFileSync('prototype/styles/' + f, 'utf8'))
    .join('\n');
const html = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}\nhtml,body{height:100%;overflow:auto}body{padding:20px;background:#06131d}#hp-arsenal,#hp-auction{display:flex;flex-direction:column;max-width:1200px;margin:auto;height:calc(100vh - 40px)}[hidden]{display:none!important}#notice{position:fixed;bottom:0}</style></head><body><section id="hp-arsenal"></section><section id="hp-auction" hidden></section><div id="arsenal-sheet"></div><div id="notice" role="status"></div><script src="/test.js"></script></body></html>`;
const browser = await launchBrowser();
const results = [];
try {
  for (const [width, height, lang] of [
    [1360, 1000, 'ru'],
    [390, 844, 'en'],
  ]) {
    const f = await stand();
    f.app.get('/', async (_r, reply) => reply.type('text/html').send(html));
    f.app.get('/test.js', async (_r, reply) =>
      reply.type('application/javascript').send(ui.outputFiles[0].text),
    );
    await f.app.listen({ host: '127.0.0.1', port: 0 });
    const url = `http://127.0.0.1:${f.app.server.address().port}`;
    const context = await browser.newContext({
      viewport: { width, height },
      reducedMotion: width < 700 ? 'reduce' : 'no-preference',
    });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    try {
      await page.goto(url + '/?lang=' + lang);
      await page.evaluate(() => window.moduleChain.ready);
      await page.locator('[data-ar-module="cargo_bay"]').click();
      await page.locator('[data-ar-select="target"]').click();
      await page.waitForFunction(
        () => document.querySelectorAll('[data-ar-select="target"]').length === 0,
      );
      await page.locator('[data-ar-upgrade="target"][data-ar-mode="stars"]').click();
      await page.locator('[data-ar-upgrade-do]').click();
      await page.locator('#module-reward[open]').waitFor();
      assert.equal((await f.arsenal.get('target')).grade, 1);
      await page.locator('.module-reveal').evaluate(async (el) => {
        await Promise.all(
          el
            .getAnimations({ subtree: true })
            .filter((a) => a.effect.getTiming().iterations !== Infinity)
            .map((a) => a.finished),
        );
      });
      await page.screenshot({ path: resolve(out, `upgrade-${width}.png`), fullPage: true });
      await page.locator('[data-module-reward="next"]').click();
      await page.locator('[data-ar-upgrade="target"][data-ar-mode="rarity"]').click();
      await page.locator('[data-ar-upgrade-do]').click();
      await page.waitForFunction(() => document.querySelector('.mi-reward .r-unique') !== null);
      assert.equal((await f.arsenal.get('target')).rarity, 'unique');
      await page.locator('#module-reward[open] .rarity-unique').waitFor();
      await page.locator('[data-module-reward="next"]').click();
      await page.locator('[data-ar-sell="target"]').click();
      await page.locator('[data-mm-price="target"]').fill('180');
      if (!(await page.locator('[data-mm-net="target"]').textContent()).includes('165'))
        throw new Error('sale quote does not follow the price');
      await page.screenshot({ path: resolve(out, `auction-sell-${width}.png`) });
      await page.locator('[data-mm-list="target"]').click();
      await page.locator('[data-mm-cancel]').waitFor();
      await page.evaluate(() => window.moduleChain.actor('bob'));
      await page.locator('[data-mm-cat="utility"]').click();
      await page.screenshot({ path: resolve(out, `auction-buy-${width}.png`) });
      await page.locator('[data-mm-open="module:instance:cargo_bay"]').click();
      assert.equal(await page.locator('[data-mm-buy]').count(), 1);
      await page.screenshot({ path: resolve(out, `auction-${width}.png`), fullPage: true });
      await page.locator('[data-mm-buy]').click();
      await page.waitForFunction(() => !document.querySelector('[data-mm-buy]'));
      await page.locator('#module-reward[open] .rarity-unique').waitFor();
      await page.locator('[data-module-reward="next"]').click();
      // Торги: alice выставляет копию на 12 часов, bob ставит минимум.
      await page.evaluate(() => window.moduleChain.actor('alice'));
      await page.locator('[data-mm-tab="sell"]').click();
      await page.locator('[data-mm-open^="item:"]').first().click();
      await page.locator('[data-mm-mode="bid"]').click();
      await page.locator('[data-mm-price]').fill('120');
      await page.locator('[data-mm-hours="12"]').click();
      await page.locator('[data-mm-auction-open]').click();
      await page.locator('.mm-slot.used .mm-timer').waitFor();
      await page.screenshot({ path: resolve(out, `auction-shelf-${width}.png`) });
      await page.evaluate(() => window.moduleChain.actor('bob'));
      await page.locator('[data-mm-tab="bids"]').click();
      await page.locator('[data-mm-open^="bid:"]').click();
      await page.screenshot({ path: resolve(out, `auction-bid-${width}.png`) });
      await page.locator('[data-mm-bid]').click();
      await page.locator('.mm-pill.lead').waitFor();
      await page.screenshot({ path: resolve(out, `auction-bids-${width}.png`) });
      // Заказ: bob заказывает модуль, видит заморозку во вкладке «Мои» и отменяет заказ.
      await page.locator('[data-mm-tab="mine"]').click();
      await page.locator('.mm-seg [aria-pressed="true"]').waitFor();
      await page.screenshot({ path: resolve(out, `auction-mine-bids-${width}.png`) });
      await page.locator('[data-mm-tab="buy"]').click();
      await page.locator('[data-mm-cat="all"]').click();
      await page.screenshot({ path: resolve(out, `auction-catalog-${width}.png`) });
      await page.locator('[data-mm-open="module:instance:cargo_bay"]').click();
      const key = 'module:instance:cargo_bay';
      await page.locator(`[data-mm-order-price="${key}"]`).fill('30');
      await page.locator(`[data-mm-order-qty="${key}"]`).fill('2');
      await page.screenshot({ path: resolve(out, `auction-order-${width}.png`) });
      await page.locator(`[data-mm-order="${key}"]`).click();
      await page.locator('[data-mm-order-cancel]').waitFor();
      await page.screenshot({ path: resolve(out, `auction-mine-${width}.png`) });
      await page.locator('[data-mm-order-cancel]').click();
      await page.waitForFunction(() => !document.querySelector('[data-mm-order-cancel]'));
      const bought = await f.arsenal.get('target');
      assert.equal(bought.accountId, 'bob');
      assert.equal(bought.grade, 1);
      assert.equal(bought.rarity, 'unique');
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1),
        false,
      );
      assert.deepEqual(errors, []);
      results.push({
        width,
        lang,
        upgrade: true,
        rarity: true,
        sell: true,
        buy: true,
        overflow: false,
        errors,
      });
    } catch (error) {
      await page.screenshot({ path: resolve(out, `failure-${width}.png`), fullPage: true });
      throw error;
    } finally {
      await context.close();
      await f.app.close();
    }
  }
  writeFileSync(resolve(out, 'results.json'), JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results));
} finally {
  await browser.close();
}
