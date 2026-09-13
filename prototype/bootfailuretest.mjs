#!/usr/bin/env node
/* global window, localStorage, sessionStorage, Storage, DOMException -- browser fault injection */
// Exercise the packaged entry point, including a synchronous failure before main
// reaches its welcome-screen wiring. This is fault injection, not an Android emulator.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { resolveChromium } from '../scripts/chromium.mjs';

const require = createRequire(import.meta.url);
const { chromium } = createRequire(require.resolve('@playwright/mcp/package.json'))(
  'playwright-core',
);
const scratch = mkdtempSync(join(tmpdir(), 'void-boot-'));
const pages = {};
for (const profile of ['alpha', 'player']) {
  const source = `prototype/dist/void-dominion${profile === 'player' ? '-player' : ''}.html`;
  const file = join(scratch, `${profile}.html`);
  writeFileSync(file, readFileSync(source));
  execFileSync(process.execPath, ['mobile/inject-build.mjs', file, '2726', '988f5f45']);
  pages[`/${profile}`] = readFileSync(file);
}
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
  executablePath: resolveChromium() ?? undefined,
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});
try {
  for (const profile of ['alpha', 'player'])
    for (const locale of ['ru', 'en']) {
      const context = await browser.newContext({
        viewport: { width: 360, height: 800 },
        isMobile: true,
        hasTouch: true,
        deviceScaleFactor: 2,
      });
      // The packaged updater may be offline; entry and translations must still work.
      await context.route('https://api.github.com/**', (route) => route.abort());
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', (error) => errors.push(error.message));
      let navigations = 0;
      page.on('request', (request) => {
        // history.pushState for Android Back is not a document reload.
        if (request.isNavigationRequest() && request.frame() === page.mainFrame()) navigations++;
      });
      await page.addInitScript(
        ({ locale }) => {
          localStorage.setItem('vd.locale', locale);
          localStorage.setItem('void.nick', 'Boot probe');
          if (!sessionStorage.getItem('boot-probe-once')) {
            sessionStorage.setItem('boot-probe-once', '1');
            const getItem = Storage.prototype.getItem;
            Storage.prototype.getItem = function (key) {
              if (key === 'void.server')
                throw new DOMException('injected storage denial', 'SecurityError');
              return getItem.call(this, key);
            };
          }
        },
        { locale },
      );
      await page.goto(`http://127.0.0.1:${server.address().port}/${profile}`);
      await page.locator('#startup-error').waitFor({ state: 'visible', timeout: 5000 });
      assert.match(await page.locator('#startup-code').innerText(), /E_CLIENT_STARTUP/);
      assert(
        await page.locator('#cnew').innerText(),
        'translations run before fallible game startup',
      );
      const retry = page.locator('#startup-retry');
      assert.match(await retry.innerText(), locale === 'ru' ? /Повторить/ : /Try again/);
      const box = await retry.boundingBox();
      assert(box.width >= 44 && box.height >= 44, 'retry is reachable by touch');
      const initialBox = await page.locator('#startup-error').boundingBox();
      await page.evaluate(async () => {
        for (let i = 0; i < 30; i++) await new Promise(window.requestAnimationFrame);
      });
      assert.deepEqual(await page.locator('#startup-error').boundingBox(), initialBox);
      assert.equal(navigations, 1, 'a startup failure must not trigger automatic reloads');
      assert.deepEqual(errors, [], 'startup exception is handled');
      await retry.tap();
      await page.locator('#cnew').waitFor({ state: 'visible' });
      assert(await page.locator('#cnew').innerText());
      assert.equal(await page.locator('#startup-error').isVisible(), false);
      assert.equal(navigations, 2, 'only an explicit retry reloads');
      if (!(await page.locator('#cwnick').isVisible())) await page.locator('#clogin').tap();
      assert.equal(
        await page.locator('#cwnick').inputValue(),
        'Boot probe',
        'retry preserves identity',
      );
      await page.locator('#cwgo').tap();
      await page.locator('#hub-solo').waitFor({ state: 'visible' });
      assert.deepEqual(errors, []);
      console.log(
        'BOOT_FAILURE_PASS',
        profile,
        locale,
        'localized failure, stable frame, explicit retry and offline entry',
      );
      await context.close();
    }
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
  rmSync(scratch, { recursive: true, force: true });
}
