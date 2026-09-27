#!/usr/bin/env node
/* global window -- browser-side test hooks */
import assert from 'node:assert/strict';
import {
  enterSkirmish,
  instrumentedGame,
  launchBrowser,
  serve,
  withDiagnostics,
} from './harnessKit.mjs';

// Test-only access to the actual host. No debug exports enter the player build.
const hooks = `window.__minesTest = {
  prepared: () => inMatch() && mapWasEntered && !mapPreparation.active,
  prepare: () => {
    speed = 0;
    s = structuredClone(s);
    const f = Object.values(s.fleets).find(f => f.owner === ME);
    const a = Object.values(s.planets).find(p => p.links?.some(id => s.planets[id]));
    const b = a.links.find(id => s.planets[id]);
    for (const [id, enemy] of Object.entries(s.fleets)) if (enemy.owner !== ME) delete s.fleets[id];
    f.units = [{ unit: 'cruiser', count: 1, modules: ['rocket_mine_layer'] }];
    f.location = null; f.movement = null; f.battleId = null; f.edge = { from: a.id, to: b, t: 0.5 };
    s.players[ME].resources.metal = 1000; s.players[ME].resources.microelectronics = 1000;
    setFleetSelection([f.id]);
    lastPanelHtml = ''; lastCmdHtml = ''; renderPanel(); renderCmdBar();
  },
  ord: () => s.ordnance,
  arm: () => { apply(advance(s, s.ordnance.installations[0].readyAt)); mineControls.refresh(); },
  ordinary: () => {
    s = structuredClone(s);
    s.fleets[selFleet].units[0].modules = ['mine_layer'];
    lastPanelHtml = ''; renderPanel();
  },
  fields: () => s.minefields
};`;

const host = await serve(await instrumentedGame(hooks));
const browser = await launchBrowser();
try {
  for (const viewport of [
    { width: 1280, height: 800 },
    { width: 390, height: 844 },
  ]) {
    const context = await browser.newContext({
      viewport,
      isMobile: viewport.width < 600,
      hasTouch: viewport.width < 600,
    });
    const page = await context.newPage();
    await withDiagnostics(page, `mines-${viewport.width}`, async () => {
      await page.goto(host.url);
      await enterSkirmish(page);
      await page.waitForFunction(() => window.__minesTest.prepared());
      await page.evaluate(() => window.__minesTest.prepare());
      // The phone keeps utility commands under the real More button.
      if (viewport.width < 600) await page.locator('[data-cmd="more"]').click();
      await page.locator('[data-cmd="rocket-mine"]').click();
      const deploy = page.locator('[data-rm="deploy"][data-mode="confirmed"]');
      assert.equal(await deploy.isEnabled(), true);
      await deploy.click();
      assert.equal(await page.evaluate(() => window.__minesTest.ord().installations.length), 1);
      assert.equal(await deploy.isEnabled(), false);
      await page.evaluate(() => window.__minesTest.arm());
      assert.equal(await page.evaluate(() => window.__minesTest.ord().mines.length), 1);
      await page.locator('[data-rm="mode"][data-mode="any"]').click();
      assert.equal(await page.evaluate(() => window.__minesTest.ord().mines[0].mode), 'any');
      await page.locator('[data-rm="disarm"]').click();
      assert.equal(await page.evaluate(() => window.__minesTest.ord().mines.length), 0);
      await page.locator('#codex .cx-close').click();
      if (viewport.width > 600) {
        await page.evaluate(() => window.__minesTest.ordinary());
        await page.locator('[data-act="laymines"]').click();
        assert.equal(
          await page.evaluate(() => Object.keys(window.__minesTest.fields().installations).length),
          1,
        );
      }
    });
    console.log(`Mines UI ${viewport.width}px passed.`);
    await context.close();
  }
  console.log(
    'Mines UI smoke passed: desktop/mobile deployment, modes, disarm, ordinary minelayer.',
  );
} finally {
  await browser.close();
  await host.close();
}
