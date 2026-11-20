#!/usr/bin/env node
/* global window -- имя живёт внутри page.evaluate, то есть в браузере */
/**
 * Шпионы на карте (SPM-1, заказ владельца 2026-11-20), проверенные настоящим браузером на ПК и
 * телефоне: свой шпион в пути — корабль на лейне с пунктиром до цели, стоящие в мире — значок
 * «🕵 N» у его имени, тап по кораблю или значку открывает окно шпионажа.
 *
 * Кого и где рисовать, покрыто в `decisions/spyMarks.test.ts`, путь шпиона — в
 * `espionageWay.test.ts`. Здесь вопрос «игрок видит шпиона на карте и берёт его тапом».
 *
 *   node prototype/spymaptest.mjs                     # или pnpm run smoke:spy-map
 *   SPY_SHOTS=каталог node prototype/spymaptest.mjs    # плюс снимки
 */
import assert from 'node:assert/strict';
import {
  enterSkirmish,
  instrumentedGame,
  launchBrowser,
  serve,
  withDiagnostics,
} from './harnessKit.mjs';

const hooks = `import { mapWasEntered as __mapWasEntered } from './mapLoading';
import { spyOn as __spyOn } from '../../decisions/actions';
import { cancelSpy as __cancelSpy } from '../../decisions/actions';
import { spyPath as __spyPath } from '../../packages/shared-core/src/index';
import { HOUR as __HOUR } from './time';
window.__spyMapTest = {
  prepared: () => inMatch() && __mapWasEntered && !mapPreparation.active,
  // Шпион 1 летит к миру за три перехода, шпион 2 ждёт приказа у соседа, шпион 3 дома.
  // Часы стоят на 40% пути шпиона 1, камера между ним и целью.
  prepare: () => {
    speed = 0;
    const home = s.capital?.[ME] ?? Object.values(s.planets).find((p) => p.owner === ME).id;
    const far = Object.keys(s.planets)
      .sort()
      .find((id) => (__spyPath(s, ME, home, id)?.route.length ?? 0) === 3);
    const near = s.planets[home].links[0];
    playerOrder(__spyOn(ME, far, 'relocate', 1));
    s = structuredClone(s);
    const spy1 = s.spies[ME].find((x) => x.id === 1);
    s.time = spy1.departedAt + 0.4 * (spy1.arrivesAt - spy1.departedAt);
    const spy2 = s.spies[ME].find((x) => x.id === 2);
    Object.assign(spy2, { state: 'wait', location: near });
    clearSelection();
    invalidatePanel();
    renderPanel();
    const a = s.planets[home].position;
    const b = s.planets[far].position;
    centerOn({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, Math.max(cam.scale, 1.6));
    return { home, far, near, hits: __spyMarkHits().length };
  },
  hits: () => {
    const r = canvas.getBoundingClientRect();
    return __spyMarkHits().map((h) => ({ kind: h.kind, x: r.left + h.x, y: r.top + h.y, ids: [...h.spyIds] }));
  },
  // --- живой прогон: часы идут, шпионы летят по-настоящему ---
  liveStart: () => {
    speed = 0;
    const home = s.capital?.[ME] ?? Object.values(s.planets).find((p) => p.owner === ME).id;
    const far = Object.keys(s.planets)
      .sort()
      .find((id) => (__spyPath(s, ME, home, id)?.route.length ?? 0) === 3);
    const near = s.planets[home].links.find((id) => s.planets[id].owner === null) ?? s.planets[home].links[0];
    clearSelection();
    const a = s.planets[home].position;
    const b = s.planets[far].position;
    centerOn({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, Math.max(cam.scale, 1.2));
    return { home, far, near, route: __spyPath(s, ME, home, far).route };
  },
  send: (id, target, op) => playerOrder(__spyOn(ME, target, op, id)),
  cancel: (id) => playerOrder(__cancelSpy(ME, id)),
  // Часы: сколько игровых часов идёт за секунду.
  go: (hoursPerSecond) => {
    speed = hoursPerSecond;
  },
  hoursLeft: (id) => {
    const x = s.spies[ME].find((q) => q.id === id);
    return x?.arrivesAt === undefined ? 0 : (x.arrivesAt - s.time) / __HOUR;
  },
  spy: (id) => {
    const x = s.spies[ME].find((q) => q.id === id);
    return { state: x.state, location: x.location, way: (x.way ?? []).map((p) => p.at) };
  },
  // Корабль шпиона в кадре: точка холста; null — не нарисован.
  ship: (id) => {
    const h = __spyMarkHits().find((q) => q.kind === 'flight' && q.spyIds[0] === id);
    return h ? { x: h.x, y: h.y } : null;
  },
  spot: (planetId) => {
    const c = world(s.planets[planetId].position);
    const near = __spyMarkHits().filter((q) => q.kind === 'spot' && Math.abs(q.y - (c.y - 5)) < 2 && q.x > c.x);
    return near.length ? [...near[0].spyIds] : null;
  },
  at: (planetId) => {
    const c = world(s.planets[planetId].position);
    return { x: c.x, y: c.y };
  },
  flashes: () => __spyFlashKinds(),
  // Шпион чужого игрока в пути: на моей карте его быть не должно.
  foreign: () => {
    const other = Object.keys(s.players).find((id) => id !== ME);
    const home = s.capital?.[other] ?? Object.keys(s.planets)[0];
    const to = s.planets[home].links[0];
    s = structuredClone(s);
    (s.spies ??= {})[other] = [
      { id: 1, gen: 1, state: 'travel', location: to, from: home, departedAt: s.time, arrivesAt: s.time + __HOUR, op: 'relocate', mission: 1 },
    ];
    return __spyMarkHits().length;
  },
  hitCount: () => __spyMarkHits().length,
};
import { spyHits as __spyMarkHits, spyFlashKinds as __spyFlashKinds } from './mapSpies';`;

