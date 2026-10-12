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
import { LIFT_BOOT_VEIL } from './harnessKit.mjs';
import { checkMapLoading } from './mapLoadingTest.mjs';
import { mapLayerBridge } from './mapLayerBridge.mjs';

const require = createRequire(import.meta.url);
const { chromium } = createRequire(require.resolve('@playwright/mcp/package.json'))(
  'playwright-core',
);
const bridge = `
// Фаза орбит живёт у геометрии флотов (REFM-238): импорт не присвоить, обнуляет её дверь.
import { orbitPhase as __orbitPhase } from './fleetGeometry';
// Выпечка карты живёт в слое карты (REFM-232): её ручки дописывает в модуль mapLayerBridge.
import { SETTLE_MS as __SETTLE_MS } from '../../decisions/mapLayerView';
// Перенос выпечки — у слоя карты; \`main.ts\` его больше не читает (REFM-235).
import { mapView as __mapView } from './mapLayer';
const __ml = globalThis.__mapLayer;
const panSamples = { frame: [], bake: [] };
const originalRender = renderMap;
renderMap = function(now) { const at = performance.now(); try { originalRender(now); }
  finally { panSamples.frame.push(performance.now() - at); } };
const originalBake = __ml.bakeMapLayer;
__ml.bakeMapLayer = function(...args) { const at = performance.now(); try { originalBake(...args); }
  finally { panSamples.bake.push(performance.now() - at); } };
let panSwaps = 0;
const originalSwap = __ml.swapBakeJob;
__ml.swapBakeJob = function(...args) { panSwaps++; return originalSwap(...args); };
const panSettle = async () => {
  await new Promise((resolve) => setTimeout(resolve, __SETTLE_MS + 100));
  for (let i = 0; i < 2 || ((__ml.terrainRefine >= 0 || __ml.bakeJob) && i < 600); i++) await new Promise(requestAnimationFrame);
  await new Promise((resolve) => setTimeout(resolve, __SETTLE_MS + 100));
  await new Promise(requestAnimationFrame); await new Promise(requestAnimationFrame);
};
window.__panBenchmark = {
  async scene(reveal) {
    speed = 0; sandboxConfig.enabled = true; sandboxConfig.fog = !reveal;
    clearSelection(); hologramTime = 0; spinOrbits(-__orbitPhase);
    Object.assign(cam, {x: 0, y: 0, scale: 1.8});
    for (let i = 0; i < 10; i++) await new Promise(requestAnimationFrame);
    return { nodes: MAP.length, known: MAP.filter(n => known(n.id)).length, holo: holographicMapOn() };
  },
  async run(mode) {
    panSamples.frame = []; panSamples.bake = [];
    const state = JSON.stringify(s);
    // renderMap() alone misses the raster work Chromium defers past the callback: the
    // interval between animation frames is what the player sees.
    const ticks = [];
    for (let i = 0; i < 90; i++) {
      ticks.push(performance.now());
      cam.x = mode === 'idle' ? 0 : Math.sin(i / 12) * 260;
      cam.y = mode === 'idle' ? 0 : Math.cos(i / 15) * 130;
      cam.scale = mode === 'zoom' ? 1.8 + Math.sin(i / 16) * 0.65 : 1.8;
      await new Promise(requestAnimationFrame);
    }
    const interval = ticks.slice(1).map((t, i) => t - ticks[i]);
    return { frame: panSamples.frame, bake: panSamples.bake, interval, stateUnchanged: JSON.stringify(s) === state };
  },
  async compareStaticPaths() {
    const read = (c) => c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    const diff = (a, b) => { let max = 0; for (let i = 0; i < a.length; i++) max = Math.max(max, Math.abs(a[i] - b[i])); return max; };
    const surface = () => { const c = document.createElement('canvas'); c.width = canvas.width; c.height = canvas.height; return c; };
    // Steps 1-5 judge the pan paths against bakes within one frame: a bake in the background
    // (rule 7) paints the map in bands, and step 6 judges that on its own.
    const inBackground = __ml.startBakeJob;
    __ml.startBakeJob = () => false;
    Object.assign(cam, {x: 0, y: 0, scale: 1.8});
    await panSettle();
    // 1. Culling to the painted view never changes a pixel.
    __ml.terrainRaster.beginFrame(Infinity);
    const culled = surface(); const wide = surface();
    for (const [c, view] of [[culled, {x0: 0, y0: 0, x1: VW, y1: VH}], [wide, {x0: -1e7, y0: -1e7, x1: 1e7, y1: 1e7}]]) {
      const g = c.getContext('2d');
      __ml.paintSky(g);
      g.setTransform(DPR, 0, 0, DPR, 0, 0);
      __ml.paintMapLayer(g, view, false, false);
    }
    // 2. A moving frame shows exactly the settled picture at the same camera.
    const live = surface();
    __ml.paintSky(live.getContext('2d'));
    __ml.showMapLayer(live.getContext('2d'), __mapView);
    const still = diff(read(live), read(__ml.bg));
    // 3. After a whole-pixel pan the bake is reused, and it matches a fresh bake there;
    //    gradient dithering follows the canvas pixel grid, hence the few levels.
    const bakes = __ml.mapLayerBakes;
    cam.x += 37; cam.y -= 21;
    await panSettle();
    const reused = __ml.mapLayerBakes === bakes;
    const kept = read(__ml.bg);
    __ml.invalidateMapSurfaces();
    await panSettle();
    const pan = diff(kept, read(__ml.bg));
    // 4. A pan that comes to rest between device pixels puts the camera on the bake's grid,
    //    by less than half a pixel, instead of baking the map again.
    const before = __ml.mapLayerBakes;
    const x = cam.x + 10.3;
    cam.x = x;
    await panSettle();
    const snapped = __ml.mapLayerBakes === before && Math.abs(cam.x - x) <= 0.5 / DPR && cam.x !== x;
    // 5. A pan past the margin moves the bake's window: no province is measured again, and
    //    the strips it paints match a fresh bake.
    const geometry = __ml.mapLayerGeometry;
    cam.x -= Math.round(VW * 0.6);
    cam.y += Math.round(VH * 0.4);
    await panSettle();
    const scrolled = __ml.mapLayerGeometry === geometry && __ml.mapLayerScroll.x !== 0 && __ml.mapLayerScroll.y !== 0;
    const moved = read(__ml.bg);
    __ml.invalidateMapSurfaces();
    await panSettle();
    const scroll = diff(moved, read(__ml.bg));
    // 6. A zoom at rest sharpens the map through bakes in the background, a band a frame. They
    //    leave the picture a bake within one frame does, but for the anti-aliasing of the
    //    outlines a band boundary cuts (the rasterizer takes a clipped path another way): a few
    //    levels, on few pixels. A lost or doubled band would differ on whole rows.
    __ml.startBakeJob = inBackground;
    const swaps = panSwaps;
    cam.scale = 2.2;
    await panSettle();
    const banded = read(__ml.bg);
    const swapped = panSwaps - swaps;
    __ml.startBakeJob = () => false;
    __ml.invalidateMapSurfaces();
    await panSettle();
    const fresh = read(__ml.bg);
    __ml.startBakeJob = inBackground;
    let edge = 0, worst = 0;
    for (let i = 0; i < fresh.length; i += 4) {
      let d = 0;
      for (let c = 0; c < 4; c++) d = Math.max(d, Math.abs(banded[i + c] - fresh[i + c]));
      if (d) { edge++; worst = Math.max(worst, d); }
    }
    const background = { swapped, max: worst, share: edge / (fresh.length / 4) };
    return { cull: diff(read(culled), read(wide)), still, reused, pan, snapped, scrolled, scroll, background };
  },
  async capture() {
    Object.assign(cam, {x: 119.25, y: -51.75, scale: 1.8});
    await new Promise(requestAnimationFrame);
    cam.x = 121.25;
    await new Promise(requestAnimationFrame);
    Object.assign(cam, {x: 123.25, y: -51.75, scale: 1.8});
    await panSettle();
    return __ml.bg.toDataURL();
  }
};`;
const bundle = await build({
  stdin: {
    contents: LIFT_BOOT_VEIL + readFileSync('prototype/src/main.ts', 'utf8') + bridge,
    resolveDir: process.cwd() + '/prototype/src',
    loader: 'ts',
  },
  bundle: true,
  plugins: [mapLayerBridge],
  write: false,
  format: 'iife',
  platform: 'browser',
  loader: { '.webp': 'dataurl', '.svg': 'dataurl' },
  define: { __PLAYER_BUILD__: 'false', __SECTOR_ZERO_ONLY__: 'false' },
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
      report[name][mode] = {
        frame: stats(sample.frame),
        interval: stats(sample.interval),
        bake: stats(sample.bake),
      };
      console.log(name, mode, JSON.stringify(report[name][mode]));
    }
    const paths = await page.evaluate(() => window.__panBenchmark.compareStaticPaths());
    console.log(name, 'paths', JSON.stringify(paths));
    assert.equal(paths.cull, 0, 'culling to the painted view changes no pixel');
    assert.equal(paths.still, 0, 'moving and stationary frames match pixel-for-pixel');
    assert(paths.reused, 'a whole-pixel pan reuses the map bake');
    assert(paths.pan <= 4, `reused bake matches a fresh one (dither only): ${paths.pan}`);
    assert(paths.snapped, 'a pan at rest between pixels snaps the camera, not bakes the map');
    assert(paths.scrolled, 'a pan past the margin moves the bake, not bakes it');
    assert(paths.scroll <= 4, `moved bake matches a fresh one (dither only): ${paths.scroll}`);
    assert(paths.background.swapped > 0, 'a zoom at rest sharpens the map in the background');
    assert(
      paths.background.share <= 0.01 && paths.background.max <= 32,
      `a bake in the background matches one within a frame (edge anti-aliasing only): ${JSON.stringify(paths.background)}`,
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
