/**
 * The HUD renderer (MIG-3) — asserted as markup, with no DOM and no browser.
 *
 * What is worth testing here is NOT the projections (`matchHud.test.ts` covers those with
 * 51 tests) but the decisions this half makes on top of them: what is DRAWN and what is
 * deliberately left out. A bar for a pool the model could not derive, a Retreat button for
 * a battle the player cannot retreat from, an enabled Build for an order they cannot pay —
 * each of those promises the player something that is not there, and each is cheap to
 * introduce and invisible until someone taps it.
 */
import { describe, expect, it } from 'vitest';
import {
  battleHtml,
  clockHM,
  countdown,
  esc,
  loadoutHtml,
  selectionHtml,
  statusBarHtml,
  unitPickerHtml,
} from './hudView';
import { t } from '../../../localization/core';
import { displayUnit } from '../../../decisions/dataNames';
import type { BattleModel, FleetSelectionModel, StatusBarModel } from './matchHud';
import type { LoadoutModel } from './loadoutEditor';

const bar: StatusBarModel = {
  commander: 'Ash',
  faction: 'vanguard',
  rank: 2,
  players: 4,
  day: 2,
  dayTimeMs: 3_600_000 * 5 + 60_000 * 7,
  resources: [
    { id: 'metal', amount: 120.6 },
    { id: 'food', amount: 0 },
  ],
  defeated: false,
};

const fleet: FleetSelectionModel = {
  kind: 'fleet',
  id: 'f1',
  owner: 'p1',
  ownerName: 'Ash',
  ownerFaction: 'vanguard',
  mine: true,
  status: 'stationed',
  location: 'alpha',
  ships: [{ unit: 'scout_drone', count: 3 }],
  inCombat: false,
};

describe('часы и отсчёт', () => {
  it('время суток печатается с ведущими нулями', () => {
    expect(clockHM(3_600_000 * 5 + 60_000 * 7)).toBe('05:07');
    expect(clockHM(0)).toBe('00:00');
  });

  it('отсчёт не уходит в минус, когда срок уже прошёл', () => {
    // Иначе игрок увидел бы «-1:23» и решил, что интерфейс сломан.
    expect(countdown(1000, 9999)).toBe('0:00');
    expect(countdown(95_000, 0)).toBe('1:35');
    expect(countdown(3_600_000 + 61_000, 0)).toBe('1:01:01');
  });
});

describe('статус-бар', () => {
  it('день показывается ОТ ЕДИНИЦЫ, хотя модель даёт 0-based', () => {
    // Модель считает день так же, как браузер матчей и dayGate; «День 0» игроку не бывает.
    expect(statusBarHtml(bar)).toContain(t('hud.day', { d: 3 }));
    expect(statusBarHtml(bar)).not.toContain(t('hud.day', { d: 2 }));
  });

  it('казна округляется и показывает даже нулевой ресурс', () => {
    const html = statusBarHtml(bar);
    expect(html).toContain('121'); // 120.6 → 121
    expect(html).toContain('rc-food'); // ноль тоже в строке: пропажа читалась бы как «нет ресурса»
  });

  it('поражение отмечено, а не молча выглядит как обычная игра', () => {
    expect(statusBarHtml({ ...bar, defeated: true })).toContain(t('hud.defeated'));
  });
});

describe('панель выделения', () => {
  it('без выведенных пулов полос НЕТ — пустая полоса утверждала бы ноль', () => {
    const html = selectionHtml(fleet, 0);
    expect(html).not.toContain('class="bar hull"');
    expect(html).not.toContain('class="bar shield"');
  });

  it('корпус рисуется, а щит — только при наличии ёмкости', () => {
    const withHull = selectionHtml({ ...fleet, hull: { current: 5, max: 10 } }, 0);
    expect(withHull).toContain('class="bar hull"');
    expect(withHull).toContain('5/10');
    expect(withHull).not.toContain('class="bar shield"');
  });

  it('в пути показывает цель и обратный отсчёт', () => {
    const html = selectionHtml(
      {
        ...fleet,
        status: 'transit',
        location: undefined,
        transit: { from: 'a', to: 'b', destination: 'beta', departedAt: 0, arrivesAt: 120_000 },
      },
      60_000,
    );
    expect(html).toContain('beta');
    expect(html).toContain('1:00');
  });

  it('состав подписан именем, а не id', () => {
    expect(selectionHtml(fleet, 0)).toContain(displayUnit('scout_drone'));
  });
});

const side = (mine: boolean): BattleModel['attacker'] => ({
  owner: mine ? 'p1' : 'p2',
  ownerName: mine ? 'Ash' : 'Borz',
  ownerFaction: 'vanguard',
  kind: 'fleet',
  units: [{ unit: 'scout_drone', count: 2 }],
  mine,
});

