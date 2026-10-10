#!/usr/bin/env node
/* global window, document -- эти имена живут внутри page.evaluate, то есть в браузере */
/**
 * SHU-6.5 — перелёт шаттлов в ИНТЕРФЕЙСЕ, проверенный настоящим браузером.
 *
 * Правила перелёта покрыты в ядре (`shuttleRelocate.test.ts`), выбор баз — в
 * `decisions/relocateTargets.test.ts` вместе со сторожем зеркала. Здесь вопрос из приёмки
 * кирпича: «перелёт ставится кнопками, недоступные базы не предлагаются». Кнопка у
 * эскадры взводит прицел, подходящая база в уголках, тап по ней кладёт в состояние
 * перелёт, и эскадра садится на новую базу. Корабль с полным трюмом и свой порт за
 * дальностью перелёта не подсвечены, и тап по полному кораблю приказа не даёт.
 *
 * Базы обе (резолюция владельца 2026-10-04, §0.7) и с обеих сторон: из порта мира на
 * корабль и из трюма корабля в порт мира. Экраны оба: ПК и телефон.
 *
 *   node prototype/relocatetest.mjs      # или pnpm run smoke:relocate
 *   RELOCATE_SHOTS=каталог node prototype/relocatetest.mjs   # плюс снимки взведённого прицела
 */
import assert from 'node:assert/strict';
import {
  enterSkirmish,
  instrumentedGame,
  launchBrowser,
  serve,
  withDiagnostics,
} from './harnessKit.mjs';

const hooks = `window.__relocateTest = {
  prepared: () => inMatch() && mapWasEntered && !mapPreparation.active,
  // Эскадра из двух перехватчиков (перелёт 360) стоит в порту своего мира ('port') или в
  // трюме своего «Носителя» у него ('hold'). Вокруг три базы: подходящая — свой носитель
  // у ближнего мира (для 'port') или порт этого мира (для 'hold'); носитель с полным
  // трюмом у соседнего узла; свой порт за дальностью перелёта.
  prepare: (kind) => {
    speed = 0;
    s = structuredClone(s);
    const home = Object.values(s.planets).find((p) => p.owner === ME);
    const gap = (a, b) => Math.hypot(a.position.x - b.position.x, a.position.y - b.position.y);
    const nodes = Object.values(s.planets)
      .filter((p) => p.id !== home.id && p.owner === null)
      .sort((a, b) => gap(a, home) - gap(b, home) || (a.id < b.id ? -1 : 1));
    const near = nodes.find((p) => gap(p, home) >= 60 && gap(p, home) <= 200);
    const side = nodes.find((p) => p !== near && gap(p, home) <= 200 && gap(p, near) >= 60);
    const far = nodes.find((p) => gap(p, home) > 420);
    const port = (p) => {
      p.buildings = p.buildings.filter((b) => b.type !== 'spaceport');
      p.buildings.push({ type: 'spaceport', level: 1, hp: hpOfLevel('spaceport', 1) });
      delete p.sortie;
    };
    const ship = (id, at, hangar) => ({
      id,
      owner: ME,
      location: at.id,
      movement: null,
      units: [{ unit: 'shuttle_carrier', count: 1 }],
      traits: [],
      battleId: null,
      hangar,
    });
    const deck = [{ id: 'sq:' + ME + ':' + kind, units: [{ unit: 'interceptor', count: 2 }] }];
    const full = ship('relo-full', side, [{ id: 'sq:' + ME + ':full', units: [{ unit: 'interceptor', count: 16 }] }]);
    s.fleets[full.id] = full;
    far.owner = ME;
    port(far);
    let from;
    let dest;
    if (kind === 'port') {
      port(home);
      home.hangar = deck;
      delete home.sortie;
      const carrier = ship('relo-dest', near, []);
      s.fleets[carrier.id] = carrier;
      from = { kind: 'planet', id: home.id };
      dest = { kind: 'fleet', id: carrier.id };
      pickWorld(home.id);
      planetTab = 'shuttle';
    } else {
      near.owner = ME;
      port(near);
      const carrier = ship('relo-home', home, deck);
      s.fleets[carrier.id] = carrier;
      from = { kind: 'fleet', id: carrier.id };
      dest = { kind: 'planet', id: near.id };
      setFleetSelection([carrier.id]);
    }
    lastPanelHtml = '';
    renderPanel();
    // Центруем ПОСЛЕ панели и между домом и соседями: открытая панель сужает поле карты,
    // а подходящая и полная база обязаны попасть на экран — не влезли, камера отходит.
    const trio = [home, near, side];
    const mid = {
      x: trio.reduce((n, p) => n + p.position.x, 0) / 3,
      y: trio.reduce((n, p) => n + p.position.y, 0) / 3,
    };
    const fits = () =>
      trio.every((p) => {
        const c = world(p.position);
        return c.x > 60 && c.x < VW - 60 && c.y > 120 && c.y < VH - 160;
      });
    centerOn(mid, cam.scale);
    for (let i = 0; i < 12 && !fits(); i++) centerOn(mid, cam.scale * 0.8);
    return {
      squadronId: deck[0].id,
      from,
      dest,
      full: { kind: 'fleet', id: full.id },
      far: { kind: 'planet', id: far.id },
    };
  },
  armed: () => strikeAim,
  // Базы в уголках — ровно то, что прицел предлагает.
  spots: () => relocateSpots().map((t) => t.base.kind + ':' + t.base.id),
  // Где база на странице: мир — в своей точке, корабль — у шеврона.
  at: (base) => {
    const p = relocateSpotPx(base);
    return p ? toScreen(p, canvas.getBoundingClientRect(), VW, VH) : null;
  },
  flights: () =>
    (s.strikes ?? [])
      .filter((st) => st.target.kind === 'base')
      .map((st) => ({ base: st.base, origin: st.origin, leg: st.leg })),
  // Мир доходит до прибытия: эскадра садится на новую базу.
  arrive: () => {
    const st = s.strikes.find((x) => x.target.kind === 'base');
    apply(advance(s, st.arrivesAt));
    lastPanelHtml = '';
    renderPanel();
  },
  hangar: (base) =>
    ((base.kind === 'planet' ? s.planets[base.id] : s.fleets[base.id])?.hangar ?? []).map((q) => q.id),
};`;