const shots = process.env.SPY_SHOTS;

/** Механика в живую: часы идут, шпион летит по дорогам к цели и приходит; отозванный с
 *  полпути разворачивается и идёт домой; ничейный мир разведывается; чужого шпиона не видно. */
async function live() {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    locale: 'ru-RU',
    deviceScaleFactor: shots ? 2 : 1,
  });
  const page = await context.newPage();
  page.setDefaultTimeout(20000);
  const ev = (fn, arg) => page.evaluate(fn, arg);
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  await withDiagnostics(page, 'spy-map-live', async () => {
    await page.goto(site.url + '/');
    await enterSkirmish(page, { tap: false });
    await page.waitForFunction(() => window.__spyMapTest.prepared());
    const ids = await ev(() => window.__spyMapTest.liveStart());

    // 1. Шпион 1 летит к миру за три перехода — по тем самым дорогам и к цели.
    assert.equal(
      await ev((a) => window.__spyMapTest.send(1, a.far, 'relocate'), ids),
      true,
      'приказ принят',
    );
    const sent = await ev(() => window.__spyMapTest.spy(1));
    assert.equal(sent.state, 'travel');
    assert.deepEqual(sent.way, [ids.home, ...ids.route], 'путь шпиона — маршрут по дорогам');
    const journey = await ev(() => window.__spyMapTest.hoursLeft(1));
    assert.ok(journey > 0, 'путь занимает время');
    const target = await ev((a) => window.__spyMapTest.at(a.far), ids);
    await ev((v) => window.__spyMapTest.go(v), journey / 6); // весь путь — около 6 секунд
    let last = Infinity;
    let samples = 0;
    for (let i = 0; i < 40; i++) {
      await page.waitForTimeout(250);
      const st = await ev(() => window.__spyMapTest.spy(1));
      if (st.state !== 'travel') break;
      const ship = await ev(() => window.__spyMapTest.ship(1));
      if (!ship) continue;
      const d = dist(ship, target);
      assert.ok(d <= last + 2, `корабль не пятится: ${d.toFixed(1)} после ${last.toFixed(1)}`);
      last = d;
      samples++;
      if (samples === 3 && shots) await page.screenshot({ path: `${shots}/live-1-v-puti.png` });
    }
    assert.ok(samples >= 3, `корабль виден в пути (${samples} кадров)`);
    await page.waitForFunction(() => window.__spyMapTest.spy(1).state === 'wait');
    const arrived = await ev(() => window.__spyMapTest.spy(1));
    assert.equal(arrived.location, ids.far, 'шпион прибыл к цели');
    assert.deepEqual(arrived.way, [], 'путь снят по прибытии');
    await page.waitForTimeout(100);
    assert.equal(await ev(() => window.__spyMapTest.ship(1)), null, 'прибывший шпион — не корабль');
    assert.deepEqual(await ev((a) => window.__spyMapTest.spot(a.far), ids), [1], '«🕵 1» у цели');

    // 2. Шпион 2 отозван с полпути: разворачивается и идёт домой по тем же дорогам.
    await ev(() => window.__spyMapTest.go(0));
    assert.equal(await ev((a) => window.__spyMapTest.send(2, a.far, 'relocate'), ids), true);
    await ev((v) => window.__spyMapTest.go(v), journey / 6);
    await page.waitForFunction((h) => window.__spyMapTest.hoursLeft(2) < h / 2, journey);
    await ev(() => window.__spyMapTest.go(0));
    await page.waitForTimeout(100);
    const turn = await ev(() => window.__spyMapTest.ship(2));
    assert.equal(await ev(() => window.__spyMapTest.cancel(2)), true, 'отзыв принят');
    const back = await ev(() => window.__spyMapTest.spy(2));
    assert.equal(back.state, 'return');
    assert.equal(back.way.at(-1), ids.home, 'обратный путь кончается дома');
    await page.waitForTimeout(100);
    const turned = await ev(() => window.__spyMapTest.ship(2));
    assert.ok(turn && turned && dist(turn, turned) < 3, 'разворот — с той же точки, без прыжка');
    if (shots) await page.screenshot({ path: `${shots}/live-2-razvorot.png` });
    const homeAt = await ev((a) => window.__spyMapTest.at(a.home), ids);
    await ev((v) => window.__spyMapTest.go(v), journey / 6);
    let lastHome = Infinity;
    for (let i = 0; i < 40; i++) {
      await page.waitForTimeout(250);
      if ((await ev(() => window.__spyMapTest.spy(2))).state !== 'return') break;
      const ship = await ev(() => window.__spyMapTest.ship(2));
      if (!ship) continue;
      const d = dist(ship, homeAt);
      assert.ok(
        d <= lastHome + 2,
        `обратно — только к дому: ${d.toFixed(1)} после ${lastHome.toFixed(1)}`,
      );
      lastHome = d;
    }
    await page.waitForFunction(() => window.__spyMapTest.spy(2).state === 'rest');
    await page.waitForTimeout(100);
    assert.deepEqual(await ev((a) => window.__spyMapTest.spot(a.home), ids), [2, 3], 'дома «🕵 2»');

    // 3. Разведка ничейного мира: прибытие вспыхивает, шпион на посту — значок у мира.
    await ev(() => window.__spyMapTest.go(0));
    assert.equal(await ev((a) => window.__spyMapTest.send(3, a.near, 'recon'), ids), true);
    const reconTrip = await ev(() => window.__spyMapTest.hoursLeft(3));
    await ev((v) => window.__spyMapTest.go(v), Math.max(reconTrip, 0.1) / 2);
    await page.waitForFunction(() => window.__spyMapTest.spy(3).state === 'work');
    assert.ok((await ev(() => window.__spyMapTest.flashes())).length > 0, 'прибытие вспыхнуло');
    await ev(() => window.__spyMapTest.go(0));
    await page.waitForTimeout(100);
    assert.deepEqual(
      await ev((a) => window.__spyMapTest.spot(a.near), ids),
      [3],
      '«🕵 1» у разведанного мира',
    );

    // 4. Чужой шпион в пути не рисуется на моей карте.
    const before = await ev(() => window.__spyMapTest.hitCount());
    await ev(() => window.__spyMapTest.foreign());
    await page.waitForTimeout(150);
    assert.equal(await ev(() => window.__spyMapTest.hitCount()), before, 'чужого шпиона не видно');
  });
  await context.close();
}
const site = await serve(await instrumentedGame(hooks));
const browser = await launchBrowser();
try {
  for (const viewport of [
    { width: 1280, height: 800 },
    { width: 390, height: 844 },
  ]) {
    const phone = viewport.width < 600;
    const tag = phone ? 'phone' : 'pc';
    const context = await browser.newContext({
      viewport,
      isMobile: phone,
      hasTouch: phone,
      deviceScaleFactor: shots ? 2 : 1,
      locale: 'ru-RU',
    });
    const page = await context.newPage();
    page.setDefaultTimeout(15000);
    const tapAt = (p) => (phone ? page.touchscreen.tap(p.x, p.y) : page.mouse.click(p.x, p.y));
    const frame = () =>
      page.evaluate(
        () =>
          new Promise((resolve) =>
            window.requestAnimationFrame(() => window.requestAnimationFrame(resolve)),
          ),
      );
    const shot = async (name) => {
      if (!shots) return;
      await frame();
      await page.waitForTimeout(250);
      await page.screenshot({ path: `${shots}/${tag}-${name}.png` });
    };
    await withDiagnostics(page, `spy-map-${tag}`, async () => {
      await page.goto(site.url + '/');
      await enterSkirmish(page, { tap: phone });
      await page.waitForFunction(() => window.__spyMapTest.prepared());
      await page.evaluate(() => window.__spyMapTest.prepare());
      await page.waitForFunction(() => window.__spyMapTest.hits().length > 0);
      await frame();
      const hits = await page.evaluate(() => window.__spyMapTest.hits());
      const flight = hits.find((h) => h.ids.length === 1 && h.ids[0] === 1);
      assert.ok(flight, 'шпион 1 в пути — корабль на карте');
      await shot('1-v-puti');
      await tapAt(flight);
      await frame();
      assert.ok(
        await page.locator('#spywin').isVisible(),
        'тап по кораблю открывает окно шпионажа',
      );
      await shot('2-okno');
    });
    await context.close();
  }
  await live();
  console.log('spy map OK');
} finally {
  await browser.close();
  await site.close();
}
