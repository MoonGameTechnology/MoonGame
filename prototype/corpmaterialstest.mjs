#!/usr/bin/env node
/* global AbortSignal, localStorage, document */
/** Disposable PG + actual playable host: corporation treasury and construction in RU/EN. */
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

const sourceUrl = process.env.CORP_MATERIALS_TEST_DATABASE_URL;
const source = sourceUrl ? new URL(sourceUrl) : null;
assert(
  source &&
    ['127.0.0.1', 'localhost'].includes(source.hostname) &&
    source.pathname.endsWith('_test'),
  'Provide a local *_test database URL in CORP_MATERIALS_TEST_DATABASE_URL',
);
const database = `corp_material_smoke_${randomBytes(6).toString('hex')}_test`;
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
await new Promise((resolve, reject) =>
  picker.close((error) => (error ? reject(error) : resolve())),
);
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
  HOST: '127.0.0.1',
  PORT: String(port),
  PROD: '0',
  NODE_ENV: 'test',
  AUTH_JWT_SECRET: secret,
  ALLOWED_ORIGINS: base,
  AUTH_RATE_MAX: '200',
  MATCHES: '1',
  DATABASE_URL: url.href,
});
const server = spawn(process.execPath, [bundle], { env, stdio: ['ignore', 'pipe', 'pipe'] });
let log = '';
let spawnError;
server.once('error', (error) => {
  spawnError = error;
});
for (const stream of [server.stdout, server.stderr])
  stream.on('data', (chunk) => {
    log = (log + chunk).slice(-12_000);
  });
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

