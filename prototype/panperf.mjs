#!/usr/bin/env node
/* global window, localStorage -- browser harness */
/** Real canvas camera benchmark, including fully revealed terrain.
 * Run after pnpm run prototype. PAN_REPORT chooses the local output prefix.
 * The appended test bridge controls only presentation and the existing solo fog
 * toggle; it is never included in either shipped client profile.
 */
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import { resolveChromium } from '../scripts/chromium.mjs';
import { checkMapLoading } from './mapLoadingTest.mjs';

const require = createRequire(import.meta.url);
const { chromium } = createRequire(require.resolve('@playwright/mcp/package.json'))(
  'playwright-core',
);
const bridge = `
const panSamples = { frame: [], bake: [] };
const originalRender = render;
render = function(now) { const at = performance.now(); try { originalRender(now); }
  finally { panSamples.frame.push(performance.now() - at); } };
const originalBake = buildStaticLayer;
buildStaticLayer = function(...args) { const at = performance.now(); try { originalBake(...args); }
  finally { panSamples.bake.push(performance.now() - at); } };
window.__panBenchmark = {
  async scene(reveal) {
    speed = 0; sandboxConfig.enabled = true; sandboxConfig.fog = !reveal;
    clearSelection(); hologramTime = 0; orbitPhase = 0;
    Object.assign(cam, {x: 0, y: 0, scale: 1.8});
    for (let i = 0; i < 10; i++) await new Promise(requestAnimationFrame);
    return { nodes: MAP.length, known: MAP.filter(n => known(n.id)).length, holo: holographicMapOn() };
  },
  async run(mode) {
    panSamples.frame = []; panSamples.bake = [];
    const state = JSON.stringify(s);
    for (let i = 0; i < 90; i++) {
      cam.x = mode === 'idle' ? 0 : Math.sin(i / 12) * 260;
      cam.y = mode === 'idle' ? 0 : Math.cos(i / 15) * 130;
      cam.scale = mode === 'zoom' ? 1.8 + Math.sin(i / 16) * 0.65 : 1.8;
      await new Promise(requestAnimationFrame);
    }
    return { frame: panSamples.frame, bake: panSamples.bake, stateUnchanged: JSON.stringify(s) === state };
  },
  compareStaticPaths() {
    cx.save();
    buildStaticLayer(cx);
    const direct = cx.getImageData(0,0,canvas.width,canvas.height).data;
    cx.restore();
    bgContent = ''; buildStaticLayer();
    const baked = bgx.getImageData(0,0,bg.width,bg.height).data;
    let max = 0;
    for (let i = 0; i < direct.length; i++) max = Math.max(max, Math.abs(direct[i] - baked[i]));
    return max;
  },
  async capture() {
    Object.assign(cam, {x: 119.25, y: -51.75, scale: 1.8});
    await new Promise(requestAnimationFrame);
    cam.x = 121.25;
    await new Promise(requestAnimationFrame);
    Object.assign(cam, {x: 123.25, y: -51.75, scale: 1.8});
    await new Promise(requestAnimationFrame); await new Promise(requestAnimationFrame);
    return bg.toDataURL();
  }
};`;
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
  define: { __PLAYER_BUILD__: 'false' },
});
const built = readFileSync('prototype/dist/void-dominion.html', 'utf8');
const start = built.lastIndexOf('<script>');
const end = built.lastIndexOf('</script>');
assert(start >= 0 && end > start);
const html = built.slice(0, start) + '<script src="/app.js"></script>' + built.slice(end + 9);
const server = createServer((req, res) => {
  if (req.url === '/auth/status') {
    res.setHeader('content-type', 'application/json');
    return res.end('{"enabled":false}');
  }
  if (req.url === '/app.js') {
    res.setHeader('content-type', 'text/javascript');
    return res.end(bundle.outputFiles[0].text);
  }
  res.setHeader('content-type', 'text/html');
  res.end(html);
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch({
  headless: true,
  ...(resolveChromium() ? { executablePath: resolveChromium() } : {}),
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});
const prefix = process.env.PAN_REPORT ?? '/tmp/void-pan';
const stats = (values) => {
  const v = [...values].sort((a, b) => a - b);
  return {
    frames: v.length,
    median: v[Math.floor(v.length / 2)],
    p95: v[Math.floor(v.length * 0.95)],
    max: v.at(-1),
  };
};
try {
  await checkMapLoading(browser, `http://127.0.0.1:${server.address().port}`);
  const page = await browser.newPage({
    ...(process.env.PAN_MOBILE === '1'
      ? {
          viewport: { width: 390, height: 844 },
          deviceScaleFactor: 2,
          isMobile: true,
          hasTouch: true,
        }
      : { viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 }),
  });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error' && /frame fail/.test(m.text())) errors.push(m.text());
  });
  await page.addInitScript(() => localStorage.setItem('vd.locale', 'ru'));
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  for (const id of ['cnew', 'hub-solo', 'sp-go', 'setupgo']) await page.locator('#' + id).click();
  const cdp = await page.context().newCDPSession(page);
  const report = {};
  for (const reveal of [false, true]) {
    const scene = await page.evaluate((reveal) => window.__panBenchmark.scene(reveal), reveal);
    assert(scene.holo, 'benchmark exercises the holographic desktop map');
    assert(reveal ? scene.known === scene.nodes : scene.known < scene.nodes);
    const name = reveal ? 'revealed' : 'fog';
    report[name] = { scene };
    for (const mode of ['idle', 'pan', 'zoom']) {
      if (reveal && mode === 'pan') {
        await cdp.send('Profiler.enable');
        await cdp.send('Profiler.start');
      }
      const sample = await page.evaluate((mode) => window.__panBenchmark.run(mode), mode);
      if (reveal && mode === 'pan') {
        const { profile } = await cdp.send('Profiler.stop');
        writeFileSync(prefix + '.cpuprofile', JSON.stringify(profile));
      }
      assert(sample.stateUnchanged, 'camera benchmark does not change simulation state');
      report[name][mode] = { frame: stats(sample.frame), bake: stats(sample.bake) };
      console.log(name, mode, JSON.stringify(report[name][mode]));
    }
    assert.equal(
      await page.evaluate(() => window.__panBenchmark.compareStaticPaths()),
      0,
      'moving and stationary static layers match pixel-for-pixel',
    );
    const png = await page.evaluate(() => window.__panBenchmark.capture());
    writeFileSync(prefix + '-' + name + '.png', Buffer.from(png.split(',')[1], 'base64'));
  }
  assert.deepEqual(errors, []);
  writeFileSync(prefix + '.json', JSON.stringify(report, null, 2));
  console.log('PAN_PERF_JSON ' + JSON.stringify(report));
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
