#!/usr/bin/env node
/* global window, document -- evaluated in Chromium */
/** Compare the direct radar frontier with the former raster subtraction.
 * Run with the pinned browser: node prototype/frontiertest.mjs
 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import { resolveChromium } from '../scripts/chromium.mjs';

const require = createRequire(import.meta.url);
const { chromium } = createRequire(require.resolve('@playwright/mcp/package.json'))(
  'playwright-core',
);
const bundle = await build({
  stdin: {
    contents: `import { drawSightFrontier } from './drawSightFrontier';
      import { frontierLook } from './sightFrontier';
      window.frontier = { drawSightFrontier, frontierLook };`,
    resolveDir: process.cwd() + '/prototype/src',
    loader: 'ts',
  },
  bundle: true,
  write: false,
  format: 'iife',
  platform: 'browser',
});
const browser = await chromium.launch({
  headless: true,
  ...(resolveChromium() ? { executablePath: resolveChromium() } : {}),
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});
try {
  const page = await browser.newPage();
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  const report = await page.evaluate(() => {
    const { drawSightFrontier, frontierLook } = window.frontier;
    const cases = [
      [],
      [{ x: 90, y: 90, r: 48 }],
      [
        { x: 90, y: 90, r: 48 },
        { x: 90, y: 90, r: 48 },
      ],
      [
        { x: 90, y: 90, r: 48 },
        { x: 95, y: 93, r: 20 },
      ],
      [
        { x: 65, y: 90, r: 48 },
        { x: 120, y: 95, r: 48 },
      ],
      [
        { x: 45, y: 70, r: 28 },
        { x: 180, y: 125, r: 40 },
      ],
      [
        { x: 80, y: 90, r: 40 },
        { x: 160, y: 90, r: 40 },
      ],
      [
        { x: -40, y: 90, r: 75 },
        { x: 340, y: 150, r: 80 },
      ],
      [
        { x: 90, y: 90, r: 0.5 },
        { x: 100, y: 90, r: 0 },
      ],
      // A hole enclosed by three intersecting radar regions must remain empty.
      [
        { x: 90, y: 65, r: 46 },
        { x: 140, y: 135, r: 46 },
        { x: 60, y: 135, r: 46 },
      ],
      Array.from({ length: 40 }, (_, i) => ({
        x: (i * 67) % 300,
        y: (i * 41) % 190,
        r: 24 + (i % 17),
      })),
    ];
    const results = [];
    for (const dpr of [1, 2, 3])
      for (const tier of ['signature', 'reveal'])
        for (const circles of cases) {
          const width = 300,
            height = 200;
          const make = () => {
            const c = document.createElement('canvas');
            c.width = width * dpr;
            c.height = height * dpr;
            const g = c.getContext('2d');
            g.scale(dpr, dpr);
            return { c, g };
          };
          const actual = make(),
            expected = make(),
            mask = make();
          const look = frontierLook(tier);
          const color = (a) => `rgba(114,224,213,${a})`;
          const path = (g, inset) => {
            g.beginPath();
            for (const c of circles)
              if (c.r > inset) {
                g.moveTo(c.x + c.r - inset, c.y);
                g.arc(c.x, c.y, c.r - inset, 0, Math.PI * 2);
              }
          };
          expected.g.fillStyle = color(look.fillAlpha);
          path(expected.g, 0);
          expected.g.fill();
          mask.g.fillStyle = '#fff';
          path(mask.g, 0);
          mask.g.fill();
          mask.g.globalCompositeOperation = 'destination-out';
          path(mask.g, look.lineWidth);
          mask.g.fill();
          mask.g.globalCompositeOperation = 'source-in';
          mask.g.fillStyle = color(look.strokeAlpha);
          mask.g.fillRect(0, 0, width, height);
          expected.g.drawImage(mask.c, 0, 0, width, height);
          drawSightFrontier(actual.g, circles, tier, '#72e0d5', width, height);
          const a = actual.g.getImageData(0, 0, width * dpr, height * dpr).data;
          const e = expected.g.getImageData(0, 0, width * dpr, height * dpr).data;
          let maxInterior = 0,
            sum = 0,
            max = 0;
          // Compare alpha: RGB in nearly transparent antialiased pixels is unpremultiplied.
          for (let y = 0; y < height * dpr; y++)
            for (let x = 0; x < width * dpr; x++) {
              const offset = (y * width * dpr + x) * 4 + 3;
              const delta = Math.abs(a[offset] - e[offset]);
              sum += delta;
              max = Math.max(max, delta);
              const distance = (c) => Math.hypot((x + 0.5) / dpr - c.x, (y + 0.5) / dpr - c.y);
              const edge = circles.some(
                (c) =>
                  Math.abs(distance(c) - c.r) < 1.5 / dpr ||
                  (c.r > look.lineWidth &&
                    Math.abs(distance(c) - c.r + look.lineWidth) < 1.5 / dpr),
              );
              if (!edge) maxInterior = Math.max(maxInterior, delta);
            }
          // The renderer must restore clipping before the next map layer is painted.
          actual.g.fillStyle = '#ff0000';
          actual.g.fillRect(0, 0, width, height);
          const restored = actual.g.getImageData(0, 0, width * dpr, height * dpr).data;
          const clipRestored = restored.every(
            (n, i) => n === (i % 4 === 0 || i % 4 === 3 ? 255 : 0),
          );
          results.push({
            dpr,
            tier,
            circles: circles.length,
            maxInterior,
            max,
            mean: sum / (width * height * dpr * dpr),
            clipRestored,
          });
        }
    return results;
  });
  for (const r of report) {
    assert(
      r.maxInterior <= 1,
      'the same union and holes away from antialiasing: ' + JSON.stringify(r),
    );
    assert(r.mean < 0.5, 'no broad appearance change: ' + JSON.stringify(r));
    assert(r.clipRestored, 'subsequent layers retain the full viewport');
  }
  console.log(
    'FRONTIER_PASS',
    report.length,
    'raster comparisons at DPR 1/2/3;',
    'maximum mean alpha difference',
    Math.max(...report.map((r) => r.mean)),
  );
} finally {
  await browser.close();
}
