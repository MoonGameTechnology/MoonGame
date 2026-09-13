#!/usr/bin/env node
/* global window, document, localStorage, requestAnimationFrame -- browser regression probes */
/** Real touch zoom regression. Run after pnpm run prototype.
 * Check stable anchors at zoom limits, gesture handoff and background allocations.
 * This is a browser regression, not a physical Android GPU benchmark.
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
let zoomBakes = 0;
const zoomClear = bgx.clearRect.bind(bgx);
bgx.clearRect = (...args) => { zoomBakes++; zoomClear(...args); };
window.__zoomTest = {
  scene(scale) { speed=0; clearSelection(); centerOn({x:(MINX+MAXX)/2,y:(MINY+MAXY)/2},scale); },
  resetBakes() { zoomBakes=0; },
  read() { return { camera:{...cam}, bakes:zoomBakes, pointers:pointers.size, pointerIds:[...pointers.keys()],
    width:canvas.width, height:canvas.height, state:JSON.stringify(s), selected:[selPlanet,selFleet] }; },
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
    loader: { '.webp': 'dataurl' },
    define: { __PLAYER_BUILD__: String(player) },
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
const browser = await launch();
const near = (actual, expected, label) =>
  assert(Math.abs(actual - expected) < 0.0001, `${label}: ${actual} vs ${expected}`);
try {
  for (const profile of ['alpha', 'player']) {
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
    await page.addInitScript(() => localStorage.setItem('vd.locale', 'ru'));
    await page.goto(`http://127.0.0.1:${server.address().port}/${profile}`);
    await page.addScriptTag({ url: `/${profile}.js` });
    for (const id of ['cnew', 'hub-solo', 'sp-go', 'setupgo']) await page.locator('#' + id).tap();
    await page.locator('#maploading').waitFor({ state: 'hidden' });
    const cdp = await page.context().newCDPSession(page);
    const settle = () =>
      page.evaluate(async () => {
        for (let i = 0; i < 3; i++) await new Promise(requestAnimationFrame);
      });
    const read = () => page.evaluate(() => window.__zoomTest.read());
    const touch = async (type, points) => {
      await cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points });
      await settle();
    };
    for (const viewport of [
      { width: 390, height: 844 },
      { width: 844, height: 390 },
    ]) {
      await page.setViewportSize(viewport);
      await settle();
      await page.evaluate(() => window.__zoomTest.scene(4));
      await settle();
      const before = await read();
      const mid = { x: viewport.width / 2, y: viewport.height / 2 };
      const pair = (distance, dx = 0, dy = 0) => [
        { id: 1, x: mid.x - distance / 2 + dx, y: mid.y + dy },
        { id: 2, x: mid.x + distance / 2 + dx, y: mid.y + dy },
      ];
      await touch('touchStart', pair(80));
      assert.equal((await read()).pointers, 2, 'both fingers belong to the map');
      await page.evaluate(() => window.__zoomTest.resetBakes());
      for (const distance of [96, 128, 160, 192, 160, 128, 96, 80]) {
        await touch('touchMove', pair(distance));
        const current = await read();
        const scale = Math.min(6, (4 * distance) / 80);
        near(current.camera.scale, scale, 'gesture scale relative to its starting distance');
        near(
          ((mid.x - before.camera.x) / 4) * scale + current.camera.x,
          mid.x,
          'horizontal anchor',
        );
        near(((mid.y - before.camera.y) / 4) * scale + current.camera.y, mid.y, 'vertical anchor');
        assert.equal(current.bakes, 0, 'no intermediate background rebakes while pinching');
        assert.equal(current.width, before.width);
        assert.equal(current.height, before.height);
      }
      await touch('touchEnd', []);
      const returned = await read();
      near(returned.camera.x, before.camera.x, 'round-trip x');
      near(returned.camera.y, before.camera.y, 'round-trip y');
      near(returned.camera.scale, before.camera.scale, 'round-trip scale');
      assert(returned.bakes <= 1, 'at most one background bake after the final scale settles');
      assert.equal(returned.state, before.state, 'camera gestures preserve the game');
      assert.deepEqual(returned.selected, before.selected, 'pinch release does not select');

      await page.evaluate(() => window.__zoomTest.scene(6));
      await settle();
      const capped = await read();
      await touch('touchStart', pair(100));
      for (let step = 1; step <= 8; step++) {
        const dx = -4 * step,
          dy = 3 * step;
        await touch('touchMove', pair(100, dx, dy));
        const next = await read();
        near(next.camera.scale, 6, 'two-finger pan keeps max zoom');
        near(next.camera.x, capped.camera.x + dx, 'two-finger pan x');
        near(next.camera.y, capped.camera.y + dy, 'two-finger pan y');
      }
      // Keep one finger down, then continue panning without a scale/position jump.
      const remaining = pair(100, -32, 24)[1];
      await touch('touchEnd', [pair(100, -32, 24)[0]]);
      const one = await read();
      await touch('touchMove', [{ ...remaining, x: remaining.x + 12, y: remaining.y + 10 }]);
      const dragged = await read();
      near(dragged.camera.x, one.camera.x + 12, 'pinch-to-drag x');
      near(dragged.camera.y, one.camera.y + 10, 'pinch-to-drag y');
      near(dragged.camera.scale, 6, 'pinch-to-drag scale');
      await touch('touchEnd', []);
      assert.equal((await read()).pointers, 0);

      // Browser/OS capture loss must not leave a ghost finger in the next pinch.
      await touch('touchStart', pair(100));
      await touch('touchMove', pair(100, 1, 0)); // process pending implicit capture
      await page.evaluate(() => {
        const map = document.getElementById('map');
        for (const id of window.__zoomTest.read().pointerIds)
          if (map.hasPointerCapture(id)) map.releasePointerCapture(id);
      });
      await touch('touchMove', pair(100, 2, 0)); // deliver native lostpointercapture
      assert.equal((await read()).pointers, 0, 'lost capture clears the active gesture');
      await touch('touchCancel', []);
      assert.equal((await read()).pointers, 0);
      await touch('touchStart', [pair(100)[0]]);
      assert.equal((await read()).pointers, 1, 'new drag starts with one real finger');
      await touch('touchCancel', []);
      assert.deepEqual(errors, []);
      console.log(
        `PASS ${profile} ${viewport.width}x${viewport.height}: anchored pinch, cap pan, one-finger handoff, cancel and bounded rebakes`,
      );
    }
    await page.close();
  }
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
