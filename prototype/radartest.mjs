#!/usr/bin/env node
/* global window -- browser harness hooks */
import assert from 'node:assert/strict';
import {
  enterSkirmish,
  instrumentedGame,
  launchBrowser,
  serve,
  withDiagnostics,
} from './harnessKit.mjs';

// Exercise the actual solo projection AND sweep painter in the shipped client.
const hooks = `window.__radarTest = {
  stage(level, grouped = false) {
    const nodes = Object.values(s.planets);
    const home = nodes.find(p => p.owner === ME);
    const [a, b] = nodes.filter(p => p.id !== home.id);
    for (const p of nodes) { p.owner = null; p.buildings = []; }
    home.owner = ME;
    home.buildings = [{ type: 'radar', level, hp: 18 }];
    a.position = { x: home.position.x + 230, y: home.position.y };
    b.position = { x: home.position.x + 250, y: home.position.y };
    s.sight = { world: 120, fleet: 40, radarScale: 1 };
    s.players[ME].faction = 'radar-test';
    s.players[ME].technologies = { completed: [] };
    delete s.players[ME].arrears;
    delete s.heroes; delete s.intel; delete s.diplomacy; delete s.mapShares;
    const foe = Object.keys(s.players).find(id => id !== ME);
    const make = (id, location, count) => ({ id, location, owner: foe, movement: null,
      units: [{ unit: 'scout', count }], traits: [] });
    s.fleets = { a: make('a', a.id, grouped ? 3 : 1) };
    if (grouped) s.fleets.b = make('b', b.id, 2);
    radarMemory.clear();
    this.paint();
    return this.read();
  },
  paint() {
    vision = computeVision();
    drawScanSweep(performance.now());
    // Targets are due east: one real sweep crossing, without a ten-second sleep.
    sweepPrevAng = TAU - 0.01; sweepAng = 0.01;
    updateRadarContacts(performance.now());
  },
  disperse() {
    const b = s.planets[s.fleets.b.location];
    b.position.x += 60;
    this.paint();
    drawRadarContacts(performance.now() + 2 * SWEEP_PERIOD);
    return this.read();
  },
  read() { return { contacts: vision.signatures, painted: [...radarMemory.values()] }; },
};`;

const site = await serve(await instrumentedGame(hooks));
const browser = await launchBrowser();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.setDefaultTimeout(15000);
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
try {
  await withDiagnostics(page, 'radartest', async () => {
    await page.goto(site.url + '/');
    await enterSkirmish(page);
    await page.locator('#maploading').waitFor({ state: 'hidden' });
    await page.locator('#spd-pause').click();

    const low = await page.evaluate(() => window.__radarTest.stage(1));
    assert.equal(low.contacts.length, 0);
    assert.equal(low.painted.length, 0);
    const group = await page.evaluate(() => window.__radarTest.stage(2, true));
    assert.deepEqual(
      group.contacts.map((c) => c.size),
      ['M'],
    );
    assert.deepEqual(
      group.painted.map((c) => c.size),
      ['M'],
    );
    const dispersed = await page.evaluate(() => window.__radarTest.disperse());
    assert.equal(dispersed.contacts.length, 0);
    assert.equal(dispersed.painted.length, 0);
    const sensitive = await page.evaluate(() => window.__radarTest.stage(3));
    assert.deepEqual(
      sensitive.contacts.map((c) => c.size),
      ['S'],
    );
    assert.deepEqual(
      sensitive.painted.map((c) => c.size),
      ['S'],
    );
    assert.deepEqual(errors, []);
    console.log('✓ radar: sensitivity, grouped signal, dispersion and sweep painting');
  });
} finally {
  await browser.close();
  await site.close();
}
