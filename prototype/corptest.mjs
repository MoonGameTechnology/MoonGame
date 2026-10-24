#!/usr/bin/env node
/* global localStorage, document */
/** Real playable host + the hub «Корпорация» tab (CORP-3): auth, creation, construction and reload. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:net';
import { mkdirSync } from 'node:fs';
import { launchBrowser, waitForApp, withDiagnostics } from './harnessKit.mjs';
import { bundleNetserver } from './bundle-netserver.mjs';

// Run after pnpm prototype. Bind only loopback with disposable accounts/storage.
await bundleNetserver();
const portPicker = createServer();
await new Promise((resolve) => portPicker.listen(0, '127.0.0.1', resolve));
const port = portPicker.address().port;
await new Promise((resolve) => portPicker.close(resolve));
const base = `http://127.0.0.1:${port}`;
const env = { ...process.env, PORT: String(port), HOST: '127.0.0.1', PROD: '0',
  AUTH_JWT_SECRET: randomBytes(32).toString('hex'), ALLOWED_ORIGINS: base, MATCHES: '1' };
delete env.DATABASE_URL;
const server = spawn(process.execPath, ['packages/server/dist/proto-server.mjs'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
let log = '';
process.on('exit', () => server.kill());
await new Promise((resolve, reject) => {
  const timeout = setTimeout(() => { server.kill(); reject(new Error(`host startup failed: ${log}`)); }, 45_000);
  const read = (chunk) => {
    log = (log + chunk).slice(-15_000);
    if (/game\s*:\s*http:/.test(log)) { clearTimeout(timeout); resolve(); }
  };
  server.stdout.on('data', read);
  server.stderr.on('data', read);
  server.on('exit', (code) => { clearTimeout(timeout); reject(new Error(`host exited ${code}: ${log}`)); });
});
const browser = await launchBrowser();
mkdirSync('.playwright-mcp', { recursive: true });
try {
  for (const [locale, width, height] of [['ru', 1280, 900], ['en', 390, 844]]) {
    const password = randomBytes(24).toString('base64url');
    const registered = await fetch(`${base}/auth/register`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ login: `Builder${locale}`, password }),
    });
    assert.equal(registered.status, 201);
    const context = await browser.newContext({ viewport: { width, height }, isMobile: width < 600, hasTouch: width < 600 });
    const page = await context.newPage();
    page.setDefaultTimeout(20_000);
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.addInitScript((lang) => localStorage.setItem('vd.locale', lang), locale);
    await withDiagnostics(page, `corporation-${locale}`, async () => {
      await page.goto(base);
      await waitForApp(page);
      const signIn = async () => {
        if (await page.locator('#hub').isVisible()) return;
        await page.locator('#cwpass').waitFor({ state: 'visible' });
        if (!(await page.locator('#cwnick').isVisible())) await page.click('#clogin');
        await page.fill('#cwnick', `Builder${locale}`);
        await page.fill('#cwpass', password);
        await page.click('#cwgo');
        await page.locator('#hub').waitFor({ state: 'visible' });
      };
      await signIn();
      // New accounts acknowledge their welcome award before navigating the hub.
      await page.locator('#registration-reward[open]').waitFor();
      await page.click('#registration-reward [data-reward="accept"]');
      await page.locator('#registration-reward').waitFor({ state: 'hidden' });
      const openTab = async () => {
        await page.click('[data-hub="corp"]');
        if (await page.locator('#intro .in-ok').isVisible()) await page.click('#intro .in-ok');
      };
      await openTab();
      await page.fill('#corp-hub-name', `Builders ${locale}`);
      await page.click('#hp-corp [data-corpact="create"]');
      await page.locator('#hp-corp .cb-id h2').filter({ hasText: `Builders ${locale}` }).waitFor();
      assert.equal(await page.locator('#hp-corp .cb-bc').count(), 3);
      assert.equal(await page.locator('#hp-corp .cb-lot').count(), 3);
      await page.screenshot({ path: `.playwright-mcp/corporation-${locale}-base.png` });
      // A locked building's sheet explains the lock instead of offering an order.
      await page.click('#hp-corp .cb-bc[data-corpbld="supply_center"]');
      await page.locator('#corp-sheet.open').waitFor();
      assert.equal(await page.locator('#corp-sheet [data-corpact="build"]').count(), 0);
      await page.keyboard.press('Escape');
      await page.locator('#corp-sheet.open').waitFor({ state: 'detached' });
      await page.click('#hp-corp .cb-bc[data-corpbld="headquarters"]');
      const build = page.locator('#corp-sheet [data-corpact="build"][data-corparg="headquarters"]');
      await build.waitFor();
      assert.equal(await build.isEnabled(), true);
      // The phone sheet rises with a fade; capture it settled, not mid-animation.
      await page.waitForFunction(() => document.querySelector('#corp-sheet .cb-sheet')
        .getAnimations().every((a) => a.playState !== 'running'));
      await page.screenshot({ path: `.playwright-mcp/corporation-${locale}-sheet.png` });
      await build.click();
      await page.locator('#corp-sheet .cb-sheet-job').waitFor();
      await page.click('#corp-sheet .cb-scrim', { position: { x: 5, y: 5 } });
      await page.locator('#hp-corp .cb-hud:not(.idle)').waitFor();
      const overflow = await page.$eval('#hp-corp', (el) => el.scrollWidth > el.clientWidth + 1);
      assert.equal(overflow, false, 'the corporation tab must not overflow horizontally');
      await page.screenshot({ path: `.playwright-mcp/corporation-${locale}-queue.png` });
      for (const section of ['members', 'treasury', 'battles']) {
        await page.click(`#hp-corp [data-corpsec="${section}"]`);
        await page.locator(`#hp-corp [data-corpsec="${section}"][aria-selected="true"]`).waitFor();
        await page.screenshot({ path: `.playwright-mcp/corporation-${locale}-${section}.png` });
      }
      await page.reload();
      await waitForApp(page);
      // Remember-me (AC-0.2): the reload keeps the account signed in — no password again.
      await page.locator('#hub').waitFor({ state: 'visible' });
      await openTab();
      await page.click('#hp-corp [data-corpsec="base"]');
      await page.locator('#hp-corp .cb-hud:not(.idle)').waitFor();
      await page.locator('#hp-corp .cb-lot.build[data-corpbld="headquarters"]').waitFor();
      assert.deepEqual(errors, []);
      console.log(`PASS ${locale} ${width}x${height}: login → hub tab → create → build → persisted queue, no overflow/errors`);
    });
    await context.close();
  }
} finally {
  await browser.close();
  server.kill();
}
