#!/usr/bin/env node
/* global window, document -- эти имена живут внутри page.evaluate, то есть в браузере */
/**
 * SHU-6.3 — патруль шаттлов в ИНТЕРФЕЙСЕ, проверенный настоящим браузером.
 *
 * Правила патруля покрыты в ядре (`shuttlePatrol.test.ts`), метки — в
 * `decisions/patrolMarks.test.ts`. Здесь вопрос другой — «игрок может поставить и снять
 * патруль»: кнопка у эскадры, тап по точке карты кладёт в состояние патруль, панель базы
 * показывает его остаток и «Вернуть», и «Вернуть» разворачивает эскадру домой.
 *
 * Базы обе (резолюция владельца 2026-10-04, §0.7): мир с портом и корабль, у которого
 * эскадры в трюме. Экраны обе: ПК и телефон — у пальца нет наведения, и прицел обязан
 * работать без него.
 *
 *   node prototype/patroltest.mjs      # или pnpm run smoke:patrol
 *   PATROL_SHOTS=каталог node prototype/patroltest.mjs   # плюс снимки висящего патруля
 */
import assert from 'node:assert/strict';
import {
  enterSkirmish,
  instrumentedGame,
  launchBrowser,
  serve,
  withDiagnostics,
} from './harnessKit.mjs';

const hooks = `window.__patrolTest = {
  prepared: () => inMatch() && mapWasEntered && !mapPreparation.active,
  // База — свой мир с целым портом или свой «Носитель» у него; в ангаре два перехватчика.
  // База выбрана и стоит в центре экрана. Ждать постройки на живой карте значило бы
  // проверять экономику, а не кнопку.
  prepare: (kind) => {
    speed = 0;
    s = structuredClone(s);
    const deck = [{ id: 'sq:' + ME + ':' + kind, units: [{ unit: 'interceptor', count: 2 }] }];
    const home = Object.values(s.planets).find((p) => p.owner === ME);
    let id = home.id;
    if (kind === 'port') {
      home.buildings = home.buildings.filter((b) => b.type !== 'spaceport');
      home.buildings.push({ type: 'spaceport', level: 1, hp: hpOfLevel('spaceport', 1) });
      home.hangar = deck;
      delete home.sortie;
      pickWorld(home.id);
      planetTab = 'shuttle';
    } else {
      const f = Object.values(s.fleets).find((x) => x.owner === ME && x.location);
      f.units = [{ unit: 'shuttle_carrier', count: 1 }];
      f.hangar = deck;
      delete f.sortie;
      f.location = home.id;
      f.movement = null;
      f.battleId = null;
      id = f.id;
      setFleetSelection([f.id]);
    }
    lastPanelHtml = '';
    renderPanel();
    // Центруем ПОСЛЕ панели: открытая панель сужает поле карты, и центр считается от него.
    centerOn(home.position, cam.scale);
    return id;
  },
  armed: () => strikeAim,
  // Где база сейчас: у мира — его точка, у корабля — живая позиция флота.
  base: () => (selFleet ? fleetPos(s.fleets[selFleet]) : s.planets[selPlanet].position),
  // Точка страницы в dx мировых единиц восточнее базы: внутри круга удара перехватчика.
  near: (dx) => {
    const p = window.__patrolTest.base();
    return toScreen(world({ x: p.x + dx, y: p.y }), canvas.getBoundingClientRect(), VW, VH);
  },
  patrols: () =>
    (s.strikes ?? [])
      .filter((st) => st.target.kind === 'point')
      .map((st) => ({ id: st.id, leg: st.leg, to: st.to, base: st.base })),
  // Мир доходит до точки: патруль повисает, у круга появляется отсчёт.
  arrive: () => {
    const st = s.strikes.find((x) => x.target.kind === 'point');
    apply(advance(s, st.arrivesAt));
    lastPanelHtml = '';
    renderPanel();
  },
  marks: () => patrolMarks(s.strikes, { me: ME, now: s.time }),
};`;

