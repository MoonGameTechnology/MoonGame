#!/usr/bin/env node
/* global window, document, localStorage */
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { instrumentedGame, launchBrowser, serve, waitForApp } from './harnessKit.mjs';
const host = await serve(
  await instrumentedGame(`
const trainingUiTest = () => trainingTourUi({world:()=>s,me:()=>ME,mobile:MOBILE,
  expanded:()=>mobileHud.expanded(selPlanet ? 'planet:'+selPlanet : 'fleet:'+selFleet),collapse:()=>mobileHud.collapse(),tab:()=>planetTab,ships:()=>{setPlanetTab('ships');},
  render:()=>{invalidatePanel();renderPanel();updateMobileHud();}});
window.__trainingTest = {
  advance: hours => apply(advance(s,s.time+hours*3600000)),
  facts: () => ({state:s,selected:selFleet,paused:!!activeTour?.holdsClock,tab:planetTab,
    rewards:{research:sectorProgress.research,warrants:sectorProgress.warrants,sovereigns:sectorProgress.sovereigns,
      nextAttempt:sectorProgress.nextAttempt,settledThrough:sectorProgress.settledThrough}}),
  current: () => {
    const id=document.querySelector('#spotlight')?.dataset.step;
    const steps=buildTrainingTour({world:()=>s,me:ME,data,baseline:trainingBaseline(s,ME,data),ui:trainingUiTest()});
    const step=steps.find(x=>x.id===id);
    return step ? {id,target:step.selector?.()??step.target,anchor:!!step.anchor,clock:step.holdClock} : null;
  },
};`),
);
const browser = await launchBrowser();
mkdirSync('/tmp/sz-training', { recursive: true });
try {
  for (const mode of process.argv.includes('--desktop')
    ? ['desktop']
    : process.argv.includes('--phone')
      ? ['phone']
      : ['desktop', 'phone']) {
    const page = await browser.newPage(
      mode === 'phone'
        ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }
        : { viewport: { width: 1280, height: 800 } },
    );
    page.setDefaultTimeout(30000);
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    try {
      await page.goto(host.url);
      await waitForApp(page, { timeout: 30000 });
      await page.locator('#cnew').click();
      // Opening the campaign uses the same menu control as a player.
      await page.locator('#hub-sector-zero').click();
      // Opaque snapshots prove the lesson never writes over the campaign or solo slot.
      const saved = await page.evaluate(() => {
        const slots = ['void.solo.v1', 'void.run.v1', 'void.run.portable.v1'];
        const values = Object.fromEntries(slots.map((k) => [k, JSON.stringify({ preserve: k })]));
        for (const [k, v] of Object.entries(values)) localStorage.setItem(k, v);
        return values;
      });
      const rewards = (await page.evaluate(() => window.__trainingTest.facts())).rewards;
      await page.locator('#sz-training').click();
      await page.locator('#comic-next').click();
      await page.locator('#comic').waitFor({ state: 'hidden' });
      await page.locator('#maploading').waitFor({ state: 'hidden' });
      await page.locator('#spotlight').waitFor({ state: 'visible' });
      // Finding a control pauses training. Folding releases it; reopening restores it.
      await page.waitForFunction(() => window.__trainingTest.facts().paused === true);
      await page.locator('.sl-fold').click();
      assert.equal((await page.evaluate(() => window.__trainingTest.facts())).paused, false);
      await page.locator('#spotlight-chip').click();
      await page.waitForFunction(() => window.__trainingTest.facts().paused === true);
      const pausedAt = (await page.evaluate(() => window.__trainingTest.facts())).state.time;
      await page.waitForTimeout(250);
      assert.equal((await page.evaluate(() => window.__trainingTest.facts())).state.time, pausedAt);
      let previous = '';
      let repeated = 0;
      for (let guard = 0; guard < 700; guard++) {
        const facts = await page.evaluate(() => window.__trainingTest.facts());
        if (facts.state.match.status === 'ended') {
          assert.equal(facts.state.match.winner, 'p1');
          break;
        }
        const step = await page.evaluate(() => window.__trainingTest.current());
        assert.ok(step, 'guide must remain active');
        if (step.id !== previous) {
          console.log(mode, step.id);
          previous = step.id;
          repeated = 0;
        } else repeated++;
        assert.ok(repeated < 60, `stuck at ${step.id}`);
        if (
          step.id.endsWith('-fleet') ||
          ['prep.fleet', 'fleet.select', 'carrier.select'].includes(step.id) ||
          step.anchor
        ) {
          if (repeated === 0 && (await page.locator('.sl-reveal').isVisible())) {
            await page.locator('.sl-reveal').click();
            await page.waitForTimeout(180);
          }
        }
        const control = step.target
          ? page.locator(step.target).filter({ visible: true }).first()
          : null;
        if (
          control &&
          (await control.count()) &&
          (await control.isEnabled()) &&
          step.id !== 'research.grid'
        ) {
          if (mode === 'phone') await control.tap();
          else await control.click();
          // Шаг, ждущий состояния, сменяется на следующем кадре подсветки, а нажатие могло
          // уже спрятать свою кнопку («Отступить» закрывает окно боя): без ожидания цикл
          // перечитывал старый шаг и падал на пропавшей кнопке.
          await page
            .waitForFunction(
              (id) => document.querySelector('#spotlight')?.dataset.step !== id,
              step.id,
              { timeout: 1000 },
            )
            .catch(() => {});
        } else if (step.anchor && step.clock) {
          const rect = await page.locator('.sl-ring').boundingBox();
          assert.ok(rect, `missing ring: ${step.id}`);
          if (mode === 'phone')
            await page.touchscreen.tap(rect.x + rect.width / 2, rect.y + rect.height / 2);
          else await page.mouse.click(rect.x + rect.width / 2, rect.y + rect.height / 2);
        } else if (!step.clock) {
          // «Итог» ждёт объявленную контратаку (TRN-3): 25 игровых часов отсчёта и бой о
          // форт поста — мелкий шаг упёрся бы в предел повторов.
          await page.evaluate(
            (hours) => window.__trainingTest.advance(hours),
            step.id.endsWith('bombard-wait') ? 0.1 : step.id === 'finale.result' ? 2 : 0.25,
          );
        } else throw new Error(`missing control: ${step.id} ${step.target}`);
        await page.waitForTimeout(80);
      }
      const facts = await page.evaluate(() => window.__trainingTest.facts());
      assert.equal(facts.state.match.winner, 'p1');
      assert.deepEqual(errors, []);
      await page.screenshot({ path: `/tmp/sz-training/${mode}-complete.png` });
      // Первая победа на полигоне платит стартовый пакет (§14.7) и больше ничего: ни забега,
      // ни Суверенов.
      const won = {
        ...rewards,
        research: rewards.research + 3,
        warrants: rewards.warrants + 20,
      };
      assert.deepEqual(facts.rewards, won, 'training grants exactly its starter pack');
      if (await page.locator('#comic').isVisible()) {
        await page.locator('#comic-next').click();
        await page.locator('#comic').waitFor({ state: 'hidden' });
      }
      await page.locator('[data-es="again"]').click();
      await page.locator('#maploading').waitFor({ state: 'hidden' });
      await page.locator('#spotlight').waitFor({ state: 'visible' });
      const replay = await page.evaluate(() => window.__trainingTest.facts());
      assert.equal(replay.state.match.status, 'ongoing');
      assert.equal(replay.state.planets.target.owner, 'p2');
      assert.deepEqual(replay.rewards, won, 'replay does not pay the pack again');
      await page.locator('.sl-skip').click();
      await page.locator('#spotlight').waitFor({ state: 'hidden' });
      assert.equal((await page.evaluate(() => window.__trainingTest.facts())).paused, false);
      // «Вернуть обучение» поднимает подсказки снова, с начала этапа, где их закрыли.
      await page.locator('#training-resume').click();
      await page.locator('#spotlight').waitFor({ state: 'visible' });
      assert.match((await page.evaluate(() => window.__trainingTest.current()))?.id ?? '', /^prep\./);
      assert.equal(await page.locator('#training-resume').isVisible(), false);
      await page.locator('.sl-skip').click();
      await page.locator('#spotlight').waitFor({ state: 'hidden' });
      await page.locator('#training-resume').waitFor({ state: 'visible' });
      for (const [key, value] of Object.entries(saved))
        assert.equal(
          await page.evaluate((k) => localStorage.getItem(k), key),
          value,
          `preserve ${key}`,
        );
      assert.deepEqual(errors, []);
      console.log(mode, 'all twelve stages, pause/fold, replay/skip/resume, starter pack and save isolation');
    } catch (e) {
      console.error(e);
      await page.screenshot({ path: `/tmp/sz-training/${mode}-failure.png` }).catch(() => {});
      writeFileSync(
        `/tmp/sz-training/${mode}-failure.json`,
        JSON.stringify(
          await page.evaluate(() => ({
            step: window.__trainingTest.current(),
            facts: window.__trainingTest.facts(),
            buttons: [...document.querySelectorAll('button')]
              .filter((e) => e.offsetWidth && e.offsetHeight)
              .map((e) => ({
                text: e.textContent,
                id: e.id,
                data: { ...e.dataset },
                disabled: e.disabled,
              })),
          })),
          null,
          2,
        ),
      );
      throw e;
    } finally {
      await page.close();
    }
  }
} finally {
  await browser.close();
  await host.close();
}
