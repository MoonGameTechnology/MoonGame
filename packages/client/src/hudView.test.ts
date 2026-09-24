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
  worldHtml,
  splitHtml,
  mergeHtml,
} from './hudView';
import { t, tData } from '../../../localization/core';
import { displayUnit } from '../../../decisions/dataNames';
import type {
  BattleModel,
  FleetSelectionModel,
  SplitModel,
  StatusBarModel,
  WorldModel,
} from './matchHud';
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

const side = (mine: boolean, role: 'attacker' | 'defender' = 'attacker'): BattleModel['attacker'] => ({
  owner: mine ? 'p1' : 'p2',
  ownerName: mine ? 'Ash' : 'Borz',
  ownerFaction: 'vanguard',
  kind: 'fleet',
  units: [{ unit: 'scout_drone', count: 2 }],
  mine,
  role,
});

const battle: BattleModel = {
  kind: 'battle',
  id: 'b1',
  location: 'alpha',
  phase: 'orbital',
  round: 3,
  sides: [side(true, 'attacker'), side(false, 'defender')],
  attacker: side(true, 'attacker'),
  defender: side(false, 'defender'),
};

describe('панель боя', () => {
  it('кнопки «Отступить» НЕТ, когда отступать нечем', () => {
    // Модель не нашла своего орбитального флота — резолвер всё равно откажет
    // (`E_CANNOT_RETREAT`), и живая на вид кнопка обещала бы несуществующее действие.
    expect(battleHtml(battle, 0)).not.toContain('data-act="retreat"');
  });

  it('надбавка за пережитые бои показана и здесь, тем же решением (PERK-3.3)', () => {
    // Паритет клиентов: медали VET-5 остались в прототипе и до клиента не доехали —
    // повторять этот долг не надо. Решение одно (`/decisions/veteranBadge.ts`), значит
    // и число, и подпись у обоих клиентов совпадают по построению.
    const vet: BattleModel = {
      ...battle,
      sides: [{ ...side(true, 'attacker'), veteran: 1.16 }, side(false, 'defender')],
    };
    const html = battleHtml(vet, 0);
    expect(html).toContain('+16%');
    expect(html).toContain(t('battle.win.veteran', { n: 16 }));
    // У стороны без выслуги — ни символа лишнего.
    expect(battleHtml(battle, 0)).not.toContain('class="vet"');
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

describe('приказы в панели состава (MIG-7)', () => {
  it('у ЧУЖОГО флота приказов нет вовсе — панель остаётся осмотром', () => {
    expect(selectionHtml({ ...fleet, mine: false }, 0)).not.toContain('class="orders"');
  });

  it('в бою панель состава приказов не предлагает — там распоряжается панель боя', () => {
    expect(selectionHtml({ ...fleet, inCombat: true }, 0)).not.toContain('class="orders"');
  });

  it('«Остановить» появляется только у идущего флота', () => {
    expect(selectionHtml(fleet, 0)).not.toContain('data-act="stop"');
    const moving = selectionHtml(
      { ...fleet, status: 'transit', location: undefined, transit: { from: 'a', to: 'b', destination: 'b', departedAt: 0, arrivesAt: 1 } },
      0,
    );
    expect(moving).toContain('data-act="stop"');
    expect(moving).toContain(t('hud.order.stop'));
  });

  it('форс-марш переключается подписью, иначе включённый нечем выключить', () => {
    expect(selectionHtml(fleet, 0)).toContain(t('hud.order.forcemarch-on'));
    expect(selectionHtml({ ...fleet, forcedMarch: true }, 0)).toContain(
      t('hud.order.forcemarch-off'),
    );
  });

  it('«Обстрел» предлагается только С ОРБИТЫ, а «прекратить» — когда уже стреляет', () => {
    // Без орбиты ядро ответит `E_WRONG_ORBIT`: живая кнопка обещала бы несуществующее.
    expect(selectionHtml(fleet, 0)).not.toContain('data-act="bombard"');
    expect(selectionHtml({ ...fleet, orbit: 'near' }, 0)).toContain(t('hud.order.bombard-on'));
    expect(selectionHtml({ ...fleet, orbit: 'near', bombarding: true }, 0)).toContain(
      t('hud.order.bombard-off'),
    );
  });

  it('«Штурм» есть у стоящего флота — годность спрашивают у ядра, а не у панели', () => {
    // Ни десанта, ни враждебности мира панель не знает: рукописная копия этих условий
    // отстала бы от ядра молча (`decisions/assaultOrder.ts`, правило 1).
    expect(selectionHtml(fleet, 0)).toContain('data-act="assault"');
    expect(selectionHtml({ ...fleet, status: 'transit', location: undefined }, 0)).not.toContain(
      'data-act="assault"',
    );
  });

  it('кнопки «На орбиту» НЕТ — решение владельца, флот встаёт на орбиту сам', () => {
    // Сторож против возврата: приказ в ядре есть и уходит внутри пары «орбита + штурм»,
    // но своего жеста у него быть не должно.
    for (const m of [fleet, { ...fleet, orbit: 'near' as const }, { ...fleet, status: 'transit' as const }])
      expect(selectionHtml(m, 0)).not.toContain('data-act="orbit"');
  });
});

describe('панель мира (MIG-8)', () => {
  const WORLD_DATA = {
    buildings: { mine_t1: { name: 'Metal Mine' } },
  } as unknown as Parameters<typeof worldHtml>[1];
  const w = (over: Partial<WorldModel> = {}): WorldModel => ({
    kind: 'world',
    id: 'alpha',
    owner: 'p1',
    ownerName: 'Ash',
    ownerFaction: 'vanguard',
    mine: true,
    garrison: [],
    buildings: [],
    remembered: false,
    capital: 'none',
    hold: 'none',
    ...over,
  });

  it('ничей мир назван словом, а не пустым владельцем', () => {
    expect(worldHtml(w({ owner: null, ownerName: undefined }), WORLD_DATA)).toContain(t('hud.world.nobody'));
  });

  it('на ЧУЖОМ мире ряда приказов нет вовсе', () => {
    // Оба приказа — распоряжения владельца; ядро ответит `E_FORBIDDEN`.
    expect(worldHtml(w({ mine: false }), WORLD_DATA)).not.toContain('class="orders"');
  });

  it('столица: кнопка или метка, но не обе', () => {
    const designate = worldHtml(w({ capital: 'designate' }), WORLD_DATA);
    expect(designate).toContain('data-act="capital"');
    expect(designate).not.toContain(t('hud.world.capital'));
    const marked = worldHtml(w({ capital: 'marked' }), WORLD_DATA);
    expect(marked).toContain(t('hud.world.capital'));
    expect(marked).not.toContain('data-act="capital"');
  });

  it('исчерпанный лимит ГАСИТ кнопку, но не прячет её', () => {
    // Прятать нельзя: игрок должен видеть, что механика есть и упёрлась в лимит.
    expect(worldHtml(w({ hold: 'set-disabled' }), WORLD_DATA)).toMatch(/data-act="hold"[^>]*disabled/);
    expect(worldHtml(w({ hold: 'set' }), WORLD_DATA)).not.toMatch(/data-act="hold"[^>]*disabled/);
  });

  it('без техгейта точки удержания НЕТ ни в каком виде', () => {
    expect(worldHtml(w({ hold: 'none' }), WORLD_DATA)).not.toContain('data-act="hold"');
  });

  it('снятая точка шлёт on=0, поставленная — on=1', () => {
    expect(worldHtml(w({ hold: 'clear' }), WORLD_DATA)).toContain('data-on="0"');
    expect(worldHtml(w({ hold: 'set' }), WORLD_DATA)).toContain('data-on="1"');
  });

  it('мир из ПАМЯТИ помечен словами', () => {
    // Иначе панель выдаёт протухший снимок за наблюдение: гарнизон, которого игрок
    // не видел, читался бы как текущий.
    expect(worldHtml(w({ remembered: true }), WORLD_DATA)).toContain(t('hud.world.remembered'));
    expect(worldHtml(w(), WORLD_DATA)).not.toContain(t('hud.world.remembered'));
  });

  it('постройка подписана ИМЕНЕМ из каталога, а не сырым id', () => {
    // Поймано браузерным прогоном: панель показывала `mine_t1` вместо «Рудник».
    // Правило общее — `decisions/dataNames.buildingName`.
    const html = worldHtml(w({ buildings: [{ type: 'mine_t1', level: 2 }] }), WORLD_DATA);
    expect(html).toContain(tData('Metal Mine'));
    expect(html).not.toContain('mine_t1');
  });

  it('постройка без записи в каталоге подписывается своим id, а не пропадает', () => {
    // Запасной путь `buildingName`: неизвестное здание должно быть ВИДНО игроку.
    expect(worldHtml(w({ buildings: [{ type: 'нечто', level: 1 }] }), WORLD_DATA)).toContain(
      tData('нечто'),
    );
  });

  it('пустой гарнизон сказан словом, а не пропущен молча', () => {
    expect(worldHtml(w(), WORLD_DATA)).toContain(t('hud.world.no-garrison'));
  });
});

describe('деление и слияние (MIG-9)', () => {
  const sp = (over: Partial<SplitModel> = {}): SplitModel => ({
    kind: 'split',
    fleetId: 'f1',
    rows: [{ key: 'ship:frigate|', unit: 'frigate', have: 3, kind: 'ship', take: 1 }],
    takeTotal: 1,
    total: 3,
    cargo: { takenUsed: 0, takenCapacity: 0, keptUsed: 0, keptCapacity: 0, fits: true },
    canConfirm: true,
    ...over,
  });

  it('«Разделить» гаснет, когда отбор не годится', () => {
    // Ноль и «всё» — не деление; кнопка, которую сервер отвергнет, тратит ход игрока.
    expect(splitHtml(sp({ canConfirm: false }))).toMatch(/data-act="split-go"[^>]*disabled/);
    expect(splitHtml(sp())).not.toMatch(/data-act="split-go"[^>]*disabled/);
  });

  it('у строки есть все три шага счётчика и её собственный адрес', () => {
    const html = splitHtml(sp());
    for (const step of ['dec', 'inc', 'all'])
      expect(html).toContain(`data-step="${step}"`);
    expect(html).toContain('data-key="ship:frigate|"');
  });

  it('из окна ВСЕГДА есть выход, даже когда подтвердить нельзя', () => {
    expect(splitHtml(sp({ canConfirm: false }))).toContain('data-act="close"');
  });

  it('трюм показан только когда он есть, и отмечен, когда не сходится', () => {
    expect(splitHtml(sp())).not.toContain(t('hud.split.hold', { taken: '0/0', kept: '0/0' }));
    const tight = splitHtml(
      sp({ cargo: { takenUsed: 3, takenCapacity: 1, keptUsed: 0, keptCapacity: 2, fits: false } }),
    );
    expect(tight).toContain('class="memory"'); // тот же приём, что у памяти тумана: это предупреждение
  });

  it('слияние: кнопки нет, когда сливать не с кем', () => {
    expect(mergeHtml([])).toBe('');
    const html = mergeHtml([{ id: 'f2', ships: 4 }]);
    expect(html).toContain('data-act="merge"');
    expect(html).toContain('data-fleet="f2"');
  });

  it('ряд слияния живёт ВНУТРИ панели состава, а не рядом с ней', () => {
    // Снаружи он ложился поверх статус-бара: кнопка видна, нажать нельзя. Сторож
    // против возврата — разметка панели обязана закрываться ПОСЛЕ кнопок слияния.
    const html = selectionHtml(fleet, 0, { merge: [{ id: 'f2', ships: 4 }] });
    expect(html).toContain('data-act="merge"');
    expect(html.indexOf('data-act="merge"')).toBeLessThan(html.lastIndexOf('</div>'));
    expect(html.endsWith('</div>')).toBe(true);
  });

  it('чужому флоту слияние не предлагают даже со списком кандидатов', () => {
    expect(
      selectionHtml({ ...fleet, mine: false }, 0, { merge: [{ id: 'f2', ships: 4 }] }),
    ).not.toContain('data-act="merge"');
  });
});
