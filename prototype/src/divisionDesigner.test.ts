import { describe, it, expect, beforeAll } from 'vitest';
import { setLocale } from '../../localization/runtime';
import { newGame, templatesOf, OFFICER_TEMPLATES, FORMATION_SLOTS } from './game';
import type { Action, GameState } from '../../packages/shared-core/src/index';
import {
  designList,
  divDesignHtml,
  nextSlotUnit,
  initDivDesign,
  type DivDesignHost,
} from './divisionDesigner';

// REFM-8: locale pinned RU (see format.test.ts — Node has no browser language, so the
// runtime would fall back to EN and the label assertions would drift).
beforeAll(() => setLocale('ru'));

/** Node has no DOM — the designer repaints a body, toggles a class and delegates
 *  clicks, so a stand-in with those is the whole contract. */
function fakeWin(): HTMLElement & {
  fire: (target: unknown) => void;
  shown: () => boolean;
  nameValue: (v: string) => void;
} {
  let handler: ((ev: unknown) => void) | null = null;
  const classes = new Set<string>();
  const nameInput = { value: '' };
  const el = {
    classList: {
      add: (c: string) => classes.add(c),
      remove: (c: string) => classes.delete(c),
      contains: (c: string) => classes.has(c),
    },
    querySelector: (sel: string) => (sel === '#dd-name' ? nameInput : null),
    addEventListener: (_t: string, h: (ev: unknown) => void) => {
      handler = h;
    },
    fire: (target: unknown) => handler?.({ target }),
    shown: () => classes.has('show'),
    nameValue: (v: string) => {
      nameInput.value = v;
    },
  };
  return el as unknown as HTMLElement & {
    fire: (t: unknown) => void;
    shown: () => boolean;
    nameValue: (v: string) => void;
  };
}

function fakeBody(): HTMLElement & { html: () => string } {
  const el = { innerHTML: '', html: () => el.innerHTML };
  return el as unknown as HTMLElement & { html: () => string };
}

/** A click whose `closest(sel)` answers only for the selector we mean to hit. */
function ddClick(sel: string, dataset: Record<string, string> = {}, disabled = false): unknown {
  return { closest: (q: string) => (q === sel ? { dataset, disabled } : null) };
}

function wire(over: Partial<DivDesignHost> = {}, state?: GameState) {
  const win = fakeWin();
  const body = fakeBody();
  const sent: Action[] = [];
  let closes = 0;
  const s = state ?? newGame();
  const api = initDivDesign({
    root: () => win,
    body: () => body,
    state: () => s,
    me: () => 'p1',
    pcUi: () => true,
    order: (a) => sent.push(a),
    onClose: () => closes++,
    ...over,
  });
  return { api, win, body, sent, s, closes: () => closes };
}

describe('конструктор дивизий — список дизайнов', () => {
  it('свои шаблоны идут первыми, офицерские премейды — следом и помечены', () => {
    const s = newGame();
    const all = designList(s, 'p1');
    const mine = templatesOf(s, 'p1');
    expect(all).toHaveLength(mine.length + OFFICER_TEMPLATES.length);
    expect(all.slice(0, mine.length).every((d) => d.officer === undefined)).toBe(true);
    expect(all.slice(mine.length).every((d) => d.officer !== undefined)).toBe(true);
  });
});

describe('конструктор дивизий — цикл слота', () => {
  it('пустой слот проходит весь ростер и возвращается в пустой', () => {
    const seen: (string | null)[] = [];
    let cur: string | null = null;
    for (let i = 0; i < 5; i++) {
      cur = nextSlotUnit(cur);
      seen.push(cur);
    }
    expect(seen).toEqual(['militia', 'heavy_infantry', 'special_forces', 'tank', null]);
  });

  it('незнакомый юнит не застревает, а начинает цикл заново', () => {
    // indexOf вернёт -1 → следующий индекс 0 → null; слот очищается, а не ломается
    expect(nextSlotUnit('космический кит')).toBeNull();
  });
});

