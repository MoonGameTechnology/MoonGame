#!/usr/bin/env node
/* global window, document, localStorage, innerWidth -- callbacks execute in Playwright's page. */
/** Real touch regression for the phone selection → preview → send loop.
 * Uses the pinned Playwright dependency and a test-only read-only state bridge.
 * Run after `pnpm run prototype`: node prototype/mobiletest.mjs
 */
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { builtPage, enterSkirmish, instrumentedGame, launchBrowser, serve } from './harnessKit.mjs';
import { checkMobileStrategy } from './mobileStrategyTest.mjs';

const hooks = `window.__mobileTest = {
  state: () => s,
  camera: () => ({...cam}),
  ui: () => ({ mobile: MOBILE, me: ME, ids: selectedFleetIds(), planet: selPlanet, choices: mobileChoices, draft: mobileDraft, aiming, assaultAim, engageAim, merging, pickMode }),
  fleets: () => Object.values(s.fleets).map(f => ({ id:f.id, owner:f.owner, p:fleetAnchor(f) })),
  worlds: () => MAP.map(n => ({ id:n.id, p:world(n), known:known(n.id) })),
  destinations: id => MAP.filter(n => n.id !== s.fleets[id].location && canOrder(s,moveFleet(ME,id,n.id)) === null).map(n => ({ id:n.id, p:world(n) }))
};`;
// Корень — игра с хуками; `/built` и `/player` — сборки как есть, без инструментовки.
const site = await serve({
  ...(await instrumentedGame(hooks)),
  '/built': builtPage(),
  '/player': builtPage('void-dominion-player.html'),
});
const server = site.server;
const browser = await launchBrowser();
const p = await browser.newPage({
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
  deviceScaleFactor: 2,
});
p.setDefaultTimeout(7000);
const errors = [];
p.on('pageerror', (e) => errors.push(e.message));
const pause = () => p.waitForTimeout(100);
const ui = () => p.evaluate(() => window.__mobileTest.ui());
const snapshot = () => p.evaluate(() => JSON.stringify(window.__mobileTest.state()));
const cdp = await p.context().newCDPSession(p);
async function drag(x, y, dx, dy) {
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x, y, id: 1 }],
  });
  for (let i = 1; i <= 6; i++)
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x: x + (dx * i) / 6, y: y + (dy * i) / 6, id: 1 }],
    });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await pause();
}
async function chooseFleet(f) {
  await p.touchscreen.tap(f.p.x, f.p.y);
  await pause();
  let choices = (await ui()).choices;
  const provinceIndex = choices.findIndex((x) => x.kind === 'planet');
  assert(
    provinceIndex >= 0 && choices.some((x) => x.kind === 'fleet'),
    'stack picker offers the fleet and its province',
  );
  await p.locator(`[data-mobile="choose"][data-index="${provinceIndex}"]`).tap();
  await pause();
  assert.equal((await ui()).planet, choices[provinceIndex].id);
  await p.locator('[data-mobile="close"]').tap();
  await pause();
  const current = (await p.evaluate(() => window.__mobileTest.fleets())).find((x) => x.id === f.id);
  await p.touchscreen.tap(current.p.x, current.p.y);
  await pause();
  choices = (await ui()).choices;
  if (choices.length)
    await p
      .locator(
        `[data-mobile="choose"][data-index="${choices.findIndex((c) => c.kind === 'fleet' && c.id === f.id)}"]`,
      )
      .tap();
  await pause();
  assert.deepEqual((await ui()).ids, [f.id]);
}
async function pinch() {
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [
      { x: 110, y: 310, id: 1 },
      { x: 230, y: 410, id: 2 },
    ],
  });
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchMove',
    touchPoints: [
      { x: 80, y: 280, id: 1 },
      { x: 255, y: 435, id: 2 },
    ],
  });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await pause();
}
try {
  await checkMobileStrategy(browser, `http://127.0.0.1:${server.address().port}`);
  await p.addInitScript(() => localStorage.setItem('vd.locale', 'ru'));
  await p.goto(`http://127.0.0.1:${server.address().port}`);
  await enterSkirmish(p, { tap: true });
  await p.locator('#spd-pause').tap();
  await pause();
  assert((await ui()).mobile);
  assert.equal(await p.locator('#purse .res').count(), 5);
  await p.screenshot({ path: 'prototype/dist/mobile-overview.png' });
  const base = await snapshot();
  const me = (await ui()).me;
  const f = (await p.evaluate(() => window.__mobileTest.fleets())).find(
    (f) => f.owner === me && f.p && f.p.x > 40 && f.p.x < 350 && f.p.y > 160 && f.p.y < 620,
  );
  assert(f, 'a starting fleet is visible');
  await chooseFleet(f);
  const sheet = p.locator('#mobile-sheet');
  assert(await sheet.isVisible());
  assert.equal(await sheet.locator('#cmdbar').count(), 1);
  assert.equal(await p.locator('#cmdbar').count(), 1);
  assert(!(await sheet.locator('#side').isVisible()));
  assert((await sheet.boundingBox()).height < 280, 'compact card leaves most of the map visible');
  await p.screenshot({ path: 'prototype/dist/mobile-fleet.png' });
  await sheet.locator('.mobile-quick [data-mobile="details"]').tap();
  assert(await sheet.locator('#side').isVisible());
  await sheet.locator('[data-mobile="summary"]').tap();
  // Сводка встаёт РЯДОМ с карточкой (`objectPanelHtml`), а назад из неё ведёт своя
  // кнопка `summaryback`, а не повторный `fleetinfo` — так устроено с тех пор, как сводка
  // перестала подменять карточку (BRWH-2: харнес ждал старую форму).
  await sheet.locator('.object-detail').waitFor({ state: 'attached' });
  const back = sheet.locator('[data-act="summaryback"]');
  await back.scrollIntoViewIfNeeded();
  assert(await back.isVisible(), 'full statistics retain their return action');
  await p.screenshot({ path: 'prototype/dist/mobile-summary.png' });
  await p.keyboard.press('Escape');
  await pause();
  assert(!(await sheet.locator('#side').isVisible()));
  assert.deepEqual((await ui()).ids, [f.id]);
  assert.equal(await snapshot(), base);
  console.log('PASS phone selection, one compact card, details and Back');

  await sheet.locator('[data-cmd="move"]').tap();
  await pause();
  assert((await ui()).aiming);
  assert(await sheet.locator('[data-cmd="mobile-send"]').isDisabled());
  const camera = await p.evaluate(() => window.__mobileTest.camera());
  await drag(160, 360, 45, 55);
  assert.notDeepEqual(await p.evaluate(() => window.__mobileTest.camera()), camera);
  assert.equal((await ui()).draft, null);
  assert.equal(await snapshot(), base);
  const destination = (await p.evaluate((id) => window.__mobileTest.destinations(id), f.id)).find(
    (n) => n.p.x > 30 && n.p.x < 360 && n.p.y > 160 && n.p.y < 560,
  );
  assert(destination, 'a reachable destination is visible');
  await p.touchscreen.tap(destination.p.x, destination.p.y);
  await pause();
  assert.equal((await ui()).draft.target.id, destination.id);
  assert.equal(await snapshot(), base, 'target tap does not send an order');
  await p.screenshot({ path: 'prototype/dist/mobile-order.png' });
  await drag(150, 330, -35, 50);
  assert.equal((await ui()).draft.target.id, destination.id, 'pan preserves the target address');
  assert.equal(await snapshot(), base);
  const prePinch = await p.evaluate(() => window.__mobileTest.camera());
  await pinch();
  assert.notEqual((await p.evaluate(() => window.__mobileTest.camera())).scale, prePinch.scale);
  assert.equal((await ui()).draft.target.id, destination.id, 'pinch preserves the target address');
  assert.equal(await snapshot(), base, 'pinch release does not send');
  await sheet.locator('[data-cmd="mobile-cancel"]').tap();
  await pause();
  assert.equal((await ui()).draft, null);
  assert(!(await ui()).aiming);
  assert.equal(await snapshot(), base);
  console.log('PASS one-finger pan, target preview, stable address and cancel');

  await sheet.locator('[data-cmd="move"]').tap();
  await pause();
  const current = (await p.evaluate(() => window.__mobileTest.worlds())).find(
    (n) => n.id === destination.id,
  );
  await p.touchscreen.tap(current.p.x, current.p.y);
  await pause();
  await sheet.locator('[data-cmd="mobile-send"]').tap();
  await pause();
  const ordered = await p.evaluate((id) => window.__mobileTest.state().fleets[id], f.id);
  assert(ordered.movement || ordered.route?.length, 'Send reaches the real game action');
  assert.equal((await ui()).draft, null);
  if (await p.locator('#intro.show').isVisible()) await p.locator('#intro .in-ok').tap();
  await sheet.locator('[data-cmd="stop"]').tap();
  await pause();
  assert.equal(
    (await p.evaluate((id) => window.__mobileTest.state().fleets[id], f.id)).movement,
    null,
  );
  console.log('PASS confirmed Course and Stop reach the reducer');

  const stopped = await snapshot();
  // Прицел, взведённый при раскрытом «Ещё». После ATK-1 «Атака» — это `engage` (цель —
  // флот); `attack` стал ШТУРМОМ и по `cmdPresence` есть только у флота с десантом,
  // которого у стартового флота нет (BRWH-2: харнес ждал старую кнопку).
  await sheet.locator('[data-cmd="more"]').tap();
  await sheet.locator('[data-cmd="engage"]').tap();
  await pause();
  assert((await ui()).engageAim);
  await p.keyboard.press('Escape');
  await pause();
  assert(!(await ui()).engageAim, 'Back cancels targeting entered through More in one step');
  assert.equal(await snapshot(), stopped);
  await sheet.locator('[data-cmd="more"]').tap();
  await sheet.locator('[data-cmd="pick"]').tap();
  await pause();
  assert((await ui()).pickMode);
  const picked = (await p.evaluate(() => window.__mobileTest.fleets())).find((x) => x.id === f.id);
  await p.touchscreen.tap(picked.p.x, picked.p.y);
  await pause();
  assert.deepEqual((await ui()).ids, []);
  assert(await sheet.locator('[data-cmd="pick"]').isVisible(), 'empty group retains Done');
  await sheet.locator('[data-cmd="pick"]').tap();
  await pause();
  assert(!(await ui()).pickMode);
  assert(!(await sheet.isVisible()));
  assert.equal(await snapshot(), stopped);
  const unknown = (await p.evaluate(() => window.__mobileTest.worlds())).find(
    (n) => !n.known && n.p.x > 35 && n.p.x < 350 && n.p.y > 160 && n.p.y < 600,
  );
  assert(unknown);
  await p.touchscreen.tap(unknown.p.x, unknown.p.y);
  await pause();
  assert.equal((await ui()).planet, unknown.id);
  await sheet.locator('[data-mobile="ping"]').tap();
  assert(await p.locator('#pingmenu.show').isVisible());
  assert((await p.locator('#pingmenu').textContent()).includes(unknown.id));
  await p.keyboard.press('Escape');
  await pause();
  assert.equal(await snapshot(), stopped);
  console.log('PASS visible grouping, empty-group exit, object chooser and unknown province Ping');

  await p.setViewportSize({ width: 844, height: 390 });
  await pause();
  assert((await ui()).mobile);
  const landscape = await sheet.boundingBox();
  assert(
    landscape.x >= 0 &&
      landscape.x + landscape.width <= 844 &&
      landscape.y >= 0 &&
      landscape.y + landscape.height <= 390,
  );
  const landmark = (await p.evaluate(() => window.__mobileTest.worlds())).find(
    (n) => n.id === unknown.id,
  );
  assert(
    landmark.p.x > 0 && landmark.p.x < landscape.x && landmark.p.y > 85 && landmark.p.y < 390,
    'orientation keeps the selected object in the visible map',
  );
  await p.screenshot({ path: 'prototype/dist/mobile-landscape.png' });
  await p.setViewportSize({ width: 320, height: 740 });
  await pause();
  const narrow = await sheet.boundingBox();
  assert(narrow.x >= 0 && narrow.x + narrow.width <= 320);
  assert.equal(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await p.setViewportSize({ width: 1200, height: 800 });
  await pause();
  assert(!(await ui()).mobile);
  assert.equal(await p.locator('#holo-selection-window #side').count(), 1);
  await p.setViewportSize({ width: 390, height: 844 });
  await pause();
  assert.equal(await sheet.locator('#side').count(), 1);
  assert.equal(await p.locator('#side').count(), 1);

  // ШТУРМ через «Ещё» (BRWH-4). Кнопка `attack` есть только у флота с десантом
  // (`cmdPresence`), поэтому сперва десант грузится НАСТОЯЩИМ путём игрока: ⇅ → максимум
  // → OK. Погрузка ложится в часовую очередь, так что часы идут до посадки — на ▶▶ ×100
  // это ~12 с. Свежая партия: снимки состояния шагов выше этим не задеты.
  await p.goto(`http://127.0.0.1:${server.address().port}`);
  await enterSkirmish(p, { tap: true });
  await p.locator('#spd-pause').tap();
  await pause();
  const trooper = (await p.evaluate(() => window.__mobileTest.fleets())).find(
    (x) => x.owner === me,
  );
  const selectTrooper = async () => {
    const at = (await p.evaluate(() => window.__mobileTest.fleets())).find(
      (x) => x.id === trooper.id,
    );
    await p.touchscreen.tap(at.p.x, at.p.y);
    await pause();
    const choices = (await ui()).choices;
    const index = choices.findIndex((c) => c.kind === 'fleet' && c.id === trooper.id);
    if (index >= 0) await p.locator(`[data-mobile="choose"][data-index="${index}"]`).tap();
    await pause();
    assert.deepEqual((await ui()).ids, [trooper.id]);
  };
  await selectTrooper();
  assert.equal(await sheet.locator('[data-cmd="attack"]').count(), 0, 'no troops, no assault');
  await sheet.locator('[data-cmd="more"]').tap();
  await sheet.locator('[data-cmd="troops"]').tap();
  for (const unit of await p
    .locator('[data-cmd="tmax"][data-dir="1"]')
    .evaluateAll((els) => els.map((e) => e.dataset.unit)))
    await p.locator(`[data-cmd="tmax"][data-dir="1"][data-unit="${unit}"]`).tap();
  await p.locator('[data-cmd="tok"]').tap();
  // Панель скорости на телефоне прячется под открытой карточкой.
  await p.locator('[data-mobile="close"]').tap();
  await pause();
  await p.locator('#spd-fast').tap();
  await p.locator('.spd-mult-legacy [data-mult="100"]').tap();
  await p.waitForFunction(
    (id) => (window.__mobileTest.state().fleets[id].landing ?? []).length > 0,
    trooper.id,
    { timeout: 60000, polling: 250 },
  );
  await p.locator('#spd-pause').tap();
  await pause();
  await selectTrooper();
  const loaded = await snapshot();
  if (!(await sheet.locator('[data-cmd="attack"]').isVisible()))
    await sheet.locator('[data-cmd="more"]').tap();
  await sheet.locator('[data-cmd="attack"]').tap();
  await pause();
  assert((await ui()).assaultAim, 'assault aim is armed');
  await p.keyboard.press('Escape');
  await pause();
  assert(!(await ui()).assaultAim, 'Back cancels assault targeting in one step');
  assert.equal(await snapshot(), loaded, 'arming and cancelling the assault sends nothing');
  console.log('PASS troops load through the real popover, assault via More and one-step Back');

  for (const route of ['/built', '/player']) {
    await p.goto(`http://127.0.0.1:${server.address().port}${route}`);
    await enterSkirmish(p, { tap: true });
    assert(await p.locator('body.mobile-ui').count());
    assert.equal(await p.locator('#purse .res').count(), 5);
  }
  const desktop = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  desktop.on('pageerror', (e) => errors.push(e.message));
  await desktop.goto(`http://127.0.0.1:${server.address().port}`);
  await enterSkirmish(desktop);
  const mine = (await desktop.evaluate(() => window.__mobileTest.fleets())).find(
    (x) => x.owner === 'p1',
  );
  await desktop.mouse.click(mine.p.x, mine.p.y);
  await desktop.locator('#cmdbar [data-cmd="move"]').click();
  const target = await desktop.evaluate(
    (id) =>
      window.__mobileTest
        .destinations(id)
        .find((n) => document.elementFromPoint(n.p.x, n.p.y)?.tagName === 'CANVAS'),
    mine.id,
  );
  assert(target, 'desktop has an unobstructed destination');
  await desktop.mouse.click(target.p.x, target.p.y);
  assert(
    (await desktop.evaluate((id) => window.__mobileTest.state().fleets[id], mine.id)).movement,
    'desktop Course still dispatches on click',
  );
  await desktop.close();
  assert.deepEqual(errors, []);
  console.log(
    'PASS narrow portrait, landscape, layout restoration, built dev/player, desktop Course and no browser errors',
  );
} catch (error) {
  await p.screenshot({ path: 'prototype/dist/mobile-failure.png' });
  writeFileSync(
    'prototype/dist/mobile-failure.json',
    JSON.stringify({ errors, ui: await ui().catch(() => null) }, null, 2),
  );
  throw error;
} finally {
  await browser.close();
  await site.close();
}
