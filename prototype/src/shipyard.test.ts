import { describe, it, expect, beforeAll } from 'vitest';
import { setLocale } from '../../localization/runtime';
import { newGame } from './game';
import type { Action, ArsenalItem, GameState } from '../../packages/shared-core/src/index';
import {
  bagText,
  statBarHtml,
  originTagHtml,
  ownedHullsOf,
  normalizeDraft,
  loadoutPaneHtml,
  yardBoxHtml,
  initShipyard,
  YARD_HULLS,
  YARD_SQUAD_HULLS,
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
    s.players.p1!.arsenal = { hulls: ['scout'], modules: [], fittings: [] };
    expect(ownedHullsOf(s, 'p1', YARD_HULLS)).toEqual(['scout']);
  });

  it('ни одного своего корпуса — панель честно пустая, а не пустой конструктор', () => {
    const s = rich();
    s.players.p1!.arsenal = { hulls: [], modules: [], fittings: [] };
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
    expect(html).toContain('data-cnbuild');
  });

  it('поставленный модуль занимает отсек и снимается кликом', () => {
    const d = normalizeDraft(s, 'p1', draftOf({ modules: ['ion_engine'] }), YARD_HULLS);
    const html = loadoutPaneHtml(s, 'p1', d, YARD_HULLS, view);
    expect(html).toContain('data-cnun="ion_engine"');
  });

  it('пустая казна гасит кнопку заказа, а не позволяет отправить отказ', () => {
    const broke = rich();
    broke.players.p1!.resources = { metal: 0, credits: 0, energy: 0, food: 0, microelectronics: 0 };
    const d = normalizeDraft(broke, 'p1', draftOf(), YARD_HULLS);
    const html = loadoutPaneHtml(broke, 'p1', d, YARD_HULLS, view);
    expect(html).toMatch(/data-cnbuild disabled/);
  });

  it('без своих миров селектор заблокирован и заказ невозможен', () => {
    const homeless = rich();
    for (const p of Object.values(homeless.planets)) if (p.owner === 'p1') p.owner = null;
    const d = normalizeDraft(homeless, 'p1', draftOf(), YARD_HULLS);
    const html = loadoutPaneHtml(homeless, 'p1', d, YARD_HULLS, view);
    expect(html).toContain('<select class="cn-plan" id="cn-planet" disabled');
    expect(html).toMatch(/data-cnbuild disabled/);
  });

  it('строка цены модулей появляется только когда обвес есть', () => {
    const bare = loadoutPaneHtml(
      s,
      'p1',
      normalizeDraft(s, 'p1', draftOf(), YARD_HULLS),
      YARD_HULLS,
      view,
    );
    const fitted = loadoutPaneHtml(
      s,
      'p1',
      normalizeDraft(s, 'p1', draftOf({ modules: ['ion_engine'] }), YARD_HULLS),
      YARD_HULLS,
      view,
    );
    expect(bare).toContain('cn-crow');
    expect((bare.match(/cn-crow/g) ?? []).length).toBeLessThan(
      (fitted.match(/cn-crow/g) ?? []).length,
    );
  });

  it('шаг количества упирается в границы — «−» на единице выключен', () => {
    const one = loadoutPaneHtml(
      s,
      'p1',
      normalizeDraft(s, 'p1', draftOf(), YARD_HULLS),
      YARD_HULLS,
      view,
    );
    expect(one).toContain('data-cncount="-" disabled');
    const many = loadoutPaneHtml(
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
    gated.players.p1!.arsenal = { hulls: ['cruiser'], modules: ['ion_engine'], fittings: [] };
    const html = loadoutPaneHtml(gated, 'p1', draftOf(), YARD_HULLS, view);
    expect((html.match(/cn-note/g) ?? []).length).toBe(2);
  });
});

describe('верфь — окно', () => {
  it('открытая вкладка подсвечена, каркас на месте', () => {
    const html = yardBoxHtml('squads', '<i>тело</i>');
    expect(html).toContain('<button class="cn-tab on" data-ctab="squads">');
    expect(html).toContain('<div id="constructorbody"><i>тело</i></div>');
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
    expect(win.html()).toContain('data-cnun="ion_engine"');
    win.fire(click('.cn-hbtn', { cnhull: 'scout' }));
    expect(win.html()).not.toContain('data-cnun="ion_engine"');
  });

  it('модуль ставится и снимается кликом', () => {
    const win = fakeWin();
    const yard = initShipyard(hostOf({ root: () => win }));
    yard.open();
    win.fire(click('.cn-mod', { cnmod: 'ion_engine' }));
    expect(win.html()).toContain('data-cnun="ion_engine"');
    win.fire(click('.cn-bay.filled', { cnun: 'ion_engine' }));
    expect(win.html()).not.toContain('data-cnun="ion_engine"');
  });

  it('отказ ядра доезжает до игрока текстом кода, а не молча', () => {
    const win = fakeWin();
    const s = rich();
    // корпус со снимком арсенала, где модуля НЕТ — ядро откажет по стабильному коду
    s.players.p1!.arsenal = { hulls: ['cruiser'], modules: [], fittings: [] };
    const notes: string[] = [];
    const yard = initShipyard(
      hostOf({ root: () => win, state: () => s, note: (m) => notes.push(m) }),
    );
    yard.open();
    win.fire(click('.cn-mod', { cnmod: 'ion_engine' }));
    expect(notes.length).toBe(1);
    expect(notes[0]).toMatch(/^✖ E_/);
    expect(win.html()).not.toContain('data-cnun="ion_engine"');
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
