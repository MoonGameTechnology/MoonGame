/* global window, localStorage */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { build } from 'esbuild';
import { serve, launchBrowser } from './harnessKit.mjs';
const bundle = await build({ stdin: { contents: `
import { mountAccountDeletion, mountPrivacyLinks } from './prototype/src/accountDeletion';
import { saveSession } from './decisions/sessionStore';
import './localization/runtime';
window.__BUILD__ = { channel: 'rustore', privacyUrl: 'privacy.html' };
saveSession(localStorage, 'ws://game.test', { token: 'synthetic-token', login: 'pilot' });
mountPrivacyLinks();
window.currentServer = 'ws://game.test';
window.deletionAllowed = true;
window.refreshDeletion = mountAccountDeletion(() => window.currentServer, () => { window.accepted = true; }, () => window.deletionAllowed);
void window.refreshDeletion();
`, resolveDir: process.cwd(), loader: 'ts' }, bundle: true, write: false, format: 'iife', platform: 'browser' });
const visibilityRule = readFileSync('prototype/build.mjs', 'utf8').match(/#hub #hub-delete-account\[hidden\]\{[^}]+\}/)?.[0];
assert.ok(visibilityRule);
const site = await serve({ '/': `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>#hub .hub-tile{display:flex}${visibilityRule}</style></head><body><a id="cl-privacy">Политика</a><div id="hub"><button class="hub-tile" id="hub-delete-account">Удалить аккаунт</button></div><script>${bundle.outputFiles[0].text}</script></body></html>` });
const browser = await launchBrowser();
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: 'ru-RU' });
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  let calls = 0; let requestId; let available = true;
  let holdDeletion = false; let releaseDeletion;
  const requests = [];
  await page.route('http://game.test/auth/status', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ enabled: true, accountDeletion: available }) }));
  await page.route('http://game.test/auth/delete-account', async route => {
    calls++;
    const body = route.request().postDataJSON();
    requests.push({ authorization: await route.request().headerValue('authorization'), body });
    requestId ??= body.requestId;
    if (holdDeletion) await new Promise(resolve => { releaseDeletion = resolve; });
    return route.fulfill({ status: calls === 1 ? 503 : 202, contentType: 'application/json', body: JSON.stringify(calls === 1 ? { error: 'E_DELETION_UNAVAILABLE' } : { status: 'pending', requestId: body.requestId }) });
  });
  await page.goto(site.url);
  available = false; await page.evaluate(() => window.refreshDeletion());
  assert.equal(await page.locator('#hub-delete-account').isHidden(), true);
  available = true; await page.evaluate(() => window.refreshDeletion());
  await page.locator('#hub-delete-account').click();
  const dialog = page.getByRole('dialog'); await dialog.waitFor();
  assert.equal(await dialog.getByRole('heading').textContent(), 'Удалить аккаунт');
  const password = dialog.locator('input[type=password]'); await password.fill('secret phrase');
  await dialog.getByRole('button', { name: 'Показать пароль', exact: true }).click();
  assert.equal(await dialog.locator('input[type=text]').inputValue(), 'secret phrase');
  await dialog.getByRole('button', { name: 'Подтвердить удаление' }).click();
  assert.equal(calls, 0);
  await dialog.getByRole('checkbox').check();
  await dialog.getByRole('button', { name: 'Подтвердить удаление' }).click();
  await dialog.getByRole('status').filter({ hasText: 'временно недоступно' }).waitFor();
  assert.equal(await dialog.locator('input[type=password]').inputValue(), '');
  assert.equal(await page.evaluate(() => window.accepted), undefined);
  await dialog.locator('input[type=password]').fill('secret phrase');
  await dialog.getByRole('button', { name: 'Подтвердить удаление' }).click();
  await page.waitForFunction(() => window.accepted === true);
  await page.locator('dialog').waitFor({ state: 'detached' });
  assert.match(requestId, /^[0-9a-f-]{36}$/);
  assert.deepEqual(requests, [1, 2].map(() => ({ authorization: 'Bearer synthetic-token', body: { password: 'secret phrase', confirm: 'DELETE', requestId } })));
  assert.equal(await page.locator('#cl-privacy').getAttribute('href'), 'privacy.html');
  await page.locator('#cl-privacy').click();
  assert.equal(await page.getByRole('dialog').locator('iframe').getAttribute('src'), 'privacy.html');
  await page.getByRole('button', { name: 'Закрыть политику' }).click();
  await page.locator('dialog').waitFor({ state: 'detached' });

  // A confirmation belongs to the account/server for which the dialog opened.
  for (const change of ['account', 'server', 'permission']) {
    await page.reload();
    await page.locator('#hub-delete-account').click();
    await page.getByRole('dialog').waitFor();
    await page.getByRole('dialog').locator('input[type=password]').fill('secret phrase');
    await page.getByRole('dialog').getByRole('checkbox').check();
    const before = calls;
    await page.evaluate(change => {
      if (change === 'account') localStorage.setItem('void.session.ws://game.test', JSON.stringify({ login: 'other', token: 'other-token' }));
      if (change === 'server') window.currentServer = 'ws://other.test';
      if (change === 'permission') window.deletionAllowed = false;
    }, change);
    await page.getByRole('dialog').getByRole('button', { name: 'Подтвердить удаление' }).click();
    await page.locator('dialog').waitFor({ state: 'detached' });
    assert.equal(calls, before, `${change}: stale confirmation must not send a deletion`);
    assert.equal(await page.evaluate(() => window.accepted), undefined);
  }

  // Another tab can sign in while an already confirmed deletion awaits the server.
  await page.reload();
  await page.locator('#hub-delete-account').click();
  await page.getByRole('dialog').locator('input[type=password]').fill('secret phrase');
  await page.getByRole('dialog').getByRole('checkbox').check();
  holdDeletion = true;
  await page.getByRole('dialog').getByRole('button', { name: 'Подтвердить удаление' }).click();
  const deadline = Date.now() + 5000;
  while (!releaseDeletion) {
    assert.ok(Date.now() < deadline, 'confirmed deletion did not reach the server');
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  await page.evaluate(() => localStorage.setItem('void.session.ws://game.test', JSON.stringify({ login: 'other', token: 'other-token' })));
  releaseDeletion();
  await page.locator('dialog').waitFor({ state: 'detached' });
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('void.session.ws://game.test')).token), 'other-token');
  assert.equal(await page.evaluate(() => window.accepted), undefined);
  assert.deepEqual(errors, []);
  console.log('Account deletion mobile dialog: confirmation, visibility, retry, privacy link and account/server changes before and during deletion passed.');
} finally { await browser.close(); site.server.close(); }
