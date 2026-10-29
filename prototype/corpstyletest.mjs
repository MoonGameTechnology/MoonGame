#!/usr/bin/env node
/* global AbortSignal, localStorage, document */
/** CORP-14: base styles of a corporation in the shop, end to end on the players' host. Run
 * after `pnpm prototype`: the netserver bundle of the production image against a throwaway
 * database created next to the given local `*_test` one (CORP_STYLE_TEST_DATABASE_URL) and
 * dropped after. Sovereigns are sold only through a payment provider the host does not have,
 * so the head's balance is written straight into the store; everything after that is the
 * host's own doing. In the browser — a desktop and two phones — the head buys Imperial
 * Gothic in the shop's styles tab, applies it, sees the base redrawn, goes from the
 * corporation's style sheet to the shop for High-tech and applies the standard style back.
 * Over HTTP a member can neither buy nor apply, and the style stays with the corporation
 * when the head hands over. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { bundleNetserver } from './bundle-netserver.mjs';
import { launchBrowser, waitForApp, withDiagnostics } from './harnessKit.mjs';

const require = createRequire(new URL('../packages/server/package.json', import.meta.url));
const { Pool } = require('pg');

const sourceUrl = process.env.CORP_STYLE_TEST_DATABASE_URL;
const source = sourceUrl ? new URL(sourceUrl) : null;
assert(
  source && ['127.0.0.1', 'localhost'].includes(source.hostname) && source.pathname.endsWith('_test'),
  'Provide a local *_test database URL in CORP_STYLE_TEST_DATABASE_URL',
);
const database = `corp_style_smoke_${randomBytes(6).toString('hex')}_test`;
const admin = new Pool({ connectionString: sourceUrl });
await admin.query(`CREATE DATABASE "${database}"`);
const url = new URL(sourceUrl);
url.pathname = `/${database}`;
const db = new Pool({ connectionString: url.href });

const picker = createServer();
await new Promise((resolve, reject) => {
  picker.once('error', reject);
  picker.listen(0, '127.0.0.1', resolve);
});
const port = picker.address().port;
await new Promise((resolve, reject) => picker.close((error) => (error ? reject(error) : resolve())));
const base = `http://127.0.0.1:${port}`;
const secret = randomBytes(32).toString('hex');

const bundle = await bundleNetserver();
// Allowlist process plumbing instead of inheriting endpoints/credentials from a real deployment.
const env = Object.fromEntries(
  ['PATH', 'SystemRoot', 'WINDIR', 'TMPDIR', 'TEMP', 'TMP'].flatMap((key) =>
    process.env[key] === undefined ? [] : [[key, process.env[key]]],
  ),
);
Object.assign(env, {
  HOST: '127.0.0.1', PORT: String(port), PROD: '0', NODE_ENV: 'test',
  AUTH_JWT_SECRET: secret, ALLOWED_ORIGINS: base, AUTH_RATE_MAX: '200',
  MATCHES: '1', DATABASE_URL: url.href,
});
const server = spawn(process.execPath, [bundle], { env, stdio: ['ignore', 'pipe', 'pipe'] });
let log = '';
let spawnError;
server.once('error', (error) => { spawnError = error; });
for (const stream of [server.stdout, server.stderr])
  stream.on('data', (chunk) => { log = (log + chunk).slice(-12_000); });
const exited = new Promise((resolve) => server.once('exit', resolve));
const killOnExit = () => server.kill('SIGKILL');
process.on('exit', killOnExit);
const secrets = [secret];

async function request(path, { token, body } = {}, expected = 200) {
  const response = await fetch(base + path, {
    method: body ? 'POST' : 'GET',
    headers: {
      ...(body ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(5000),
  });
  const payload = await response.json();
  assert.equal(response.status, expected, `${path}: ${response.status} ${payload.error ?? ''}`);
  return payload;
}

const suffix = randomBytes(4).toString('hex');
const password = `Smoke-aA1-${randomBytes(18).toString('base64url')}`;
async function account(name) {
  const login = `${name}${suffix}`;
  const body = await request('/auth/register', { body: { login, password } }, 201);
  secrets.push(body.token);
  return { login, token: body.token, accountId: body.accountId };
}

/** The base's pictures on the panorama, in drawing order. */
const panorama = (page) =>
  page.$$eval('#hp-corp .cb-lot image', (images) => images.map((image) => image.getAttribute('href')));

