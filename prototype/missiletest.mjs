#!/usr/bin/env node
/* global window -- имя живёт внутри page.evaluate, то есть в браузере */
/**
 * Ракеты из ангара (missiles-roadmap, решения владельца 2026-11-09), проверенные настоящим
 * браузером на ПК и телефоне.
 *
 * Правила пуска и самонаведения покрыты в `packages/shared-core/src/modules/missiles.test.ts`.
 * Здесь вопрос другой — «игрок пускает ракеты из ангара»: у своей базы с ракетами значок
 * «◇», тап по нему открывает карточку ракетной эскадры с «Пуск» и «Залп» и без удара,
 * патруля и перелёта; «Залп» взводит прицел, тап по чужому флоту пускает ракеты, и они
 * долетают и бьют цель.
 *
 *   node prototype/missiletest.mjs                     # или pnpm run smoke:missiles
 *   MISSILE_SHOTS=каталог node prototype/missiletest.mjs   # плюс снимки
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
import { hpOfLevel as __hpOfLevel } from './game';
import { hangarHits as __hangarHits } from './mapHangars';
import { fleetAnchor as __fleetAnchor } from './fleetGeometry';
import { canOrder as __canOrder, kernel as __kernel } from './protoKernel';
import { launchMissiles as __launch } from '../../decisions/actions';
import { setStance as __setStance, isMissileFleet as __isMissileFleet } from '../../packages/shared-core/src/index';
window.__missileTest = {
  prepared: () => inMatch() && __mapWasEntered && !mapPreparation.active,
  // Свой мир с портом и тремя ракетами в ангаре; в 120 восточнее стоит чужой флот, с хозяином
  // которого война. Выбора нет, мир в центре экрана.
  prepare: () => {
    speed = 0;
    s = structuredClone(s);
    const home = Object.values(s.planets).find((p) => p.owner === ME);
    home.buildings = home.buildings.filter((b) => b.type !== 'spaceport');
    home.buildings.push({ type: 'spaceport', level: 1, hp: __hpOfLevel('spaceport', 1) });
    home.hangar = [{ id: 'sq:' + ME + ':m', units: [{ unit: 'cruise_missile', count: 3 }] }];
    delete home.sortie;
    const foe = Object.values(s.fleets).find((x) => x.owner !== ME && s.players[x.owner]);
    __setStance(s, ME, foe.owner, 'war');
    foe.location = null;
    foe.movement = null;
    foe.battleId = null;
    foe.edge = null;
    foe.flight = undefined;
    // Чужой флот висит в точке у нашего мира: стоянка на дороге — та же, что у мины.
    // Дорога на запад: карточка ПК встаёт справа от выбора и не должна закрыть цель.
    const lane = [...home.links].sort((a, b) => s.planets[a].position.x - s.planets[b].position.x)[0];
    const far = Math.hypot(
      s.planets[lane].position.x - home.position.x,
      s.planets[lane].position.y - home.position.y,
    );
    foe.edge = { from: home.id, to: lane, t: Math.min(0.5, 120 / far) };
    // Глаза на цель: свой разведчик рядом с ней (чужой флот за туманом — не цель).
    const eye = Object.values(s.fleets).find((x) => x.owner === ME);
    s.fleets.__eye = { ...structuredClone(eye), id: '__eye', location: null, movement: null,
      battleId: null, edge: { ...foe.edge, t: Math.max(0.01, foe.edge.t - 0.05) } };
    clearSelection();
    invalidatePanel();
    renderPanel();
    centerOn(home.position, Math.max(cam.scale, 1.6));
    return { home: home.id, sq: 'sq:' + ME + ':m', foe: foe.id };
  },
  hits: () => {
    const r = canvas.getBoundingClientRect();
    return __hangarHits().map((h) => ({ x: r.left + h.x, y: r.top + h.y, ids: h.squadronIds }));
  },
  foeAt: (id) => {
    const a = __fleetAnchor(s.fleets[id]);
    const r = canvas.getBoundingClientRect();
    return a && { x: r.left + a.x, y: r.top + a.y };
  },
  sel: () => ({ squadron: selSquadron }),
  probe: (a) => __canOrder(s, __launch(ME, { planetId: a.home }, a.sq, { targetFleetId: a.foe }, 3)),
  missiles: () => Object.values(s.fleets).filter((f) => __isMissileFleet(f, data)).length,
  left: (sq) => {
    for (const p of Object.values(s.planets)) {
      const q = (p.hangar ?? []).find((x) => x.id === sq);
      if (q) return q.units.reduce((n, st) => n + st.count, 0);
    }
    return 0;
  },
  hp: (id) => s.fleets[id]?.units.map((u) => u.hp ?? null) ?? null,
  run: (hours) => {
    const r = __kernel.advanceTo(s, { now: s.time + hours * 3600000, data });
    if (r.ok) s = r.state;
    invalidatePanel();
    renderPanel();
    return r.ok;
  },
};`;

const shots = process.env.MISSILE_SHOTS;
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
      ...(process.env.MISSILE_LOCALE ? { locale: process.env.MISSILE_LOCALE } : {}),
    });
    const page = await context.newPage();
    page.setDefaultTimeout(15000);
    const press = (locator) => (phone ? locator.tap() : locator.click());
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
    const t = (fn, arg) => page.evaluate(([f, a]) => window.__missileTest[f](a), [fn, arg]);
    await withDiagnostics(page, `missile-${tag}`, async () => {
      await page.goto(site.url + '/');
      await enterSkirmish(page, { tap: phone });
      await page.waitForFunction(() => window.__missileTest.prepared());
      const ids = await t('prepare');
      await page.waitForFunction(() => window.__missileTest.hits().length > 0);
      const [badge] = await t('hits');
      assert.deepEqual(badge.ids, [ids.sq], 'значок ангара несёт ракетную эскадру');

      await tapAt(badge);
      await frame();
      assert.equal((await t('sel')).squadron, ids.sq, 'тап по значку выделил ракеты');
      if (phone && !(await page.locator('#side [data-act="mslsalvo"]').isVisible()))
        await page.locator('#mobile-sheet .mobile-info').tap();
      await shot('1-kartochka');
      for (const act of ['msllaunch', 'mslsalvo'])
        assert.equal(await page.locator(`#side [data-act="${act}"]`).count(), 1, `кнопка ${act}`);
      for (const act of ['wingstrike', 'wingpatrol', 'wingrelocate'])
        assert.equal(await page.locator(`#side [data-act="${act}"]`).count(), 0, `нет ${act}`);

      await press(page.locator(`#side [data-act="mslsalvo"][data-arg="${ids.sq}"]`));
      await frame();
      await shot('2-pricel');
      const foe = await t('foeAt', ids.foe);
      assert.ok(foe, 'чужой флот нарисован');
      assert.equal(await t('probe', ids), null, 'ядро примет залп по цели');
      await tapAt(foe);
      await frame();
      assert.equal(await t('missiles'), 3, 'залп: три ракеты в полёте');
      assert.equal(await t('left', ids.sq), 0, 'ангар опустел');
      await shot('3-v-polyote');

      assert.ok(await t('run', 1), 'мир шагнул на час');
      assert.equal(await t('missiles'), 0, 'ракеты долетели');
      const hp = await t('hp', ids.foe);
      assert.ok(hp === null || hp.some((v) => v !== null), 'цель получила урон или погибла');
      await shot('4-popadanie');
    });
    console.log(`Missile launch ${tag} passed.`);
    await context.close();
  }
  console.log('Missile smoke passed: badge, card, salvo aim, launch, hit — desktop and phone.');
} finally {
  await browser.close();
  await site.close();
}
