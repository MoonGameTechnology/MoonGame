#!/usr/bin/env node
/* global window, document, localStorage */
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { instrumentedGame, serve, launchBrowser, withDiagnostics } from './harnessKit.mjs';

const a = { id: 'alpha', name: 'Alpha' },
  b = { id: 'beta', name: 'Beta' },
  c = { id: 'gamma', name: 'Gamma' };
const at = Date.UTC(2026, 10, 1, 12);
const founded = (id, corp) => ({ id, at, kind: 'founded', corp });
let events = [];
const hooks = `import { saveSession as __saveNewsSession } from '../../decisions/sessionStore';
window.__newsUi = {
  async home(nick = 'AdmiralDest') {
    nickInput.value = nick;
    srvInput.value = location.origin.replace(/^http/, 'ws');
    __saveNewsSession(localStorage, srvInput.value, { login: nick, token: 'news-ui-fixture' });
    openHub();
    await news.refresh();
  },
  refresh: () => news.refresh()
};`;
const site = await serve(await instrumentedGame(hooks));
const browser = await launchBrowser();
mkdirSync('.playwright-mcp', { recursive: true });
try {
  for (const [width, height, lang] of [
    [320, 740, 'ru'],
    [393, 852, 'ru'],
    [390, 844, 'en'],
    [1366, 900, 'ru'],
  ]) {
    events = [founded('one', a), founded('two', b), founded('three', c)];
    const context = await browser.newContext({
      viewport: { width, height },
      isMobile: width < 600,
      hasTouch: width < 600,
    });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.setDefaultTimeout(15_000);
    await page.addInitScript((lang) => {
      if (!localStorage.getItem('vd.locale')) localStorage.setItem('vd.locale', lang);
    }, lang);
    await page.route('**/auth/status', (route) => route.fulfill({ json: { enabled: true } }));
    await page.route('**/matches?**', (route) =>
      route.fulfill({ json: { available: [], active: [], archived: [] } }),
    );
    await page.route('**/news', (route) =>
      route.fulfill({ json: { serverNow: at + 100, more: false, announcements: [], events } }),
    );
    await page.route('**/corps/me', (route) =>
      route.fulfill({
        json: {
          membership: { corpId: a.id, accountId: '1', login: 'AdmiralDest', role: 'member' },
          corp: { corpId: a.id, name: a.name, influence: 10 },
        },
      }),
    );
    let directoryFails = true;
    await page.route('**/corps', (route) =>
      directoryFails ? route.fulfill({ status: 503, json: { error: 'E_UNAVAILABLE' } }) : route.fulfill({
        json: {
          corps: [a, b, c].map((x) => ({ corpId: x.id, name: x.name, members: 3, influence: 10 })),
        },
      }),
    );
    await withDiagnostics(page, `news-${width}-${lang}`, async () => {
      await page.goto(site.url);
      await page.evaluate(() => window.__newsUi.home());
      const news = page.locator('#hub-news');
      await news.waitFor({ state: 'visible' });
      assert.equal(await page.locator('#hub-lang,#news-col,#news-teaser').count(), 0);
      assert.equal(await news.evaluate((el) => el.classList.contains('has-news')), true);
      assert.ok(
        await page.locator('.hub-id').evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
        'header overflow',
      );
      if (width === 393) await page.screenshot({ path: '.playwright-mcp/news-home.png', animations: 'disabled' });
      await news.click();
      await page.locator('#news-sheet.open .nw-it').first().waitFor();
      assert.equal(await page.locator('#news-sheet .nw-it').count(), 3);
      assert.equal(await news.evaluate((el) => el.classList.contains('has-news')), false);
      const close = page.locator('#news-sheet .btn-x');
      await close.focus();
      await page.keyboard.press('Shift+Tab');
      assert.equal(
        await page.evaluate(() => document.activeElement.closest('#news-sheet') !== null),
        true,
      );
      await page.keyboard.press('Escape');
      await page.locator('#news-sheet.open').waitFor({ state: 'hidden' });
      assert.equal(await page.evaluate(() => document.activeElement.id), 'hub-news');
      events.push(founded('new-beta', b));
      await page.evaluate(() => window.__newsUi.refresh());
      assert.equal(await news.evaluate((el) => el.classList.contains('has-news')), false);
      await news.click();
      await page.click('[data-nw-settings]');
      await page.locator('#settings.show .news-prefs').waitFor();
      await page.locator('[data-news-retry]').waitFor();
      directoryFails = false;
      await page.locator('[data-news-retry]').click();
      await page.fill('[data-news-search]', 'Beta');
      await page.locator('[data-news-directory] [data-news-follow="beta"]').click();
      assert.equal(await page.locator('[data-news-followed] [data-news-follow="beta"]').count(), 1);
      await page.selectOption('[data-news-scope]', 'following');
      if (width === 393) {
        await page.locator('.setbox').evaluate(el => { el.scrollTop = 0; });
        await page.screenshot({ path: '.playwright-mcp/news-settings.png', animations: 'disabled' });
      }
      await page.click('#set-close');
      events.push(founded('latest-beta', b));
      await page.evaluate(() => window.__newsUi.refresh());
      assert.equal(await news.evaluate((el) => el.classList.contains('has-news')), true);
      await news.click();
      await page.waitForFunction(
        () => document.querySelectorAll('#news-sheet .nw-it').length === 4,
      );
      assert.equal(
        await page
          .locator('#news-sheet')
          .innerText()
          .then((text) => text.includes('Gamma')),
        false,
      );
      assert.ok(
        await page.locator('.nw-sheet').evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
        'news window overflow',
      );
      if (width === 393) await page.screenshot({ path: '.playwright-mcp/news-feed.png', animations: 'disabled' });
      await page.locator('#news-sheet .btn-x').click();
      await page.reload();
      await page.evaluate(() => window.__newsUi.home());
      assert.equal(
        await news.evaluate((el) => el.classList.contains('has-news')),
        false,
        'read state survives reload',
      );
      await page.click('#hub-gear');
      await page.click('[data-settab="news"]');
      assert.equal(await page.locator('[data-news-scope]').inputValue(), 'following');
      assert.equal(await page.locator('[data-news-followed] [data-news-follow="beta"]').count(), 1);
      await page.locator('[data-news-category="corp"]').uncheck();
      await page.click('#set-close');
      events.push(founded('muted-beta', b));
      await page.evaluate(() => window.__newsUi.refresh());
      assert.equal(await news.evaluate((el) => el.classList.contains('has-news')), false);
      await page.click('#hub-gear');
      await page.click('[data-settab="game"]');
      assert.equal(await page.locator('#set-language').inputValue(), lang);
      const nextLang = lang === 'ru' ? 'en' : 'ru';
      await Promise.all([page.waitForEvent('load'), page.selectOption('#set-language', nextLang)]);
      assert.equal(await page.evaluate(() => localStorage.getItem('vd.locale')), nextLang);
      await page.evaluate(() => window.__newsUi.home('OtherPilot'));
      assert.equal(
        await news.evaluate((el) => el.classList.contains('has-news')),
        true,
        'another account has independent read state',
      );
      await page.click('#hub-gear');
      await page.click('[data-settab="news"]');
      assert.equal(await page.locator('[data-news-followed] [data-news-follow]').count(), 0);
      assert.deepEqual(errors, []);
    });
    console.log(`PASS ${width}px ${lang}`);
    await context.close();
  }
  console.log(
    'PASS news window, unread badge, interests, subscriptions, account isolation and language (RU/EN, 320–1366px)',
  );
} finally {
  await browser.close();
  await site.close();
}
