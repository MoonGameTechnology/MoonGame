#!/usr/bin/env node
/* global window, document -- эти имена живут внутри page.evaluate, то есть в браузере */
/**
 * RETR-3 — авто-отход в ИНТЕРФЕЙСЕ, проверенный настоящим браузером.
 *
 * Почему браузером, а не юнит-тестом: ядро и драйверы RETR-2 уже покрыты
 * (`autoRetreat.test.ts`, `standingOrders.test.ts`), и они отвечают на вопрос «правило
 * верное». Здесь вопрос другой — «игрок может отдать приказ»: кнопка существует в ряду,
 * видна при выделении, обходит ступени по кругу и кладёт в состояние то, что показала.
 * Ровно этого не хватало, чтобы механика не осталась недостижимой (см. EVT-1 и
 * `station.deploy` — обе были написаны, покрыты тестами и не могли сработать у игрока).
 *
 * Инструментовка — тем же приёмом, что `mobiletest.mjs`: исходник собирается с допиской
 * хуков, поэтому тест видит `s`, выделение и экранные координаты флотов, не заводя ради
 * этого экспортов в проде.
 *
 *   node prototype/retreattest.mjs      # или pnpm run smoke:retreat
 */
import assert from 'node:assert/strict';
import {
  enterSkirmish,
  instrumentedGame,
  launchBrowser,
  serve,
  withDiagnostics,
} from './harnessKit.mjs';

const hooks = `window.__retreatTest = {
  state: () => s,
  me: () => ME,
  ids: () => selectedFleetIds(),
  fleets: () => Object.values(s.fleets).map(f => ({ id:f.id, owner:f.owner, p:fleetAnchor(f) })),
};`;

const site = await serve(await instrumentedGame(hooks));
const browser = await launchBrowser();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.setDefaultTimeout(15000);
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));

try {
  await withDiagnostics(page, 'retreattest', async () => {
    await page.goto(site.url + '/');
    await enterSkirmish(page);
    await page.locator('#maploading').waitFor({ state: 'hidden' });

    // ПАУЗА перед любым кликом по карте. Мир идёт в реальном времени, поэтому координаты
    // флота устаревают между чтением и кликом — первый вариант теста ловил это как
    // «флот не выделился» через раз. Пауза не обход флакости, а её причина, снятая в
    // корне: проверяем интерфейс, а не попадание по движущейся мишени.
    await page.locator('#spd-pause').click();

    // Выделяем СВОЙ флот: без выделения командного ряда нет вовсе.
    const mine = (await page.evaluate(() => window.__retreatTest.fleets())).find(
      (f) => f.owner === 'p1',
    );
    assert(mine, 'у места p1 есть флот');
    await page.mouse.click(mine.p.x, mine.p.y);
    assert.deepEqual(
      await page.evaluate(() => window.__retreatTest.ids()),
      [mine.id],
      'флот выделен',
    );

    // Кнопка живёт под ☰ (группа extras), как и соседний авто-штурм.
    // Стоячие приказы живут в группе extras — её раскрывает «☰» ПРЯМО В РЯДУ
    // (`data-cmd="more"`), а не рельса интерфейса `#railtoggle`.
    const retr = page.locator('#cmdbar [data-cmd="qretr"]');
    if ((await retr.count()) === 0) await page.locator('#cmdbar [data-cmd="more"]').click();
    if ((await retr.count()) === 0) {
      const seen = await page.evaluate(() =>
        [...document.querySelectorAll('[data-cmd]')].map(
          (b) => `${b.dataset.cmd}${b.closest('#cmdbar') ? '' : '(вне #cmdbar)'}`,
        ),
      );
      assert.fail(`кнопки qretr нет. В ряду: ${seen.join(', ') || '— пусто'}`);
    }
    await retr.waitFor({ state: 'visible' });
    assert.equal(await retr.isDisabled(), false, 'при выделенном флоте кнопка активна');

    const orderOf = () =>
      page.evaluate((id) => window.__retreatTest.state().autoRetreat?.[id] ?? null, mine.id);
    assert.equal(await orderOf(), null, 'приказа изначально нет');

    // Ступени по кругу: 20 → 30 → 40 → 50 → снят.
    for (const at of [0.2, 0.3, 0.4, 0.5]) {
      await retr.click();
      const order = await orderOf();
      assert(order, `после нажатия приказ стоит (ждали порог ${at})`);
      assert.equal(order.at, at, `ступень ${at}`);
      assert(typeof order.to === 'string' && order.to.length > 0, 'точка отхода названа');
      assert.equal(
        await page.evaluate(() =>
          document.querySelector('#cmdbar [data-cmd="qretr"]').className.includes('on'),
        ),
        true,
        'кнопка подсвечена, пока приказ стоит',
      );
    }
    await retr.click();
    assert.equal(await orderOf(), null, 'пятое нажатие снимает приказ');
    assert.equal(
      await page.evaluate(() =>
        document.querySelector('#cmdbar [data-cmd="qretr"]').className.includes('on'),
      ),
      false,
      'снятый приказ гасит подсветку',
    );

    // Снимок ряда — по требованию (`RETREAT_SHOT=путь.png`). По умолчанию тест артефактов
    // не пишет: смотреть глазами нужно, когда правишь вид кнопки, а не на каждом прогоне.
    if (process.env.RETREAT_SHOT) {
      await retr.click(); // вернуть приказ, чтобы на снимке была подсвеченная кнопка
      await page.locator('#cmdbar').screenshot({ path: process.env.RETREAT_SHOT });
    }

    assert.deepEqual(errors, [], 'страница не выбросила исключений');
  });
  console.log('\n✓ retreat smoke: кнопка авто-отхода видна, обходит 20/30/40/50 и снимается\n');
} finally {
  await browser.close();
  await site.close();
}
