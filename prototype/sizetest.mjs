#!/usr/bin/env node
/* global window, document, getComputedStyle, innerWidth, innerHeight, localStorage -- эти имена живут внутри page.evaluate */
/**
 * UIX-1.1 — сторож размеров в настоящем браузере: мелкий текст, мелкие цели нажатия и
 * содержимое шире окна на ключевых экранах.
 *
 * Прогон открывает хаб, карту партии, выбранный флот, производство, науку, бой и настройки на
 * телефоне 390×844 и на ПК 1366×768 и 1920×1080 и считает на каждом экране:
 *
 * - **текст мельче 12 px** — элемент со своим текстом, у которого `font-size × currentCSSZoom`
 *   меньше 12 (голографический ПК растёт зумом, UIX-2.1, и размер без зума врал бы);
 * - **цели нажатия меньше 44 px** хотя бы по одной стороне — только на телефоне: мышь
 *   попадает и в мелкую цель, палец нет;
 * - **содержимое шире окна** — элемент окна, вылезший за его край по горизонтали (считается
 *   внешний: вылезшая строка, а не каждый её потомок).
 *
 * Видимым считается то, что игрок может увидеть: элемент на экране, и в его середине
 * `elementFromPoint` находит его самого (или его потомка, или предка — подпись внутри кнопки).
 * Закрытое окном и спрятанное не считается.
 *
 * Сегодняшний счёт записан порогом в `prototype/sizeBaseline.json`. Прогон падает, когда счёт
 * экрана стал хуже порога, и просит опустить порог, когда стал лучше: остальные кирпичи
 * блока UIX опускают его до нуля, и порог не должен отставать от сделанного.
 *
 *   node prototype/sizetest.mjs            # или pnpm run smoke:sizes
 *   node prototype/sizetest.mjs --write    # записать сегодняшний счёт порогом
 */
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';

import {
  enterSkirmish,
  instrumentedGame,
  launchBrowser,
  pressSpeed,
  serve,
  waitForApp,
  withDiagnostics,
} from './harnessKit.mjs';

const BASELINE = new URL('./sizeBaseline.json', import.meta.url);
const WRITE = process.argv.includes('--write');

const hooks = `window.__sizeTest = {
  layers: () => BACK_LAYERS.filter((l) => l.isOpen()).map((l) => l.id),
  myFleet: () => Object.values(s.fleets).find((f) => f.owner === ME && f.location && f.units.some((u) => u.count > 0))?.id,
  selectFleet: (id) => setFleetSelection([id]),
  clearSelection: () => setFleetSelection([]),
  // Бой собирается прямо в мире, как в smoke:retreat: свой флот и чужой на соседнем узле,
  // война, «Атака». Ждать встречи на живой карте значило бы мерить ИИ, а не окно боя.
  stageBattle: () => {
    const mine = Object.values(s.fleets).find((f) => f.owner === ME && f.location);
    const foe = Object.values(s.fleets).find((f) => f.owner !== ME && f.units.length > 0);
    const away = (s.planets[mine.location].links ?? [])[0];
    mine.location = away; mine.movement = null;
    foe.location = away; foe.movement = null; foe.battleId = null;
    s.diplomacy = { ...(s.diplomacy ?? {}), [[ME, foe.owner].sort().join('|')]: 'war' };
    playerOrder(engageFleet(ME, mine.id, foe.id));
    return s.fleets[mine.id]?.battleId ?? null;
  },
  openBattle: (id) => battleWindow.open(id),
};`;

