import { describe, it, expect, beforeAll } from 'vitest';
import { setLocale, t, tData } from '../../localization/runtime';
import { ru } from '../../localization/ru';
import { en } from '../../localization/en';
import { newGame, canOrder, order as applyOrder, HOUR } from './game';
import { cost as priceHtml, fmtDur, fmtEta, displayUnit } from './format';
import { buildShip } from '../../decisions/actions';
import { data } from './gameData';
import { worldName } from './planetName';
import type { Action, ArsenalItem, GameState } from '../../packages/shared-core/src/index';
import {
  bagText,
  statBarHtml,
  originTagHtml,
  ownedHullsOf,
  normalizeDraft,
  loadoutPaneHtml,
  orderBarHtml,
  unitLaneAhead,
  yardBoxHtml,
  initShipyard,
  YARD_HULLS,
  YARD_SQUAD_HULLS,
  YARD_GROUND_HULLS,
  groundHullsOf,
  hullsOfTab,
  buildSites,
  RES_KEY,
  STAT_KEY,
  selectedBay,
  repeatOrderHtml,
  moduleGradeHtml,
  type YardDraft,
  type YardHost,
} from './shipyard';

// REFM-13: locale pinned RU (see format.test.ts — Node has no browser language, so the
// runtime would fall back to EN and the label assertions would drift).
beforeAll(() => setLocale('ru'));

/** A match where p1 can actually order hulls: full coffers on the homeworld. */
function rich(): GameState {
  const s = newGame();
  s.players.p1!.resources = {
    ...s.players.p1!.resources,
    metal: 9000,
    credits: 9000,
    energy: 9000,
    food: 9000,
    microelectronics: 9000,
  };
  return s;
}

function draftOf(over: Partial<YardDraft> = {}): YardDraft {
  return { hull: 'cruiser', modules: [], count: 1, planet: '', ...over };
}

const view = { youColor: '#0ff', arsenalItems: [] as readonly ArsenalItem[] };

/** Node has no DOM — the window only paints innerHTML, toggles a class and delegates
 *  clicks/changes, so a stand-in with those is the whole contract. */
function fakeWin(): HTMLElement & {
  html: () => string;
  fire: (target: unknown) => void;
  change: (target: unknown) => void;
  shown: () => boolean;
} {
  const handlers: Record<string, ((ev: unknown) => void) | undefined> = {};
  const classes = new Set<string>();
  const el = {
    innerHTML: '',
    querySelector: () => null,
    classList: {
      add: (c: string) => classes.add(c),
      remove: (c: string) => classes.delete(c),
      contains: (c: string) => classes.has(c),
    },
    addEventListener: (type: string, h: (ev: unknown) => void) => {
      handlers[type] = h;
    },
    html: () => el.innerHTML,
    fire: (target: unknown) => handlers.click?.({ target }),
    change: (target: unknown) => handlers.change?.({ target }),
    shown: () => classes.has('show'),
  };
  return el as unknown as HTMLElement & {
    html: () => string;
    fire: (t: unknown) => void;
    change: (t: unknown) => void;
    shown: () => boolean;
  };
}

/** A click whose `closest(sel)` answers only for the selector we mean to hit. */
function click(sel: string, dataset: Record<string, string> = {}): unknown {
  return { closest: (q: string) => (q === sel ? { dataset } : null) };
}

