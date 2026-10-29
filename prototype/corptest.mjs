#!/usr/bin/env node
/* global localStorage, document */
/** Real playable host + the hub «Корпорация» tab (CORP-3): auth, creation, construction and reload. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:net';
import { mkdirSync, readFileSync } from 'node:fs';
import { launchBrowser, waitForApp, withDiagnostics } from './harnessKit.mjs';
import { bundleNetserver } from './bundle-netserver.mjs';

const names = JSON.parse(readFileSync('data/corpNames.json', 'utf8'));
const allowedNames = new Set(names.prefixes.flatMap(prefix => names.nouns.map(noun => `${prefix} ${noun}`)));
const buildingCount = JSON.parse(readFileSync('data/corpBuildings.json', 'utf8')).buildings.length;
const identityOnly = process.argv.includes('--identity-only');

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
      // Then the medal reward window: the welcome medal pays its Sovereigns.
      await page.locator('#medal-rewards[open]').waitFor();
      await page.click('#medal-rewards [data-mreward="ok"]');
      await page.locator('#medal-rewards').waitFor({ state: 'hidden' });
      const openTab = async () => {
        await page.click('[data-hub="corp"]');
        if (await page.locator('#intro .in-ok').isVisible()) await page.click('#intro .in-ok');
      };
      await openTab();
      await page.locator('#hp-corp [data-corpdraft="falcon"]').waitFor();
      assert.equal(await page.locator('#corp-hub-name').count(), 0, 'creation has no free-text name');
      assert.equal(await page.locator('#hp-corp [data-corpdraft]').count(), 20);
      await page.locator('#hp-corp [data-corpdraft="wolf"]').focus();
      await page.keyboard.press('Enter');
      assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('data-corpdraft')), 'wolf');
      await page.screenshot({ path: `.playwright-mcp/corporation-${locale}-identity-create.png` });
      await page.click('#hp-corp [data-corpact="create"]');
      await page.locator('#hp-corp .cb-id h2').waitFor();
      const corporationName = (await page.locator('#hp-corp .cb-id h2').textContent()).trim();
      assert.ok(allowedNames.has(corporationName), 'name comes from the server catalogue');
      await page.locator('#hp-corp .cb-head [data-corp-emblem="wolf"]').waitFor();
      await page.click('#hp-corp [data-corpsec="settings"]');
      await page.locator('#hp-corp .cb-settings').waitFor();
      await page.screenshot({ path: `.playwright-mcp/corporation-${locale}-settings.png` });
      await page.click('#hp-corp [data-corphub="emblem"]');
      await page.locator('#corp-sheet.open').waitFor();
      assert.equal(await page.locator('#corp-sheet [data-corpact="emblem"]').count(), 20);
      assert.equal(await page.locator('#corp-sheet [data-corparg="wolf"]').getAttribute('aria-pressed'), 'true');
      await page.waitForFunction(() => document.querySelector('#corp-sheet .cb-sheet')
        .getAnimations().every(animation => animation.playState !== 'running'));
      await page.screenshot({ path: `.playwright-mcp/corporation-${locale}-identity-picker.png` });
      await page.locator('#corp-sheet [data-corpact="emblem"][data-corparg="phoenix"]').focus();
      await page.keyboard.press('Enter');
      await page.locator('#hp-corp .cb-head [data-corp-emblem="phoenix"]').waitFor();
      await page.waitForFunction(() => document.activeElement?.getAttribute('data-corparg') === 'phoenix');
      await page.keyboard.press('Escape');
      await page.locator('#corp-sheet.open').waitFor({ state: 'detached' });
      // Public corporation card reached from a player has one back action, with focus restored.
      await page.click('#hubav');
      await page.locator('#profile.show').waitFor();
      await page.click('#profile [data-pstab="career"]');
      const corporation = page.locator('#profile [data-profile-corp]');
      await corporation.click();
      await page.locator('#profile .pf-corp-members li.head').waitFor();
      assert.equal(await page.locator('#profile .pf-close').count(), 0);
      assert.equal(await page.locator('#profile [data-profile-corp-back]').count(), 1);
      assert.equal(await page.locator('#profile .pf-corp-stats .pf-cell').count(), 2);
      assert.equal(await page.$eval('#profile .pf-corp-card', el => el.scrollWidth > el.clientWidth + 1), false);
      await page.screenshot({ path: `.playwright-mcp/corporation-${locale}-public-card.png` });
      await page.click('#profile [data-profile-corp-back]');
      await page.waitForFunction(() => document.activeElement?.hasAttribute('data-profile-corp'));
      await corporation.click();
      await page.locator('#profile .pf-corp-members li.head').waitFor();
      await page.keyboard.press('Escape');
      await corporation.waitFor();
      await page.keyboard.press('Escape');
      await page.locator('#profile.show').waitFor({ state: 'detached' });
      if (identityOnly) {
        await page.reload();
        await waitForApp(page);
        await page.locator('#hub').waitFor({ state: 'visible' });
        await openTab();
        await page.locator('#hp-corp .cb-head [data-corp-emblem="phoenix"]').waitFor();
        assert.equal((await page.locator('#hp-corp .cb-id h2').textContent()).trim(), corporationName);
        assert.equal(await page.$eval('#hp-corp', el => el.scrollWidth > el.clientWidth + 1), false);
        await page.screenshot({ path: `.playwright-mcp/corporation-${locale}-identity-restored.png` });
        assert.deepEqual(errors, []);
        console.log(`PASS identity ${locale} ${width}x${height}: 20 emblems → generated name → head selection → reload, no overflow/errors`);
        return;
      }
      await page.click('#hp-corp [data-corpsec="base"]');
      assert.equal(await page.locator('#hp-corp .cb-bc').count(), buildingCount);
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
      for (const section of ['members', 'treasury', 'battles', 'settings']) {
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
      await page.locator('#hp-corp .cb-head [data-corp-emblem="phoenix"]').waitFor();
      assert.equal((await page.locator('#hp-corp .cb-id h2').textContent()).trim(), corporationName);
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