/** Счёт экрана — в браузере. `phone` включает счёт целей нажатия. */
function measure({ phone, windows }) {
  const W = innerWidth;
  const H = innerHeight;
  const zoomOf = (el) => el.currentCSSZoom ?? 1;
  const seen = (el) => {
    if (!el.checkVisibility?.({ opacityProperty: true, visibilityProperty: true })) return false;
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return false;
    const l = Math.max(r.left, 0);
    const t = Math.max(r.top, 0);
    const rr = Math.min(r.right, W);
    const b = Math.min(r.bottom, H);
    if (rr - l < 1 || b - t < 1) return false;
    const hit = document.elementFromPoint((l + rr) / 2, (t + b) / 2);
    return !!hit && (hit === el || el.contains(hit) || hit.contains(el));
  };
  const label = (el) =>
    `${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}${
      typeof el.className === 'string' && el.className.trim()
        ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.')
        : ''
    } «${(el.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 24)}»`;

  // Текст: элемент со своим непустым текстовым узлом.
  const texts = [...document.body.querySelectorAll('*')].filter(
    (el) =>
      !['SCRIPT', 'STYLE', 'NOSCRIPT', 'svg'].includes(el.tagName) &&
      [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()),
  );
  const shownTexts = texts.filter(seen);
  const small = shownTexts
    .map((el) => ({ el, px: parseFloat(getComputedStyle(el).fontSize) * zoomOf(el) }))
    .filter((x) => x.px < 12 - 0.01);

  // Цели нажатия — то, что игрок нажимает пальцем; выключенная кнопка не цель.
  const TARGETS =
    'button, a[href], input:not([type="hidden"]), select, textarea, summary, [role="button"], [role="tab"], [data-cmd]';
  const taps = phone
    ? [...document.querySelectorAll(TARGETS)]
        .filter((el) => !el.disabled && seen(el))
        .filter((el) => {
          const r = el.getBoundingClientRect();
          return r.width < 44 - 0.01 || r.height < 44 - 0.01;
        })
    : [];

  // Содержимое шире окна: внешний вылезший элемент каждого открытого окна.
  const wide = [];
  for (const id of windows) {
    const root = document.getElementById(id);
    if (!root?.checkVisibility?.()) continue;
    const box = root.getBoundingClientRect();
    const out = (el) => {
      if (!el.checkVisibility?.()) return false;
      const r = el.getBoundingClientRect();
      return r.width >= 1 && (r.right > box.right + 1 || r.left < box.left - 1);
    };
    for (const el of root.querySelectorAll('*'))
      if (out(el) && !(el.parentElement !== root && out(el.parentElement))) wide.push(el);
  }

  return {
    measured: windows.filter((id) => document.getElementById(id)?.checkVisibility?.()),
    counts: { text: small.length, tap: taps.length, wide: wide.length },
    of: { text: shownTexts.length },
    samples: {
      text: small.slice(0, 6).map((x) => `${label(x.el)} ${x.px.toFixed(1)}px`),
      tap: taps.slice(0, 6).map((el) => {
        const r = el.getBoundingClientRect();
        return `${label(el)} ${Math.round(r.width)}×${Math.round(r.height)}`;
      }),
      wide: wide.slice(0, 6).map(label),
    },
  };
}

const VIEWS = [
  {
    id: 'phone-390x844',
    phone: true,
    page: {
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
      deviceScaleFactor: 2,
    },
  },
  { id: 'pc-1366x768', phone: false, page: { viewport: { width: 1366, height: 768 } } },
  { id: 'pc-1920x1080', phone: false, page: { viewport: { width: 1920, height: 1080 } } },
];

const site = await serve(await instrumentedGame(hooks));
const browser = await launchBrowser();
/** Счёт: вид → экран → { text, tap, wide }. */
const result = {};
const errors = [];