const site = await serve(await instrumentedGame(hooks));
const browser = await launchBrowser();
try {
  for (const viewport of [
    { width: 1280, height: 800 },
    { width: 390, height: 844 },
  ]) {
    for (const kind of ['port', 'hold']) {
      const phone = viewport.width < 600;
      const context = await browser.newContext({ viewport, isMobile: phone, hasTouch: phone });
      const page = await context.newPage();
      page.setDefaultTimeout(15000);
      const press = (locator) => (phone ? locator.tap() : locator.click());
      await withDiagnostics(page, `patrol-${kind}-${viewport.width}`, async () => {
        await page.goto(site.url + '/');
        await enterSkirmish(page, { tap: phone });
        await page.waitForFunction(() => window.__patrolTest.prepared());
        const id = await page.evaluate((k) => window.__patrolTest.prepare(k), kind);
        const base = kind === 'port' ? { kind: 'planet', id } : { kind: 'fleet', id };
        // Телефон показывает сначала короткую карточку; ангар живёт в подробностях.
        if (phone) await page.locator('.mobile-quick [data-mobile="details"]').tap();

        // Кнопка у эскадры, и она ВЗВОДИТ прицел патруля, а не удар.
        await press(page.locator('[data-act="wingpatrol"]'));
        const armed = await page.evaluate(() => window.__patrolTest.armed());
        assert.equal(armed?.patrol, true, 'прицел взведён как патруль');
        assert.deepEqual(armed?.from, kind === 'port' ? { planetId: id } : { fleetId: id });

        // Тап по точке карты внутри круга — и в состоянии патруль ровно в этой точке.
        const at = await page.evaluate(() => window.__patrolTest.near(40));
        const under = await page.evaluate(
          ({ x, y }) => document.elementFromPoint(x, y)?.tagName,
          at,
        );
        assert.equal(under, 'CANVAS', 'точка патруля не под панелью');
        if (phone) await page.touchscreen.tap(at.x, at.y);
        else await page.mouse.click(at.x, at.y);
        const [flight] = await page.evaluate(() => window.__patrolTest.patrols());
        assert.ok(flight, 'патруль поднят');
        assert.equal(flight.leg, 'out');
        assert.deepEqual(flight.base, base);
        const pos = await page.evaluate(() => window.__patrolTest.base());
        assert.ok(
          Math.abs(flight.to.x - (pos.x + 40)) < 3,
          `точка там, куда тапнули (${flight.to.x})`,
        );
        assert.ok(Math.abs(flight.to.y - pos.y) < 3, `точка там, куда тапнули (${flight.to.y})`);
        assert.equal(await page.evaluate(() => window.__patrolTest.armed()), null, 'прицел погас');

        // Повис — у метки есть отсчёт, у базы строка патруля и «Вернуть».
        await page.evaluate(() => window.__patrolTest.arrive());
        const [mark] = await page.evaluate(() => window.__patrolTest.marks());
        assert.equal(mark?.active, true, 'патруль висит над точкой');
        assert.ok((mark?.leftMs ?? 0) > 0, 'отсчёт идёт');
        const recall = page.locator(`[data-act="wingrecall"][data-arg="${flight.id}"]`);
        await recall.waitFor({ state: 'visible' });
        if (process.env.PATROL_SHOTS) {
          const shot = `${process.env.PATROL_SHOTS}/patrol-${kind}-${viewport.width}.png`;
          await page.screenshot({ path: shot });
        }

        // «Вернуть» разворачивает эскадру домой, и строка уходит из панели.
        await press(recall);
        const [back] = await page.evaluate(() => window.__patrolTest.patrols());
        assert.equal(back?.leg, 'back', 'патруль повернул домой');
        assert.deepEqual(await page.evaluate(() => window.__patrolTest.marks()), []);
        await recall.waitFor({ state: 'detached' });
      });
      console.log(`Patrol UI ${kind} ${viewport.width}px passed.`);
      await context.close();
    }
  }
  console.log(
    'Patrol UI smoke passed: port and hold, button, map point, countdown, recall — desktop and phone.',
  );
} finally {
  await browser.close();
  await site.close();
}