const battle: BattleModel = {
  kind: 'battle',
  id: 'b1',
  location: 'alpha',
  phase: 'orbital',
  round: 3,
  attacker: side(true),
  defender: side(false),
};

describe('панель боя', () => {
  it('кнопки «Отступить» НЕТ, когда отступать нечем', () => {
    // Модель не нашла своего орбитального флота — резолвер всё равно откажет
    // (`E_CANNOT_RETREAT`), и живая на вид кнопка обещала бы несуществующее действие.
    expect(battleHtml(battle, 0)).not.toContain('data-act="retreat"');
  });

  it('кнопка появляется ровно тогда, когда модель назвала флот', () => {
    expect(battleHtml({ ...battle, retreatFleetId: 'f1' }, 0)).toContain('data-act="retreat"');
  });

  it('фаза и раунд названы словами', () => {
    const html = battleHtml({ ...battle, phase: 'ground', nextRoundAt: 30_000 }, 0);
    expect(html).toContain(t('hud.phase.ground'));
    expect(html).toContain(t('hud.battle.round', { n: 3 }));
    expect(html).toContain('0:30');
  });
});

const loadout: LoadoutModel = {
  unit: 'cruiser',
  hasSlots: true,
  slots: [{ type: 'weapon' }, { type: 'defense', moduleId: 'plating', moduleName: 'Plating' }],
  modules: ['plating'],
  palette: [
    { id: 'railgun', name: 'Railgun', slot: 'weapon', tag: 'horizontal', effect: {}, cost: {}, installable: true },
    { id: 'plating', name: 'Plating', slot: 'defense', tag: 'vertical', effect: {}, cost: {}, installable: false, code: 'E_SLOT_FULL' },
  ],
  preview: [{ stat: 'attack', label: 'Атака', base: 4, effective: 6, delta: 2 }],
  hullCost: { metal: 10 },
  modulesCost: { metal: 5 },
  totalCost: { metal: 15 },
  count: 2,
  affordable: true,
};
const DATA = { units: { cruiser: {} } } as unknown as Parameters<typeof loadoutHtml>[1];

describe('оснащение корабля', () => {
  it('неустановимый модуль отключён и несёт причину', () => {
    const html = loadoutHtml(loadout, DATA);
    expect(html).toContain('data-module="railgun"');
    expect(html).toMatch(/data-module="plating"[^>]*disabled/);
    expect(html).toContain('E_SLOT_FULL');
  });

  it('занятый слот даёт кнопку СНЯТЬ, пустой — прочерк', () => {
    const html = loadoutHtml(loadout, DATA);
    expect(html).toContain('data-act="unequip"');
    expect(html).toContain('—');
  });

  it('неоплатный заказ не даёт нажать «Построить»', () => {
    // Сервер откажет всё равно; живая кнопка просто тратит ход игрока впустую.
    expect(loadoutHtml({ ...loadout, affordable: false }, DATA)).toMatch(
      /data-act="build"[^>]*disabled/,
    );
    expect(loadoutHtml(loadout, DATA)).not.toMatch(/data-act="build"[^>]*disabled/);
  });

  it('корпус без слотов говорит об этом, а не показывает пустой список', () => {
    const html = loadoutHtml({ ...loadout, hasSlots: false, slots: [] }, DATA);
    expect(html).toContain(t('hud.no-slots'));
  });

  it('из панели ВСЕГДА есть выход — даже когда «Построить» недоступно', () => {
    // Иначе неоплатный корпус запирает игрока: отменить нечем, выбрать другой нечем.
    expect(loadoutHtml({ ...loadout, affordable: false }, DATA)).toContain('data-act="close"');
  });

  it('прирост статов подписан знаком', () => {
    expect(loadoutHtml(loadout, DATA)).toContain('+2');
  });
});

describe('верфь', () => {
  it('пустой список не рисует панель вовсе', () => {
    expect(unitPickerHtml([], 'alpha')).toBe('');
  });

  it('корпуса подписаны именами и несут свой id в кнопке', () => {
    const html = unitPickerHtml(['scout_drone'], 'alpha');
    expect(html).toContain('data-unit="scout_drone"');
    expect(html).toContain(displayUnit('scout_drone'));
  });
});

describe('экранирование', () => {
  it('разметка из данных не уезжает в HTML', () => {
    expect(esc('<img src=x onerror=1>')).toBe('&lt;img src=x onerror=1&gt;');
    expect(statusBarHtml({ ...bar, commander: '<b>x</b>' })).toContain('&lt;b&gt;x&lt;/b&gt;');
  });
});
