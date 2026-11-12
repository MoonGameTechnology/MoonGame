#!/usr/bin/env node
/* global window, document, localStorage */
/** Real mouse/touch/keyboard events on the shipped diplomacy controller and full game layout. */
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  enterSkirmish,
  instrumentedGame,
  launchBrowser,
  pressSpeed,
  serve,
  waitForApp,
  withDiagnostics,
} from './harnessKit.mjs';

const out = process.env.HARNESS_OUT ?? join(tmpdir(), 'void-harness', 'diplomacy');
mkdirSync(out, { recursive: true });
const site = await serve(
  await instrumentedGame(`
import { isForkSite as probeFork } from '../../packages/shared-core/src/index';
window.diploTest = {
  seed: () => {
    AI_PLAYERS.clear();
    const base = s.players[ME];
    s.players = Object.fromEntries(['p1','p2','p3','p4'].map((id,i) => [id, {
      ...structuredClone(base), id, ai:i===3, name:['Alpha','Zulu','Beta','Crimson'][i]
    }]));
    for (const [id, p] of Object.entries(s.players)) NAME[id] = p.name;
    s.diplomacy = { 'p1|p2':'peace', 'p1|p3':'war', 'p1|p4':'alliance' };
    const owners = ['p1','p1',...Array(9).fill('p2'),...Array(3).fill('p3'),...Array(3).fill('p4')];
    Object.values(s.planets).filter(p=>!probeFork(p)).forEach((p,i)=>{p.owner=owners[i]??null;});
    refreshSeatNicks(location.origin,'probe','me',()=>renderDiplo(),true);
  },
  open: () => openDiplo('diplo'), refresh: () => renderDiplo(),
  many: () => {
    for(let i=5;i<=50;i++) {const id='p'+i;s.players[id]={...s.players.p4,id};NAME[id]='House '+i;}
    renderDiplo();
  }
};
`),
);
const browser = await launchBrowser();
try {
  for (const [locale, width, height] of [
    ['ru', 1366, 900],
    ['ru', 390, 844],
    ['en', 390, 844],
    ['en', 740, 390],
  ]) {
    const phone = width < 500 || height < 520;
    const context = await browser.newContext({
      viewport: { width, height },
      isMobile: phone,
      hasTouch: phone,
    });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text());
    });
    await page.addInitScript((lang) => localStorage.setItem('vd.locale', lang), locale);
    await page.route('**/matches/probe/seats*', (route) =>
      route.fulfill({
        json: {
          seats: [
            { playerId: 'p1', nick: 'Zulu' },
            { playerId: 'p2', nick: 'Pilot 10' },
            { playerId: 'p3', nick: 'Pilot 2' },
          ],
        },
      }),
    );
    await withDiagnostics(page, `diplomacy-${locale}-${width}`, async () => {
      await page.goto(site.url);
      await waitForApp(page);
      await enterSkirmish(page, { tap: phone });
      await pressSpeed(page, '#spd-pause', { tap: phone });
      await page.evaluate(() => {
        window.diploTest.seed();
        window.diploTest.open();
      });
      await page.locator('.dp-prof[data-prof="p2"]').waitFor();
      const press = (selector) =>
        phone ? page.locator(selector).tap() : page.locator(selector).click();
      const ids = () =>
        page
          .locator('#diplo .dp-row')
          .evaluateAll((rows) => rows.map((row) => row.dataset.rosterSeat));
      assert.deepEqual(await ids(), ['p1', 'p3', 'p2', 'p4']);
      if (phone) {
        // Phone: sorting and filters sit behind one button, closed until asked for.
        assert.equal(await page.locator('[data-sort="name"]').isVisible(), false);
        await press('.dp-ftoggle');
        assert.equal(await page.locator('.dp-ftoggle').getAttribute('aria-expanded'), 'true');
      } else {
        assert.equal(await page.locator('.dp-ftoggle').isVisible(), false);
      }
      for (const [key, expected] of [
        ['name', ['p4', 'p3', 'p2', 'p1']],
        ['name', ['p1', 'p2', 'p3', 'p4']],
        ['worlds', ['p2', 'p4', 'p3', 'p1']],
        ['worlds', ['p1', 'p4', 'p3', 'p2']],
        ['stance', ['p1', 'p3', 'p2', 'p4']],
        ['stance', ['p4', 'p2', 'p3', 'p1']],
      ]) {
        await press(`[data-sort="${key}"]`);
        assert.deepEqual(await ids(), expected);
        assert.equal(
          await page.locator(`[data-sort="${key}"]`).getAttribute('aria-pressed'),
          'true',
        );
      }
      // Type through real input events: replacing the window must preserve focus and caret.
      await press('#dp-search');
      await page.locator('#dp-search').pressSequentially('pILoT');
      assert.equal(await page.locator('#dp-search').inputValue(), 'pILoT');
      assert.deepEqual(await ids(), ['p2', 'p3']);
      await page.evaluate(() => window.diploTest.refresh());
      assert.equal(await page.evaluate(() => document.activeElement.id), 'dp-search');
      await page.locator('#dp-search').pressSequentially(' 2');
      assert.deepEqual(await ids(), ['p3']);
      await press('[data-ftype="ai"]');
      assert.deepEqual(await ids(), []);
      await press('.dp-fclear');
      assert.equal((await ids()).length, 4);
      assert.equal(await page.locator('#dp-search').inputValue(), '');
      await press('[data-fstance="peace"]');
      assert.deepEqual(await ids(), ['p2']);
      await press('.dp-fclear');
      await page.locator('[data-expand="p3"]').focus();
      await page.keyboard.press('Enter');
      assert.equal(await page.locator('[data-expand="p3"]').getAttribute('aria-expanded'), 'true');
      assert.ok(await page.locator('.dp-actions').isVisible());
      await page.keyboard.press('Enter');
      assert.equal(await page.locator('.dp-actions').count(), 0);
      await press('[data-sort="name"]');
      await page.screenshot({ path: join(out, `diplomacy-${locale}-${width}.png`) });
      await page.evaluate(() => window.diploTest.many());
      const list = page.locator('#diplo .dp-list');
      await list.evaluate((el) => {
        el.scrollTop = 150;
      });
      const before = await list.evaluate((el) => el.scrollTop);
      assert.ok(before > 0);
      await page.evaluate(() => window.diploTest.refresh());
      assert.equal(await list.evaluate((el) => el.scrollTop), before);
      await press('[data-sort="worlds"]');
      assert.equal(await list.evaluate((el) => el.scrollTop), 0);
      await press('.dp-close');
      await page.evaluate(() => window.diploTest.open());
      assert.equal(await page.locator('[data-sort="worlds"]').getAttribute('aria-pressed'), 'true');
      const overflow = await page
        .locator('#diplo .dpbox')
        .evaluate((el) => el.scrollWidth > el.clientWidth + 1);
      assert.equal(overflow, false);
      if (phone) {
        const small = await page
          .locator('.dp-tools button, .dp-tools input, .dp-expand')
          .evaluateAll((els) =>
            els
              .filter((el) => {
                const r = el.getBoundingClientRect();
                return r.height < 44 || r.width < 44;
              })
              .map((el) => el.className),
          );
        assert.deepEqual(small, []);
      }
      assert.deepEqual(errors, []);
    });
    console.log(
      `PASS diplomacy ${locale} ${width}×${height}: sorting, search, filters, keyboard, refresh, scroll and reopen`,
    );
    await context.close();
  }
} finally {
  await browser.close();
  await site.close();
}