const key = (base) => `${base.kind}:${base.id}`;

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
      const tapAt = (p) => (phone ? page.touchscreen.tap(p.x, p.y) : page.mouse.click(p.x, p.y));
      // Ввод меняет состояние сразу, а раскладку (панель прячется под прицел, лист телефона
      // выходит из режима приказа) игра применяет в своём кадре. Читать DOM до этого кадра —
      // значит видеть прошлый экран: так смоук падал в плейтестах 2026-10-08 и 2026-10-09
      // (PT-03), под базой оказывалась кнопка, а лист складывался вслепую.
      const frame = () =>
        page.evaluate(
          () =>
            new Promise((resolve) =>
              window.requestAnimationFrame(() => window.requestAnimationFrame(resolve)),
            ),
        );
      await withDiagnostics(page, `relocate-${kind}-${viewport.width}`, async () => {
        await page.goto(site.url + '/');
        await enterSkirmish(page, { tap: phone });
        await page.waitForFunction(() => window.__relocateTest.prepared());
        const bases = await page.evaluate((k) => window.__relocateTest.prepare(k), kind);
        const { squadronId } = bases;
        const button = page.locator(`[data-act="wingrelocate"][data-arg="${squadronId}"]`);
        // Кнопка у эскадры взводит прицел ПЕРЕЛЁТА с её базы. Телефон показывает сначала
        // короткую карточку; ангар живёт в подробностях. «Подробности» — переключатель,
        // поэтому жмём его по состоянию листа, а не по видимости кнопки.
        const arm = async () => {
          await frame();
          if (phone && !(await page.locator('#mobile-sheet.expanded').count())) {
            await page.locator('.mobile-quick [data-mobile="details"]').tap();
          }
          await press(button);
          await frame();
          const armed = await page.evaluate(() => window.__relocateTest.armed());
          assert.equal(armed?.relocate, true, 'прицел взведён как перелёт');
          assert.equal(armed?.squadronId, squadronId);
          assert.deepEqual(
            armed?.from,
            bases.from.kind === 'planet' ? { planetId: bases.from.id } : { fleetId: bases.from.id },
          );
        };
        await arm();

        // Предложена подходящая база, и только она из трёх.
        const spots = await page.evaluate(() => window.__relocateTest.spots());
        assert.ok(spots.includes(key(bases.dest)), `подходящая база в уголках: ${spots}`);
        assert.ok(!spots.includes(key(bases.full)), 'носитель с полным трюмом не предложен');
        assert.ok(!spots.includes(key(bases.far)), 'порт за дальностью перелёта не предложен');
        if (process.env.RELOCATE_SHOTS) {
          const shot = `${process.env.RELOCATE_SHOTS}/relocate-${kind}-${viewport.width}.png`;
          await page.screenshot({ path: shot });
        }

        // Тап по полному носителю приказа не даёт: прицел гаснет, перелёта нет.
        const fullAt = await page.evaluate((b) => window.__relocateTest.at(b), bases.full);
        assert.ok(fullAt, 'полный носитель на экране');
        assert.equal(
          await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.tagName, fullAt),
          'CANVAS',
          'полный носитель не под панелью',
        );
        await tapAt(fullAt);
        assert.deepEqual(await page.evaluate(() => window.__relocateTest.flights()), []);
        assert.equal(await page.evaluate(() => window.__relocateTest.armed()), null, 'прицел погас');

        // Снова кнопка — и тап по подходящей базе ставит перелёт.
        await arm();
        const destAt = await page.evaluate((b) => window.__relocateTest.at(b), bases.dest);
        assert.ok(destAt, 'подходящая база на экране');
        assert.equal(
          await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.tagName, destAt),
          'CANVAS',
          'подходящая база не под панелью',
        );
        await tapAt(destAt);
        const [flight] = await page.evaluate(() => window.__relocateTest.flights());
        assert.ok(flight, 'перелёт поднят');
        assert.deepEqual(flight.base, bases.dest, 'летит на выбранную базу');
        assert.deepEqual(flight.origin, bases.from, 'помнит, откуда ушёл');
        assert.equal(flight.leg, 'back');
        assert.equal(await page.evaluate(() => window.__relocateTest.armed()), null, 'прицел погас');

        // Долетела — эскадра в ангаре новой базы под своим именем.
        await page.evaluate(() => window.__relocateTest.arrive());
        const landed = await page.evaluate((b) => window.__relocateTest.hangar(b), bases.dest);
        assert.ok(landed.includes(squadronId), `эскадра на новой базе: ${landed}`);
        assert.deepEqual(await page.evaluate(() => window.__relocateTest.flights()), []);
      });
      console.log(`Relocate UI ${kind} ${viewport.width}px passed.`);
      await context.close();
    }
  }
  console.log(
    'Relocate UI smoke passed: port to ship and ship to port, button, highlighted bases, full ship refused — desktop and phone.',
  );
} finally {
  await browser.close();
  await site.close();
}
