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
  // Ручной отход: бой собирается прямо в мире — свой флот и чужой на соседнем узле, война,
  // «Атака». Ждать встречи на живой карте значило бы проверять ИИ, а не кнопку.
  stageBattle: () => {
    const mine = Object.values(s.fleets).find(f => f.owner === ME && f.location);
    const foe = Object.values(s.fleets).find(f => f.owner !== ME && f.units.length > 0);
    const home = mine.location;
    const away = (s.planets[home].links ?? [])[0];
    mine.location = away; mine.movement = null;
    foe.location = away; foe.movement = null; foe.battleId = null;
    s.diplomacy = { ...(s.diplomacy ?? {}), [[ME, foe.owner].sort().join('|')]: 'war' };
    playerOrder(engageFleet(ME, mine.id, foe.id));
    return { mine: mine.id, home, away, battle: s.fleets[mine.id]?.battleId ?? null };
  },
  openBattle: (id) => battleWindow.open(id),
  screen: (id) => world(s.planets[id].position),
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

    // Кнопка открывает окошко порогов (заказ владельца 2026-09-23): выбор ставит приказ
    // и закрывает окошко; «Выкл» снимает.
    const pick = async (at) => {
      await retr.click();
      const choice = page.locator(`#cmdbar .cmdpop-retr [data-cmd="retrset"][data-at="${at}"]`);
      await choice.waitFor({ state: 'visible' });
      await choice.click();
      assert.equal(await page.locator('#cmdbar .cmdpop-retr').count(), 0, 'выбор закрывает окошко');
    };
    for (const at of [0.2, 0.3, 0.4, 0.5]) {
      await pick(at);
      const order = await orderOf();
      assert(order, `после выбора приказ стоит (ждали порог ${at})`);
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
    // Текущий порог подсвечен в окошке.
    await retr.click();
    assert.equal(
      await page.locator('#cmdbar .cmdpop-retr [data-at="0.5"]').getAttribute('class'),
      'on',
      'в окошке подсвечен действующий порог',
    );
    await retr.click(); // повторное нажатие закрывает окошко без приказа
    assert.equal(await page.locator('#cmdbar .cmdpop-retr').count(), 0);
    assert.equal((await orderOf()).at, 0.5, 'закрытие окошка приказ не трогает');
    await pick(0);
    assert.equal(await orderOf(), null, '«Выкл» снимает приказ');
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
      await retr.click(); // открыть окошко — на снимке видны пороги
      await page.screenshot({ path: process.env.RETREAT_SHOT });
    }

    // РУЧНОЙ ОТХОД (аудит механик 2026-09-25, решение владельца): «Отступить» в окне боя
    // взводит прицел, окно уступает карту, тап по миру — точка отхода. До этого кнопка
    // слала приказ без точки, и флот оставался под огнём на том же узле.
    const staged = await page.evaluate(() => window.__retreatTest.stageBattle());
    assert(staged.battle, `бой собран (${JSON.stringify(staged)})`);
    await page.evaluate((id) => window.__retreatTest.openBattle(id), staged.battle);
    const retreatBtn = page.locator(`#battlewin [data-battle-retreat="${staged.mine}"]`);
    await retreatBtn.waitFor({ state: 'visible' });
    await retreatBtn.click();
    assert.equal(
      await page.evaluate(() => document.getElementById('battlewin').classList.contains('show')),
      false,
      'окно боя уступает карту прицелу',
    );
    const fleetNow = () =>
      page.evaluate((id) => {
        const f = window.__retreatTest.state().fleets[id];
        return f ? { battle: f.battleId ?? null, to: f.movement?.destination ?? f.movement?.to ?? null } : null;
      }, staged.mine);
    assert.equal((await fleetNow()).battle, staged.battle, 'пока точка не выбрана, флот в бою');
    const home = await page.evaluate((id) => window.__retreatTest.screen(id), staged.home);
    await page.mouse.click(home.x, home.y);
    const after = await fleetNow();
    assert(after, 'флот пережил отход');
    assert.equal(after.battle, null, 'флот вышел из боя');
    assert.equal(after.to, staged.home, 'флот идёт в выбранную точку');

    assert.deepEqual(errors, [], 'страница не выбросила исключений');
  });
  console.log(
    '\n✓ retreat smoke: авто-отход — окошко 20/30/40/50/Выкл ставит и снимает приказ; «Отступить» в бою — выбор точки на карте уводит флот\n',
  );
} finally {
  await browser.close();
  await site.close();
}
