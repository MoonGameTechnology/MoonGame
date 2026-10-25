/* global document */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { X509Certificate, createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

const [repo, ip, baseDir] = process.argv.slice(2);
const require = createRequire(`${repo}/package.json`);
const { chromium } = createRequire(require.resolve('@playwright/mcp/package.json'))(
  'playwright-core',
);
const { resolveChromium } = await import(`${repo}/scripts/chromium.mjs`);
const certificate = new X509Certificate(readFileSync(`${baseDir}/edge.crt`));
const spki = createHash('sha256')
  .update(certificate.publicKey.export({ type: 'spki', format: 'der' }))
  .digest('base64');
const browser = await chromium.launch({
  headless: true,
  ...(resolveChromium() ? { executablePath: resolveChromium() } : {}),
  args: [
    '--no-sandbox',
    '--disable-dev-shm-usage',
    '--no-proxy-server',
    `--host-resolver-rules=MAP play.example.test ${ip}`,
    `--ignore-certificate-errors-spki-list=${spki}`,
  ],
});
const results = [];
const record = (name) => {
  results.push({ case: name, passed: true });
  console.log(name);
};
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.setDefaultTimeout(30000);
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const messages = [];
  const sent = [];
  const sockets = [];
  page.on('websocket', (ws) => {
    sockets.push(ws);
    ws.on('framereceived', ({ payload }) => {
      try {
        messages.push(JSON.parse(String(payload)));
      } catch {
        /* Non-JSON protocol frames are not gameplay events. */
      }
    });
    ws.on('framesent', ({ payload }) => {
      try {
        sent.push(JSON.parse(String(payload)));
      } catch {
        /* Non-JSON protocol frames are not gameplay events. */
      }
    });
  });
  const response = await page.goto('https://play.example.test:8443/');
  assert.equal(response.status(), 200);
  await page.waitForFunction(() => !document.body.classList.contains('app-starting'));
  record('actual-image-browser-load');
  const api = (path, body, token) =>
    page.evaluate(
      async ({ path, body, token }) => {
        const r = await fetch(path, {
          method: body ? 'POST' : 'GET',
          headers: {
            ...(body ? { 'Content-Type': 'application/json' } : {}),
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          ...(body ? { body: JSON.stringify(body) } : {}),
        });
        return { status: r.status, body: await r.json() };
      },
      { path, body, token },
    );
  assert.equal((await api('/auth/status')).body.enabled, true);
  const password = 'quiet orbit over seven unusual moons 2026';
  const registration = await api('/auth/register', { login: 'WafProbePilot', password });
  assert.equal(registration.status, 201);
  record('actual-api-register');
  const login = await api('/auth/login', { login: 'WafProbePilot', password });
  assert.equal(login.status, 200);
  assert.equal(typeof login.body.token, 'string');
  record('actual-api-login');
  assert.equal(
    (
      await api('/auth/login', {
        login: 'WafProbePilot',
        password: 'another quiet orbit over moons',
      })
    ).status,
    401,
  );
  record('actual-api-rejects-wrong-password');
  if (!(await page.locator('#cwnick').isVisible())) await page.locator('#clogin').click();
  await page.fill('#cwnick', 'WafProbePilot');
  await page.fill('#cwpass', password);
  await page.click('#cwgo');
  await page.locator('#hub').waitFor({ state: 'visible' });
  record('actual-browser-account-login');
  const reward = page.locator('#registration-reward[open]');
  await reward.waitFor({ state: 'visible' });
  await reward.locator('[data-reward=accept]').click();
  await reward.waitFor({ state: 'hidden' });
  record('actual-browser-registration-reward');
  const medals = page.locator('#medal-rewards[open]');
  await medals.waitFor({ state: 'visible' });
  await medals.locator('button').first().click();
  await medals.waitFor({ state: 'hidden' });
  await page.click('#hub-play');
  await page.locator('#mlist .mrow .mbtn').first().click();
  await page.locator('#setup').waitFor({ state: 'visible' });
  await page.locator('#setupmap [data-cand]:not([data-taken])').first().click();
  await page.click('#setupgo');
  await page.waitForURL(/\/game\//);
  for (let n = 0; n < 100 && !messages.some((m) => m.type === 'welcome'); n++)
    await page.waitForTimeout(100);
  const welcome = messages.find((m) => m.type === 'welcome');
  assert(welcome?.gated);
  assert(sockets.some((ws) => ws.url().startsWith('wss://play.example.test:8443/')));
  record('actual-browser-authenticated-wss-join');
  await page.waitForTimeout(12000);
  await page.click('#holo-tech');
  if (await page.locator('#intro.show').isVisible()) await page.click('#intro .in-ok');
  const tabs = await page.$$eval('.tt-tab[data-ttab]', (els) => els.map((e) => e.dataset.ttab));
  let accepted = false;
  for (const tab of [null, ...tabs]) {
    if (tab) await page.click(`.tt-tab[data-ttab="${tab}"]`);
    const take = page.locator('.tt-take:not([disabled])').first();
    if (!(await take.count())) continue;
    const tech = await take.getAttribute('data-go');
    await take.click();
    await page.locator(`.tt-item.st-res[data-tech="${tech}"]`).waitFor({ state: 'attached' });
    accepted = true;
    break;
  }
  assert(accepted);
  assert(sent.some((m) => m.type === 'action.v1'));
  assert(!messages.some((m) => m.type === 'rejection'));
  record('actual-browser-order-after-wss-idle');
  await page.reload();
  for (let n = 0; n < 100 && messages.filter((m) => m.type === 'welcome').length < 2; n++)
    await page.waitForTimeout(100);
  assert(messages.filter((m) => m.type === 'welcome').length >= 2);
  record('actual-browser-rejoin-after-reload');
  assert.deepEqual(errors, []);
  record('actual-browser-no-page-errors');
} finally {
  await browser.close();
  writeFileSync(`${baseDir}/game-results.json`, JSON.stringify(results, null, 2) + '\n');
}
