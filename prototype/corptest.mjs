#!/usr/bin/env node
/* global localStorage */
/** Real playable host + real cabinet: auth, creation, construction and reload. */
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
    const registered = await fetch(`${base}/auth/register`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ login: `Builder${locale}`, password: 'CorpSmoke_4321' }),
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
        await page.fill('#cwnick', `Builder${locale}`);
        await page.fill('#cwpass', 'CorpSmoke_4321');
        await page.click('#cwgo');
        await page.locator('#hub').waitFor({ state: 'visible' });
      };
      await signIn();
      await page.click('[data-hub="ally"]');
      await page.click('#ccorp');
      if (await page.locator('#intro .in-ok').isVisible()) {
        await page.click('#intro .in-ok');
        assert.equal(await page.locator('#corp').isVisible(), true);
      }
      await page.fill('#corpnewname', `Builders ${locale}`);
      await page.click('[data-corpact="create"]');
      await page.locator('#corphd .cident b').filter({ hasText: `Builders ${locale}` }).waitFor();
      await page.click('[data-corptab="buildings"]');
      const build = page.locator('[data-corpact="build"][data-corparg="headquarters"]');
      await build.waitFor();
      assert.equal(await build.isEnabled(), true);
      assert.equal(await page.locator('[data-corparg="supply_center"]').isDisabled(), true);
      await page.screenshot({ path: `.playwright-mcp/corporation-${locale}-catalog.png` });
      await build.click();
      await page.locator('.cbuild-queue').waitFor();
      assert.equal(await build.isDisabled(), true);
      assert.equal(await page.locator('.cbuild-card').count(), 3);
      const overflow = await page.$eval('#corpbody', (el) => el.scrollWidth > el.clientWidth + 1);
      assert.equal(overflow, false, 'cabinet must not overflow horizontally');
      await page.screenshot({ path: `.playwright-mcp/corporation-${locale}-queue.png` });
      await page.reload();
      await waitForApp(page);
      await signIn();
      await page.click('[data-hub="ally"]');
      await page.click('#ccorp');
      await page.click('[data-corptab="buildings"]');
      await page.locator('.cbuild-queue').waitFor();
      assert.equal(await page.locator('[data-corparg="headquarters"]').isDisabled(), true);
      assert.deepEqual(errors, []);
      console.log(`PASS ${locale} ${width}x${height}: login → create → build → persisted queue, no overflow/errors`);
    });
    await context.close();
  }
} finally {
  await browser.close();
  server.kill();
}