const browser = await launchBrowser();
mkdirSync('.playwright-mcp', { recursive: true });
try {
  for (let i = 0; i < 100 && !(await fetch(`${base}/health`).then((r) => r.ok, () => false)); i++) {
    if (spawnError) throw spawnError;
    if (server.exitCode !== null) throw new Error('host exited during startup');
    await delay(300);
  }

  let firstHead;
  let firstCorp;
  for (const [locale, width, height] of [['ru', 1280, 900], ['ru', 320, 640], ['en', 390, 844]]) {
    const tag = `${locale}-${width}`;
    const head = await account(`Stylist${width}`);
    const { corpId } = await request('/corps', { token: head.token, body: { name: `Style ${tag} ${suffix}` } }, 201);
    firstHead ??= head;
    firstCorp ??= corpId;
    const phone = width < 600;
    const context = await browser.newContext({ viewport: { width, height }, isMobile: phone, hasTouch: phone });
    const page = await context.newPage();
    page.setDefaultTimeout(20_000);
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.addInitScript((lang) => localStorage.setItem('vd.locale', lang), locale);
    await withDiagnostics(page, `corp-style-${tag}`, async () => {
      await page.goto(base);
      await waitForApp(page);
      await page.locator('#cwpass').waitFor({ state: 'visible' });
      if (!(await page.locator('#cwnick').isVisible())) await page.click('#clogin');
      await page.fill('#cwnick', head.login);
      await page.fill('#cwpass', password);
      await page.click('#cwgo');
      await page.locator('#hub').waitFor({ state: 'visible' });
      await page.locator('#registration-reward[open]').waitFor();
      await page.click('#registration-reward [data-reward="accept"]');
      await page.locator('#registration-reward').waitFor({ state: 'hidden' });
      await page.locator('#medal-rewards[open]').waitFor();
      await page.click('#medal-rewards [data-mreward="ok"]');
      await page.locator('#medal-rewards').waitFor({ state: 'hidden' });
      // The medal paid its ◆, so the account's record exists: top it up for one style.
      const topped = await db.query(
        `UPDATE meta_economy_accounts SET state = jsonb_set(state, '{sovereigns}', '600') WHERE account_id = $1`,
        [head.accountId],
      );
      assert.equal(topped.rowCount, 1);

      const corpTab = async () => {
        await page.click('[data-hub="corp"]');
        if (await page.locator('#intro .in-ok').isVisible()) await page.click('#intro .in-ok');
      };
      const appearance = page.locator('#hp-corp [data-corphub="style"]');
      const settings = async () => page.click('#hp-corp [data-corpsec="settings"]');
      const baseTab = async () => page.click('#hp-corp [data-corpsec="base"]');
      await corpTab();
      await settings();
      await appearance.filter({ hasText: locale === 'ru' ? 'Стандарт' : 'Standard' }).waitFor();
      await baseTab();
      const standard = await panorama(page);
      assert.equal(standard.length, 3);

      // Shop: all five tabs fit, the head buys Imperial Gothic in two taps and applies it.
      await page.evaluate(() => document.getElementById('hub-shop').click());
      await page.click('#hp-shop [data-sh-tab="styles"]');
      const clipped = await page.$$eval('#hp-shop :is(.sh-tabs,.sh-tab)', (els) =>
        els.filter((el) => el.scrollWidth > el.clientWidth + 1).map((el) => el.textContent));
      assert.deepEqual(clipped, [], 'every shop tab and its label fit');
      await page.click('#hp-shop [data-sh-pick="corp_style_imperial_gothic"]');
      const detail = page.locator(phone ? '#shop-sheet .ar-sheet-body' : '#hp-shop .sh-detail');
      await detail.locator('[data-sh-buy="corp_style_imperial_gothic"]').click();
      await detail.locator('[data-sh-buy-do="corp_style_imperial_gothic"]').click();
      await detail.locator('[data-sh-apply="imperial_gothic"]').click();
      await detail.locator('button[disabled]').filter({ hasText: locale === 'ru' ? 'Применён' : 'Applied' }).waitFor();
      await page.screenshot({ path: `.playwright-mcp/corp-style-${tag}-shop.png` });
      const me = await request('/meta-economy/me', { token: head.token });
      assert.equal(me.sovereigns, 600 - 490);
      if (phone) {
        await page.click('#shop-sheet .btn-x');
        await page.locator('#shop-sheet.open').waitFor({ state: 'detached' });
      }

      // The base is redrawn in the applied style.
      await corpTab();
      await settings();
      await appearance.filter({ hasText: locale === 'ru' ? 'Имперская готика' : 'Imperial Gothic' }).waitFor();
      await baseTab();
      const gothic = await panorama(page);
      assert.equal(gothic.length, 3);
      assert.ok(gothic.every((href, i) => href !== standard[i]), 'every building is drawn in the new style');
      await page.screenshot({ path: `.playwright-mcp/corp-style-${tag}-base.png` });

      // The style sheet sends an unbought style to the shop and applies a bought one.
      await settings();
      await appearance.click();
      await page.locator('#corp-sheet [data-corpshop="high_tech"]').click();
      // The shop opens on that style; 110 ◆ are left, so its button names the shortfall.
      const shopDetail = page.locator(phone ? '#shop-sheet .ar-sheet-body' : '#hp-shop .sh-detail');
      await shopDetail.locator('#sh-dt-title').filter({ hasText: locale === 'ru' ? 'Хайтек' : 'High-tech' }).waitFor();
      await shopDetail.locator('button[disabled]').filter({ hasText: '380' }).waitFor();
      if (phone) {
        await page.click('#shop-sheet .btn-x');
        await page.locator('#shop-sheet.open').waitFor({ state: 'detached' });
      }
      await corpTab();
      await settings();
      await appearance.click();
      await page.waitForFunction(() => document.querySelector('#corp-sheet .cb-sheet')
        .getAnimations().every((a) => a.playState !== 'running'));
      await page.screenshot({ path: `.playwright-mcp/corp-style-${tag}-sheet.png` });
      await page.click('#corp-sheet [data-corpstyle="standard"]');
      await appearance.filter({ hasText: locale === 'ru' ? 'Стандарт' : 'Standard' }).waitFor();
      await page.keyboard.press('Escape');
      await page.locator('#corp-sheet.open').waitFor({ state: 'detached' });
      await baseTab();
      assert.deepEqual(await panorama(page), standard);
      assert.equal(await page.$eval('#hp-corp', (el) => el.scrollWidth > el.clientWidth + 1), false);
      assert.deepEqual(errors, []);
      console.log(`PASS ${tag}: shop tabs fit → buy → apply → base redrawn → sheet → shop → standard back`);
    });
    await context.close();
  }

  // Over HTTP: a member neither buys nor applies; the style stays when the head hands over.
  const member = await account('Member');
  await request(`/corps/${firstCorp}/apply`, { token: member.token, body: {} });
  await request(`/corps/${firstCorp}/accept`, { token: firstHead.token, body: { target: member.accountId } });
  const style = (who) => request('/meta-economy/corp-style', { token: who.token });
  assert.deepEqual(await style(member), { corp: { head: false, active: 'standard', backdrop: 'orbit', owned: ['imperial_gothic'] } });
  const refused = (who, path, body) => request(`/meta-economy/corp-style/${path}`, {
    token: who.token, body: { requestId: randomBytes(8).toString('hex'), ...body },
  }, 409);
  assert.equal((await refused(member, 'buy', { offerId: 'corp_style_high_tech' })).error, 'E_FORBIDDEN');
  assert.equal((await refused(member, 'apply', { styleId: 'imperial_gothic' })).error, 'E_FORBIDDEN');
  await request(`/corps/${firstCorp}/transfer`, { token: firstHead.token, body: { target: member.accountId } });
  assert.deepEqual(await style(member), { corp: { head: true, active: 'standard', backdrop: 'orbit', owned: ['imperial_gothic'] } });
  await request('/meta-economy/corp-style/apply', {
    token: member.token, body: { requestId: randomBytes(8).toString('hex'), styleId: 'imperial_gothic' },
  });
  assert.equal((await style(firstHead)).corp.active, 'imperial_gothic');
  assert.equal((await refused(firstHead, 'apply', { styleId: 'standard' })).error, 'E_FORBIDDEN');
  console.log('PASS http: a member is refused; the style stays with the corporation under a new head');

  // CORP-15: a backdrop is bought and applied the same way and leaves the style in place. The
  // first head gets the corporation back: their account already has a meta-economy record.
  await request(`/corps/${firstCorp}/transfer`, { token: member.token, body: { target: firstHead.accountId } });
  const topped = await db.query(
    `UPDATE meta_economy_accounts SET state = jsonb_set(state, '{sovereigns}', '300') WHERE account_id = $1`,
    [firstHead.accountId],
  );
  assert.equal(topped.rowCount, 1);
  const send = (path, body) => request(`/meta-economy/corp-style/${path}`, {
    token: firstHead.token, body: { requestId: randomBytes(8).toString('hex'), ...body },
  });
  await send('buy', { offerId: 'corp_backdrop_nebula' });
  await send('apply', { styleId: 'nebula' });
  assert.deepEqual(await style(firstHead), {
    corp: { head: true, active: 'imperial_gothic', backdrop: 'nebula', owned: ['imperial_gothic', 'nebula'] },
  });
  console.log('PASS http: a backdrop is bought and applied next to the style');
} catch (error) {
  let safeLog = log;
  for (const value of secrets) safeLog = safeLog.replaceAll(value, '[redacted]');
  process.stderr.write(`Corporation style smoke failed: ${error.message}\n${safeLog}\n`);
  process.exitCode = 1;
} finally {
  await browser.close();
  server.kill('SIGTERM');
  await Promise.race([exited, delay(3000)]);
  if (server.exitCode === null && server.signalCode === null) {
    server.kill('SIGKILL');
    await exited;
  }
  process.off('exit', killOnExit);
  await db.end();
  await admin.query(`DROP DATABASE IF EXISTS "${database}" WITH (FORCE)`);
  await admin.end();
}
