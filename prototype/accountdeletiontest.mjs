/* global window */
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { serve, launchBrowser } from './harnessKit.mjs';
const bundle = await build({ stdin: { contents: `
import { mountAccountDeletion, mountPrivacyLinks } from './prototype/src/accountDeletion';
import { saveSession } from './decisions/sessionStore';
import './localization/runtime';
window.__BUILD__ = { channel: 'rustore', privacyUrl: 'privacy.html' };
saveSession(localStorage, 'ws://game.test', { token: 'synthetic-token', login: 'pilot' });
mountPrivacyLinks();
mountAccountDeletion(() => 'ws://game.test', () => { window.accepted = true; });
`, resolveDir: process.cwd(), loader: 'ts' }, bundle: true, write: false, format: 'iife', platform: 'browser' });
const site = await serve({ '/': `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><a id="cl-privacy">Политика</a><button id="hub-delete-account">Удалить аккаунт</button><script>${bundle.outputFiles[0].text}</script></body></html>` });
const browser = await launchBrowser();
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: 'ru-RU' });
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  let calls = 0;
  await page.route('http://game.test/auth/delete-account', async route => {
    calls++;
    assert.equal(await route.request().headerValue('authorization'), 'Bearer synthetic-token');
    assert.deepEqual(route.request().postDataJSON(), { password: 'secret phrase', confirm: 'DELETE' });
    return route.fulfill({ status: calls === 1 ? 503 : 202, contentType: 'application/json', body: JSON.stringify(calls === 1 ? { error: 'E_DELETION_UNAVAILABLE' } : { status: 'pending', requestId: 'synthetic-request' }) });
  });
  await page.goto(site.url);
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
  assert.equal(await page.locator('dialog').count(), 0);
  assert.equal(await page.locator('#cl-privacy').getAttribute('href'), 'privacy.html');
  await page.locator('#cl-privacy').click();
  assert.equal(await page.getByRole('dialog').locator('iframe').getAttribute('src'), 'privacy.html');
  await page.getByRole('button', { name: 'Закрыть политику' }).click();
  assert.equal(await page.locator('dialog').count(), 0);
  assert.deepEqual(errors, []);
  console.log('Account deletion mobile dialog: confirmation, visibility, retry, pending acknowledgment and privacy link passed.');
} finally { await browser.close(); site.server.close(); }
