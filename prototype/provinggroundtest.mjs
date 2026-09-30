#!/usr/bin/env node
/* global window -- browser-side test hooks */
// Полигон основной игры (M2.15): дверь в хабе открывает карту со всеми областями,
// старт — песочница, имена областей проступают при отдалении и гаснут вблизи.
import assert from 'node:assert/strict';
import { instrumentedGame, launchBrowser, serve, waitForApp, withDiagnostics } from './harnessKit.mjs';

// Test-only access to the actual host. No debug exports enter the player build.
const hooks = `window.__pgTest = {
  facts: () => {
    const capital = Object.values(s.planets).find((p) => p.owner === ME && p.kind === 'planet');
    return {
      mapId: s.mapId,
      inMatch: inMatch(),
      techs: (s.players[ME]?.technologies?.completed ?? []).length === Object.keys(data.technologies).length,
      hangar: (capital?.hangar ?? []).length > 0,
      rivals: [...AI_PLAYERS.keys()].sort(),
    };
  },
  labels: () => ({
    count: regionLabels(s.mapId, mapRegions(s.mapId), (id) => s.planets[id]?.position).length,
    alpha: regionLabelAlpha(currentMapLod().provinceDetail),
  }),
  zoomOut: () => {
    cam.scale = 1; // вся карта на экране — как вид по умолчанию на простом ПК
    cam.x = 0;
    cam.y = 0;
    clampCam();
  },
  zoomIn: () => {
    const capital = Object.values(s.planets).find((p) => p.owner === ME && p.kind === 'planet');
    centerOn(capital.position, 4);
  },
};`;

const host = await serve(await instrumentedGame(hooks));
const browser = await launchBrowser();
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  await withDiagnostics(page, 'proving-ground', async () => {
    await page.goto(host.url);
    await waitForApp(page);
    await page.locator('#cnew').click();
    await page.locator('#hub-proving-ground').click();
    await page.waitForFunction(() => window.__pgTest.facts().inMatch);
    assert.deepEqual(await page.evaluate(() => window.__pgTest.facts()), {
      mapId: 'proving-ground',
      inMatch: true,
      techs: true,
      hangar: true,
      rivals: ['p2', 'p3'],
    });
    // Вся карта на экране: провинции растворены — видны имена шести областей.
    await page.evaluate(() => window.__pgTest.zoomOut());
    assert.deepEqual(await page.evaluate(() => window.__pgTest.labels()), { count: 6, alpha: 1 });
    // Вблизи читаются провинции — имена областей гаснут.
    await page.evaluate(() => window.__pgTest.zoomIn());
    assert.equal((await page.evaluate(() => window.__pgTest.labels())).alpha, 0);
  });
  console.log('Proving ground smoke passed: hub door, sandbox start, region names by zoom.');
  await context.close();
} finally {
  await browser.close();
  await host.close();
}