/** Имена модулей, надетых в отсеки, — по строкам отсеков под карточкой корпуса. */
function worn(html: string): string[] {
  return [...html.matchAll(/class="cn-bay filled[^"]*" data-cnsel="\d+">.*?class="cn-bn">([^<]+)/g)].map((x) => x[1]!);
}

function hostOf(over: Partial<YardHost> = {}): YardHost {
  return {
    root: () => fakeWin(),
    state: () => rich(),
    me: () => 'p1',
    youColor: () => '#0ff',
    order: () => {},
    note: () => {},
    errText: (code) => code,
    arsenalItems: () => [],
    onOpen: () => {},
    heroPaneHtml: () => '<div id="herobody">штаб</div>',
    onHeroTab: () => {},
    heroClick: () => null,
    ...over,
  };
}

describe('верфь — цена и полоса характеристики', () => {
  it('цена читается ресурсами, нули не показываются', () => {
    const text = bagText({ metal: 120, credits: 0, energy: 40 });
    expect(text).toContain('120');
    expect(text).toContain('40');
    // нулевой ресурс не занимает место в ценнике — его подписи там нет
    expect(text).not.toContain(bagText({ credits: 1 }).replace('1 ', ''));
  });

  it('пустая цена — «бесплатно» ключом, а не пустая строка', () => {
    expect(bagText({})).toBe(bagText({ metal: 0 }));
    expect(bagText({})).not.toBe('');
  });

  it('прирост от модулей виден как база → итог с дельтой', () => {
    const html = statBarHtml(
      { stat: 'attack', label: 'атака', base: 10, effective: 14, delta: 4 },
      20,
    );
    expect(html).toContain('10');
    expect(html).toContain('<b>14</b>');
    expect(html).toContain('+4');
  });

  it('дробный прирост от звёзд модуля — до десятых', () => {
    const html = statBarHtml({ stat: 'attack', label: 'атака', base: 16, effective: 21.4, delta: 21.4 - 16 }, 30);
    expect(html).toContain('<b>21.4</b>');
    expect(html).toContain('+5.4</span>');
  });

  it('без прироста показывается только итог — без стрелки', () => {
    const html = statBarHtml(
      { stat: 'hp', label: 'корпус', base: 30, effective: 30, delta: 0 },
      30,
    );
    expect(html).toContain('<b>30</b>');
    expect(html).not.toContain('→');
  });

  it('дельта не выталкивает полосу за 100% — база и прирост делят трек', () => {
    const html = statBarHtml(
      { stat: 'attack', label: 'атака', base: 8, effective: 20, delta: 12 },
      10,
    );
    const widths = [...html.matchAll(/width:([\d.]+)%/g)].map((m) => Number(m[1]));
    expect(widths[0]! + widths[1]!).toBeLessThanOrEqual(100);
  });

  it('подпись характеристики экранируется — она уходит в innerHTML (CWE-79)', () => {
    const html = statBarHtml(
      { stat: 'attack', label: '<img src=x onerror=alert(1)>', base: 1, effective: 1, delta: 0 },
      1,
    );
    expect(html).toContain('&lt;img');
    expect(html).not.toContain('<img src=x');
  });
});

describe('верфь — метка «откуда» (LARS-4)', () => {
  const item = (defId: string, origin: ArsenalItem['origin']): ArsenalItem => ({
    itemId: `i-${defId}`,
    kind: 'module',
    form: 'blueprint',
    defId,
    soulbound: false,
    origin,
    acquiredAt: 0,
  });

  it('добыча помечается', () => {
    expect(originTagHtml([item('ion_engine', 'drop')], 'ion_engine')).toContain('cn-mo');
  });

  it('стартовый набор не помечается — это не новость', () => {
    expect(originTagHtml([item('ion_engine', 'starter')], 'ion_engine')).toBe('');
  });

  it('нет данных арсенала — нет догадки', () => {
    expect(originTagHtml([], 'ion_engine')).toBe('');
  });
});

describe('верфь — что игроку разрешено строить (ARS-5)', () => {
  it('без снимка арсенала ограничений нет (обычный матч, боты)', () => {
    expect(ownedHullsOf(rich(), 'p1', YARD_HULLS)).toEqual(YARD_HULLS);
  });

  it('со снимком остаются только собственные корпуса', () => {
    const s = rich();
    s.players.p1!.arsenal = { hulls: ['scout'], modules: [] };
    expect(ownedHullsOf(s, 'p1', YARD_HULLS)).toEqual(['scout']);
  });

  it('ни одного своего корпуса — панель честно пустая, а не пустой конструктор', () => {
    const s = rich();
    s.players.p1!.arsenal = { hulls: [], modules: [] };
    expect(loadoutPaneHtml(s, 'p1', draftOf(), YARD_HULLS, view)).toContain('cn-soon');
  });
});

describe('верфь — черновик заказа', () => {
  it('чужой для вкладки корпус подменяется своим, а обвес сбрасывается', () => {
    const d = normalizeDraft(rich(), 'p1', draftOf({ modules: ['ion_engine'] }), YARD_SQUAD_HULLS);
    expect(YARD_SQUAD_HULLS).toContain(d.hull);
    expect(d.modules).toEqual([]);
  });

  it('свой корпус и его обвес переживают нормализацию', () => {
    const d = normalizeDraft(rich(), 'p1', draftOf({ modules: ['ion_engine'] }), YARD_HULLS);
    expect(d.hull).toBe('cruiser');
    expect(d.modules).toEqual(['ion_engine']);
  });

  it('мир заказа проставляется сам — первый свой строительный', () => {
    const d = normalizeDraft(rich(), 'p1', draftOf(), YARD_HULLS);
    expect(d.planet).not.toBe('');
    expect(rich().planets[d.planet]?.owner).toBe('p1');
  });

  it('потерянный мир не остаётся в заказе', () => {
    const s = rich();
    const d = normalizeDraft(s, 'p1', draftOf({ planet: 'нет-такого' }), YARD_HULLS);
    expect(d.planet).not.toBe('нет-такого');
  });

  it('нормализация не правит переданный черновик (он — значение)', () => {
    const src = draftOf({ modules: ['ion_engine'] });
    normalizeDraft(rich(), 'p1', src, YARD_SQUAD_HULLS);
    expect(src).toEqual(draftOf({ modules: ['ion_engine'] }));
  });
});

describe('верфь — панель конструктора', () => {
  const s = rich();

  it('корпус, слоты и палитра нарисованы', () => {
    const html = loadoutPaneHtml(
      s,
      'p1',
      normalizeDraft(s, 'p1', draftOf(), YARD_HULLS),
      YARD_HULLS,
      view,
    );
    expect(html).toContain('data-cnhull="cruiser"');
    expect(html).toContain('cn-bay');
    expect(html).toContain('data-cnmod=');
    // Заказ — не в прокручиваемом теле, а в полосе под ним (переделка окна, шаг 1).
    expect(html).not.toContain('data-cnbuild');
    const bar = orderBarHtml(s, 'p1', normalizeDraft(s, 'p1', draftOf(), YARD_HULLS), YARD_HULLS, view);
    expect(bar).toContain('data-cnbuild');
  });

  it('поставленный модуль занимает отсек, а снимается кнопкой в открытом отсеке', () => {
    const d = normalizeDraft(s, 'p1', draftOf({ modules: ['ion_engine'] }), YARD_HULLS);
    const html = loadoutPaneHtml(s, 'p1', d, YARD_HULLS, view);
    expect(worn(html)).toEqual([tData(data.modules.ion_engine!.name)]);
    expect(html).not.toContain('data-cnrm'); // открыт первый пустой отсек — оружие
    const open = loadoutPaneHtml(s, 'p1', { ...d, slot: 2 }, YARD_HULLS, view);
    expect(open).toContain(`data-cnrm="ion_engine">${t('yard.module.take-off')}<`);
  });

  // Радар — роль ОДНОГО корпуса. Правило живёт в данных (`allowed.units`), а верфь
  // обязана его честно объяснить: на крейсере утилита свободна, и подпись «нужен
  // слот» читалась бы как враньё.
  it('радар предлагается на дозорном фрегате и заперт с внятной причиной на остальных', () => {
    // Отсек системы открыт явно: по умолчанию открыт первый пустой, у обоих это не система.
    const picket = loadoutPaneHtml(
      s,
      'p1',
      normalizeDraft(s, 'p1', draftOf({ hull: 'picket_frigate', slot: 1 }), YARD_HULLS),
      YARD_HULLS,
      view,
    );
    expect(picket).toContain('data-cnmod="radar_module"');

    const cruiser = loadoutPaneHtml(
      s,
      'p1',
      normalizeDraft(s, 'p1', draftOf({ hull: 'cruiser', slot: 2, unfit: true }), YARD_HULLS),
      YARD_HULLS,
      view,
    );
    expect(cruiser).not.toContain('data-cnmod="radar_module"'); // поставить нельзя…
    const at = cruiser.indexOf('cn-mod locked');
    expect(cruiser.slice(at, at + 400)).toContain('не для этого корпуса'); // …и сказано почему
  });

  // Заказ владельца 2026-09-26: модули группами по типу отсека, а не вперемешку каталогом.
  // С шага 3 открыт один отсек: универсальному годится любой модуль — группами по типу.
  it('модули универсального отсека — группами по типу, запертые для корпуса в конце', () => {
    const html = loadoutPaneHtml(
      s,
      'p1',
      normalizeDraft(s, 'p1', draftOf({ hull: 'heavy_cruiser', unfit: true }), YARD_HULLS),
      YARD_HULLS,
      view,
    );
    const pal = html.slice(html.indexOf('class="cn-pal"'));
    const heads = [...pal.matchAll(/class="cn-pg" data-slot="[a-z]+"><span aria-hidden="true">[^<]*<\/span> ([^<]+)</g)].map((x) => x[1]);
    expect(heads).toEqual(['Оружие', 'Защита', 'Система']);
    // Щиты пустоты — только для пушек крепости: легендарный щит не заслоняет броню крейсера.
    expect(pal.indexOf('data-cnmod="ablative_plating"')).toBeGreaterThan(0);
    expect(pal.indexOf('data-cnmod="ablative_plating"')).toBeLessThan(pal.indexOf('🔰'));
    expect(pal.indexOf('data-cnunfit')).toBeLessThan(pal.indexOf('🔰'));
    // Каждый модуль — в группе своего отсека: система после заголовка «Система».
    expect(pal.indexOf('data-cnmod="cargo_bay"')).toBeGreaterThan(pal.indexOf('> Система<'));
  });

  // ROS-1.2: фрегат — корабль ПОДДЕРЖКИ, и его ценность в навеске. Панель обязана
  // показать все четыре отсека: один защитный и три под системы.
  it('фрегат есть в списке верфи и несёт САМУЮ ШИРОКУЮ навеску — четыре отсека', () => {
    expect(YARD_HULLS).toContain('frigate');
    const html = loadoutPaneHtml(
      s,
      'p1',
      normalizeDraft(s, 'p1', draftOf({ hull: 'frigate' }), YARD_HULLS),
      YARD_HULLS,
      view,
    );
    expect((html.match(/class="cn-bay/g) ?? []).length).toBe(4);
  });

  // Решение владельца 2026-09-26: «усиленный крейсер, 4 слота под модули любые».
  // Отсеки универсальные — подпись это говорит, и модули разных типов встают рядом.
  it('усиленный крейсер есть в списке верфи: четыре универсальных отсека под любые модули', () => {
    expect(YARD_HULLS).toContain('heavy_cruiser');
    const mods = ['targeting_array', 'shield_booster', 'ablative_plating'];
    const d = normalizeDraft(s, 'p1', draftOf({ hull: 'heavy_cruiser', modules: mods }), YARD_HULLS);
    expect(d.modules).toEqual(mods);
    const html = loadoutPaneHtml(s, 'p1', d, YARD_HULLS, view);
    expect((html.match(/class="cn-bay/g) ?? []).length).toBe(4);
    expect((html.match(new RegExp(t('yard.slot.universal'), 'g')) ?? []).length).toBeGreaterThanOrEqual(4);
    expect(worn(html).sort()).toEqual(mods.map((id) => tData(data.modules[id]!.name)).sort());
  });

  it('пустая казна гасит кнопку заказа, а не позволяет отправить отказ', () => {
    const broke = rich();
    broke.players.p1!.resources = { metal: 0, credits: 0, energy: 0, food: 0, microelectronics: 0 };
    const d = normalizeDraft(broke, 'p1', draftOf(), YARD_HULLS);
    const html = orderBarHtml(broke, 'p1', d, YARD_HULLS, view);
    expect(html).toMatch(/data-cnbuild disabled/);
    // …и цена говорит, чего не хватает, а не просто серая кнопка.
    expect(html).toContain('rcost');
    expect(html).toContain('class="lack"');
  });

  it('НЕТ ПОДХОДЯЩЕГО МЕСТА — ВМЕСТО СЕЛЕКТОРА НАДПИСЬ, а не пустой выпадающий список', () => {
    // ROS-3.1, заказ владельца: пустой селектор игрок читает как «сейчас загрузится»
    // и жмёт кнопку, которой нечего отправить. Отказ должен быть виден до нажатия.
    const homeless = rich();
    for (const p of Object.values(homeless.planets)) if (p.owner === 'p1') p.owner = null;
    const d = normalizeDraft(homeless, 'p1', draftOf(), YARD_HULLS);
    const html = orderBarHtml(homeless, 'p1', d, YARD_HULLS, view);
    expect(html).toContain('cn-noplace');
    expect(html).toContain(t('yard.no-place'));
    expect(html).not.toContain('id="cn-planet"');
    expect(html).toMatch(/data-cnbuild disabled/);
  });

  it('цена в полосе заказа — корпус с модулями на всё число машин, значками', () => {
    const res = s.players.p1!.resources;
    const bare = orderBarHtml(s, 'p1', normalizeDraft(s, 'p1', draftOf(), YARD_HULLS), YARD_HULLS, view);
    expect(bare).toContain(priceHtml(data.units.cruiser!.cost, res));
    const d = normalizeDraft(s, 'p1', draftOf({ modules: ['ion_engine'], count: 2 }), YARD_HULLS);
    const total: Record<string, number> = {};
    for (const bag of [data.units.cruiser!.cost, data.modules.ion_engine!.cost])
      for (const [r, n] of Object.entries(bag)) total[r] = (total[r] ?? 0) + n * 2;
    expect(orderBarHtml(s, 'p1', d, YARD_HULLS, view)).toContain(priceHtml(total, res));
  });

  it('срок постройки виден до заказа и не зависит от числа машин', () => {
    const one = orderBarHtml(s, 'p1', normalizeDraft(s, 'p1', draftOf(), YARD_HULLS), YARD_HULLS, view);
    const five = orderBarHtml(s, 'p1', normalizeDraft(s, 'p1', draftOf({ count: 5 }), YARD_HULLS), YARD_HULLS, view);
    const hours = fmtDur(data.units.cruiser!.buildTimeHours);
    expect(one).toContain(`⏱ ${hours}`);
    expect(five).toContain(`⏱ ${hours}`);
  });

  it('шаг количества упирается в границы — «−» на единице выключен', () => {
    const one = orderBarHtml(
      s,
      'p1',
      normalizeDraft(s, 'p1', draftOf(), YARD_HULLS),
      YARD_HULLS,
      view,
    );
    expect(one).toContain('data-cncount="-" disabled');
    const many = orderBarHtml(
      s,
      'p1',
      normalizeDraft(s, 'p1', draftOf({ count: 20 }), YARD_HULLS),
      YARD_HULLS,
      view,
    );
    expect(many).toContain('data-cncount="+" disabled');
  });

  it('снимок арсенала добавляет честную оговорку про сроки', () => {
    const gated = rich();
    gated.players.p1!.arsenal = { hulls: ['cruiser'], modules: ['ion_engine'] };
    const html = loadoutPaneHtml(gated, 'p1', draftOf(), YARD_HULLS, view);
    expect(html).toContain(`<div class="cn-note">${t('yard.arsenal.note')}</div>`);
    expect(loadoutPaneHtml(rich(), 'p1', draftOf(), YARD_HULLS, view)).not.toContain('cn-note');
  });
});

describe('верфь — окно', () => {
  it('открытая вкладка подсвечена, каркас на месте', () => {
    const html = yardBoxHtml('squads', '<i>тело</i>');
    expect(html).toContain('<button class="cn-tab on" data-ctab="squads">');
    expect(html).toContain('<div id="constructorbody"><i>тело</i></div>');
  });

  it('полоса заказа стоит ПОД прокруткой окна, а не в её конце', () => {
    const html = yardBoxHtml('ships', '<i>тело</i>', '<div class="cn-order">заказ</div>');
    expect(html).toContain('<div id="constructorbody"><i>тело</i></div><div class="cn-order">заказ</div>');
    const win = fakeWin();
    initShipyard(hostOf({ root: () => win })).open();
    const out = win.html();
    expect(out.indexOf('class="cn-order"')).toBeGreaterThan(out.indexOf('id="constructorbody"'));
    expect(out).toMatch(/<\/div><div class="cn-order">[\s\S]*data-cnbuild[\s\S]*<\/div><\/div>$/);
  });

  it('open() показывает окно, красит и дёргает интро один раз', () => {
    const win = fakeWin();
    let intros = 0;
    const yard = initShipyard(hostOf({ root: () => win, onOpen: () => intros++ }));
    expect(win.shown()).toBe(false);
    yard.open();
    expect(win.shown()).toBe(true);
    expect(win.html()).toContain('cnbox');
    expect(intros).toBe(1);
  });

  it('крестик закрывает окно', () => {
    const win = fakeWin();
    const yard = initShipyard(hostOf({ root: () => win }));
    yard.open();
    win.fire(click('.cn-close'));
    expect(win.shown()).toBe(false);
  });

  it('вкладка «Герои» отдаёт разметку хозяину и один раз показывает его интро', () => {
    const win = fakeWin();
    let heroIntros = 0;
    const yard = initShipyard(hostOf({ root: () => win, onHeroTab: () => heroIntros++ }));
    yard.open();
    win.fire(click('.cn-tab', { ctab: 'heroes' }));
    expect(win.html()).toContain('id="herobody"');
    expect(heroIntros).toBe(1);
  });

  it('смена вкладки на «Эскадрильи» переводит конструктор на её корпуса', () => {
    const win = fakeWin();
    const yard = initShipyard(hostOf({ root: () => win }));
    yard.open();
    expect(win.html()).toContain('data-cnhull="cruiser"');
    win.fire(click('.cn-tab', { ctab: 'squads' }));
    expect(win.html()).not.toContain('data-cnhull="cruiser"');
    expect(win.html()).toContain(`data-cnhull="${YARD_SQUAD_HULLS[0]}"`);
  });

  it('смена корпуса сбрасывает обвес — слоты у корпусов разные', () => {
    const win = fakeWin();
    const yard = initShipyard(hostOf({ root: () => win }));
    yard.open();
    win.fire(click('.cn-mod', { cnmod: 'ion_engine' }));
    expect(worn(win.html())).toEqual([tData(data.modules.ion_engine!.name)]);
    win.fire(click('.cn-hbtn', { cnhull: 'scout' }));
    expect(worn(win.html())).toEqual([]);
  });

  it('модуль ставится кликом, а снимается кнопкой «Снять» открытого отсека', () => {
    const win = fakeWin();
    const yard = initShipyard(hostOf({ root: () => win }));
    yard.open();
    win.fire(click('.cn-mod', { cnmod: 'ion_engine' }));
    expect(worn(win.html())).toEqual([tData(data.modules.ion_engine!.name)]);
    win.fire(click('[data-cnsel]', { cnsel: '2' }));
    expect(win.html()).toContain('data-cnrm="ion_engine"');
    win.fire(click('[data-cnrm]', { cnrm: 'ion_engine' }));
    expect(worn(win.html())).toEqual([]);
  });

  it('отказ ядра доезжает до игрока текстом кода, а не молча', () => {
    const win = fakeWin();
    const s = rich();
    // корпус со снимком арсенала, где модуля НЕТ — ядро откажет по стабильному коду
    s.players.p1!.arsenal = { hulls: ['cruiser'], modules: [] };
    const notes: string[] = [];
    const yard = initShipyard(
      hostOf({ root: () => win, state: () => s, note: (m) => notes.push(m) }),
    );
    yard.open();
    win.fire(click('.cn-mod', { cnmod: 'ion_engine' }));
    expect(notes.length).toBe(1);
    expect(notes[0]).toMatch(/^✖ E_/);
    expect(worn(win.html())).toEqual([]);
  });

  it('счётчик не выходит за границы кликами', () => {
    const win = fakeWin();
    const yard = initShipyard(hostOf({ root: () => win }));
    yard.open();
    win.fire(click('[data-cncount]', { cncount: '-' }));
    expect(win.html()).toContain('<span class="cn-sv">1</span>');
    for (let i = 0; i < 25; i++) win.fire(click('[data-cncount]', { cncount: '+' }));
    expect(win.html()).toContain('<span class="cn-sv">20</span>');
  });

  it('заказ уходит в ядро выбранными корпусом, числом, обвесом и миром', () => {
    const win = fakeWin();
    const sent: Action[] = [];
    const yard = initShipyard(hostOf({ root: () => win, order: (a) => sent.push(a) }));
    yard.open();
    win.fire(click('.cn-mod', { cnmod: 'ion_engine' }));
    win.fire(click('[data-cncount]', { cncount: '+' }));
    win.fire(click('[data-cnbuild]'));
    expect(sent.length).toBe(1);
    const payload = sent[0]!.payload as Record<string, unknown>;
    expect(sent[0]!.type).toBe('unit.build');
    expect(payload.unit).toBe('cruiser');
    expect(payload.count).toBe(2);
    expect(payload.modules).toEqual(['ion_engine']);
    expect(payload.planetId).toBeTruthy();
  });

  it('после заказа полоса показывает очередь мира уже с ним', () => {
    const win = fakeWin();
    let s = rich();
    const yard = initShipyard(
      hostOf({
        root: () => win,
        state: () => s,
        order: (a) => {
          s = applyOrder(s, a, s.time).state;
        },
      }),
    );
    yard.open();
    expect(win.html()).toContain(t('yard.queue.now'));
    win.fire(click('[data-cnbuild]'));
    expect(win.html()).not.toContain(t('yard.queue.now'));
    expect(win.html()).toContain(
      t('yard.queue.ahead', { n: 1, eta: fmtEta(data.units.cruiser!.buildTimeHours) }),
    );
  });

  it('без своего мира заказ не отправляется вовсе', () => {
    const win = fakeWin();
    const homeless = rich();
    for (const p of Object.values(homeless.planets)) if (p.owner === 'p1') p.owner = null;
    const sent: Action[] = [];
    const yard = initShipyard(
      hostOf({ root: () => win, state: () => homeless, order: (a) => sent.push(a) }),
    );
    yard.open();
    win.fire(click('[data-cnbuild]'));
    expect(sent).toEqual([]);
  });

  it('выбор мира в селекторе доезжает до заказа', () => {
    const win = fakeWin();
    const s = rich();
    const mine = Object.values(s.planets).filter((p) => p.owner === 'p1');
    const sent: Action[] = [];
    const yard = initShipyard(
      hostOf({ root: () => win, state: () => s, order: (a) => sent.push(a) }),
    );
    yard.open();
    // второй свой мир, если он есть; иначе первый — важен сам факт, что value доезжает
    const target = (mine[1] ?? mine[0])!.id;
    win.change({ id: 'cn-planet', value: target });
    win.fire(click('[data-cnbuild]'));
    expect((sent[0]!.payload as Record<string, unknown>).planetId).toBe(target);
  });

  it('клик героя уходит хозяину: «repaint» перекрашивает, «close» закрывает окно', () => {
    const win = fakeWin();
    let answer: 'repaint' | 'close' | null = 'repaint';
    let seen = 0;
    const yard = initShipyard(
      hostOf({
        root: () => win,
        heroClick: () => {
          seen++;
          return answer;
        },
      }),
    );
    yard.open();
    win.fire(click('[data-hsel]', { hsel: 'h1' }));
    expect(seen).toBe(1);
    expect(win.shown()).toBe(true);
    answer = 'close';
    win.fire(click('[data-hcast]', { hcast: 'h1' }));
    expect(win.shown()).toBe(false);
  });

  it('чужой клик хозяину не мешает — «нечего делать» ничего не ломает', () => {
    const win = fakeWin();
    const sent: Action[] = [];
    const yard = initShipyard(hostOf({ root: () => win, order: (a) => sent.push(a) }));
    yard.open();
    const before = win.html();
    win.fire(click('.cn-nothing'));
    expect(win.html()).toBe(before);
    expect(sent).toEqual([]);
  });
});

describe('ROS-0.2 + ROS-3.1 — «Производство»: пять типов с одного экрана', () => {
  /** Поставить зданию `type` на домашний мир p1 — так открывается производство рода. */
  function withBuilding(s: GameState, type: string): GameState {
    const home = Object.values(s.planets).find((p) => p.owner === 'p1');
    if (!home) throw new Error('нет домашнего мира');
    home.buildings = [...home.buildings, { type, level: 1, hp: data.buildings[type]!.hp }];
    return s;
  }

  it('ЭКРАН НАЗЫВАЕТСЯ ПРОИЗВОДСТВОМ, а здание остаётся верфью — это разные вещи', () => {
    expect(yardBoxHtml('ships', '')).toContain(t('yard.title'));
    expect(t('yard.title')).toBe('Производство');
    // Здание владелец не переименовывал: у него своё имя из данных.
    expect(tData(data.buildings.shipyard!.name)).toBe('Орбитальная верфь');
  });

  it('ПЯТЬ ВКЛАДОК В ПОРЯДКЕ ЗАКАЗА: Корабли · Челноки · Пехота · Техника · Герои', () => {
    const html = yardBoxHtml('ships', '');
    const order = ['yard.tab.ships', 'yard.tab.squads', 'yard.tab.infantry', 'yard.tab.vehicles', 'yard.tab.heroes']
      .map((k) => html.indexOf(t(k)));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it('РОД ВОЙСК РЕШАЮТ ДАННЫЕ, а не второй список: каждый наземный корпус ровно в одной вкладке', () => {
    const inf = groundHullsOf('infantry');
    const veh = groundHullsOf('vehicle');
    expect(inf).not.toEqual([]);
    expect(veh).not.toEqual([]);
    expect(inf.filter((id) => veh.includes(id))).toEqual([]);
    expect([...inf, ...veh].sort()).toEqual([...YARD_GROUND_HULLS].sort());
    for (const id of inf) expect(data.units[id]?.kind).toBe('infantry');
    for (const id of veh) expect(data.units[id]?.kind).toBe('vehicle');
  });

  it('десантный челнок (ROS-1.5) заказывается на вкладке «Челноки», а не потерялся', () => {
    expect(hullsOfTab('squads')).toContain('landing_shuttle');
  });

  it('МЕСТО ЗАКАЗА СПРАШИВАЕТСЯ У ЯДРА: без казарм пехоту заказать негде', () => {
    // YARD-1: стартовый мир несёт ВЕРФЬ, и только её. Корабль заложить можно; челнок,
    // пехота и техника ждут своего здания — порта, казарм, завода. Ровно так же ответит
    // и ядро: экран не держит второй копии этих правил.
    const s = rich();
    expect(buildSites(s, 'p1', 'cruiser').length).toBeGreaterThan(0);
    expect(buildSites(s, 'p1', 'interceptor')).toEqual([]);
    expect(buildSites(s, 'p1', 'militia')).toEqual([]);
    expect(buildSites(s, 'p1', 'tank')).toEqual([]);
  });

  it('построил космопорт — появилось место для челноков, но не для пехоты', () => {
    const s = withBuilding(rich(), 'spaceport');
    expect(buildSites(s, 'p1', 'interceptor').length).toBe(1);
    expect(buildSites(s, 'p1', 'militia')).toEqual([]);
  });

  it('построил казармы — появилось место для пехоты, но не для техники', () => {
    const s = withBuilding(rich(), 'barracks');
    expect(buildSites(s, 'p1', 'militia').length).toBe(1);
    expect(buildSites(s, 'p1', 'tank')).toEqual([]);
  });

  it('построил завод — появилось место для техники', () => {
    const s = withBuilding(rich(), 'factory');
    expect(buildSites(s, 'p1', 'tank').length).toBe(1);
  });

  it('«нет подходящего места» показывается ИМЕННО ТАМ, где род не производится', () => {
    const s = rich();
    const inf = normalizeDraft(s, 'p1', draftOf({ hull: 'militia' }), hullsOfTab('infantry'));
    const html = orderBarHtml(s, 'p1', inf, hullsOfTab('infantry'), view);
    expect(html).toContain(t('yard.no-place'));
    expect(html).toMatch(/data-cnbuild disabled/);
    // А на вкладке кораблей тот же экран показывает нормальный выбор мира.
    const ships = normalizeDraft(s, 'p1', draftOf(), YARD_HULLS);
    expect(orderBarHtml(s, 'p1', ships, YARD_HULLS, view)).toContain('id="cn-planet"');
  });

  it('мир в выборе места назван именем, как на карте, а не кодом (UIX-5.2)', () => {
    const s = rich();
    const d = normalizeDraft(s, 'p1', draftOf(), YARD_HULLS);
    const html = orderBarHtml(s, 'p1', d, YARD_HULLS, view);
    const option = new RegExp(`<option value="${d.planet}" selected>([^<]*)</option>`).exec(html);
    expect(option?.[1]).toBe(worldName(s, d.planet));
    expect(option?.[1]).not.toBe(d.planet);
  });

  it('смена вкладки на «Пехоту» переводит конструктор на её ростер и её мир', () => {
    const s = withBuilding(rich(), 'barracks');
    const win = fakeWin();
    const yard = initShipyard(hostOf({ root: () => win, state: () => s }));
    yard.open();
    win.fire(click('.cn-tab', { ctab: 'infantry' }));
    expect(win.html()).toContain(t('data.militia'));
    expect(win.html()).not.toContain(t('data.cruiser'));
  });

  it('заказ пехоты уходит в ядро с миром, где есть казармы', () => {
    const s = withBuilding(rich(), 'barracks');
    const home = Object.values(s.planets).find((p) => p.owner === 'p1')!.id;
    const sent: Action[] = [];
    const win = fakeWin();
    const yard = initShipyard(hostOf({ root: () => win, state: () => s, order: (a) => sent.push(a) }));
    yard.open();
    win.fire(click('.cn-tab', { ctab: 'infantry' }));
    win.fire(click('[data-cnbuild]'));
    expect(sent).toHaveLength(1);
    const p = sent[0]!.payload as { unit: string; planetId: string };
    expect(p.planetId).toBe(home);
    expect(data.units[p.unit]?.kind).toBe('infantry');
  });

  it('без казарм заказ пехоты не отправляется вовсе — кнопка не обещает лишнего', () => {
    const s = rich();
    const sent: Action[] = [];
    const win = fakeWin();
    const yard = initShipyard(hostOf({ root: () => win, state: () => s, order: (a) => sent.push(a) }));
    yard.open();
    win.fire(click('.cn-tab', { ctab: 'infantry' }));
    win.fire(click('[data-cnbuild]'));
    expect(sent).toEqual([]);
  });
});

describe('верфь — десантный челнок с бойцом (SHU-5.2)', () => {
  /** Мой мир с портом и казармами: боец требует своего цеха. */
  function withYards(): GameState {
    const s = rich();
    const home = Object.values(s.planets).find((p) => p.owner === 'p1' && p.buildings.length > 0)!;
    home.buildings = [
      ...home.buildings.filter((b) => b.type !== 'spaceport' && b.type !== 'barracks'),
      { type: 'spaceport', level: 1, hp: data.buildings.spaceport!.hp },
      { type: 'barracks', level: 1, hp: data.buildings.barracks!.hp },
    ];
    return s;
  }

  it('ЦЕНА — челнок ПЛЮС боец: бойца выбирают в окне, итог и срок — в полосе заказа', () => {
    const s = withYards();
    const d = normalizeDraft(s, 'p1', draftOf({ hull: 'landing_shuttle', troop: 'militia' }), YARD_SQUAD_HULLS);
    const lander = { ...view, troops: ['militia'] };
    expect(loadoutPaneHtml(s, 'p1', d, YARD_SQUAD_HULLS, lander)).toContain('id="cn-troop"');
    const total = { ...data.units.landing_shuttle!.cost };
    for (const [r, n] of Object.entries(data.units.militia!.cost)) total[r] = (total[r] ?? 0) + n;
    const bar = orderBarHtml(s, 'p1', d, YARD_SQUAD_HULLS, lander);
    expect(bar).toContain(priceHtml(total, s.players.p1!.resources));
    const hours = Math.max(data.units.landing_shuttle!.buildTimeHours, data.units.militia!.buildTimeHours);
    expect(bar).toContain(`⏱ ${fmtDur(hours)}`);
    expect(bar).not.toMatch(/data-cnbuild disabled/);
  });

  it('НЕКОГО ПОСАДИТЬ — заказать нельзя, и это сказано словами', () => {
    const s = withYards();
    const d = normalizeDraft(s, 'p1', draftOf({ hull: 'landing_shuttle' }), YARD_SQUAD_HULLS);
    const empty = { ...view, troops: [] };
    expect(loadoutPaneHtml(s, 'p1', d, YARD_SQUAD_HULLS, empty)).toContain(t('yard.troop.none'));
    expect(orderBarHtml(s, 'p1', d, YARD_SQUAD_HULLS, empty)).toMatch(/data-cnbuild disabled/);
  });

  it('заказ уходит с бойцом, которого приняло ядро, и проходит его', () => {
    const s = withYards();
    const orders: Action[] = [];
    const win = fakeWin();
    const yard = initShipyard(
      hostOf({ root: () => win, state: () => s, order: (a) => orders.push(a), probe: (a) => canOrder(s, a) }),
    );
    yard.open('squads');
    win.fire(click('.cn-hbtn', { cnhull: 'landing_shuttle' }));
    win.fire(click('[data-cnbuild]'));
    expect(orders).toHaveLength(1);
    const troop = (orders[0]!.payload as { troop?: string }).troop;
    expect(troop).toBeTruthy();
    expect(canOrder(s, orders[0]!)).toBeNull();
  });
});

describe('верфь — подписи статов и ресурсов (UIX-5.1)', () => {
  // Без записи в словаре `t()` отдаёт сам ключ данных: чип читался «+8 pointDefense»,
  // ценник — «25 biomass». Сторож берёт статы и ресурсы прямо из `data/`, поэтому новый
  // стат или ресурс без подписи роняет его сразу.
  const moduleStats = [
    ...new Set(
      Object.values(data.modules).flatMap((m) => [
        ...Object.keys(m.effects.stats),
        ...Object.values(m.rarityBonus ?? {}).flatMap((bag) => Object.keys(bag ?? {})),
      ]),
    ),
  ];

  it.each(moduleStats)('стат модуля %s подписан по-русски и по-английски', (stat) => {
    const key = STAT_KEY[stat];
    expect(key).toBeDefined();
    expect(ru[key!]).toBeTruthy();
    expect(en[key!]).toBeTruthy();
  });

  it.each(data.resources)('ресурс %s подписан по-русски и по-английски', (res) => {
    const key = RES_KEY[res];
    expect(key).toBeDefined();
    expect(ru[key!]).toBeTruthy();
    expect(en[key!]).toBeTruthy();
  });

  it('цена в биомассе — словом', () => {
    expect(bagText({ biomass: 25 })).toBe('25 биомассы');
  });
});

describe('производство — корпус без отсеков и очередь мира (переделка окна, шаг 1)', () => {
  it.each(['militia', 'tank', 'landing_shuttle'])(
    '%s модулей не несёт: ни отсеков, ни серого каталога',
    (hull) => {
      const s = rich();
      const html = loadoutPaneHtml(s, 'p1', draftOf({ hull }), [hull], view);
      expect(Object.values(data.units[hull]!.slots ?? {}).every((n) => !n)).toBe(true);
      expect(html).toContain(t('yard.slots.none'));
      expect(html).not.toContain('cn-pal');
      expect(html).not.toContain('cn-mod');
      expect(html).not.toContain('cn-bay');
    },
  );

  it('у корпуса с отсеками палитра и оговорка про постройку на месте', () => {
    const s = rich();
    const html = loadoutPaneHtml(s, 'p1', normalizeDraft(s, 'p1', draftOf(), YARD_HULLS), YARD_HULLS, view);
    expect(html).toContain('cn-pal');
    expect(html).toContain(t('yard.loadout.note'));
    expect(html).not.toContain(t('yard.slots.none'));
  });

  it('очередь мира: свободно — null; идёт стройка и ждёт заказ — двое впереди и срок идущей', () => {
    let s = rich();
    const home = normalizeDraft(s, 'p1', draftOf(), YARD_HULLS).planet;
    expect(unitLaneAhead(s, home)).toBeNull();
    s = applyOrder(s, buildShip('p1', home, 'cruiser', 1, []), s.time).state;
    s = applyOrder(s, buildShip('p1', home, 'cruiser', 1, []), s.time).state;
    const ahead = unitLaneAhead(s, home)!;
    expect(ahead.count).toBe(2);
    expect(ahead.nextInHours).toBeCloseTo(
      (s.scheduled.find((e) => e.type === 'construction.complete')!.at - s.time) / HOUR,
    );
    const bar = orderBarHtml(s, 'p1', normalizeDraft(s, 'p1', draftOf(), YARD_HULLS), YARD_HULLS, view);
    expect(bar).toContain(t('yard.queue.ahead', { n: 2, eta: fmtEta(ahead.nextInHours) }));
  });

  it('очередь без идущей стройки (голова ждёт денег) — число без срока', () => {
    const s = rich();
    const home = normalizeDraft(s, 'p1', draftOf(), YARD_HULLS).planet;
    s.planets[home]!.buildQueue = [{ id: 99, kind: 'unit', playerId: 'p1', unit: 'cruiser', count: 1 }];
    expect(unitLaneAhead(s, home)).toEqual({ count: 1, nextInHours: 0 });
    const bar = orderBarHtml(s, 'p1', normalizeDraft(s, 'p1', draftOf(), YARD_HULLS), YARD_HULLS, view);
    expect(bar).toContain(t('yard.queue.waiting', { n: 1 }));
  });

  it('заказ здания в той же очереди не считается: юниты и здания строятся параллельно', () => {
    const s = rich();
    const home = normalizeDraft(s, 'p1', draftOf(), YARD_HULLS).planet;
    s.planets[home]!.buildQueue = [{ id: 98, kind: 'building', playerId: 'p1', building: 'barracks' }];
    expect(unitLaneAhead(s, home)).toBeNull();
  });
});

describe('производство — слоты-выноски на арте (переделка окна, шаг 2)', () => {
  const slotCount = (hull: string): number =>
    Object.values(data.units[hull]!.slots ?? {}).reduce<number>((a, n) => a + (n ?? 0), 0);

  it('у каждого корпуса окна с отсеками — точка и плитка на каждый отсек', () => {
    const s = rich();
    for (const list of [YARD_HULLS, YARD_SQUAD_HULLS]) {
      for (const hull of list) {
        const d = normalizeDraft(s, 'p1', draftOf({ hull }), list);
        expect(d.hull).toBe(hull);
        const html = loadoutPaneHtml(s, 'p1', d, list, view);
        const n = slotCount(hull);
        expect((html.match(/class="cn-tile /g) ?? []).length, hull).toBe(n);
        expect((html.match(/class="cn-dot/g) ?? []).length, hull).toBe(n);
        expect(html.includes('class="cn-art"'), hull).toBe(n > 0);
      }
    }
  });

  it('надетый модуль — плитка с его иконкой и цветом редкости, пустой отсек — тип слота', () => {
    const s = rich();
    const d = normalizeDraft(s, 'p1', draftOf({ modules: ['ion_engine'] }), YARD_HULLS);
    const html = loadoutPaneHtml(s, 'p1', d, YARD_HULLS, view);
    const mod = data.modules.ion_engine!;
    // Плитки идут в порядке отсеков: оружие, защита, система; открыт первый пустой отсек.
    expect(html).toContain('class="cn-tile filled" data-cnsel="2" aria-pressed="false"');
    expect(html).toContain(`--rar:var(--rar-${mod.rarity})`);
    expect(html).toContain(`aria-label="${t('yard.slot.utility')}: ${tData(mod.name)} (${t(`rarity.${mod.rarity}`)})"`);
    expect(html).toContain('class="cn-tile empty sel" data-cnsel="0" aria-pressed="true"');
    expect(html).toContain('class="cn-tile empty" data-cnsel="1" aria-pressed="false"');
    expect(html).toContain(`aria-label="${t('yard.slot.weapon')}: ${t('yard.slot.empty')}"`);
  });

  it('плитка на арте открывает свой отсек, как строка отсека', () => {
    const win = fakeWin();
    const yard = initShipyard(hostOf({ root: () => win }));
    yard.open();
    win.fire(click('.cn-mod', { cnmod: 'ion_engine' }));
    win.fire(click('[data-cnsel]', { cnsel: '2' }));
    const html = win.html();
    expect(html).toContain('class="cn-tile filled sel" data-cnsel="2" aria-pressed="true"');
    expect(html).toContain('class="cn-bay filled sel" data-cnsel="2"');
    expect(html).toContain(t('yard.modules.for-slot', { s: t('yard.slot.utility') }));
  });
});

describe('производство — модули открытого отсека, три колонки (переделка окна, шаг 3)', () => {
  const s = rich();
  const pane = (over: Partial<YardDraft>): string =>
    loadoutPaneHtml(s, 'p1', normalizeDraft(s, 'p1', draftOf(over), YARD_HULLS), YARD_HULLS, view);
  /** Модули, которые можно поставить в открытый отсек (без свёрнутых неподходящих). */
  const offered = (html: string): string[] =>
    [...html.matchAll(/<button class="cn-mod[^"]*" data-cnmod="([a-z_]+)"/g)].map((x) => x[1]!);

  it('открыт выбранный отсек, пока он есть; иначе первый пустой; все заняты — первый', () => {
    const bays = [{ moduleId: 'a' }, {}, {}];
    expect(selectedBay(bays, 2)).toBe(2);
    expect(selectedBay(bays)).toBe(1);
    expect(selectedBay(bays, 7)).toBe(1);
    expect(selectedBay([{ moduleId: 'a' }, { moduleId: 'b' }])).toBe(0);
  });

  it('отсеку предложены модули его типа, без надетых в нём и в соседних отсеках', () => {
    // Фрегат: защита + три системы; грузовой отсек и ионный двигатель уже стоят.
    const html = pane({ hull: 'frigate', modules: ['cargo_bay', 'ion_engine'], slot: 3 });
    const ids = offered(html);
    expect(ids.length).toBeGreaterThan(0);
    expect(ids.every((id) => data.modules[id]!.slot === 'utility')).toBe(true);
    expect(ids).not.toContain('cargo_bay');
    expect(ids).not.toContain('ion_engine');
    expect(ids).toContain('mine_layer'); // минный заградитель — для фрегатов
    expect(html).not.toContain('class="cn-pg"'); // одна группа — без заголовка
  });

  it('неподходящие корпусу модули свёрнуты в одну строку и разворачиваются', () => {
    // Защита крейсера: три щита пустоты (для пушек крепости) и завеса роя не встают.
    const folded = pane({ slot: 1 });
    expect(folded).toContain(`aria-expanded="false">${t('yard.modules.unfit', { n: 4 })}<`);
    expect(folded).not.toContain('cn-mod locked');
    const open = pane({ slot: 1, unfit: true });
    expect(open).toContain(`aria-expanded="true">${t('yard.modules.unfit-hide')}<`);
    expect((open.match(/cn-mod locked/g) ?? []).length).toBe(4);
    // Оружие крейсера встаёт всё — сворачивать нечего.
    expect(pane({ slot: 0 })).not.toContain('data-cnunfit');
  });

  it('нет ни одного модуля для отсека — так и сказано, а не пустая колонка', () => {
    const bare = rich();
    bare.players.p1!.arsenal = { hulls: ['cruiser'], modules: [] };
    const html = loadoutPaneHtml(bare, 'p1', normalizeDraft(bare, 'p1', draftOf(), ['cruiser']), ['cruiser'], view);
    expect(html).toContain(`class="cn-none">${t('yard.modules.none')}<`);
  });

  it('три колонки — корпуса, корабль, модули отсека; у корпуса без отсеков две', () => {
    expect(pane({})).toMatch(
      /^<div class="cn-grid cn-g3"><div class="cn-hulls">.*<div class="cn-card with-tiles">.*<div class="cn-slot">.*<div class="cn-side">/,
    );
    const html = loadoutPaneHtml(s, 'p1', draftOf({ hull: 'militia' }), ['militia'], view);
    expect(html).toMatch(/^<div class="cn-grid cn-g2">/);
    expect(html).not.toContain('cn-slot');
  });

  it('модуль в занятом отсеке встаёт на место прежнего, затем открыт следующий пустой', () => {
    const win = fakeWin();
    const yard = initShipyard(hostOf({ root: () => win }));
    yard.open();
    win.fire(click('.cn-mod', { cnmod: 'targeting_array' })); // в открытый отсек оружия
    expect(win.html()).toContain('class="cn-tile empty sel" data-cnsel="1"'); // дальше — защита
    win.fire(click('[data-cnsel]', { cnsel: '0' }));
    win.fire(click('.cn-mod', { cnmod: 'tractor_beam' }));
    expect(worn(win.html())).toEqual([tData(data.modules.tractor_beam!.name)]);
    expect(win.html()).toContain('class="cn-tile empty sel" data-cnsel="1"');
  });

  it('все отсеки заняты — после выбора открыт отсек с новым модулем, замена идёт в нём', () => {
    const win = fakeWin();
    const yard = initShipyard(hostOf({ root: () => win }));
    yard.open();
    win.fire(click('.cn-tab', { ctab: 'support' }));
    win.fire(click('.cn-hbtn', { cnhull: 'scout' })); // один отсек системы
    win.fire(click('.cn-mod', { cnmod: 'cargo_bay' }));
    expect(win.html()).toContain('data-cnrm="cargo_bay"');
    win.fire(click('.cn-mod', { cnmod: 'ion_engine' }));
    expect(worn(win.html())).toEqual([tData(data.modules.ion_engine!.name)]);
    expect(win.html()).toContain('data-cnrm="ion_engine"');
  });

  it('«Снять» оставляет открытым освободившийся отсек — последний своего типа', () => {
    const win = fakeWin();
    const yard = initShipyard(hostOf({ root: () => win }));
    yard.open();
    win.fire(click('.cn-hbtn', { cnhull: 'frigate' }));
    for (const id of ['cargo_bay', 'ion_engine', 'repair_bay']) win.fire(click('.cn-mod', { cnmod: id }));
    win.fire(click('[data-cnsel]', { cnsel: '1' }));
    win.fire(click('[data-cnrm]', { cnrm: 'cargo_bay' }));
    // Системы сдвинулись: двигатель и ремонт в отсеках 1–2, пуст и открыт третий.
    expect(worn(win.html())).toEqual(['ion_engine', 'repair_bay'].map((id) => tData(data.modules[id]!.name)));
    expect(win.html()).toContain('class="cn-bay empty sel" data-cnsel="3"');
  });

  it('смена корпуса и вкладки закрывает отсек и сворачивает неподходящие', () => {
    const win = fakeWin();
    const yard = initShipyard(hostOf({ root: () => win }));
    yard.open();
    win.fire(click('[data-cnsel]', { cnsel: '2' }));
    win.fire(click('[data-cnunfit]'));
    expect(win.html()).toContain(t('yard.modules.unfit-hide'));
    win.fire(click('.cn-hbtn', { cnhull: 'heavy_cruiser' }));
    expect(win.html()).toContain('class="cn-tile empty sel" data-cnsel="0"');
    expect(win.html()).not.toContain(t('yard.modules.unfit-hide'));
    win.fire(click('[data-cnsel]', { cnsel: '3' }));
    win.fire(click('.cn-tab', { ctab: 'squads' }));
    win.fire(click('.cn-tab', { ctab: 'ships' }));
    expect(win.html()).toContain('class="cn-tile empty sel" data-cnsel="0"');
  });

  it('после выбора модуля корабль возвращается на экран — видно, куда модуль встал', () => {
    const win = fakeWin();
    const scrolled: [string, unknown][] = [];
    (win as { querySelector: unknown }).querySelector = (q: string) => ({
      scrollIntoView: (o: unknown) => scrolled.push([q, o]),
    });
    const yard = initShipyard(hostOf({ root: () => win }));
    yard.open();
    win.fire(click('[data-cnsel]', { cnsel: '1' }));
    expect(scrolled).toEqual([]); // открыть отсек — не прокрутка: модули рядом с кораблём
    win.fire(click('.cn-mod', { cnmod: 'ablative_plating' }));
    expect(scrolled).toEqual([['#constructor .cn-hull', expect.objectContaining({ block: 'nearest' })]]);
  });
});

describe('производство — «Как в прошлый раз» (UIX-7.3)', () => {
  const cruiser = draftOf({ modules: ['ion_engine'], count: 2, planet: 'home' });

  it('без заказа и пока окно стоит на последнем заказе — кнопки нет', () => {
    expect(repeatOrderHtml(null, 'ships', cruiser)).toBe('');
    expect(repeatOrderHtml({ tab: 'ships', draft: cruiser }, 'ships', { ...cruiser })).toBe('');
  });

  it('окно ушло с последнего заказа — кнопка называет корпус и число', () => {
    const last = { tab: 'ships' as const, draft: cruiser };
    const html = repeatOrderHtml(last, 'ships', { ...cruiser, modules: [] });
    const label = `${t('yard.again')}: ${displayUnit('cruiser')} ×2`;
    expect(html).toContain('data-cnagain');
    expect(html).toContain(`aria-label="${label}"`);
    expect(html).toContain(`<span class="cn-ag-k">${t('yard.again')}:</span> ${displayUnit('cruiser')} ×2</button>`);
    // Тот же черновик на другой вкладке, другое число или мир — тоже не последний заказ.
    expect(repeatOrderHtml(last, 'squads', cruiser)).toContain('data-cnagain');
    expect(repeatOrderHtml(last, 'ships', { ...cruiser, count: 1 })).toContain('data-cnagain');
    expect(repeatOrderHtml(last, 'ships', { ...cruiser, planet: 'other' })).toContain('data-cnagain');
  });

  it('кнопка стоит в шапке окна, перед крестиком', () => {
    const html = yardBoxHtml('ships', '', '', '<button data-cnagain></button>');
    expect(html).toContain('<b>' + t('yard.title') + '</b><button data-cnagain></button><button class="cn-close btn-x">');
  });

  it('после заказа другой корпус и вкладка — кнопка собирает заказ заново', () => {
    const win = fakeWin();
    const sent: Action[] = [];
    const yard = initShipyard(hostOf({ root: () => win, order: (a) => sent.push(a) }));
    yard.open();
    expect(win.html()).not.toContain('data-cnagain');
    win.fire(click('.cn-mod', { cnmod: 'ion_engine' }));
    win.fire(click('[data-cncount]', { cncount: '+' }));
    win.fire(click('[data-cnbuild]'));
    expect(win.html()).not.toContain('data-cnagain'); // окно и так стоит на этом заказе
    win.fire(click('.cn-tab', { ctab: 'squads' }));
    expect(win.html()).toContain(`${displayUnit('cruiser')} ×2</button>`);
    win.fire(click('[data-cnagain]'));
    const html = win.html();
    expect(html).toContain('class="cn-tab on" data-ctab="ships"');
    expect(worn(html)).toEqual([tData(data.modules.ion_engine!.name)]);
    expect(html).toContain('data-cnbuild');
    expect(html).not.toContain('data-cnagain');
    win.fire(click('[data-cnbuild]'));
    expect(sent.map((a) => (a.payload as { count: number }).count)).toEqual([2, 2]);
  });
});

describe('производство — редкость и уровень прокачки модулей', () => {
  /** Место забега Сектора Зеро: снимок арсенала со звёздами и поднятой редкостью. */
  function seat(stars: Record<string, number>, rarity: Record<string, string> = {}): GameState {
    const s = rich();
    s.players.p1!.arsenal = {
      hulls: Object.keys(data.units).sort(),
      modules: Object.keys(data.modules).sort(),
      stars,
      rarity,
    };
    return s;
  }
  const card = (html: string, id: string): string =>
    html.match(new RegExp(`<button class="cn-mod[^"]*" data-cnmod="${id}">.*?</button>`))?.[0] ?? '';

  it('ступень — словом её цветом, звёзды — только горящие', () => {
    expect(moduleGradeHtml('unique', 0)).toBe(`<span class="cn-mr r-unique"><span class="cn-rw">${t('rarity.unique')}</span></span>`);
    const lit = moduleGradeHtml('mythic', 3);
    expect(lit).toContain('★★★</span>');
    expect(lit).toContain(`aria-label="${t('shipcard.stars', { n: 3 })}"`);
  });

  it('обычная партия: карточка в рамке ступени из каталога, звёзд нет нигде', () => {
    const s = rich();
    const d = normalizeDraft(s, 'p1', draftOf({ hull: 'frigate', modules: ['ion_engine'] }), YARD_HULLS);
    const html = loadoutPaneHtml(s, 'p1', d, YARD_HULLS, view);
    expect(html).toContain(moduleGradeHtml(data.modules.ion_engine!.rarity ?? 'simple', 0));
    // Отсек системы открыт — в его колонке карточка трюма.
    const open = loadoutPaneHtml(s, 'p1', { ...d, modules: [], slot: 2 }, YARD_HULLS, view);
    const rar = data.modules.cargo_bay!.rarity ?? 'simple';
    expect(card(open, 'cargo_bay')).toContain(`class="cn-mod r-${rar}"`);
    expect(card(open, 'cargo_bay')).toContain(t(`rarity.${rar}`));
    for (const h of [html, open]) {
      expect(h).not.toContain('class="cn-st"');
      expect(h).not.toContain('class="cn-tst"');
    }
  });

  it('забег: звёзды и поднятая ступень на плитке, в строке отсека и в числах', () => {
    const s = seat({ ion_engine: 2 }, { ion_engine: 'unique' });
    // Открыт отсек двигателя: его строка видна вместе с плиткой.
    const d = normalizeDraft(s, 'p1', draftOf({ hull: 'frigate', modules: ['ion_engine'], slot: 2 }), YARD_HULLS);
    const html = loadoutPaneHtml(s, 'p1', d, YARD_HULLS, view);
    expect(html).toContain('--rar:var(--rar-unique)');
    expect(html).toContain('<span class="cn-tst" aria-hidden="true">★2</span>');
    expect(html).toContain(`(${t('rarity.unique')}, ${t('shipcard.stars', { n: 2 })})"`);
    expect(html).toContain(moduleGradeHtml('unique', 2));
    // ★2 = ×1.2 на вклад модуля и на параметр уникальной ступени: +2.4 скорости, +1.2 защиты.
    expect(html).toContain(`+2.4 ${t(STAT_KEY.speed!)}`);
    expect(html).toContain(`+1.2 ${t(STAT_KEY.defense!)}`);
  });

  it('забег: карточка звёздного модуля в колонке отсека — с его звёздами и числом', () => {
    const s = seat({ cargo_bay: 1 });
    const d = normalizeDraft(s, 'p1', draftOf({ hull: 'frigate', modules: [], slot: 2 }), YARD_HULLS);
    const html = loadoutPaneHtml(s, 'p1', d, YARD_HULLS, view);
    const c = card(html, 'cargo_bay');
    expect(c).toContain('★</span>');
    const cargo = data.modules.cargo_bay!.effects.stats.cargoCapacity!;
    expect(c).toContain(`+${Math.round(cargo * 1.1 * 10) / 10} `);
  });
});