try {
  for (const view of VIEWS) {
    const page = await browser.newPage(view.page);
    page.setDefaultTimeout(15000);
    page.on('pageerror', (e) => errors.push(`${view.id}: ${e.message}`));
    await page.addInitScript(() => localStorage.setItem('vd.locale', 'ru'));
    const screens = (result[view.id] = {});
    await withDiagnostics(page, `sizetest:${view.id}`, async () => {
      const press = (sel) => (view.phone ? page.locator(sel).tap() : page.locator(sel).click());
      /** Окно открывается той же кнопкой, что у игрока: на телефоне — вкладкой или «Ещё». */
      const open = async (phoneSel, pcSel) => {
        if (view.phone) {
          if (phoneSel.startsWith('#phone-more')) await press('#phone-nav [data-phone-tab="more"]');
          await press(phoneSel);
        } else await page.evaluate((sel) => document.querySelector(sel).click(), pcSel);
        await page.waitForTimeout(350);
      };
      const shot = async (name) => {
        const layers = await page.evaluate(() => window.__sizeTest?.layers() ?? []);
        const m = await page.evaluate(measure, {
          phone: view.phone,
          windows: [...layers, 'side', 'holo-selection-window', 'hub'],
        });
        screens[name] = m.counts;
        console.log(
          `${view.id.padEnd(13)} ${name.padEnd(11)} текст<12: ${String(m.counts.text).padStart(3)} из ${String(m.of.text).padStart(3)}` +
            (view.phone ? ` · цели<44: ${String(m.counts.tap).padStart(3)}` : '') +
            ` · шире окна: ${m.counts.wide}`,
        );
        if (process.env.SIZE_SAMPLES)
          console.log(JSON.stringify({ layers, windows: m.measured, ...m.samples }, null, 1));
      };
      /** Закрыть всё до карты — лестницей «Назад», как игрок. */
      const back = async () => {
        for (let i = 0; i < 6; i++) {
          const layers = await page.evaluate(() => window.__sizeTest.layers());
          if (!layers.length) break;
          await page.keyboard.press('Escape');
          await page.waitForTimeout(120);
        }
      };

      await page.goto(site.url);
      await waitForApp(page);
      await press('#cnew');
      await page.locator('#hub-solo').waitFor({ state: 'visible' });
      await page.waitForTimeout(300);
      await shot('hub');

      await enterSkirmish(page, { tap: view.phone, fromWelcome: false });
      await page.locator('#maploading').waitFor({ state: 'hidden' });
      // Пауза: мир идёт в реальном времени, и без неё счёт зависел бы от того, что ИИ успел.
      await pressSpeed(page, '#spd-pause', { tap: view.phone });
      await page.waitForTimeout(300);
      await shot('map');

      const fleet = await page.evaluate(() => window.__sizeTest.myFleet());
      assert(fleet, 'у игрока есть флот');
      await page.evaluate((id) => window.__sizeTest.selectFleet(id), fleet);
      await page.waitForTimeout(350);
      await shot('fleet');
      await page.evaluate(() => window.__sizeTest.clearSelection());

      await open('#phone-nav [data-phone-tab="production"]', '#rail-constructor');
      await shot('production');
      await back();

      await open('#phone-nav [data-phone-tab="science"]', '#rail-tech');
      await shot('science');
      await back();

      const battle = await page.evaluate(() => window.__sizeTest.stageBattle());
      assert(battle, 'бой собран');
      await page.evaluate((id) => window.__sizeTest.openBattle(id), battle);
      await page.waitForTimeout(350);
      await shot('battle');
      await back();

      await open('#phone-more [data-phone-more="settings"]', '#rail-settings');
      await shot('settings');
      await back();
    });
    await page.close();
  }
  assert.deepEqual(errors, [], 'ошибки страницы');

  if (WRITE) {
    writeFileSync(BASELINE, JSON.stringify(result, null, 2) + '\n');
    console.log(`порог записан: ${BASELINE.pathname}`);
  } else {
    const base = JSON.parse(readFileSync(BASELINE, 'utf8'));
    const worse = [];
    const better = [];
    for (const [view, screens] of Object.entries(result))
      for (const [screen, counts] of Object.entries(screens))
        for (const [kind, n] of Object.entries(counts)) {
          const limit = base[view]?.[screen]?.[kind];
          assert(limit !== undefined, `в пороге нет ${view} · ${screen} · ${kind}`);
          if (n > limit) worse.push(`${view} · ${screen} · ${kind}: ${n} > ${limit}`);
          else if (n < limit) better.push(`${view} · ${screen} · ${kind}: ${n} < ${limit}`);
        }
    assert.deepEqual(worse, [], 'стало хуже порога');
    assert.deepEqual(
      better,
      [],
      'стало лучше порога — опусти его: node prototype/sizetest.mjs --write',
    );
    console.log(
      'PASS sizes: every screen is at its threshold (text < 12 px, phone targets < 44 px, content wider than its window)',
    );
  }
} finally {
  await browser.close();
  await site.close();
}
