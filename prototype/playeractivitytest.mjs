#!/usr/bin/env node
/* global document, Event */
// Real built desktop and phone clients: foreground pulses, hidden stop, channel identity,
// and an offline receiver must not break boot or play. All credentials are synthetic.
import assert from 'node:assert/strict';
import { builtPage, serve, launchBrowser, waitForApp } from './harnessKit.mjs';
const site = await serve({ '/': builtPage(), '/player': builtPage('void-dominion-player.html') });
const browser = await launchBrowser();
try {
  for (const phone of [false, true]) {
    const page = await browser.newPage({
      viewport: phone ? { width: 390, height: 844 } : { width: 1366, height: 768 },
      hasTouch: phone,
      isMobile: phone,
    });
    const errors = [],
      packets = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.route('**/auth/status', route => route.fulfill({ json: { enabled: true } }));
    await page.route('**/auth/login', route => route.fulfill({ json: { token: 'fixture-token' } }));
    await page.route('**/activity/pulse', async (route) => {
      packets.push({
        url: route.request().url(),
        auth: route.request().headers().authorization,
        body: route.request().postDataJSON(),
      });
      await route.fulfill({ status: 204 });
    });
    await page.goto(site.url + (phone ? '/player' : '/'));
    await waitForApp(page);
    assert.equal(packets.length, 0, 'anonymous boot is not a player');
    const base = site.url.replace('http:', 'ws:');
    const firstPulse = page.waitForResponse(
      (r) => r.url() === site.url + '/activity/pulse' && r.request().postDataJSON().active,
      // Login included, under CI load; still well short of the 30-second timer.
      { timeout: 15_000 },
    );
    await page.evaluate(({ base }) => {
      document.querySelector('#csrv').value = '  ' + base + '  ';
      document.querySelector('#cwnick').value = 'synthetic';
      document.querySelector('#cwpass').value = 'Fixture-password-1';
      document.querySelector('#cwgo').click();
    }, { base });
    await firstPulse;
    assert(packets.length >= 1, 'short first login sends a pulse before the 30-second timer');
    assert(
      packets.every(
        (p) => p.url === site.url + '/activity/pulse' && p.auth === 'Bearer fixture-token',
      ),
    );
    const channel = packets[0].body.channel;
    assert.match(channel, /^[a-f0-9]{32}$/);
    assert(packets.every((p) => p.body.channel === channel));
    const sectorEntry = page.waitForResponse(
      (r) => r.url() === site.url + '/activity/pulse' && r.request().postDataJSON().sectorZero === true,
      { timeout: 10_000 },
    );
    await page.locator('#hub-sector-zero').click();
    await sectorEntry;
    assert.equal(packets.filter((p) => p.body.sectorZero).length, 1);
    // A loaded CI runner can take over a second to deliver a pulse to the route, so the
    // visibility steps wait for the packet itself instead of a fixed pause.
    const lastPulse = async (active) => {
      const deadline = Date.now() + 10_000;
      while (packets.at(-1).body.active !== active && Date.now() < deadline)
        await new Promise((resolve) => setTimeout(resolve, 20));
      assert.equal(packets.at(-1).body.active, active);
    };
    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', {
        configurable: true,
        get: () => 'hidden',
      });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await lastPulse(false);
    const hidden = packets.length;
    await new Promise((resolve) => setTimeout(resolve, 400));
    assert.equal(packets.length, hidden);
    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', {
        configurable: true,
        get: () => 'visible',
      });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await lastPulse(true);
    assert.equal(packets.at(-1).body.sectorZero, undefined, 'heartbeat is not another campaign entry');
    await page.unroute('**/activity/pulse');
    await page.route('**/activity/pulse', (route) => route.abort('failed'));
    await new Promise((resolve) => setTimeout(resolve, 400));
    assert.deepEqual(errors, []);
    await page.close();
    console.log(
      `PASS ${phone ? 'phone player' : 'desktop alpha'}: immediate login and Sector Zero entry, padded address, foreground/background, stable channel, offline observation`,
    );
  }
} finally {
  await browser.close();
  await site.close();
}
