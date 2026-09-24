#!/usr/bin/env node
/* global window, document, localStorage, requestAnimationFrame, CanvasRenderingContext2D -- browser regression probes */
/** Real Chromium context-loss regression. Run after pnpm run prototype.
 * A GPU-process reset must actually produce contextlost/contextrestored events;
 * compare recovered pixels with a fresh paint of the exact same frozen scene.
 * This exercises recovery, not the driver-specific cause of Android GPU resets.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import { resolveChromium } from '../scripts/chromium.mjs';

const require = createRequire(import.meta.url);
const { chromium } = createRequire(require.resolve('@playwright/mcp/package.json'))(
  'playwright-core',
);
const bridge = `
let frozenRecoveryTime = null;
const originalRecoveryFrame = frame;
frame = (now) => originalRecoveryFrame(frozenRecoveryTime ?? now);
window.__canvasRecovery = {
  freeze() { frozenRecoveryTime = performance.now(); },
  repaint() { bgContent = ''; presentedCam = null; terrainRaster.clear(); clearHolographicSprites(); },
  state() { return JSON.stringify(s); },
};`;
const responses = new Map();
for (const player of [false, true]) {
  const name = player ? 'player' : 'alpha';
  const bundle = await build({
    stdin: {
      contents: readFileSync('prototype/src/main.ts', 'utf8') + bridge,
      resolveDir: process.cwd() + '/prototype/src',
      loader: 'ts',
    },
    bundle: true,
    write: false,
    format: 'iife',
    platform: 'browser',
    loader: { '.webp': 'dataurl', '.svg': 'dataurl' },
    define: { __PLAYER_BUILD__: String(player), __SECTOR_ZERO_ONLY__: 'false' },
  });
  const built = readFileSync(`prototype/dist/void-dominion${player ? '-player' : ''}.html`, 'utf8');
  const start = built.lastIndexOf('<script>');
  const end = built.lastIndexOf('</script>');
  assert(start >= 0 && end > start);
  // Serve the existing markup without its app bundle. Playwright loads the test
  // bundle through the script API, keeping executable URLs out of HTML assembly.
  responses.set('/' + name, built.slice(0, start) + built.slice(end + 9));
  responses.set('/' + name + '.js', bundle.outputFiles[0].text);
}
const server = createServer((req, res) => {
  if (req.url === '/auth/status') {
    res.setHeader('content-type', 'application/json');
    return res.end('{"enabled":false}');
  }
  res.setHeader('content-type', req.url.endsWith('.js') ? 'text/javascript' : 'text/html');
  res.end(responses.get(req.url) ?? '');
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const launch = () =>
  chromium.launch({
    headless: true,
    ...(resolveChromium() ? { executablePath: resolveChromium() } : {}),
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
let browser;
try {
  for (const profile of ['alpha', 'player']) {
    // Chromium intentionally terminates after several GPU-process crashes. Each
    // profile gets its own browser; two genuine recoveries stay below that limit.
    browser = await launch();
    const gpu = await browser.newBrowserCDPSession();
    const page = await browser.newPage({
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 2,
      isMobile: true,
      hasTouch: true,
    });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => {
      if (m.type() === 'error' && /frame fail/.test(m.text())) errors.push(m.text());
    });
    await page.addInitScript(() => {
      localStorage.setItem('vd.locale', 'ru');
      const isLost = CanvasRenderingContext2D.prototype.isContextLost;
      CanvasRenderingContext2D.prototype.isContextLost = function () {
        return (this.canvas.id === 'map' && !!window.__holdMapContext) || isLost.call(this);
      };
      window.__recoveryEvents = [];
      for (const type of ['contextlost', 'contextrestored'])
        document.addEventListener(
          type,
          (e) => {
            if (e.target.id === 'map') window.__recoveryEvents.push(type);
          },
          true,
        );
    });
    await page.goto(`http://127.0.0.1:${server.address().port}/${profile}`);
    await page.addScriptTag({ url: `/${profile}.js` });
    for (const id of ['cnew', 'hub-solo', 'sp-go']) await page.locator('#' + id).tap();
    // Complete preparation with the display context unavailable. The loader must
    // remain until a complete frame can actually be presented.
    await page.evaluate(() => {
      window.__holdMapContext = true;
    });
    await page.locator('#setupgo').tap();
    await page.waitForFunction(() => {
      const bar = document.getElementById('maploading-progress');
      return bar.max > 1 && bar.value === bar.max;
    });
    assert(
      await page.locator('#maploading').isVisible(),
      'loader stays until display context is usable',
    );
    await page.evaluate(() => {
      window.__holdMapContext = false;
    });
    await page.locator('#maploading').waitFor({ state: 'hidden' });
    await page.addStyleTag({
      content: '*,*::before,*::after{animation:none!important;transition:none!important}',
    });
    await page.evaluate(() => window.__canvasRecovery.freeze());
    const settle = () =>
      page.evaluate(async () => {
        for (let i = 0; i < 4; i++) await new Promise(requestAnimationFrame);
      });
    await settle();
    const before = await page.evaluate(() => window.__canvasRecovery.state());
    for (let cycle = 1; cycle <= 2; cycle++) {
      await gpu.send('Browser.crashGpuProcess');
      await page.waitForFunction(
        (count) => window.__recoveryEvents.filter((e) => e === 'contextrestored').length >= count,
        cycle,
      );
      await settle();
      const recovered = await page.locator('#map').screenshot();
      await page.evaluate(() => window.__canvasRecovery.repaint());
      await settle();
      const fresh = await page.locator('#map').screenshot();
      assert(
        recovered.equals(fresh),
        `${profile} cycle ${cycle}: recovered map differs from fresh pixels`,
      );
      assert.equal(
        await page.evaluate(() => window.__canvasRecovery.state()),
        before,
        'recovery preserves game state',
      );
      assert.deepEqual(errors, []);
      console.log(
        `PASS ${profile}: GPU context recovery ${cycle}, fresh pixels, unchanged game state`,
      );
    }
    await page.close();
    await browser.close();
  }
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
}
