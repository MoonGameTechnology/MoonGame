/** Real marker composer/list/popup clicks on desktop and touch: kind survives, deletion removes the map marker. */
/* global window */
import assert from 'node:assert/strict';
import { enterSkirmish, instrumentedGame, launchBrowser, serve, withDiagnostics } from './harnessKit.mjs';

const hooks = `window.__pingTest = {
  open: () => { pickWorld(capitalOf(s, ME)); pings.closePanel(); pings.closePop(); pings.openMenu(); },
  list: () => pings.openPanel(),
  pop: () => { pings.closePanel(); pings.openPop(capitalOf(s, ME)); },
  state: () => ({ markers: pings.drawable().map(m => ({ loc: m.ping, kind: m.pingKind ?? 'mark' })), hits: pingHits.length }),
};`;
const site = await serve(await instrumentedGame(hooks));
const browser = await launchBrowser({ timeout: 30000 });
const errors = [];
try {
  for (const phone of [false, true]) {
    const page = await browser.newPage({ viewport: phone ? { width: 390, height: 844 } : { width: 1366, height: 768 }, hasTouch: phone });
    page.on('pageerror', error => errors.push(error.message));
    await withDiagnostics(page, `pings-${phone ? 'phone' : 'desktop'}`, async () => {
      await page.goto(site.url);
      await enterSkirmish(page, { tap: phone });
      const invoke = name => page.evaluate(name => window.__pingTest[name](), name);
      for (const kind of ['mark', 'defend', 'attack']) {
        await invoke('open');
        const choice = page.locator(`[data-pmkind="${kind}"]`);
        if (phone) await choice.tap(); else await choice.click();
        assert.equal(await choice.getAttribute('aria-pressed'), 'true');
        await page.locator('#pm-text').fill(`test ${kind}`);
        await page.locator('[data-pmdest="coalition"]').click();
        assert.equal((await invoke('state')).markers[0].kind, kind);
        await invoke('list');
        assert.equal(await page.locator('#pingpanel .pp-row').count(), 1);
        assert(await page.locator('#pingpanel .pp-icon').getAttribute('title'));
        if (kind === 'defend') {
          await invoke('pop');
          await page.locator('#pingpop .pp-del').click();
        } else {
          await page.locator('#pingpanel [data-pact="del"]').click();
        }
        assert.deepEqual((await invoke('state')).markers, [], 'delete removes the marker from the map source');
      }
    });
    await page.close();
  }
  assert.deepEqual(errors, []);
  console.log('pings: three kinds, list/popup deletion, desktop/touch — OK');
} finally {
  await browser.close();
  await site.close();
}
