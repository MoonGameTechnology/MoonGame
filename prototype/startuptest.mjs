#!/usr/bin/env node
/* global window, document, localStorage, CanvasRenderingContext2D, Event -- browser probes */
/** Startup/resize regression on both shipped HTML profiles, with real touch input.
 * Run after pnpm run prototype: node prototype/startuptest.mjs
 * CPU slowdown makes hidden canvas work visible in the report; timings are diagnostic,
 * not a hardware-dependent pass threshold. This is Chromium, not a physical WebView.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { resolveChromium } from '../scripts/chromium.mjs';

const require = createRequire(import.meta.url);
const { chromium } = createRequire(require.resolve('@playwright/mcp/package.json'))(
  'playwright-core',
);
const pages = {
  '/alpha': readFileSync('prototype/dist/void-dominion.html'),
  '/player': readFileSync('prototype/dist/void-dominion-player.html'),
};
const server = createServer((req, res) => {
  if (req.url === '/auth/status') {
    res.setHeader('content-type', 'application/json');
    return res.end('{"enabled":false}');
  }
  res.setHeader('content-type', 'text/html');
  res.end(pages[req.url] ?? pages['/player']);
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch({
  headless: true,
  ...(resolveChromium() ? { executablePath: resolveChromium() } : {}),
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});
const failures = [];
const verify = (label, fn) => {
  try {
    fn();
  } catch (error) {
    failures.push(`${label}: ${error.message}`);
  }
};
try {
  for (const profile of ['/alpha', '/player']) {
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
      deviceScaleFactor: 3,
    });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error' && /frame fail/.test(message.text()))
        errors.push(message.text());
    });
    await page.addInitScript(() => {
      localStorage.setItem('vd.locale', 'ru');
      window.__startupProbe = {
        strokes: 0,
        costs: [],
        raf: window.requestAnimationFrame.bind(window),
      };
      const stroke = CanvasRenderingContext2D.prototype.stroke;
      CanvasRenderingContext2D.prototype.stroke = function (...args) {
        if (this.canvas.id === 'map') window.__startupProbe.strokes++;
        return stroke.apply(this, args);
      };
      const raf = window.requestAnimationFrame.bind(window);
      window.requestAnimationFrame = (callback) =>
        raf((time) => {
          const start = performance.now();
          try {
            callback(time);
          } finally {
            window.__startupProbe.costs.push(performance.now() - start);
          }
        });
    });
    const cdp = await context.newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    async function sample(label, visible) {
      const result = await page.evaluate(async () => {
        // Let layout and the previous interaction settle before sampling.
        const probe = window.__startupProbe;
        await new Promise((resolve) => probe.raf(() => probe.raf(resolve)));
        probe.strokes = 0;
        probe.costs = [];
        for (let i = 0; i < 20; i++) await new Promise(probe.raf);
        const costs = [...probe.costs].sort((a, b) => a - b);
        return {
          strokes: probe.strokes,
          medianMs: costs[Math.floor(costs.length / 2)],
          p95Ms: costs[Math.floor(costs.length * 0.95)],
        };
      });
      console.log(profile, label, JSON.stringify(result));
      verify(`${profile} ${label}`, () =>
        visible
          ? assert(result.strokes > 0, 'visible map paints')
          : assert.equal(result.strokes, 0, 'opaque entry screen does not paint the covered map'),
      );
    }
    await page.goto(`http://127.0.0.1:${server.address().port}${profile}`);
    await page.locator('#cnew').waitFor({ state: 'visible' });
    await sample('welcome', false);
    if (!(await page.locator('#cwnick').isVisible())) await page.locator('#clogin').tap();
    await page.locator('#cwnick').fill('Startup probe');
    await page.locator('#cwgo').tap();
    await page.locator('#hub-solo').waitFor({ state: 'visible' });
    await sample('hub', false);
    // A remembered commander follows a different boot path after an APK update.
    await page.reload();
    await page.locator('#cnew').waitFor({ state: 'visible' });
    await sample('remembered startup', false);
    if (!(await page.locator('#cwnick').isVisible())) await page.locator('#clogin').tap();
    assert.equal(await page.locator('#cwnick').inputValue(), 'Startup probe');
    await page.locator('#cwgo').tap();
    await page.locator('#hub-solo').waitFor({ state: 'visible' });
    await page.locator('#hub-solo').tap();
    await page.locator('#sp-go').tap();
    await sample('transparent setup', true);
    await page.locator('#setupgo').tap();
    await sample('match', true);
    const resize = await page.evaluate(() => {
      const canvas = document.getElementById('map');
      const before = canvas.toDataURL();
      for (let i = 0; i < 12; i++) window.dispatchEvent(new Event('resize'));
      return {
        preserved: before === canvas.toDataURL(),
        width: canvas.width,
        height: canvas.height,
      };
    });
    verify(`${profile} duplicate resize`, () => {
      assert(resize.preserved, 'identical resize notifications must not erase the displayed frame');
      assert.equal(resize.width, 780, 'DPR is capped at 2');
      assert.equal(resize.height, 1688);
    });
    await page.setViewportSize({ width: 844, height: 390 });
    await sample('rotated match', true);
    assert.deepEqual(
      await page.locator('#map').evaluate((el) => [el.width, el.height]),
      [1688, 780],
    );
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator('#tomenu').tap();
    await page.locator('#hub-solo').waitFor({ state: 'visible' });
    await sample('returned to hub', false);
    verify(`${profile} errors`, () => assert.deepEqual(errors, []));
    await context.close();
  }
  assert.deepEqual(failures, []);
  console.log(
    'PASS startup: fresh/remembered entry, match, duplicate resize, rotation, return; alpha + player',
  );
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
