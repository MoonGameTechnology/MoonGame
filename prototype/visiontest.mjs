#!/usr/bin/env node
/* global window -- browser harness hooks */
/**
 * Зрение кадра пересчитывается только при смене мира (`currentVision`, шаг 3 плавности).
 *
 * Зачем. Туман и память разведки раньше считались каждый кадр, даже когда мир стоит: пауза
 * соло, сеть между снимками. Теперь кадр берёт запомненное зрение, пока мир, игрок, режим
 * сети и контакты сервера прежние. Ошибка в этом правиле игру не роняет, а тихо оставляет на
 * карте старый туман, поэтому робот после КАЖДОГО кадра сверяет зрение кадра со свежим
 * `computeVision()`, а память разведки — с живым миром.
 *
 * Сценарии (соло, карта по умолчанию):
 *  1. пауза — зрение не пересчитывается ни разу;
 *  2. приказ на паузе — мир новый, пересчёт ровно один;
 *  3. время идёт — мир новый каждый кадр, пересчёт каждый кадр;
 *  4. песочница с выключенным туманом правит мир на месте, потом выключается — зрение свежее;
 *  5. тот же мир ставится заново, память разведки очищена — она снова заполнена.
 * Во всех пяти расхождений со свежим зрением нет.
 *
 *   node prototype/visiontest.mjs     # или pnpm run smoke:vision (после pnpm run prototype)
 */
import assert from 'node:assert/strict';
import {
  enterSkirmish,
  instrumentedGame,
  launchBrowser,
  serve,
  withDiagnostics,
} from './harnessKit.mjs';

const hooks = `
import { snapshotOf as __snapshotOf } from './scanMemory';
window.__visionTest = (() => {
  const P = { on: false, calls: 0, frames: 0, bad: [] };
  const fresh = __fog.computeVision;
  __fog.computeVision = () => { if (P.on) P.calls++; return fresh(); };
  const same = (a, b) => a.size === b.size && [...a].every((x) => b.has(x));
  const check = () => {
    if (!vision) return;
    // The fresh projection rewrites the owners set; put the frame's set back so a stale
    // one is not repaired by the check itself.
    const owners = __fog.intelFleetOwners;
    const f = fresh();
    const freshOwners = __fog.intelFleetOwners;
    __fog.intelFleetOwners = owners;
    const bad = [];
    if (!same(vision.identify, f.identify)) bad.push('identify');
    if (!same(vision.radar, f.radar)) bad.push('radar');
    if (JSON.stringify(vision.signatures) !== JSON.stringify(f.signatures)) bad.push('signatures');
    if (!same(vision.engaged.fleets, f.engaged.fleets) || !same(vision.engaged.battles, f.engaged.battles))
      bad.push('engaged');
    if (!same(owners, freshOwners)) bad.push('intel');
    for (const id of f.identify) {
      const p = s.planets[id];
      if (p && JSON.stringify(memory.get(id)) !== JSON.stringify(__snapshotOf(p))) {
        bad.push('memory ' + id);
        break;
      }
    }
    if (bad.length && P.bad.length < 5) P.bad.push(bad.join(','));
  };
  const step = frame;
  frame = (t) => {
    step(t);
    if (P.on) {
      P.frames++;
      check();
    }
  };
  return {
    start() { Object.assign(P, { on: true, calls: 0, frames: 0, bad: [] }); },
    stop() { P.on = false; return { calls: P.calls, frames: P.frames, bad: P.bad }; },
    speed(v) { speed = v; },
    order() {
      const f = Object.values(s.fleets).find((x) => x.owner === ME && x.location);
      const to = f && s.planets[f.location]?.links?.find((id) => s.planets[id]);
      if (!to) return false;
      const before = s;
      playerOrder(moveFleet(ME, f.id, to));
      return s !== before;
    },
    sandboxFogOff() { sandboxConfig.enabled = true; sandboxConfig.fog = false; },
    // The sandbox way of editing: in place, the same world object.
    sandboxGive() {
      const seen = fresh().identify;
      const p = Object.values(s.planets).find((x) => x.owner !== ME && !seen.has(x.id));
      if (p) p.owner = ME;
      return p?.id ?? null;
    },
    sandboxOff() { sandboxConfig.enabled = false; sandboxConfig.fog = true; },
    reinstall() { installMatch(s, new Map()); speed = 0; },
  };
})();`;

const site = await serve(await instrumentedGame(hooks));
const browser = await launchBrowser();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.setDefaultTimeout(15000);
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
// `frameLoop` catches a throwing frame and only logs it, so a broken check would pass silently.
page.on('console', (message) => {
  if (message.type() === 'error' && message.text().startsWith('frame fail'))
    errors.push(message.text());
});
const call = (name, arg) => page.evaluate(([n, a]) => window.__visionTest[n](a), [name, arg]);
/** Frames over `ms`: how many, how many recomputed the vision, which disagreed with a fresh one. */
async function frames(ms) {
  await call('start');
  await page.waitForTimeout(ms);
  return call('stop');
}
try {
  await withDiagnostics(page, 'visiontest', async () => {
    await page.goto(site.url + '/');
    await enterSkirmish(page);
    await page.locator('#maploading').waitFor({ state: 'hidden' });
    await call('speed', 0);
    await page.waitForTimeout(300);

    const paused = await frames(1000);
    assert.ok(paused.frames > 10, `кадры идут: ${paused.frames}`);
    assert.equal(paused.calls, 0, 'на паузе зрение не пересчитывается');
    assert.deepEqual(paused.bad, []);

    await call('start');
    assert.equal(await call('order'), true, 'приказ дал новый мир');
    await page.waitForTimeout(500);
    const ordered = await call('stop');
    assert.equal(ordered.calls, 1, 'приказ на паузе — один пересчёт');
    assert.deepEqual(ordered.bad, []);

    await call('speed', 2);
    const running = await frames(1500);
    await call('speed', 0);
    assert.ok(
      running.calls >= running.frames - 1,
      `время идёт — пересчёт каждый кадр: ${running.calls} из ${running.frames}`,
    );
    assert.deepEqual(running.bad, []);

    await call('sandboxFogOff');
    await page.waitForTimeout(200);
    assert.ok(await call('sandboxGive'), 'есть неопознанный мир');
    await page.waitForTimeout(200);
    await call('sandboxOff');
    const sandbox = await frames(500);
    assert.deepEqual(sandbox.bad, [], 'после правки песочницей зрение свежее');

    await call('reinstall');
    const reinstalled = await frames(500);
    assert.deepEqual(reinstalled.bad, [], 'после установки того же мира память разведки заполнена');

    assert.deepEqual(errors, []);
    console.log(
      `✓ vision: пауза ${paused.frames} кадров без пересчёта, приказ — один, ход — ` +
        `${running.calls} из ${running.frames}, песочница и переустановка без расхождений`,
    );
  });
} finally {
  await browser.close();
  await site.close();
}
