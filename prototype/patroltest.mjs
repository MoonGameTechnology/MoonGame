#!/usr/bin/env node
/* global window, document -- эти имена живут внутри page.evaluate, то есть в браузере */
/**
 * SHU-6.3 — патруль шаттлов в ИНТЕРФЕЙСЕ, проверенный настоящим браузером.
 *
 * Правила патруля покрыты в ядре (`shuttlePatrol.test.ts`, `shuttleHold.test.ts`), метки —
 * в `decisions/patrolMarks.test.ts`. Здесь вопрос другой — «игрок может поставить и снять
 * патруль»: кнопка у эскадры, тап по точке карты кладёт в состояние патруль, панель базы
 * показывает его остаток и «Вернуть», и «Вернуть» разворачивает эскадру домой.
 *
 * SHU-6.6 — «Держать патруль»: переключатель в строке патруля ставит и снимает удержание,
 * удерживаемый патруль после посадки встаёт снова без единого нажатия, а эскадру, которая
 * ждёт дома с удержанием, карточка отпускает своей кнопкой.
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
      .map((st) => ({
        id: st.id,
        leg: st.leg,
        to: st.to,
        base: st.base,
        hold: st.patrol?.hold === true,
      })),
  // Мир доходит до точки: патруль повисает, у круга появляется отсчёт.
  arrive: () => {
    const st = s.strikes.find((x) => x.target.kind === 'point');
    apply(advance(s, st.arrivesAt));
    lastPanelHtml = '';
    renderPanel();
  },
  marks: () => patrolMarks(s.strikes, { me: ME, now: s.time }),
  // Мир доходит до конца ЭТОЙ ноги вылета: висение кончилось — разворот, вернулся — посадка
  // (и у удерживаемого патруля — новый взлёт в ту же минуту).
  leg: (id) => {
    const st = s.strikes.find((x) => x.id === id);
    apply(advance(s, st.arrivesAt));
    lastPanelHtml = '';
    renderPanel();
  },
  // Id эскадры, которую положил prepare.
  squadron: (kind) => 'sq:' + ME + ':' + kind,
  // Эскадра дома и держит патруль — так она ждёт конца перезарядки или боя корабля.
  // Ждать их на живой карте значило бы проверять часы, а не кнопку.
  holdAtHome: (sqId) => {
    const host = [...Object.values(s.planets), ...Object.values(s.fleets)].find((x) =>
      (x.hangar ?? []).some((q) => q.id === sqId),
    );
    host.hangar.find((q) => q.id === sqId).hold = {};
    lastPanelHtml = '';
    renderPanel();
  },
  homeHold: (sqId) => {
    for (const x of [...Object.values(s.planets), ...Object.values(s.fleets)]) {
      const q = (x.hangar ?? []).find((y) => y.id === sqId);
      if (q) return q.hold ?? null;
    }
    return undefined;
  },
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
        await page.locator(`[data-act="wingrecall"][data-arg="${flight.id}"]`).waitFor({
          state: 'visible',
        });
        if (process.env.PATROL_SHOTS) {
          const shot = `${process.env.PATROL_SHOTS}/patrol-${kind}-${viewport.width}.png`;
          await page.screenshot({ path: shot });
        }

        // «Держать патруль» (SHU-6.6) — переключатель в той же строке: ставит и снимает.
        const keep = page.locator(`[data-act="wingkeep"][data-arg="${flight.id}"]`);
        const held = async () => (await page.evaluate(() => window.__patrolTest.patrols()))[0]?.hold;
        await press(keep);
        assert.equal(await held(), true, 'патруль держится');
        await press(keep);
        assert.equal(await held(), false, 'удержание снято тем же переключателем');
        await press(keep);
        assert.equal(await held(), true, 'и поставлено снова');

        // Висение кончилось — домой; сел — и встал снова сам, игрок ничего не нажимал.
        await page.evaluate((id) => window.__patrolTest.leg(id), flight.id);
        await page.evaluate((id) => window.__patrolTest.leg(id), flight.id);
        const [again] = await page.evaluate(() => window.__patrolTest.patrols());
        assert.ok(again && again.id !== flight.id, 'удерживаемый патруль встал снова');
        assert.equal(again.leg, 'out');
        assert.equal(again.hold, true, 'и держится дальше');
        assert.deepEqual(again.base, base);

        // «Вернуть» разворачивает эскадру домой, снимает удержание, и строка уходит из панели.
        const recall = page.locator(`[data-act="wingrecall"][data-arg="${again.id}"]`);
        await press(recall);
        const [back] = await page.evaluate(() => window.__patrolTest.patrols());
        assert.equal(back?.leg, 'back', 'патруль повернул домой');
        assert.equal(back?.hold, false, 'вернул игрок — встать снова сам патруль не должен');
        assert.deepEqual(await page.evaluate(() => window.__patrolTest.marks()), []);
        await recall.waitFor({ state: 'detached' });

        // Эскадра дома и ждёт с удержанием — карточка отпускает её своей кнопкой.
        await page.evaluate((id) => window.__patrolTest.leg(id), back.id);
        const sqId = await page.evaluate((k) => window.__patrolTest.squadron(k), kind);
        await page.evaluate((q) => window.__patrolTest.holdAtHome(q), sqId);
        const release = page.locator(`[data-act="wingrelease"][data-arg="${sqId}"]`);
        await press(release);
        assert.equal(
          await page.evaluate((q) => window.__patrolTest.homeHold(q), sqId),
          null,
          'удержание снято с эскадры дома',
        );
        await release.waitFor({ state: 'detached' });
      });
      console.log(`Patrol UI ${kind} ${viewport.width}px passed.`);
      await context.close();
    }
  }
  console.log(
    'Patrol UI smoke passed: port and hold, button, map point, countdown, hold patrol, recall — desktop and phone.',
  );
} finally {
  await browser.close();
  await site.close();
}
