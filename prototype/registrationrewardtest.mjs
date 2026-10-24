#!/usr/bin/env node
/* global localStorage, document */
/** Actual registration → hub → award, on the playable host. Run after pnpm prototype. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:net';
import { mkdirSync, writeFileSync } from 'node:fs';
import { launchBrowser, waitForApp, withDiagnostics } from './harnessKit.mjs';
import { bundleNetserver } from './bundle-netserver.mjs';

await bundleNetserver();
const picker = createServer();
await new Promise((resolve) => picker.listen(0, '127.0.0.1', resolve));
const port = picker.address().port;
await new Promise((resolve) => picker.close(resolve));
const base = `http://127.0.0.1:${port}`;
const env = {
  ...process.env,
  PORT: String(port),
  HOST: '127.0.0.1',
  PROD: '0',
  AUTH_JWT_SECRET: randomBytes(32).toString('hex'),
  ALLOWED_ORIGINS: base,
  AUTH_RATE_MAX: '200',
  MATCHES: '1',
};
delete env.DATABASE_URL;
const server = spawn(process.execPath, ['packages/server/dist/proto-server.mjs'], {
  env,
  stdio: ['ignore', 'pipe', 'pipe'],
});
process.on('exit', () => server.kill());
let log = '';
await new Promise((resolve, reject) => {
  const timeout = setTimeout(() => {
    server.kill();
    reject(new Error(`host startup failed: ${log}`));
  }, 45_000);
  const read = (chunk) => {
    log = (log + chunk).slice(-15_000);
    if (/game\s*:\s*http:/.test(log)) {
      clearTimeout(timeout);
      resolve();
    }
  };
  server.stdout.on('data', read);
  server.stderr.on('data', read);
  server.on('exit', (code) => {
    clearTimeout(timeout);
    reject(new Error(`host exited ${code}: ${log}`));
  });
});
const browser = await launchBrowser();
mkdirSync('.playwright-mcp', { recursive: true });
const results = [];
try {
  for (const [locale, width, height] of [
    ['ru', 1366, 900],
    ['en', 390, 844],
  ]) {
    for (const action of ['accept', 'equip']) {
      const context = await browser.newContext({
        viewport: { width, height },
        isMobile: width < 600,
        hasTouch: width < 600,
      });
      const page = await context.newPage();
      page.setDefaultTimeout(20_000);
      const errors = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await page.addInitScript((lang) => localStorage.setItem('vd.locale', lang), locale);
      await withDiagnostics(page, `registration-reward-${locale}-${action}`, async () => {
        await page.goto(base);
        await waitForApp(page);
        await page.click('#cnew');
        const login = `Welcome${locale}${action}`;
        const password = randomBytes(24).toString('base64url');
        await page.fill('#crnick', login);
        await page.fill('#crpass', password);
        await page.fill('#crpass2', password);
        const registration = page.waitForResponse(
          (r) => r.url() === base + '/auth/register' && r.request().method() === 'POST',
        );
        await page.click('#crgo');
        const response = await registration;
        assert.equal(response.status(), 201);
        const account = await response.json();
        const headers = { authorization: `Bearer ${account.token}` };
        const profile = async () => (await fetch(base + '/profiles', { headers })).json();
        const receipt = async () =>
          (await fetch(base + '/profiles/rewards/registration', { headers })).json();
        // Remember-me (AC-0.2): a reload renews the stored session and lands in the hub
        // without the password being typed again.
        const signBackIn = async () => {
          await page.locator('#hub').waitFor({ state: 'visible' });
          assert.equal(await page.locator('#cwpass').isVisible(), false, 'no password after reload');
        };
        const dialog = page.locator('#registration-reward');
        await dialog.waitFor({ state: 'visible' });
        assert.equal(await page.locator('#hub').isVisible(), true);
        assert.match(
          await dialog.innerText(),
          locale === 'ru' ? /Поздравляем! 🎉/ : /Congratulations! 🎉/,
        );
        assert.match(await dialog.locator('.rw-grade').innerText(), /III/);
        const xp = (await receipt()).reward.xp;
        assert.equal(xp, 25);
        assert.match(await dialog.locator('.rw-xp').innerText(), /\+25/);
        assert.equal((await profile()).xp, xp);
        await dialog.locator('img').evaluate((img) => img.decode());
        assert.equal(await dialog.locator('img').evaluate((img) => img.naturalWidth > 0), true);
        const fits = await dialog.evaluate((el) => {
          const box = el.getBoundingClientRect();
          return (
            el.scrollWidth <= el.clientWidth + 1 &&
            box.left >= 0 &&
            box.right <= document.documentElement.clientWidth + 1
          );
        });
        assert.equal(fits, true, 'modal fits the viewport without horizontal overflow');
        assert.equal(
          await page.evaluate(() => document.activeElement?.getAttribute('data-reward')),
          'accept',
        );
        await page.keyboard.press('Tab');
        assert.equal(
          await page.evaluate(() => document.activeElement?.getAttribute('data-reward')),
          'equip',
        );
        await page.screenshot({
          path: `.playwright-mcp/registration-reward-${locale}-${action}.png`,
        });

        // Closing is not acceptance; a reload restores the pending award with no extra XP.
        await dialog.locator('[data-reward="later"]').click();
        // Medal rewards: the window waits for the welcome award, then lists what the medal
        // paid. «За вклад в развитие» is earned without playing: Sovereigns only.
        const medals = page.locator('#medal-rewards');
        await medals.waitFor({ state: 'visible' });
        const paid = await medals.innerText();
        assert.match(paid, /\+10 ◆/);
        assert.doesNotMatch(paid, /⌖/);
        assert.equal(
          (await (await fetch(base + '/meta-economy/me', { headers })).json()).sovereigns,
          10,
        );
        await page.screenshot({ path: `.playwright-mcp/medal-rewards-${locale}-${action}.png` });
        await medals.locator('[data-mreward="ok"]').click();
        await medals.waitFor({ state: 'hidden' });
        assert.equal((await receipt()).reward.accepted, false);
        await page.reload();
        await waitForApp(page);
        await signBackIn();
        await dialog.waitFor({ state: 'visible' });
        assert.equal((await profile()).xp, xp);

        // The server commits, but the browser loses the response: retry must not pay/equip twice.
        const lostResponse = locale === 'en' && action === 'equip';
        const acceptRoute = '**/profiles/rewards/registration/accept';
        if (lostResponse)
          await page.route(acceptRoute, async (route) => {
            await route.fetch();
            await route.fulfill({
              status: 503,
              contentType: 'application/json',
              body: '{"error":"E_TEST_RESPONSE_LOST"}',
            });
          });
        await dialog.locator(`[data-reward="${action}"]`).click();
        if (lostResponse) {
          await dialog
            .locator('.rw-notice')
            .filter({ hasText: /Could not save/ })
            .waitFor();
          assert.equal((await receipt()).reward.accepted, true);
          await page.unroute(acceptRoute);
          await dialog.locator(`[data-reward="${action}"]`).click();
        }
        await dialog.waitFor({ state: 'hidden' });
        const saved = await profile();
        assert.equal(saved.xp, xp);
        assert.equal(saved.progress.registered, 1);
        assert.equal(
          saved.slots.filter((id) => id === 'contribution').length,
          action === 'equip' ? 1 : 0,
        );
        const checked = page.waitForResponse(
          (r) => r.url() === base + '/profiles/rewards/registration',
        );
        await page.reload();
        await waitForApp(page);
        await signBackIn();
        await checked;
        assert.equal(
          await dialog.isVisible(),
          false,
          'accepted award stays dismissed after reload',
        );

        await page.click('#hubav');
        await page.locator('#profile.show').waitFor();
        await page.click('[data-pstab="medals"]');
        const medal = page.locator('[data-medal="contribution"]');
        await medal.waitFor();
        await page.waitForFunction(
          () => !document.querySelector('[data-medal="contribution"]')?.disabled,
        );
        assert.match(await medal.innerText(), /III/);
        assert.equal(await medal.isEnabled(), true, 'medal remains in the profile collection');
        assert.deepEqual(errors, []);
        results.push({
          locale,
          width,
          action,
          xp,
          degree: 'III',
          reload: true,
          responseLossRetried: lostResponse,
          errors,
        });
      });
      await context.close();
    }
  }
  writeFileSync(
    '.playwright-mcp/registration-reward-results.json',
    JSON.stringify(results, null, 2),
  );
  console.log(JSON.stringify(results, null, 2));
} finally {
  await browser.close();
  server.kill();
}