describe('конструктор дивизий — разметка', () => {
  const s = newGame();

  it('свой шаблон даёт переименование и АКТИВНЫЕ слоты', () => {
    const html = divDesignHtml(s, 'p1', 0, true);
    expect(html).toContain('data-ddrename');
    expect(html).toContain('id="dd-name"');
    expect(html).not.toContain('disabled');
    expect([...html.matchAll(/data-ddslot="\d+"/g)]).toHaveLength(FORMATION_SLOTS);
  });

  it('офицерский премейд заперт: бонус, замок, и слоты недоступны', () => {
    const idx = templatesOf(s, 'p1').length; // первый премейд
    const html = divDesignHtml(s, 'p1', idx, true);
    expect(html).toContain('dd-lock');
    expect(html).not.toContain('data-ddrename');
    expect([...html.matchAll(/data-ddslot="\d+" disabled/g)]).toHaveLength(FORMATION_SLOTS);
  });

  it('индекс за краем списка подтягивается к последнему, а не роняет экран', () => {
    const all = designList(s, 'p1');
    expect(divDesignHtml(s, 'p1', 999, true)).toBe(divDesignHtml(s, 'p1', all.length - 1, true));
    expect(divDesignHtml(s, 'p1', -5, true)).toBe(divDesignHtml(s, 'p1', 0, true));
  });

  it('превью урона показывает все четыре цели', () => {
    const html = divDesignHtml(s, 'p1', 0, true);
    expect([...html.matchAll(/class="vrow"/g)]).toHaveLength(4);
  });

  it('раскладка меняет глифы ростера, но не структуру', () => {
    const pc = divDesignHtml(s, 'p1', 0, true);
    const mob = divDesignHtml(s, 'p1', 0, false);
    expect(pc).not.toBe(mob);
    expect([...pc.matchAll(/data-ddslot/g)]).toHaveLength(
      [...mob.matchAll(/data-ddslot/g)].length,
    );
  });

  it('имя шаблона экранируется — игрок его сам вводит (CWE-79)', () => {
    const evil = newGame();
    const tpl = templatesOf(evil, 'p1')[0]!;
    tpl.name = '"><img src=x onerror=alert(1)>';
    const html = divDesignHtml(evil, 'p1', 0, true);
    expect(html).toContain('&quot;&gt;&lt;img');
    expect(html).not.toContain('<img src=x');
  });
});

describe('конструктор дивизий — окно', () => {
  it('open(idx) показывает окно и открывает ИМЕННО этот дизайн', () => {
    const { api, win, body, s } = wire();
    const premade = templatesOf(s, 'p1').length;
    api.open(premade);
    expect(win.shown()).toBe(true);
    expect(body.html()).toContain(`data-ddtab="${premade}" class="on"`);
  });

  it('клик по вкладке переключает дизайн', () => {
    const { api, win, body } = wire();
    api.open(0);
    win.fire(ddClick('[data-ddtab]', { ddtab: '1' }));
    expect(body.html()).toContain('data-ddtab="1" class="on"');
  });

  it('клик по слоту шлёт приказ со СЛЕДУЮЩИМ юнитом цикла', () => {
    const { api, win, sent, s } = wire();
    api.open(0);
    const before = templatesOf(s, 'p1')[0]!.slots[0] ?? null;
    win.fire(ddClick('[data-ddslot]', { ddslot: '0' }));
    expect(sent).toHaveLength(1);
    expect(sent[0]!.type).toBe('division.template');
    expect(sent[0]!.payload).toMatchObject({
      template: 0,
      slot: 0,
      unit: nextSlotUnit(before),
    });
  });

  it('запертый слот премейда приказа не шлёт', () => {
    const { api, win, sent, s } = wire();
    api.open(templatesOf(s, 'p1').length); // офицерский
    win.fire(ddClick('[data-ddslot]', { ddslot: '0' }, true));
    expect(sent).toHaveLength(0);
  });

  it('переименование шлёт приказ, а пустое имя — нет', () => {
    const { api, win, sent } = wire();
    api.open(0);
    win.nameValue('   ');
    win.fire(ddClick('[data-ddrename]'));
    expect(sent).toHaveLength(0);
    win.nameValue('  Ударный кулак  ');
    win.fire(ddClick('[data-ddrename]'));
    expect(sent).toHaveLength(1);
    expect(sent[0]!.type).toBe('division.rename');
    expect(sent[0]!.payload).toMatchObject({ template: 0, name: 'Ударный кулак' });
  });

  it('переименовать премейд нельзя даже приказом в обход разметки', () => {
    const { api, win, sent, s } = wire();
    api.open(templatesOf(s, 'p1').length);
    win.nameValue('моё');
    win.fire(ddClick('[data-ddrename]'));
    expect(sent).toHaveLength(0);
  });

  it('закрытие крестиком сбрасывает кэш панели мобилизации', () => {
    const { api, win, closes } = wire();
    api.open(0);
    win.fire(ddClick('.tw-close'));
    expect(win.shown()).toBe(false);
    expect(closes()).toBe(1);
  });
});