const browser = await launchBrowser();
mkdirSync('.playwright-mcp', { recursive: true });
try {
  for (
    let i = 0;
    i < 100 &&
    !(await fetch(`${base}/health`).then(
      (r) => r.ok,
      () => false,
    ));
    i++
  ) {
    if (spawnError) throw spawnError;
    if (server.exitCode !== null) throw new Error('host exited during startup');
    await delay(300);
  }
  for (const [locale, width, height] of [
    ['ru', 1280, 900],
    ['ru', 320, 640],
    ['en', 390, 844],
  ]) {
    const tag = `${locale}-${width}`,
      head = await account(`Material${width}`);
    const { corpId } = await request('/corps', { token: head.token, body: {} }, 201);
    // Fixtures remain confined to this disposable local database. All mutations below
    // go through the production host's authenticated UI and transaction coordinator.
    await db.query('UPDATE corps SET influence=1000,infrastructure=$2::jsonb WHERE id=$1', [
      corpId,
      JSON.stringify({
        levels: { headquarters: 1 },
        construction: null,
        accruedAt: Date.now(),
        remainder: 0,
      }),
    ]);
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
    await withDiagnostics(page, `corp-materials-${tag}`, async () => {
      await page.goto(base);
      await waitForApp(page);
      await page.locator('#cwpass').waitFor({ state: 'visible' });
      if (!(await page.locator('#cwnick').isVisible())) await page.click('#clogin');
      await page.fill('#cwnick', head.login);
      await page.fill('#cwpass', password);
      await page.click('#cwgo');
      await page.locator('#hub').waitFor({ state: 'visible' });
      for (const [dialog, accept] of [
        ['registration-reward', '[data-reward="accept"]'],
        ['medal-rewards', '[data-mreward="ok"]'],
      ]) {
        await page.locator(`#${dialog}[open]`).waitFor();
        await page.click(`#${dialog} ${accept}`);
        await page.locator(`#${dialog}`).waitFor({ state: 'hidden' });
      }
      const lots = [
        ['construction_blocks', 8],
        ['engineering_kits', 3],
      ].map(([materialId, quantity]) => ({
        lotId: `fixture-${materialId}`,
        materialId,
        quantity,
        soulbound: false,
        source: 'match',
        sourceId: 'smoke',
        acquiredAt: Date.now(),
      }));
      await db.query(
        "UPDATE meta_economy_accounts SET state=jsonb_set(state,'{materials}',$2::jsonb) WHERE account_id=$1",
        [head.accountId, JSON.stringify(lots)],
      );
      const openCorp = async () => {
        await page.click('[data-hub="corp"]');
        if (await page.locator('#intro .in-ok').isVisible()) await page.click('#intro .in-ok');
      };
      await openCorp();
      await page.locator('#hp-corp .cb-id h2').waitFor();
      // Enough influence alone cannot enable a material-priced building.
      await page.click('#hp-corp [data-corpbld="supply_center"].cb-bc');
      await page.locator('#corp-sheet.open').waitFor();
      assert.equal(await page.locator('#corp-sheet [data-corpact="build"]').count(), 0);
      await page.keyboard.press('Escape');
      await page.click('#hp-corp [data-corpsec="treasury"]');
      await page
        .locator('#hp-corp input[data-corpmaterial="construction_blocks"]:enabled')
        .waitFor();
      assert.equal(await page.locator('#hp-corp [data-corpact="contribute"]').count(), 3);
      for (const [id, n] of [
        ['construction_blocks', 8],
        ['engineering_kits', 3],
      ]) {
        await page.fill(`#hp-corp input[data-corpmaterial="${id}"]`, String(n));
        const response = page.waitForResponse(
          (r) =>
            r.url().endsWith('/meta-economy/corp-materials/contribute') &&
            r.request().method() === 'POST',
        );
        await page.click(`#hp-corp [data-corpact="contribute"][data-corparg="${id}"]`);
        assert.equal((await response).status(), 200);
        await page.locator(`#hp-corp input[data-corpmaterial="${id}"][max="0"]:disabled`).waitFor();
      }
      assert.equal(
        await page.$eval('#hp-corp', (el) => el.scrollWidth > el.clientWidth + 1),
        false,
      );
      await page.screenshot({ path: `.playwright-mcp/corp-materials-${tag}-treasury.png` });
      await page.click('#hp-corp [data-corpsec="base"]');
      await page.click('#hp-corp [data-corpbld="supply_center"].cb-bc');
      const build = page.locator('#corp-sheet [data-corpact="build"]');
      await build.waitFor();
      assert.equal(await build.isEnabled(), true);
      assert.equal(
        await page.$eval('#corp-sheet .cb-sheet', (el) => el.scrollWidth > el.clientWidth + 1),
        false,
      );
      await page.waitForFunction(() =>
        document
          .querySelector('#corp-sheet .cb-sheet')
          .getAnimations()
          .every((a) => a.playState !== 'running'),
      );
      await page.screenshot({ path: `.playwright-mcp/corp-materials-${tag}-price.png` });
      await build.click();
      await page.locator('#corp-sheet .cb-sheet-job').waitFor();
      const saved = (
        await db.query('SELECT state FROM meta_economy_accounts WHERE account_id=$1', [
          `corp:${corpId}`,
        ])
      ).rows[0].state.corpMaterials;
      assert.equal(saved.available.construction_blocks, 0);
      assert.equal(saved.available.engineering_kits, 0);
      assert.equal(saved.pending, undefined);
      assert.equal(
        saved.history.filter((r) => r.kind === 'construction' && r.status === 'spent').length,
        1,
      );
      await page.keyboard.press('Escape');
      await page.reload();
      await waitForApp(page);
      await page.locator('#hub').waitFor({ state: 'visible' });
      await openCorp();
      await page.locator('#hp-corp .cb-hud:not(.idle)').waitFor();
      await page.click('#hp-corp [data-corpsec="treasury"]');
      await page.locator('#hp-corp .cb-materials').waitFor();
      await page.click('#hp-corp [data-corpact="materials-market"]');
      await page.locator('#hp-auction').waitFor({ state: 'visible' });
      assert.deepEqual(errors, []);
      console.log(
        `PASS materials ${tag}: own stock → contributions → visible tier price → paid construction → reload → auction, no overflow/errors`,
      );
    });
    await context.close();
  }
} catch (error) {
  let safeLog = log;
  for (const value of secrets) safeLog = safeLog.replaceAll(value, '[redacted]');
  process.stderr.write(`Corporation material smoke failed: ${error.message}\n${safeLog}\n`);
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
