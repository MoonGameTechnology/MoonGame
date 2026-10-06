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
  // SM-3.7a: the standing rocket mine is a fleet; its doctrine lives in \`ordnance.controls\`.
  rockets: () => Object.values(s.fleets).filter((f) => isRocketMineFleet(f, data)).map((f) => f.id),
  mode: (id) => s.ordnance.controls?.[id]?.mode ?? null,
  arm: () => { apply(advance(s, s.ordnance.installations[0].readyAt)); mineControls.refresh(); },
  // Selected the common way, the rocket mine shows its own card and takes no orders.
  rocketCard: () => {
    const id = Object.keys(s.fleets).find((id) => isRocketMineFleet(s.fleets[id], data));
    if (!id) return null;
    setFleetSelection([id]);
    lastPanelHtml = ''; renderPanel();
    return { card: lastPanelHtml.includes(t('mine.card.rocket-rule')), orderable: selectedFleetIds().length };
  },
  ordinary: () => {
    s = structuredClone(s);
    // The carrier again: the rocket mine card above left the (now lifted) mine selected.
    const f = Object.values(s.fleets).find((f) => f.owner === ME && !isMineFleet(f, data));
    f.units[0].modules = ['mine_layer'];
    setFleetSelection([f.id]);
    lastPanelHtml = ''; renderPanel();
  },
  fields: () => s.minefields,
  // SM-3.6: armed, the mine is an immobile unit — its own card, never an order target.
  mineCard: () => {
    apply(advance(s, Object.values(s.minefields.installations)[0].readyAt));
    const id = Object.keys(s.fleets).find((id) => isMineFleet(s.fleets[id], data));
    if (!id) return null;
    setFleetSelection([id]);
    lastPanelHtml = ''; renderPanel();
    return { card: lastPanelHtml.includes(t('mine.card.rule')), orderable: selectedFleetIds().length };
  }
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
      const [mineId] = await page.evaluate(() => window.__minesTest.rockets());
      assert.ok(mineId);
      await page.locator('[data-rm="mode"][data-mode="any"]').click();
      assert.equal(await page.evaluate((id) => window.__minesTest.mode(id), mineId), 'any');
      if (viewport.width > 600) {
        // The mine card in the side panel drives the same mine: mode, then disarm.
        await page.locator('#codex .cx-close').click();
        assert.deepEqual(await page.evaluate(() => window.__minesTest.rocketCard()), {
          card: true,
          orderable: 0,
        });
        await page.locator('[data-act="rmmode"][data-arg="confirmed"]').click();
        assert.equal(await page.evaluate((id) => window.__minesTest.mode(id), mineId), 'confirmed');
        await page.locator('[data-act="rmdisarm"]').click();
        assert.deepEqual(await page.evaluate(() => window.__minesTest.rockets()), []);
      } else {
        await page.locator('[data-rm="disarm"]').click();
        assert.deepEqual(await page.evaluate(() => window.__minesTest.rockets()), []);
        await page.locator('#codex .cx-close').click();
      }
      if (viewport.width > 600) {
        await page.evaluate(() => window.__minesTest.ordinary());
        await page.locator('[data-act="laymines"]').click();
        assert.equal(
          await page.evaluate(() => Object.keys(window.__minesTest.fields().installations).length),
          1,
        );
        assert.deepEqual(await page.evaluate(() => window.__minesTest.mineCard()), {
          card: true,
          orderable: 0,
        });
      }
    });
    console.log(`Mines UI ${viewport.width}px passed.`);
    await context.close();
  }
  console.log(
    'Mines UI smoke passed: desktop/mobile deployment, modes, disarm, rocket mine card, ordinary minelayer, mine card.',
  );
} finally {
  await browser.close();
  await host.close();
}
